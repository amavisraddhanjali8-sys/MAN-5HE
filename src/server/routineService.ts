import crypto from 'node:crypto';
import { canAccessSubject } from '../lib/authorization.ts';
import { convertLocalDateTimeToUtcIso, detectScheduleConflicts, isValidTimeZone } from '../lib/learningScheduler.ts';
import { buildEmailTextAndHtml } from '../lib/notifications.ts';
import {
  buildAllocationPlan,
  computeMaterialHash,
  DEFAULT_ADAPTIVE_BOUNDS,
  EDUCATIONAL_SKILL_DISCLAIMER,
  EDUCATIONAL_SKILL_DEFINITIONS,
  mapQuestionToDefaultSkills,
  planRoutineOccurrences,
  resolveQuestionDifficultyBucket,
  selectQuestionsForWeightedRoutine,
  SKILL_LABEL_MAP,
  validateRoutineConfig,
} from '../lib/routineEngine.ts';
import type {
  AcademicRoutineConfigInput,
  AcademicRoutineDetail,
  AcademicRoutineRecord,
  EducationalSkillCategory,
  ParentScheduleDecision,
  QuestionSkillMappingRecord,
  QuestionStats,
  QuizItem,
  RoutineAdaptiveAdjustment,
  RoutineAdminEvaluation,
  RoutineApprovalHistoryEntry,
  RoutineChangeRequest,
  RoutineDifficultyDistribution,
  RoutinePerformanceSummary,
  RoutineReviewAssignment,
  RoutineSkillWeight,
  RoutineSubjectWeight,
  RoutineTeacherEvaluation,
  RoutineValidationReport,
  RoutineVersionRecord,
  RoutineWorkflowStatus,
  ScheduledSessionRecord,
  SkillClassificationSource,
  StudentQuestionStat,
  StudentTimetable,
  UserAccount,
} from '../lib/types.ts';
import { AcademicService, HttpError, rowToQuiz } from './academicService.ts';
import { ParentIntelligenceService } from './parentIntelligenceService.ts';
import { WellbeingService } from './wellbeingService.ts';

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class AcademicRoutineService {
  private readonly academic: AcademicService;
  private readonly parentIntel: ParentIntelligenceService;
  private readonly wellbeing: WellbeingService;

  constructor(
    academic: AcademicService,
    parentIntel: ParentIntelligenceService,
    wellbeing: WellbeingService
  ) {
    this.academic = academic;
    this.parentIntel = parentIntel;
    this.wellbeing = wellbeing;
  }

  private get dbWrapper() {
    return this.academic.dbWrapper;
  }

  private get db() {
    return this.dbWrapper.db;
  }

  // =========================================================================
  // 1. ACCESS CONTROL & HELPERS
  // =========================================================================

  private assertGuardianOrAdminCanManage(actor: UserAccount, studentId: string): void {
    if (actor.role === 'admin') return;
    if (actor.role === 'parent') {
      const link = this.db
        .prepare(
          `SELECT * FROM guardian_student_links
           WHERE guardian_user_id = ? AND student_user_id = ? AND verified = 1`
        )
        .get(actor.id, studentId) as Record<string, unknown> | undefined;
      if (!link || Number(link.can_manage_schedule) !== 1) {
        throw new HttpError(403, 'Verified guardian with schedule management permission is required.');
      }
      return;
    }
    throw new HttpError(403, 'Only linked guardians or administrators can manage academic routines.');
  }

  private assertCanViewRoutine(actor: UserAccount, routineRow: Record<string, unknown>): void {
    const studentId = String(routineRow.student_id);
    if (actor.role === 'admin') return;
    if (actor.role === 'student') {
      if (actor.id !== studentId) throw new HttpError(403, 'Access denied to another student routine.');
      return;
    }
    if (actor.role === 'parent') {
      const link = this.db
        .prepare(
          `SELECT 1 FROM guardian_student_links
           WHERE guardian_user_id = ? AND student_user_id = ? AND verified = 1`
        )
        .get(actor.id, studentId);
      if (!link) throw new HttpError(403, 'Access denied: student is not linked to your guardian account.');
      return;
    }
    if (actor.role === 'teacher') {
      const assigned = this.academic.getTeacherAssignedSubjectIds(actor.id);
      const latestVer = this.db
        .prepare(
          `SELECT id FROM routine_versions WHERE routine_id = ? ORDER BY version_number DESC LIMIT 1`
        )
        .get(String(routineRow.id)) as { id: string } | undefined;
      if (!latestVer) throw new HttpError(403, 'Routine version not found.');
      const subjRows = this.db
        .prepare(
          `SELECT subject_id FROM routine_subject_weights WHERE routine_version_id = ? AND enabled = 1`
        )
        .all(latestVer.id) as { subject_id: string }[];
      const hasOverlap = subjRows.some((s) => assigned.includes(s.subject_id));
      if (!hasOverlap) {
        throw new HttpError(
          403,
          'Access denied: this routine does not include any of your assigned teaching subjects.'
        );
      }
      return;
    }
    throw new HttpError(403, 'Unauthorized role.');
  }

  private getCurriculumLookups() {
    const subjRows = this.db.prepare('SELECT id, name_en FROM subjects').all() as {
      id: string;
      name_en: string;
    }[];
    const subjectsMap = new Map(subjRows.map((s) => [s.id, s.name_en]));
    return { subjectsMap };
  }

  private loadQuestionStatsAndSkills(studentId: string) {
    const qRows = this.db
      .prepare(`SELECT * FROM questions WHERE active = 1 AND COALESCE(approval_status,'ACTIVE') = 'ACTIVE'`)
      .all() as Record<string, unknown>[];
    const pool: QuizItem[] = qRows.map((r) => rowToQuiz(r));

    const statRows = this.db.prepare('SELECT * FROM question_stats').all() as Record<string, unknown>[];
    const questionStatsMap = new Map<string, QuestionStats>();
    for (const r of statRows) {
      questionStatsMap.set(String(r.question_id), {
        questionId: String(r.question_id),
        subjectId: String(r.subject_id),
        totalEvents: Number(r.total_events ?? 0),
        validAttempts: Number(r.valid_attempts ?? 0),
        skippedCount: Number(r.skipped_count ?? 0),
        timedOutCount: Number(r.timed_out_count ?? 0),
        uniqueStudents: Number(r.unique_students ?? 0),
        correctAttempts: Number(r.correct_attempts ?? 0),
        incorrectAttempts: Number(r.incorrect_attempts ?? 0),
        correctRate: Number(r.correct_rate ?? 0),
        incorrectRate: Number(r.incorrect_rate ?? 0),
        firstAttemptTotal: Number(r.first_attempt_total ?? 0),
        firstAttemptCorrect: Number(r.first_attempt_correct ?? 0),
        repeatAttemptTotal: Number(r.repeat_attempt_total ?? 0),
        repeatAttemptCorrect: Number(r.repeat_attempt_correct ?? 0),
        hintAssistedTotal: Number(r.hint_assisted_total ?? 0),
        hintAssistedCorrect: Number(r.hint_assisted_correct ?? 0),
        unassistedTotal: Number(r.unassisted_total ?? 0),
        unassistedCorrect: Number(r.unassisted_correct ?? 0),
        repeatedErrorStudentCount: Number(r.repeated_error_student_count ?? 0),
        medianResponseMs: Number(r.median_response_ms ?? 0),
        p90ResponseMs: Number(r.p90_response_ms ?? 0),
        updatedAt: String(r.updated_at || ''),
      });
    }

    const sRows = this.db
      .prepare('SELECT * FROM student_question_stats WHERE student_id = ?')
      .all(studentId) as Record<string, unknown>[];
    const studentStatsMap = new Map<string, StudentQuestionStat>();
    for (const r of sRows) {
      studentStatsMap.set(String(r.question_id), {
        studentId: String(r.student_id),
        questionId: String(r.question_id),
        subjectId: String(r.subject_id),
        validAttempts: Number(r.valid_attempts ?? 0),
        correctAttempts: Number(r.correct_attempts ?? 0),
        incorrectAttempts: Number(r.incorrect_attempts ?? 0),
        lastAttemptAt: String(r.last_attempt_at || ''),
      });
    }

    const skillRows = this.db
      .prepare('SELECT question_id, skill_key FROM question_skill_mappings')
      .all() as { question_id: string; skill_key: EducationalSkillCategory }[];
    const questionSkillMap = new Map<string, EducationalSkillCategory[]>();
    for (const r of skillRows) {
      const list = questionSkillMap.get(r.question_id) || [];
      list.push(r.skill_key);
      questionSkillMap.set(r.question_id, list);
    }

    const caseRows = this.db
      .prepare(
        `SELECT question_id FROM intervention_cases
         WHERE student_id = ? AND status IN ('OPEN','UNDER_REVIEW','INTERVENTION_ASSIGNED','MONITORING')`
      )
      .all(studentId) as { question_id: string }[];
    const repeatedErrorQuestionIds = new Set(caseRows.map((c) => c.question_id));

    return { pool, questionStatsMap, studentStatsMap, questionSkillMap, repeatedErrorQuestionIds };
  }

  // =========================================================================
  // 2. SKILL TAXONOMY & LIVE ROUTINE VALIDATION / ALLOCATION PREVIEW
  // =========================================================================

  public getSkillTaxonomy() {
    return {
      disclaimer: EDUCATIONAL_SKILL_DISCLAIMER,
      skills: EDUCATIONAL_SKILL_DEFINITIONS,
    };
  }

  public listQuestionSkillMappings(questionId?: string): QuestionSkillMappingRecord[] {
    const rows = questionId
      ? (this.db
          .prepare('SELECT * FROM question_skill_mappings WHERE question_id = ? ORDER BY created_at ASC')
          .all(questionId) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM question_skill_mappings ORDER BY question_id ASC')
          .all() as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: String(r.id),
      questionId: String(r.question_id),
      skillKey: String(r.skill_key) as EducationalSkillCategory,
      classificationSource: String(r.classification_source) as SkillClassificationSource,
      confidenceNote: String(r.confidence_note || ''),
      educationalDisclaimer: String(r.educational_disclaimer || EDUCATIONAL_SKILL_DISCLAIMER),
      createdAt: String(r.created_at),
    }));
  }

  public updateQuestionSkillMappings(
    actor: UserAccount,
    questionId: string,
    skills: EducationalSkillCategory[]
  ): QuestionSkillMappingRecord[] {
    if (actor.role !== 'admin' && actor.role !== 'teacher') {
      throw new HttpError(403, 'Only authorized teachers or administrators can update skill classifications.');
    }
    const qRow = this.db
      .prepare('SELECT id, subject_id FROM questions WHERE id = ?')
      .get(questionId) as { id: string; subject_id: string } | undefined;
    if (!qRow) throw new HttpError(404, 'Question not found.');

    if (actor.role === 'teacher') {
      const ctx = this.academic.buildAuthContext(actor);
      if (!canAccessSubject(ctx, qRow.subject_id)) {
        throw new HttpError(403, 'Access denied: question belongs to a subject outside your assignment.');
      }
    }

    const cleanSkills = Array.from(new Set(skills)).filter((s) => SKILL_LABEL_MAP.has(s));
    if (cleanSkills.length === 0) {
      throw new HttpError(400, 'At least one educational skill category must be assigned.');
    }

    const now = new Date().toISOString();
    this.dbWrapper.transaction(() => {
      this.db.prepare('DELETE FROM question_skill_mappings WHERE question_id = ?').run(questionId);
      const ins = this.db.prepare(
        `INSERT INTO question_skill_mappings (
          id, question_id, skill_key, classification_source, confidence_note, educational_disclaimer, created_at
        ) VALUES (?, ?, ?, 'teacher_tag', ?, ?, ?)`
      );
      cleanSkills.forEach((sk, i) => {
        ins.run(
          `QSM-${questionId}-${crypto.randomBytes(2).toString('hex')}-${i}`,
          questionId,
          sk,
          `Tagged by ${actor.name} (${actor.role})`,
          EDUCATIONAL_SKILL_DISCLAIMER,
          now
        );
      });
    });

    return this.listQuestionSkillMappings(questionId);
  }

  public previewRoutineValidation(
    actor: UserAccount,
    input: AcademicRoutineConfigInput
  ): RoutineValidationReport {
    this.assertGuardianOrAdminCanManage(actor, input.studentId);
    const configCheck = validateRoutineConfig(input);
    const { subjectsMap } = this.getCurriculumLookups();
    const {
      pool,
      questionStatsMap,
      studentStatsMap,
      questionSkillMap,
      repeatedErrorQuestionIds,
    } = this.loadQuestionStatsAndSkills(input.studentId);

    const allocationPlan = buildAllocationPlan({
      questionCount: input.questionCountPerSession || 6,
      subjectWeights: input.subjectWeights || [],
      skillWeights: input.skillWeights || [],
      difficultyDistribution: input.difficultyDistribution || {
        simple: 30,
        moderate: 50,
        difficult: 20,
        useEmpiricalCalibration: true,
      },
    });

    const questionPreview = selectQuestionsForWeightedRoutine({
      questionPool: pool,
      questionStatsMap,
      studentStatsMap,
      questionSkillMap,
      repeatedErrorQuestionIds,
      subjectWeights: input.subjectWeights || [],
      skillWeights: input.skillWeights || [],
      difficultyDistribution: input.difficultyDistribution || {
        simple: 30,
        moderate: 50,
        difficult: 20,
        useEmpiricalCalibration: true,
      },
      grade: input.grade || 'Grade 5',
      questionCount: input.questionCountPerSession || 6,
      exposurePreference: input.exposurePreference || 'weak_areas',
      excludedQuestionIds: input.excludedQuestionIds,
      subjectNameLookup: subjectsMap,
    });

    const warnings = [...configCheck.warnings];
    for (const s of questionPreview.shortages) {
      warnings.push(s.explanation);
    }

    const plannedSlots = configCheck.valid
      ? planRoutineOccurrences({
          input,
          selectedQuestions: questionPreview.selectedQuestions,
          subjectNameLookup: subjectsMap,
          maxOccurrences: 14,
        })
      : [];

    const existingSessions = this.db
      .prepare(`SELECT * FROM scheduled_sessions WHERE student_id = ? AND status != 'CANCELLED'`)
      .all(input.studentId) as Record<string, unknown>[];

    const existingForConflict: ScheduledSessionRecord[] = existingSessions.map((r) => ({
      id: String(r.id),
      timetableId: r.timetable_id ? String(r.timetable_id) : null,
      studentId: String(r.student_id),
      createdByUserId: String(r.created_by_user_id),
      title: String(r.title),
      activityType: String(r.activity_type) as ScheduledSessionRecord['activityType'],
      timezone: String(r.timezone),
      scheduledStartUtc: String(r.scheduled_start_utc),
      scheduledEndUtc: String(r.scheduled_end_utc),
      durationMinutes: Number(r.duration_minutes),
      gracePeriodMinutes: Number(r.grace_period_minutes),
      recurrenceKey: String(r.recurrence_key),
      status: String(r.status) as ScheduledSessionRecord['status'],
      maxAttempts: Number(r.max_attempts),
      attemptsUsed: Number(r.attempts_used),
      filterCriteria: parseJsonSafe(r.filter_criteria_json, { subjectIds: [] }),
      notes: String(r.notes || ''),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));

    const scheduleConflicts =
      plannedSlots.length > 0
        ? detectScheduleConflicts(
            existingForConflict,
            plannedSlots.map((s) => ({
              startUtc: s.startUtc,
              endUtc: s.endUtc,
              title: s.title,
            }))
          )
        : [];

    const enabledSubjIds = (input.subjectWeights || [])
      .filter((s) => s.enabled)
      .map((s) => s.subjectId);

    const wellbeingCheck =
      plannedSlots.length > 0
        ? this.wellbeing.validatePreSchedule(actor, {
            studentId: input.studentId,
            subjectIds: enabledSubjIds,
            proposedSlots: plannedSlots.map((s) => ({
              localDate: s.localDate,
              startUtc: s.startUtc,
              endUtc: s.endUtc,
              durationMinutes: s.durationMinutes,
              title: s.title,
            })),
          })
        : null;

    if (wellbeingCheck && wellbeingCheck.severity !== 'nominal') {
      warnings.push(wellbeingCheck.supportiveTitle + ': ' + wellbeingCheck.supportiveMessage);
    }

    return {
      valid: configCheck.valid,
      errors: configCheck.errors,
      warnings,
      subjectWeightTotal: configCheck.subjectWeightTotal,
      skillWeightTotal: configCheck.skillWeightTotal,
      difficultyTotal: configCheck.difficultyTotal,
      allocationPlan,
      questionPreview,
      plannedSlots,
      scheduleConflicts,
      wellbeingCheck,
    };
  }

  // =========================================================================
  // 3. HYDRATION & CRUD WITH VERSIONING
  // =========================================================================

  private hydrateVersion(verRow: Record<string, unknown>): RoutineVersionRecord {
    const verId = String(verRow.id);
    const { subjectsMap } = this.getCurriculumLookups();

    const subjRows = this.db
      .prepare('SELECT * FROM routine_subject_weights WHERE routine_version_id = ?')
      .all(verId) as Record<string, unknown>[];
    const subjectWeights: RoutineSubjectWeight[] = subjRows.map((s) => ({
      subjectId: String(s.subject_id),
      subjectName: subjectsMap.get(String(s.subject_id)) || String(s.subject_id),
      enabled: Number(s.enabled) === 1,
      weightPercent: Number(s.weight_percent),
      topicIds: parseJsonSafe<string[]>(s.topic_ids_json, []),
      subtopicIds: parseJsonSafe<string[]>(s.subtopic_ids_json, []),
    }));

    const skillRows = this.db
      .prepare('SELECT * FROM routine_skill_weights WHERE routine_version_id = ?')
      .all(verId) as Record<string, unknown>[];
    const skillWeights: RoutineSkillWeight[] = skillRows.map((sk) => {
      const key = String(sk.skill_key) as EducationalSkillCategory;
      return {
        skillKey: key,
        skillLabel: SKILL_LABEL_MAP.get(key) || key,
        enabled: Number(sk.enabled) === 1,
        weightPercent: Number(sk.weight_percent),
        isEducationalCategory: true,
      };
    });

    const diffRow = this.db
      .prepare('SELECT * FROM routine_difficulty_distributions WHERE routine_version_id = ?')
      .get(verId) as Record<string, unknown> | undefined;
    const difficultyDistribution: RoutineDifficultyDistribution = {
      simple: Number(diffRow?.simple_percent ?? 30),
      moderate: Number(diffRow?.moderate_percent ?? 50),
      difficult: Number(diffRow?.difficult_percent ?? 20),
      useEmpiricalCalibration: Number(diffRow?.use_empirical_calibration ?? 1) === 1,
    };

    return {
      id: verId,
      routineId: String(verRow.routine_id),
      versionNumber: Number(verRow.version_number),
      title: String(verRow.title),
      description: String(verRow.description || ''),
      grade: String(verRow.grade || 'Grade 5'),
      startDate: String(verRow.start_date),
      startTimeOfDay: String(verRow.start_time_of_day),
      timezone: String(verRow.timezone || 'Asia/Colombo'),
      recurrenceType: String(verRow.recurrence_type) as RoutineVersionRecord['recurrenceType'],
      weekdays: parseJsonSafe<number[]>(verRow.weekdays_json, []),
      endDate: verRow.end_date ? String(verRow.end_date) : null,
      totalDurationWeeks: verRow.total_duration_weeks ? Number(verRow.total_duration_weeks) : null,
      exceptionDates: parseJsonSafe<string[]>(verRow.exception_dates_json, []),
      mixingMethod: String(verRow.mixing_method) as RoutineVersionRecord['mixingMethod'],
      subjectWeights,
      skillWeights,
      difficultyDistribution,
      questionCountPerSession: Number(verRow.question_count_per_session),
      sessionDurationMinutes: Number(verRow.session_duration_minutes),
      practiceRatioPercent: Number(verRow.practice_ratio_percent),
      mockFrequencyDays: Number(verRow.mock_frequency_days ?? 5),
      exposurePreference: String(verRow.exposure_preference) as RoutineVersionRecord['exposurePreference'],
      scheduleMode: String(verRow.schedule_mode) as RoutineVersionRecord['scheduleMode'],
      breakIntervalMinutes: Number(verRow.break_interval_minutes),
      breakDurationMinutes: Number(verRow.break_duration_minutes),
      dailyRuleOverrides: parseJsonSafe(verRow.daily_rule_overrides_json, []),
      adaptiveBounds: parseJsonSafe(verRow.adaptive_bounds_json, DEFAULT_ADAPTIVE_BOUNDS),
      reminderConfig: parseJsonSafe(verRow.reminder_config_json, {
        enabled: true,
        leadTimesMinutes: [60, 15],
        channels: { inApp: true, email: true, whatsapp: true },
      }),
      excludedQuestionIds: parseJsonSafe(verRow.excluded_question_ids_json, []),
      materialHash: String(verRow.material_hash),
      requiresReReview: Number(verRow.requires_re_review ?? 0) === 1,
      changeNote: String(verRow.change_note || ''),
      createdByUserId: String(verRow.created_by_user_id),
      createdAt: String(verRow.created_at),
    };
  }

  private hydrateRoutineRecord(row: Record<string, unknown>): AcademicRoutineRecord {
    const student = this.academic.getUserById(String(row.student_id));
    const guardian = this.academic.getUserById(String(row.guardian_user_id));
    return {
      id: String(row.id),
      studentId: String(row.student_id),
      studentName: student?.name || String(row.student_id),
      studentGrade: student?.grade || 'Grade 5',
      guardianUserId: String(row.guardian_user_id),
      guardianName: guardian?.name || String(row.guardian_user_id),
      title: String(row.title),
      description: String(row.description || ''),
      workflowStatus: String(row.workflow_status) as RoutineWorkflowStatus,
      scheduleMode: String(row.schedule_mode) as AcademicRoutineRecord['scheduleMode'],
      currentVersionNumber: Number(row.current_version_number),
      activeVersionNumber:
        row.active_version_number !== null && row.active_version_number !== undefined
          ? Number(row.active_version_number)
          : null,
      linkedTimetableId: row.linked_timetable_id ? String(row.linked_timetable_id) : null,
      requiresReReview: Number(row.requires_re_review ?? 0) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private insertRoutineVersionSnapshot(params: {
    routineId: string;
    versionNumber: number;
    input: AcademicRoutineConfigInput;
    actor: UserAccount;
    requiresReReview: boolean;
    materialHash: string;
    now: string;
  }): string {
    const { input, routineId, versionNumber, actor, requiresReReview, materialHash, now } = params;
    const verId = `RTNV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    this.db
      .prepare(
        `INSERT INTO routine_versions (
          id, routine_id, version_number, title, description, grade, start_date, start_time_of_day,
          timezone, recurrence_type, weekdays_json, end_date, total_duration_weeks, exception_dates_json,
          mixing_method, question_count_per_session, session_duration_minutes, practice_ratio_percent,
          mock_frequency_days, exposure_preference, schedule_mode, break_interval_minutes, break_duration_minutes,
          daily_rule_overrides_json, adaptive_bounds_json, reminder_config_json, excluded_question_ids_json,
          material_hash, requires_re_review, change_note, created_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        verId,
        routineId,
        versionNumber,
        String(input.title).trim(),
        String(input.description || '').trim(),
        String(input.grade || 'Grade 5'),
        input.startDate,
        input.startTimeOfDay,
        input.timezone || 'Asia/Colombo',
        input.recurrenceType,
        JSON.stringify(input.weekdays || []),
        input.endDate || null,
        input.totalDurationWeeks || null,
        JSON.stringify(input.exceptionDates || []),
        input.mixingMethod,
        Math.round(Number(input.questionCountPerSession || 6)),
        Math.round(Number(input.sessionDurationMinutes || 30)),
        Math.round(Number(input.practiceRatioPercent ?? 75)),
        Math.max(1, Math.round(Number(input.mockFrequencyDays ?? 5))),
        input.exposurePreference || 'weak_areas',
        input.scheduleMode || 'fixed',
        Math.max(10, Math.round(Number(input.breakIntervalMinutes ?? 25))),
        Math.max(0, Math.round(Number(input.breakDurationMinutes ?? 10))),
        JSON.stringify(input.dailyRuleOverrides || []),
        JSON.stringify(input.adaptiveBounds || DEFAULT_ADAPTIVE_BOUNDS),
        JSON.stringify(
          input.reminderConfig || {
            enabled: true,
            leadTimesMinutes: [60, 15],
            channels: { inApp: true, email: true, whatsapp: true },
          }
        ),
        JSON.stringify(input.excludedQuestionIds || []),
        materialHash,
        requiresReReview ? 1 : 0,
        String(input.changeNote || 'Routine configuration saved').trim(),
        actor.id,
        now
      );

    const insSubj = this.db.prepare(
      `INSERT INTO routine_subject_weights (
        id, routine_version_id, subject_id, enabled, weight_percent, topic_ids_json, subtopic_ids_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insTop = this.db.prepare(
      `INSERT INTO routine_topic_weights (id, routine_version_id, subject_id, topic_id, subtopic_id)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const sw of input.subjectWeights || []) {
      insSubj.run(
        `RSW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        verId,
        sw.subjectId,
        sw.enabled ? 1 : 0,
        Number(sw.weightPercent || 0),
        JSON.stringify(sw.topicIds || []),
        JSON.stringify(sw.subtopicIds || [])
      );
      if (sw.enabled) {
        for (const tid of sw.topicIds || []) {
          insTop.run(
            `RTW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            verId,
            sw.subjectId,
            tid,
            null
          );
        }
      }
    }

    const insSkill = this.db.prepare(
      `INSERT INTO routine_skill_weights (id, routine_version_id, skill_key, enabled, weight_percent)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const sk of input.skillWeights || []) {
      insSkill.run(
        `RSKW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        verId,
        sk.skillKey,
        sk.enabled ? 1 : 0,
        Number(sk.weightPercent || 0)
      );
    }

    const diff = input.difficultyDistribution || {
      simple: 30,
      moderate: 50,
      difficult: 20,
      useEmpiricalCalibration: true,
    };
    this.db
      .prepare(
        `INSERT INTO routine_difficulty_distributions (
          routine_version_id, simple_percent, moderate_percent, difficult_percent, use_empirical_calibration
        ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        verId,
        Number(diff.simple),
        Number(diff.moderate),
        Number(diff.difficult),
        diff.useEmpiricalCalibration !== false ? 1 : 0
      );

    this.db
      .prepare(
        `INSERT INTO routine_scheduling_rules (
          routine_version_id, mixing_method, recurrence_type, break_interval_minutes,
          break_duration_minutes, practice_ratio_percent, mock_frequency_days, exposure_preference
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        verId,
        input.mixingMethod,
        input.recurrenceType,
        Math.max(10, Number(input.breakIntervalMinutes ?? 25)),
        Math.max(0, Number(input.breakDurationMinutes ?? 10)),
        Math.round(Number(input.practiceRatioPercent ?? 75)),
        Math.max(1, Number(input.mockFrequencyDays ?? 5)),
        input.exposurePreference || 'weak_areas'
      );

    return verId;
  }

  public createRoutine(
    actor: UserAccount,
    input: AcademicRoutineConfigInput
  ): AcademicRoutineDetail {
    this.assertGuardianOrAdminCanManage(actor, input.studentId);
    const check = validateRoutineConfig(input);
    if (!check.valid) {
      throw new HttpError(400, check.errors[0]);
    }

    const routineId = `RTN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const mHash = computeMaterialHash(input);

    let verId = '';
    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO parent_academic_routines (
            id, student_id, guardian_user_id, title, description, workflow_status, schedule_mode,
            current_version_number, active_version_number, linked_timetable_id, requires_re_review,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, 1, NULL, NULL, 0, ?, ?)`
        )
        .run(
          routineId,
          input.studentId,
          actor.role === 'parent' ? actor.id : actor.id,
          String(input.title).trim(),
          String(input.description || '').trim(),
          input.scheduleMode || 'fixed',
          now,
          now
        );

      verId = this.insertRoutineVersionSnapshot({
        routineId,
        versionNumber: 1,
        input,
        actor,
        requiresReReview: false,
        materialHash: mHash,
        now,
      });

      this.db
        .prepare(
          `INSERT INTO routine_approval_history (
            id, routine_id, routine_version_id, actor_id, actor_name, actor_role,
            from_status, to_status, action, note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'DRAFT', 'ROUTINE_CREATED', ?, ?)`
        )
        .run(
          `RAH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          routineId,
          verId,
          actor.id,
          actor.name,
          actor.role,
          'Initial academic routine draft created.',
          now
        );
    });

    this.academic.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'ACADEMIC_ROUTINE_CREATED',
      targetType: 'parent_academic_routine',
      targetId: routineId,
      details: { studentId: input.studentId, scheduleMode: input.scheduleMode, versionNumber: 1 },
    });

    return this.getRoutineDetail(actor, routineId);
  }

  public updateRoutine(
    actor: UserAccount,
    routineId: string,
    input: AcademicRoutineConfigInput
  ): AcademicRoutineDetail {
    const existingRow = this.db
      .prepare('SELECT * FROM parent_academic_routines WHERE id = ?')
      .get(routineId) as Record<string, unknown> | undefined;
    if (!existingRow) throw new HttpError(404, 'Academic routine not found.');
    const studentId = String(existingRow.student_id);
    this.assertGuardianOrAdminCanManage(actor, studentId);

    const check = validateRoutineConfig({ ...input, studentId });
    if (!check.valid) throw new HttpError(400, check.errors[0]);

    const prevStatus = String(existingRow.workflow_status) as RoutineWorkflowStatus;
    const prevVerNum = Number(existingRow.current_version_number);
    const prevVerRow = this.db
      .prepare('SELECT * FROM routine_versions WHERE routine_id = ? AND version_number = ?')
      .get(routineId, prevVerNum) as Record<string, unknown>;
    const prevHash = String(prevVerRow?.material_hash || '');
    const nextHash = computeMaterialHash({ ...input, studentId });
    const materialChanged = prevHash !== nextHash;

    // Require fresh staff review whenever material academic settings change on an APPROVED or ACTIVE routine
    const wasApprovedOrActive = prevStatus === 'APPROVED' || prevStatus === 'ACTIVE';
    const requiresReReview = wasApprovedOrActive && materialChanged;
    const nextStatus: RoutineWorkflowStatus = requiresReReview
      ? 'DRAFT'
      : prevStatus === 'CHANGES_REQUESTED'
      ? 'DRAFT'
      : prevStatus;

    const nextVerNum = prevVerNum + 1;
    const now = new Date().toISOString();

    this.dbWrapper.transaction(() => {
      const verId = this.insertRoutineVersionSnapshot({
        routineId,
        versionNumber: nextVerNum,
        input: { ...input, studentId },
        actor,
        requiresReReview,
        materialHash: nextHash,
        now,
      });

      this.db
        .prepare(
          `UPDATE parent_academic_routines SET
            title = ?, description = ?, workflow_status = ?, schedule_mode = ?,
            current_version_number = ?, requires_re_review = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          String(input.title).trim(),
          String(input.description || '').trim(),
          nextStatus,
          input.scheduleMode || 'fixed',
          nextVerNum,
          requiresReReview ? 1 : 0,
          now,
          routineId
        );

      if (requiresReReview) {
        this.db
          .prepare(
            `UPDATE routine_change_requests SET status = 'ADDRESSED', resolved_at = ?
             WHERE routine_id = ? AND status = 'OPEN'`
          )
          .run(now, routineId);
      }

      this.db
        .prepare(
          `INSERT INTO routine_approval_history (
            id, routine_id, routine_version_id, actor_id, actor_name, actor_role,
            from_status, to_status, action, note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `RAH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          routineId,
          verId,
          actor.id,
          actor.name,
          actor.role,
          prevStatus,
          nextStatus,
          requiresReReview ? 'MATERIAL_EDIT_REQUIRES_RE_REVIEW' : 'ROUTINE_VERSION_UPDATED',
          requiresReReview
            ? `Material academic changes created v${nextVerNum}; status reset to DRAFT for fresh teacher/admin review.`
            : String(input.changeNote || `Updated to version v${nextVerNum}.`),
          now
        );
    });

    return this.getRoutineDetail(actor, routineId);
  }

  public listRoutines(
    actor: UserAccount,
    filters?: { studentId?: string; status?: RoutineWorkflowStatus }
  ): AcademicRoutineDetail[] {
    const rows = this.db
      .prepare('SELECT * FROM parent_academic_routines ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[];

    const out: AcademicRoutineDetail[] = [];
    for (const r of rows) {
      if (filters?.studentId && String(r.student_id) !== filters.studentId) continue;
      if (filters?.status && String(r.workflow_status) !== filters.status) continue;
      try {
        this.assertCanViewRoutine(actor, r);
        out.push(this.getRoutineDetail(actor, String(r.id)));
      } catch {
        // out of scope for actor
      }
    }
    return out;
  }

  public getRoutineDetail(actor: UserAccount, routineId: string): AcademicRoutineDetail {
    const rRow = this.db
      .prepare('SELECT * FROM parent_academic_routines WHERE id = ?')
      .get(routineId) as Record<string, unknown> | undefined;
    if (!rRow) throw new HttpError(404, 'Academic routine not found.');
    this.assertCanViewRoutine(actor, rRow);

    const routine = this.hydrateRoutineRecord(rRow);
    const verRows = this.db
      .prepare('SELECT * FROM routine_versions WHERE routine_id = ? ORDER BY version_number DESC')
      .all(routineId) as Record<string, unknown>[];
    const versions = verRows.map((v) => this.hydrateVersion(v));
    const currentVersion =
      versions.find((v) => v.versionNumber === routine.currentVersionNumber) || versions[0];

    const assignRows = this.db
      .prepare('SELECT * FROM routine_review_assignments WHERE routine_id = ? ORDER BY assigned_at DESC')
      .all(routineId) as Record<string, unknown>[];
    const reviewAssignments: RoutineReviewAssignment[] = assignRows.map((a) => ({
      id: String(a.id),
      routineId: String(a.routine_id),
      routineVersionId: String(a.routine_version_id),
      reviewerUserId: String(a.reviewer_user_id),
      reviewerName: String(a.reviewer_name),
      reviewerRole: String(a.reviewer_role) as 'teacher' | 'admin',
      subjectIds: parseJsonSafe(a.subject_ids_json, []),
      status: String(a.status) as RoutineReviewAssignment['status'],
      assignedAt: String(a.assigned_at),
      completedAt: a.completed_at ? String(a.completed_at) : null,
    }));

    const tEvalRows = this.db
      .prepare('SELECT * FROM routine_teacher_evaluations WHERE routine_id = ? ORDER BY created_at DESC')
      .all(routineId) as Record<string, unknown>[];
    const teacherEvaluations: RoutineTeacherEvaluation[] = tEvalRows.map((e) => ({
      id: String(e.id),
      routineId: String(e.routine_id),
      routineVersionId: String(e.routine_version_id),
      teacherUserId: String(e.teacher_user_id),
      teacherName: String(e.teacher_name),
      scopedSubjectIds: parseJsonSafe(e.scoped_subject_ids_json, []),
      subjectComponentDecisions: parseJsonSafe(e.subject_component_decisions_json, {}),
      decision: String(e.decision) as RoutineTeacherEvaluation['decision'],
      topicSuitabilityNote: String(e.topic_suitability_note || ''),
      difficultySuitabilityNote: String(e.difficulty_suitability_note || ''),
      skillBalanceNote: String(e.skill_balance_note || ''),
      evidenceComparisonNote: String(e.evidence_comparison_note || ''),
      generalComment: String(e.general_comment || ''),
      recommendedChangesJson: String(e.recommended_changes_json || '[]'),
      createdAt: String(e.created_at),
    }));

    const aEvalRows = this.db
      .prepare('SELECT * FROM routine_admin_evaluations WHERE routine_id = ? ORDER BY created_at DESC')
      .all(routineId) as Record<string, unknown>[];
    const adminEvaluations: RoutineAdminEvaluation[] = aEvalRows.map((e) => ({
      id: String(e.id),
      routineId: String(e.routine_id),
      routineVersionId: String(e.routine_version_id),
      adminUserId: String(e.admin_user_id),
      adminName: String(e.admin_name),
      decision: String(e.decision) as RoutineAdminEvaluation['decision'],
      overallBalanceNote: String(e.overall_balance_note || ''),
      wellbeingReviewNote: String(e.wellbeing_review_note || ''),
      coordinationSummary: String(e.coordination_summary || ''),
      createdAt: String(e.created_at),
    }));

    const crRows = this.db
      .prepare('SELECT * FROM routine_change_requests WHERE routine_id = ? ORDER BY created_at DESC')
      .all(routineId) as Record<string, unknown>[];
    const changeRequests: RoutineChangeRequest[] = crRows.map((c) => ({
      id: String(c.id),
      routineId: String(c.routine_id),
      routineVersionId: String(c.routine_version_id),
      requestedByUserId: String(c.requested_by_user_id),
      requestedByName: String(c.requested_by_name),
      requestedByRole: String(c.requested_by_role) as 'teacher' | 'admin',
      subjectId: c.subject_id ? String(c.subject_id) : null,
      category: String(c.category) as RoutineChangeRequest['category'],
      summary: String(c.summary),
      suggestedChangeJson: String(c.suggested_change_json || '{}'),
      status: String(c.status) as RoutineChangeRequest['status'],
      resolvedAt: c.resolved_at ? String(c.resolved_at) : null,
      createdAt: String(c.created_at),
    }));

    const histRows = this.db
      .prepare('SELECT * FROM routine_approval_history WHERE routine_id = ? ORDER BY created_at DESC')
      .all(routineId) as Record<string, unknown>[];
    const approvalHistory: RoutineApprovalHistoryEntry[] = histRows.map((h) => ({
      id: String(h.id),
      routineId: String(h.routine_id),
      routineVersionId: String(h.routine_version_id),
      actorId: String(h.actor_id),
      actorName: String(h.actor_name),
      actorRole: String(h.actor_role) as RoutineApprovalHistoryEntry['actorRole'],
      fromStatus: h.from_status ? (String(h.from_status) as RoutineWorkflowStatus) : null,
      toStatus: String(h.to_status) as RoutineWorkflowStatus,
      action: String(h.action),
      note: String(h.note || ''),
      createdAt: String(h.created_at),
    }));

    const adjRows = this.db
      .prepare('SELECT * FROM routine_adaptive_adjustments WHERE routine_id = ? ORDER BY triggered_at DESC')
      .all(routineId) as Record<string, unknown>[];
    const adaptiveAdjustments: RoutineAdaptiveAdjustment[] = adjRows.map((a) => ({
      id: String(a.id),
      routineId: String(a.routine_id),
      routineVersionId: String(a.routine_version_id),
      triggeredAt: String(a.triggered_at),
      reasonSummary: String(a.reason_summary),
      adjustmentType: String(a.adjustment_type) as RoutineAdaptiveAdjustment['adjustmentType'],
      withinParentBounds: Number(a.within_parent_bounds) === 1,
      status: String(a.status) as RoutineAdaptiveAdjustment['status'],
      proposedChangesJson: String(a.proposed_changes_json || '{}'),
      constraintsPreservedNote: String(a.constraints_preserved_note || ''),
      parentApprovedByUserId: a.parent_approved_by_user_id ? String(a.parent_approved_by_user_id) : null,
      resolvedAt: a.resolved_at ? String(a.resolved_at) : null,
    }));

    const perfRow = this.db
      .prepare(
        `SELECT summary_json FROM routine_performance_summaries
         WHERE routine_id = ? ORDER BY generated_at DESC LIMIT 1`
      )
      .get(routineId) as { summary_json: string } | undefined;
    const latestPerformanceSummary = perfRow
      ? parseJsonSafe<RoutinePerformanceSummary | null>(perfRow.summary_json, null)
      : null;

    // Student Evidence Context (filtered by teacher subjects when actor is teacher)
    const { subjectsMap } = this.getCurriculumLookups();
    const qaRows = this.db
      .prepare(
        `SELECT subject_id, COUNT(*) as cnt,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_cnt
         FROM question_attempts
         WHERE student_id = ? AND submission_status = 'valid_answered'
         GROUP BY subject_id`
      )
      .all(routine.studentId) as { subject_id: string; cnt: number; correct_cnt: number }[];

    const openCasesRows = this.db
      .prepare(
        `SELECT subject_id, COUNT(*) as cnt FROM intervention_cases
         WHERE student_id = ? AND status IN ('OPEN','UNDER_REVIEW','INTERVENTION_ASSIGNED','MONITORING')
         GROUP BY subject_id`
      )
      .all(routine.studentId) as { subject_id: string; cnt: number }[];
    const caseCountBySubj = new Map(openCasesRows.map((c) => [c.subject_id, c.cnt]));

    const teacherAssigned =
      actor.role === 'teacher' ? new Set(this.academic.getTeacherAssignedSubjectIds(actor.id)) : null;

    const subjectMetrics = currentVersion.subjectWeights
      .filter((s) => s.enabled && (!teacherAssigned || teacherAssigned.has(s.subjectId)))
      .map((s) => {
        const qa = qaRows.find((q) => q.subject_id === s.subjectId);
        return {
          subjectId: s.subjectId,
          subjectName: subjectsMap.get(s.subjectId) || s.subjectId,
          attempts: qa?.cnt || 0,
          accuracyPercent: qa && qa.cnt > 0 ? Math.round((qa.correct_cnt / qa.cnt) * 100) : null,
          repeatedErrorCount: caseCountBySubj.get(s.subjectId) || 0,
        };
      });

    const totalAtt = qaRows.reduce((s, r) => s + r.cnt, 0);
    const totalCorr = qaRows.reduce((s, r) => s + r.correct_cnt, 0);

    return {
      routine,
      currentVersion,
      versions,
      reviewAssignments,
      teacherEvaluations,
      adminEvaluations,
      changeRequests,
      approvalHistory,
      adaptiveAdjustments,
      latestPerformanceSummary,
      studentContext: {
        studentId: routine.studentId,
        studentName: routine.studentName,
        recentOverallAccuracyPercent: totalAtt > 0 ? Math.round((totalCorr / totalAtt) * 100) : null,
        openInterventionCount: openCasesRows.reduce((s, r) => s + r.cnt, 0),
        subjectMetrics,
      },
    };
  }

  // =========================================================================
  // 4. REVIEW SUBMISSION, SUBJECT-SCOPED TEACHER & ADMIN EVALUATION
  // =========================================================================

  public submitRoutineForReview(actor: UserAccount, routineId: string): AcademicRoutineDetail {
    const rRow = this.db
      .prepare('SELECT * FROM parent_academic_routines WHERE id = ?')
      .get(routineId) as Record<string, unknown> | undefined;
    if (!rRow) throw new HttpError(404, 'Academic routine not found.');
    const studentId = String(rRow.student_id);
    this.assertGuardianOrAdminCanManage(actor, studentId);

    const detail = this.getRoutineDetail(actor, routineId);
    const curVer = detail.currentVersion;
    const enabledSubjIds = curVer.subjectWeights
      .filter((s) => s.enabled && s.weightPercent > 0)
      .map((s) => s.subjectId);

    if (enabledSubjIds.length === 0) {
      throw new HttpError(400, 'At least one enabled subject with non-zero weight is required.');
    }

    const now = new Date().toISOString();
    const placeholders = enabledSubjIds.map(() => '?').join(',');
    const teacherRows = this.db
      .prepare(
        `SELECT tsa.teacher_id, tsa.subject_id, u.name
         FROM teacher_subject_assignments tsa
         JOIN users u ON u.id = tsa.teacher_id
         WHERE tsa.subject_id IN (${placeholders}) AND u.active = 1`
      )
      .all(...enabledSubjIds) as { teacher_id: string; subject_id: string; name: string }[];

    const subjByTeacher = new Map<string, { name: string; subjects: string[] }>();
    for (const row of teacherRows) {
      const entry = subjByTeacher.get(row.teacher_id) || { name: row.name, subjects: [] };
      if (!entry.subjects.includes(row.subject_id)) entry.subjects.push(row.subject_id);
      subjByTeacher.set(row.teacher_id, entry);
    }

    const adminRows = this.db
      .prepare(`SELECT id, name FROM users WHERE role = 'admin' AND active = 1 LIMIT 2`)
      .all() as { id: string; name: string }[];

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE parent_academic_routines
           SET workflow_status = 'UNDER_REVIEW', requires_re_review = 0, updated_at = ?
           WHERE id = ?`
        )
        .run(now, routineId);

      this.db
        .prepare(`UPDATE routine_versions SET requires_re_review = 0 WHERE id = ?`)
        .run(curVer.id);

      const insAssign = this.db.prepare(
        `INSERT INTO routine_review_assignments (
          id, routine_id, routine_version_id, reviewer_user_id, reviewer_name, reviewer_role,
          subject_ids_json, status, assigned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
        ON CONFLICT(routine_version_id, reviewer_user_id) DO UPDATE SET
          subject_ids_json = excluded.subject_ids_json, status = 'PENDING', assigned_at = excluded.assigned_at`
      );

      for (const [tId, info] of subjByTeacher.entries()) {
        insAssign.run(
          `RRA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          routineId,
          curVer.id,
          tId,
          info.name,
          'teacher',
          JSON.stringify(info.subjects),
          now
        );
      }
      for (const adm of adminRows) {
        insAssign.run(
          `RRA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          routineId,
          curVer.id,
          adm.id,
          adm.name,
          'admin',
          JSON.stringify(enabledSubjIds),
          now
        );
      }

      this.db
        .prepare(
          `INSERT INTO routine_approval_history (
            id, routine_id, routine_version_id, actor_id, actor_name, actor_role,
            from_status, to_status, action, note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'UNDER_REVIEW', 'SUBMITTED_FOR_REVIEW', ?, ?)`
        )
        .run(
          `RAH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          routineId,
          curVer.id,
          actor.id,
          actor.name,
          actor.role,
          detail.routine.workflowStatus,
          `Submitted v${curVer.versionNumber} to ${subjByTeacher.size} subject teacher(s) and admin reviewers.`,
          now
        );
    });

    // Notify assigned teachers & admins
    for (const [tId, info] of subjByTeacher.entries()) {
      this.academic.insertNotificationRow({
        recipientUserId: tId,
        recipientRole: 'teacher',
        channel: 'in_app',
        category: 'routine_review',
        title: `Parent Routine Review · ${detail.routine.studentName}`,
        body: `Review "${curVer.title}" for your assigned subject(s): ${info.subjects.join(', ')}.`,
        relatedStudentId: studentId,
        relatedSubjectId: info.subjects[0],
        dedupeKey: `rtn-sub-${curVer.id}-${tId}`,
        deliveryStatus: 'delivered',
      });
    }
    for (const adm of adminRows) {
      this.academic.insertNotificationRow({
        recipientUserId: adm.id,
        recipientRole: 'admin',
        channel: 'in_app',
        category: 'routine_review',
        title: `Routine Oversight Needed · ${detail.routine.studentName}`,
        body: `"${curVer.title}" submitted for cross-subject and wellbeing evaluation.`,
        relatedStudentId: studentId,
        dedupeKey: `rtn-sub-${curVer.id}-${adm.id}`,
        deliveryStatus: 'delivered',
      });
    }

    return this.getRoutineDetail(actor, routineId);
  }

  public submitTeacherEvaluation(
    teacher: UserAccount,
    routineId: string,
    payload: {
      subjectComponentDecisions: Record<string, 'approved' | 'changes_requested' | 'comment_only'>;
      decision: 'approved_components' | 'recommend_changes' | 'comment_only';
      topicSuitabilityNote?: string;
      difficultySuitabilityNote?: string;
      skillBalanceNote?: string;
      evidenceComparisonNote?: string;
      generalComment: string;
      changeRequests?: {
        subjectId?: string;
        category: RoutineChangeRequest['category'];
        summary: string;
        suggestedChange?: Record<string, unknown>;
      }[];
    }
  ): AcademicRoutineDetail {
    if (teacher.role !== 'teacher') {
      throw new HttpError(403, 'Only assigned teachers can submit subject-scoped teacher evaluations.');
    }
    const detail = this.getRoutineDetail(teacher, routineId);
    const assigned = this.academic.getTeacherAssignedSubjectIds(teacher.id);
    const curVer = detail.currentVersion;

    const decisionSubjectIds = Object.keys(payload.subjectComponentDecisions || {});
    for (const sid of decisionSubjectIds) {
      if (!assigned.includes(sid)) {
        throw new HttpError(
          403,
          `Access denied: teacher is not assigned to subject ${sid} and cannot evaluate or approve it.`
        );
      }
    }
    for (const cr of payload.changeRequests || []) {
      if (cr.subjectId && !assigned.includes(cr.subjectId)) {
        throw new HttpError(
          403,
          `Access denied: cannot raise a subject-specific change request for unassigned subject ${cr.subjectId}.`
        );
      }
    }

    const scopedRoutineSubjects = curVer.subjectWeights
      .filter((s) => s.enabled && assigned.includes(s.subjectId))
      .map((s) => s.subjectId);

    if (scopedRoutineSubjects.length === 0) {
      throw new HttpError(403, 'No assigned subjects appear in this routine.');
    }

    const evalId = `RTE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const shouldFlagChanges = payload.decision === 'recommend_changes';

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO routine_teacher_evaluations (
            id, routine_id, routine_version_id, teacher_user_id, teacher_name, scoped_subject_ids_json,
            subject_component_decisions_json, decision, topic_suitability_note, difficulty_suitability_note,
            skill_balance_note, evidence_comparison_note, general_comment, recommended_changes_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          evalId,
          routineId,
          curVer.id,
          teacher.id,
          teacher.name,
          JSON.stringify(scopedRoutineSubjects),
          JSON.stringify(payload.subjectComponentDecisions || {}),
          payload.decision,
          String(payload.topicSuitabilityNote || ''),
          String(payload.difficultySuitabilityNote || ''),
          String(payload.skillBalanceNote || ''),
          String(payload.evidenceComparisonNote || ''),
          String(payload.generalComment || '').trim(),
          JSON.stringify(payload.changeRequests || []),
          now
        );

      for (const cr of payload.changeRequests || []) {
        this.db
          .prepare(
            `INSERT INTO routine_change_requests (
              id, routine_id, routine_version_id, requested_by_user_id, requested_by_name, requested_by_role,
              subject_id, category, summary, suggested_change_json, status, created_at
            ) VALUES (?, ?, ?, ?, ?, 'teacher', ?, ?, ?, ?, 'OPEN', ?)`
          )
          .run(
            `RCR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            routineId,
            curVer.id,
            teacher.id,
            teacher.name,
            cr.subjectId || scopedRoutineSubjects[0],
            cr.category || 'other',
            String(cr.summary || '').trim(),
            JSON.stringify(cr.suggestedChange || {}),
            now
          );
      }

      const assignStatus =
        payload.decision === 'approved_components'
          ? 'APPROVED'
          : payload.decision === 'recommend_changes'
          ? 'CHANGES_REQUESTED'
          : 'IN_PROGRESS';

      this.db
        .prepare(
          `UPDATE routine_review_assignments
           SET status = ?, completed_at = ?
           WHERE routine_version_id = ? AND reviewer_user_id = ?`
        )
        .run(assignStatus, now, curVer.id, teacher.id);

      if (shouldFlagChanges) {
        this.db
          .prepare(`UPDATE parent_academic_routines SET workflow_status = 'CHANGES_REQUESTED', updated_at = ? WHERE id = ?`)
          .run(now, routineId);
      }

      this.db
        .prepare(
          `INSERT INTO routine_approval_history (
            id, routine_id, routine_version_id, actor_id, actor_name, actor_role,
            from_status, to_status, action, note, created_at
          ) VALUES (?, ?, ?, ?, ?, 'teacher', ?, ?, ?, ?, ?)`
        )
        .run(
          `RAH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          routineId,
          curVer.id,
          teacher.id,
          teacher.name,
          detail.routine.workflowStatus,
          shouldFlagChanges ? 'CHANGES_REQUESTED' : detail.routine.workflowStatus,
          `TEACHER_${payload.decision.toUpperCase()}`,
          `${teacher.name} evaluated [${scopedRoutineSubjects.join(', ')}]: ${payload.generalComment}`,
          now
        );
    });

    this.academic.insertNotificationRow({
      recipientUserId: detail.routine.guardianUserId,
      recipientRole: 'parent',
      channel: 'in_app',
      category: 'routine_review',
      title: `Teacher Evaluation · ${curVer.title}`,
      body: `${teacher.name} submitted feedback for ${detail.routine.studentName}'s routine (${payload.decision.replace('_', ' ')}).`,
      relatedStudentId: detail.routine.studentId,
      relatedSubjectId: scopedRoutineSubjects[0],
      dedupeKey: `rtn-teval-${evalId}`,
      deliveryStatus: 'delivered',
    });

    return this.getRoutineDetail(teacher, routineId);
  }

  public submitAdminEvaluation(
    admin: UserAccount,
    routineId: string,
    payload: {
      decision: 'approved' | 'changes_requested' | 'rejected' | 'comment_only';
      overallBalanceNote?: string;
      wellbeingReviewNote?: string;
      coordinationSummary?: string;
      changeRequestSummary?: string;
    }
  ): AcademicRoutineDetail {
    if (admin.role !== 'admin') {
      throw new HttpError(403, 'Administrator permission is required for final cross-subject routine decisions.');
    }
    const detail = this.getRoutineDetail(admin, routineId);
    const curVer = detail.currentVersion;
    const now = new Date().toISOString();

    const nextStatus: RoutineWorkflowStatus =
      payload.decision === 'approved'
        ? 'APPROVED'
        : payload.decision === 'changes_requested'
        ? 'CHANGES_REQUESTED'
        : payload.decision === 'rejected'
        ? 'REJECTED'
        : detail.routine.workflowStatus;

    const evalId = `RAE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO routine_admin_evaluations (
            id, routine_id, routine_version_id, admin_user_id, admin_name, decision,
            overall_balance_note, wellbeing_review_note, coordination_summary, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          evalId,
          routineId,
          curVer.id,
          admin.id,
          admin.name,
          payload.decision,
          String(payload.overallBalanceNote || ''),
          String(payload.wellbeingReviewNote || ''),
          String(payload.coordinationSummary || ''),
          now
        );

      if (payload.decision === 'changes_requested' && payload.changeRequestSummary) {
        this.db
          .prepare(
            `INSERT INTO routine_change_requests (
              id, routine_id, routine_version_id, requested_by_user_id, requested_by_name, requested_by_role,
              subject_id, category, summary, suggested_change_json, status, created_at
            ) VALUES (?, ?, ?, ?, ?, 'admin', NULL, 'study_load_wellbeing', ?, '{}', 'OPEN', ?)`
          )
          .run(
            `RCR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            routineId,
            curVer.id,
            admin.id,
            admin.name,
            payload.changeRequestSummary,
            now
          );
      }

      this.db
        .prepare(
          `UPDATE parent_academic_routines
           SET workflow_status = ?, requires_re_review = 0, updated_at = ?
           WHERE id = ?`
        )
        .run(nextStatus, now, routineId);

      const assignStatus =
        payload.decision === 'approved'
          ? 'APPROVED'
          : payload.decision === 'changes_requested'
          ? 'CHANGES_REQUESTED'
          : payload.decision === 'rejected'
          ? 'REJECTED'
          : 'IN_PROGRESS';
      this.db
        .prepare(
          `UPDATE routine_review_assignments
           SET status = ?, completed_at = ?
           WHERE routine_version_id = ? AND reviewer_user_id = ?`
        )
        .run(assignStatus, now, curVer.id, admin.id);

      this.db
        .prepare(
          `INSERT INTO routine_approval_history (
            id, routine_id, routine_version_id, actor_id, actor_name, actor_role,
            from_status, to_status, action, note, created_at
          ) VALUES (?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?)`
        )
        .run(
          `RAH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          routineId,
          curVer.id,
          admin.id,
          admin.name,
          detail.routine.workflowStatus,
          nextStatus,
          `ADMIN_${payload.decision.toUpperCase()}`,
          payload.coordinationSummary || payload.overallBalanceNote || `Admin decision: ${payload.decision}`,
          now
        );
    });

    const guardian = this.academic.getUserById(detail.routine.guardianUserId);
    if (guardian) {
      this.academic.insertNotificationRow({
        recipientUserId: guardian.id,
        recipientRole: 'parent',
        channel: 'in_app',
        category: 'routine_review',
        title: `Routine Decision (${nextStatus}) · ${curVer.title}`,
        body: payload.overallBalanceNote || payload.coordinationSummary || `Routine status is now ${nextStatus}.`,
        relatedStudentId: detail.routine.studentId,
        dedupeKey: `rtn-adm-${evalId}`,
        deliveryStatus: 'delivered',
      });
      if (guardian.emailVerified) {
        const em = buildEmailTextAndHtml({
          heading: `Academic Routine ${nextStatus}`,
          subheading: `${curVer.title} for ${detail.routine.studentName}`,
          paragraphs: [
            `Administrator ${admin.name} reviewed your academic routine (${nextStatus}).`,
            payload.overallBalanceNote || payload.wellbeingReviewNote || 'Open the Parent Learning Planner to view comments or activate.',
          ],
          footerNote: 'MAN 5HE Academic Routine Evaluation',
        });
        this.academic.recordEmailLog({
          toEmail: guardian.email,
          subject: `Routine ${nextStatus}: ${curVer.title} · මං 5හේ`,
          category: 'routine_review',
          htmlBody: em.htmlBody,
          textBody: em.textBody,
        });
      }
    }

    return this.getRoutineDetail(admin, routineId);
  }

  // =========================================================================
  // 5. ACTIVATION -> TIMETABLE ENGINE, REMINDERS & WELLBEING ENFORCEMENT
  // =========================================================================

  public activateRoutine(
    actor: UserAccount,
    routineId: string,
    options?: {
      wellbeingDecision?: ParentScheduleDecision;
      wellbeingNotes?: string;
      skipConflicts?: boolean;
    }
  ): {
    detail: AcademicRoutineDetail;
    timetable: StudentTimetable;
    sessionsCreated: ScheduledSessionRecord[];
    shortages: RoutineValidationReport['questionPreview']['shortages'];
  } {
    const detail = this.getRoutineDetail(actor, routineId);
    this.assertGuardianOrAdminCanManage(actor, detail.routine.studentId);

    if (detail.routine.requiresReReview) {
      throw new HttpError(
        400,
        'Material changes were made after approval. Submit this updated version for review and approval before activating.'
      );
    }
    if (detail.routine.workflowStatus !== 'APPROVED' && detail.routine.workflowStatus !== 'PAUSED') {
      throw new HttpError(
        400,
        `Routine must be APPROVED before activation (current status: ${detail.routine.workflowStatus}).`
      );
    }

    const ver = detail.currentVersion;
    const configInput: AcademicRoutineConfigInput = {
      studentId: detail.routine.studentId,
      title: ver.title,
      description: ver.description,
      grade: ver.grade,
      startDate: ver.startDate,
      startTimeOfDay: ver.startTimeOfDay,
      timezone: ver.timezone,
      recurrenceType: ver.recurrenceType,
      weekdays: ver.weekdays,
      endDate: ver.endDate,
      totalDurationWeeks: ver.totalDurationWeeks,
      exceptionDates: ver.exceptionDates,
      mixingMethod: ver.mixingMethod,
      subjectWeights: ver.subjectWeights,
      skillWeights: ver.skillWeights,
      difficultyDistribution: ver.difficultyDistribution,
      questionCountPerSession: ver.questionCountPerSession,
      sessionDurationMinutes: ver.sessionDurationMinutes,
      practiceRatioPercent: ver.practiceRatioPercent,
      mockFrequencyDays: ver.mockFrequencyDays,
      exposurePreference: ver.exposurePreference,
      scheduleMode: ver.scheduleMode,
      breakIntervalMinutes: ver.breakIntervalMinutes,
      breakDurationMinutes: ver.breakDurationMinutes,
      dailyRuleOverrides: ver.dailyRuleOverrides,
      adaptiveBounds: ver.adaptiveBounds,
      reminderConfig: ver.reminderConfig,
      excludedQuestionIds: ver.excludedQuestionIds,
    };

    const preview = this.previewRoutineValidation(actor, configInput);
    if (!preview.valid) {
      throw new HttpError(400, preview.errors[0]);
    }
    if (preview.plannedSlots.length === 0) {
      throw new HttpError(400, 'Routine dates/recurrence produced zero sessions.');
    }

    let candidateSlots = preview.plannedSlots;
    if (preview.scheduleConflicts.length > 0) {
      if (!options?.skipConflicts) {
        throw new HttpError(
          409,
          `Timetable conflict detected: ${preview.scheduleConflicts[0].reason}`
        );
      }
      const conflictStarts = new Set(preview.scheduleConflicts.map((c) => c.candidateStartUtc));
      candidateSlots = candidateSlots.filter((s) => !conflictStarts.has(s.startUtc));
      if (candidateSlots.length === 0) {
        throw new HttpError(409, 'All planned slots conflict with existing scheduled sessions.');
      }
    }

    const enabledSubjIds = ver.subjectWeights.filter((s) => s.enabled).map((s) => s.subjectId);
    if (preview.wellbeingCheck && preview.wellbeingCheck.severity !== 'nominal') {
      if (
        preview.wellbeingCheck.exceedsDailyMax &&
        actor.role !== 'admin' &&
        options?.wellbeingDecision !== 'adjusted' &&
        options?.wellbeingDecision !== 'proceeded_with_acknowledgement'
      ) {
        throw new HttpError(
          400,
          `Wellbeing protection requires reducing or acknowledging daily workload: ${preview.wellbeingCheck.supportiveMessage}`
        );
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
            source_routine_id, source_routine_version_id,
            title, description, timezone, start_date, end_date, recurrence_type,
            weekdays_json, exception_dates_json, status, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
        )
        .run(
          ttId,
          detail.routine.studentId,
          actor.id,
          routineId,
          ver.id,
          ver.title,
          ver.description,
          ver.timezone,
          ver.startDate,
          ver.endDate,
          ver.recurrenceType,
          JSON.stringify(ver.weekdays),
          JSON.stringify(ver.exceptionDates),
          now,
          now
        );

      const insSess = this.db.prepare(
        `INSERT INTO scheduled_sessions (
          id, timetable_id, student_id, created_by_user_id, title, activity_type, timezone,
          scheduled_start_utc, scheduled_end_utc, duration_minutes, grace_period_minutes,
          recurrence_key, status, max_attempts, attempts_used, filter_criteria_json,
          question_snapshot_ids_json, fixed_assessment_id, fixed_paper_id, notes,
          source_routine_id, source_routine_version_id, routine_metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 15, ?, 'SCHEDULED', 1, 0, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`
      );

      for (const slot of candidateSlots) {
        const sid = `SES-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        createdSessionIds.push(sid);
        insSess.run(
          sid,
          ttId,
          detail.routine.studentId,
          actor.id,
          slot.title,
          slot.activityType,
          ver.timezone,
          slot.startUtc,
          slot.endUtc,
          slot.durationMinutes,
          `${routineId}-v${ver.versionNumber}-${slot.localDate}-${slot.occurrenceIndex}`,
          JSON.stringify({
            grade: ver.grade,
            subjectIds: slot.subjectIds,
            questionCount: ver.questionCountPerSession,
            historyMode: ver.exposurePreference === 'all' ? 'all' : 'unattempted',
          }),
          JSON.stringify(slot.questionIds),
          slot.breakNote || `Generated from Academic Routine "${ver.title}" v${ver.versionNumber}`,
          routineId,
          ver.id,
          JSON.stringify({
            subjectWeightsForSlot: slot.subjectWeightsForSlot,
            mixingMethod: ver.mixingMethod,
            scheduleMode: ver.scheduleMode,
          }),
          now,
          now
        );
      }

      this.db
        .prepare(
          `UPDATE parent_academic_routines
           SET workflow_status = 'ACTIVE', active_version_number = ?, linked_timetable_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(ver.versionNumber, ttId, now, routineId);

      this.db
        .prepare(
          `INSERT INTO routine_approval_history (
            id, routine_id, routine_version_id, actor_id, actor_name, actor_role,
            from_status, to_status, action, note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'ROUTINE_ACTIVATED', ?, ?)`
        )
        .run(
          `RAH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          routineId,
          ver.id,
          actor.id,
          actor.name,
          actor.role,
          detail.routine.workflowStatus,
          `Activated v${ver.versionNumber} creating ${createdSessionIds.length} scheduled study session(s) in ${ver.timezone}.`,
          now
        );
    });

    if (preview.wellbeingCheck && preview.wellbeingCheck.severity !== 'nominal') {
      this.wellbeing.recordPreScheduleValidationDecision(actor, {
        studentId: detail.routine.studentId,
        validation: preview.wellbeingCheck,
        decision: options?.wellbeingDecision || 'proceeded_with_acknowledgement',
        decisionNotes: options?.wellbeingNotes || 'Activated with parent wellbeing review acknowledgement.',
        subjectIds: enabledSubjIds,
        timetableId: ttId,
      });
    }

    if (ver.reminderConfig.enabled) {
      for (const sid of createdSessionIds) {
        this.parentIntel.syncReminderJobsForSession(sid);
      }
    }

    const ttRow = this.db
      .prepare('SELECT * FROM student_timetables WHERE id = ?')
      .get(ttId) as Record<string, unknown>;
    const timetable: StudentTimetable = {
      id: String(ttRow.id),
      studentId: String(ttRow.student_id),
      createdByUserId: String(ttRow.created_by_user_id),
      sourcePresetId: null,
      sourcePresetVersion: null,
      title: String(ttRow.title),
      description: String(ttRow.description || ''),
      timezone: String(ttRow.timezone),
      startDate: String(ttRow.start_date),
      endDate: ttRow.end_date ? String(ttRow.end_date) : null,
      recurrenceType: String(ttRow.recurrence_type) as StudentTimetable['recurrenceType'],
      weekdays: parseJsonSafe(ttRow.weekdays_json, []),
      exceptionDates: parseJsonSafe(ttRow.exception_dates_json, []),
      status: String(ttRow.status) as StudentTimetable['status'],
      createdAt: String(ttRow.created_at),
      updatedAt: String(ttRow.updated_at),
    };

    const sessRows = this.db
      .prepare(
        `SELECT ss.*, u.name as student_name FROM scheduled_sessions ss
         JOIN users u ON u.id = ss.student_id
         WHERE ss.timetable_id = ? ORDER BY ss.scheduled_start_utc ASC`
      )
      .all(ttId) as Record<string, unknown>[];
    const sessionsCreated: ScheduledSessionRecord[] = sessRows.map((r) => ({
      id: String(r.id),
      timetableId: String(r.timetable_id),
      studentId: String(r.student_id),
      studentName: String(r.student_name),
      createdByUserId: String(r.created_by_user_id),
      title: String(r.title),
      activityType: String(r.activity_type) as ScheduledSessionRecord['activityType'],
      timezone: String(r.timezone),
      scheduledStartUtc: String(r.scheduled_start_utc),
      scheduledEndUtc: String(r.scheduled_end_utc),
      durationMinutes: Number(r.duration_minutes),
      gracePeriodMinutes: Number(r.grace_period_minutes),
      recurrenceKey: String(r.recurrence_key),
      status: String(r.status) as ScheduledSessionRecord['status'],
      maxAttempts: Number(r.max_attempts),
      attemptsUsed: Number(r.attempts_used),
      filterCriteria: parseJsonSafe(r.filter_criteria_json, { subjectIds: [] }),
      questionSnapshotIds: parseJsonSafe(r.question_snapshot_ids_json, []),
      notes: String(r.notes || ''),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));

    return {
      detail: this.getRoutineDetail(actor, routineId),
      timetable,
      sessionsCreated,
      shortages: preview.questionPreview.shortages,
    };
  }

  public transitionRoutineLifecycle(
    actor: UserAccount,
    routineId: string,
    action: 'pause' | 'resume' | 'complete' | 'archive'
  ): AcademicRoutineDetail {
    const detail = this.getRoutineDetail(actor, routineId);
    this.assertGuardianOrAdminCanManage(actor, detail.routine.studentId);

    const nextStatus: RoutineWorkflowStatus =
      action === 'pause'
        ? 'PAUSED'
        : action === 'resume'
        ? 'ACTIVE'
        : action === 'complete'
        ? 'COMPLETED'
        : 'ARCHIVED';

    if (action === 'resume' && detail.routine.workflowStatus !== 'PAUSED') {
      throw new HttpError(400, 'Only PAUSED routines can be resumed.');
    }

    const now = new Date().toISOString();
    this.dbWrapper.transaction(() => {
      this.db
        .prepare('UPDATE parent_academic_routines SET workflow_status = ?, updated_at = ? WHERE id = ?')
        .run(nextStatus, now, routineId);

      if (detail.routine.linkedTimetableId) {
        const ttAction =
          action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : action === 'complete' ? 'COMPLETED' : 'CANCELLED';
        this.db
          .prepare('UPDATE student_timetables SET status = ?, updated_at = ? WHERE id = ?')
          .run(ttAction, now, detail.routine.linkedTimetableId);

        if (action === 'pause' || action === 'archive' || action === 'complete') {
          const sesRows = this.db
            .prepare(`SELECT id FROM scheduled_sessions WHERE timetable_id = ? AND status = 'SCHEDULED'`)
            .all(detail.routine.linkedTimetableId) as { id: string }[];
          for (const sr of sesRows) {
            this.db
              .prepare(`UPDATE reminder_jobs SET status = 'CANCELLED' WHERE session_id = ? AND status = 'PENDING'`)
              .run(sr.id);
          }
          this.db
            .prepare(
              `UPDATE scheduled_sessions SET status = ?, updated_at = ?
               WHERE timetable_id = ? AND status IN ('SCHEDULED','PAUSED')`
            )
            .run(action === 'pause' ? 'PAUSED' : 'CANCELLED', now, detail.routine.linkedTimetableId);
        } else if (action === 'resume') {
          this.db
            .prepare(
              `UPDATE scheduled_sessions SET status = 'SCHEDULED', updated_at = ?
               WHERE timetable_id = ? AND status = 'PAUSED'`
            )
            .run(now, detail.routine.linkedTimetableId);
        }
      }

      this.db
        .prepare(
          `INSERT INTO routine_approval_history (
            id, routine_id, routine_version_id, actor_id, actor_name, actor_role,
            from_status, to_status, action, note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `RAH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          routineId,
          detail.currentVersion.id,
          actor.id,
          actor.name,
          actor.role,
          detail.routine.workflowStatus,
          nextStatus,
          `ROUTINE_${nextStatus}`,
          `Routine lifecycle updated to ${nextStatus}.`,
          now
        );
    });

    return this.getRoutineDetail(actor, routineId);
  }

  // =========================================================================
  // 6. FIXED PRESERVATION VS BOUNDED ADAPTIVE ENGINE & ANALYTICS
  // =========================================================================

  public evaluateAdaptiveAdjustments(
    actor: UserAccount,
    routineId: string
  ): {
    mode: 'fixed' | 'adaptive';
    adjustment: RoutineAdaptiveAdjustment | null;
    explanation: string;
  } {
    const detail = this.getRoutineDetail(actor, routineId);
    if (actor.role === 'parent') {
      this.assertGuardianOrAdminCanManage(actor, detail.routine.studentId);
    } else if (actor.role === 'student') {
      throw new HttpError(403, 'Students cannot alter adaptive routine rules.');
    }

    if (detail.routine.scheduleMode === 'fixed') {
      throw new HttpError(
        400,
        'This routine is in FIXED mode. Parent-approved weights, difficulty, and schedule allocations are strictly locked and cannot be adaptively altered.'
      );
    }

    const ver = detail.currentVersion;
    const weakest = [...detail.studentContext.subjectMetrics]
      .filter((m) => m.attempts > 0)
      .sort((a, b) => (a.accuracyPercent ?? 100) - (b.accuracyPercent ?? 100))[0];

    if (!weakest || ((weakest.accuracyPercent ?? 100) >= 75 && weakest.repeatedErrorCount === 0)) {
      return {
        mode: 'adaptive',
        adjustment: null,
        explanation:
          'Student performance is steady across configured subjects; no adaptive practice shift needed right now.',
      };
    }

    const maxShiftPct = Math.max(5, Math.min(25, Number(ver.adaptiveBounds.maxSubjectWeightShiftPercent || 15)));
    const proposedShift = Math.min(maxShiftPct, 10);
    const withinBounds = proposedShift <= ver.adaptiveBounds.maxSubjectWeightShiftPercent;
    const adjStatus: RoutineAdaptiveAdjustment['status'] =
      withinBounds || !ver.adaptiveBounds.requireApprovalOutsideBounds
        ? 'APPLIED'
        : 'PENDING_PARENT_APPROVAL';

    const { pool, questionStatsMap, studentStatsMap, questionSkillMap, repeatedErrorQuestionIds } =
      this.loadQuestionStatsAndSkills(detail.routine.studentId);

    const shiftedWeights: RoutineSubjectWeight[] = ver.subjectWeights.map((sw) => {
      if (!sw.enabled) return sw;
      if (sw.subjectId === weakest.subjectId) {
        return { ...sw, weightPercent: Math.min(100, sw.weightPercent + proposedShift) };
      }
      return sw;
    });
    const enabledSum = shiftedWeights.filter((s) => s.enabled).reduce((sum, s) => sum + s.weightPercent, 0);
    const normalizedWeights = shiftedWeights.map((sw) =>
      sw.enabled ? { ...sw, weightPercent: Math.round((sw.weightPercent / enabledSum) * 100) } : sw
    );

    const newSelection = selectQuestionsForWeightedRoutine({
      questionPool: pool,
      questionStatsMap,
      studentStatsMap,
      questionSkillMap,
      repeatedErrorQuestionIds,
      subjectWeights: normalizedWeights,
      skillWeights: ver.skillWeights,
      difficultyDistribution: ver.difficultyDistribution,
      grade: ver.grade,
      questionCount: ver.questionCountPerSession,
      exposurePreference: 'repeated_error',
      excludedQuestionIds: ver.excludedQuestionIds,
    });

    const now = new Date().toISOString();
    const adjId = `RADJ-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const reasonSummary = `Recent accuracy in ${weakest.subjectName} is ${weakest.accuracyPercent ?? 0}% (${weakest.repeatedErrorCount} repeated error case(s)). Prioritized ${weakest.subjectName} practice within parent-authorized +${proposedShift}% bound.`;
    const preservedNote =
      'Preserved Grade 5 daily wellbeing duration cap and left all mock examination blueprints & scoring untouched.';

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO routine_adaptive_adjustments (
            id, routine_id, routine_version_id, triggered_at, reason_summary, adjustment_type,
            within_parent_bounds, status, proposed_changes_json, constraints_preserved_note, resolved_at
          ) VALUES (?, ?, ?, ?, ?, 'question_substitution', ?, ?, ?, ?, ?)`
        )
        .run(
          adjId,
          routineId,
          ver.id,
          now,
          reasonSummary,
          withinBounds ? 1 : 0,
          adjStatus,
          JSON.stringify({
            targetSubjectId: weakest.subjectId,
            weightShiftPercent: proposedShift,
            refreshedQuestionIds: newSelection.selectedQuestions.map((q) => q.id),
          }),
          preservedNote,
          adjStatus === 'APPLIED' ? now : null
        );

      // Update ONLY upcoming SCHEDULED 'practice' sessions — NEVER mock exams!
      if (adjStatus === 'APPLIED' && detail.routine.linkedTimetableId) {
        this.db
          .prepare(
            `UPDATE scheduled_sessions
             SET question_snapshot_ids_json = ?, updated_at = ?
             WHERE timetable_id = ? AND status = 'SCHEDULED' AND activity_type != 'mock_exam'`
          )
          .run(
            JSON.stringify(newSelection.selectedQuestions.map((q) => q.id)),
            now,
            detail.routine.linkedTimetableId
          );
      }
    });

    if (ver.adaptiveBounds.notifyParentOnAdjustment) {
      this.academic.insertNotificationRow({
        recipientUserId: detail.routine.guardianUserId,
        recipientRole: 'parent',
        channel: 'in_app',
        category: 'routine_review',
        title: `Adaptive Practice Update · ${ver.title}`,
        body: reasonSummary,
        relatedStudentId: detail.routine.studentId,
        relatedSubjectId: weakest.subjectId,
        dedupeKey: `rtn-adj-${adjId}`,
        deliveryStatus: 'delivered',
      });
    }

    const row = this.db
      .prepare('SELECT * FROM routine_adaptive_adjustments WHERE id = ?')
      .get(adjId) as Record<string, unknown>;
    const hydrated: RoutineAdaptiveAdjustment = {
      id: String(row.id),
      routineId: String(row.routine_id),
      routineVersionId: String(row.routine_version_id),
      triggeredAt: String(row.triggered_at),
      reasonSummary: String(row.reason_summary),
      adjustmentType: String(row.adjustment_type) as RoutineAdaptiveAdjustment['adjustmentType'],
      withinParentBounds: Number(row.within_parent_bounds) === 1,
      status: String(row.status) as RoutineAdaptiveAdjustment['status'],
      proposedChangesJson: String(row.proposed_changes_json),
      constraintsPreservedNote: String(row.constraints_preserved_note),
      parentApprovedByUserId: null,
      resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    };

    return {
      mode: 'adaptive',
      adjustment: hydrated,
      explanation: reasonSummary,
    };
  }

  public getRoutinePerformanceSummary(
    actor: UserAccount,
    routineId: string
  ): RoutinePerformanceSummary {
    const detail = this.getRoutineDetail(actor, routineId);
    const ver = detail.currentVersion;
    const { subjectsMap } = this.getCurriculumLookups();

    const sessRows = detail.routine.linkedTimetableId
      ? (this.db
          .prepare('SELECT * FROM scheduled_sessions WHERE timetable_id = ?')
          .all(detail.routine.linkedTimetableId) as Record<string, unknown>[])
      : [];

    const completedCount = sessRows.filter((s) => String(s.status) === 'COMPLETED').length;
    const missedCount = sessRows.filter((s) => String(s.status) === 'MISSED').length;
    const upcomingCount = sessRows.filter((s) => String(s.status) === 'SCHEDULED').length;
    const plannedMinutesTotal = sessRows.reduce((sum, s) => sum + Number(s.duration_minutes ?? 0), 0);

    const sessIds = sessRows.map((s) => String(s.id));
    let observedActiveSeconds = 0;
    if (sessIds.length > 0) {
      const ph = sessIds.map(() => '?').join(',');
      const actSum = this.db
        .prepare(
          `SELECT COALESCE(SUM(active_duration_seconds), 0) as sec
           FROM session_activity_summaries WHERE scheduled_session_id IN (${ph})`
        )
        .get(...sessIds) as { sec: number };
      observedActiveSeconds = Number(actSum?.sec ?? 0);
    }

    // Actual question attempts for student on subjects covered by this routine
    const enabledSubjects = ver.subjectWeights.filter((s) => s.enabled);
    const qaRows = this.db
      .prepare(
        `SELECT qa.subject_id, qa.question_id, qa.is_correct, qa.difficulty_at_attempt, qa.context_mode
         FROM question_attempts qa
         WHERE qa.student_id = ? AND qa.submission_status = 'valid_answered'`
      )
      .all(detail.routine.studentId) as {
      subject_id: string;
      question_id: string;
      is_correct: number;
      difficulty_at_attempt: string;
      context_mode: string;
    }[];

    const totalAttempts = qaRows.length || 0;
    const subjectComparison = enabledSubjects.map((sw) => {
      const matches = qaRows.filter((q) => q.subject_id === sw.subjectId);
      const corr = matches.filter((q) => Number(q.is_correct) === 1).length;
      const actualPct = totalAttempts > 0 ? Math.round((matches.length / totalAttempts) * 100) : 0;
      return {
        subjectId: sw.subjectId,
        subjectName: subjectsMap.get(sw.subjectId) || sw.subjectId,
        plannedWeightPercent: sw.weightPercent,
        actualDeliveredPercent: actualPct,
        questionsAttempted: matches.length,
        correctCount: corr,
        accuracyPercent: matches.length > 0 ? Math.round((corr / matches.length) * 100) : null,
        variancePercent: actualPct - sw.weightPercent,
      };
    });

    // Educational skill breakdown from question_skill_mappings
    const skillRows = this.db
      .prepare('SELECT question_id, skill_key FROM question_skill_mappings')
      .all() as { question_id: string; skill_key: EducationalSkillCategory }[];
    const skillByQ = new Map<string, EducationalSkillCategory[]>();
    for (const r of skillRows) {
      const arr = skillByQ.get(r.question_id) || [];
      arr.push(r.skill_key);
      skillByQ.set(r.question_id, arr);
    }

    const enabledSkills = ver.skillWeights.filter((s) => s.enabled);
    const skillComparison = enabledSkills.map((sk) => {
      const matches = qaRows.filter((q) => (skillByQ.get(q.question_id) || []).includes(sk.skillKey));
      const corr = matches.filter((q) => Number(q.is_correct) === 1).length;
      const actualPct = totalAttempts > 0 ? Math.round((matches.length / totalAttempts) * 100) : 0;
      return {
        skillKey: sk.skillKey,
        skillLabel: SKILL_LABEL_MAP.get(sk.skillKey) || sk.skillKey,
        plannedWeightPercent: sk.weightPercent,
        actualDeliveredPercent: actualPct,
        questionsAttempted: matches.length,
        accuracyPercent: matches.length > 0 ? Math.round((corr / matches.length) * 100) : null,
        educationalNote: 'Reflects practice attempt accuracy in questions mapped to this educational skill category.',
      };
    });

    const diffComparison = (['simple', 'moderate', 'difficult'] as const).map((tier) => {
      const planned =
        tier === 'simple'
          ? ver.difficultyDistribution.simple
          : tier === 'moderate'
          ? ver.difficultyDistribution.moderate
          : ver.difficultyDistribution.difficult;
      const matches = qaRows.filter((q) => {
        const lower = String(q.difficulty_at_attempt || '').toLowerCase();
        if (tier === 'simple') return lower === 'simple';
        if (tier === 'moderate') return lower === 'moderate';
        return lower === 'challenging' || lower === 'master' || lower === 'difficult';
      });
      const corr = matches.filter((q) => Number(q.is_correct) === 1).length;
      return {
        tier,
        plannedPercent: planned,
        actualDeliveredPercent: totalAttempts > 0 ? Math.round((matches.length / totalAttempts) * 100) : 0,
        questionsAttempted: matches.length,
        accuracyPercent: matches.length > 0 ? Math.round((corr / matches.length) * 100) : null,
      };
    });

    const mockAttemptsCount = qaRows.filter((q) => q.context_mode === 'timed_exam').length;
    const practiceAttemptsCount = totalAttempts - mockAttemptsCount;
    const actualPracticePct = totalAttempts > 0 ? Math.round((practiceAttemptsCount / totalAttempts) * 100) : 0;
    const actualMockPct = totalAttempts > 0 ? 100 - actualPracticePct : 0;

    const explanations: string[] = [];
    if (sessRows.length === 0) {
      explanations.push('Routine has not yet generated scheduled timetable sessions (activate an APPROVED routine to begin tracking session adherence).');
    }
    if (missedCount > 0) {
      explanations.push(`${missedCount} scheduled session(s) were missed, reducing delivered exposure compared to original plan.`);
    }

    const summary: RoutinePerformanceSummary = {
      routineId,
      routineVersionNumber: ver.versionNumber,
      generatedAt: new Date().toISOString(),
      adherenceSummary: {
        plannedSessionsCount: sessRows.length,
        deliveredSessionsCount: sessRows.filter((s) => String(s.status) !== 'CANCELLED').length,
        completedSessionsCount: completedCount,
        missedSessionsCount: missedCount,
        upcomingSessionsCount: upcomingCount,
        completionRatePercent: sessRows.length > 0 ? Math.round((completedCount / sessRows.length) * 100) : 0,
        plannedMinutesTotal,
        observedActiveMinutesTotal: Math.round(observedActiveSeconds / 60),
      },
      subjectComparison,
      skillComparison,
      difficultyComparison: diffComparison,
      activityMixComparison: {
        plannedPracticePercent: ver.practiceRatioPercent,
        actualPracticePercent: actualPracticePct,
        plannedMockPercent: 100 - ver.practiceRatioPercent,
        actualMockPercent: actualMockPct,
      },
      repeatedErrorsCount: detail.studentContext.openInterventionCount,
      shortageAndMissedExplanations: explanations,
      wellbeingComplianceNote: `Planned break guideline: ${ver.breakDurationMinutes} min rest per ${ver.breakIntervalMinutes} min study block.`,
      scopeLimitationsNote:
        'Observed accuracy and topic counts measure recorded platform attempts only and do not represent clinical or cognitive ability measurements.',
    };

    this.db
      .prepare(
        `INSERT INTO routine_performance_summaries (id, routine_id, routine_version_number, summary_json, generated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        `RPS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        routineId,
        ver.versionNumber,
        JSON.stringify(summary),
        summary.generatedAt
      );

    return summary;
  }
}
