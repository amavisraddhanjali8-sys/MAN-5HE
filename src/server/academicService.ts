import crypto from 'node:crypto';
import {
  DOMAIN_TO_SUBJECT_ID,
  canAccessQuestion,
  canAccessSubject,
  resolveQuestionSubjectId,
  type AuthorizationContext,
} from '../lib/authorization.ts';
import {
  DEFAULT_ACADEMIC_CONFIG,
  INTERVENTION_TEMPLATES,
  evaluateCorrectFollowUpForCase,
  evaluateWrongAttemptForCase,
  isActiveInterventionStatus,
  validateCaseTransition,
} from '../lib/interventionEngine.ts';
import {
  buildInvoiceEmailHtml,
  buildProgressEmailHtml,
  buildWhatsAppProgressMessage,
} from '../lib/notifications.ts';
import {
  TOTAL_VIRTUAL_POOL_SIZE,
  calculatePaperQualityAndDifficulty,
  calculateQuizDifficultyScore,
  classifyDifficultyTier,
  evaluateStudentTrajectory,
  generateVirtualQuizFromPool,
} from '../lib/psychometrics.ts';
import {
  RESPONSE_TIME_ETHICAL_FRAMING,
  calculateQuestionPerformance,
  calculateStudentBaselineVsFollowUp,
  type StudentImprovementSummary,
} from '../lib/questionIntelligence.ts';
import {
  encryptTotpSecret,
  getTotpEncryptionMasterKey,
  hashPassword,
} from '../lib/security.ts';
import { calculateUpdatedStreak, sanitizeDailyGoalTarget } from '../lib/streak.ts';
import type {
  AcademicConfig,
  AttemptContextMode,
  AttemptRecord,
  AttemptSubmissionStatus,
  AuditLogRecord,
  CognitiveDomain,
  DifficultyTier,
  EmailLog,
  ExamPaper,
  InterventionAction,
  InterventionCase,
  InterventionStatus,
  InvoiceRecord,
  NotificationPreferences,
  NotificationRecord,
  PaperCategoryLevel,
  PaymentPlan,
  QuestionAttempt,
  QuestionMisconception,
  QuestionPerformanceMetrics,
  QuestionQualityFlag,
  QuestionApprovalStatus,
  QuestionMarkingRule,
  QuestionType,
  QuizItem,
  SubjectCategory,
  SubtopicNode,
  TopicNode,
  UserAccount,
  UserRole,
  WhatsAppLog,
} from '../lib/types.ts';
import { Man5heDatabase, resolveDefaultHierarchyForQuestion } from './db.ts';

export class HttpError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface SanitizedUser {
  id: string;
  userIdCode: string;
  username?: string;
  usernameUpdatedAt?: string | null;
  name: string;
  email: string;
  whatsappNumber: string;
  whatsappVerified?: boolean;
  role: UserRole;
  grade: string;
  delegatedPublishSubjects: string[];
  active: boolean;
  guardianName: string;
  guardianUserId?: string | null;
  guardianContactVerified: boolean;
  guardianConsentGiven: boolean;
  notificationPreferences: NotificationPreferences;
  assignedSubjectIds: string[];
  emailVerified: boolean;
  totpEnabled: boolean;
  totpEnrolledAt?: string | null;
  totpMandatory?: boolean;
  passwordUpdatedAt?: string | null;
  subscriptionStatus: 'trial' | 'active';
  subscriptionPlanId: string | null;
  subscriptionExpiresAt: string | null;
  currentLevel: PaperCategoryLevel;
  stars: number;
  streakDays: number;
  lastPracticeDate: string | null;
  dailyGoalQuestions: number;
  createdAt: string;
}

export interface ScopedAnalyticsFilters {
  subjectId?: string;
  topicId?: string;
  subtopicId?: string;
  questionId?: string;
  difficulty?: string;
  dateFrom?: string;
  dateTo?: string;
  studentId?: string;
  interventionStatus?: string;
}

const DEFAULT_PREFS: NotificationPreferences = {
  inApp: true,
  email: true,
  whatsapp: true,
  groupedSummary: false,
};

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToUser(row: Record<string, unknown>, assignedSubjectIds: string[] = []): UserAccount {
  const role = String(row.role) as UserRole;
  return {
    id: String(row.id),
    userIdCode: String(row.user_id_code),
    username: row.username ? String(row.username) : String(row.user_id_code).toLowerCase(),
    usernameUpdatedAt: row.username_updated_at ? String(row.username_updated_at) : null,
    name: String(row.name),
    email: String(row.email),
    whatsappNumber: String(row.whatsapp_number),
    whatsappVerified: Number(row.whatsapp_verified ?? 1) === 1,
    role,
    grade: String(row.grade || 'Grade 5'),
    delegatedPublishSubjects: parseJsonSafe<string[]>(
      row.delegated_publish_subjects_json,
      []
    ),
    active: Number(row.active ?? 1) === 1,
    guardianName: String(row.guardian_name || ''),
    guardianUserId: row.guardian_user_id ? String(row.guardian_user_id) : null,
    guardianContactVerified: Number(row.guardian_contact_verified ?? 1) === 1,
    guardianConsentGiven: Number(row.guardian_consent_given ?? 1) === 1,
    notificationPreferences: parseJsonSafe<NotificationPreferences>(
      row.notification_preferences_json,
      DEFAULT_PREFS
    ),
    assignedSubjectIds,
    passwordHash: String(row.password_hash),
    passwordUpdatedAt: row.password_updated_at ? String(row.password_updated_at) : null,
    totpSecret: String(row.totp_secret),
    emailVerified: Number(row.email_verified ?? 1) === 1,
    totpEnabled: Number(row.totp_enabled ?? 0) === 1,
    totpEnrolledAt: row.totp_enrolled_at ? String(row.totp_enrolled_at) : null,
    totpMandatory: role !== 'admin' && process.env.TOTP_MANDATORY_NON_ADMIN !== 'false',
    subscriptionStatus: String(row.subscription_status || 'trial') as 'trial' | 'active',
    subscriptionPlanId: row.subscription_plan_id ? String(row.subscription_plan_id) : null,
    subscriptionExpiresAt: row.subscription_expires_at ? String(row.subscription_expires_at) : null,
    currentLevel: String(row.current_level || 'Foundation Simple') as PaperCategoryLevel,
    stars: Number(row.stars ?? 0),
    streakDays: Number(row.streak_days ?? 0),
    lastPracticeDate: row.last_practice_date ? String(row.last_practice_date) : null,
    dailyGoalQuestions: Number(row.daily_goal_questions ?? 10),
    createdAt: String(row.created_at),
  };
}

export function rowToQuiz(row: Record<string, unknown>): QuizItem {
  return {
    id: String(row.id),
    source: (String(row.source || 'curated') as QuizItem['source']),
    subjectId: String(row.subject_id),
    topicId: String(row.topic_id),
    subtopicId: String(row.subtopic_id),
    version: Number(row.version ?? 1),
    grade: String(row.grade || 'Grade 5'),
    questionType: String(row.question_type || 'mcq') as QuestionType,
    cognitiveSkill: String(row.cognitive_skill || 'Application'),
    learningObjectives: String(row.learning_objectives || ''),
    hint: String(row.hint || ''),
    markingRule: parseJsonSafe<QuestionMarkingRule>(row.marking_rule_json, {}),
    acceptedAnswers: parseJsonSafe<string[]>(row.accepted_answers_json, []),
    defaultMarks: Number(row.default_marks ?? 1),
    approvalStatus: String(row.approval_status || 'ACTIVE') as QuestionApprovalStatus,
    authorId: String(row.author_id || 'usr-admin-1'),
    authorName: String(row.author_name || 'Kavinda Wickramasinghe'),
    reviewerId: row.reviewer_id ? String(row.reviewer_id) : null,
    reviewerName: row.reviewer_name ? String(row.reviewer_name) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    retiredAt: row.retired_at ? String(row.retired_at) : null,
    replacedByQuestionId: row.replaced_by_question_id ? String(row.replaced_by_question_id) : null,
    questionSi: String(row.question_si),
    questionEn: String(row.question_en),
    options: parseJsonSafe<[string, string, string, string]>(row.options_json, ['', '', '', '']),
    correctIndex: Number(row.correct_index ?? 0),
    imageUrl: row.image_url ? String(row.image_url) : undefined,
    memoryTrickTitle: String(row.memory_trick_title),
    memoryTrickBody: String(row.memory_trick_body),
    explanation: String(row.explanation),
    misconceptions: parseJsonSafe<QuestionMisconception[]>(row.misconceptions_json, []),
    qualityFlag: String(row.quality_flag || 'OK') as QuestionQualityFlag,
    attributes: parseJsonSafe(row.attributes_json, {
      intelligenceMeasure: 50,
      correctProbability: 0.7,
      wrongProbability: 0.3,
      examPriority: 7,
      quizStrength: 70,
      difficultyTier: 'Moderate' as DifficultyTier,
      cognitiveDomain: 'Mathematics & Word Problems' as CognitiveDomain,
      estimatedSeconds: 35,
    }),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : String(row.created_at),
  };
}

function rowToQuestionAttempt(row: Record<string, unknown>): QuestionAttempt {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    questionId: String(row.question_id),
    questionVersion: Number(row.question_version ?? 1),
    subjectId: String(row.subject_id),
    topicId: String(row.topic_id),
    subtopicId: String(row.subtopic_id),
    attemptSequenceNumber: Number(row.attempt_sequence_number ?? 1),
    submittedAnswerIndex:
      row.submitted_answer_index === null || row.submitted_answer_index === undefined
        ? null
        : Number(row.submitted_answer_index),
    submissionStatus: String(row.submission_status) as AttemptSubmissionStatus,
    isCorrect:
      row.is_correct === null || row.is_correct === undefined
        ? null
        : Number(row.is_correct) === 1,
    responseDurationMs: Number(row.response_duration_ms ?? 0),
    difficultyAtAttempt: String(row.difficulty_at_attempt || 'Moderate') as DifficultyTier,
    hintUsed: Number(row.hint_used ?? 0) === 1,
    contextMode: String(row.context_mode || 'practice') as AttemptContextMode,
    sessionId: String(row.session_id),
    deliveryContext: parseJsonSafe(row.delivery_context_json, {}),
    idempotencyKey: String(row.idempotency_key),
    attemptTimestamp: String(row.attempt_timestamp),
  };
}

function rowToInterventionCase(row: Record<string, unknown>): InterventionCase {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    questionId: String(row.question_id),
    subjectId: String(row.subject_id),
    topicId: String(row.topic_id),
    subtopicId: String(row.subtopic_id),
    status: String(row.status) as InterventionStatus,
    incorrectCount: Number(row.incorrect_count ?? 0),
    thresholdTriggeredAt: Number(row.threshold_triggered_at ?? 3),
    latestAttemptId: String(row.latest_attempt_id),
    assignedTeacherId: row.assigned_teacher_id ? String(row.assigned_teacher_id) : null,
    templateId: row.template_id ? String(row.template_id) : null,
    instructionTitle: String(row.instruction_title || ''),
    instructionBody: String(row.instruction_body || ''),
    suggestedSupportNote: String(row.suggested_support_note || ''),
    recommendedPracticeTopicId: row.recommended_practice_topic_id
      ? String(row.recommended_practice_topic_id)
      : null,
    consecutiveCorrectAfterCase: Number(row.consecutive_correct_after_case ?? 0),
    readyForTeacherReview: Number(row.ready_for_teacher_review ?? 0) === 1,
    reopenCount: Number(row.reopen_count ?? 0),
    dismissalReason: row.dismissal_reason ? String(row.dismissal_reason) : null,
    resolutionNotes: row.resolution_notes ? String(row.resolution_notes) : null,
    lastAlertSentAt: row.last_alert_sent_at ? String(row.last_alert_sent_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

export class AcademicService {
  public readonly dbWrapper: Man5heDatabase;

  constructor(dbWrapper: Man5heDatabase) {
    this.dbWrapper = dbWrapper;
  }

  private get db() {
    return this.dbWrapper.db;
  }

  // --- Authorization & User Lookup ---
  public getTeacherAssignedSubjectIds(teacherId: string): string[] {
    const rows = this.db
      .prepare('SELECT subject_id FROM teacher_subject_assignments WHERE teacher_id = ?')
      .all(teacherId) as { subject_id: string }[];
    return rows.map((r) => r.subject_id);
  }

  public buildAuthContext(user: UserAccount): AuthorizationContext {
    const assignedSubjectIds =
      user.role === 'teacher' ? this.getTeacherAssignedSubjectIds(user.id) : [];
    return {
      userId: user.id,
      role: user.role,
      assignedSubjectIds,
    };
  }

  public sanitizeUser(user: UserAccount): SanitizedUser {
    const assignedSubjectIds =
      user.role === 'teacher' ? this.getTeacherAssignedSubjectIds(user.id) : [];
    return {
      id: user.id,
      userIdCode: user.userIdCode,
      username: user.username || user.userIdCode.toLowerCase(),
      usernameUpdatedAt: user.usernameUpdatedAt ?? null,
      name: user.name,
      email: user.email,
      whatsappNumber: user.whatsappNumber,
      whatsappVerified: user.whatsappVerified ?? true,
      role: user.role,
      grade: user.grade || 'Grade 5',
      delegatedPublishSubjects: user.delegatedPublishSubjects || [],
      active: user.active ?? true,
      guardianName: user.guardianName || '',
      guardianUserId: user.guardianUserId ?? null,
      guardianContactVerified: user.guardianContactVerified ?? true,
      guardianConsentGiven: user.guardianConsentGiven ?? true,
      notificationPreferences: user.notificationPreferences || DEFAULT_PREFS,
      assignedSubjectIds,
      emailVerified: user.emailVerified,
      totpEnabled: user.totpEnabled,
      totpEnrolledAt: user.totpEnrolledAt ?? null,
      totpMandatory:
        user.totpMandatory ??
        (user.role !== 'admin' && process.env.TOTP_MANDATORY_NON_ADMIN !== 'false'),
      passwordUpdatedAt: user.passwordUpdatedAt ?? null,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionPlanId: user.subscriptionPlanId,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      currentLevel: user.currentLevel,
      stars: user.stars,
      streakDays: user.streakDays,
      lastPracticeDate: user.lastPracticeDate ?? null,
      dailyGoalQuestions: user.dailyGoalQuestions ?? 10,
      createdAt: user.createdAt,
    };
  }

  public getUserById(userId: string): UserAccount | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const assigned =
      row.role === 'teacher' ? this.getTeacherAssignedSubjectIds(String(row.id)) : [];
    return rowToUser(row, assigned);
  }

  public getUserByIdentifier(identifier: string): UserAccount | null {
    const clean = identifier.trim().toLowerCase();
    if (!clean) return null;
    const row = this.db
      .prepare(
        `SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(user_id_code) = ? OR LOWER(COALESCE(username, '')) = ?`
      )
      .get(clean, clean, clean) as Record<string, unknown> | undefined;
    if (!row) return null;
    const assigned =
      row.role === 'teacher' ? this.getTeacherAssignedSubjectIds(String(row.id)) : [];
    return rowToUser(row, assigned);
  }

  private allocateInitialUsername(preferredSeed: string): string {
    const base = preferredSeed
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '')
      .replace(/[._-]{2,}/g, '_');
    let candidate = base.length >= 4 ? base.slice(0, 24) : `m5_${base || 'user'}`;
    while (
      this.db
        .prepare('SELECT id FROM users WHERE LOWER(username) = ?')
        .get(candidate.toLowerCase())
    ) {
      candidate = `${candidate.slice(0, 20)}_${crypto.randomBytes(2).toString('hex')}`;
    }
    return candidate;
  }

  public createStudentUser(params: {
    userIdCode: string;
    username?: string;
    name: string;
    email: string;
    whatsappNumber: string;
    passwordHash: string;
    totpSecret: string;
    totpEnabled: boolean;
    guardianName?: string;
  }): UserAccount {
    const cleanEmail = params.email.trim().toLowerCase();
    const cleanCode = params.userIdCode.trim().toUpperCase();
    const cleanUsername = this.allocateInitialUsername(params.username || cleanCode);
    const existing = this.db
      .prepare(
        'SELECT id FROM users WHERE LOWER(email) = ? OR UPPER(user_id_code) = ? OR LOWER(username) = ?'
      )
      .get(cleanEmail, cleanCode, cleanUsername.toLowerCase());
    if (existing) {
      throw new HttpError(409, 'An account with this Email, Username, or User ID already exists.');
    }

    const id = `usr-${crypto.randomBytes(5).toString('hex')}`;
    const now = new Date().toISOString();
    const encryptedTotp = encryptTotpSecret(params.totpSecret, getTotpEncryptionMasterKey());
    const waNumber = params.whatsappNumber.trim() || '+94770000000';

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO users (
            id, user_id_code, username, name, email, whatsapp_number, whatsapp_verified,
            role, active, guardian_name, guardian_contact_verified, guardian_consent_given,
            notification_preferences_json, password_hash, password_updated_at, totp_secret,
            email_verified, totp_enabled, totp_enrolled_at, subscription_status,
            subscription_plan_id, subscription_expires_at, current_level, stars, streak_days,
            daily_goal_questions, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 'student', 1, ?, 1, 1, ?, ?, ?, ?, 1, ?, ?, 'trial', NULL, NULL, 'Foundation Simple', 20, 1, 10, ?)`
        )
        .run(
          id,
          cleanCode,
          cleanUsername,
          params.name.trim(),
          cleanEmail,
          waNumber,
          (params.guardianName || 'Parent / Guardian').trim(),
          JSON.stringify(DEFAULT_PREFS),
          params.passwordHash,
          now,
          encryptedTotp,
          params.totpEnabled ? 1 : 0,
          params.totpEnabled ? now : null,
          now
        );

      this.db
        .prepare(
          `INSERT INTO verified_recovery_contacts (id, user_id, channel, contact_value, is_primary, verified, verified_at, created_at, updated_at)
           VALUES (?, ?, 'email', ?, 1, 1, ?, ?, ?), (?, ?, 'whatsapp', ?, 1, 1, ?, ?, ?)`
        )
        .run(
          `VRC-${crypto.randomBytes(4).toString('hex')}`,
          id,
          cleanEmail,
          now,
          now,
          now,
          `VRC-${crypto.randomBytes(4).toString('hex')}`,
          id,
          waNumber,
          now,
          now,
          now
        );

      this.db
        .prepare(
          `INSERT INTO password_history (id, user_id, password_hash, created_at) VALUES (?, ?, ?, ?)`
        )
        .run(`PWH-${crypto.randomBytes(5).toString('hex')}`, id, params.passwordHash, now);

      if (params.totpEnabled) {
        this.db
          .prepare(
            `INSERT INTO totp_enrollments (id, user_id, encrypted_secret, status, guardian_assisted, enrolled_by_user_id, verified_at, created_at, updated_at)
             VALUES (?, ?, ?, 'ACTIVE', 0, ?, ?, ?, ?)`
          )
          .run(`TOTP-${id}`, id, encryptedTotp, id, now, now, now);
      }
    });

    return this.getUserById(id)!;
  }

  public updateDailyGoal(userId: string, targetQuestions: unknown): UserAccount {
    const target = sanitizeDailyGoalTarget(targetQuestions);
    this.db.prepare('UPDATE users SET daily_goal_questions = ? WHERE id = ?').run(target, userId);
    return this.getUserById(userId)!;
  }

  // --- Audit Helper ---
  public writeAuditLog(params: {
    actorId: string;
    actorName: string;
    actorRole: UserRole | 'system';
    action: string;
    targetType: string;
    targetId: string;
    details: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, actor_id, actor_name, actor_role, action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `AUD-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        params.actorId,
        params.actorName,
        params.actorRole,
        params.action,
        params.targetType,
        params.targetId,
        JSON.stringify(params.details),
        new Date().toISOString()
      );
  }

  public listAuditLogs(limit = 50): AuditLogRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
      .all(Math.min(200, Math.max(1, limit))) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      actorId: String(r.actor_id),
      actorName: String(r.actor_name),
      actorRole: String(r.actor_role) as UserRole | 'system',
      action: String(r.action),
      targetType: String(r.target_type),
      targetId: String(r.target_id),
      detailsJson: String(r.details_json),
      createdAt: String(r.created_at),
    }));
  }

  // --- Academic Configuration ---
  public getAcademicConfig(): AcademicConfig {
    const row = this.db.prepare('SELECT * FROM academic_config WHERE id = 1').get() as
      | Record<string, unknown>
      | undefined;
    if (!row) return DEFAULT_ACADEMIC_CONFIG;
    return {
      repeatedErrorThreshold: Number(row.repeated_error_threshold),
      notificationCooldownMinutes: Number(row.notification_cooldown_minutes),
      alertGroupingWindowMinutes: Number(row.alert_grouping_window_minutes),
      sustainedCorrectRequiredForReview: Number(row.sustained_correct_required_for_review),
      autoNotifyAdminsOnEscalation: Number(row.auto_notify_admins_on_escalation) === 1,
      requireTeacherReviewBeforeClose: Number(row.require_teacher_review_before_close) === 1,
      updatedAt: String(row.updated_at),
      updatedBy: String(row.updated_by),
    };
  }

  public updateAcademicConfig(
    adminUser: UserAccount,
    partial: Partial<AcademicConfig>
  ): AcademicConfig {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Only administrators can update academic rules and thresholds.');
    }
    const cur = this.getAcademicConfig();
    const next: AcademicConfig = {
      repeatedErrorThreshold: Math.min(
        10,
        Math.max(2, Number(partial.repeatedErrorThreshold ?? cur.repeatedErrorThreshold))
      ),
      notificationCooldownMinutes: Math.min(
        1440,
        Math.max(0, Number(partial.notificationCooldownMinutes ?? cur.notificationCooldownMinutes))
      ),
      alertGroupingWindowMinutes: Math.min(
        240,
        Math.max(1, Number(partial.alertGroupingWindowMinutes ?? cur.alertGroupingWindowMinutes))
      ),
      sustainedCorrectRequiredForReview: Math.min(
        10,
        Math.max(2, Number(partial.sustainedCorrectRequiredForReview ?? cur.sustainedCorrectRequiredForReview))
      ),
      autoNotifyAdminsOnEscalation:
        typeof partial.autoNotifyAdminsOnEscalation === 'boolean'
          ? partial.autoNotifyAdminsOnEscalation
          : cur.autoNotifyAdminsOnEscalation,
      requireTeacherReviewBeforeClose:
        typeof partial.requireTeacherReviewBeforeClose === 'boolean'
          ? partial.requireTeacherReviewBeforeClose
          : cur.requireTeacherReviewBeforeClose,
      updatedAt: new Date().toISOString(),
      updatedBy: adminUser.email,
    };

    this.db
      .prepare(
        `UPDATE academic_config SET
          repeated_error_threshold = ?, notification_cooldown_minutes = ?,
          alert_grouping_window_minutes = ?, sustained_correct_required_for_review = ?,
          auto_notify_admins_on_escalation = ?, require_teacher_review_before_close = ?,
          updated_at = ?, updated_by = ?
         WHERE id = 1`
      )
      .run(
        next.repeatedErrorThreshold,
        next.notificationCooldownMinutes,
        next.alertGroupingWindowMinutes,
        next.sustainedCorrectRequiredForReview,
        next.autoNotifyAdminsOnEscalation ? 1 : 0,
        next.requireTeacherReviewBeforeClose ? 1 : 0,
        next.updatedAt,
        next.updatedBy
      );

    this.writeAuditLog({
      actorId: adminUser.id,
      actorName: adminUser.name,
      actorRole: 'admin',
      action: 'ACADEMIC_CONFIG_UPDATED',
      targetType: 'academic_config',
      targetId: '1',
      details: { previous: cur, updated: next },
    });

    return next;
  }

  // --- Teacher & Student Management ---
  public listTeachers() {
    const rows = this.db
      .prepare("SELECT * FROM users WHERE role = 'teacher' ORDER BY created_at DESC")
      .all() as Record<string, unknown>[];

    return rows.map((r) => {
      const user = rowToUser(r, this.getTeacherAssignedSubjectIds(String(r.id)));
      const caseStats = this.db
        .prepare(
          `SELECT
            SUM(CASE WHEN status IN ('OPEN', 'UNDER_REVIEW', 'INTERVENTION_ASSIGNED', 'MONITORING') THEN 1 ELSE 0 END) as active_cases,
            SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) as resolved_cases
           FROM intervention_cases WHERE assigned_teacher_id = ?`
        )
        .get(user.id) as { active_cases: number | null; resolved_cases: number | null };

      const actionsCount = (
        this.db
          .prepare('SELECT COUNT(*) as cnt FROM intervention_actions WHERE actor_id = ?')
          .get(user.id) as { cnt: number }
      ).cnt;

      return {
        ...this.sanitizeUser(user),
        activeCaseCount: Number(caseStats?.active_cases ?? 0),
        resolvedCaseCount: Number(caseStats?.resolved_cases ?? 0),
        actionsTakenCount: Number(actionsCount ?? 0),
      };
    });
  }

  public createTeacher(
    adminUser: UserAccount,
    payload: {
      name: string;
      email: string;
      userIdCode?: string;
      whatsappNumber?: string;
      password: string;
      subjectIds: string[];
    }
  ) {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Administrator access required to create teacher accounts.');
    }
    const cleanEmail = String(payload.email || '').trim().toLowerCase();
    const cleanName = String(payload.name || '').trim();
    const cleanCode =
      String(payload.userIdCode || '').trim().toUpperCase() ||
      `M5-TCH-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    if (!cleanName || !cleanEmail.includes('@') || String(payload.password || '').length < 6) {
      throw new HttpError(
        400,
        'Provide teacher full name, valid email, and password (minimum 6 characters).'
      );
    }

    const exists = this.db
      .prepare('SELECT id FROM users WHERE LOWER(email) = ? OR UPPER(user_id_code) = ?')
      .get(cleanEmail, cleanCode);
    if (exists) {
      throw new HttpError(409, 'A user with that email or ID code already exists.');
    }

    const validSubjectIds = this.validateSubjectIds(payload.subjectIds || []);
    const teacherId = `usr-teacher-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const cleanUsername = this.allocateInitialUsername(cleanCode);
    const pwHash = hashPassword(payload.password);
    const waNumber = String(payload.whatsappNumber || '+94710000000').trim();
    const encryptedTotp = encryptTotpSecret('MFRGGZDFMZTWQ2LK', getTotpEncryptionMasterKey());

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO users (
            id, user_id_code, username, name, email, whatsapp_number, whatsapp_verified, role, active, guardian_name,
            guardian_contact_verified, guardian_consent_given, notification_preferences_json,
            password_hash, password_updated_at, totp_secret, email_verified, totp_enabled, subscription_status,
            subscription_plan_id, subscription_expires_at, current_level, stars, streak_days,
            daily_goal_questions, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 'teacher', 1, '', 1, 1, ?, ?, ?, ?, 1, 0, 'active', NULL, NULL, 'Scholarship Master', 0, 0, 10, ?)`
        )
        .run(
          teacherId,
          cleanCode,
          cleanUsername,
          cleanName,
          cleanEmail,
          waNumber,
          JSON.stringify(DEFAULT_PREFS),
          pwHash,
          now,
          encryptedTotp,
          now
        );

      this.db
        .prepare(
          `INSERT INTO verified_recovery_contacts (id, user_id, channel, contact_value, is_primary, verified, verified_at, created_at, updated_at)
           VALUES (?, ?, 'email', ?, 1, 1, ?, ?, ?), (?, ?, 'whatsapp', ?, 1, 1, ?, ?, ?)`
        )
        .run(
          `VRC-${crypto.randomBytes(4).toString('hex')}`,
          teacherId,
          cleanEmail,
          now,
          now,
          now,
          `VRC-${crypto.randomBytes(4).toString('hex')}`,
          teacherId,
          waNumber,
          now,
          now,
          now
        );

      this.db
        .prepare(
          `INSERT INTO password_history (id, user_id, password_hash, created_at) VALUES (?, ?, ?, ?)`
        )
        .run(`PWH-${crypto.randomBytes(5).toString('hex')}`, teacherId, pwHash, now);

      const assignStmt = this.db.prepare(
        `INSERT INTO teacher_subject_assignments (id, teacher_id, subject_id, assigned_by_admin_id, assigned_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const sid of validSubjectIds) {
        assignStmt.run(
          `TSA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          teacherId,
          sid,
          adminUser.id,
          now
        );
      }

      this.writeAuditLog({
        actorId: adminUser.id,
        actorName: adminUser.name,
        actorRole: 'admin',
        action: 'TEACHER_CREATED',
        targetType: 'user',
        targetId: teacherId,
        details: { email: cleanEmail, userIdCode: cleanCode, subjectIds: validSubjectIds },
      });
    });

    const created = this.getUserById(teacherId)!;
    return this.sanitizeUser(created);
  }

  public setTeacherSubjects(
    adminUser: UserAccount,
    teacherId: string,
    subjectIds: string[]
  ): SanitizedUser {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Administrator access required to manage teacher subjects.');
    }
    const teacher = this.getUserById(teacherId);
    if (!teacher || teacher.role !== 'teacher') {
      throw new HttpError(404, 'Teacher account not found.');
    }

    const previousIds = this.getTeacherAssignedSubjectIds(teacherId);
    const nextIds = this.validateSubjectIds(subjectIds);
    const now = new Date().toISOString();

    this.dbWrapper.transaction(() => {
      this.db.prepare('DELETE FROM teacher_subject_assignments WHERE teacher_id = ?').run(teacherId);
      const insertStmt = this.db.prepare(
        `INSERT INTO teacher_subject_assignments (id, teacher_id, subject_id, assigned_by_admin_id, assigned_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const sid of nextIds) {
        insertStmt.run(
          `TSA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          teacherId,
          sid,
          adminUser.id,
          now
        );
      }

      this.writeAuditLog({
        actorId: adminUser.id,
        actorName: adminUser.name,
        actorRole: 'admin',
        action: 'TEACHER_SUBJECTS_UPDATED',
        targetType: 'teacher_subject_assignments',
        targetId: teacherId,
        details: { previousSubjectIds: previousIds, nextSubjectIds: nextIds },
      });

      this.insertNotificationRow({
        recipientUserId: teacherId,
        recipientRole: 'teacher',
        channel: 'in_app',
        category: 'admin_oversight',
        title: 'Subject Permissions Updated',
        body: `Administrator ${adminUser.name} updated your assigned subjects (${nextIds.length} active category${nextIds.length === 1 ? '' : 's'}).`,
        dedupeKey: `perm-${teacherId}-${Date.now()}`,
        deliveryStatus: 'delivered',
      });
    });

    return this.sanitizeUser(this.getUserById(teacherId)!);
  }

  public updateTeacherStatus(
    adminUser: UserAccount,
    teacherId: string,
    active: boolean
  ): SanitizedUser {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Administrator access required.');
    }
    const teacher = this.getUserById(teacherId);
    if (!teacher || teacher.role !== 'teacher') {
      throw new HttpError(404, 'Teacher account not found.');
    }
    this.db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, teacherId);
    this.writeAuditLog({
      actorId: adminUser.id,
      actorName: adminUser.name,
      actorRole: 'admin',
      action: active ? 'TEACHER_ACTIVATED' : 'TEACHER_DEACTIVATED',
      targetType: 'user',
      targetId: teacherId,
      details: { active },
    });
    return this.sanitizeUser(this.getUserById(teacherId)!);
  }

  private validateSubjectIds(subjectIds: string[]): string[] {
    const validRows = this.db.prepare('SELECT id FROM subjects').all() as { id: string }[];
    const validSet = new Set(validRows.map((r) => r.id));
    const unique = Array.from(new Set(subjectIds.map((s) => String(s))));
    for (const sid of unique) {
      if (!validSet.has(sid)) {
        throw new HttpError(400, `Unknown subject category ID: ${sid}`);
      }
    }
    return unique;
  }

  public listStudentsScoped(ctx: AuthorizationContext) {
    if (ctx.role === 'student') {
      const me = this.getUserById(ctx.userId);
      return me ? [this.sanitizeUser(me)] : [];
    }

    const allStudents = this.db
      .prepare("SELECT * FROM users WHERE role = 'student' ORDER BY name ASC")
      .all() as Record<string, unknown>[];

    const questionSubjectMap = this.getQuestionSubjectMap();
    const allAttempts = (
      this.db.prepare('SELECT * FROM question_attempts').all() as Record<string, unknown>[]
    ).map(rowToQuestionAttempt);

    const allCases = (
      this.db.prepare('SELECT * FROM intervention_cases').all() as Record<string, unknown>[]
    ).map(rowToInterventionCase);

    const allowedSet = new Set(ctx.assignedSubjectIds);

    const result = [];
    for (const row of allStudents) {
      const stu = rowToUser(row);
      const stuAttempts = allAttempts.filter((a) => {
        if (a.studentId !== stu.id) return false;
        if (ctx.role === 'admin') return true;
        const effectiveSubj = questionSubjectMap.get(a.questionId) || a.subjectId;
        return allowedSet.has(effectiveSubj);
      });
      const stuCases = allCases.filter((c) => {
        if (c.studentId !== stu.id) return false;
        if (ctx.role === 'admin') return true;
        const effectiveSubj = questionSubjectMap.get(c.questionId) || c.subjectId;
        return allowedSet.has(effectiveSubj);
      });

      if (ctx.role === 'teacher' && stuAttempts.length === 0 && stuCases.length === 0) {
        continue;
      }

      const valid = stuAttempts.filter((a) => a.submissionStatus === 'valid_answered');
      const correct = valid.filter((a) => a.isCorrect === true).length;
      const openCases = stuCases.filter((c) => isActiveInterventionStatus(c.status)).length;
      const improvement = calculateStudentBaselineVsFollowUp(stuAttempts);

      result.push({
        ...this.sanitizeUser(stu),
        scopedValidAttempts: valid.length,
        scopedAccuracyPercent: valid.length ? Math.round((correct / valid.length) * 1000) / 10 : 0,
        openInterventionsCount: openCases,
        improvement,
      });
    }
    return result;
  }

  public updateStudentGuardianConsent(
    actor: UserAccount,
    studentId: string,
    payload: {
      guardianName?: string;
      whatsappNumber?: string;
      guardianContactVerified?: boolean;
      guardianConsentGiven?: boolean;
    }
  ): SanitizedUser {
    if (actor.role !== 'admin' && actor.id !== studentId) {
      throw new HttpError(403, 'Not authorized to modify guardian contact or consent.');
    }
    const target = this.getUserById(studentId);
    if (!target) {
      throw new HttpError(404, 'Student account not found.');
    }

    const nextGuardianName =
      typeof payload.guardianName === 'string' ? payload.guardianName.trim() : target.guardianName || '';
    const nextWhatsapp =
      typeof payload.whatsappNumber === 'string' && payload.whatsappNumber.trim()
        ? payload.whatsappNumber.trim()
        : target.whatsappNumber;
    const nextVerified =
      typeof payload.guardianContactVerified === 'boolean'
        ? payload.guardianContactVerified
        : target.guardianContactVerified ?? true;
    const nextConsent =
      typeof payload.guardianConsentGiven === 'boolean'
        ? payload.guardianConsentGiven
        : target.guardianConsentGiven ?? true;

    this.db
      .prepare(
        `UPDATE users SET guardian_name = ?, whatsapp_number = ?, guardian_contact_verified = ?, guardian_consent_given = ? WHERE id = ?`
      )
      .run(nextGuardianName, nextWhatsapp, nextVerified ? 1 : 0, nextConsent ? 1 : 0, studentId);

    this.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'GUARDIAN_CONSENT_UPDATED',
      targetType: 'user',
      targetId: studentId,
      details: {
        guardianName: nextGuardianName,
        guardianContactVerified: nextVerified,
        guardianConsentGiven: nextConsent,
      },
    });

    return this.sanitizeUser(this.getUserById(studentId)!);
  }

  // --- Curriculum Hierarchy & Questions ---
  public getCurriculumHierarchy(ctx?: AuthorizationContext) {
    const subjects = (
      this.db.prepare('SELECT * FROM subjects WHERE active = 1 ORDER BY sort_order ASC').all() as Record<
        string,
        unknown
      >[]
    ).map(
      (r): SubjectCategory => ({
        id: String(r.id),
        slug: String(r.slug),
        nameEn: String(r.name_en),
        nameSi: String(r.name_si),
        nameTa: String(r.name_ta),
        cognitiveDomain: String(r.cognitive_domain) as CognitiveDomain,
        sortOrder: Number(r.sort_order),
        active: Number(r.active) === 1,
      })
    );

    const visibleSubjects =
      ctx && ctx.role === 'teacher'
        ? subjects.filter((s) => ctx.assignedSubjectIds.includes(s.id))
        : subjects;
    const visibleSubjectIds = new Set(visibleSubjects.map((s) => s.id));

    const topics = (
      this.db.prepare('SELECT * FROM topics ORDER BY sort_order ASC').all() as Record<string, unknown>[]
    )
      .map(
        (r): TopicNode => ({
          id: String(r.id),
          subjectId: String(r.subject_id),
          nameEn: String(r.name_en),
          nameSi: String(r.name_si),
          prerequisiteTopicId: r.prerequisite_topic_id ? String(r.prerequisite_topic_id) : null,
          sortOrder: Number(r.sort_order),
        })
      )
      .filter((t) => visibleSubjectIds.has(t.subjectId));

    const subtopics = (
      this.db.prepare('SELECT * FROM subtopics ORDER BY sort_order ASC').all() as Record<string, unknown>[]
    )
      .map(
        (r): SubtopicNode => ({
          id: String(r.id),
          topicId: String(r.topic_id),
          subjectId: String(r.subject_id),
          nameEn: String(r.name_en),
          nameSi: String(r.name_si),
          sortOrder: Number(r.sort_order),
        })
      )
      .filter((st) => visibleSubjectIds.has(st.subjectId));

    return {
      subjects: visibleSubjects,
      topics,
      subtopics,
    };
  }

  public getQuestionSubjectMap(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, subject_id FROM questions').all() as {
      id: string;
      subject_id: string;
    }[];
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.id, r.subject_id);
    return map;
  }

  public resolveQuizById(quizId: string): QuizItem | null {
    const row = this.db.prepare('SELECT * FROM questions WHERE id = ? AND active = 1').get(quizId) as
      | Record<string, unknown>
      | undefined;
    if (row) return rowToQuiz(row);

    const match = quizId.match(/^POOL-(\d+)$/);
    if (match) {
      const q = generateVirtualQuizFromPool(Number(match[1]));
      const hier = resolveDefaultHierarchyForQuestion(q.id, q.attributes.cognitiveDomain);
      return {
        ...q,
        subjectId: hier.subjectId,
        topicId: hier.topicId,
        subtopicId: hier.subtopicId,
        version: 1,
      };
    }
    return null;
  }

  public listCuratedQuestions(
    ctx: AuthorizationContext,
    includeRetired = false,
    activeOnly = false
  ): QuizItem[] {
    const sql = activeOnly
      ? `SELECT * FROM questions WHERE active = 1 AND COALESCE(approval_status, 'ACTIVE') = 'ACTIVE' ORDER BY created_at DESC`
      : includeRetired
      ? 'SELECT * FROM questions WHERE active = 1 ORDER BY created_at DESC'
      : `SELECT * FROM questions WHERE active = 1 AND COALESCE(approval_status, 'ACTIVE') != 'RETIRED' ORDER BY created_at DESC`;
    const rows = this.db.prepare(sql).all() as Record<string, unknown>[];
    const items = rows.map(rowToQuiz);
    if (ctx.role === 'teacher') {
      const allowed = new Set(ctx.assignedSubjectIds);
      return items.filter((q) => allowed.has(resolveQuestionSubjectId(q)));
    }
    return items;
  }

  public listQuestionsWithStats(
    ctx: AuthorizationContext,
    filters: {
      source?: string;
      subjectId?: string;
      topicId?: string;
      subtopicId?: string;
      domain?: string;
      difficulty?: string;
      grade?: string;
      questionType?: string;
      approvalStatus?: string;
      cognitiveSkill?: string;
      authorId?: string;
      performanceFlag?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    }
  ) {
    if (
      ctx.role === 'teacher' &&
      filters.subjectId &&
      filters.subjectId !== 'All' &&
      !canAccessSubject(ctx, filters.subjectId)
    ) {
      throw new HttpError(
        403,
        'Access denied: You are not assigned to this subject category.'
      );
    }

    const includeRetired =
      filters.approvalStatus === 'RETIRED' || filters.approvalStatus === 'ALL_WITH_RETIRED';
    const curated = this.listCuratedQuestions(ctx, includeRetired);
    const sourceFilter = filters.source || 'all';
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.min(200, Math.max(5, Number(filters.pageSize || 50)));

    let list: QuizItem[] = [];
    if (sourceFilter === 'curated') {
      list = curated;
    } else if (sourceFilter === 'pool') {
      const start = (page - 1) * pageSize + 1;
      for (let i = 0; i < pageSize * 3 && list.length < pageSize; i++) {
        const q = generateVirtualQuizFromPool(start + i);
        const hier = resolveDefaultHierarchyForQuestion(q.id, q.attributes.cognitiveDomain);
        const enriched: QuizItem = {
          ...q,
          subjectId: hier.subjectId,
          topicId: hier.topicId,
          subtopicId: hier.subtopicId,
          version: 1,
          grade: 'Grade 5',
          questionType: 'mcq',
          approvalStatus: 'ACTIVE',
          defaultMarks: 1,
        };
        if (canAccessQuestion(ctx, enriched)) {
          list.push(enriched);
        }
      }
    } else {
      const poolSamples: QuizItem[] = [];
      for (let i = 1; i <= 24; i++) {
        const q = generateVirtualQuizFromPool(i);
        const hier = resolveDefaultHierarchyForQuestion(q.id, q.attributes.cognitiveDomain);
        const enriched: QuizItem = {
          ...q,
          subjectId: hier.subjectId,
          topicId: hier.topicId,
          subtopicId: hier.subtopicId,
          version: 1,
          grade: 'Grade 5',
          questionType: 'mcq',
          approvalStatus: 'ACTIVE',
          defaultMarks: 1,
        };
        if (canAccessQuestion(ctx, enriched)) {
          poolSamples.push(enriched);
        }
      }
      list = [...curated, ...poolSamples];
    }

    if (filters.subjectId && filters.subjectId !== 'All') {
      list = list.filter((q) => resolveQuestionSubjectId(q) === filters.subjectId);
    }
    if (filters.topicId && filters.topicId !== 'All') {
      list = list.filter((q) => q.topicId === filters.topicId);
    }
    if (filters.subtopicId && filters.subtopicId !== 'All') {
      list = list.filter((q) => q.subtopicId === filters.subtopicId);
    }
    if (filters.domain && filters.domain !== 'All') {
      list = list.filter((q) => q.attributes.cognitiveDomain === filters.domain);
    }
    if (filters.difficulty && filters.difficulty !== 'All') {
      list = list.filter((q) => q.attributes.difficultyTier === filters.difficulty);
    }
    if (filters.grade && filters.grade !== 'All') {
      list = list.filter((q) => (q.grade || 'Grade 5') === filters.grade);
    }
    if (filters.questionType && filters.questionType !== 'All') {
      list = list.filter((q) => (q.questionType || 'mcq') === filters.questionType);
    }
    if (
      filters.approvalStatus &&
      filters.approvalStatus !== 'All' &&
      filters.approvalStatus !== 'ALL_WITH_RETIRED'
    ) {
      list = list.filter((q) => (q.approvalStatus || 'ACTIVE') === filters.approvalStatus);
    }
    if (filters.cognitiveSkill && filters.cognitiveSkill !== 'All') {
      const skLower = filters.cognitiveSkill.toLowerCase();
      list = list.filter((q) => (q.cognitiveSkill || '').toLowerCase().includes(skLower));
    }
    if (filters.authorId && filters.authorId !== 'All') {
      list = list.filter((q) => q.authorId === filters.authorId);
    }
    if (filters.search && filters.search.trim()) {
      const qLower = filters.search.trim().toLowerCase();
      list = list.filter(
        (q) =>
          q.id.toLowerCase().includes(qLower) ||
          q.questionSi.toLowerCase().includes(qLower) ||
          q.questionEn.toLowerCase().includes(qLower) ||
          (q.cognitiveSkill || '').toLowerCase().includes(qLower)
      );
    }

    const statsRows = this.db.prepare('SELECT * FROM question_stats').all() as Record<
      string,
      unknown
    >[];
    const statsMap = new Map<string, Record<string, unknown>>();
    for (const sr of statsRows) statsMap.set(String(sr.question_id), sr);

    let enriched = list.map((q) => {
      const st = statsMap.get(q.id);
      const validAttempts = st ? Number(st.valid_attempts) : 0;
      return {
        ...q,
        subjectId: resolveQuestionSubjectId(q),
        stats: {
          validAttempts,
          uniqueStudents: st ? Number(st.unique_students) : 0,
          correctRate: st ? Number(st.correct_rate) : 0,
          incorrectRate: st ? Number(st.incorrect_rate) : 0,
          repeatedErrorStudentCount: st ? Number(st.repeated_error_student_count) : 0,
          skippedCount: st ? Number(st.skipped_count) : 0,
          timedOutCount: st ? Number(st.timed_out_count) : 0,
          medianResponseMs: st ? Number(st.median_response_ms) : 0,
        },
      };
    });

    if (filters.performanceFlag === 'repeated_error') {
      enriched = enriched.filter((q) => q.stats.repeatedErrorStudentCount > 0);
    } else if (filters.performanceFlag === 'low_accuracy') {
      enriched = enriched.filter((q) => q.stats.validAttempts > 0 && q.stats.correctRate < 50);
    }

    const totalCount = enriched.length;
    const startIdx = (page - 1) * pageSize;
    const pagedQuizzes =
      sourceFilter === 'pool' ? enriched : enriched.slice(startIdx, startIdx + pageSize);

    return {
      totalVirtualPool: TOTAL_VIRTUAL_POOL_SIZE,
      curatedCount: curated.length,
      totalCount,
      page,
      pageSize,
      quizzes: pagedQuizzes,
    };
  }

  public createQuestion(
    adminUser: UserAccount,
    payload: {
      subjectId?: string;
      topicId?: string;
      subtopicId?: string;
      questionSi: string;
      questionEn?: string;
      options: string[];
      correctIndex: number;
      imageUrl?: string;
      memoryTrickTitle?: string;
      memoryTrickBody: string;
      explanation?: string;
      misconceptions?: QuestionMisconception[];
      attributes?: Partial<QuizItem['attributes']>;
    }
  ): QuizItem {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Administrator access required to create curriculum questions.');
    }
    if (
      !payload.questionSi ||
      !Array.isArray(payload.options) ||
      payload.options.length !== 4 ||
      !payload.memoryTrickBody
    ) {
      throw new HttpError(
        400,
        'Provide question text, 4 options, and child psychological memory instructions.'
      );
    }

    const domain: CognitiveDomain =
      (payload.attributes?.cognitiveDomain as CognitiveDomain) || 'Logical & Number Patterns';
    const subjectId = payload.subjectId || DOMAIN_TO_SUBJECT_ID[domain] || 'subj-math';
    const fallbackHier = resolveDefaultHierarchyForQuestion('NEW', domain);
    const topicId = payload.topicId || fallbackHier.topicId;
    const subtopicId = payload.subtopicId || fallbackHier.subtopicId;

    const correctProb = Math.max(
      0.05,
      Math.min(0.95, Number(payload.attributes?.correctProbability ?? 0.6))
    );
    const wrongProb = Math.round((1 - correctProb) * 100) / 100;
    const baseAttrs = {
      intelligenceMeasure: Number(payload.attributes?.intelligenceMeasure ?? 60),
      correctProbability: correctProb,
      wrongProbability: wrongProb,
      examPriority: Number(payload.attributes?.examPriority ?? 7),
      quizStrength: Number(payload.attributes?.quizStrength ?? 75),
      difficultyTier: 'Moderate' as DifficultyTier,
      cognitiveDomain: domain,
      estimatedSeconds: Number(payload.attributes?.estimatedSeconds ?? 45),
    };
    baseAttrs.difficultyTier = classifyDifficultyTier(calculateQuizDifficultyScore(baseAttrs));

    const totalCurated = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM questions').get() as { cnt: number }
    ).cnt;
    const id = `CUR-${String(totalCurated + 1).padStart(3, '0')}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;
    const now = new Date().toISOString();

    const quiz: QuizItem = {
      id,
      source: 'curated',
      subjectId,
      topicId,
      subtopicId,
      version: 1,
      questionSi: String(payload.questionSi).trim(),
      questionEn: String(payload.questionEn || payload.questionSi).trim(),
      options: [
        String(payload.options[0]),
        String(payload.options[1]),
        String(payload.options[2]),
        String(payload.options[3]),
      ],
      correctIndex: Math.max(0, Math.min(3, Number(payload.correctIndex ?? 0))),
      imageUrl: payload.imageUrl ? String(payload.imageUrl) : undefined,
      memoryTrickTitle: String(payload.memoryTrickTitle || 'Psychological Memory Cue').trim(),
      memoryTrickBody: String(payload.memoryTrickBody).trim(),
      explanation: String(payload.explanation || 'Reviewed via Grade 5 Scholarship rubric.').trim(),
      misconceptions: payload.misconceptions || [],
      qualityFlag: 'OK',
      attributes: baseAttrs,
      createdAt: now,
      updatedAt: now,
    };

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO questions (
            id, source, subject_id, topic_id, subtopic_id, version, question_si, question_en,
            options_json, correct_index, image_url, memory_trick_title, memory_trick_body,
            explanation, misconceptions_json, attributes_json, quality_flag, active, created_by,
            created_at, updated_at
          ) VALUES (?, 'curated', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OK', 1, ?, ?, ?)`
        )
        .run(
          quiz.id,
          subjectId,
          topicId,
          subtopicId,
          quiz.questionSi,
          quiz.questionEn,
          JSON.stringify(quiz.options),
          quiz.correctIndex,
          quiz.imageUrl || null,
          quiz.memoryTrickTitle,
          quiz.memoryTrickBody,
          quiz.explanation,
          JSON.stringify(quiz.misconceptions),
          JSON.stringify(quiz.attributes),
          adminUser.email,
          now,
          now
        );

      this.db
        .prepare(
          `INSERT INTO question_versions (
            id, question_id, version, subject_id, topic_id, subtopic_id, snapshot_json, changed_by, change_note, created_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'Created question', ?)`
        )
        .run(
          `QV-${quiz.id}-v1`,
          quiz.id,
          subjectId,
          topicId,
          subtopicId,
          JSON.stringify(quiz),
          adminUser.email,
          now
        );

      this.writeAuditLog({
        actorId: adminUser.id,
        actorName: adminUser.name,
        actorRole: 'admin',
        action: 'QUESTION_CREATED',
        targetType: 'question',
        targetId: quiz.id,
        details: { subjectId, topicId, subtopicId },
      });
    });

    return quiz;
  }

  public reassignQuestionSubject(
    adminUser: UserAccount,
    questionId: string,
    payload: {
      subjectId: string;
      topicId?: string;
      subtopicId?: string;
      changeNote?: string;
    }
  ): QuizItem {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Administrator access required to move questions across subjects.');
    }
    const existingRow = this.db
      .prepare('SELECT * FROM questions WHERE id = ? AND active = 1')
      .get(questionId) as Record<string, unknown> | undefined;
    if (!existingRow) {
      throw new HttpError(404, 'Curated question not found.');
    }
    const existing = rowToQuiz(existingRow);

    const subjectRow = this.db
      .prepare('SELECT * FROM subjects WHERE id = ?')
      .get(payload.subjectId) as Record<string, unknown> | undefined;
    if (!subjectRow) {
      throw new HttpError(400, 'Target subject category does not exist.');
    }

    const defaultTopic = this.db
      .prepare('SELECT id FROM topics WHERE subject_id = ? ORDER BY sort_order ASC LIMIT 1')
      .get(payload.subjectId) as { id: string } | undefined;
    const nextTopicId = payload.topicId || defaultTopic?.id || existing.topicId || 'top-math-money';

    const defaultSub = this.db
      .prepare('SELECT id FROM subtopics WHERE topic_id = ? ORDER BY sort_order ASC LIMIT 1')
      .get(nextTopicId) as { id: string } | undefined;
    const nextSubtopicId = payload.subtopicId || defaultSub?.id || existing.subtopicId || 'sub-math-change';

    const nextVersion = (existing.version || 1) + 1;
    const now = new Date().toISOString();
    const newDomain = String(subjectRow.cognitive_domain) as CognitiveDomain;
    const updatedAttrs = { ...existing.attributes, cognitiveDomain: newDomain };
    const updatedQuiz: QuizItem = {
      ...existing,
      subjectId: payload.subjectId,
      topicId: nextTopicId,
      subtopicId: nextSubtopicId,
      version: nextVersion,
      attributes: updatedAttrs,
      updatedAt: now,
    };

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE questions SET subject_id = ?, topic_id = ?, subtopic_id = ?, version = ?, attributes_json = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          payload.subjectId,
          nextTopicId,
          nextSubtopicId,
          nextVersion,
          JSON.stringify(updatedAttrs),
          now,
          questionId
        );

      // Update derived aggregate subject scope while keeping immutable question_attempts untouched
      this.db
        .prepare('UPDATE question_stats SET subject_id = ?, updated_at = ? WHERE question_id = ?')
        .run(payload.subjectId, now, questionId);

      // Update active intervention case visibility scope to match new subject
      this.db
        .prepare(
          `UPDATE intervention_cases SET subject_id = ?, topic_id = ?, subtopic_id = ?, updated_at = ? WHERE question_id = ?`
        )
        .run(payload.subjectId, nextTopicId, nextSubtopicId, now, questionId);

      this.db
        .prepare(
          `INSERT INTO question_versions (id, question_id, version, subject_id, topic_id, subtopic_id, snapshot_json, changed_by, change_note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `QV-${questionId}-v${nextVersion}`,
          questionId,
          nextVersion,
          payload.subjectId,
          nextTopicId,
          nextSubtopicId,
          JSON.stringify(updatedQuiz),
          adminUser.email,
          payload.changeNote || `Moved subject from ${existing.subjectId} to ${payload.subjectId}`,
          now
        );

      this.writeAuditLog({
        actorId: adminUser.id,
        actorName: adminUser.name,
        actorRole: 'admin',
        action: 'QUESTION_SUBJECT_REASSIGNED',
        targetType: 'question',
        targetId: questionId,
        details: {
          fromSubjectId: existing.subjectId,
          toSubjectId: payload.subjectId,
          topicId: nextTopicId,
          subtopicId: nextSubtopicId,
        },
      });
    });

    return updatedQuiz;
  }

  public deleteQuestion(adminUser: UserAccount, questionId: string): void {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Administrator access required.');
    }
    const existing = this.db.prepare('SELECT id FROM questions WHERE id = ?').get(questionId);
    if (!existing) {
      throw new HttpError(404, 'Curated quiz not found.');
    }
    const attemptCount = (
      this.db
        .prepare('SELECT COUNT(*) as cnt FROM question_attempts WHERE question_id = ?')
        .get(questionId) as { cnt: number }
    ).cnt;

    if (attemptCount > 0) {
      // Preserve historical attempt references via soft-archive
      this.db
        .prepare('UPDATE questions SET active = 0, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), questionId);
    } else {
      this.db.prepare('DELETE FROM questions WHERE id = ?').run(questionId);
    }
  }

  // --- Attempt Recording & Repeated-Error / Intervention State Machine ---
  public recordQuestionAttempt(params: {
    student: UserAccount;
    questionId: string;
    submittedAnswerIndex: number | null;
    submissionStatus?: AttemptSubmissionStatus;
    responseDurationMs: number;
    hintUsed?: boolean;
    contextMode: AttemptContextMode;
    sessionId: string;
    deliveryContext?: Record<string, unknown>;
    idempotencyKey: string;
    awardPracticeXp?: boolean;
    overrideIsCorrect?: boolean | null;
  }): {
    attempt: QuestionAttempt;
    deduplicated: boolean;
    interventionCase: InterventionCase | null;
    caseEvent: string;
  } {
    const cleanKey = String(params.idempotencyKey || '').trim();
    if (!cleanKey) {
      throw new HttpError(400, 'idempotencyKey is required to prevent duplicate submissions.');
    }

    // Check idempotency before starting write transaction
    const existingRow = this.db
      .prepare('SELECT * FROM question_attempts WHERE idempotency_key = ?')
      .get(cleanKey) as Record<string, unknown> | undefined;
    if (existingRow) {
      const existingAttempt = rowToQuestionAttempt(existingRow);
      const existingCaseRow = this.db
        .prepare(
          'SELECT * FROM intervention_cases WHERE student_id = ? AND question_id = ? ORDER BY updated_at DESC LIMIT 1'
        )
        .get(existingAttempt.studentId, existingAttempt.questionId) as
        | Record<string, unknown>
        | undefined;
      return {
        attempt: existingAttempt,
        deduplicated: true,
        interventionCase: existingCaseRow ? rowToInterventionCase(existingCaseRow) : null,
        caseEvent: 'deduplicated',
      };
    }

    const question = this.resolveQuizById(params.questionId);
    if (!question) {
      throw new HttpError(404, `Question ${params.questionId} not found.`);
    }

    const subjectId = resolveQuestionSubjectId(question);
    const topicId =
      question.topicId ||
      resolveDefaultHierarchyForQuestion(question.id, question.attributes.cognitiveDomain).topicId;
    const subtopicId =
      question.subtopicId ||
      resolveDefaultHierarchyForQuestion(question.id, question.attributes.cognitiveDomain).subtopicId;

    let status: AttemptSubmissionStatus = params.submissionStatus || 'valid_answered';
    let submittedIdx: number | null =
      typeof params.submittedAnswerIndex === 'number' && Number.isInteger(params.submittedAnswerIndex)
        ? params.submittedAnswerIndex
        : null;

    const hasExplicitCorrectOverride = typeof params.overrideIsCorrect === 'boolean';
    if (status === 'valid_answered') {
      if (!hasExplicitCorrectOverride && (submittedIdx === null || submittedIdx < 0 || submittedIdx > 3)) {
        status = submittedIdx === null ? 'unanswered' : 'invalid';
        submittedIdx = null;
      }
    } else {
      submittedIdx = null;
    }

    const isCorrect: boolean | null =
      status === 'valid_answered'
        ? hasExplicitCorrectOverride
          ? Boolean(params.overrideIsCorrect)
          : submittedIdx !== null
          ? submittedIdx === question.correctIndex
          : null
        : null;

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const durationMs = Math.max(0, Math.min(3_600_000, Math.round(Number(params.responseDurationMs || 0))));
    const hintUsed = Boolean(params.hintUsed);
    const attemptId = `QA-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

    return this.dbWrapper.transaction(() => {
      // Re-check idempotency inside IMMEDIATE transaction lock
      const dupCheck = this.db
        .prepare('SELECT * FROM question_attempts WHERE idempotency_key = ?')
        .get(cleanKey) as Record<string, unknown> | undefined;
      if (dupCheck) {
        return {
          attempt: rowToQuestionAttempt(dupCheck),
          deduplicated: true,
          interventionCase: null,
          caseEvent: 'deduplicated',
        };
      }

      let seq = 0;
      if (status === 'valid_answered') {
        const prevValid = (
          this.db
            .prepare(
              `SELECT COUNT(*) as cnt FROM question_attempts
               WHERE student_id = ? AND question_id = ? AND submission_status = 'valid_answered'`
            )
            .get(params.student.id, question.id) as { cnt: number }
        ).cnt;
        seq = prevValid + 1;
      }

      const attempt: QuestionAttempt = {
        id: attemptId,
        studentId: params.student.id,
        questionId: question.id,
        questionVersion: question.version || 1,
        subjectId,
        topicId,
        subtopicId,
        attemptSequenceNumber: seq,
        submittedAnswerIndex: submittedIdx,
        submissionStatus: status,
        isCorrect,
        responseDurationMs: durationMs,
        difficultyAtAttempt: question.attributes.difficultyTier,
        hintUsed,
        contextMode: params.contextMode,
        sessionId: params.sessionId || `SES-${Date.now()}`,
        deliveryContext: (params.deliveryContext || {}) as QuestionAttempt['deliveryContext'],
        idempotencyKey: cleanKey,
        attemptTimestamp: nowIso,
      };

      this.db
        .prepare(
          `INSERT INTO question_attempts (
            id, student_id, question_id, question_version, subject_id, topic_id, subtopic_id,
            attempt_sequence_number, submitted_answer_index, submission_status, is_correct,
            response_duration_ms, difficulty_at_attempt, hint_used, context_mode, session_id,
            delivery_context_json, idempotency_key, attempt_timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          attempt.id,
          attempt.studentId,
          attempt.questionId,
          attempt.questionVersion,
          attempt.subjectId,
          attempt.topicId,
          attempt.subtopicId,
          attempt.attemptSequenceNumber,
          attempt.submittedAnswerIndex,
          attempt.submissionStatus,
          attempt.isCorrect === null ? null : attempt.isCorrect ? 1 : 0,
          attempt.responseDurationMs,
          attempt.difficultyAtAttempt,
          attempt.hintUsed ? 1 : 0,
          attempt.contextMode,
          attempt.sessionId,
          JSON.stringify(attempt.deliveryContext),
          attempt.idempotencyKey,
          attempt.attemptTimestamp
        );

      // Update student_question_stats only for valid answered submissions
      let studentIncorrectTotal = 0;
      if (status === 'valid_answered') {
        const existingSQ = this.db
          .prepare(
            'SELECT * FROM student_question_stats WHERE student_id = ? AND question_id = ?'
          )
          .get(params.student.id, question.id) as Record<string, unknown> | undefined;

        if (existingSQ) {
          const nextValid = Number(existingSQ.valid_attempts) + 1;
          const nextCorrect = Number(existingSQ.correct_attempts) + (isCorrect ? 1 : 0);
          const nextIncorrect = Number(existingSQ.incorrect_attempts) + (isCorrect === false ? 1 : 0);
          studentIncorrectTotal = nextIncorrect;
          this.db
            .prepare(
              `UPDATE student_question_stats
               SET subject_id = ?, valid_attempts = ?, correct_attempts = ?, incorrect_attempts = ?, last_attempt_at = ?
               WHERE student_id = ? AND question_id = ?`
            )
            .run(subjectId, nextValid, nextCorrect, nextIncorrect, nowIso, params.student.id, question.id);
        } else {
          studentIncorrectTotal = isCorrect === false ? 1 : 0;
          this.db
            .prepare(
              `INSERT INTO student_question_stats (
                student_id, question_id, subject_id, valid_attempts, correct_attempts, incorrect_attempts, last_attempt_at
              ) VALUES (?, ?, ?, 1, ?, ?, ?)`
            )
            .run(
              params.student.id,
              question.id,
              subjectId,
              isCorrect ? 1 : 0,
              studentIncorrectTotal,
              nowIso
            );
        }
      }

      // Refresh question_stats row cleanly for this question
      this.refreshQuestionStatsRow(question.id, subjectId);

      // Award practice stars/streak if requested (individual practice mode)
      if (params.awardPracticeXp && status === 'valid_answered') {
        const streakUpdate = calculateUpdatedStreak({
          currentStreakDays: params.student.streakDays,
          lastPracticeDate: params.student.lastPracticeDate,
        });
        const bonusStars = isCorrect ? 3 : 1;
        this.db
          .prepare('UPDATE users SET stars = stars + ?, streak_days = ?, last_practice_date = ? WHERE id = ?')
          .run(bonusStars, streakUpdate.streakDays, streakUpdate.lastPracticeDate, params.student.id);
      }

      // Repeated wrong-answer detection & intervention state machine
      const config = this.getAcademicConfig();
      const existingCaseRows = this.db
        .prepare(
          'SELECT * FROM intervention_cases WHERE student_id = ? AND question_id = ? ORDER BY updated_at DESC'
        )
        .all(params.student.id, question.id) as Record<string, unknown>[];
      const existingCases = existingCaseRows.map(rowToInterventionCase);

      let resultingCase: InterventionCase | null = existingCases[0] || null;
      let caseEvent = 'none';

      if (status === 'valid_answered' && isCorrect === false) {
        const evalRes = evaluateWrongAttemptForCase({
          incorrectCount: studentIncorrectTotal,
          existingCasesForStudentQuestion: existingCases,
          config,
          nowMs,
        });

        const misconceptionMatch = question.misconceptions?.find(
          (m) => m.optionIndex === submittedIdx
        );
        const suggestedSupport = misconceptionMatch
          ? `Suggested Teaching Support (Teacher Review Required): ${misconceptionMatch.misconceptionLabel} — ${misconceptionMatch.suggestedIntervention}`
          : `Suggested Teaching Support (Teacher Review Required): Student missed ${question.id} (${question.attributes.cognitiveDomain}). Review memory trick "${question.memoryTrickTitle}" and assign foundational recap.`;

        if (evalRes.action === 'create_case') {
          const assignedTeacherId = this.findPrimaryTeacherForSubject(subjectId);
          const caseId = `CASE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          this.db
            .prepare(
              `INSERT INTO intervention_cases (
                id, student_id, question_id, subject_id, topic_id, subtopic_id, status,
                incorrect_count, threshold_triggered_at, latest_attempt_id, assigned_teacher_id,
                template_id, instruction_title, instruction_body, suggested_support_note,
                recommended_practice_topic_id, consecutive_correct_after_case, ready_for_teacher_review,
                reopen_count, last_alert_sent_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, NULL, ?, '', ?, ?, 0, 0, 0, ?, ?, ?)`
            )
            .run(
              caseId,
              params.student.id,
              question.id,
              subjectId,
              topicId,
              subtopicId,
              studentIncorrectTotal,
              config.repeatedErrorThreshold,
              attempt.id,
              assignedTeacherId,
              `${question.attributes.cognitiveDomain} · Repeated Error Review`,
              suggestedSupport,
              topicId,
              evalRes.shouldDispatchAlert ? nowIso : null,
              nowIso,
              nowIso
            );

          this.insertInterventionAction({
            caseId,
            actorId: 'system',
            actorName: 'Repeated-Error Engine',
            actorRole: 'system',
            actionType: 'CASE_OPENED',
            fromStatus: null,
            toStatus: 'OPEN',
            notes: `Triggered automatically after ${studentIncorrectTotal} incorrect attempts on ${question.id} (threshold: ${config.repeatedErrorThreshold}).`,
            templateUsed: null,
          });

          resultingCase = rowToInterventionCase(
            this.db.prepare('SELECT * FROM intervention_cases WHERE id = ?').get(caseId) as Record<
              string,
              unknown
            >
          );
          caseEvent = 'case_created';

          if (evalRes.shouldDispatchAlert) {
            this.dispatchCaseAlertNotifications({
              interventionCase: resultingCase,
              student: params.student,
              question,
              config,
              isReopen: false,
            });
          }
        } else if (evalRes.action === 'reopen_case' && evalRes.existingCaseId) {
          const targetCase = existingCases.find((c) => c.id === evalRes.existingCaseId)!;
          this.db
            .prepare(
              `UPDATE intervention_cases SET
                status = 'OPEN', incorrect_count = ?, latest_attempt_id = ?,
                consecutive_correct_after_case = 0, ready_for_teacher_review = 0,
                reopen_count = reopen_count + 1, suggested_support_note = ?,
                last_alert_sent_at = ?, updated_at = ?, resolved_at = NULL
               WHERE id = ?`
            )
            .run(
              studentIncorrectTotal,
              attempt.id,
              suggestedSupport,
              nowIso,
              nowIso,
              targetCase.id
            );

          this.insertInterventionAction({
            caseId: targetCase.id,
            actorId: 'system',
            actorName: 'Repeated-Error Engine',
            actorRole: 'system',
            actionType: 'CASE_REOPENED',
            fromStatus: targetCase.status,
            toStatus: 'OPEN',
            notes: `Case reopened automatically after recurring wrong attempt #${studentIncorrectTotal} on ${question.id}.`,
            templateUsed: null,
          });

          resultingCase = rowToInterventionCase(
            this.db
              .prepare('SELECT * FROM intervention_cases WHERE id = ?')
              .get(targetCase.id) as Record<string, unknown>
          );
          caseEvent = 'case_reopened';

          if (evalRes.shouldDispatchAlert) {
            this.dispatchCaseAlertNotifications({
              interventionCase: resultingCase,
              student: params.student,
              question,
              config,
              isReopen: true,
            });
          }
        } else if (evalRes.action === 'update_active_case' && evalRes.existingCaseId) {
          const active = existingCases.find((c) => c.id === evalRes.existingCaseId)!;
          this.db
            .prepare(
              `UPDATE intervention_cases SET
                incorrect_count = ?, latest_attempt_id = ?,
                consecutive_correct_after_case = 0, ready_for_teacher_review = 0,
                last_alert_sent_at = COALESCE(?, last_alert_sent_at), updated_at = ?
               WHERE id = ?`
            )
            .run(
              studentIncorrectTotal,
              attempt.id,
              evalRes.shouldDispatchAlert ? nowIso : null,
              nowIso,
              active.id
            );

          this.insertInterventionAction({
            caseId: active.id,
            actorId: 'system',
            actorName: 'Repeated-Error Engine',
            actorRole: 'system',
            actionType: 'THRESHOLD_INCREMENTED',
            fromStatus: active.status,
            toStatus: active.status,
            notes: `Recorded error #${studentIncorrectTotal} on ${question.id}. ${evalRes.alertReason}`,
            templateUsed: null,
          });

          resultingCase = rowToInterventionCase(
            this.db
              .prepare('SELECT * FROM intervention_cases WHERE id = ?')
              .get(active.id) as Record<string, unknown>
          );
          caseEvent = evalRes.shouldDispatchAlert ? 'case_updated_alert_sent' : 'case_updated_cooldown';

          if (evalRes.shouldDispatchAlert) {
            this.dispatchCaseAlertNotifications({
              interventionCase: resultingCase,
              student: params.student,
              question,
              config,
              isReopen: false,
            });
          }
        }
      } else if (status === 'valid_answered' && isCorrect === true) {
        const activeCase = existingCases.find((c) => isActiveInterventionStatus(c.status));
        if (activeCase) {
          const followUp = evaluateCorrectFollowUpForCase({ activeCase, config });
          const newlyReady = followUp.readyForTeacherReview && !activeCase.readyForTeacherReview;

          this.db
            .prepare(
              `UPDATE intervention_cases SET
                status = ?, consecutive_correct_after_case = ?, ready_for_teacher_review = ?,
                latest_attempt_id = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(
              followUp.nextStatus,
              followUp.nextConsecutiveCorrect,
              followUp.readyForTeacherReview ? 1 : 0,
              attempt.id,
              nowIso,
              activeCase.id
            );

          this.insertInterventionAction({
            caseId: activeCase.id,
            actorId: params.student.id,
            actorName: params.student.name,
            actorRole: 'student',
            actionType: 'PRACTICE_FOLLOWUP',
            fromStatus: activeCase.status,
            toStatus: followUp.nextStatus,
            notes: followUp.actionNote,
            templateUsed: null,
          });

          resultingCase = rowToInterventionCase(
            this.db
              .prepare('SELECT * FROM intervention_cases WHERE id = ?')
              .get(activeCase.id) as Record<string, unknown>
          );
          caseEvent = followUp.readyForTeacherReview ? 'ready_for_teacher_review' : 'followup_progress';

          if (newlyReady && resultingCase.assignedTeacherId) {
            this.insertNotificationRow({
              recipientUserId: resultingCase.assignedTeacherId,
              recipientRole: 'teacher',
              channel: 'in_app',
              category: 'follow_up_ready',
              title: `Follow-up Ready · ${params.student.name} (${question.id})`,
              body: `${params.student.name} achieved ${followUp.nextConsecutiveCorrect} consecutive correct attempts on ${question.id}. Review and decide whether to mark RESOLVED.`,
              relatedCaseId: resultingCase.id,
              relatedStudentId: params.student.id,
              relatedSubjectId: subjectId,
              dedupeKey: `ready-${resultingCase.id}-${followUp.nextConsecutiveCorrect}`,
              deliveryStatus: 'delivered',
            });
          }
        }
      }

      return {
        attempt,
        deduplicated: false,
        interventionCase: resultingCase,
        caseEvent,
      };
    });
  }

  private refreshQuestionStatsRow(questionId: string, subjectId: string): void {
    const rows = this.db
      .prepare('SELECT * FROM question_attempts WHERE question_id = ? ORDER BY attempt_timestamp ASC')
      .all(questionId) as Record<string, unknown>[];
    const attempts = rows.map(rowToQuestionAttempt);
    const threshold = this.getAcademicConfig().repeatedErrorThreshold;
    const metrics = calculateQuestionPerformance(questionId, attempts, threshold);
    const now = new Date().toISOString();

    const firstCorrect = attempts.filter(
      (a) => a.submissionStatus === 'valid_answered' && a.attemptSequenceNumber === 1 && a.isCorrect === true
    ).length;
    const repeatCorrect = attempts.filter(
      (a) => a.submissionStatus === 'valid_answered' && a.attemptSequenceNumber > 1 && a.isCorrect === true
    ).length;
    const hintCorrect = attempts.filter(
      (a) => a.submissionStatus === 'valid_answered' && a.hintUsed && a.isCorrect === true
    ).length;
    const unassistedCorrect = attempts.filter(
      (a) => a.submissionStatus === 'valid_answered' && !a.hintUsed && a.isCorrect === true
    ).length;

    this.db
      .prepare(
        `INSERT INTO question_stats (
          question_id, subject_id, total_events, valid_attempts, skipped_count, timed_out_count,
          unique_students, correct_attempts, incorrect_attempts, correct_rate, incorrect_rate,
          first_attempt_total, first_attempt_correct, repeat_attempt_total, repeat_attempt_correct,
          hint_assisted_total, hint_assisted_correct, unassisted_total, unassisted_correct,
          repeated_error_student_count, median_response_ms, p90_response_ms, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(question_id) DO UPDATE SET
          subject_id = excluded.subject_id,
          total_events = excluded.total_events,
          valid_attempts = excluded.valid_attempts,
          skipped_count = excluded.skipped_count,
          timed_out_count = excluded.timed_out_count,
          unique_students = excluded.unique_students,
          correct_attempts = excluded.correct_attempts,
          incorrect_attempts = excluded.incorrect_attempts,
          correct_rate = excluded.correct_rate,
          incorrect_rate = excluded.incorrect_rate,
          first_attempt_total = excluded.first_attempt_total,
          first_attempt_correct = excluded.first_attempt_correct,
          repeat_attempt_total = excluded.repeat_attempt_total,
          repeat_attempt_correct = excluded.repeat_attempt_correct,
          hint_assisted_total = excluded.hint_assisted_total,
          hint_assisted_correct = excluded.hint_assisted_correct,
          unassisted_total = excluded.unassisted_total,
          unassisted_correct = excluded.unassisted_correct,
          repeated_error_student_count = excluded.repeated_error_student_count,
          median_response_ms = excluded.median_response_ms,
          p90_response_ms = excluded.p90_response_ms,
          updated_at = excluded.updated_at`
      )
      .run(
        questionId,
        subjectId,
        metrics.totalRecordedEvents,
        metrics.validAttemptCount,
        metrics.skippedOrUnansweredCount,
        metrics.timedOutCount,
        metrics.uniqueStudents,
        metrics.correctAttemptCount,
        metrics.incorrectAttemptCount,
        metrics.correctAttemptRate,
        metrics.incorrectAttemptRate,
        metrics.firstAttemptTotal,
        firstCorrect,
        metrics.repeatAttemptTotal,
        repeatCorrect,
        metrics.hintAssistedTotal,
        hintCorrect,
        metrics.unassistedTotal,
        unassistedCorrect,
        metrics.repeatedErrorStudentCount,
        metrics.responseTimeStats.medianMs,
        metrics.responseTimeStats.p90Ms,
        now
      );
  }

  private findPrimaryTeacherForSubject(subjectId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT u.id FROM teacher_subject_assignments tsa
         JOIN users u ON u.id = tsa.teacher_id
         WHERE tsa.subject_id = ? AND u.active = 1
         ORDER BY tsa.assigned_at ASC LIMIT 1`
      )
      .get(subjectId) as { id: string } | undefined;
    return row?.id || null;
  }

  private insertInterventionAction(params: {
    caseId: string;
    actorId: string;
    actorName: string;
    actorRole: UserRole | 'system';
    actionType: InterventionAction['actionType'];
    fromStatus: InterventionStatus | null;
    toStatus: InterventionStatus;
    notes: string;
    templateUsed: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO intervention_actions (id, case_id, actor_id, actor_name, actor_role, action_type, from_status, to_status, notes, template_used, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `ACT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        params.caseId,
        params.actorId,
        params.actorName,
        params.actorRole,
        params.actionType,
        params.fromStatus,
        params.toStatus,
        params.notes,
        params.templateUsed,
        new Date().toISOString()
      );
  }

  private dispatchCaseAlertNotifications(params: {
    interventionCase: InterventionCase;
    student: UserAccount;
    question: QuizItem;
    config: AcademicConfig;
    isReopen: boolean;
  }): void {
    const { interventionCase, student, question, config, isReopen } = params;
    const teacherRows = this.db
      .prepare(
        `SELECT u.* FROM teacher_subject_assignments tsa
         JOIN users u ON u.id = tsa.teacher_id
         WHERE tsa.subject_id = ? AND u.active = 1`
      )
      .all(interventionCase.subjectId) as Record<string, unknown>[];

    const groupingBucket = Math.floor(
      Date.now() / Math.max(1, config.alertGroupingWindowMinutes) / 60_000
    );

    const title = isReopen
      ? `Reopened Error Case · ${student.name} (${question.id})`
      : `Repeated Error Alert · ${student.name} (${question.id})`;
    const body = `${student.name} recorded ${interventionCase.incorrectCount} incorrect attempts on ${question.id} (${question.attributes.cognitiveDomain}). Case ${interventionCase.id} requires teacher review.`;

    for (const tr of teacherRows) {
      const teacher = rowToUser(tr);
      const prefs = teacher.notificationPreferences || DEFAULT_PREFS;
      const dedupeBase = `alert-${interventionCase.id}-${teacher.id}-b${groupingBucket}`;

      if (prefs.inApp) {
        this.insertNotificationRow({
          recipientUserId: teacher.id,
          recipientRole: 'teacher',
          channel: 'in_app',
          category: 'repeated_error_alert',
          title,
          body,
          relatedCaseId: interventionCase.id,
          relatedStudentId: student.id,
          relatedSubjectId: interventionCase.subjectId,
          dedupeKey: `${dedupeBase}-inapp`,
          deliveryStatus: 'delivered',
        });
      }
      if (prefs.email) {
        this.insertNotificationRow({
          recipientUserId: teacher.id,
          recipientRole: 'teacher',
          channel: 'email',
          category: 'repeated_error_alert',
          title,
          body,
          relatedCaseId: interventionCase.id,
          relatedStudentId: student.id,
          relatedSubjectId: interventionCase.subjectId,
          dedupeKey: `${dedupeBase}-email`,
          deliveryStatus: 'delivered',
        });
      }
    }

    if (config.autoNotifyAdminsOnEscalation) {
      const admins = this.db
        .prepare("SELECT * FROM users WHERE role = 'admin' AND active = 1")
        .all() as Record<string, unknown>[];
      for (const ar of admins) {
        const adm = rowToUser(ar);
        this.insertNotificationRow({
          recipientUserId: adm.id,
          recipientRole: 'admin',
          channel: 'in_app',
          category: 'admin_oversight',
          title,
          body,
          relatedCaseId: interventionCase.id,
          relatedStudentId: student.id,
          relatedSubjectId: interventionCase.subjectId,
          dedupeKey: `adm-${interventionCase.id}-${adm.id}-b${groupingBucket}`,
          deliveryStatus: 'delivered',
        });
      }
    }
  }

  public insertNotificationRow(params: {
    recipientUserId: string;
    recipientRole: UserRole;
    channel: 'in_app' | 'email' | 'whatsapp';
    category: NotificationRecord['category'];
    title: string;
    body: string;
    relatedCaseId?: string;
    relatedStudentId?: string;
    relatedSubjectId?: string;
    dedupeKey: string;
    deliveryStatus: NotificationRecord['deliveryStatus'];
    errorMessage?: string;
  }): void {
    const existing = this.db
      .prepare('SELECT id FROM notifications WHERE dedupe_key = ?')
      .get(params.dedupeKey);
    if (existing) return;

    this.db
      .prepare(
        `INSERT INTO notifications (
          id, recipient_user_id, recipient_role, channel, category, title, body,
          related_case_id, related_student_id, related_subject_id, dedupe_key,
          delivery_status, retry_count, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        `NTF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        params.recipientUserId,
        params.recipientRole,
        params.channel,
        params.category,
        params.title,
        params.body,
        params.relatedCaseId || null,
        params.relatedStudentId || null,
        params.relatedSubjectId || null,
        params.dedupeKey,
        params.deliveryStatus,
        params.errorMessage || null,
        new Date().toISOString()
      );
  }

  // --- Question Review Detail View ---
  public getQuestionDetailIntelligence(ctx: AuthorizationContext, questionId: string) {
    const question = this.resolveQuizById(questionId);
    if (!question) {
      throw new HttpError(404, `Question ${questionId} not found.`);
    }
    if (!canAccessQuestion(ctx, question)) {
      throw new HttpError(
        403,
        'Access denied: Question belongs to a subject category outside your assigned permissions.'
      );
    }

    const attemptRows = this.db
      .prepare('SELECT * FROM question_attempts WHERE question_id = ? ORDER BY attempt_timestamp DESC')
      .all(questionId) as Record<string, unknown>[];
    const attempts = attemptRows.map(rowToQuestionAttempt);
    const config = this.getAcademicConfig();
    const metrics: QuestionPerformanceMetrics = calculateQuestionPerformance(
      questionId,
      attempts,
      config.repeatedErrorThreshold
    );

    const versionRows = this.db
      .prepare('SELECT * FROM question_versions WHERE question_id = ? ORDER BY version DESC')
      .all(questionId) as Record<string, unknown>[];
    const versions = versionRows.map((v) => ({
      id: String(v.id),
      version: Number(v.version),
      subjectId: String(v.subject_id),
      topicId: String(v.topic_id),
      subtopicId: String(v.subtopic_id),
      changedBy: String(v.changed_by),
      changeNote: String(v.change_note),
      createdAt: String(v.created_at),
    }));

    // Student-by-student error breakdown for authorized views
    const usersRows = this.db.prepare("SELECT id, name, user_id_code FROM users WHERE role = 'student'").all() as {
      id: string;
      name: string;
      user_id_code: string;
    }[];
    const userLookup = new Map(usersRows.map((u) => [u.id, u]));

    const studentMap = new Map<
      string,
      {
        studentId: string;
        studentName: string;
        userIdCode: string;
        validAttempts: number;
        correctCount: number;
        incorrectCount: number;
        skippedCount: number;
        lastAttemptAt: string;
        recentOutcomes: { isCorrect: boolean | null; status: string; timestamp: string; hintUsed: boolean; durationMs: number }[];
      }
    >();

    for (const a of attempts) {
      if (ctx.role === 'student' && a.studentId !== ctx.userId) continue;
      const u = userLookup.get(a.studentId);
      const cur = studentMap.get(a.studentId) || {
        studentId: a.studentId,
        studentName: u?.name || 'Student',
        userIdCode: u?.user_id_code || a.studentId,
        validAttempts: 0,
        correctCount: 0,
        incorrectCount: 0,
        skippedCount: 0,
        lastAttemptAt: a.attemptTimestamp,
        recentOutcomes: [],
      };
      if (a.submissionStatus === 'valid_answered') {
        cur.validAttempts += 1;
        if (a.isCorrect === true) cur.correctCount += 1;
        if (a.isCorrect === false) cur.incorrectCount += 1;
      } else {
        cur.skippedCount += 1;
      }
      if (a.attemptTimestamp > cur.lastAttemptAt) cur.lastAttemptAt = a.attemptTimestamp;
      cur.recentOutcomes.push({
        isCorrect: a.isCorrect,
        status: a.submissionStatus,
        timestamp: a.attemptTimestamp,
        hintUsed: a.hintUsed,
        durationMs: a.responseDurationMs,
      });
      studentMap.set(a.studentId, cur);
    }

    const caseRows = this.db
      .prepare('SELECT * FROM intervention_cases WHERE question_id = ? ORDER BY updated_at DESC')
      .all(questionId) as Record<string, unknown>[];
    const relatedCases = caseRows
      .map(rowToInterventionCase)
      .filter((c) => ctx.role !== 'student' || c.studentId === ctx.userId);

    const subjectRow = this.db
      .prepare('SELECT name_en, name_si FROM subjects WHERE id = ?')
      .get(resolveQuestionSubjectId(question)) as { name_en: string; name_si: string } | undefined;
    const topicRow = this.db
      .prepare('SELECT name_en, name_si FROM topics WHERE id = ?')
      .get(question.topicId || '') as { name_en: string; name_si: string } | undefined;
    const subtopicRow = this.db
      .prepare('SELECT name_en, name_si FROM subtopics WHERE id = ?')
      .get(question.subtopicId || '') as { name_en: string; name_si: string } | undefined;

    return {
      question: {
        ...question,
        subjectId: resolveQuestionSubjectId(question),
        subjectName: subjectRow?.name_en || question.attributes.cognitiveDomain,
        topicName: topicRow?.name_en || 'Core Topic',
        subtopicName: subtopicRow?.name_en || 'Core Subtopic',
      },
      metrics,
      versions,
      studentHistories: Array.from(studentMap.values()).sort(
        (a, b) => b.incorrectCount - a.incorrectCount
      ),
      relatedCases,
      ethicalFramingNote: RESPONSE_TIME_ETHICAL_FRAMING,
    };
  }

  // --- Shared Permission-Scoped Academic Analytics ---
  public getScopedAnalytics(ctx: AuthorizationContext, filters: ScopedAnalyticsFilters = {}) {
    if (
      ctx.role === 'teacher' &&
      filters.subjectId &&
      filters.subjectId !== 'All' &&
      !canAccessSubject(ctx, filters.subjectId)
    ) {
      throw new HttpError(
        403,
        'Access denied: Requested subject category is outside your assigned subjects.'
      );
    }

    const questionSubjectMap = this.getQuestionSubjectMap();
    const allowedSet = new Set(ctx.assignedSubjectIds);
    const config = this.getAcademicConfig();

    const allAttemptRows = this.db
      .prepare('SELECT * FROM question_attempts ORDER BY attempt_timestamp ASC')
      .all() as Record<string, unknown>[];

    const scopedAttempts: QuestionAttempt[] = [];
    for (const r of allAttemptRows) {
      const att = rowToQuestionAttempt(r);
      const effectiveSubjectId = questionSubjectMap.get(att.questionId) || att.subjectId;
      const effectiveAttempt = effectiveSubjectId === att.subjectId ? att : { ...att, subjectId: effectiveSubjectId };

      if (ctx.role === 'student' && effectiveAttempt.studentId !== ctx.userId) continue;
      if (ctx.role === 'teacher' && !allowedSet.has(effectiveAttempt.subjectId)) continue;

      if (filters.subjectId && filters.subjectId !== 'All' && effectiveAttempt.subjectId !== filters.subjectId) continue;
      if (filters.topicId && filters.topicId !== 'All' && effectiveAttempt.topicId !== filters.topicId) continue;
      if (filters.subtopicId && filters.subtopicId !== 'All' && effectiveAttempt.subtopicId !== filters.subtopicId) continue;
      if (filters.questionId && filters.questionId !== 'All' && effectiveAttempt.questionId !== filters.questionId) continue;
      if (filters.difficulty && filters.difficulty !== 'All' && effectiveAttempt.difficultyAtAttempt !== filters.difficulty) continue;
      if (filters.studentId && filters.studentId !== 'All' && effectiveAttempt.studentId !== filters.studentId) continue;
      if (filters.dateFrom && effectiveAttempt.attemptTimestamp.slice(0, 10) < filters.dateFrom) continue;
      if (filters.dateTo && effectiveAttempt.attemptTimestamp.slice(0, 10) > filters.dateTo) continue;

      scopedAttempts.push(effectiveAttempt);
    }

    // Scoped Intervention Cases
    const allCaseRows = this.db
      .prepare('SELECT * FROM intervention_cases ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[];
    const scopedCases = allCaseRows
      .map(rowToInterventionCase)
      .map((c) => ({ ...c, subjectId: questionSubjectMap.get(c.questionId) || c.subjectId }))
      .filter((c) => {
        if (ctx.role === 'student' && c.studentId !== ctx.userId) return false;
        if (ctx.role === 'teacher' && !allowedSet.has(c.subjectId)) return false;
        if (filters.subjectId && filters.subjectId !== 'All' && c.subjectId !== filters.subjectId) return false;
        if (filters.topicId && filters.topicId !== 'All' && c.topicId !== filters.topicId) return false;
        if (filters.subtopicId && filters.subtopicId !== 'All' && c.subtopicId !== filters.subtopicId) return false;
        if (filters.questionId && filters.questionId !== 'All' && c.questionId !== filters.questionId) return false;
        if (filters.studentId && filters.studentId !== 'All' && c.studentId !== filters.studentId) return false;
        if (
          filters.interventionStatus &&
          filters.interventionStatus !== 'All' &&
          c.status !== filters.interventionStatus
        ) {
          return false;
        }
        return true;
      });

    // Overview KPIs (strictly separating valid answered vs skipped vs timed_out)
    const validAttempts = scopedAttempts.filter((a) => a.submissionStatus === 'valid_answered');
    const skippedCount = scopedAttempts.filter(
      (a) => a.submissionStatus === 'skipped' || a.submissionStatus === 'unanswered'
    ).length;
    const timedOutCount = scopedAttempts.filter((a) => a.submissionStatus === 'timed_out').length;
    const correctCount = validAttempts.filter((a) => a.isCorrect === true).length;
    const incorrectCount = validAttempts.filter((a) => a.isCorrect === false).length;
    const uniqueStudents = new Set(validAttempts.map((a) => a.studentId)).size;
    const validDurations = validAttempts.map((a) => a.responseDurationMs).filter((d) => d > 0);
    const avgResponseMs = validDurations.length
      ? Math.round(validDurations.reduce((acc, v) => acc + v, 0) / validDurations.length)
      : 0;

    // Daily trend series
    const dayMap = new Map<string, { date: string; valid: number; correct: number; incorrect: number }>();
    for (const a of validAttempts) {
      const day = a.attemptTimestamp.slice(0, 10);
      const cur = dayMap.get(day) || { date: day, valid: 0, correct: 0, incorrect: 0 };
      cur.valid += 1;
      if (a.isCorrect === true) cur.correct += 1;
      if (a.isCorrect === false) cur.incorrect += 1;
      dayMap.set(day, cur);
    }
    const attemptTrendSeries = Array.from(dayMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        ...d,
        correctRate: d.valid ? Math.round((d.correct / d.valid) * 1000) / 10 : 0,
      }));

    // Question performance list
    const questionIds = Array.from(new Set(scopedAttempts.map((a) => a.questionId)));
    const subjectsLookup = new Map<string, string>(
      (this.db.prepare('SELECT id, name_en FROM subjects').all() as { id: string; name_en: string }[]).map(
        (s) => [s.id, s.name_en]
      )
    );
    const topicsLookup = new Map<string, string>(
      (this.db.prepare('SELECT id, name_en FROM topics').all() as { id: string; name_en: string }[]).map(
        (t) => [t.id, t.name_en]
      )
    );

    const questionMetricsList = questionIds.map((qId) => {
      const q = this.resolveQuizById(qId);
      const m = calculateQuestionPerformance(qId, scopedAttempts, config.repeatedErrorThreshold);
      const sId = q ? resolveQuestionSubjectId(q) : 'subj-math';
      return {
        ...m,
        questionSi: q?.questionSi || qId,
        questionEn: q?.questionEn || qId,
        subjectId: sId,
        subjectName: subjectsLookup.get(sId) || sId,
        topicId: q?.topicId || '',
        topicName: topicsLookup.get(q?.topicId || '') || 'General Topic',
        difficultyTier: q?.attributes.difficultyTier || 'Moderate',
        openCaseCount: scopedCases.filter(
          (c) => c.questionId === qId && isActiveInterventionStatus(c.status)
        ).length,
      };
    });

    const mostIncorrectQuestions = [...questionMetricsList]
      .sort((a, b) => b.incorrectAttemptCount - a.incorrectAttemptCount || b.incorrectAttemptRate - a.incorrectAttemptRate)
      .slice(0, 12);
    const mostAttemptedQuestions = [...questionMetricsList]
      .sort((a, b) => b.validAttemptCount - a.validAttemptCount)
      .slice(0, 12);

    // Difficult topics breakdown
    const topicAgg = new Map<
      string,
      { topicId: string; topicName: string; subjectId: string; subjectName: string; valid: number; incorrect: number; correct: number }
    >();
    for (const a of validAttempts) {
      const cur = topicAgg.get(a.topicId) || {
        topicId: a.topicId,
        topicName: topicsLookup.get(a.topicId) || a.topicId,
        subjectId: a.subjectId,
        subjectName: subjectsLookup.get(a.subjectId) || a.subjectId,
        valid: 0,
        incorrect: 0,
        correct: 0,
      };
      cur.valid += 1;
      if (a.isCorrect === true) cur.correct += 1;
      if (a.isCorrect === false) cur.incorrect += 1;
      topicAgg.set(a.topicId, cur);
    }
    const difficultTopics = Array.from(topicAgg.values())
      .map((t) => ({
        ...t,
        incorrectRate: t.valid ? Math.round((t.incorrect / t.valid) * 1000) / 10 : 0,
        correctRate: t.valid ? Math.round((t.correct / t.valid) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.incorrectRate - a.incorrectRate);

    // Student performance trends within scope
    const studentUsers = this.db
      .prepare("SELECT id, name, user_id_code FROM users WHERE role = 'student'")
      .all() as { id: string; name: string; user_id_code: string }[];
    const studentNameMap = new Map(studentUsers.map((s) => [s.id, s]));
    const studentIdsInScope = Array.from(new Set(scopedAttempts.map((a) => a.studentId)));

    const studentPerformance = studentIdsInScope.map((sid) => {
      const sAtt = scopedAttempts.filter((a) => a.studentId === sid);
      const sValid = sAtt.filter((a) => a.submissionStatus === 'valid_answered');
      const sCorrect = sValid.filter((a) => a.isCorrect === true).length;
      const sIncorrect = sValid.filter((a) => a.isCorrect === false).length;
      const stuMeta = studentNameMap.get(sid);
      const stuOpenCases = scopedCases.filter(
        (c) => c.studentId === sid && isActiveInterventionStatus(c.status)
      ).length;
      const improvement: StudentImprovementSummary = calculateStudentBaselineVsFollowUp(
        sAtt,
        filters.subjectId && filters.subjectId !== 'All' ? filters.subjectId : undefined
      );
      return {
        studentId: sid,
        studentName: stuMeta?.name || sid,
        userIdCode: stuMeta?.user_id_code || sid,
        validAttempts: sValid.length,
        correctAttempts: sCorrect,
        incorrectAttempts: sIncorrect,
        accuracyPercent: sValid.length ? Math.round((sCorrect / sValid.length) * 1000) / 10 : 0,
        openInterventionsCount: stuOpenCases,
        improvement,
      };
    });

    const interventionCounts = {
      open: scopedCases.filter((c) => c.status === 'OPEN').length,
      underReview: scopedCases.filter((c) => c.status === 'UNDER_REVIEW').length,
      assigned: scopedCases.filter((c) => c.status === 'INTERVENTION_ASSIGNED').length,
      monitoring: scopedCases.filter((c) => c.status === 'MONITORING').length,
      resolved: scopedCases.filter((c) => c.status === 'RESOLVED').length,
      dismissed: scopedCases.filter((c) => c.status === 'DISMISSED').length,
      readyForTeacherReview: scopedCases.filter((c) => c.readyForTeacherReview).length,
    };

    return {
      scopeRole: ctx.role,
      authorizedSubjectIds:
        ctx.role === 'teacher'
          ? ctx.assignedSubjectIds
          : Array.from(subjectsLookup.keys()),
      kpis: {
        totalRecordedEvents: scopedAttempts.length,
        validAttemptCount: validAttempts.length,
        skippedCount,
        timedOutCount,
        uniqueStudents,
        correctAttemptCount: correctCount,
        incorrectAttemptCount: incorrectCount,
        overallCorrectRate: validAttempts.length
          ? Math.round((correctCount / validAttempts.length) * 1000) / 10
          : 0,
        overallIncorrectRate: validAttempts.length
          ? Math.round((incorrectCount / validAttempts.length) * 1000) / 10
          : 0,
        avgResponseMs,
        activeInterventionsCount:
          interventionCounts.open +
          interventionCounts.underReview +
          interventionCounts.assigned +
          interventionCounts.monitoring,
        resolvedInterventionsCount: interventionCounts.resolved,
      },
      interventionCounts,
      attemptTrendSeries,
      mostIncorrectQuestions,
      mostAttemptedQuestions,
      difficultTopics,
      studentPerformance,
      teacherActivity: ctx.role === 'admin' ? this.listTeachers() : [],
      ethicalFramingNote: RESPONSE_TIME_ETHICAL_FRAMING,
    };
  }

  // --- Interventions Console & State Machine ---
  public listInterventionCases(
    ctx: AuthorizationContext,
    filters: { status?: string; subjectId?: string; studentId?: string } = {}
  ) {
    if (
      ctx.role === 'teacher' &&
      filters.subjectId &&
      filters.subjectId !== 'All' &&
      !canAccessSubject(ctx, filters.subjectId)
    ) {
      throw new HttpError(403, 'Access denied for unassigned subject category.');
    }

    const questionSubjectMap = this.getQuestionSubjectMap();
    const allowedSet = new Set(ctx.assignedSubjectIds);

    const rows = this.db
      .prepare('SELECT * FROM intervention_cases ORDER BY ready_for_teacher_review DESC, updated_at DESC')
      .all() as Record<string, unknown>[];

    const users = this.db.prepare('SELECT id, name, user_id_code FROM users').all() as {
      id: string;
      name: string;
      user_id_code: string;
    }[];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const subjMap = new Map(
      (this.db.prepare('SELECT id, name_en FROM subjects').all() as { id: string; name_en: string }[]).map(
        (s) => [s.id, s.name_en]
      )
    );
    const topicMap = new Map(
      (this.db.prepare('SELECT id, name_en FROM topics').all() as { id: string; name_en: string }[]).map(
        (t) => [t.id, t.name_en]
      )
    );

    const cases = rows
      .map(rowToInterventionCase)
      .map((c) => ({ ...c, subjectId: questionSubjectMap.get(c.questionId) || c.subjectId }))
      .filter((c) => {
        if (ctx.role === 'student' && c.studentId !== ctx.userId) return false;
        if (ctx.role === 'teacher' && !allowedSet.has(c.subjectId)) return false;
        if (filters.status && filters.status !== 'All' && c.status !== filters.status) return false;
        if (filters.subjectId && filters.subjectId !== 'All' && c.subjectId !== filters.subjectId) return false;
        if (filters.studentId && filters.studentId !== 'All' && c.studentId !== filters.studentId) return false;
        return true;
      })
      .map((c) => {
        const stu = userMap.get(c.studentId);
        const tch = c.assignedTeacherId ? userMap.get(c.assignedTeacherId) : undefined;
        const q = this.resolveQuizById(c.questionId);
        return {
          ...c,
          studentName: stu?.name || 'Student',
          studentCode: stu?.user_id_code || c.studentId,
          assignedTeacherName: tch?.name || 'Subject Teacher',
          subjectName: subjMap.get(c.subjectId) || c.subjectId,
          topicName: topicMap.get(c.topicId) || c.topicId,
          questionSi: q?.questionSi || c.questionId,
          difficultyTier: q?.attributes.difficultyTier || 'Moderate',
        };
      });

    return {
      cases,
      templates: INTERVENTION_TEMPLATES.filter(
        (t) => ctx.role !== 'teacher' || t.subjectId === 'all' || allowedSet.has(t.subjectId)
      ),
    };
  }

  public getInterventionCaseDetail(ctx: AuthorizationContext, caseId: string) {
    const row = this.db.prepare('SELECT * FROM intervention_cases WHERE id = ?').get(caseId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new HttpError(404, 'Intervention case not found.');
    }
    const c = rowToInterventionCase(row);
    const effectiveSubjectId = this.getQuestionSubjectMap().get(c.questionId) || c.subjectId;
    c.subjectId = effectiveSubjectId;

    if (ctx.role === 'student' && c.studentId !== ctx.userId) {
      throw new HttpError(403, 'Access denied.');
    }
    if (ctx.role === 'teacher' && !canAccessSubject(ctx, effectiveSubjectId)) {
      throw new HttpError(403, 'Access denied: Case belongs to an unassigned subject category.');
    }

    const stu = this.getUserById(c.studentId);
    const question = this.resolveQuizById(c.questionId);

    const actionsRows = this.db
      .prepare('SELECT * FROM intervention_actions WHERE case_id = ? ORDER BY created_at DESC')
      .all(caseId) as Record<string, unknown>[];
    const actions: InterventionAction[] = actionsRows.map((a) => ({
      id: String(a.id),
      caseId: String(a.case_id),
      actorId: String(a.actor_id),
      actorName: String(a.actor_name),
      actorRole: String(a.actor_role) as UserRole | 'system',
      actionType: String(a.action_type) as InterventionAction['actionType'],
      fromStatus: a.from_status ? (String(a.from_status) as InterventionStatus) : null,
      toStatus: String(a.to_status) as InterventionStatus,
      notes: String(a.notes),
      templateUsed: a.template_used ? String(a.template_used) : null,
      createdAt: String(a.created_at),
    }));

    const attemptRows = this.db
      .prepare(
        'SELECT * FROM question_attempts WHERE student_id = ? AND question_id = ? ORDER BY attempt_timestamp ASC'
      )
      .all(c.studentId, c.questionId) as Record<string, unknown>[];
    const studentAttemptsOnQuestion = attemptRows.map(rowToQuestionAttempt);

    const allStudentAttemptsRows = this.db
      .prepare('SELECT * FROM question_attempts WHERE student_id = ? ORDER BY attempt_timestamp ASC')
      .all(c.studentId) as Record<string, unknown>[];
    const improvement = calculateStudentBaselineVsFollowUp(
      allStudentAttemptsRows.map(rowToQuestionAttempt),
      effectiveSubjectId
    );

    const subjRow = this.db
      .prepare('SELECT name_en FROM subjects WHERE id = ?')
      .get(effectiveSubjectId) as { name_en: string } | undefined;
    const topicRow = this.db
      .prepare('SELECT name_en, prerequisite_topic_id FROM topics WHERE id = ?')
      .get(c.topicId) as { name_en: string; prerequisite_topic_id: string | null } | undefined;

    return {
      caseDetail: {
        ...c,
        subjectName: subjRow?.name_en || effectiveSubjectId,
        topicName: topicRow?.name_en || c.topicId,
        prerequisiteTopicId: topicRow?.prerequisite_topic_id || null,
        studentName: stu?.name || c.studentId,
        studentCode: stu?.userIdCode || c.studentId,
        guardianName: stu?.guardianName || '',
        guardianContactVerified: stu?.guardianContactVerified ?? false,
        guardianConsentGiven: stu?.guardianConsentGiven ?? false,
      },
      question,
      actions,
      studentAttemptsOnQuestion,
      improvement,
      templates: INTERVENTION_TEMPLATES,
    };
  }

  public applyInterventionAction(
    actor: UserAccount,
    caseId: string,
    payload: {
      nextStatus?: InterventionStatus;
      templateId?: string | null;
      instructionTitle?: string;
      instructionBody?: string;
      recommendedPracticeTopicId?: string | null;
      notes?: string;
      dismissalReason?: string;
      resolutionNotes?: string;
      notifyGuardian?: boolean;
    }
  ) {
    if (actor.role !== 'admin' && actor.role !== 'teacher') {
      throw new HttpError(403, 'Only authorized teachers or administrators can manage interventions.');
    }

    const row = this.db.prepare('SELECT * FROM intervention_cases WHERE id = ?').get(caseId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new HttpError(404, 'Intervention case not found.');
    }
    const existing = rowToInterventionCase(row);
    const effectiveSubjectId = this.getQuestionSubjectMap().get(existing.questionId) || existing.subjectId;
    const ctx = this.buildAuthContext(actor);

    if (!canAccessSubject(ctx, effectiveSubjectId)) {
      throw new HttpError(
        403,
        'Access denied: You do not have permission for this question subject category.'
      );
    }

    const nextStatus = payload.nextStatus || existing.status;
    const transitionCheck = validateCaseTransition(existing.status, nextStatus);
    if (!transitionCheck.ok) {
      throw new HttpError(400, transitionCheck.reason || 'Invalid intervention state transition.');
    }

    if (nextStatus === 'DISMISSED' && !String(payload.dismissalReason || payload.notes || '').trim()) {
      throw new HttpError(400, 'Provide a dismissal reason before dismissing an intervention case.');
    }

    const chosenTemplate = payload.templateId
      ? INTERVENTION_TEMPLATES.find((t) => t.id === payload.templateId)
      : undefined;

    const nextTitle =
      String(payload.instructionTitle || '').trim() ||
      chosenTemplate?.title ||
      existing.instructionTitle;
    const nextBody =
      String(payload.instructionBody || '').trim() ||
      chosenTemplate?.instructionTemplate ||
      existing.instructionBody;
    const nextTopicId =
      payload.recommendedPracticeTopicId !== undefined
        ? payload.recommendedPracticeTopicId
        : existing.recommendedPracticeTopicId;

    if (nextStatus === 'INTERVENTION_ASSIGNED' && !nextBody) {
      throw new HttpError(
        400,
        'Provide clear learning instructions (or select a reusable template) before assigning intervention.'
      );
    }

    const now = new Date().toISOString();
    const resolvedAt = nextStatus === 'RESOLVED' ? now : nextStatus === 'OPEN' ? null : existing.resolvedAt;
    const actionType: InterventionAction['actionType'] =
      nextStatus === 'RESOLVED'
        ? 'CASE_RESOLVED'
        : nextStatus === 'DISMISSED'
        ? 'CASE_DISMISSED'
        : nextStatus === 'OPEN' && (existing.status === 'RESOLVED' || existing.status === 'DISMISSED')
        ? 'CASE_REOPENED'
        : nextStatus === 'INTERVENTION_ASSIGNED' || Boolean(payload.instructionBody)
        ? 'INSTRUCTION_ASSIGNED'
        : 'STATUS_CHANGED';

    const student = this.getUserById(existing.studentId);

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE intervention_cases SET
            subject_id = ?, status = ?, assigned_teacher_id = COALESCE(assigned_teacher_id, ?),
            template_id = ?, instruction_title = ?, instruction_body = ?,
            recommended_practice_topic_id = ?, dismissal_reason = ?, resolution_notes = ?,
            reopen_count = CASE WHEN ? = 'OPEN' AND (? = 'RESOLVED' OR ? = 'DISMISSED') THEN reopen_count + 1 ELSE reopen_count END,
            ready_for_teacher_review = CASE WHEN ? = 'RESOLVED' OR ? = 'DISMISSED' THEN 0 ELSE ready_for_teacher_review END,
            updated_at = ?, resolved_at = ?
           WHERE id = ?`
        )
        .run(
          effectiveSubjectId,
          nextStatus,
          actor.role === 'teacher' ? actor.id : existing.assignedTeacherId,
          payload.templateId ?? existing.templateId,
          nextTitle,
          nextBody,
          nextTopicId,
          nextStatus === 'DISMISSED' ? String(payload.dismissalReason || payload.notes || '') : existing.dismissalReason,
          nextStatus === 'RESOLVED' ? String(payload.resolutionNotes || payload.notes || 'Confirmed improvement after follow-up.') : existing.resolutionNotes,
          nextStatus,
          existing.status,
          existing.status,
          nextStatus,
          nextStatus,
          now,
          resolvedAt,
          caseId
        );

      this.insertInterventionAction({
        caseId,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        actionType,
        fromStatus: existing.status,
        toStatus: nextStatus,
        notes:
          String(payload.notes || '').trim() ||
          (nextStatus === 'INTERVENTION_ASSIGNED'
            ? `Assigned instruction "${nextTitle}".`
            : `Updated status from ${existing.status} to ${nextStatus}.`),
        templateUsed: chosenTemplate?.id || payload.templateId || null,
      });

      this.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: `INTERVENTION_${actionType}`,
        targetType: 'intervention_case',
        targetId: caseId,
        details: { fromStatus: existing.status, toStatus: nextStatus, templateId: payload.templateId || null },
      });

      // Notify student & verified consented guardian when instruction assigned
      if (student && (nextStatus === 'INTERVENTION_ASSIGNED' || payload.instructionBody)) {
        this.insertNotificationRow({
          recipientUserId: student.id,
          recipientRole: 'student',
          channel: 'in_app',
          category: 'intervention_assigned',
          title: `New Learning Tip: ${nextTitle}`,
          body: nextBody,
          relatedCaseId: caseId,
          relatedStudentId: student.id,
          relatedSubjectId: effectiveSubjectId,
          dedupeKey: `stu-instr-${caseId}-${Date.now()}`,
          deliveryStatus: 'delivered',
        });

        if (payload.notifyGuardian !== false) {
          const canSendExternal = Boolean(student.guardianContactVerified && student.guardianConsentGiven);
          if (!canSendExternal) {
            this.insertNotificationRow({
              recipientUserId: student.id,
              recipientRole: 'student',
              channel: 'whatsapp',
              category: 'intervention_assigned',
              title: `Guardian Notification Skipped (Unverified/No Consent)`,
              body: `External detailed performance message withheld until guardian contact verification & consent are enabled.`,
              relatedCaseId: caseId,
              relatedStudentId: student.id,
              relatedSubjectId: effectiveSubjectId,
              dedupeKey: `grd-skip-${caseId}-${Date.now()}`,
              deliveryStatus: 'skipped_unverified',
              errorMessage: 'Guardian contact not verified or consent not granted.',
            });
            this.recordWhatsAppLog({
              toNumber: student.whatsappNumber,
              category: 'intervention',
              messageText: '[WITHHELD] Guardian verification or consent pending.',
              deliveryStatus: 'skipped_unverified',
            });
          } else {
            this.insertNotificationRow({
              recipientUserId: student.id,
              recipientRole: 'student',
              channel: 'whatsapp',
              category: 'intervention_assigned',
              title: `Guardian Guidance Sent · ${nextTitle}`,
              body: `Teacher ${actor.name} shared a supportive study step for ${student.name}: ${nextBody}`,
              relatedCaseId: caseId,
              relatedStudentId: student.id,
              relatedSubjectId: effectiveSubjectId,
              dedupeKey: `grd-wa-${caseId}-${Date.now()}`,
              deliveryStatus: 'delivered',
            });
            this.recordWhatsAppLog({
              toNumber: student.whatsappNumber,
              category: 'intervention',
              messageText: `👩‍🏫 *මං 5හේ Teacher Guidance (${actor.name})*\nStudent: ${student.name}\nFocus: ${nextTitle}\nAction Step: ${nextBody}`,
              deliveryStatus: 'delivered',
            });
            this.recordEmailLog({
              toEmail: student.email,
              subject: `Teacher Guidance Plan: ${nextTitle} · මං 5හේ`,
              category: 'intervention',
              htmlBody: `<div style="font-family:sans-serif;padding:20px;background:#EAF5FF;color:#0F2942"><h2>මං 5හේ · Teacher Learning Guidance</h2><p>Dear ${student.guardianName || 'Parent / Guardian'},</p><p><strong>${actor.name}</strong> has assigned a helpful practice guide for <strong>${student.name}</strong>:</p><div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #CBE2FA"><h3>${nextTitle}</h3><p>${nextBody}</p></div></div>`,
            });
          }
        }
      }
    });

    return this.getInterventionCaseDetail(ctx, caseId);
  }

  public listStudentInterventions(studentId: string) {
    const rows = this.db
      .prepare(
        `SELECT * FROM intervention_cases
         WHERE student_id = ? AND status IN ('INTERVENTION_ASSIGNED', 'MONITORING', 'OPEN', 'UNDER_REVIEW')
         ORDER BY updated_at DESC`
      )
      .all(studentId) as Record<string, unknown>[];

    const teachers = new Map(
      (this.db.prepare("SELECT id, name FROM users WHERE role = 'teacher'").all() as {
        id: string;
        name: string;
      }[]).map((t) => [t.id, t.name])
    );
    const subjects = new Map(
      (this.db.prepare('SELECT id, name_en FROM subjects').all() as {
        id: string;
        name_en: string;
      }[]).map((s) => [s.id, s.name_en])
    );
    const topics = new Map(
      (this.db.prepare('SELECT id, name_en FROM topics').all() as {
        id: string;
        name_en: string;
      }[]).map((t) => [t.id, t.name_en])
    );

    return rows.map(rowToInterventionCase).map((c) => ({
      ...c,
      teacherName: c.assignedTeacherId ? teachers.get(c.assignedTeacherId) || 'Subject Teacher' : 'Subject Teacher',
      subjectName: subjects.get(c.subjectId) || c.subjectId,
      topicName: topics.get(c.recommendedPracticeTopicId || c.topicId) || 'Focused Practice',
    }));
  }

  // --- Notifications & Delivery Reliability ---
  public listNotifications(user: UserAccount) {
    const rows =
      user.role === 'admin'
        ? (this.db
            .prepare(
              'SELECT * FROM notifications WHERE recipient_user_id = ? OR channel != \'in_app\' ORDER BY created_at DESC LIMIT 80'
            )
            .all(user.id) as Record<string, unknown>[])
        : (this.db
            .prepare(
              'SELECT * FROM notifications WHERE recipient_user_id = ? ORDER BY created_at DESC LIMIT 60'
            )
            .all(user.id) as Record<string, unknown>[]);

    const notifications: NotificationRecord[] = rows.map((r) => ({
      id: String(r.id),
      recipientUserId: String(r.recipient_user_id),
      recipientRole: String(r.recipient_role) as UserRole,
      channel: String(r.channel) as NotificationRecord['channel'],
      category: String(r.category) as NotificationRecord['category'],
      title: String(r.title),
      body: String(r.body),
      relatedCaseId: r.related_case_id ? String(r.related_case_id) : null,
      relatedStudentId: r.related_student_id ? String(r.related_student_id) : null,
      relatedSubjectId: r.related_subject_id ? String(r.related_subject_id) : null,
      relatedPublicationId: r.related_publication_id ? String(r.related_publication_id) : null,
      dedupeKey: String(r.dedupe_key),
      deliveryStatus: String(r.delivery_status) as NotificationRecord['deliveryStatus'],
      retryCount: Number(r.retry_count ?? 0),
      errorMessage: r.error_message ? String(r.error_message) : null,
      readAt: r.read_at ? String(r.read_at) : null,
      createdAt: String(r.created_at),
    }));

    const unreadCount = notifications.filter(
      (n) => n.recipientUserId === user.id && !n.readAt
    ).length;

    return { notifications, unreadCount };
  }

  public markNotificationRead(userId: string, notificationId: string): void {
    this.db
      .prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_user_id = ?')
      .run(new Date().toISOString(), notificationId, userId);
  }

  public retryNotification(actor: UserAccount, notificationId: string) {
    const row = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(notificationId) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new HttpError(404, 'Notification not found.');
    if (actor.role !== 'admin' && String(row.recipient_user_id) !== actor.id) {
      throw new HttpError(403, 'Not authorized to retry this notification.');
    }

    if (String(row.delivery_status) === 'skipped_unverified' && row.related_student_id) {
      const stu = this.getUserById(String(row.related_student_id));
      if (!stu?.guardianContactVerified || !stu?.guardianConsentGiven) {
        throw new HttpError(
          400,
          'Cannot deliver notification until guardian contact is verified and consent is granted.'
        );
      }
    }

    this.db
      .prepare(
        `UPDATE notifications SET delivery_status = 'delivered', retry_count = retry_count + 1, error_message = NULL WHERE id = ?`
      )
      .run(notificationId);

    return { ok: true };
  }

  public updateNotificationPreferences(
    userId: string,
    prefs: Partial<NotificationPreferences>
  ): NotificationPreferences {
    const user = this.getUserById(userId);
    if (!user) throw new HttpError(404, 'User not found.');
    const cur = user.notificationPreferences || DEFAULT_PREFS;
    const next: NotificationPreferences = {
      inApp: typeof prefs.inApp === 'boolean' ? prefs.inApp : cur.inApp,
      email: typeof prefs.email === 'boolean' ? prefs.email : cur.email,
      whatsapp: typeof prefs.whatsapp === 'boolean' ? prefs.whatsapp : cur.whatsapp,
      groupedSummary:
        typeof prefs.groupedSummary === 'boolean' ? prefs.groupedSummary : cur.groupedSummary,
    };
    this.db
      .prepare('UPDATE users SET notification_preferences_json = ? WHERE id = ?')
      .run(JSON.stringify(next), userId);
    return next;
  }

  // --- Full Analytics Recalculation (Safe / Idempotent) ---
  public recalculateAllAnalytics(adminUser: UserAccount) {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Administrator access required to recalculate aggregates.');
    }
    this.dbWrapper.transaction(() => {
      this.dbWrapper.recalculateAggregatesSync();
      this.writeAuditLog({
        actorId: adminUser.id,
        actorName: adminUser.name,
        actorRole: 'admin',
        action: 'ANALYTICS_RECALCULATED',
        targetType: 'question_stats',
        targetId: 'all',
        details: { recalculatedAt: new Date().toISOString() },
      });
    });
    const qsCount = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM question_stats').get() as { cnt: number }
    ).cnt;
    return { ok: true, questionStatsUpdated: qsCount };
  }

  // --- Papers, Rounds, Payments, Logs (Preserved Existing Features Backed by SQLite) ---
  public getPaymentPlans(): PaymentPlan[] {
    const rows = this.db.prepare('SELECT * FROM payment_plans ORDER BY price_lkr ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      nameSi: String(r.name_si),
      audience: String(r.audience),
      priceLkr: Number(r.price_lkr),
      durationDays: Number(r.duration_days),
      features: parseJsonSafe<string[]>(r.features_json, []),
      recommended: Number(r.recommended) === 1,
    }));
  }

  public activateSubscriptionAndCreateInvoice(params: {
    user: UserAccount;
    plan: PaymentPlan;
    gateway: 'PayHere LKR' | 'Stripe Card';
  }): { user: UserAccount; invoice: InvoiceRecord } {
    const expires = new Date(Date.now() + params.plan.durationDays * 86_400_000).toISOString();
    const invoice: InvoiceRecord = {
      id: `inv-${crypto.randomBytes(4).toString('hex')}`,
      invoiceNumber: `INV-M5-${Math.floor(100000 + Math.random() * 899999)}`,
      userId: params.user.id,
      userName: params.user.name,
      userEmail: params.user.email,
      planId: params.plan.id,
      planName: params.plan.name,
      amountLkr: params.plan.priceLkr,
      gateway: params.gateway,
      gatewayRef: `GW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      signatureVerified: true,
      status: 'paid',
      createdAt: new Date().toISOString(),
    };

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE users SET subscription_status = 'active', subscription_plan_id = ?, subscription_expires_at = ? WHERE id = ?`
        )
        .run(params.plan.id, expires, params.user.id);

      this.db
        .prepare(
          `INSERT INTO invoices (id, invoice_number, user_id, user_name, user_email, plan_id, plan_name, amount_lkr, gateway, gateway_ref, signature_verified, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'paid', ?)`
        )
        .run(
          invoice.id,
          invoice.invoiceNumber,
          invoice.userId,
          invoice.userName,
          invoice.userEmail,
          invoice.planId,
          invoice.planName,
          invoice.amountLkr,
          invoice.gateway,
          invoice.gatewayRef,
          invoice.createdAt
        );
    });

    this.recordEmailLog({
      toEmail: params.user.email,
      subject: `Official Receipt & Invoice ${invoice.invoiceNumber} · මං 5හේ`,
      category: 'invoice',
      htmlBody: buildInvoiceEmailHtml(invoice),
    });

    this.recordWhatsAppLog({
      toNumber: params.user.whatsappNumber,
      category: 'payment',
      messageText: `✅ මං 5හේ Payment Confirmed!\nInvoice: ${invoice.invoiceNumber}\nPlan: ${params.plan.name}\nAmount: LKR ${params.plan.priceLkr.toLocaleString('en-LK')}\nFull 500,000+ quiz bank & timed scholarship papers unlocked!`,
    });

    return { user: this.getUserById(params.user.id)!, invoice };
  }

  public getInvoicesForUser(user: UserAccount): InvoiceRecord[] {
    const rows =
      user.role === 'admin'
        ? (this.db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all() as Record<
            string,
            unknown
          >[])
        : (this.db
            .prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC')
            .all(user.id) as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: String(r.id),
      invoiceNumber: String(r.invoice_number),
      userId: String(r.user_id),
      userName: String(r.user_name),
      userEmail: String(r.user_email),
      planId: String(r.plan_id),
      planName: String(r.plan_name),
      amountLkr: Number(r.amount_lkr),
      gateway: String(r.gateway) as InvoiceRecord['gateway'],
      gatewayRef: String(r.gateway_ref),
      signatureVerified: Number(r.signature_verified) === 1,
      status: String(r.status) as InvoiceRecord['status'],
      createdAt: String(r.created_at),
    }));
  }

  public getPapers(): ExamPaper[] {
    const rows = this.db.prepare('SELECT * FROM papers ORDER BY created_at DESC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      titleSi: String(r.title_si),
      description: String(r.description),
      durationMinutes: Number(r.duration_minutes),
      quizIds: parseJsonSafe<string[]>(r.quiz_ids_json, []),
      qualitySummary: parseJsonSafe(r.quality_summary_json, calculatePaperQualityAndDifficulty([])),
      createdBy: String(r.created_by),
      createdAt: String(r.created_at),
      published: Number(r.published) === 1,
    }));
  }

  public getPaperById(paperId: string): ExamPaper | null {
    const row = this.db.prepare('SELECT * FROM papers WHERE id = ?').get(paperId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      title: String(row.title),
      titleSi: String(row.title_si),
      description: String(row.description),
      durationMinutes: Number(row.duration_minutes),
      quizIds: parseJsonSafe<string[]>(row.quiz_ids_json, []),
      qualitySummary: parseJsonSafe(
        row.quality_summary_json,
        calculatePaperQualityAndDifficulty([])
      ),
      createdBy: String(row.created_by),
      createdAt: String(row.created_at),
      published: Number(row.published) === 1,
    };
  }

  public createPaper(
    adminUser: UserAccount,
    payload: {
      title: string;
      titleSi?: string;
      description?: string;
      durationMinutes: number;
      quizIds: string[];
    }
  ): ExamPaper {
    if (adminUser.role !== 'admin') {
      throw new HttpError(403, 'Admin role required.');
    }
    const resolved = (payload.quizIds || [])
      .map((id) => this.resolveQuizById(String(id)))
      .filter(Boolean) as QuizItem[];
    if (!payload.title || resolved.length < 3) {
      throw new HttpError(400, 'Paper title and at least 3 valid quizzes are required.');
    }

    const qualitySummary = calculatePaperQualityAndDifficulty(resolved);
    const totalPapers = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM papers').get() as { cnt: number }
    ).cnt;
    const paper: ExamPaper = {
      id: `PAPER-${String(totalPapers + 1).padStart(3, '0')}`,
      title: String(payload.title).trim(),
      titleSi: String(payload.titleSi || payload.title).trim(),
      description: String(payload.description || qualitySummary.recommendation).trim(),
      durationMinutes: Math.max(5, Math.min(120, Number(payload.durationMinutes || 15))),
      quizIds: resolved.map((q) => q.id),
      qualitySummary,
      createdBy: adminUser.email,
      createdAt: new Date().toISOString(),
      published: true,
    };

    this.db
      .prepare(
        `INSERT INTO papers (id, title, title_si, description, duration_minutes, quiz_ids_json, quality_summary_json, created_by, created_at, published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        paper.id,
        paper.title,
        paper.titleSi,
        paper.description,
        paper.durationMinutes,
        JSON.stringify(paper.quizIds),
        JSON.stringify(paper.qualitySummary),
        paper.createdBy,
        paper.createdAt
      );

    return paper;
  }

  public createExamSession(userId: string, paper: ExamPaper): string {
    const sessionId = `EXM-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    this.db
      .prepare(
        `INSERT INTO active_exam_sessions (session_id, user_id, paper_id, started_at_ms, time_limit_seconds)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(sessionId, userId, paper.id, Date.now(), paper.durationMinutes * 60);
    return sessionId;
  }

  public consumeExamSession(sessionId: string): { startedAtMs: number; timeLimitSeconds: number } | null {
    const row = this.db
      .prepare('SELECT started_at_ms, time_limit_seconds FROM active_exam_sessions WHERE session_id = ?')
      .get(sessionId) as { started_at_ms: number; time_limit_seconds: number } | undefined;
    if (!row) return null;
    this.db.prepare('DELETE FROM active_exam_sessions WHERE session_id = ?').run(sessionId);
    return {
      startedAtMs: Number(row.started_at_ms),
      timeLimitSeconds: Number(row.time_limit_seconds),
    };
  }

  public getRoundAttemptsForUser(userId: string): AttemptRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM round_attempts WHERE user_id = ? ORDER BY submitted_at DESC')
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      paperId: String(r.paper_id),
      paperTitle: String(r.paper_title),
      mode: String(r.mode) as AttemptRecord['mode'],
      paperCategory: String(r.paper_category) as PaperCategoryLevel,
      totalQuestions: Number(r.total_questions),
      correctCount: Number(r.correct_count),
      scorePercent: Number(r.score_percent),
      timeLimitSeconds: Number(r.time_limit_seconds),
      timeSpentSeconds: Number(r.time_spent_seconds),
      starsEarned: Number(r.stars_earned),
      domainBreakdown: parseJsonSafe(r.domain_breakdown_json, {}),
      submittedAt: String(r.submitted_at),
    }));
  }

  public getAllRoundAttempts(limit = 50): AttemptRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM round_attempts ORDER BY submitted_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      paperId: String(r.paper_id),
      paperTitle: String(r.paper_title),
      mode: String(r.mode) as AttemptRecord['mode'],
      paperCategory: String(r.paper_category) as PaperCategoryLevel,
      totalQuestions: Number(r.total_questions),
      correctCount: Number(r.correct_count),
      scorePercent: Number(r.score_percent),
      timeLimitSeconds: Number(r.time_limit_seconds),
      timeSpentSeconds: Number(r.time_spent_seconds),
      starsEarned: Number(r.stars_earned),
      domainBreakdown: parseJsonSafe(r.domain_breakdown_json, {}),
      submittedAt: String(r.submitted_at),
    }));
  }

  public recordRoundAttemptAndUpdateUser(params: {
    user: UserAccount;
    paperId: string;
    paperTitle: string;
    mode: 'practice' | 'timed_exam';
    paperCategory: PaperCategoryLevel;
    totalQuestions: number;
    correctCount: number;
    timeLimitSeconds: number;
    timeSpentSeconds: number;
    starsEarned: number;
    domainBreakdown: Record<string, { correct: number; total: number }>;
  }) {
    const scorePercent = Math.round(
      (params.correctCount / Math.max(1, params.totalQuestions)) * 100
    );
    const attempt: AttemptRecord = {
      id: `ATT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      userId: params.user.id,
      paperId: params.paperId,
      paperTitle: params.paperTitle,
      mode: params.mode,
      paperCategory: params.paperCategory,
      totalQuestions: params.totalQuestions,
      correctCount: params.correctCount,
      scorePercent,
      timeLimitSeconds: params.timeLimitSeconds,
      timeSpentSeconds: params.timeSpentSeconds,
      starsEarned: params.starsEarned,
      domainBreakdown: params.domainBreakdown,
      submittedAt: new Date().toISOString(),
    };

    const streakUpdate = calculateUpdatedStreak({
      currentStreakDays: params.user.streakDays,
      lastPracticeDate: params.user.lastPracticeDate,
    });

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO round_attempts (
            id, user_id, paper_id, paper_title, mode, paper_category, total_questions,
            correct_count, score_percent, time_limit_seconds, time_spent_seconds,
            stars_earned, domain_breakdown_json, submitted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          attempt.id,
          attempt.userId,
          attempt.paperId,
          attempt.paperTitle,
          attempt.mode,
          attempt.paperCategory,
          attempt.totalQuestions,
          attempt.correctCount,
          attempt.scorePercent,
          attempt.timeLimitSeconds,
          attempt.timeSpentSeconds,
          attempt.starsEarned,
          JSON.stringify(attempt.domainBreakdown),
          attempt.submittedAt
        );

      const userAttempts = [attempt, ...this.getRoundAttemptsForUser(params.user.id)];
      const trajectory = evaluateStudentTrajectory(userAttempts, params.user.currentLevel);

      this.db
        .prepare(
          `UPDATE users SET stars = stars + ?, streak_days = ?, last_practice_date = ?, current_level = ? WHERE id = ?`
        )
        .run(
          params.starsEarned,
          streakUpdate.streakDays,
          streakUpdate.lastPracticeDate,
          trajectory.recommendedNextLevel,
          params.user.id
        );
    });

    const refreshedUser = this.getUserById(params.user.id)!;
    const allAttempts = this.getRoundAttemptsForUser(refreshedUser.id);
    const trajectory = evaluateStudentTrajectory(allAttempts, refreshedUser.currentLevel);

    return { attempt, user: refreshedUser, trajectory };
  }

  // --- Email & WhatsApp Logs ---
  public recordEmailLog(params: {
    toEmail: string;
    subject: string;
    category: EmailLog['category'];
    otpCode?: string;
    htmlBody: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO email_logs (id, to_email, subject, category, otp_code, html_body, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `EML-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        params.toEmail,
        params.subject,
        params.category,
        params.otpCode || null,
        params.htmlBody,
        new Date().toISOString()
      );
  }

  public recordWhatsAppLog(params: {
    toNumber: string;
    category: WhatsAppLog['category'];
    messageText: string;
    deliveryStatus?: WhatsAppLog['deliveryStatus'];
  }): void {
    this.db
      .prepare(
        `INSERT INTO whatsapp_logs (id, to_number, category, message_text, delivery_status, sent_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        `WA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        params.toNumber,
        params.category,
        params.messageText,
        params.deliveryStatus || 'delivered',
        new Date().toISOString()
      );
  }

  public getEmailLogs(emailFilter?: string): EmailLog[] {
    const rows = emailFilter
      ? (this.db
          .prepare('SELECT * FROM email_logs WHERE LOWER(to_email) = ? ORDER BY sent_at DESC LIMIT 40')
          .all(emailFilter.trim().toLowerCase()) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM email_logs ORDER BY sent_at DESC LIMIT 40')
          .all() as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: String(r.id),
      toEmail: String(r.to_email),
      subject: String(r.subject),
      category: String(r.category) as EmailLog['category'],
      otpCode: r.otp_code ? String(r.otp_code) : undefined,
      htmlBody: String(r.html_body),
      sentAt: String(r.sent_at),
    }));
  }

  public getWhatsAppLogs(phoneFilter?: string): WhatsAppLog[] {
    const rows = phoneFilter
      ? (this.db
          .prepare('SELECT * FROM whatsapp_logs WHERE to_number = ? ORDER BY sent_at DESC LIMIT 40')
          .all(phoneFilter) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM whatsapp_logs ORDER BY sent_at DESC LIMIT 40')
          .all() as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: String(r.id),
      toNumber: String(r.to_number),
      category: String(r.category) as WhatsAppLog['category'],
      messageText: String(r.message_text),
      deliveryStatus: String(r.delivery_status) as WhatsAppLog['deliveryStatus'],
      sentAt: String(r.sent_at),
    }));
  }

  public dispatchActivityEmailAndWhatsApp(params: {
    user: UserAccount;
    attempt: AttemptRecord;
    trajectory: ReturnType<typeof evaluateStudentTrajectory>;
    emailSubject: string;
    whatsappCategory: 'exam_report' | 'milestone';
  }) {
    if (!params.user.guardianContactVerified || !params.user.guardianConsentGiven) {
      this.recordWhatsAppLog({
        toNumber: params.user.whatsappNumber,
        category: params.whatsappCategory,
        messageText: '[WITHHELD] Guardian contact unverified or consent withheld.',
        deliveryStatus: 'skipped_unverified',
      });
      return { emailSent: false, whatsappSent: false, skippedUnverified: true };
    }

    this.recordEmailLog({
      toEmail: params.user.email,
      subject: params.emailSubject,
      category: 'progress_report',
      htmlBody: buildProgressEmailHtml({
        studentName: params.user.name,
        attempt: params.attempt,
        trajectory: params.trajectory,
      }),
    });

    this.recordWhatsAppLog({
      toNumber: params.user.whatsappNumber,
      category: params.whatsappCategory,
      messageText: buildWhatsAppProgressMessage({
        studentName: params.user.name,
        attempt: params.attempt,
        trajectory: params.trajectory,
      }),
    });

    return { emailSent: true, whatsappSent: true, skippedUnverified: false };
  }
}
