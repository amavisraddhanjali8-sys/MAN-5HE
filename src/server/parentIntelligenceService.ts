import crypto from 'node:crypto';
import { selectQuestionsForAssessment } from '../lib/assessmentEngine.ts';
import { canAccessSubject, resolveQuestionSubjectId } from '../lib/authorization.ts';
import {
  addDaysToDateString,
  buildStructuredTeachingGuide,
  computeSessionCountdownState,
  convertLocalDateTimeToUtcIso,
  detectScheduleConflicts,
  expandRecurrenceDates,
  formatUtcInTimeZone,
  isValidTimeZone,
} from '../lib/learningScheduler.ts';
import {
  buildAccessibleReportHtmlDocument,
  buildParentReportEmailHtml,
  buildSessionReminderEmailHtml,
  buildWhatsAppParentReportPayload,
  buildWhatsAppReminderPayload,
} from '../lib/notifications.ts';
import { calculateQuizDifficultyScore, generateVirtualQuizFromPool } from '../lib/psychometrics.ts';
import type {
  AttemptRecord,
  DifficultyTier,
  GuardianStudentLink,
  LearningActivityType,
  ParentAssessmentReport,
  ParentReportQuestionItem,
  ParentTeachingGuidance,
  QuestionType,
  QuizItem,
  ReminderJobRecord,
  ReminderPreferenceRecord,
  ReportCorrectnessStatus,
  ReportDeliveryRecord,
  ScheduleQuestionFilters,
  ScheduledSessionRecord,
  ScheduledSessionStatus,
  StudentTimetable,
  TimetablePreset,
  TimetablePresetActivity,
  TimetableRecurrenceType,
  UserAccount,
  UserRole,
} from '../lib/types.ts';
import { AcademicService, HttpError, rowToQuiz } from './academicService.ts';
import { adaptParentTeachingGuideWithAi } from './aiTeachingGuide.ts';
import { Man5heDatabase } from './db.ts';
import { buildParentReportPdfBuffer } from './reportPdf.ts';

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class ParentIntelligenceService {
  private readonly dbWrapper: Man5heDatabase;
  private readonly academicService: AcademicService;

  constructor(dbWrapper: Man5heDatabase, academicService: AcademicService) {
    this.dbWrapper = dbWrapper;
    this.academicService = academicService;
  }

  private get db() {
    return this.dbWrapper.db;
  }

  // =========================================================================
  // 1. GUARDIAN-STUDENT LINKS & STRICT AUTHORIZATION
  // =========================================================================

  private hydrateLinkRow(row: Record<string, unknown>): GuardianStudentLink {
    return {
      id: String(row.id),
      guardianUserId: String(row.guardian_user_id),
      guardianName: row.guardian_name ? String(row.guardian_name) : undefined,
      guardianEmail: row.guardian_email ? String(row.guardian_email) : undefined,
      guardianWhatsapp: row.guardian_whatsapp ? String(row.guardian_whatsapp) : undefined,
      studentUserId: String(row.student_user_id),
      studentName: row.student_name ? String(row.student_name) : undefined,
      studentUserIdCode: row.student_user_id_code ? String(row.student_user_id_code) : undefined,
      studentGrade: row.student_grade ? String(row.student_grade) : undefined,
      studentCurrentLevel: row.student_current_level
        ? (String(row.student_current_level) as GuardianStudentLink['studentCurrentLevel'])
        : undefined,
      relationshipLabel: String(row.relationship_label || 'Parent / Guardian'),
      verified: Number(row.verified ?? 0) === 1,
      consentGiven: Number(row.consent_given ?? 0) === 1,
      canViewReports: Number(row.can_view_reports ?? 0) === 1,
      canManageSchedule: Number(row.can_manage_schedule ?? 0) === 1,
      canReceiveNotifications: Number(row.can_receive_notifications ?? 0) === 1,
      studentCanEditSchedule: Number(row.student_can_edit_schedule ?? 0) === 1,
      studentDailyMaxMinutes: Number(row.student_daily_max_minutes ?? 120),
      studentRescheduleWindowHours: Number(row.student_reschedule_window_hours ?? 24),
      verifiedBy: row.verified_by ? String(row.verified_by) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  public getLinkedStudents(actor: UserAccount): GuardianStudentLink[] {
    if (actor.role === 'admin') {
      const rows = this.db
        .prepare(
          `SELECT gsl.*, g.name AS guardian_name, g.email AS guardian_email, g.whatsapp_number AS guardian_whatsapp,
                  s.name AS student_name, s.user_id_code AS student_user_id_code, s.grade AS student_grade,
                  s.current_level AS student_current_level
           FROM guardian_student_links gsl
           JOIN users g ON g.id = gsl.guardian_user_id
           JOIN users s ON s.id = gsl.student_user_id
           ORDER BY s.name ASC`
        )
        .all() as Record<string, unknown>[];
      return rows.map((r) => this.hydrateLinkRow(r));
    }

    if (actor.role === 'parent') {
      const rows = this.db
        .prepare(
          `SELECT gsl.*, g.name AS guardian_name, g.email AS guardian_email, g.whatsapp_number AS guardian_whatsapp,
                  s.name AS student_name, s.user_id_code AS student_user_id_code, s.grade AS student_grade,
                  s.current_level AS student_current_level
           FROM guardian_student_links gsl
           JOIN users g ON g.id = gsl.guardian_user_id
           JOIN users s ON s.id = gsl.student_user_id
           WHERE gsl.guardian_user_id = ?
           ORDER BY gsl.verified DESC, s.name ASC`
        )
        .all(actor.id) as Record<string, unknown>[];
      return rows.map((r) => this.hydrateLinkRow(r));
    }

    if (actor.role === 'student') {
      const rows = this.db
        .prepare(
          `SELECT gsl.*, g.name AS guardian_name, g.email AS guardian_email, g.whatsapp_number AS guardian_whatsapp,
                  s.name AS student_name, s.user_id_code AS student_user_id_code, s.grade AS student_grade,
                  s.current_level AS student_current_level
           FROM guardian_student_links gsl
           JOIN users g ON g.id = gsl.guardian_user_id
           JOIN users s ON s.id = gsl.student_user_id
           WHERE gsl.student_user_id = ?
           ORDER BY gsl.verified DESC`
        )
        .all(actor.id) as Record<string, unknown>[];
      return rows.map((r) => this.hydrateLinkRow(r));
    }

    throw new HttpError(403, 'Teachers access student progress via subject-scoped academic analytics.');
  }

  public getVerifiedLinksForStudent(studentId: string): GuardianStudentLink[] {
    const rows = this.db
      .prepare(
        `SELECT gsl.*, g.name AS guardian_name, g.email AS guardian_email, g.whatsapp_number AS guardian_whatsapp,
                s.name AS student_name, s.user_id_code AS student_user_id_code, s.grade AS student_grade,
                s.current_level AS student_current_level
         FROM guardian_student_links gsl
         JOIN users g ON g.id = gsl.guardian_user_id
         JOIN users s ON s.id = gsl.student_user_id
         WHERE gsl.student_user_id = ? AND gsl.verified = 1`
      )
      .all(studentId) as Record<string, unknown>[];
    return rows.map((r) => this.hydrateLinkRow(r));
  }

  public getVerifiedLink(guardianUserId: string, studentId: string): GuardianStudentLink | null {
    const row = this.db
      .prepare(
        `SELECT gsl.*, g.name AS guardian_name, g.email AS guardian_email, g.whatsapp_number AS guardian_whatsapp,
                s.name AS student_name, s.user_id_code AS student_user_id_code, s.grade AS student_grade,
                s.current_level AS student_current_level
         FROM guardian_student_links gsl
         JOIN users g ON g.id = gsl.guardian_user_id
         JOIN users s ON s.id = gsl.student_user_id
         WHERE gsl.guardian_user_id = ? AND gsl.student_user_id = ? AND gsl.verified = 1`
      )
      .get(guardianUserId, studentId) as Record<string, unknown> | undefined;
    return row ? this.hydrateLinkRow(row) : null;
  }

  public assertCanViewStudentReports(actor: UserAccount, studentId: string): GuardianStudentLink | null {
    if (actor.role === 'admin') return null;
    if (actor.role === 'student') {
      if (actor.id !== studentId) {
        throw new HttpError(403, 'Access denied: you may only view your own learning reports.');
      }
      return null;
    }
    if (actor.role === 'parent') {
      const link = this.getVerifiedLink(actor.id, studentId);
      if (!link || !link.canViewReports) {
        throw new HttpError(
          403,
          'Access denied: report viewing requires a verified guardian link with report permissions enabled.'
        );
      }
      return link;
    }
    throw new HttpError(403, 'Access denied for this role on guardian reports.');
  }

  public assertCanManageStudentSchedule(
    actor: UserAccount,
    studentId: string
  ): { allowed: boolean; link: GuardianStudentLink | null; isStudentSelfEdit: boolean } {
    if (actor.role === 'admin') {
      return { allowed: true, link: null, isStudentSelfEdit: false };
    }
    if (actor.role === 'parent') {
      const link = this.getVerifiedLink(actor.id, studentId);
      if (!link || !link.canManageSchedule) {
        throw new HttpError(
          403,
          'Access denied: only verified guardians with schedule permissions may manage this student timetable.'
        );
      }
      return { allowed: true, link, isStudentSelfEdit: false };
    }
    if (actor.role === 'student') {
      if (actor.id !== studentId) {
        throw new HttpError(403, 'Access denied: cannot modify another student schedule.');
      }
      const links = this.getVerifiedLinksForStudent(studentId);
      const allowingLink = links.find((l) => l.studentCanEditSchedule);
      if (!allowingLink) {
        throw new HttpError(
          403,
          'Your parent/guardian has locked schedule editing. Ask your guardian to enable student schedule editing if needed.'
        );
      }
      return { allowed: true, link: allowingLink, isStudentSelfEdit: true };
    }
    throw new HttpError(403, 'Teachers publish preset plans rather than editing private student schedules.');
  }

  public createOrVerifyGuardianLink(
    actor: UserAccount,
    payload: {
      guardianUserId: string;
      studentUserId: string;
      relationshipLabel?: string;
      verified?: boolean;
      consentGiven?: boolean;
      canViewReports?: boolean;
      canManageSchedule?: boolean;
      canReceiveNotifications?: boolean;
      studentCanEditSchedule?: boolean;
      studentDailyMaxMinutes?: number;
      studentRescheduleWindowHours?: number;
    }
  ): GuardianStudentLink {
    if (actor.role !== 'admin') {
      throw new HttpError(
        403,
        'Only administrators may establish or verify guardian-to-student account links.'
      );
    }

    const guardian = this.academicService.getUserById(payload.guardianUserId);
    const student = this.academicService.getUserById(payload.studentUserId);
    if (!guardian || guardian.role !== 'parent') {
      throw new HttpError(400, 'Selected guardian account does not exist or is not a parent account.');
    }
    if (!student || student.role !== 'student') {
      throw new HttpError(400, 'Selected student account does not exist or is not a student account.');
    }

    const now = new Date().toISOString();
    const verified = payload.verified !== false ? 1 : 0;
    const consent = payload.consentGiven !== false ? 1 : 0;
    const canView = payload.canViewReports !== false ? 1 : 0;
    const canSched = payload.canManageSchedule !== false ? 1 : 0;
    const canNotif = payload.canReceiveNotifications !== false ? 1 : 0;
    const stuEdit = payload.studentCanEditSchedule ? 1 : 0;
    const maxMins = Math.min(240, Math.max(15, Number(payload.studentDailyMaxMinutes ?? 90)));
    const winHrs = Math.min(168, Math.max(1, Number(payload.studentRescheduleWindowHours ?? 24)));

    const existing = this.db
      .prepare(
        'SELECT id FROM guardian_student_links WHERE guardian_user_id = ? AND student_user_id = ?'
      )
      .get(guardian.id, student.id) as { id: string } | undefined;

    const id = existing?.id || `GSL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    if (existing) {
      this.db
        .prepare(
          `UPDATE guardian_student_links SET
            relationship_label = ?, verified = ?, consent_given = ?, can_view_reports = ?,
            can_manage_schedule = ?, can_receive_notifications = ?, student_can_edit_schedule = ?,
            student_daily_max_minutes = ?, student_reschedule_window_hours = ?, verified_by = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          String(payload.relationshipLabel || 'Parent / Guardian').trim(),
          verified,
          consent,
          canView,
          canSched,
          canNotif,
          stuEdit,
          maxMins,
          winHrs,
          verified ? actor.id : null,
          now,
          id
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO guardian_student_links (
            id, guardian_user_id, student_user_id, relationship_label, verified, consent_given,
            can_view_reports, can_manage_schedule, can_receive_notifications,
            student_can_edit_schedule, student_daily_max_minutes, student_reschedule_window_hours,
            verified_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          guardian.id,
          student.id,
          String(payload.relationshipLabel || 'Parent / Guardian').trim(),
          verified,
          consent,
          canView,
          canSched,
          canNotif,
          stuEdit,
          maxMins,
          winHrs,
          verified ? actor.id : null,
          now,
          now
        );
    }

    // Ensure default reminder preference exists for this guardian + student pair
    this.db
      .prepare(
        `INSERT OR IGNORE INTO reminder_preferences (user_id, student_id, lead_times_json, channels_json, daily_digest_enabled, updated_at)
         VALUES (?, ?, '[1440,60,15]', '{"inApp":true,"email":true,"whatsapp":true}', 1, ?)`
      )
      .run(guardian.id, student.id, now);

    this.academicService.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'GUARDIAN_STUDENT_LINK_UPSERTED',
      targetType: 'guardian_student_link',
      targetId: id,
      details: { guardianUserId: guardian.id, studentUserId: student.id, verified: Boolean(verified) },
    });

    const row = this.db
      .prepare(
        `SELECT gsl.*, g.name AS guardian_name, g.email AS guardian_email, g.whatsapp_number AS guardian_whatsapp,
                s.name AS student_name, s.user_id_code AS student_user_id_code, s.grade AS student_grade,
                s.current_level AS student_current_level
         FROM guardian_student_links gsl
         JOIN users g ON g.id = gsl.guardian_user_id
         JOIN users s ON s.id = gsl.student_user_id
         WHERE gsl.id = ?`
      )
      .get(id) as Record<string, unknown>;
    return this.hydrateLinkRow(row);
  }

  public updateGuardianLinkPermissions(
    actor: UserAccount,
    linkId: string,
    patch: {
      relationshipLabel?: string;
      verified?: boolean;
      consentGiven?: boolean;
      canViewReports?: boolean;
      canManageSchedule?: boolean;
      canReceiveNotifications?: boolean;
      studentCanEditSchedule?: boolean;
      studentDailyMaxMinutes?: number;
      studentRescheduleWindowHours?: number;
    }
  ): GuardianStudentLink {
    const existingRow = this.db
      .prepare('SELECT * FROM guardian_student_links WHERE id = ?')
      .get(linkId) as Record<string, unknown> | undefined;
    if (!existingRow) {
      throw new HttpError(404, 'Guardian-student link not found.');
    }
    const existing = this.hydrateLinkRow(existingRow);

    if (actor.role !== 'admin') {
      if (actor.role !== 'parent' || existing.guardianUserId !== actor.id || !existing.verified) {
        throw new HttpError(
          403,
          'Access denied: only administrators or the verified guardian on this link can modify permissions.'
        );
      }
      if (typeof patch.verified === 'boolean' && patch.verified !== existing.verified) {
        throw new HttpError(403, 'Only administrators can change guardian link verification status.');
      }
    }

    const now = new Date().toISOString();
    const verified =
      actor.role === 'admin' && typeof patch.verified === 'boolean' ? patch.verified : existing.verified;
    const consent =
      typeof patch.consentGiven === 'boolean' ? patch.consentGiven : existing.consentGiven;
    const canView =
      typeof patch.canViewReports === 'boolean' ? patch.canViewReports : existing.canViewReports;
    const canSched =
      typeof patch.canManageSchedule === 'boolean' ? patch.canManageSchedule : existing.canManageSchedule;
    const canNotif =
      typeof patch.canReceiveNotifications === 'boolean'
        ? patch.canReceiveNotifications
        : existing.canReceiveNotifications;
    const stuEdit =
      typeof patch.studentCanEditSchedule === 'boolean'
        ? patch.studentCanEditSchedule
        : existing.studentCanEditSchedule;
    const maxMins =
      patch.studentDailyMaxMinutes !== undefined
        ? Math.min(240, Math.max(15, Number(patch.studentDailyMaxMinutes)))
        : existing.studentDailyMaxMinutes;
    const winHrs =
      patch.studentRescheduleWindowHours !== undefined
        ? Math.min(168, Math.max(1, Number(patch.studentRescheduleWindowHours)))
        : existing.studentRescheduleWindowHours;

    this.db
      .prepare(
        `UPDATE guardian_student_links SET
          relationship_label = ?, verified = ?, consent_given = ?, can_view_reports = ?,
          can_manage_schedule = ?, can_receive_notifications = ?, student_can_edit_schedule = ?,
          student_daily_max_minutes = ?, student_reschedule_window_hours = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.relationshipLabel ? String(patch.relationshipLabel).trim() : existing.relationshipLabel,
        verified ? 1 : 0,
        consent ? 1 : 0,
        canView ? 1 : 0,
        canSched ? 1 : 0,
        canNotif ? 1 : 0,
        stuEdit ? 1 : 0,
        maxMins,
        winHrs,
        now,
        linkId
      );

    this.academicService.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'GUARDIAN_LINK_PERMISSIONS_UPDATED',
      targetType: 'guardian_student_link',
      targetId: linkId,
      details: { patch },
    });

    const row = this.db
      .prepare(
        `SELECT gsl.*, g.name AS guardian_name, g.email AS guardian_email, g.whatsapp_number AS guardian_whatsapp,
                s.name AS student_name, s.user_id_code AS student_user_id_code, s.grade AS student_grade,
                s.current_level AS student_current_level
         FROM guardian_student_links gsl
         JOIN users g ON g.id = gsl.guardian_user_id
         JOIN users s ON s.id = gsl.student_user_id
         WHERE gsl.id = ?`
      )
      .get(linkId) as Record<string, unknown>;
    return this.hydrateLinkRow(row);
  }

  public listGuardianAccounts(): { id: string; name: string; email: string; userIdCode: string }[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, email, user_id_code FROM users WHERE role = 'parent' AND active = 1 ORDER BY name ASC`
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      email: String(r.email),
      userIdCode: String(r.user_id_code),
    }));
  }

  // =========================================================================
  // 2. TEACHING GUIDANCE & COMPLETE QUESTION-LEVEL PARENT REPORTS
  // =========================================================================

  private getStoredTeachingGuide(questionId: string): Partial<ParentTeachingGuidance> | null {
    const row = this.db
      .prepare('SELECT * FROM question_teaching_guides WHERE question_id = ?')
      .get(questionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      questionId: String(row.question_id),
      learningObjective: String(row.learning_objective || ''),
      whatItTests: String(row.what_it_tests),
      correctSolutionSteps: parseJsonSafe<string[]>(row.correct_solution_steps_json, []),
      plausibleErrorReasons: parseJsonSafe<string[]>(row.plausible_error_reasons_json, []),
      teachingMethod: String(row.teaching_method),
      practicalExamples: parseJsonSafe<string[]>(row.practical_examples_json, []),
      questionsToAskChild: parseJsonSafe<string[]>(row.questions_to_ask_json, []),
      commonMistakesToAvoid: parseJsonSafe<string[]>(row.common_mistakes_to_avoid_json, []),
      followupPracticeSuggestion: String(row.followup_practice_suggestion),
      teacherHelpIndicators: parseJsonSafe<string[]>(row.teacher_help_indicators_json, []),
      shortCorrectNote: String(row.short_correct_note),
      sourceType: String(row.source_type || 'educator_approved') as ParentTeachingGuidance['sourceType'],
      approvedByName: row.approved_by_name ? String(row.approved_by_name) : null,
    };
  }

  private getCurriculumLookupMaps() {
    const subjRows = this.db.prepare('SELECT id, name_en FROM subjects').all() as {
      id: string;
      name_en: string;
    }[];
    const topicRows = this.db.prepare('SELECT id, name_en FROM topics').all() as {
      id: string;
      name_en: string;
    }[];
    const subtopicRows = this.db.prepare('SELECT id, name_en FROM subtopics').all() as {
      id: string;
      name_en: string;
    }[];
    return {
      subjects: new Map(subjRows.map((s) => [s.id, s.name_en])),
      topics: new Map(topicRows.map((t) => [t.id, t.name_en])),
      subtopics: new Map(subtopicRows.map((st) => [st.id, st.name_en])),
    };
  }

  private findRelatedPublishedResources(subjectId: string, topicId: string) {
    const rows = this.db
      .prepare(
        `SELECT id, title, knowledge_type, summary, subject_id, topic_id
         FROM knowledge_publications
         WHERE status = 'PUBLISHED' AND (subject_id = ? OR topic_id = ?)
         ORDER BY CASE WHEN topic_id = ? THEN 0 ELSE 1 END, published_at DESC
         LIMIT 3`
      )
      .all(subjectId, topicId, topicId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      knowledgeType: String(r.knowledge_type) as ParentReportQuestionItem['relatedResources'][number]['knowledgeType'],
      summary: String(r.summary),
      subjectId: String(r.subject_id),
    }));
  }

  private buildSummaryAndImprovements(params: {
    studentName: string;
    assessmentTitle: string;
    finalizationStatus: 'pending_manual_marking' | 'finalized';
    correctCount: number;
    incorrectCount: number;
    partialCount: number;
    unansweredCount: number;
    pendingCount: number;
    scorePercent: number | null;
    items: ParentReportQuestionItem[];
  }) {
    const topicAgg = new Map<
      string,
      { subjectId: string; subjectName: string; topicName: string; correct: number; total: number }
    >();
    for (const item of params.items) {
      const key = `${item.subjectId}::${item.topicName}`;
      const cur = topicAgg.get(key) || {
        subjectId: item.subjectId,
        subjectName: item.subjectName,
        topicName: item.topicName,
        correct: 0,
        total: 0,
      };
      cur.total += 1;
      if (item.correctnessStatus === 'correct') cur.correct += 1;
      topicAgg.set(key, cur);
    }

    const mainImprovementAreas = Array.from(topicAgg.values())
      .map((t) => ({
        subjectId: t.subjectId,
        subjectName: t.subjectName,
        topicName: t.topicName,
        accuracyPercent: t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0,
        recommendedAction:
          t.correct === t.total
            ? `Maintain momentum in ${t.topicName} with occasional short recall checks.`
            : `Review ${t.topicName} calmly together using the step-by-step teaching guide and schedule a short follow-up practice.`,
      }))
      .filter((t) => t.accuracyPercent < 80)
      .sort((a, b) => a.accuracyPercent - b.accuracyPercent)
      .slice(0, 4);

    const parentSummary =
      params.finalizationStatus === 'pending_manual_marking'
        ? `${params.studentName} submitted "${params.assessmentTitle}". Auto-marked items scored ${params.correctCount}/${params.items.length - params.pendingCount} so far, while ${params.pendingCount} open-ended question(s) are awaiting teacher marking.`
        : `${params.studentName} completed "${params.assessmentTitle}" with ${params.scorePercent ?? 0}% (${params.correctCount} correct, ${params.partialCount} partial, ${params.incorrectCount} incorrect, ${params.unansweredCount} unanswered across ${params.items.length} questions).`;

    const encouragementNote =
      (params.scorePercent ?? 0) >= 80
        ? `Celebrate ${params.studentName}'s careful effort and strong understanding! Asking them to explain one favorite question builds lasting confidence.`
        : mainImprovementAreas.length > 0
        ? `Steady daily progress beats rushing. Focus gently on ${mainImprovementAreas[0].topicName} using one practical household example before scheduling the next round.`
        : `Praise ${params.studentName} for completing the session carefully and staying consistent with their study plan.`;

    const recResourcesMap = new Map<
      string,
      { id: string; title: string; subjectName: string; summary: string }
    >();
    for (const item of params.items) {
      if (item.correctnessStatus !== 'correct') {
        for (const res of item.relatedResources) {
          recResourcesMap.set(res.id, {
            id: res.id,
            title: res.title,
            subjectName: item.subjectName,
            summary: res.summary,
          });
        }
      }
    }

    return {
      parentSummary,
      encouragementNote,
      mainImprovementAreas,
      recommendedResources: Array.from(recResourcesMap.values()).slice(0, 4),
    };
  }

  public async generateReportForAssessmentAttempt(
    attemptId: string,
    options: { sendCompletionNoticeIfPending?: boolean; useAiAdaptation?: boolean } = {}
  ): Promise<ParentAssessmentReport | null> {
    const attemptRow = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE id = ?')
      .get(attemptId) as Record<string, unknown> | undefined;
    if (!attemptRow) return null;

    const status = String(attemptRow.status);
    if (status === 'in_progress') return null;

    const student = this.academicService.getUserById(String(attemptRow.student_id));
    if (!student) return null;

    const asmRow = this.db
      .prepare('SELECT * FROM assessments WHERE id = ?')
      .get(String(attemptRow.assessment_id)) as Record<string, unknown> | undefined;
    if (!asmRow) return null;

    const assessmentId = String(asmRow.id);
    const assessmentTitle = String(asmRow.title);
    const assessmentKind =
      String(asmRow.kind) === 'mock_exam' ? 'mock_exam' : 'practice_session';
    const asmVersion = Number(attemptRow.assessment_version ?? 1);

    const snapshotRows = this.db
      .prepare(
        `SELECT * FROM assessment_question_snapshots
         WHERE assessment_id = ? AND version_number = ?
         ORDER BY sort_order ASC`
      )
      .all(assessmentId, asmVersion) as Record<string, unknown>[];

    const ansRows = this.db
      .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?')
      .all(attemptId) as Record<string, unknown>[];
    const ansBySnap = new Map(ansRows.map((a) => [String(a.snapshot_id), a]));
    const shuffledOptionsMap = parseJsonSafe<Record<string, number[]>>(
      attemptRow.shuffled_options_map_json,
      {}
    );

    const lookups = this.getCurriculumLookupMaps();
    const items: ParentReportQuestionItem[] = [];
    let correctCount = 0;
    let incorrectCount = 0;
    let partialCount = 0;
    let unansweredCount = 0;
    let pendingCount = 0;

    for (const sRow of snapshotRows) {
      const snapId = String(sRow.id);
      const snapshot = parseJsonSafe<QuizItem>(sRow.snapshot_json, null as unknown as QuizItem);
      if (!snapshot) continue;

      const ansRow = ansBySnap.get(snapId);
      const maxMarks = Number(sRow.marks ?? snapshot.defaultMarks ?? 1);
      const awardedMarks = Number(ansRow?.awarded_marks ?? 0);
      const markingStatus = String(ansRow?.marking_status || 'auto_graded');
      const submittedDisplayIdx =
        ansRow?.submitted_option_index !== null && ansRow?.submitted_option_index !== undefined
          ? Number(ansRow.submitted_option_index)
          : null;
      const mapping = shuffledOptionsMap[snapId];
      const submittedOrigIdx =
        submittedDisplayIdx !== null && mapping && submittedDisplayIdx < mapping.length
          ? mapping[submittedDisplayIdx]
          : submittedDisplayIdx;
      const submittedText = ansRow?.submitted_answer_text ? String(ansRow.submitted_answer_text) : null;

      const hasSubmission =
        submittedOrigIdx !== null || (submittedText !== null && submittedText.trim().length > 0);

      let correctnessStatus: ReportCorrectnessStatus = 'unanswered';
      if (markingStatus === 'pending_manual') {
        correctnessStatus = 'pending_manual';
        pendingCount++;
      } else if (!hasSubmission) {
        correctnessStatus = 'unanswered';
        unansweredCount++;
      } else if (awardedMarks >= maxMarks && maxMarks > 0) {
        correctnessStatus = 'correct';
        correctCount++;
      } else if (awardedMarks > 0 && awardedMarks < maxMarks) {
        correctnessStatus = 'partially_correct';
        partialCount++;
      } else if (ansRow?.is_correct === 1) {
        correctnessStatus = 'correct';
        correctCount++;
      } else {
        correctnessStatus = 'incorrect';
        incorrectCount++;
      }

      const subjId = resolveQuestionSubjectId(snapshot);
      const subjName = lookups.subjects.get(subjId) || snapshot.attributes.cognitiveDomain;
      const topicName = lookups.topics.get(snapshot.topicId || '') || 'Core Concept';
      const subtopicName = lookups.subtopics.get(snapshot.subtopicId || '') || 'Skill Application';

      const studentAnswerDisplay =
        submittedText && submittedText.trim()
          ? submittedText.trim()
          : submittedOrigIdx !== null && snapshot.options[submittedOrigIdx]
          ? snapshot.options[submittedOrigIdx]
          : 'Unanswered (no response submitted)';

      const correctAnswerDisplay =
        snapshot.questionType === 'short_answer' || snapshot.questionType === 'numerical'
          ? (snapshot.acceptedAnswers?.length
              ? snapshot.acceptedAnswers.join(' / ')
              : snapshot.options[snapshot.correctIndex] || 'See marking criteria')
          : snapshot.options[snapshot.correctIndex] || snapshot.acceptedAnswers?.[0] || 'See explanation';

      const storedGuide = this.getStoredTeachingGuide(snapshot.id);
      let teachingGuidance = buildStructuredTeachingGuide({
        question: snapshot,
        subjectName: subjName,
        topicName,
        submittedOptionIndex: submittedOrigIdx,
        storedGuide,
      });

      if (
        options.useAiAdaptation &&
        correctnessStatus !== 'correct' &&
        !storedGuide
      ) {
        teachingGuidance = await adaptParentTeachingGuideWithAi({
          question: snapshot,
          subjectName: subjName,
          topicName,
          studentAnswerDisplay,
          baseGuide: teachingGuidance,
        });
      }

      const relatedResources = this.findRelatedPublishedResources(subjId, snapshot.topicId || '');
      const markingCriteria =
        snapshot.markingRule?.markingNotes ||
        `${maxMarks} mark(s) for accurate ${snapshot.questionType || 'mcq'} answer.${
          snapshot.markingRule?.numericTolerance !== undefined
            ? ` Numeric tolerance: ±${snapshot.markingRule.numericTolerance}.`
            : ''
        }`;

      items.push({
        snapshotId: snapId,
        questionId: snapshot.id,
        questionVersion: Number(sRow.question_version ?? snapshot.version ?? 1),
        subjectId: subjId,
        subjectName: subjName,
        topicId: snapshot.topicId || '',
        topicName,
        subtopicId: snapshot.subtopicId || '',
        subtopicName,
        questionType: snapshot.questionType || 'mcq',
        difficulty: snapshot.attributes.difficultyTier,
        learningObjective: teachingGuidance.learningObjective,
        questionSi: snapshot.questionSi,
        questionEn: snapshot.questionEn,
        imageUrl: snapshot.imageUrl,
        options: snapshot.options,
        studentAnswerDisplay,
        submittedOptionIndex: submittedOrigIdx,
        submittedAnswerText: submittedText,
        correctAnswerDisplay,
        correctIndex: snapshot.correctIndex,
        markingCriteria,
        correctnessStatus,
        awardedMarks,
        maxMarks,
        hint: snapshot.hint || snapshot.memoryTrickBody,
        stepByStepExplanation: snapshot.explanation,
        memoryTrickTitle: snapshot.memoryTrickTitle,
        memoryTrickBody: snapshot.memoryTrickBody,
        graderComment: ansRow?.grader_comment ? String(ansRow.grader_comment) : null,
        teachingGuidance,
        suggestedFollowupActivities: [
          teachingGuidance.followupPracticeSuggestion,
          ...relatedResources.map((r) => `Read guide: ${r.title}`),
        ].slice(0, 3),
        relatedResources: relatedResources.map((r) => ({
          id: r.id,
          title: r.title,
          knowledgeType: r.knowledgeType,
          summary: r.summary,
        })),
      });
    }

    const finalizationStatus: ParentAssessmentReport['finalizationStatus'] =
      status === 'pending_manual_marking' || pendingCount > 0
        ? 'pending_manual_marking'
        : 'finalized';

    const awardedMarks = Number(attemptRow.total_awarded_marks ?? 0);
    const maxMarks = Number(attemptRow.max_marks ?? items.reduce((a, b) => a + b.maxMarks, 0));
    const scorePercent =
      finalizationStatus === 'finalized'
        ? attemptRow.score_percent !== null && attemptRow.score_percent !== undefined
          ? Number(attemptRow.score_percent)
          : maxMarks > 0
          ? Math.round((awardedMarks / maxMarks) * 100)
          : 0
        : null;

    const { parentSummary, encouragementNote, mainImprovementAreas, recommendedResources } =
      this.buildSummaryAndImprovements({
        studentName: student.name,
        assessmentTitle,
        finalizationStatus,
        correctCount,
        incorrectCount,
        partialCount,
        unansweredCount,
        pendingCount,
        scorePercent,
        items,
      });

    const report = this.upsertAndSaveParentReport({
      student,
      attemptId,
      attemptSource: 'assessment_attempt',
      assessmentId,
      assessmentTitle,
      assessmentKind,
      finalizationStatus,
      totalQuestions: items.length,
      correctCount,
      incorrectCount,
      partialCount,
      unansweredCount,
      pendingCount,
      awardedMarks,
      maxMarks,
      scorePercent,
      timeSpentSeconds: Number(attemptRow.server_duration_seconds ?? 0),
      parentSummary,
      encouragementNote,
      mainImprovementAreas,
      items,
      recommendedResources,
    });

    if (finalizationStatus === 'finalized') {
      this.dispatchReportNotifications(report, 'final_report');
    } else if (options.sendCompletionNoticeIfPending) {
      this.dispatchReportNotifications(report, 'completion_notice');
    }

    return report;
  }

  public async createReportForRoundAttempt(params: {
    student: UserAccount;
    attempt: AttemptRecord;
    items: { quizId: string; selectedIndex: number | null; isCorrect: boolean; hintsUsed?: boolean }[];
    assessmentKind: 'practice_session' | 'mock_exam';
    sendNotifications?: boolean;
    useAiAdaptation?: boolean;
  }): Promise<ParentAssessmentReport> {
    const lookups = this.getCurriculumLookupMaps();
    const reportItems: ParentReportQuestionItem[] = [];
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;

    for (let i = 0; i < params.items.length; i++) {
      const entry = params.items[i];
      const q = this.academicService.resolveQuizById(entry.quizId);
      if (!q) continue;

      const isUnanswered = entry.selectedIndex === null || entry.selectedIndex === undefined;
      const correctnessStatus: ReportCorrectnessStatus = isUnanswered
        ? 'unanswered'
        : entry.isCorrect
        ? 'correct'
        : 'incorrect';
      if (correctnessStatus === 'correct') correctCount++;
      else if (correctnessStatus === 'unanswered') unansweredCount++;
      else incorrectCount++;

      const subjId = resolveQuestionSubjectId(q);
      const subjName = lookups.subjects.get(subjId) || q.attributes.cognitiveDomain;
      const topicName = lookups.topics.get(q.topicId || '') || 'Core Concept';
      const subtopicName = lookups.subtopics.get(q.subtopicId || '') || 'Skill Application';
      const maxMarks = q.defaultMarks || 1;
      const awardedMarks = entry.isCorrect ? maxMarks : 0;

      const studentAnswerDisplay =
        !isUnanswered && q.options[entry.selectedIndex!]
          ? q.options[entry.selectedIndex!]
          : 'Unanswered (no option selected)';
      const correctAnswerDisplay = q.options[q.correctIndex] || 'See explanation';

      const storedGuide = this.getStoredTeachingGuide(q.id);
      let teachingGuidance = buildStructuredTeachingGuide({
        question: q,
        subjectName: subjName,
        topicName,
        submittedOptionIndex: entry.selectedIndex,
        storedGuide,
      });

      if (params.useAiAdaptation && correctnessStatus !== 'correct' && !storedGuide) {
        teachingGuidance = await adaptParentTeachingGuideWithAi({
          question: q,
          subjectName: subjName,
          topicName,
          studentAnswerDisplay,
          baseGuide: teachingGuidance,
        });
      }

      const relatedResources = this.findRelatedPublishedResources(subjId, q.topicId || '');

      reportItems.push({
        snapshotId: `RND-${params.attempt.id}-${i + 1}`,
        questionId: q.id,
        questionVersion: q.version || 1,
        subjectId: subjId,
        subjectName: subjName,
        topicId: q.topicId || '',
        topicName,
        subtopicId: q.subtopicId || '',
        subtopicName,
        questionType: q.questionType || 'mcq',
        difficulty: q.attributes.difficultyTier,
        learningObjective: teachingGuidance.learningObjective,
        questionSi: q.questionSi,
        questionEn: q.questionEn,
        imageUrl: q.imageUrl,
        options: q.options,
        studentAnswerDisplay,
        submittedOptionIndex: entry.selectedIndex,
        submittedAnswerText: null,
        correctAnswerDisplay,
        correctIndex: q.correctIndex,
        markingCriteria: q.markingRule?.markingNotes || `${maxMarks} mark(s) for accurate selection.`,
        correctnessStatus,
        awardedMarks,
        maxMarks,
        hint: q.hint || q.memoryTrickBody,
        stepByStepExplanation: q.explanation,
        memoryTrickTitle: q.memoryTrickTitle,
        memoryTrickBody: q.memoryTrickBody,
        graderComment: null,
        teachingGuidance,
        suggestedFollowupActivities: [
          teachingGuidance.followupPracticeSuggestion,
          ...relatedResources.map((r) => `Read guide: ${r.title}`),
        ].slice(0, 3),
        relatedResources: relatedResources.map((r) => ({
          id: r.id,
          title: r.title,
          knowledgeType: r.knowledgeType,
          summary: r.summary,
        })),
      });
    }

    const totalMarks = reportItems.reduce((a, b) => a + b.maxMarks, 0);
    const awardedMarks = reportItems.reduce((a, b) => a + b.awardedMarks, 0);
    const scorePercent =
      totalMarks > 0 ? Math.round((awardedMarks / totalMarks) * 100) : params.attempt.scorePercent;

    const { parentSummary, encouragementNote, mainImprovementAreas, recommendedResources } =
      this.buildSummaryAndImprovements({
        studentName: params.student.name,
        assessmentTitle: params.attempt.paperTitle,
        finalizationStatus: 'finalized',
        correctCount,
        incorrectCount,
        partialCount: 0,
        unansweredCount,
        pendingCount: 0,
        scorePercent,
        items: reportItems,
      });

    const report = this.upsertAndSaveParentReport({
      student: params.student,
      attemptId: params.attempt.id,
      attemptSource: 'round_attempt',
      assessmentId: params.attempt.paperId,
      assessmentTitle: params.attempt.paperTitle,
      assessmentKind: params.assessmentKind,
      finalizationStatus: 'finalized',
      totalQuestions: reportItems.length || params.attempt.totalQuestions,
      correctCount,
      incorrectCount,
      partialCount: 0,
      unansweredCount,
      pendingCount: 0,
      awardedMarks,
      maxMarks: totalMarks || params.attempt.totalQuestions,
      scorePercent,
      timeSpentSeconds: params.attempt.timeSpentSeconds,
      parentSummary,
      encouragementNote,
      mainImprovementAreas,
      items: reportItems,
      recommendedResources,
    });

    if (params.sendNotifications !== false) {
      this.dispatchReportNotifications(report, 'final_report');
    }

    return report;
  }

  private upsertAndSaveParentReport(input: {
    student: UserAccount;
    attemptId: string;
    attemptSource: 'assessment_attempt' | 'round_attempt';
    assessmentId: string;
    assessmentTitle: string;
    assessmentKind: 'practice_session' | 'mock_exam';
    finalizationStatus: 'pending_manual_marking' | 'finalized';
    totalQuestions: number;
    correctCount: number;
    incorrectCount: number;
    partialCount: number;
    unansweredCount: number;
    pendingCount: number;
    awardedMarks: number;
    maxMarks: number;
    scorePercent: number | null;
    timeSpentSeconds: number;
    parentSummary: string;
    encouragementNote: string;
    mainImprovementAreas: ParentAssessmentReport['mainImprovementAreas'];
    items: ParentReportQuestionItem[];
    recommendedResources: ParentAssessmentReport['recommendedResources'];
  }): ParentAssessmentReport {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT id, generated_at FROM parent_assessment_reports WHERE attempt_source = ? AND attempt_id = ?')
      .get(input.attemptSource, input.attemptId) as
      | { id: string; generated_at: string }
      | undefined;

    const id = existing?.id || `PAR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const generatedAt = existing?.generated_at || now;
    const finalizedAt = input.finalizationStatus === 'finalized' ? now : null;
    const secureReportPath = `/?tab=progress&reportId=${encodeURIComponent(id)}&studentId=${encodeURIComponent(input.student.id)}`;

    if (existing) {
      this.db
        .prepare(
          `UPDATE parent_assessment_reports SET
            finalization_status = ?, total_questions = ?, correct_count = ?, incorrect_count = ?,
            partial_count = ?, unanswered_count = ?, pending_count = ?, awarded_marks = ?, max_marks = ?,
            score_percent = ?, time_spent_seconds = ?, parent_summary = ?, encouragement_note = ?,
            main_improvement_areas_json = ?, items_json = ?, recommended_resources_json = ?,
            finalized_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.finalizationStatus,
          input.totalQuestions,
          input.correctCount,
          input.incorrectCount,
          input.partialCount,
          input.unansweredCount,
          input.pendingCount,
          input.awardedMarks,
          input.maxMarks,
          input.scorePercent,
          input.timeSpentSeconds,
          input.parentSummary,
          input.encouragementNote,
          JSON.stringify(input.mainImprovementAreas),
          JSON.stringify(input.items),
          JSON.stringify(input.recommendedResources),
          finalizedAt,
          now,
          id
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO parent_assessment_reports (
            id, student_id, student_name, student_user_id_code, attempt_id, attempt_source,
            assessment_id, assessment_title, assessment_kind, finalization_status,
            total_questions, correct_count, incorrect_count, partial_count, unanswered_count,
            pending_count, awarded_marks, max_marks, score_percent, time_spent_seconds,
            parent_summary, encouragement_note, main_improvement_areas_json, items_json,
            recommended_resources_json, secure_report_path, generated_at, finalized_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.student.id,
          input.student.name,
          input.student.userIdCode,
          input.attemptId,
          input.attemptSource,
          input.assessmentId,
          input.assessmentTitle,
          input.assessmentKind,
          input.finalizationStatus,
          input.totalQuestions,
          input.correctCount,
          input.incorrectCount,
          input.partialCount,
          input.unansweredCount,
          input.pendingCount,
          input.awardedMarks,
          input.maxMarks,
          input.scorePercent,
          input.timeSpentSeconds,
          input.parentSummary,
          input.encouragementNote,
          JSON.stringify(input.mainImprovementAreas),
          JSON.stringify(input.items),
          JSON.stringify(input.recommendedResources),
          secureReportPath,
          generatedAt,
          finalizedAt,
          now
        );
    }

    const row = this.db
      .prepare('SELECT * FROM parent_assessment_reports WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return this.hydrateReportRow(row);
  }

  private hydrateReportRow(row: Record<string, unknown>): ParentAssessmentReport {
    return {
      id: String(row.id),
      studentId: String(row.student_id),
      studentName: String(row.student_name),
      studentUserIdCode: String(row.student_user_id_code),
      attemptId: String(row.attempt_id),
      attemptSource: String(row.attempt_source) as ParentAssessmentReport['attemptSource'],
      assessmentId: String(row.assessment_id),
      assessmentTitle: String(row.assessment_title),
      assessmentKind: String(row.assessment_kind) as ParentAssessmentReport['assessmentKind'],
      finalizationStatus: String(row.finalization_status) as ParentAssessmentReport['finalizationStatus'],
      totalQuestions: Number(row.total_questions),
      correctCount: Number(row.correct_count),
      incorrectCount: Number(row.incorrect_count),
      partialCount: Number(row.partial_count),
      unansweredCount: Number(row.unanswered_count),
      pendingCount: Number(row.pending_count),
      awardedMarks: Number(row.awarded_marks),
      maxMarks: Number(row.max_marks),
      scorePercent:
        row.score_percent === null || row.score_percent === undefined
          ? null
          : Number(row.score_percent),
      timeSpentSeconds: Number(row.time_spent_seconds),
      parentSummary: String(row.parent_summary),
      encouragementNote: String(row.encouragement_note),
      mainImprovementAreas: parseJsonSafe(row.main_improvement_areas_json, []),
      items: parseJsonSafe(row.items_json, []),
      recommendedResources: parseJsonSafe(row.recommended_resources_json, []),
      secureReportPath: String(row.secure_report_path),
      generatedAt: String(row.generated_at),
      finalizedAt: row.finalized_at ? String(row.finalized_at) : null,
      updatedAt: String(row.updated_at),
    };
  }

  public dispatchReportNotifications(
    report: ParentAssessmentReport,
    stage: 'completion_notice' | 'final_report',
    requestedChannels?: ('in_app' | 'email' | 'whatsapp')[]
  ): ReportDeliveryRecord[] {
    const links = this.getVerifiedLinksForStudent(report.studentId);
    const channels = requestedChannels?.length
      ? requestedChannels
      : (['in_app', 'email', 'whatsapp'] as const);
    const deliveries: ReportDeliveryRecord[] = [];
    const now = new Date().toISOString();

    for (const link of links) {
      const guardian = this.academicService.getUserById(link.guardianUserId);
      if (!guardian || !guardian.active) continue;
      if (!link.consentGiven || !link.canReceiveNotifications || !link.canViewReports) {
        for (const ch of channels) {
          deliveries.push(
            this.recordDeliveryRow({
              reportId: report.id,
              guardianUserId: guardian.id,
              guardianName: guardian.name,
              channel: ch,
              deliveryStage: stage,
              deliveryStatus: 'skipped_preference',
              errorMessage: 'Guardian notifications or consent disabled on link.',
              sentAt: now,
            })
          );
        }
        continue;
      }

      const prefs = guardian.notificationPreferences || {
        inApp: true,
        email: true,
        whatsapp: true,
        groupedSummary: false,
      };

      for (const ch of channels) {
        const dedupeKey = `rpt-${report.id}-${guardian.id}-${stage}-${ch}`;
        const already = this.db
          .prepare('SELECT * FROM report_deliveries WHERE dedupe_key = ?')
          .get(dedupeKey) as Record<string, unknown> | undefined;
        if (already) {
          deliveries.push(this.hydrateDeliveryRow(already));
          continue;
        }

        if (ch === 'in_app') {
          if (!prefs.inApp) {
            deliveries.push(
              this.recordDeliveryRow({
                reportId: report.id,
                guardianUserId: guardian.id,
                guardianName: guardian.name,
                channel: 'in_app',
                deliveryStage: stage,
                deliveryStatus: 'skipped_preference',
                sentAt: now,
              })
            );
            continue;
          }
          this.academicService.insertNotificationRow({
            recipientUserId: guardian.id,
            recipientRole: 'parent',
            channel: 'in_app',
            category: 'progress_report',
            title:
              stage === 'final_report'
                ? `Learning Report Ready: ${report.studentName} — ${report.assessmentTitle}`
                : `Completion Notice: ${report.studentName} submitted ${report.assessmentTitle}`,
            body: report.parentSummary,
            relatedStudentId: report.studentId,
            dedupeKey,
            deliveryStatus: 'delivered',
          });
          deliveries.push(
            this.recordDeliveryRow({
              reportId: report.id,
              guardianUserId: guardian.id,
              guardianName: guardian.name,
              channel: 'in_app',
              deliveryStage: stage,
              deliveryStatus: 'delivered',
              sentAt: now,
            })
          );
        } else if (ch === 'email') {
          if (!prefs.email) {
            deliveries.push(
              this.recordDeliveryRow({
                reportId: report.id,
                guardianUserId: guardian.id,
                guardianName: guardian.name,
                channel: 'email',
                deliveryStage: stage,
                deliveryStatus: 'skipped_preference',
                sentAt: now,
              })
            );
            continue;
          }
          if (!guardian.emailVerified || !guardian.email) {
            deliveries.push(
              this.recordDeliveryRow({
                reportId: report.id,
                guardianUserId: guardian.id,
                guardianName: guardian.name,
                channel: 'email',
                deliveryStage: stage,
                deliveryStatus: 'skipped_unverified',
                errorMessage: 'Guardian email not verified.',
                sentAt: now,
              })
            );
            continue;
          }
          const emailPayload = buildParentReportEmailHtml({
            guardianName: guardian.name,
            report,
          });
          this.academicService.recordEmailLog({
            toEmail: guardian.email,
            subject:
              stage === 'final_report'
                ? `Parent Learning Report: ${report.studentName} · ${report.assessmentTitle} · මං 5හේ`
                : `Submission Notice: ${report.studentName} · ${report.assessmentTitle} · මං 5හේ`,
            category: 'progress_report',
            htmlBody: emailPayload.html,
          });
          deliveries.push(
            this.recordDeliveryRow({
              reportId: report.id,
              guardianUserId: guardian.id,
              guardianName: guardian.name,
              channel: 'email',
              deliveryStage: stage,
              deliveryStatus: 'delivered',
              sentAt: now,
            })
          );
        } else if (ch === 'whatsapp') {
          if (!prefs.whatsapp) {
            deliveries.push(
              this.recordDeliveryRow({
                reportId: report.id,
                guardianUserId: guardian.id,
                guardianName: guardian.name,
                channel: 'whatsapp',
                deliveryStage: stage,
                deliveryStatus: 'skipped_preference',
                sentAt: now,
              })
            );
            continue;
          }
          if (guardian.whatsappVerified === false || !guardian.whatsappNumber) {
            deliveries.push(
              this.recordDeliveryRow({
                reportId: report.id,
                guardianUserId: guardian.id,
                guardianName: guardian.name,
                channel: 'whatsapp',
                deliveryStage: stage,
                deliveryStatus: 'skipped_unverified',
                errorMessage: 'Guardian WhatsApp number not verified.',
                sentAt: now,
              })
            );
            continue;
          }
          const waPayload = buildWhatsAppParentReportPayload({
            guardianName: guardian.name,
            report,
          });
          this.academicService.recordWhatsAppLog({
            toNumber: guardian.whatsappNumber,
            category: report.assessmentKind === 'mock_exam' ? 'exam_report' : 'milestone',
            messageText: `${waPayload.messageText}\n[Template: ${waPayload.templateName}]`,
          });
          deliveries.push(
            this.recordDeliveryRow({
              reportId: report.id,
              guardianUserId: guardian.id,
              guardianName: guardian.name,
              channel: 'whatsapp',
              deliveryStage: stage,
              deliveryStatus: 'delivered',
              sentAt: now,
            })
          );
        }
      }
    }

    return deliveries;
  }

  private recordDeliveryRow(params: {
    reportId: string;
    guardianUserId: string;
    guardianName: string;
    channel: 'in_app' | 'email' | 'whatsapp';
    deliveryStage: 'completion_notice' | 'final_report';
    deliveryStatus: ReportDeliveryRecord['deliveryStatus'];
    errorMessage?: string | null;
    sentAt: string;
  }): ReportDeliveryRecord {
    const dedupeKey = `rpt-${params.reportId}-${params.guardianUserId}-${params.deliveryStage}-${params.channel}`;
    const existing = this.db
      .prepare('SELECT * FROM report_deliveries WHERE dedupe_key = ?')
      .get(dedupeKey) as Record<string, unknown> | undefined;
    if (existing) return this.hydrateDeliveryRow(existing);

    const id = `RDLV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    this.db
      .prepare(
        `INSERT INTO report_deliveries (
          id, report_id, guardian_user_id, guardian_name, channel, delivery_stage,
          dedupe_key, delivery_status, error_message, sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.reportId,
        params.guardianUserId,
        params.guardianName,
        params.channel,
        params.deliveryStage,
        dedupeKey,
        params.deliveryStatus,
        params.errorMessage || null,
        params.sentAt
      );
    const row = this.db
      .prepare('SELECT * FROM report_deliveries WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return this.hydrateDeliveryRow(row);
  }

  private hydrateDeliveryRow(row: Record<string, unknown>): ReportDeliveryRecord {
    return {
      id: String(row.id),
      reportId: String(row.report_id),
      guardianUserId: String(row.guardian_user_id),
      guardianName: row.guardian_name ? String(row.guardian_name) : undefined,
      channel: String(row.channel) as ReportDeliveryRecord['channel'],
      deliveryStage: String(row.delivery_stage) as ReportDeliveryRecord['deliveryStage'],
      dedupeKey: String(row.dedupe_key),
      deliveryStatus: String(row.delivery_status) as ReportDeliveryRecord['deliveryStatus'],
      errorMessage: row.error_message ? String(row.error_message) : null,
      sentAt: String(row.sent_at),
    };
  }

  public listStudentReports(
    actor: UserAccount,
    studentId: string
  ): { reports: ParentAssessmentReport[]; deliveriesByReport: Record<string, ReportDeliveryRecord[]> } {
    this.assertCanViewStudentReports(actor, studentId);
    const rows = this.db
      .prepare(
        `SELECT * FROM parent_assessment_reports
         WHERE student_id = ?
         ORDER BY generated_at DESC
         LIMIT 50`
      )
      .all(studentId) as Record<string, unknown>[];

    const reports = rows.map((r) => this.hydrateReportRow(r));
    const deliveriesByReport: Record<string, ReportDeliveryRecord[]> = {};
    for (const rpt of reports) {
      const dRows = this.db
        .prepare('SELECT * FROM report_deliveries WHERE report_id = ? ORDER BY sent_at DESC')
        .all(rpt.id) as Record<string, unknown>[];
      deliveriesByReport[rpt.id] = dRows.map((d) => this.hydrateDeliveryRow(d));
    }

    return { reports, deliveriesByReport };
  }

  public getReportDetail(
    actor: UserAccount,
    reportId: string
  ): { report: ParentAssessmentReport; deliveries: ReportDeliveryRecord[] } {
    const row = this.db
      .prepare('SELECT * FROM parent_assessment_reports WHERE id = ?')
      .get(reportId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new HttpError(404, 'Parent assessment report not found.');
    }
    const report = this.hydrateReportRow(row);
    this.assertCanViewStudentReports(actor, report.studentId);

    const dRows = this.db
      .prepare('SELECT * FROM report_deliveries WHERE report_id = ? ORDER BY sent_at DESC')
      .all(report.id) as Record<string, unknown>[];
    return {
      report,
      deliveries: dRows.map((d) => this.hydrateDeliveryRow(d)),
    };
  }

  public exportReportHtml(actor: UserAccount, reportId: string): { filename: string; html: string } {
    const { report } = this.getReportDetail(actor, reportId);
    return {
      filename: `man5he-report-${report.studentUserIdCode}-${report.id}.html`,
      html: buildAccessibleReportHtmlDocument(report),
    };
  }

  public exportReportPdf(actor: UserAccount, reportId: string): { filename: string; pdf: Buffer } {
    const { report } = this.getReportDetail(actor, reportId);
    return {
      filename: `man5he-report-${report.studentUserIdCode}-${report.id}.pdf`,
      pdf: buildParentReportPdfBuffer(report),
    };
  }

  public resendReport(
    actor: UserAccount,
    reportId: string,
    channels?: ('in_app' | 'email' | 'whatsapp')[]
  ) {
    const { report } = this.getReportDetail(actor, reportId);
    if (actor.role !== 'admin' && actor.role !== 'parent') {
      throw new HttpError(403, 'Only linked guardians or administrators can dispatch parent reports.');
    }
    const stage =
      report.finalizationStatus === 'finalized' ? 'final_report' : 'completion_notice';
    const deliveries = this.dispatchReportNotifications(report, stage, channels);
    return { report, deliveries };
  }

  public getTeacherParentSupportInsights(actor: UserAccount) {
    if (actor.role !== 'teacher' && actor.role !== 'admin') {
      throw new HttpError(403, 'Teacher or Administrator access required.');
    }
    const ctx = this.academicService.buildAuthContext(actor);
    const allReports = (
      this.db
        .prepare('SELECT * FROM parent_assessment_reports ORDER BY generated_at DESC LIMIT 30')
        .all() as Record<string, unknown>[]
    ).map((r) => this.hydrateReportRow(r));

    const scopedSummaries = allReports
      .map((rpt) => {
        const scopedItems =
          actor.role === 'admin'
            ? rpt.items
            : rpt.items.filter((it) => canAccessSubject(ctx, it.subjectId));
        if (scopedItems.length === 0) return null;
        return {
          reportId: rpt.id,
          studentId: rpt.studentId,
          studentName: rpt.studentName,
          assessmentTitle: rpt.assessmentTitle,
          scorePercent: rpt.scorePercent,
          generatedAt: rpt.generatedAt,
          needsAttentionTopics: Array.from(
            new Set(
              scopedItems
                .filter((i) => i.correctnessStatus !== 'correct')
                .map((i) => `${i.subjectName}: ${i.topicName}`)
            )
          ),
        };
      })
      .filter(Boolean);

    return { recentParentSupportSummaries: scopedSummaries };
  }

  // =========================================================================
  // 3. QUESTION FILTER AVAILABILITY & STUDENT HISTORY ANALYTICS
  // =========================================================================

  private getStudentQuestionHistorySets(studentId: string) {
    const statRows = this.db
      .prepare(
        'SELECT question_id, valid_attempts, correct_attempts, incorrect_attempts FROM student_question_stats WHERE student_id = ?'
      )
      .all(studentId) as Record<string, unknown>[];

    const attemptedIds: string[] = [];
    const incorrectIds: string[] = [];
    const repeatedErrorIds: string[] = [];
    const revisionDueIds: string[] = [];

    for (const r of statRows) {
      const qId = String(r.question_id);
      const valid = Number(r.valid_attempts ?? 0);
      const corr = Number(r.correct_attempts ?? 0);
      const incorr = Number(r.incorrect_attempts ?? 0);
      if (valid > 0) attemptedIds.push(qId);
      if (incorr > 0) incorrectIds.push(qId);
      if (incorr >= 2) repeatedErrorIds.push(qId);
      if (incorr > 0 && corr < 2) revisionDueIds.push(qId);
    }

    const caseRows = this.db
      .prepare(
        `SELECT question_id, topic_id FROM intervention_cases
         WHERE student_id = ? AND status IN ('OPEN','UNDER_REVIEW','INTERVENTION_ASSIGNED','MONITORING')`
      )
      .all(studentId) as { question_id: string; topic_id: string }[];
    const weakTopicIds = Array.from(new Set(caseRows.map((c) => c.topic_id)));
    for (const c of caseRows) {
      if (!repeatedErrorIds.includes(c.question_id)) repeatedErrorIds.push(c.question_id);
      if (!revisionDueIds.includes(c.question_id)) revisionDueIds.push(c.question_id);
    }

    return {
      attemptedQuestionIds: attemptedIds,
      incorrectQuestionIds: incorrectIds,
      repeatedErrorQuestionIds: repeatedErrorIds,
      revisionDueQuestionIds: revisionDueIds,
      weakTopicIds,
    };
  }

  private getAllApprovedActiveBankQuestions(): QuizItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM questions
         WHERE active = 1 AND COALESCE(approval_status, 'ACTIVE') = 'ACTIVE'
         ORDER BY updated_at DESC`
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => rowToQuiz(r));
  }

  private selectMatchingQuestionsForSchedule(
    studentId: string,
    filters: ScheduleQuestionFilters
  ): {
    selected: QuizItem[];
    availableCount: number;
    requestedCount: number;
    insufficient: boolean;
    warnings: string[];
  } {
    const bank = this.getAllApprovedActiveBankQuestions();
    const history = this.getStudentQuestionHistorySets(studentId);
    const requestedCount = Math.max(1, Math.min(50, Number(filters.questionCount || 5)));
    const adminCtx = { userId: 'usr-admin-1', role: 'admin' as const, assignedSubjectIds: [] };

    const attemptedSet = new Set(history.attemptedQuestionIds);
    const incorrectSet = new Set(history.incorrectQuestionIds);
    const repeatedErrorSet = new Set(history.repeatedErrorQuestionIds);
    const revisionDueSet = new Set(history.revisionDueQuestionIds);
    const weakTopicSet = new Set(history.weakTopicIds);

    const baseRequest = {
      pool: bank,
      ctx: adminCtx,
      grade: filters.grade || 'Grade 5',
      subjectIds: filters.subjectIds?.length ? filters.subjectIds : [],
      topicIds: filters.topicIds?.length ? filters.topicIds : undefined,
      subtopicIds: filters.subtopicIds?.length ? filters.subtopicIds : undefined,
      difficultyTiers: filters.difficultyTiers?.length ? filters.difficultyTiers : undefined,
      questionTypes: filters.questionTypes?.length ? filters.questionTypes : undefined,
      cognitiveSkills: filters.cognitiveSkills?.length ? filters.cognitiveSkills : undefined,
      learningObjectiveQuery: filters.learningObjectiveQuery,
      minMarks: filters.minMarks,
      maxMarks: filters.maxMarks,
      minEstimatedSeconds: filters.minEstimatedSeconds,
      maxEstimatedSeconds: filters.maxEstimatedSeconds,
      historyMode: filters.historyMode || ('all' as const),
      attemptedQuestionIds: attemptedSet,
      incorrectQuestionIds: incorrectSet,
      repeatedErrorQuestionIds: repeatedErrorSet,
      revisionDueQuestionIds: revisionDueSet,
      weakTopicIds: weakTopicSet,
      balanceByTopic: filters.balanceByTopic,
    };

    let availableCount = 0;
    try {
      const probe = selectQuestionsForAssessment({
        ...baseRequest,
        mode: 'deterministic',
        count: 1,
        seed: 1,
      });
      availableCount = probe.eligibleCount;
    } catch {
      availableCount = 0;
    }

    if (availableCount === 0) {
      return {
        selected: [],
        availableCount: 0,
        requestedCount,
        insufficient: true,
        warnings: [
          'No approved active questions match these exact filters. Broaden difficulty, topic, or question history filter to continue.',
        ],
      };
    }

    try {
      const selection = selectQuestionsForAssessment({
        ...baseRequest,
        difficultyDistribution: filters.difficultyDistribution,
        mode: filters.selectionMode || 'randomized',
        count: requestedCount,
        seed: Date.now() % 1_000_000,
      });
      return {
        selected: selection.selected,
        availableCount: selection.eligibleCount,
        requestedCount,
        insufficient: false,
        warnings: [],
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : `Only ${availableCount} approved active question(s) match your criteria (${requestedCount} requested).`;
      return {
        selected: [],
        availableCount,
        requestedCount,
        insufficient: true,
        warnings: [msg],
      };
    }
  }

  public previewFilteredQuestions(
    actor: UserAccount,
    params: { studentId?: string; filters: ScheduleQuestionFilters }
  ) {
    const targetStudentId =
      params.studentId || (actor.role === 'student' ? actor.id : '');
    if (targetStudentId) {
      if (actor.role === 'parent') this.assertCanManageStudentSchedule(actor, targetStudentId);
      else if (actor.role === 'student' && actor.id !== targetStudentId) {
        throw new HttpError(403, 'Access denied.');
      }
    }

    const result = this.selectMatchingQuestionsForSchedule(
      targetStudentId || actor.id,
      params.filters || { subjectIds: [] }
    );
    const lookups = this.getCurriculumLookupMaps();

    const subjectCounts: Record<string, number> = {};
    const difficultyCounts: Record<string, number> = {};
    for (const q of result.selected) {
      const sName = lookups.subjects.get(resolveQuestionSubjectId(q)) || q.subjectId || 'General';
      subjectCounts[sName] = (subjectCounts[sName] || 0) + 1;
      const d = q.attributes.difficultyTier;
      difficultyCounts[d] = (difficultyCounts[d] || 0) + 1;
    }

    return {
      availableCount: result.availableCount,
      requestedCount: result.requestedCount,
      insufficient: result.insufficient,
      warnings: result.warnings,
      subjectCounts,
      difficultyCounts,
      sampleQuestionIds: result.selected.slice(0, 6).map((q) => q.id),
    };
  }

  // =========================================================================
  // 4. TEACHER & ADMIN TIMETABLE PRESETS + GUARDIAN PRESET APPLICATION
  // =========================================================================

  private hydratePresetRow(row: Record<string, unknown>): TimetablePreset {
    const presetId = String(row.id);
    const version = Number(row.current_version ?? 1);
    const actRows = this.db
      .prepare(
        `SELECT * FROM timetable_preset_activities
         WHERE preset_id = ? AND version_number = ?
         ORDER BY sort_order ASC`
      )
      .all(presetId, version) as Record<string, unknown>[];

    const activities: TimetablePresetActivity[] = actRows.map((a) => ({
      id: String(a.id),
      presetId: String(a.preset_id),
      versionNumber: Number(a.version_number),
      sortOrder: Number(a.sort_order),
      title: String(a.title),
      activityType: String(a.activity_type) as LearningActivityType,
      dayOffset: Number(a.day_offset),
      timeOfDay: String(a.time_of_day),
      durationMinutes: Number(a.duration_minutes),
      recurrenceRule: String(a.recurrence_rule) as TimetableRecurrenceType,
      subjectIds: parseJsonSafe(a.subject_ids_json, []),
      topicIds: parseJsonSafe(a.topic_ids_json, []),
      difficultyDistribution: parseJsonSafe(a.difficulty_distribution_json, {}),
      filterCriteria: parseJsonSafe(a.filter_criteria_json, { subjectIds: [] }),
      fixedAssessmentId: a.fixed_assessment_id ? String(a.fixed_assessment_id) : null,
      fixedPaperId: a.fixed_paper_id ? String(a.fixed_paper_id) : null,
    }));

    return {
      id: presetId,
      title: String(row.title),
      description: String(row.description),
      creatorId: String(row.creator_id),
      creatorName: String(row.creator_name),
      creatorRole: String(row.creator_role) as UserRole,
      targetGrade: String(row.target_grade || 'Grade 5'),
      subjectIds: parseJsonSafe(row.subject_ids_json, []),
      topicIds: parseJsonSafe(row.topic_ids_json, []),
      recommendedFrequency: String(row.recommended_frequency || ''),
      status: String(row.status) as TimetablePreset['status'],
      currentVersion: version,
      activities,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  public listTimetablePresets(actor: UserAccount): TimetablePreset[] {
    const rows = this.db
      .prepare('SELECT * FROM timetable_presets ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[];
    const presets = rows.map((r) => this.hydratePresetRow(r));

    if (actor.role === 'admin') return presets;
    if (actor.role === 'parent' || actor.role === 'student') {
      return presets.filter((p) => p.status === 'PUBLISHED');
    }

    const ctx = this.academicService.buildAuthContext(actor);
    return presets.filter(
      (p) =>
        p.creatorId === actor.id ||
        p.status === 'PUBLISHED' ||
        (p.subjectIds.length > 0 && p.subjectIds.every((sid) => canAccessSubject(ctx, sid)))
    );
  }

  public createTimetablePreset(
    actor: UserAccount,
    payload: {
      title: string;
      description: string;
      targetGrade?: string;
      subjectIds: string[];
      topicIds?: string[];
      recommendedFrequency?: string;
      status?: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED';
      activities: Array<{
        title: string;
        activityType: LearningActivityType;
        dayOffset: number;
        timeOfDay: string;
        durationMinutes: number;
        recurrenceRule?: TimetableRecurrenceType;
        subjectIds: string[];
        topicIds?: string[];
        difficultyDistribution?: Partial<Record<DifficultyTier, number>>;
        filterCriteria?: ScheduleQuestionFilters;
        fixedAssessmentId?: string | null;
        fixedPaperId?: string | null;
      }>;
    }
  ): TimetablePreset {
    if (actor.role !== 'teacher' && actor.role !== 'admin') {
      throw new HttpError(403, 'Only teachers or administrators can create timetable presets.');
    }
    const cleanTitle = String(payload.title || '').trim();
    if (!cleanTitle || !Array.isArray(payload.activities) || payload.activities.length === 0) {
      throw new HttpError(400, 'Preset title and at least one scheduled activity are required.');
    }

    const allSubjIds = new Set<string>(payload.subjectIds || []);
    for (const act of payload.activities) {
      for (const sid of act.subjectIds || []) allSubjIds.add(sid);
      for (const sid of act.filterCriteria?.subjectIds || []) allSubjIds.add(sid);
    }

    if (actor.role === 'teacher') {
      const ctx = this.academicService.buildAuthContext(actor);
      if (allSubjIds.size === 0) {
        throw new HttpError(400, 'Teachers must assign at least one authorized subject to the preset.');
      }
      for (const sid of allSubjIds) {
        if (!canAccessSubject(ctx, sid)) {
          throw new HttpError(
            403,
            `Access denied: subject ${sid} is outside your assigned teaching permissions.`
          );
        }
      }
    }

    const initialStatus: TimetablePreset['status'] =
      actor.role === 'admin' && payload.status === 'PUBLISHED'
        ? 'PUBLISHED'
        : payload.status === 'PENDING_REVIEW'
        ? 'PENDING_REVIEW'
        : 'DRAFT';

    const id = `PRESET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO timetable_presets (
            id, title, description, creator_id, creator_name, creator_role, target_grade,
            subject_ids_json, topic_ids_json, recommended_frequency, status, current_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          id,
          cleanTitle,
          String(payload.description || '').trim(),
          actor.id,
          actor.name,
          actor.role,
          String(payload.targetGrade || 'Grade 5'),
          JSON.stringify(Array.from(allSubjIds)),
          JSON.stringify(payload.topicIds || []),
          String(payload.recommendedFrequency || 'Weekly plan'),
          initialStatus,
          now,
          now
        );

      this.db
        .prepare(
          `INSERT INTO timetable_preset_versions (
            id, preset_id, version_number, title, description, change_note, changed_by, created_at
          ) VALUES (?, ?, 1, ?, ?, 'Initial preset version', ?, ?)`
        )
        .run(
          `TPV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          id,
          cleanTitle,
          String(payload.description || '').trim(),
          actor.id,
          now
        );

      const insAct = this.db.prepare(
        `INSERT INTO timetable_preset_activities (
          id, preset_id, version_number, sort_order, title, activity_type, day_offset, time_of_day,
          duration_minutes, recurrence_rule, subject_ids_json, topic_ids_json,
          difficulty_distribution_json, filter_criteria_json, fixed_assessment_id, fixed_paper_id
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      payload.activities.forEach((act, idx) => {
        const fc: ScheduleQuestionFilters = act.filterCriteria || {
          grade: payload.targetGrade || 'Grade 5',
          subjectIds: act.subjectIds,
          topicIds: act.topicIds,
          difficultyDistribution: act.difficultyDistribution,
          questionCount: 5,
          historyMode: 'all',
        };
        insAct.run(
          `TPA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          id,
          idx + 1,
          String(act.title || `Activity ${idx + 1}`).trim(),
          act.activityType || 'practice',
          Math.max(0, Math.min(30, Number(act.dayOffset || 0))),
          /^\d{2}:\d{2}$/.test(String(act.timeOfDay || '')) ? act.timeOfDay : '17:00',
          Math.max(5, Math.min(180, Number(act.durationMinutes || 20))),
          act.recurrenceRule || 'weekly',
          JSON.stringify(act.subjectIds || Array.from(allSubjIds)),
          JSON.stringify(act.topicIds || []),
          JSON.stringify(act.difficultyDistribution || {}),
          JSON.stringify(fc),
          act.fixedAssessmentId || null,
          act.fixedPaperId || null
        );
      });
    });

    this.academicService.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'TIMETABLE_PRESET_CREATED',
      targetType: 'timetable_preset',
      targetId: id,
      details: { title: cleanTitle, status: initialStatus, subjectIds: Array.from(allSubjIds) },
    });

    const row = this.db
      .prepare('SELECT * FROM timetable_presets WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return this.hydratePresetRow(row);
  }

  public updateTimetablePreset(
    actor: UserAccount,
    presetId: string,
    payload: {
      title?: string;
      description?: string;
      recommendedFrequency?: string;
      changeNote?: string;
      activities?: Array<{
        title: string;
        activityType: LearningActivityType;
        dayOffset: number;
        timeOfDay: string;
        durationMinutes: number;
        recurrenceRule?: TimetableRecurrenceType;
        subjectIds: string[];
        topicIds?: string[];
        difficultyDistribution?: Partial<Record<DifficultyTier, number>>;
        filterCriteria?: ScheduleQuestionFilters;
        fixedAssessmentId?: string | null;
        fixedPaperId?: string | null;
      }>;
    }
  ): TimetablePreset {
    const existingRow = this.db
      .prepare('SELECT * FROM timetable_presets WHERE id = ?')
      .get(presetId) as Record<string, unknown> | undefined;
    if (!existingRow) throw new HttpError(404, 'Timetable preset not found.');
    const existing = this.hydratePresetRow(existingRow);

    if (actor.role !== 'admin') {
      if (actor.role !== 'teacher' || existing.creatorId !== actor.id) {
        throw new HttpError(403, 'Access denied: you may only update your own timetable presets.');
      }
      const ctx = this.academicService.buildAuthContext(actor);
      const nextSubjs = new Set<string>(existing.subjectIds);
      for (const act of payload.activities || []) {
        for (const sid of act.subjectIds || []) nextSubjs.add(sid);
      }
      for (const sid of nextSubjs) {
        if (!canAccessSubject(ctx, sid)) {
          throw new HttpError(403, `Access denied for subject ${sid}.`);
        }
      }
    }

    const nextVer = existing.currentVersion + 1;
    const nextTitle = payload.title ? payload.title.trim() : existing.title;
    const nextDesc =
      payload.description !== undefined ? payload.description.trim() : existing.description;
    const nextFreq = payload.recommendedFrequency || existing.recommendedFrequency;
    const now = new Date().toISOString();

    const activitiesToSave = payload.activities || existing.activities;
    const subjectIds = Array.from(
      new Set(activitiesToSave.flatMap((a) => a.subjectIds || []))
    );

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE timetable_presets SET
            title = ?, description = ?, recommended_frequency = ?, subject_ids_json = ?,
            current_version = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextTitle,
          nextDesc,
          nextFreq,
          JSON.stringify(subjectIds.length ? subjectIds : existing.subjectIds),
          nextVer,
          now,
          presetId
        );

      this.db
        .prepare(
          `INSERT INTO timetable_preset_versions (
            id, preset_id, version_number, title, description, change_note, changed_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `TPV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          presetId,
          nextVer,
          nextTitle,
          nextDesc,
          String(payload.changeNote || 'Updated preset schedule'),
          actor.id,
          now
        );

      const insAct = this.db.prepare(
        `INSERT INTO timetable_preset_activities (
          id, preset_id, version_number, sort_order, title, activity_type, day_offset, time_of_day,
          duration_minutes, recurrence_rule, subject_ids_json, topic_ids_json,
          difficulty_distribution_json, filter_criteria_json, fixed_assessment_id, fixed_paper_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      activitiesToSave.forEach((act, idx) => {
        insAct.run(
          `TPA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          presetId,
          nextVer,
          idx + 1,
          String(act.title).trim(),
          act.activityType || 'practice',
          Math.max(0, Math.min(30, Number(act.dayOffset || 0))),
          /^\d{2}:\d{2}$/.test(String(act.timeOfDay || '')) ? act.timeOfDay : '17:00',
          Math.max(5, Math.min(180, Number(act.durationMinutes || 20))),
          act.recurrenceRule || 'weekly',
          JSON.stringify(act.subjectIds || existing.subjectIds),
          JSON.stringify(act.topicIds || []),
          JSON.stringify(act.difficultyDistribution || {}),
          JSON.stringify(
            act.filterCriteria || {
              grade: existing.targetGrade,
              subjectIds: act.subjectIds || existing.subjectIds,
              questionCount: 5,
            }
          ),
          act.fixedAssessmentId || null,
          act.fixedPaperId || null
        );
      });
    });

    const row = this.db
      .prepare('SELECT * FROM timetable_presets WHERE id = ?')
      .get(presetId) as Record<string, unknown>;
    return this.hydratePresetRow(row);
  }

  public transitionTimetablePresetStatus(
    actor: UserAccount,
    presetId: string,
    action: 'submit_review' | 'publish' | 'archive'
  ): TimetablePreset {
    const existingRow = this.db
      .prepare('SELECT * FROM timetable_presets WHERE id = ?')
      .get(presetId) as Record<string, unknown> | undefined;
    if (!existingRow) throw new HttpError(404, 'Timetable preset not found.');
    const existing = this.hydratePresetRow(existingRow);

    let nextStatus: TimetablePreset['status'] = existing.status;
    if (action === 'submit_review') {
      if (actor.role === 'teacher' && existing.creatorId !== actor.id) {
        throw new HttpError(403, 'Teachers can only submit their own presets for review.');
      }
      nextStatus = 'PENDING_REVIEW';
    } else if (action === 'publish') {
      if (actor.role !== 'admin') {
        throw new HttpError(
          403,
          'Only administrators can approve and globally publish timetable presets.'
        );
      }
      nextStatus = 'PUBLISHED';
    } else if (action === 'archive') {
      if (actor.role !== 'admin' && existing.creatorId !== actor.id) {
        throw new HttpError(403, 'Access denied to archive this preset.');
      }
      nextStatus = 'ARCHIVED';
    }

    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE timetable_presets SET status = ?, updated_at = ? WHERE id = ?')
      .run(nextStatus, now, presetId);

    this.academicService.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: `TIMETABLE_PRESET_${nextStatus}`,
      targetType: 'timetable_preset',
      targetId: presetId,
      details: { previousStatus: existing.status, nextStatus },
    });

    const row = this.db
      .prepare('SELECT * FROM timetable_presets WHERE id = ?')
      .get(presetId) as Record<string, unknown>;
    return this.hydratePresetRow(row);
  }

  private getExistingSessionsForStudent(studentId: string): ScheduledSessionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ss.*, u.name AS student_name
         FROM scheduled_sessions ss
         JOIN users u ON u.id = ss.student_id
         WHERE ss.student_id = ?
         ORDER BY ss.scheduled_start_utc ASC`
      )
      .all(studentId) as Record<string, unknown>[];
    return rows.map((r) => this.hydrateSessionRow(r));
  }

  private buildPresetOccurrencesPreview(params: {
    preset: TimetablePreset;
    studentId: string;
    startDate: string;
    endDate?: string;
    timezone: string;
    exceptionDates?: string[];
  }) {
    const tz = isValidTimeZone(params.timezone) ? params.timezone : 'Asia/Colombo';
    const existing = this.getExistingSessionsForStudent(params.studentId);
    const occurrences: {
      activityId: string;
      title: string;
      activityType: LearningActivityType;
      localDate: string;
      timeOfDay: string;
      durationMinutes: number;
      startUtc: string;
      endUtc: string;
      filterCriteria: ScheduleQuestionFilters;
      fixedAssessmentId?: string | null;
      fixedPaperId?: string | null;
      eligibleCount: number;
      warnings: string[];
    }[] = [];

    for (const act of params.preset.activities) {
      const actStart = addDaysToDateString(params.startDate, act.dayOffset);
      const dates = expandRecurrenceDates({
        startDate: actStart,
        endDate: params.endDate || addDaysToDateString(params.startDate, 14),
        recurrenceType: act.recurrenceRule || 'weekly',
        exceptionDates: params.exceptionDates,
        maxOccurrences: 12,
      });

      const matchCheck = act.fixedAssessmentId || act.fixedPaperId
        ? { availableCount: 1, warnings: [] as string[] }
        : this.selectMatchingQuestionsForSchedule(params.studentId, act.filterCriteria);

      for (const localDate of dates) {
        const startUtc = convertLocalDateTimeToUtcIso(localDate, act.timeOfDay, tz);
        const endUtc = new Date(Date.parse(startUtc) + act.durationMinutes * 60_000).toISOString();
        occurrences.push({
          activityId: act.id,
          title: act.title,
          activityType: act.activityType,
          localDate,
          timeOfDay: act.timeOfDay,
          durationMinutes: act.durationMinutes,
          startUtc,
          endUtc,
          filterCriteria: act.filterCriteria,
          fixedAssessmentId: act.fixedAssessmentId,
          fixedPaperId: act.fixedPaperId,
          eligibleCount: matchCheck.availableCount,
          warnings: matchCheck.warnings,
        });
      }
    }

    const conflicts = detectScheduleConflicts(
      existing,
      occurrences.map((o) => ({ startUtc: o.startUtc, endUtc: o.endUtc, title: o.title }))
    );

    return { timezone: tz, occurrences, conflicts };
  }

  public previewPresetApplication(
    actor: UserAccount,
    params: {
      presetId: string;
      studentId: string;
      startDate: string;
      endDate?: string;
      timezone?: string;
      exceptionDates?: string[];
    }
  ) {
    this.assertCanManageStudentSchedule(actor, params.studentId);
    const row = this.db
      .prepare('SELECT * FROM timetable_presets WHERE id = ?')
      .get(params.presetId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Timetable preset not found.');
    const preset = this.hydratePresetRow(row);
    if (preset.status !== 'PUBLISHED' && actor.role !== 'admin') {
      throw new HttpError(403, 'Only published timetable presets can be applied.');
    }
    return {
      preset,
      ...this.buildPresetOccurrencesPreview({
        preset,
        studentId: params.studentId,
        startDate: params.startDate,
        endDate: params.endDate,
        timezone: params.timezone || 'Asia/Colombo',
        exceptionDates: params.exceptionDates,
      }),
    };
  }

  public applyPresetToStudent(
    actor: UserAccount,
    params: {
      presetId: string;
      studentId: string;
      startDate: string;
      endDate?: string;
      timezone?: string;
      customTitle?: string;
      exceptionDates?: string[];
      skipConflicts?: boolean;
    }
  ): { timetable: StudentTimetable; sessions: ScheduledSessionRecord[]; skippedConflicts: number } {
    const auth = this.assertCanManageStudentSchedule(actor, params.studentId);
    const row = this.db
      .prepare('SELECT * FROM timetable_presets WHERE id = ?')
      .get(params.presetId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Timetable preset not found.');
    const preset = this.hydratePresetRow(row);
    if (preset.status !== 'PUBLISHED' && actor.role !== 'admin') {
      throw new HttpError(403, 'Only published timetable presets can be applied.');
    }

    const preview = this.buildPresetOccurrencesPreview({
      preset,
      studentId: params.studentId,
      startDate: params.startDate,
      endDate: params.endDate,
      timezone: params.timezone || 'Asia/Colombo',
      exceptionDates: params.exceptionDates,
    });

    if (preview.occurrences.length === 0) {
      throw new HttpError(400, 'Preset produced no scheduled occurrences in the selected date window.');
    }

    const conflictStarts = new Set(preview.conflicts.map((c) => c.candidateStartUtc));
    if (preview.conflicts.length > 0 && !params.skipConflicts) {
      throw new HttpError(
        409,
        `Schedule conflict detected with "${preview.conflicts[0].conflictingTitle}". Adjust start time or skip conflicting slots.`
      );
    }

    const filteredOccurrences = params.skipConflicts
      ? preview.occurrences.filter((o) => !conflictStarts.has(o.startUtc))
      : preview.occurrences;

    if (filteredOccurrences.length === 0) {
      throw new HttpError(409, 'All preset occurrences conflict with existing scheduled sessions.');
    }

    if (auth.isStudentSelfEdit && auth.link) {
      const totalPerDay = new Map<string, number>();
      for (const o of filteredOccurrences) {
        totalPerDay.set(o.localDate, (totalPerDay.get(o.localDate) || 0) + o.durationMinutes);
        if (totalPerDay.get(o.localDate)! > auth.link.studentDailyMaxMinutes) {
          throw new HttpError(
            403,
            `Guardian policy limits daily scheduled study to ${auth.link.studentDailyMaxMinutes} minutes.`
          );
        }
      }
    }

    const ttId = `STT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const createdSessionIds: string[] = [];

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO student_timetables (
            id, student_id, created_by_user_id, source_preset_id, source_preset_version,
            title, description, timezone, start_date, end_date, recurrence_type,
            weekdays_json, exception_dates_json, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'custom', '[]', ?, 'ACTIVE', ?, ?)`
        )
        .run(
          ttId,
          params.studentId,
          actor.id,
          preset.id,
          preset.currentVersion,
          String(params.customTitle || preset.title).trim(),
          preset.description,
          preview.timezone,
          params.startDate,
          params.endDate || addDaysToDateString(params.startDate, 14),
          JSON.stringify(params.exceptionDates || []),
          now,
          now
        );

      const insSess = this.db.prepare(
        `INSERT INTO scheduled_sessions (
          id, timetable_id, student_id, created_by_user_id, title, activity_type, timezone,
          scheduled_start_utc, scheduled_end_utc, duration_minutes, grace_period_minutes,
          recurrence_key, status, max_attempts, attempts_used, filter_criteria_json,
          question_snapshot_ids_json, fixed_assessment_id, fixed_paper_id, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 15, ?, 'SCHEDULED', 1, 0, ?, '[]', ?, ?, ?, ?, ?)`
      );

      for (const occ of filteredOccurrences) {
        const sid = `SES-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        createdSessionIds.push(sid);
        insSess.run(
          sid,
          ttId,
          params.studentId,
          actor.id,
          occ.title,
          occ.activityType,
          preview.timezone,
          occ.startUtc,
          occ.endUtc,
          occ.durationMinutes,
          `${preset.id}-${occ.activityId}-${occ.localDate}`,
          JSON.stringify(occ.filterCriteria),
          occ.fixedAssessmentId || null,
          occ.fixedPaperId || null,
          `Applied from preset "${preset.title}" v${preset.currentVersion}`,
          now,
          now
        );
      }
    });

    for (const sid of createdSessionIds) {
      this.syncReminderJobsForSession(sid);
    }

    this.writeScheduleAuditEvent({
      studentId: params.studentId,
      actor,
      eventType: 'PRESET_APPLIED_TO_STUDENT',
      targetId: ttId,
      summary: `Applied preset "${preset.title}" (v${preset.currentVersion}) creating ${createdSessionIds.length} independent session(s).`,
      metadata: { presetId: preset.id, presetVersion: preset.currentVersion, sessionsCreated: createdSessionIds.length },
    });

    const ttRow = this.db
      .prepare('SELECT * FROM student_timetables WHERE id = ?')
      .get(ttId) as Record<string, unknown>;
    const sessions = createdSessionIds
      .map((sid) => this.getSessionById(sid))
      .filter(Boolean) as ScheduledSessionRecord[];

    return {
      timetable: this.hydrateTimetableRow(ttRow),
      sessions,
      skippedConflicts: preview.conflicts.length,
    };
  }

  // =========================================================================
  // 5. CUSTOM SMART TIMETABLE BUILDER, RESCHEDULING & REMINDER SYNC
  // =========================================================================

  private validateFixedTarget(fixedAssessmentId?: string | null, fixedPaperId?: string | null) {
    if (fixedAssessmentId) {
      const row = this.db
        .prepare("SELECT id, status FROM assessments WHERE id = ? AND status IN ('PUBLISHED','ACTIVE','SCHEDULED')")
        .get(fixedAssessmentId) as { id: string; status: string } | undefined;
      if (!row) {
        throw new HttpError(400, `Selected assessment (${fixedAssessmentId}) is not published or available.`);
      }
    }
    if (fixedPaperId) {
      const row = this.db
        .prepare('SELECT id, published FROM papers WHERE id = ? AND published = 1')
        .get(fixedPaperId) as { id: string; published: number } | undefined;
      if (!row) {
        throw new HttpError(400, `Selected examination paper (${fixedPaperId}) is not published or available.`);
      }
    }
  }

  public previewCustomTimetable(
    actor: UserAccount,
    payload: {
      studentId: string;
      title: string;
      activityType: LearningActivityType;
      timezone?: string;
      startDate: string;
      endDate?: string | null;
      timeOfDay: string;
      durationMinutes: number;
      recurrenceType: TimetableRecurrenceType;
      weekdays?: number[];
      exceptionDates?: string[];
      filterCriteria: ScheduleQuestionFilters;
      fixedAssessmentId?: string | null;
      fixedPaperId?: string | null;
    }
  ) {
    this.assertCanManageStudentSchedule(actor, payload.studentId);
    const tz = payload.timezone || 'Asia/Colombo';
    if (!isValidTimeZone(tz)) {
      throw new HttpError(400, `Invalid IANA timezone: ${tz}`);
    }
    this.validateFixedTarget(payload.fixedAssessmentId, payload.fixedPaperId);

    const dates = expandRecurrenceDates({
      startDate: payload.startDate,
      endDate: payload.endDate,
      recurrenceType: payload.recurrenceType,
      weekdays: payload.weekdays,
      exceptionDates: payload.exceptionDates,
    });

    if (dates.length === 0) {
      throw new HttpError(400, 'No valid active dates match the recurrence and exception date settings.');
    }

    const durationMinutes = Math.max(5, Math.min(180, Number(payload.durationMinutes || 20)));
    const occurrences = dates.map((d) => {
      const startUtc = convertLocalDateTimeToUtcIso(d, payload.timeOfDay, tz);
      const endUtc = new Date(Date.parse(startUtc) + durationMinutes * 60_000).toISOString();
      return { localDate: d, startUtc, endUtc };
    });

    const existing = this.getExistingSessionsForStudent(payload.studentId);
    const conflicts = detectScheduleConflicts(
      existing,
      occurrences.map((o) => ({ startUtc: o.startUtc, endUtc: o.endUtc, title: payload.title }))
    );

    const questionAvailability =
      payload.fixedAssessmentId || payload.fixedPaperId
        ? { availableCount: 1, requestedCount: 1, insufficient: false, warnings: [] }
        : this.selectMatchingQuestionsForSchedule(payload.studentId, payload.filterCriteria);

    return {
      timezone: tz,
      occurrenceCount: occurrences.length,
      occurrences,
      conflicts,
      questionAvailability: {
        availableCount: questionAvailability.availableCount,
        requestedCount: questionAvailability.requestedCount,
        insufficient: questionAvailability.insufficient,
        warnings: questionAvailability.warnings,
      },
    };
  }

  public createCustomTimetable(
    actor: UserAccount,
    payload: {
      studentId: string;
      title: string;
      description?: string;
      activityType: LearningActivityType;
      timezone?: string;
      startDate: string;
      endDate?: string | null;
      timeOfDay: string;
      durationMinutes: number;
      gracePeriodMinutes?: number;
      maxAttempts?: number;
      recurrenceType: TimetableRecurrenceType;
      weekdays?: number[];
      exceptionDates?: string[];
      filterCriteria: ScheduleQuestionFilters;
      fixedAssessmentId?: string | null;
      fixedPaperId?: string | null;
      notes?: string;
    }
  ): { timetable: StudentTimetable; sessions: ScheduledSessionRecord[] } {
    const auth = this.assertCanManageStudentSchedule(actor, payload.studentId);
    const cleanTitle = String(payload.title || '').trim();
    if (!cleanTitle) throw new HttpError(400, 'Schedule title is required.');

    const preview = this.previewCustomTimetable(actor, payload);
    if (preview.questionAvailability.insufficient) {
      throw new HttpError(
        400,
        preview.questionAvailability.warnings[0] ||
          'Insufficient approved active questions match the selected filters.'
      );
    }
    if (preview.conflicts.length > 0) {
      throw new HttpError(
        409,
        `Time conflict detected: ${preview.conflicts[0].reason}`
      );
    }

    const durationMinutes = Math.max(5, Math.min(180, Number(payload.durationMinutes || 20)));
    if (auth.isStudentSelfEdit && auth.link && durationMinutes > auth.link.studentDailyMaxMinutes) {
      throw new HttpError(
        403,
        `Guardian limit: student-created sessions cannot exceed ${auth.link.studentDailyMaxMinutes} minutes per day.`
      );
    }

    const ttId = `STT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const graceMinutes = Math.max(0, Math.min(120, Number(payload.gracePeriodMinutes ?? 15)));
    const maxAttempts = Math.max(1, Math.min(5, Number(payload.maxAttempts ?? 1)));
    const createdSessionIds: string[] = [];

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO student_timetables (
            id, student_id, created_by_user_id, source_preset_id, source_preset_version,
            title, description, timezone, start_date, end_date, recurrence_type,
            weekdays_json, exception_dates_json, status, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
        )
        .run(
          ttId,
          payload.studentId,
          actor.id,
          cleanTitle,
          String(payload.description || '').trim(),
          preview.timezone,
          payload.startDate,
          payload.endDate || null,
          payload.recurrenceType,
          JSON.stringify(payload.weekdays || []),
          JSON.stringify(payload.exceptionDates || []),
          now,
          now
        );

      const insSess = this.db.prepare(
        `INSERT INTO scheduled_sessions (
          id, timetable_id, student_id, created_by_user_id, title, activity_type, timezone,
          scheduled_start_utc, scheduled_end_utc, duration_minutes, grace_period_minutes,
          recurrence_key, status, max_attempts, attempts_used, filter_criteria_json,
          question_snapshot_ids_json, fixed_assessment_id, fixed_paper_id, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, 0, ?, '[]', ?, ?, ?, ?, ?)`
      );

      for (const occ of preview.occurrences) {
        const sid = `SES-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        createdSessionIds.push(sid);
        insSess.run(
          sid,
          ttId,
          payload.studentId,
          actor.id,
          cleanTitle,
          payload.activityType,
          preview.timezone,
          occ.startUtc,
          occ.endUtc,
          durationMinutes,
          graceMinutes,
          `${ttId}-${occ.localDate}`,
          maxAttempts,
          JSON.stringify(payload.filterCriteria || { subjectIds: [] }),
          payload.fixedAssessmentId || null,
          payload.fixedPaperId || null,
          String(payload.notes || ''),
          now,
          now
        );
      }
    });

    for (const sid of createdSessionIds) {
      this.syncReminderJobsForSession(sid);
    }

    this.writeScheduleAuditEvent({
      studentId: payload.studentId,
      actor,
      eventType: 'CUSTOM_TIMETABLE_CREATED',
      targetId: ttId,
      summary: `Created "${cleanTitle}" (${payload.recurrenceType}, ${createdSessionIds.length} session(s) in ${preview.timezone}).`,
      metadata: { activityType: payload.activityType, sessionsCreated: createdSessionIds.length },
    });

    const ttRow = this.db
      .prepare('SELECT * FROM student_timetables WHERE id = ?')
      .get(ttId) as Record<string, unknown>;
    const sessions = createdSessionIds
      .map((sid) => this.getSessionById(sid))
      .filter(Boolean) as ScheduledSessionRecord[];

    return { timetable: this.hydrateTimetableRow(ttRow), sessions };
  }

  public rescheduleSession(
    actor: UserAccount,
    sessionId: string,
    params: {
      newDate: string;
      newTimeOfDay: string;
      timezone?: string;
      durationMinutes?: number;
    }
  ): ScheduledSessionRecord {
    const existing = this.getSessionById(sessionId);
    if (!existing) throw new HttpError(404, 'Scheduled session not found.');

    const auth = this.assertCanManageStudentSchedule(actor, existing.studentId);
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new HttpError(400, `Cannot reschedule a ${existing.status.toLowerCase()} session.`);
    }

    const tz = params.timezone && isValidTimeZone(params.timezone) ? params.timezone : existing.timezone;
    const durationMinutes = Math.max(
      5,
      Math.min(180, Number(params.durationMinutes ?? existing.durationMinutes))
    );
    const newStartUtc = convertLocalDateTimeToUtcIso(params.newDate, params.newTimeOfDay, tz);
    const newEndUtc = new Date(Date.parse(newStartUtc) + durationMinutes * 60_000).toISOString();

    if (auth.isStudentSelfEdit && auth.link) {
      const hoursShift = Math.abs(Date.parse(newStartUtc) - Date.parse(existing.scheduledStartUtc)) / 3_600_000;
      if (hoursShift > auth.link.studentRescheduleWindowHours) {
        throw new HttpError(
          403,
          `Guardian policy limits student rescheduling to within ±${auth.link.studentRescheduleWindowHours} hours.`
        );
      }
      if (durationMinutes > auth.link.studentDailyMaxMinutes) {
        throw new HttpError(403, 'Session duration exceeds guardian daily study cap.');
      }
    }

    const allSessions = this.getExistingSessionsForStudent(existing.studentId);
    const conflicts = detectScheduleConflicts(allSessions, [
      { startUtc: newStartUtc, endUtc: newEndUtc, title: existing.title, ignoreSessionId: sessionId },
    ]);
    if (conflicts.length > 0) {
      throw new HttpError(409, `Reschedule conflict: ${conflicts[0].reason}`);
    }

    const now = new Date().toISOString();
    this.dbWrapper.transaction(() => {
      // Cancel all existing pending reminders cleanly so no stale notification fires
      this.db
        .prepare(
          `UPDATE reminder_jobs SET status = 'CANCELLED' WHERE session_id = ? AND status = 'PENDING'`
        )
        .run(sessionId);

      this.db
        .prepare(
          `UPDATE scheduled_sessions SET
            timezone = ?, scheduled_start_utc = ?, scheduled_end_utc = ?, duration_minutes = ?,
            status = 'SCHEDULED', missed_detected_at = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(tz, newStartUtc, newEndUtc, durationMinutes, now, sessionId);
    });

    this.syncReminderJobsForSession(sessionId);

    this.writeScheduleAuditEvent({
      studentId: existing.studentId,
      actor,
      eventType: 'SESSION_RESCHEDULED',
      targetId: sessionId,
      summary: `Rescheduled "${existing.title}" to ${params.newDate} ${params.newTimeOfDay} (${tz}).`,
      metadata: { oldStartUtc: existing.scheduledStartUtc, newStartUtc },
    });

    return this.getSessionById(sessionId)!;
  }

  public updateSessionStatus(
    actor: UserAccount,
    sessionId: string,
    action: 'pause' | 'resume' | 'cancel'
  ): ScheduledSessionRecord {
    const existing = this.getSessionById(sessionId);
    if (!existing) throw new HttpError(404, 'Scheduled session not found.');
    this.assertCanManageStudentSchedule(actor, existing.studentId);
    if (existing.status === 'COMPLETED') {
      throw new HttpError(400, 'Completed sessions cannot be paused or cancelled.');
    }

    const nextStatus: ScheduledSessionStatus =
      action === 'pause' ? 'PAUSED' : action === 'cancel' ? 'CANCELLED' : 'SCHEDULED';
    const now = new Date().toISOString();

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(`UPDATE scheduled_sessions SET status = ?, updated_at = ? WHERE id = ?`)
        .run(nextStatus, now, sessionId);
      if (nextStatus === 'PAUSED' || nextStatus === 'CANCELLED') {
        this.db
          .prepare(`UPDATE reminder_jobs SET status = 'CANCELLED' WHERE session_id = ? AND status = 'PENDING'`)
          .run(sessionId);
      }
    });

    if (nextStatus === 'SCHEDULED') {
      this.syncReminderJobsForSession(sessionId);
    }

    this.writeScheduleAuditEvent({
      studentId: existing.studentId,
      actor,
      eventType: `SESSION_${nextStatus}`,
      targetId: sessionId,
      summary: `Session "${existing.title}" updated to ${nextStatus}.`,
    });

    return this.getSessionById(sessionId)!;
  }

  // =========================================================================
  // 6. REMINDER PREFERENCES, START/COMPLETE SESSIONS & IDEMPOTENT SWEEP
  // =========================================================================

  public getReminderPreferences(actor: UserAccount, studentId: string): ReminderPreferenceRecord {
    if (actor.role === 'parent') this.assertCanViewStudentReports(actor, studentId);
    else if (actor.role === 'student' && actor.id !== studentId) {
      throw new HttpError(403, 'Access denied.');
    }

    const row = this.db
      .prepare('SELECT * FROM reminder_preferences WHERE user_id = ? AND student_id = ?')
      .get(actor.id, studentId) as Record<string, unknown> | undefined;

    if (!row) {
      return {
        userId: actor.id,
        studentId,
        leadTimesMinutes: actor.role === 'parent' ? [1440, 60, 15] : [30, 5, 0],
        channels:
          actor.role === 'parent'
            ? { inApp: true, email: true, whatsapp: true }
            : { inApp: true, email: false, whatsapp: false },
        dailyDigestEnabled: false,
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      userId: String(row.user_id),
      studentId: String(row.student_id),
      leadTimesMinutes: parseJsonSafe(row.lead_times_json, [60, 15]),
      channels: parseJsonSafe(row.channels_json, { inApp: true, email: true, whatsapp: true }),
      dailyDigestEnabled: Number(row.daily_digest_enabled ?? 0) === 1,
      updatedAt: String(row.updated_at),
    };
  }

  public updateReminderPreferences(
    actor: UserAccount,
    studentId: string,
    payload: {
      leadTimesMinutes?: number[];
      channels?: { inApp?: boolean; email?: boolean; whatsapp?: boolean };
      dailyDigestEnabled?: boolean;
    }
  ): ReminderPreferenceRecord {
    if (actor.role === 'parent') this.assertCanViewStudentReports(actor, studentId);
    else if (actor.role === 'student' && actor.id !== studentId) {
      throw new HttpError(403, 'Access denied.');
    }

    const current = this.getReminderPreferences(actor, studentId);
    const allowedLeads = [1440, 60, 30, 15, 5, 0];
    const cleanLeads = payload.leadTimesMinutes
      ? Array.from(
          new Set(
            payload.leadTimesMinutes
              .map((n) => Number(n))
              .filter((n) => allowedLeads.includes(n))
          )
        ).sort((a, b) => b - a)
      : current.leadTimesMinutes;

    const cleanChannels = {
      inApp: payload.channels?.inApp ?? current.channels.inApp,
      email: payload.channels?.email ?? current.channels.email,
      whatsapp: payload.channels?.whatsapp ?? current.channels.whatsapp,
    };
    const digest = payload.dailyDigestEnabled ?? current.dailyDigestEnabled;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO reminder_preferences (user_id, student_id, lead_times_json, channels_json, daily_digest_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, student_id) DO UPDATE SET
           lead_times_json = excluded.lead_times_json,
           channels_json = excluded.channels_json,
           daily_digest_enabled = excluded.daily_digest_enabled,
           updated_at = excluded.updated_at`
      )
      .run(
        actor.id,
        studentId,
        JSON.stringify(cleanLeads),
        JSON.stringify(cleanChannels),
        digest ? 1 : 0,
        now
      );

    // Resync pending future reminder jobs for this student's scheduled sessions
    const upcoming = this.db
      .prepare(
        `SELECT id FROM scheduled_sessions WHERE student_id = ? AND status = 'SCHEDULED'`
      )
      .all(studentId) as { id: string }[];
    for (const s of upcoming) {
      this.syncReminderJobsForSession(s.id);
    }

    return this.getReminderPreferences(actor, studentId);
  }

  private getEffectiveReminderPref(userId: string, role: UserRole, studentId: string): ReminderPreferenceRecord {
    const row = this.db
      .prepare('SELECT * FROM reminder_preferences WHERE user_id = ? AND student_id = ?')
      .get(userId, studentId) as Record<string, unknown> | undefined;
    if (!row) {
      return {
        userId,
        studentId,
        leadTimesMinutes: role === 'parent' ? [1440, 60, 15] : [30, 5, 0],
        channels:
          role === 'parent'
            ? { inApp: true, email: true, whatsapp: true }
            : { inApp: true, email: false, whatsapp: false },
        dailyDigestEnabled: false,
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      userId,
      studentId,
      leadTimesMinutes: parseJsonSafe(row.lead_times_json, [60, 15]),
      channels: parseJsonSafe(row.channels_json, { inApp: true, email: true, whatsapp: true }),
      dailyDigestEnabled: Number(row.daily_digest_enabled ?? 0) === 1,
      updatedAt: String(row.updated_at),
    };
  }

  public syncReminderJobsForSession(sessionId: string): void {
    const sess = this.getSessionById(sessionId);
    if (!sess || sess.status !== 'SCHEDULED') return;

    const student = this.academicService.getUserById(sess.studentId);
    if (!student) return;

    const recipients: { user: UserAccount; pref: ReminderPreferenceRecord }[] = [
      {
        user: student,
        pref: this.getEffectiveReminderPref(student.id, 'student', student.id),
      },
    ];

    const links = this.getVerifiedLinksForStudent(student.id);
    for (const l of links) {
      if (!l.consentGiven || !l.canReceiveNotifications) continue;
      const g = this.academicService.getUserById(l.guardianUserId);
      if (g && g.active) {
        recipients.push({
          user: g,
          pref: this.getEffectiveReminderPref(g.id, 'parent', student.id),
        });
      }
    }

    const startMs = Date.parse(sess.scheduledStartUtc);
    const now = new Date().toISOString();

    this.dbWrapper.transaction(() => {
      // Cancel old pending jobs before inserting refreshed ones
      this.db
        .prepare(`UPDATE reminder_jobs SET status = 'CANCELLED' WHERE session_id = ? AND status = 'PENDING'`)
        .run(sessionId);

      const ins = this.db.prepare(
        `INSERT OR IGNORE INTO reminder_jobs (
          id, session_id, recipient_user_id, recipient_role, channel, lead_minutes,
          scheduled_for_utc, dedupe_key, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
      );

      for (const rec of recipients) {
        const activeChannels: ('in_app' | 'email' | 'whatsapp')[] = [];
        if (rec.pref.channels.inApp) activeChannels.push('in_app');
        if (rec.pref.channels.email) activeChannels.push('email');
        if (rec.pref.channels.whatsapp) activeChannels.push('whatsapp');

        for (const lead of rec.pref.leadTimesMinutes) {
          const fireMs = startMs - lead * 60_000;
          const fireIso = new Date(fireMs).toISOString();
          for (const ch of activeChannels) {
            const dedupeKey = `rem-${sessionId}-${sess.scheduledStartUtc}-${rec.user.id}-${ch}-${lead}`;
            ins.run(
              `RMJ-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
              sessionId,
              rec.user.id,
              rec.user.role,
              ch,
              lead,
              fireIso,
              dedupeKey,
              now
            );
          }
        }
      }
    });
  }

  public startScheduledSession(
    actor: UserAccount,
    sessionId: string
  ): {
    session: ScheduledSessionRecord;
    launchMode: 'practice_questions' | 'fixed_assessment' | 'fixed_paper';
    quizzes: QuizItem[];
    fixedAssessmentId?: string | null;
    fixedPaperId?: string | null;
  } {
    const sess = this.getSessionById(sessionId);
    if (!sess) throw new HttpError(404, 'Scheduled session not found.');
    if (actor.role === 'student' && actor.id !== sess.studentId) {
      throw new HttpError(403, 'Access denied: you may only start your own scheduled sessions.');
    }
    if (actor.role === 'parent') {
      this.assertCanManageStudentSchedule(actor, sess.studentId);
    }

    if (sess.status === 'CANCELLED' || sess.status === 'PAUSED' || sess.status === 'MISSED') {
      throw new HttpError(
        400,
        `Cannot start this session because its status is ${sess.status}. Reschedule or resume it first.`
      );
    }
    if (sess.status === 'COMPLETED' && sess.attemptsUsed >= sess.maxAttempts) {
      throw new HttpError(400, 'Maximum scheduled attempts have already been completed.');
    }

    let launchMode: 'practice_questions' | 'fixed_assessment' | 'fixed_paper' =
      'practice_questions';
    let quizzes: QuizItem[] = [];

    if (sess.fixedAssessmentId) {
      launchMode = 'fixed_assessment';
    } else if (sess.fixedPaperId) {
      launchMode = 'fixed_paper';
    } else {
      // Freeze snapshot if not already generated
      let snapshotIds = sess.questionSnapshotIds || [];
      if (snapshotIds.length === 0) {
        const selection = this.selectMatchingQuestionsForSchedule(sess.studentId, sess.filterCriteria);
        if (selection.selected.length === 0) {
          throw new HttpError(
            400,
            'No approved active questions match the scheduled criteria anymore. Update filters or reschedule.'
          );
        }
        snapshotIds = selection.selected.map((q) => q.id);
      }
      quizzes = snapshotIds
        .map((id) => this.academicService.resolveQuizById(id) || generateVirtualQuizFromPool(1))
        .filter(Boolean);

      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE scheduled_sessions SET
            status = 'IN_PROGRESS', attempts_used = attempts_used + 1,
            question_snapshot_ids_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(JSON.stringify(snapshotIds), now, sessionId);

      const updated = this.getSessionById(sessionId)!;
      return { session: updated, launchMode, quizzes };
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE scheduled_sessions SET
          status = 'IN_PROGRESS', attempts_used = attempts_used + 1, updated_at = ?
         WHERE id = ?`
      )
      .run(now, sessionId);

    return {
      session: this.getSessionById(sessionId)!,
      launchMode,
      quizzes,
      fixedAssessmentId: sess.fixedAssessmentId,
      fixedPaperId: sess.fixedPaperId,
    };
  }

  public completeScheduledSession(
    actor: UserAccount,
    sessionId: string,
    linkedAttemptId?: string | null
  ): ScheduledSessionRecord {
    const sess = this.getSessionById(sessionId);
    if (!sess) throw new HttpError(404, 'Scheduled session not found.');
    if (actor.role === 'student' && actor.id !== sess.studentId) {
      throw new HttpError(403, 'Access denied.');
    }
    if (actor.role === 'parent') {
      this.assertCanManageStudentSchedule(actor, sess.studentId);
    }

    const now = new Date().toISOString();
    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE scheduled_sessions SET
            status = 'COMPLETED', linked_attempt_id = COALESCE(?, linked_attempt_id),
            completed_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(linkedAttemptId || null, now, now, sessionId);

      this.db
        .prepare(`UPDATE reminder_jobs SET status = 'CANCELLED' WHERE session_id = ? AND status = 'PENDING'`)
        .run(sessionId);
    });

    this.writeScheduleAuditEvent({
      studentId: sess.studentId,
      actor,
      eventType: 'SESSION_COMPLETED',
      targetId: sessionId,
      summary: `Completed scheduled session "${sess.title}".`,
      metadata: { linkedAttemptId: linkedAttemptId || null },
    });

    return this.getSessionById(sessionId)!;
  }

  public runSchedulerSweep(nowMs = Date.now()): {
    missedMarked: number;
    remindersSent: number;
    remindersSkipped: number;
  } {
    const nowIso = new Date(nowMs).toISOString();
    let missedMarked = 0;
    let remindersSent = 0;
    let remindersSkipped = 0;

    // 1. Detect missed sessions cleanly beyond scheduled_end_utc + grace_period_minutes
    const candidateSessions = this.db
      .prepare(
        `SELECT * FROM scheduled_sessions
         WHERE status IN ('SCHEDULED', 'IN_PROGRESS')`
      )
      .all() as Record<string, unknown>[];

    for (const sRow of candidateSessions) {
      const sess = this.hydrateSessionRow(sRow);
      const endMs = Date.parse(sess.scheduledEndUtc);
      const graceEndMs = endMs + Math.max(0, sess.gracePeriodMinutes) * 60_000;
      if (nowMs > graceEndMs) {
        this.dbWrapper.transaction(() => {
          this.db
            .prepare(
              `UPDATE scheduled_sessions SET
                status = 'MISSED', missed_detected_at = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(nowIso, nowIso, sess.id);

          this.db
            .prepare(
              `UPDATE reminder_jobs SET status = 'CANCELLED' WHERE session_id = ? AND status = 'PENDING'`
            )
            .run(sess.id);
        });
        missedMarked++;

        // Notify student & verified guardians in-app (idempotent dedupe_key)
        const links = this.getVerifiedLinksForStudent(sess.studentId);
        const student = this.academicService.getUserById(sess.studentId);
        if (student) {
          this.academicService.insertNotificationRow({
            recipientUserId: student.id,
            recipientRole: 'student',
            channel: 'in_app',
            category: 'system_update',
            title: `Missed Study Window: ${sess.title}`,
            body: `Your scheduled "${sess.title}" window closed. Ask your guardian or reschedule when ready.`,
            relatedStudentId: student.id,
            dedupeKey: `missed-${sess.id}-${student.id}`,
            deliveryStatus: 'delivered',
          });
          for (const l of links) {
            if (l.canReceiveNotifications && l.consentGiven) {
              this.academicService.insertNotificationRow({
                recipientUserId: l.guardianUserId,
                recipientRole: 'parent',
                channel: 'in_app',
                category: 'system_update',
                title: `Missed Study Session · ${student.name}`,
                body: `${student.name}'s scheduled session "${sess.title}" was marked MISSED after the ${sess.gracePeriodMinutes}-minute grace window. You can reschedule it calmly from Parent Planner.`,
                relatedStudentId: student.id,
                dedupeKey: `missed-${sess.id}-${l.guardianUserId}`,
                deliveryStatus: 'delivered',
              });
            }
          }
        }
      }
    }

    // 2. Dispatch due pending reminder jobs idempotently
    const dueJobs = this.db
      .prepare(
        `SELECT * FROM reminder_jobs
         WHERE status = 'PENDING' AND scheduled_for_utc <= ?
         ORDER BY scheduled_for_utc ASC
         LIMIT 100`
      )
      .all(nowIso) as Record<string, unknown>[];

    for (const jRow of dueJobs) {
      const jobId = String(jRow.id);
      const sessionId = String(jRow.session_id);
      const sess = this.getSessionById(sessionId);
      if (!sess || sess.status !== 'SCHEDULED') {
        this.db
          .prepare(`UPDATE reminder_jobs SET status = 'CANCELLED' WHERE id = ?`)
          .run(jobId);
        continue;
      }

      // Skip if the session end window already passed
      if (Date.parse(sess.scheduledEndUtc) < nowMs) {
        this.db
          .prepare(`UPDATE reminder_jobs SET status = 'SKIPPED', error_message = 'Window elapsed' WHERE id = ?`)
          .run(jobId);
        remindersSkipped++;
        continue;
      }

      const recipient = this.academicService.getUserById(String(jRow.recipient_user_id));
      const student = this.academicService.getUserById(sess.studentId);
      if (!recipient || !student || !recipient.active) {
        this.db
          .prepare(`UPDATE reminder_jobs SET status = 'SKIPPED', error_message = 'Inactive account' WHERE id = ?`)
          .run(jobId);
        remindersSkipped++;
        continue;
      }

      if (recipient.role === 'parent') {
        const link = this.getVerifiedLink(recipient.id, student.id);
        if (!link || !link.consentGiven || !link.canReceiveNotifications) {
          this.db
            .prepare(`UPDATE reminder_jobs SET status = 'SKIPPED', error_message = 'No active consent/notification permission' WHERE id = ?`)
            .run(jobId);
          remindersSkipped++;
          continue;
        }
      }

      const channel = String(jRow.channel) as 'in_app' | 'email' | 'whatsapp';
      const leadMin = Number(jRow.lead_minutes);
      const timeRemainingText =
        leadMin === 0
          ? 'Starting now'
          : leadMin >= 60
          ? `Starts in ${Math.round(leadMin / 60)} hour(s)`
          : `Starts in ${leadMin} minutes`;
      const localFmt = formatUtcInTimeZone(sess.scheduledStartUtc, sess.timezone);
      const subjectLabel = sess.filterCriteria.subjectIds?.length
        ? sess.filterCriteria.subjectIds.join(', ')
        : sess.activityType;
      const activityPath = `/?session=${encodeURIComponent(sess.id)}`;

      if (channel === 'in_app') {
        this.academicService.insertNotificationRow({
          recipientUserId: recipient.id,
          recipientRole: recipient.role,
          channel: 'in_app',
          category: 'system_update',
          title: `Study Reminder (${timeRemainingText}): ${sess.title}`,
          body: `${student.name}: ${sess.title} at ${localFmt.readable} (${sess.timezone}) · ${sess.durationMinutes} min.`,
          relatedStudentId: student.id,
          dedupeKey: String(jRow.dedupe_key),
          deliveryStatus: 'delivered',
        });
      } else if (channel === 'email') {
        if (!recipient.emailVerified) {
          this.db
            .prepare(`UPDATE reminder_jobs SET status = 'SKIPPED', error_message = 'Unverified email' WHERE id = ?`)
            .run(jobId);
          remindersSkipped++;
          continue;
        }
        const emailContent = buildSessionReminderEmailHtml({
          recipientName: recipient.name,
          studentName: student.name,
          sessionTitle: sess.title,
          subjectLabel,
          localDateTimeReadable: localFmt.readable,
          timeZone: sess.timezone,
          durationMinutes: sess.durationMinutes,
          timeRemainingText,
          activityPath,
        });
        this.academicService.recordEmailLog({
          toEmail: recipient.email,
          subject: `Study Reminder (${timeRemainingText}): ${sess.title} · මං 5හේ`,
          category: 'reminder',
          htmlBody: emailContent.html,
        });
      } else if (channel === 'whatsapp') {
        if (recipient.whatsappVerified === false || !recipient.whatsappNumber) {
          this.db
            .prepare(`UPDATE reminder_jobs SET status = 'SKIPPED', error_message = 'Unverified WhatsApp' WHERE id = ?`)
            .run(jobId);
          remindersSkipped++;
          continue;
        }
        const wa = buildWhatsAppReminderPayload({
          studentName: student.name,
          sessionTitle: sess.title,
          subjectLabel,
          localDateTimeReadable: localFmt.readable,
          timeZone: sess.timezone,
          durationMinutes: sess.durationMinutes,
          timeRemainingText,
          activityPath,
        });
        this.academicService.recordWhatsAppLog({
          toNumber: recipient.whatsappNumber,
          category: 'reminder',
          messageText: `${wa.messageText}\n[Template: ${wa.templateName}]`,
        });
      }

      this.db
        .prepare(`UPDATE reminder_jobs SET status = 'SENT', sent_at = ? WHERE id = ?`)
        .run(nowIso, jobId);
      remindersSent++;
    }

    return { missedMarked, remindersSent, remindersSkipped };
  }

  public getStudentScheduleDashboard(actor: UserAccount, studentId: string) {
    if (actor.role === 'parent') this.assertCanViewStudentReports(actor, studentId);
    else if (actor.role === 'student' && actor.id !== studentId) {
      throw new HttpError(403, 'Access denied: cannot view another student timetable.');
    }

    this.runSchedulerSweep();

    const ttRows = this.db
      .prepare('SELECT * FROM student_timetables WHERE student_id = ? ORDER BY created_at DESC')
      .all(studentId) as Record<string, unknown>[];
    const timetables = ttRows.map((r) => this.hydrateTimetableRow(r));
    const sessions = this.getExistingSessionsForStudent(studentId).map((s) => ({
      ...s,
      countdown: computeSessionCountdownState(s),
    }));

    const remRows = this.db
      .prepare(
        `SELECT rj.* FROM reminder_jobs rj
         JOIN scheduled_sessions ss ON ss.id = rj.session_id
         WHERE ss.student_id = ?
         ORDER BY rj.scheduled_for_utc DESC LIMIT 40`
      )
      .all(studentId) as Record<string, unknown>[];

    const reminders: ReminderJobRecord[] = remRows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      recipientUserId: String(r.recipient_user_id),
      recipientRole: String(r.recipient_role) as UserRole,
      channel: String(r.channel) as ReminderJobRecord['channel'],
      leadMinutes: Number(r.lead_minutes),
      scheduledForUtc: String(r.scheduled_for_utc),
      dedupeKey: String(r.dedupe_key),
      status: String(r.status) as ReminderJobRecord['status'],
      sentAt: r.sent_at ? String(r.sent_at) : null,
      errorMessage: r.error_message ? String(r.error_message) : null,
      createdAt: String(r.created_at),
    }));

    const auditRows = this.db
      .prepare(
        `SELECT * FROM schedule_audit_events WHERE student_id = ? ORDER BY created_at DESC LIMIT 20`
      )
      .all(studentId) as Record<string, unknown>[];

    const links = this.getVerifiedLinksForStudent(studentId);
    const prefs = this.getReminderPreferences(actor, studentId);

    return {
      studentId,
      links,
      preferences: prefs,
      timetables,
      sessions,
      reminders,
      auditEvents: auditRows.map((a) => ({
        id: String(a.id),
        eventType: String(a.event_type),
        summary: String(a.summary),
        actorRole: String(a.actor_role),
        createdAt: String(a.created_at),
      })),
      presets: this.listTimetablePresets(actor),
    };
  }

  private getSessionById(sessionId: string): ScheduledSessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT ss.*, u.name AS student_name
         FROM scheduled_sessions ss
         JOIN users u ON u.id = ss.student_id
         WHERE ss.id = ?`
      )
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.hydrateSessionRow(row) : null;
  }

  private hydrateTimetableRow(row: Record<string, unknown>): StudentTimetable {
    return {
      id: String(row.id),
      studentId: String(row.student_id),
      createdByUserId: String(row.created_by_user_id),
      sourcePresetId: row.source_preset_id ? String(row.source_preset_id) : null,
      sourcePresetVersion:
        row.source_preset_version !== null && row.source_preset_version !== undefined
          ? Number(row.source_preset_version)
          : null,
      title: String(row.title),
      description: String(row.description || ''),
      timezone: String(row.timezone || 'Asia/Colombo'),
      startDate: String(row.start_date),
      endDate: row.end_date ? String(row.end_date) : null,
      recurrenceType: String(row.recurrence_type) as TimetableRecurrenceType,
      weekdays: parseJsonSafe(row.weekdays_json, []),
      exceptionDates: parseJsonSafe(row.exception_dates_json, []),
      status: String(row.status) as StudentTimetable['status'],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private hydrateSessionRow(row: Record<string, unknown>): ScheduledSessionRecord {
    return {
      id: String(row.id),
      timetableId: row.timetable_id ? String(row.timetable_id) : null,
      studentId: String(row.student_id),
      studentName: row.student_name ? String(row.student_name) : undefined,
      createdByUserId: String(row.created_by_user_id),
      title: String(row.title),
      activityType: String(row.activity_type) as LearningActivityType,
      timezone: String(row.timezone || 'Asia/Colombo'),
      scheduledStartUtc: String(row.scheduled_start_utc),
      scheduledEndUtc: String(row.scheduled_end_utc),
      durationMinutes: Number(row.duration_minutes),
      gracePeriodMinutes: Number(row.grace_period_minutes ?? 15),
      recurrenceKey: String(row.recurrence_key),
      status: String(row.status) as ScheduledSessionStatus,
      maxAttempts: Number(row.max_attempts ?? 1),
      attemptsUsed: Number(row.attempts_used ?? 0),
      filterCriteria: parseJsonSafe(row.filter_criteria_json, { subjectIds: [] }),
      questionSnapshotIds: parseJsonSafe(row.question_snapshot_ids_json, []),
      fixedAssessmentId: row.fixed_assessment_id ? String(row.fixed_assessment_id) : null,
      fixedPaperId: row.fixed_paper_id ? String(row.fixed_paper_id) : null,
      linkedAttemptId: row.linked_attempt_id ? String(row.linked_attempt_id) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      missedDetectedAt: row.missed_detected_at ? String(row.missed_detected_at) : null,
      notes: String(row.notes || ''),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private writeScheduleAuditEvent(params: {
    studentId: string;
    actor: UserAccount;
    eventType: string;
    targetId: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }) {
    this.db
      .prepare(
        `INSERT INTO schedule_audit_events (id, student_id, actor_id, actor_role, event_type, target_id, summary, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `SAE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        params.studentId,
        params.actor.id,
        params.actor.role,
        params.eventType,
        params.targetId,
        params.summary,
        JSON.stringify(params.metadata || {}),
        new Date().toISOString()
      );
  }
}
