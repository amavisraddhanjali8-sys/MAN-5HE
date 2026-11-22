import crypto from 'node:crypto';
import {
  buildEmailTextAndHtml,
} from '../lib/notifications.ts';
import {
  detectProhibitedSurveillancePayload,
  summarizeSingleSession,
  validateScheduleWellbeing,
  type ProposedSessionSlot,
} from '../lib/wellbeingEngine.ts';
import type {
  AuditDocumentAccessLog,
  AuditDocumentRecord,
  AuditDocumentType,
  DailyStudyBreakdownPoint,
  GuardianStudentLink,
  ParentContactRecord,
  ParentScheduleDecision,
  PreScheduleWellbeingValidationResult,
  SafeguardingChronologyEntry,
  SafeguardingDecisionStatus,
  SafeguardingReviewRecord,
  ScheduledSessionRecord,
  SessionActivitySummary,
  StudentStudyTimeAnalytics,
  StudyActivityContextMode,
  StudyActivityEventInput,
  StudyActivityEventRecord,
  UserAccount,
  WellbeingCaseDetail,
  WellbeingCaseEvidenceRecord,
  WellbeingCaseNoteRecord,
  WellbeingCasePriority,
  WellbeingCaseRecord,
  WellbeingCaseStatus,
  WellbeingFollowupActionRecord,
  WellbeingRuleApprovalStatus,
  WellbeingRuleSet,
  WellbeingRuleVersion,
  WellbeingWarningRecord,
} from '../lib/types.ts';
import { AcademicService, HttpError } from './academicService.ts';
import { buildAuditDocumentPdfBuffer } from './reportPdf.ts';

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function escapeHtml(val: string): string {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STANDARD_UNCERTAINTY_STATEMENTS = [
  'Observed active study time is estimated from privacy-preserving interaction heartbeats and navigation/answer actions; offline reading or paper problem-solving without clicks counts as unverified open/idle time rather than active browser interaction.',
  'Configured time guidelines are educational pacing references for Grade 5 preparation and are not medical, psychological, or diagnostic thresholds.',
  'Backgrounded tabs and network disconnections pause active-time accumulation and may undercount physical textbook revision occurring off-screen.',
];

export class WellbeingService {
  private readonly academic: AcademicService;

  constructor(academic: AcademicService) {
    this.academic = academic;
  }

  private get dbWrapper() {
    return this.academic.dbWrapper;
  }

  private get db() {
    return this.dbWrapper.db;
  }

  private isDesignatedSafeguarding(user: UserAccount): boolean {
    return user.role === 'admin' || Boolean(user.safeguardingDesignated);
  }

  private assertSafeguardingPersonnel(actor: UserAccount): void {
    if (!this.isDesignatedSafeguarding(actor)) {
      throw new HttpError(
        403,
        'Access denied: safeguarding review records and referral drafts are restricted to designated safeguarding personnel.'
      );
    }
  }

  private isVerifiedGuardianOf(guardianId: string, studentId: string): GuardianStudentLink | null {
    const row = this.db
      .prepare(
        `SELECT * FROM guardian_student_links
         WHERE guardian_user_id = ? AND student_user_id = ? AND verified = 1`
      )
      .get(guardianId, studentId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      guardianUserId: String(row.guardian_user_id),
      studentUserId: String(row.student_user_id),
      relationshipLabel: String(row.relationship_label || 'Parent / Guardian'),
      verified: Number(row.verified) === 1,
      consentGiven: Number(row.consent_given) === 1,
      canViewReports: Number(row.can_view_reports) === 1,
      canManageSchedule: Number(row.can_manage_schedule) === 1,
      canReceiveNotifications: Number(row.can_receive_notifications) === 1,
      studentCanEditSchedule: Number(row.student_can_edit_schedule) === 1,
      studentDailyMaxMinutes: Number(row.student_daily_max_minutes ?? 120),
      studentRescheduleWindowHours: Number(row.student_reschedule_window_hours ?? 24),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private getTeacherAssignedSubjects(teacherId: string): string[] {
    return this.academic.getTeacherAssignedSubjectIds(teacherId);
  }

  private teacherHasScopeForStudent(teacher: UserAccount, studentId: string): boolean {
    const assigned = this.getTeacherAssignedSubjects(teacher.id);
    if (assigned.length === 0) return false;
    const placeholders = assigned.map(() => '?').join(',');
    const attemptHit = this.db
      .prepare(
        `SELECT 1 FROM question_attempts WHERE student_id = ? AND subject_id IN (${placeholders}) LIMIT 1`
      )
      .get(studentId, ...assigned);
    if (attemptHit) return true;

    const activityHit = this.db
      .prepare(
        `SELECT 1 FROM session_activity_summaries WHERE student_id = ? AND subject_id IN (${placeholders}) LIMIT 1`
      )
      .get(studentId, ...assigned);
    if (activityHit) return true;

    const caseHit = this.db
      .prepare(
        `SELECT subject_scope_ids_json, assigned_to_user_id FROM wellbeing_cases WHERE student_id = ? AND is_safeguarding_restricted = 0`
      )
      .all(studentId) as { subject_scope_ids_json: string; assigned_to_user_id: string | null }[];
    for (const c of caseHit) {
      if (c.assigned_to_user_id === teacher.id) return true;
      const scope = parseJsonSafe<string[]>(c.subject_scope_ids_json, []);
      if (scope.some((s) => assigned.includes(s))) return true;
    }
    return false;
  }

  private assertCanViewStudentWellbeing(actor: UserAccount, studentId: string): void {
    if (actor.role === 'admin') return;
    if (actor.role === 'student') {
      if (actor.id !== studentId) {
        throw new HttpError(403, 'Students can only access their own study activity data.');
      }
      return;
    }
    if (actor.role === 'parent') {
      const link = this.isVerifiedGuardianOf(actor.id, studentId);
      if (!link) {
        throw new HttpError(403, 'Access denied: student is not linked to your guardian account.');
      }
      return;
    }
    if (actor.role === 'teacher') {
      if (!this.teacherHasScopeForStudent(actor, studentId)) {
        throw new HttpError(
          403,
          'Access denied: student has no active study records or cases within your assigned teacher subjects.'
        );
      }
      return;
    }
    throw new HttpError(403, 'Unauthorized role.');
  }

  private assertCanManageScheduleForStudent(actor: UserAccount, studentId: string): void {
    if (actor.role === 'admin') return;
    if (actor.role === 'parent') {
      const link = this.isVerifiedGuardianOf(actor.id, studentId);
      if (!link || !link.canManageSchedule) {
        throw new HttpError(403, 'Verified guardian scheduling permission is required.');
      }
      return;
    }
    if (actor.role === 'student') {
      if (actor.id !== studentId) {
        throw new HttpError(403, 'Cannot manage another student schedule.');
      }
      return;
    }
    throw new HttpError(403, 'Unauthorized to validate or manage student schedule.');
  }

  // =========================================================================
  // 1. RULE SETS & VERSIONED EDUCATIONAL GUIDELINES
  // =========================================================================

  private hydrateRuleVersion(row: Record<string, unknown>): WellbeingRuleVersion {
    return {
      id: String(row.id),
      ruleSetId: String(row.rule_set_id),
      versionNumber: Number(row.version_number),
      grade: String(row.grade || 'Grade 5'),
      subjectId: row.subject_id ? String(row.subject_id) : null,
      title: String(row.title),
      educationalStandardNote: String(row.educational_standard_note || ''),
      dailyWarningMinutes: Number(row.daily_warning_minutes),
      dailyMaxMinutes: Number(row.daily_max_minutes),
      weeklyWarningMinutes: Number(row.weekly_warning_minutes),
      weeklyMaxMinutes: Number(row.weekly_max_minutes),
      continuousSessionWarningMinutes: Number(row.continuous_session_warning_minutes),
      recommendedBreakMinutes: Number(row.recommended_break_minutes),
      breakIntervalMinutes: Number(row.break_interval_minutes),
      inactivityThresholdSeconds: Number(row.inactivity_threshold_seconds ?? 120),
      reminderFrequencyMinutes: Number(row.reminder_frequency_minutes ?? 35),
      warningSeverity: String(row.warning_severity || 'supportive_warning') as WellbeingRuleVersion['warningSeverity'],
      timedAssessmentBreakPolicy: String(
        row.timed_assessment_break_policy || 'warn_non_blocking_unless_paused'
      ) as WellbeingRuleVersion['timedAssessmentBreakPolicy'],
      staffReviewDailyExceedCount: Number(row.staff_review_daily_exceed_count ?? 2),
      staffReviewConsecutiveDays: Number(row.staff_review_consecutive_days ?? 3),
      escalationContinuousDays: Number(row.escalation_continuous_days ?? 5),
      effectiveFrom: String(row.effective_from),
      effectiveUntil: row.effective_until ? String(row.effective_until) : null,
      approvalStatus: String(row.approval_status) as WellbeingRuleApprovalStatus,
      createdByUserId: String(row.created_by_user_id),
      createdByName: String(row.created_by_name),
      approvedByAdminId: row.approved_by_admin_id ? String(row.approved_by_admin_id) : null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      changeNote: String(row.change_note || ''),
      createdAt: String(row.created_at),
    };
  }

  public getActiveRuleForGrade(grade = 'Grade 5', subjectId?: string | null): WellbeingRuleVersion {
    if (subjectId) {
      const subRow = this.db
        .prepare(
          `SELECT * FROM wellbeing_rule_versions
           WHERE grade = ? AND subject_id = ? AND approval_status = 'ACTIVE'
           ORDER BY effective_from DESC, version_number DESC LIMIT 1`
        )
        .get(grade, subjectId) as Record<string, unknown> | undefined;
      if (subRow) return this.hydrateRuleVersion(subRow);
    }

    const row = this.db
      .prepare(
        `SELECT * FROM wellbeing_rule_versions
         WHERE grade = ? AND subject_id IS NULL AND approval_status = 'ACTIVE'
         ORDER BY effective_from DESC, version_number DESC LIMIT 1`
      )
      .get(grade) as Record<string, unknown> | undefined;

    if (row) return this.hydrateRuleVersion(row);

    const fallbackRow = this.db
      .prepare(
        `SELECT * FROM wellbeing_rule_versions
         WHERE approval_status = 'ACTIVE'
         ORDER BY version_number DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;
    if (fallbackRow) return this.hydrateRuleVersion(fallbackRow);

    return {
      id: 'WBRV-FALLBACK',
      ruleSetId: 'WBR-G5-CORE',
      versionNumber: 1,
      grade: 'Grade 5',
      subjectId: null,
      title: 'Default Grade 5 Balanced Guideline',
      educationalStandardNote:
        'Educational pacing guideline; not a medical or clinical standard.',
      dailyWarningMinutes: 75,
      dailyMaxMinutes: 90,
      weeklyWarningMinutes: 360,
      weeklyMaxMinutes: 450,
      continuousSessionWarningMinutes: 35,
      recommendedBreakMinutes: 10,
      breakIntervalMinutes: 35,
      inactivityThresholdSeconds: 120,
      reminderFrequencyMinutes: 35,
      warningSeverity: 'supportive_warning',
      timedAssessmentBreakPolicy: 'warn_non_blocking_unless_paused',
      staffReviewDailyExceedCount: 2,
      staffReviewConsecutiveDays: 3,
      escalationContinuousDays: 5,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveUntil: null,
      approvalStatus: 'ACTIVE',
      createdByUserId: 'usr-admin-1',
      createdByName: 'System Default',
      approvedByAdminId: 'usr-admin-1',
      approvedAt: '2026-01-01T00:00:00.000Z',
      changeNote: 'Fallback',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
  }

  public listWellbeingRuleSets(actor: UserAccount): WellbeingRuleSet[] {
    const sets = this.db
      .prepare('SELECT * FROM wellbeing_rule_sets ORDER BY is_platform_wide DESC, updated_at DESC')
      .all() as Record<string, unknown>[];

    const assigned =
      actor.role === 'teacher' ? this.getTeacherAssignedSubjects(actor.id) : [];

    return sets
      .filter((s) => {
        if (actor.role === 'admin') return true;
        const subId = s.subject_id ? String(s.subject_id) : null;
        if (actor.role === 'teacher') {
          return !subId || assigned.includes(subId);
        }
        // students/parents see active platform-wide or subject guidelines
        return Boolean(s.current_active_version_id);
      })
      .map((s) => {
        const versionsRows = this.db
          .prepare(
            'SELECT * FROM wellbeing_rule_versions WHERE rule_set_id = ? ORDER BY version_number DESC'
          )
          .all(String(s.id)) as Record<string, unknown>[];
        return {
          id: String(s.id),
          title: String(s.title),
          grade: String(s.grade || 'Grade 5'),
          subjectId: s.subject_id ? String(s.subject_id) : null,
          isPlatformWide: Number(s.is_platform_wide) === 1,
          currentActiveVersionId: s.current_active_version_id
            ? String(s.current_active_version_id)
            : null,
          createdByUserId: String(s.created_by_user_id),
          createdAt: String(s.created_at),
          updatedAt: String(s.updated_at),
          versions: versionsRows.map((v) => this.hydrateRuleVersion(v)),
        };
      });
  }

  public createOrProposeRule(
    actor: UserAccount,
    payload: {
      ruleSetId?: string;
      title: string;
      grade?: string;
      subjectId?: string | null;
      educationalStandardNote?: string;
      dailyWarningMinutes: number;
      dailyMaxMinutes: number;
      weeklyWarningMinutes: number;
      weeklyMaxMinutes: number;
      continuousSessionWarningMinutes: number;
      recommendedBreakMinutes: number;
      breakIntervalMinutes: number;
      inactivityThresholdSeconds?: number;
      reminderFrequencyMinutes?: number;
      timedAssessmentBreakPolicy?: WellbeingRuleVersion['timedAssessmentBreakPolicy'];
      staffReviewDailyExceedCount?: number;
      staffReviewConsecutiveDays?: number;
      escalationContinuousDays?: number;
      effectiveFrom?: string;
      changeNote?: string;
      activateImmediately?: boolean;
    }
  ): { ruleSetId: string; version: WellbeingRuleVersion } {
    if (actor.role !== 'admin' && actor.role !== 'teacher') {
      throw new HttpError(403, 'Only administrators or authorized teachers can configure wellbeing rules.');
    }

    const cleanTitle = String(payload.title || '').trim();
    if (!cleanTitle) {
      throw new HttpError(400, 'Rule title is required.');
    }

    const subjectId = payload.subjectId ? String(payload.subjectId).trim() : null;
    if (actor.role === 'teacher') {
      if (subjectId) {
        const assigned = this.getTeacherAssignedSubjects(actor.id);
        if (!assigned.includes(subjectId)) {
          throw new HttpError(
            403,
            'Access denied: teachers can only propose or manage wellbeing rules for assigned subjects.'
          );
        }
      } else if (payload.activateImmediately) {
        throw new HttpError(
          403,
          'Platform-wide wellbeing rules require administrator approval before activation.'
        );
      }
    }

    const canDirectlyActivate =
      actor.role === 'admin' ||
      (actor.role === 'teacher' &&
        Boolean(subjectId) &&
        (actor.delegatedPublishSubjects || []).includes(subjectId!) &&
        Boolean(payload.activateImmediately));

    if (payload.activateImmediately && !canDirectlyActivate) {
      throw new HttpError(
        403,
        'Platform-wide wellbeing policy changes require administrator approval.'
      );
    }

    const dailyWarning = Math.max(15, Math.min(300, Number(payload.dailyWarningMinutes || 75)));
    const dailyMax = Math.max(dailyWarning, Math.min(360, Number(payload.dailyMaxMinutes || 90)));
    const weeklyWarning = Math.max(dailyWarning, Math.min(1800, Number(payload.weeklyWarningMinutes || 360)));
    const weeklyMax = Math.max(weeklyWarning, Math.min(2100, Number(payload.weeklyMaxMinutes || 450)));
    const continuousWarn = Math.max(10, Math.min(180, Number(payload.continuousSessionWarningMinutes || 35)));
    const breakMin = Math.max(3, Math.min(60, Number(payload.recommendedBreakMinutes || 10)));
    const breakInterval = Math.max(10, Math.min(120, Number(payload.breakIntervalMinutes || 35)));
    const inactivitySec = Math.max(30, Math.min(600, Number(payload.inactivityThresholdSeconds || 120)));
    const reminderFreq = Math.max(10, Math.min(120, Number(payload.reminderFrequencyMinutes || continuousWarn)));

    const now = new Date().toISOString();
    const grade = String(payload.grade || 'Grade 5');
    const ruleSetId =
      payload.ruleSetId ||
      `WBR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const versionId = `WBRV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const eduNote = String(
      payload.educationalStandardNote ||
        'Educational study-balance guideline for Sri Lankan Grade 5 learners; not a clinical or medical standard.'
    ).trim();

    this.dbWrapper.transaction(() => {
      const existingSet = this.db
        .prepare('SELECT * FROM wellbeing_rule_sets WHERE id = ?')
        .get(ruleSetId) as Record<string, unknown> | undefined;

      let nextVersionNum = 1;
      if (!existingSet) {
        this.db
          .prepare(
            `INSERT INTO wellbeing_rule_sets (
              id, title, grade, subject_id, is_platform_wide, current_active_version_id, created_by_user_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`
          )
          .run(ruleSetId, cleanTitle, grade, subjectId, subjectId ? 0 : 1, actor.id, now, now);
      } else {
        if (actor.role === 'teacher' && Number(existingSet.is_platform_wide) === 1 && payload.activateImmediately) {
          throw new HttpError(403, 'Teachers cannot directly activate platform-wide rule versions.');
        }
        const maxVer = this.db
          .prepare('SELECT COALESCE(MAX(version_number), 0) as mv FROM wellbeing_rule_versions WHERE rule_set_id = ?')
          .get(ruleSetId) as { mv: number };
        nextVersionNum = Number(maxVer.mv || 0) + 1;
      }

      const status: WellbeingRuleApprovalStatus = canDirectlyActivate && payload.activateImmediately !== false
        ? 'ACTIVE'
        : 'PENDING_REVIEW';

      if (status === 'ACTIVE') {
        this.db
          .prepare(
            `UPDATE wellbeing_rule_versions
             SET approval_status = 'ARCHIVED', effective_until = COALESCE(effective_until, ?)
             WHERE rule_set_id = ? AND approval_status = 'ACTIVE'`
          )
          .run(now, ruleSetId);
      }

      this.db
        .prepare(
          `INSERT INTO wellbeing_rule_versions (
            id, rule_set_id, version_number, grade, subject_id, title, educational_standard_note,
            daily_warning_minutes, daily_max_minutes, weekly_warning_minutes, weekly_max_minutes,
            continuous_session_warning_minutes, recommended_break_minutes, break_interval_minutes,
            inactivity_threshold_seconds, reminder_frequency_minutes, warning_severity,
            timed_assessment_break_policy, staff_review_daily_exceed_count, staff_review_consecutive_days,
            escalation_continuous_days, effective_from, effective_until, approval_status,
            created_by_user_id, created_by_name, approved_by_admin_id, approved_at, change_note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'supportive_warning', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          versionId,
          ruleSetId,
          nextVersionNum,
          grade,
          subjectId,
          cleanTitle,
          eduNote,
          dailyWarning,
          dailyMax,
          weeklyWarning,
          weeklyMax,
          continuousWarn,
          breakMin,
          breakInterval,
          inactivitySec,
          reminderFreq,
          payload.timedAssessmentBreakPolicy || 'warn_non_blocking_unless_paused',
          Math.max(1, Number(payload.staffReviewDailyExceedCount || 2)),
          Math.max(1, Number(payload.staffReviewConsecutiveDays || 3)),
          Math.max(2, Number(payload.escalationContinuousDays || 5)),
          payload.effectiveFrom || now,
          status,
          actor.id,
          actor.name,
          status === 'ACTIVE' ? actor.id : null,
          status === 'ACTIVE' ? now : null,
          String(payload.changeNote || 'Updated wellbeing guideline'),
          now
        );

      if (status === 'ACTIVE') {
        this.db
          .prepare(
            `UPDATE wellbeing_rule_sets SET current_active_version_id = ?, title = ?, updated_at = ? WHERE id = ?`
          )
          .run(versionId, cleanTitle, now, ruleSetId);
      }
    });

    this.academic.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: canDirectlyActivate && payload.activateImmediately !== false
        ? 'WELLBEING_RULE_ACTIVATED'
        : 'WELLBEING_RULE_PROPOSED',
      targetType: 'wellbeing_rule_version',
      targetId: versionId,
      details: { ruleSetId, subjectId, dailyWarning, dailyMax, continuousWarn },
    });

    const row = this.db
      .prepare('SELECT * FROM wellbeing_rule_versions WHERE id = ?')
      .get(versionId) as Record<string, unknown>;
    return { ruleSetId, version: this.hydrateRuleVersion(row) };
  }

  public approveWellbeingRuleVersion(
    admin: UserAccount,
    versionId: string
  ): WellbeingRuleVersion {
    if (admin.role !== 'admin') {
      throw new HttpError(403, 'Administrator approval is required to activate platform-wide wellbeing guidelines.');
    }
    const row = this.db
      .prepare('SELECT * FROM wellbeing_rule_versions WHERE id = ?')
      .get(versionId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Wellbeing rule version not found.');

    const ruleSetId = String(row.rule_set_id);
    const now = new Date().toISOString();

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE wellbeing_rule_versions
           SET approval_status = 'ARCHIVED', effective_until = COALESCE(effective_until, ?)
           WHERE rule_set_id = ? AND approval_status = 'ACTIVE'`
        )
        .run(now, ruleSetId);

      this.db
        .prepare(
          `UPDATE wellbeing_rule_versions
           SET approval_status = 'ACTIVE', approved_by_admin_id = ?, approved_at = ?
           WHERE id = ?`
        )
        .run(admin.id, now, versionId);

      this.db
        .prepare(
          `UPDATE wellbeing_rule_sets SET current_active_version_id = ?, updated_at = ? WHERE id = ?`
        )
        .run(versionId, now, ruleSetId);
    });

    this.academic.writeAuditLog({
      actorId: admin.id,
      actorName: admin.name,
      actorRole: admin.role,
      action: 'WELLBEING_RULE_APPROVED',
      targetType: 'wellbeing_rule_version',
      targetId: versionId,
      details: { ruleSetId },
    });

    const updated = this.db
      .prepare('SELECT * FROM wellbeing_rule_versions WHERE id = ?')
      .get(versionId) as Record<string, unknown>;
    return this.hydrateRuleVersion(updated);
  }

  // =========================================================================
  // 2. PRIVACY-PRESERVING STUDY ACTIVITY TRACKING & ANALYTICS
  // =========================================================================

  public ingestActivityEvents(
    actor: UserAccount,
    rawEvents: StudyActivityEventInput[]
  ): {
    acceptedCount: number;
    deduplicatedCount: number;
    summaries: SessionActivitySummary[];
    liveBreakReminder: {
      shouldSuggestBreak: boolean;
      continuousMinutes: number;
      recommendedBreakMinutes: number;
      timedAssessmentPolicy: WellbeingRuleVersion['timedAssessmentBreakPolicy'];
      message: string;
    } | null;
  } {
    if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
      throw new HttpError(400, 'At least one study activity event is required.');
    }

    for (const rawEv of rawEvents) {
      const prohibited = detectProhibitedSurveillancePayload(rawEv);
      if (prohibited.length > 0) {
        this.academic.writeAuditLog({
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          action: 'PROHIBITED_SURVEILLANCE_REJECTED',
          targetType: 'study_activity_event',
          targetId: actor.id,
          details: { prohibitedFields: prohibited },
        });
        throw new HttpError(
          400,
          `Privacy guard rejected prohibited surveillance field(s): ${prohibited.join(', ')}. Only privacy-preserving study interaction metadata is permitted.`
        );
      }
    }

    const now = new Date().toISOString();
    const rule = this.getActiveRuleForGrade(actor.grade || 'Grade 5');
    let acceptedCount = 0;
    let deduplicatedCount = 0;
    const touchedSessionKeys = new Set<string>();

    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO study_activity_events (
        id, user_id, idempotency_key, session_key, event_type, occurred_at, server_received_at,
        context_mode, device_id, tab_id, assessment_id, scheduled_session_id, paper_id, subject_id, question_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.dbWrapper.transaction(() => {
      for (const ev of rawEvents) {
        const sessionKey = String(ev.sessionKey || '').trim();
        const idempKey = String(ev.idempotencyKey || '').trim();
        if (!sessionKey || !idempKey) continue;
        touchedSessionKeys.add(sessionKey);

        const occurredAt =
          ev.occurredAt && Number.isFinite(Date.parse(ev.occurredAt))
            ? new Date(ev.occurredAt).toISOString()
            : now;
        const result = ins.run(
          `SAE-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          actor.id,
          idempKey,
          sessionKey,
          ev.eventType,
          occurredAt,
          now,
          ev.contextMode || 'practice',
          String(ev.deviceId || 'web-default').slice(0, 64),
          String(ev.tabId || 'tab-default').slice(0, 64),
          ev.assessmentId ? String(ev.assessmentId) : null,
          ev.scheduledSessionId ? String(ev.scheduledSessionId) : null,
          ev.paperId ? String(ev.paperId) : null,
          ev.subjectId ? String(ev.subjectId) : null,
          ev.questionId ? String(ev.questionId) : null
        );
        if (result.changes > 0) acceptedCount++;
        else deduplicatedCount++;
      }
    });

    const summaries: SessionActivitySummary[] = [];
    let maxContinuousPeakSec = 0;
    let liveContext: StudyActivityContextMode = 'practice';

    for (const sk of touchedSessionKeys) {
      const evRows = this.db
        .prepare(
          `SELECT * FROM study_activity_events WHERE user_id = ? AND session_key = ? ORDER BY occurred_at ASC`
        )
        .all(actor.id, sk) as Record<string, unknown>[];
      const records: StudyActivityEventRecord[] = evRows.map((r) => ({
        id: String(r.id),
        userId: String(r.user_id),
        idempotencyKey: String(r.idempotency_key),
        sessionKey: String(r.session_key),
        eventType: String(r.event_type) as StudyActivityEventRecord['eventType'],
        occurredAt: String(r.occurred_at),
        serverReceivedAt: String(r.server_received_at),
        contextMode: String(r.context_mode) as StudyActivityContextMode,
        deviceId: String(r.device_id),
        tabId: String(r.tab_id),
        assessmentId: r.assessment_id ? String(r.assessment_id) : null,
        scheduledSessionId: r.scheduled_session_id ? String(r.scheduled_session_id) : null,
        paperId: r.paper_id ? String(r.paper_id) : null,
        subjectId: r.subject_id ? String(r.subject_id) : null,
        questionId: r.question_id ? String(r.question_id) : null,
      }));
      if (records.length === 0) continue;

      let scheduledSec = 0;
      const schedId = records.find((r) => r.scheduledSessionId)?.scheduledSessionId;
      if (schedId) {
        const ssRow = this.db
          .prepare('SELECT duration_minutes FROM scheduled_sessions WHERE id = ?')
          .get(schedId) as { duration_minutes: number } | undefined;
        if (ssRow) scheduledSec = Number(ssRow.duration_minutes) * 60;
      }

      const summary = summarizeSingleSession({
        sessionKey: sk,
        studentId: actor.id,
        events: records,
        scheduledDurationSeconds: scheduledSec,
        inactivityThresholdSeconds: rule.inactivityThresholdSeconds,
      });

      this.db
        .prepare(
          `INSERT INTO session_activity_summaries (
            session_key, student_id, context_mode, assessment_id, scheduled_session_id, paper_id, subject_id,
            started_at, ended_at, scheduled_duration_seconds, open_duration_seconds, active_duration_seconds,
            idle_duration_seconds, background_duration_seconds, break_total_seconds, break_count,
            continuous_peak_seconds, interruption_count, device_count, tab_count, inactivity_threshold_seconds,
            uncertainty_note, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_key) DO UPDATE SET
            ended_at = excluded.ended_at,
            scheduled_duration_seconds = MAX(session_activity_summaries.scheduled_duration_seconds, excluded.scheduled_duration_seconds),
            open_duration_seconds = excluded.open_duration_seconds,
            active_duration_seconds = excluded.active_duration_seconds,
            idle_duration_seconds = excluded.idle_duration_seconds,
            background_duration_seconds = excluded.background_duration_seconds,
            break_total_seconds = excluded.break_total_seconds,
            break_count = excluded.break_count,
            continuous_peak_seconds = excluded.continuous_peak_seconds,
            interruption_count = excluded.interruption_count,
            device_count = excluded.device_count,
            tab_count = excluded.tab_count,
            inactivity_threshold_seconds = excluded.inactivity_threshold_seconds,
            uncertainty_note = excluded.uncertainty_note,
            updated_at = excluded.updated_at`
        )
        .run(
          summary.sessionKey,
          summary.studentId,
          summary.contextMode,
          summary.assessmentId,
          summary.scheduledSessionId,
          summary.paperId,
          summary.subjectId,
          summary.startedAt,
          summary.endedAt,
          summary.scheduledDurationSeconds,
          summary.openDurationSeconds,
          summary.activeDurationSeconds,
          summary.idleDurationSeconds,
          summary.backgroundDurationSeconds,
          summary.breakTotalSeconds,
          summary.breakCount,
          summary.continuousPeakSeconds,
          summary.interruptionCount,
          summary.deviceCount,
          summary.tabCount,
          summary.inactivityThresholdSeconds,
          summary.uncertaintyNote,
          summary.updatedAt
        );

      summaries.push(summary);
      liveContext = summary.contextMode;
      if (summary.continuousPeakSeconds > maxContinuousPeakSec) {
        maxContinuousPeakSec = summary.continuousPeakSeconds;
      }
    }

    const continuousMin = Math.round(maxContinuousPeakSec / 60);
    const shouldRemind = continuousMin >= rule.continuousSessionWarningMinutes;
    const liveBreakReminder = shouldRemind
      ? {
          shouldSuggestBreak: true,
          continuousMinutes: continuousMin,
          recommendedBreakMinutes: rule.recommendedBreakMinutes,
          timedAssessmentPolicy: rule.timedAssessmentBreakPolicy,
          message:
            liveContext === 'timed_exam' &&
            rule.timedAssessmentBreakPolicy !== 'strict_no_interrupt_until_submit'
              ? `Great focus for ${continuousMin} minutes! When you reach a calm stopping point, consider taking a quick ${rule.recommendedBreakMinutes}-minute stretch or water break.`
              : `You have focused steadily for ${continuousMin} minutes. Taking a ${rule.recommendedBreakMinutes}-minute eye & water break helps keep your mind fresh!`,
        }
      : null;

    return { acceptedCount, deduplicatedCount, summaries, liveBreakReminder };
  }

  public getStudentStudyTimeAnalytics(
    actor: UserAccount,
    studentId: string,
    days = 7
  ): StudentStudyTimeAnalytics {
    this.assertCanViewStudentWellbeing(actor, studentId);
    const student = this.academic.getUserById(studentId);
    if (!student) throw new HttpError(404, 'Student not found.');

    const rule = this.getActiveRuleForGrade(student.grade || 'Grade 5');
    const clampedDays = Math.max(1, Math.min(30, days));
    const nowDate = new Date();
    const dates: string[] = [];
    for (let i = clampedDays - 1; i >= 0; i--) {
      const d = new Date(nowDate.getTime() - i * 86_400_000);
      dates.push(d.toISOString().slice(0, 10));
    }
    const startIso = `${dates[0]}T00:00:00.000Z`;
    const endIso = `${dates[dates.length - 1]}T23:59:59.999Z`;

    const summaryRows = this.db
      .prepare(
        `SELECT * FROM session_activity_summaries
         WHERE student_id = ? AND started_at >= ? AND started_at <= ?
         ORDER BY started_at DESC`
      )
      .all(studentId, startIso, endIso) as Record<string, unknown>[];

    const schedRows = this.db
      .prepare(
        `SELECT scheduled_start_utc, duration_minutes FROM scheduled_sessions
         WHERE student_id = ? AND status != 'CANCELLED' AND scheduled_start_utc >= ? AND scheduled_start_utc <= ?`
      )
      .all(studentId, startIso, endIso) as { scheduled_start_utc: string; duration_minutes: number }[];

    const byDate = new Map<string, DailyStudyBreakdownPoint>();
    for (const d of dates) {
      byDate.set(d, {
        date: d,
        scheduledMinutes: 0,
        openMinutes: 0,
        activeMinutes: 0,
        idleMinutes: 0,
        backgroundMinutes: 0,
        breakMinutes: 0,
        practiceActiveMinutes: 0,
        mockExamActiveMinutes: 0,
        continuousPeakMinutes: 0,
        sessionsCount: 0,
      });
    }

    for (const sr of schedRows) {
      const d = String(sr.scheduled_start_utc).slice(0, 10);
      const pt = byDate.get(d);
      if (pt) pt.scheduledMinutes += Number(sr.duration_minutes || 0);
    }

    const recentSessions: SessionActivitySummary[] = [];
    for (const r of summaryRows) {
      const sess: SessionActivitySummary = {
        sessionKey: String(r.session_key),
        studentId: String(r.student_id),
        contextMode: String(r.context_mode) as StudyActivityContextMode,
        assessmentId: r.assessment_id ? String(r.assessment_id) : null,
        scheduledSessionId: r.scheduled_session_id ? String(r.scheduled_session_id) : null,
        paperId: r.paper_id ? String(r.paper_id) : null,
        subjectId: r.subject_id ? String(r.subject_id) : null,
        startedAt: String(r.started_at),
        endedAt: String(r.ended_at),
        scheduledDurationSeconds: Number(r.scheduled_duration_seconds ?? 0),
        openDurationSeconds: Number(r.open_duration_seconds ?? 0),
        activeDurationSeconds: Number(r.active_duration_seconds ?? 0),
        idleDurationSeconds: Number(r.idle_duration_seconds ?? 0),
        backgroundDurationSeconds: Number(r.background_duration_seconds ?? 0),
        breakTotalSeconds: Number(r.break_total_seconds ?? 0),
        breakCount: Number(r.break_count ?? 0),
        continuousPeakSeconds: Number(r.continuous_peak_seconds ?? 0),
        interruptionCount: Number(r.interruption_count ?? 0),
        deviceCount: Number(r.device_count ?? 1),
        tabCount: Number(r.tab_count ?? 1),
        inactivityThresholdSeconds: Number(r.inactivity_threshold_seconds ?? 120),
        uncertaintyNote: String(r.uncertainty_note || ''),
        updatedAt: String(r.updated_at),
      };
      recentSessions.push(sess);

      const d = sess.startedAt.slice(0, 10);
      const pt = byDate.get(d);
      if (pt) {
        pt.openMinutes += Math.round(sess.openDurationSeconds / 60);
        const activeM = Math.round(sess.activeDurationSeconds / 60);
        pt.activeMinutes += activeM;
        pt.idleMinutes += Math.round(sess.idleDurationSeconds / 60);
        pt.backgroundMinutes += Math.round(sess.backgroundDurationSeconds / 60);
        pt.breakMinutes += Math.round(sess.breakTotalSeconds / 60);
        if (sess.contextMode === 'timed_exam') {
          pt.mockExamActiveMinutes += activeM;
        } else {
          pt.practiceActiveMinutes += activeM;
        }
        pt.continuousPeakMinutes = Math.max(
          pt.continuousPeakMinutes,
          Math.round(sess.continuousPeakSeconds / 60)
        );
        pt.sessionsCount += 1;
      }
    }

    const dailySeries = dates.map((d) => byDate.get(d)!);
    const todaySummary = dailySeries[dailySeries.length - 1];
    const weeklyTotals = {
      scheduledMinutes: dailySeries.reduce((s, d) => s + d.scheduledMinutes, 0),
      openMinutes: dailySeries.reduce((s, d) => s + d.openMinutes, 0),
      activeMinutes: dailySeries.reduce((s, d) => s + d.activeMinutes, 0),
      idleMinutes: dailySeries.reduce((s, d) => s + d.idleMinutes, 0),
      backgroundMinutes: dailySeries.reduce((s, d) => s + d.backgroundMinutes, 0),
      breakMinutes: dailySeries.reduce((s, d) => s + d.breakMinutes, 0),
      practiceActiveMinutes: dailySeries.reduce((s, d) => s + d.practiceActiveMinutes, 0),
      mockExamActiveMinutes: dailySeries.reduce((s, d) => s + d.mockExamActiveMinutes, 0),
      maxContinuousSessionMinutes: dailySeries.reduce(
        (m, d) => Math.max(m, d.continuousPeakMinutes),
        0
      ),
      daysExceedingDailyGuideline: dailySeries.filter(
        (d) => Math.max(d.scheduledMinutes, d.activeMinutes) > rule.dailyMaxMinutes
      ).length,
    };

    return {
      studentId: student.id,
      studentName: student.name,
      grade: student.grade || 'Grade 5',
      timezone: 'Asia/Colombo',
      ruleVersionId: rule.id,
      ruleVersionLabel: `${rule.title} (v${rule.versionNumber})`,
      todaySummary,
      weeklyTotals,
      dailySeries,
      recentSessions: recentSessions.slice(0, 15),
      uncertaintyStatements: STANDARD_UNCERTAINTY_STATEMENTS,
      guidelineSummary: {
        dailyWarningMinutes: rule.dailyWarningMinutes,
        dailyMaxMinutes: rule.dailyMaxMinutes,
        weeklyWarningMinutes: rule.weeklyWarningMinutes,
        weeklyMaxMinutes: rule.weeklyMaxMinutes,
        continuousSessionWarningMinutes: rule.continuousSessionWarningMinutes,
        recommendedBreakMinutes: rule.recommendedBreakMinutes,
        breakIntervalMinutes: rule.breakIntervalMinutes,
        educationalStandardNote: rule.educationalStandardNote,
      },
    };
  }

  // =========================================================================
  // 3. PRE-SCHEDULE VALIDATION, SUPPORTIVE PARENT GUIDANCE & CASE TRIGGERING
  // =========================================================================

  private getExistingScheduledSessions(studentId: string): ScheduledSessionRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM scheduled_sessions WHERE student_id = ? AND status != 'CANCELLED'`)
      .all(studentId) as Record<string, unknown>[];
    return rows.map((r) => ({
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
  }

  public validatePreSchedule(
    actor: UserAccount,
    params: {
      studentId: string;
      proposedSlots: ProposedSessionSlot[];
      subjectIds?: string[];
    }
  ): PreScheduleWellbeingValidationResult {
    this.assertCanManageScheduleForStudent(actor, params.studentId);
    const student = this.academic.getUserById(params.studentId);
    if (!student) throw new HttpError(404, 'Student not found.');

    const rule = this.getActiveRuleForGrade(
      student.grade || 'Grade 5',
      params.subjectIds && params.subjectIds.length === 1 ? params.subjectIds[0] : null
    );
    const existingSessions = this.getExistingScheduledSessions(params.studentId);

    // Check recent active/scheduled excess days in the last 7 days
    const recentExcessRow = this.db
      .prepare(
        `SELECT COUNT(DISTINCT substr(started_at, 1, 10)) as cnt
         FROM session_activity_summaries
         WHERE student_id = ? AND started_at >= ?
         GROUP BY substr(started_at, 1, 10)
         HAVING SUM(active_duration_seconds) > ?`
      )
      .all(
        params.studentId,
        new Date(Date.now() - 7 * 86_400_000).toISOString(),
        rule.dailyMaxMinutes * 60
      ) as { cnt: number }[];

    return validateScheduleWellbeing({
      studentId: params.studentId,
      existingSessions,
      proposedSlots: params.proposedSlots,
      rule,
      recentExcessDaysCount: recentExcessRow.length,
    });
  }

  private dispatchParentWellbeingGuidance(params: {
    student: UserAccount;
    warning: WellbeingWarningRecord;
    rule: WellbeingRuleVersion;
  }): string[] {
    const { student, warning, rule } = params;
    const channels: string[] = [];
    const guardianLinks = this.db
      .prepare(
        `SELECT u.* FROM guardian_student_links g
         JOIN users u ON u.id = g.guardian_user_id
         WHERE g.student_user_id = ? AND g.verified = 1 AND g.consent_given = 1 AND g.can_receive_notifications = 1`
      )
      .all(student.id) as Record<string, unknown>[];

    const recipientUsers: {
      id: string;
      name: string;
      email: string;
      whatsappNumber: string;
      role: 'parent' | 'student';
      emailVerified: boolean;
      whatsappVerified: boolean;
      consentGiven: boolean;
      prefs: { inApp: boolean; email: boolean; whatsapp: boolean };
    }[] = guardianLinks.map((g) => ({
      id: String(g.id),
      name: String(g.name),
      email: String(g.email),
      whatsappNumber: String(g.whatsapp_number),
      role: 'parent',
      emailVerified: Number(g.email_verified ?? 1) === 1,
      whatsappVerified: Number(g.whatsapp_verified ?? 1) === 1,
      consentGiven: Number(g.guardian_consent_given ?? 1) === 1,
      prefs: parseJsonSafe(g.notification_preferences_json, {
        inApp: true,
        email: true,
        whatsapp: true,
      }),
    }));

    if (recipientUsers.length === 0 && student.guardianContactVerified && student.guardianConsentGiven) {
      recipientUsers.push({
        id: student.id,
        name: student.guardianName || 'Parent / Guardian',
        email: student.email,
        whatsappNumber: student.whatsappNumber,
        role: 'student',
        emailVerified: student.emailVerified,
        whatsappVerified: student.whatsappVerified ?? true,
        consentGiven: student.guardianConsentGiven ?? true,
        prefs: student.notificationPreferences || { inApp: true, email: true, whatsapp: true },
      });
    }

    const now = new Date().toISOString();
    const subjectLine = `${warning.supportiveTitle} · ${student.name} (Grade 5 Wellbeing Guide)`;
    const plainBody = [
      `Dear Parent / Guardian,`,
      '',
      `Here is a supportive study-balance tip for ${student.name}:`,
      '',
      warning.guidanceSummary,
      '',
      `Planned / Daily Snapshot: Scheduled ${warning.scheduledMinutes} min | Observed Active ${warning.observedActiveMinutes} min | Peak Continuous Focus ${warning.continuousMinutes} min.`,
      `Guideline Used: ${rule.title} (recommended ${rule.dailyMaxMinutes} min/day max, ${rule.recommendedBreakMinutes}-min break every ${rule.breakIntervalMinutes} min).`,
      '',
      `Helpful Ways to Balance:`,
      `- Include calm ${rule.recommendedBreakMinutes}-minute stretch, water, or outdoor breaks between study blocks.`,
      `- Spread practice across lighter weekdays rather than one heavy sitting.`,
      `- You can message ${student.name}'s subject teacher anytime if you would like tailored study pacing advice.`,
      '',
      `Note: ${rule.educationalStandardNote}`,
    ].join('\n');

    const { htmlBody, textBody } = buildEmailTextAndHtml({
      heading: warning.supportiveTitle,
      subheading: `Supportive Grade 5 Study Pacing Guidance for ${student.name}`,
      paragraphs: [
        warning.guidanceSummary,
        `Summary: Scheduled ${warning.scheduledMinutes} min · Observed Active ${warning.observedActiveMinutes} min · Continuous stretch ${warning.continuousMinutes} min.`,
        `Grade 5 Recommended Balance: Up to ${rule.dailyMaxMinutes} min/day with a ${rule.recommendedBreakMinutes}-minute rest break every ${rule.breakIntervalMinutes} minutes.`,
        `Need support adjusting topics? Feel free to coordinate with ${student.name}'s teachers via the Learning Portal.`,
      ],
      footerNote: rule.educationalStandardNote,
    });

    for (const r of recipientUsers) {
      if (r.prefs.inApp !== false) {
        const nid = `NTF-WBW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        this.db
          .prepare(
            `INSERT OR IGNORE INTO notifications (
              id, recipient_user_id, recipient_role, channel, category, title, body,
              related_case_id, related_student_id, related_subject_id, dedupe_key, delivery_status, retry_count, created_at
            ) VALUES (?, ?, ?, 'in_app', 'wellbeing_guidance', ?, ?, ?, ?, NULL, ?, 'delivered', 0, ?)`
          )
          .run(
            nid,
            r.id,
            r.role,
            warning.supportiveTitle,
            warning.guidanceSummary,
            warning.linkedCaseId,
            student.id,
            `wbw-${warning.id}-${r.id}-inapp`,
            now
          );
        if (!channels.includes('in_app')) channels.push('in_app');
      }

      if (r.prefs.email !== false && r.emailVerified && r.consentGiven) {
        this.academic.recordEmailLog({
          toEmail: r.email,
          subject: subjectLine,
          category: 'wellbeing_guidance',
          htmlBody,
          textBody: `${textBody}\n\n${plainBody}`,
        });
        if (!channels.includes('email')) channels.push('email');
      }

      if (r.prefs.whatsapp !== false && r.whatsappVerified && r.consentGiven && r.whatsappNumber) {
        this.academic.recordWhatsAppLog({
          toNumber: r.whatsappNumber,
          category: 'wellbeing_guidance',
          messageText: `🌿 *මං 5හේ Study Wellbeing Tip*\nStudent: ${student.name}\n${warning.guidanceSummary}\nTip: Add a ${rule.recommendedBreakMinutes}-min break every ${rule.breakIntervalMinutes} min. Reply or check the Parent Planner to adjust.`,
        });
        if (!channels.includes('whatsapp')) channels.push('whatsapp');
      }
    }

    this.db
      .prepare('UPDATE wellbeing_warnings SET notified_channels_json = ? WHERE id = ?')
      .run(JSON.stringify(channels), warning.id);

    return channels;
  }

  /**
   * Opens or updates an ongoing wellbeing review case without creating duplicate open cases
   * for the same student and ongoing concern key.
   */
  public openOrUpdateWellbeingCaseFromTrigger(params: {
    student: UserAccount;
    ongoingConcernKey: string;
    title: string;
    triggerCategory: string;
    summaryOfConcern: string;
    ruleVersionId: string;
    priority?: WellbeingCasePriority;
    subjectScopeIds?: string[];
    evidenceType?: WellbeingCaseEvidenceRecord['evidenceType'];
    evidenceReferenceId?: string;
    evidenceSummary?: string;
  }): WellbeingCaseRecord {
    const now = new Date().toISOString();
    const subjectIds = Array.from(new Set(params.subjectScopeIds || []));

    const existingRow = this.db
      .prepare(
        `SELECT * FROM wellbeing_cases
         WHERE ongoing_concern_key = ?
           AND status IN ('DETECTED','PENDING_REVIEW','UNDER_REVIEW','PARENT_CONTACTED','FOLLOW_UP','REOPENED')
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(params.ongoingConcernKey) as Record<string, unknown> | undefined;

    let caseId: string;
    if (existingRow) {
      caseId = String(existingRow.id);
      const mergedSubjects = Array.from(
        new Set([
          ...parseJsonSafe<string[]>(existingRow.subject_scope_ids_json, []),
          ...subjectIds,
        ])
      );
      this.db
        .prepare(
          `UPDATE wellbeing_cases
           SET summary_of_concern = ?, subject_scope_ids_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(params.summaryOfConcern, JSON.stringify(mergedSubjects), now, caseId);
    } else {
      caseId = `WBC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      // Auto-assign to matching subject teacher if scoped cleanly, otherwise leave for admin triage
      let assignedTeacher: { id: string; name: string } | null = null;
      if (subjectIds.length > 0) {
        const tRow = this.db
          .prepare(
            `SELECT u.id, u.name FROM teacher_subject_assignments tsa
             JOIN users u ON u.id = tsa.teacher_id
             WHERE tsa.subject_id = ? AND u.active = 1 LIMIT 1`
          )
          .get(subjectIds[0]) as { id: string; name: string } | undefined;
        if (tRow) assignedTeacher = tRow;
      }

      this.db
        .prepare(
          `INSERT INTO wellbeing_cases (
            id, student_id, student_name, student_grade, ongoing_concern_key, title, trigger_category,
            status, priority, rule_version_id, assigned_to_user_id, assigned_to_name,
            subject_scope_ids_json, is_safeguarding_restricted, summary_of_concern, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, 0, ?, ?, ?)`
        )
        .run(
          caseId,
          params.student.id,
          params.student.name,
          params.student.grade || 'Grade 5',
          params.ongoingConcernKey,
          params.title,
          params.triggerCategory,
          params.priority || 'medium',
          params.ruleVersionId,
          assignedTeacher?.id || null,
          assignedTeacher?.name || null,
          JSON.stringify(subjectIds),
          params.summaryOfConcern,
          now,
          now
        );

      this.db
        .prepare(
          `INSERT INTO wellbeing_case_notes (
            id, case_id, author_user_id, author_name, author_role, note_type,
            factual_observations, staff_interpretation, limitations_noted, version_number, created_at
          ) VALUES (?, ?, 'system', 'Wellbeing Pacing Monitor', 'system', 'system_detection', ?, '', ?, 1, ?)`
        )
        .run(
          `WCN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          caseId,
          params.summaryOfConcern,
          'Automated detection reflects configured Grade 5 educational thresholds only; schedule intensity does not imply harm or clinical diagnosis.',
          now
        );

      // Alert admins & scoped assigned teacher in-app
      const staffRecipients = new Set<string>();
      const admins = this.db
        .prepare(`SELECT id FROM users WHERE role = 'admin' AND active = 1`)
        .all() as { id: string }[];
      for (const a of admins) staffRecipients.add(a.id);
      if (assignedTeacher) staffRecipients.add(assignedTeacher.id);

      for (const staffId of staffRecipients) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO notifications (
              id, recipient_user_id, recipient_role, channel, category, title, body,
              related_case_id, related_student_id, related_subject_id, dedupe_key, delivery_status, retry_count, created_at
            ) VALUES (?, ?, ?, 'in_app', 'wellbeing_staff_alert', ?, ?, ?, ?, ?, ?, 'delivered', 0, ?)`
          )
          .run(
            `NTF-WB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            staffId,
            staffId === assignedTeacher?.id ? 'teacher' : 'admin',
            `Wellbeing Review Needed · ${params.student.name}`,
            params.summaryOfConcern,
            caseId,
            params.student.id,
            subjectIds[0] || null,
            `wb-case-${caseId}-${staffId}`,
            now
          );
      }
    }

    if (params.evidenceType && params.evidenceReferenceId) {
      this.db
        .prepare(
          `INSERT INTO wellbeing_case_evidence (
            id, case_id, evidence_type, reference_id, summary, snapshot_json, attached_by_user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, '{}', 'system', ?)`
        )
        .run(
          `WBE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          caseId,
          params.evidenceType,
          params.evidenceReferenceId,
          params.evidenceSummary || params.summaryOfConcern,
          now
        );
    }

    return this.getCaseRowHydrated(caseId)!;
  }

  public recordPreScheduleValidationDecision(
    actor: UserAccount,
    params: {
      studentId: string;
      validation: PreScheduleWellbeingValidationResult;
      decision: ParentScheduleDecision;
      decisionNotes?: string;
      subjectIds?: string[];
      timetableId?: string;
    }
  ): { warning: WellbeingWarningRecord | null; openedCase: WellbeingCaseRecord | null } {
    this.assertCanManageScheduleForStudent(actor, params.studentId);
    const { validation } = params;
    if (validation.severity === 'nominal') {
      return { warning: null, openedCase: null };
    }

    const student = this.academic.getUserById(params.studentId);
    if (!student) throw new HttpError(404, 'Student not found.');
    const rule = this.getActiveRuleForGrade(student.grade || 'Grade 5');
    const now = new Date().toISOString();

    let openedCase: WellbeingCaseRecord | null = null;
    if (validation.requiresStaffReview && params.decision !== 'cancelled') {
      openedCase = this.openOrUpdateWellbeingCaseFromTrigger({
        student,
        ongoingConcernKey: `${student.id}::schedule_load::${rule.ruleSetId}`,
        title: `Schedule Workload Balance Review · ${student.name}`,
        triggerCategory: 'excessive_scheduled_workload',
        summaryOfConcern: `${validation.exceededRules.join(' ')} Guardian decision recorded as "${params.decision}".`,
        ruleVersionId: validation.ruleVersionId,
        priority: validation.peakDailyCombinedMinutes >= rule.dailyMaxMinutes * 1.5 ? 'high' : 'medium',
        subjectScopeIds: params.subjectIds || [],
        evidenceType: params.timetableId ? 'timetable' : 'wellbeing_warning',
        evidenceReferenceId: params.timetableId || `PRE-${now}`,
        evidenceSummary: `Peak daily combined ${validation.peakDailyCombinedMinutes}m, continuous ${validation.peakContinuousMinutes}m`,
      });
    }

    const wid = `WBW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    this.db
      .prepare(
        `INSERT INTO wellbeing_warnings (
          id, student_id, guardian_user_id, trigger_source, rule_version_id, severity,
          scheduled_minutes, observed_active_minutes, continuous_minutes, supportive_title,
          guidance_summary, suggested_adjustment_json, parent_decision, parent_decision_notes,
          parent_decided_at, notified_channels_json, linked_case_id, created_at
        ) VALUES (?, ?, ?, 'pre_schedule', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
      )
      .run(
        wid,
        student.id,
        actor.role === 'parent' ? actor.id : null,
        validation.ruleVersionId,
        validation.severity,
        validation.peakDailyCombinedMinutes,
        validation.peakContinuousMinutes,
        validation.supportiveTitle,
        validation.supportiveMessage,
        JSON.stringify(validation.balancedSuggestions),
        params.decision,
        params.decisionNotes ? String(params.decisionNotes) : null,
        params.decision !== 'pending' ? now : null,
        openedCase?.id || null,
        now
      );

    const warning = this.getWarningById(wid)!;
    if (params.decision !== 'cancelled') {
      const channels = this.dispatchParentWellbeingGuidance({ student, warning, rule });
      warning.notifiedChannels = channels;
    }

    this.academic.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'PRE_SCHEDULE_WELLBEING_DECISION',
      targetType: 'wellbeing_warning',
      targetId: wid,
      details: {
        studentId: student.id,
        severity: validation.severity,
        decision: params.decision,
        linkedCaseId: openedCase?.id || null,
      },
    });

    return { warning, openedCase };
  }

  private hydrateWarningRow(r: Record<string, unknown>): WellbeingWarningRecord {
    return {
      id: String(r.id),
      studentId: String(r.student_id),
      guardianUserId: r.guardian_user_id ? String(r.guardian_user_id) : null,
      triggerSource: String(r.trigger_source) as WellbeingWarningRecord['triggerSource'],
      ruleVersionId: String(r.rule_version_id),
      severity: String(r.severity) as WellbeingWarningRecord['severity'],
      scheduledMinutes: Number(r.scheduled_minutes ?? 0),
      observedActiveMinutes: Number(r.observed_active_minutes ?? 0),
      continuousMinutes: Number(r.continuous_minutes ?? 0),
      supportiveTitle: String(r.supportive_title),
      guidanceSummary: String(r.guidance_summary),
      suggestedAdjustmentJson: String(r.suggested_adjustment_json || '[]'),
      parentDecision: String(r.parent_decision || 'pending') as ParentScheduleDecision,
      parentDecisionNotes: r.parent_decision_notes ? String(r.parent_decision_notes) : null,
      parentDecidedAt: r.parent_decided_at ? String(r.parent_decided_at) : null,
      notifiedChannels: parseJsonSafe<string[]>(r.notified_channels_json, []),
      linkedCaseId: r.linked_case_id ? String(r.linked_case_id) : null,
      createdAt: String(r.created_at),
    };
  }

  private getWarningById(id: string): WellbeingWarningRecord | null {
    const r = this.db
      .prepare('SELECT * FROM wellbeing_warnings WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return r ? this.hydrateWarningRow(r) : null;
  }

  public listStudentWarnings(actor: UserAccount, studentId: string): WellbeingWarningRecord[] {
    this.assertCanViewStudentWellbeing(actor, studentId);
    const rows = this.db
      .prepare('SELECT * FROM wellbeing_warnings WHERE student_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(studentId) as Record<string, unknown>[];
    return rows.map((r) => this.hydrateWarningRow(r));
  }

  public acknowledgeWarningDecision(
    actor: UserAccount,
    warningId: string,
    decision: ParentScheduleDecision,
    notes?: string
  ): WellbeingWarningRecord {
    const existing = this.getWarningById(warningId);
    if (!existing) throw new HttpError(404, 'Wellbeing warning not found.');
    this.assertCanManageScheduleForStudent(actor, existing.studentId);

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE wellbeing_warnings
         SET parent_decision = ?, parent_decision_notes = ?, parent_decided_at = ?
         WHERE id = ?`
      )
      .run(decision, notes ? String(notes).trim() : null, now, warningId);

    return this.getWarningById(warningId)!;
  }

  // =========================================================================
  // 4. WELLBEING CASE WORKFLOW, IMMUTABLE CONTACT NOTES & FOLLOW-UPS
  // =========================================================================

  private getCaseRowHydrated(caseId: string): WellbeingCaseRecord | null {
    const r = this.db
      .prepare('SELECT * FROM wellbeing_cases WHERE id = ?')
      .get(caseId) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      studentId: String(r.student_id),
      studentName: String(r.student_name),
      studentGrade: String(r.student_grade || 'Grade 5'),
      ongoingConcernKey: String(r.ongoing_concern_key),
      title: String(r.title),
      triggerCategory: String(r.trigger_category),
      status: String(r.status) as WellbeingCaseStatus,
      priority: String(r.priority) as WellbeingCasePriority,
      ruleVersionId: String(r.rule_version_id),
      assignedToUserId: r.assigned_to_user_id ? String(r.assigned_to_user_id) : null,
      assignedToName: r.assigned_to_name ? String(r.assigned_to_name) : null,
      subjectScopeIds: parseJsonSafe<string[]>(r.subject_scope_ids_json, []),
      isSafeguardingRestricted: Number(r.is_safeguarding_restricted ?? 0) === 1,
      dismissalReason: r.dismissal_reason ? String(r.dismissal_reason) : null,
      resolutionSummary: r.resolution_summary ? String(r.resolution_summary) : null,
      summaryOfConcern: String(r.summary_of_concern),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      closedAt: r.closed_at ? String(r.closed_at) : null,
    };
  }

  private assertCanAccessCase(actor: UserAccount, caseRec: WellbeingCaseRecord): void {
    if (caseRec.isSafeguardingRestricted) {
      this.assertSafeguardingPersonnel(actor);
    }
    if (actor.role === 'admin') return;
    if (actor.role !== 'teacher') {
      throw new HttpError(403, 'Staff case management access required.');
    }
    const assigned = this.getTeacherAssignedSubjects(actor.id);
    if (caseRec.assignedToUserId === actor.id) return;
    if (
      caseRec.subjectScopeIds.length > 0 &&
      caseRec.subjectScopeIds.some((s) => assigned.includes(s))
    ) {
      return;
    }
    if (caseRec.subjectScopeIds.length === 0 && this.teacherHasScopeForStudent(actor, caseRec.studentId)) {
      return;
    }
    throw new HttpError(
      403,
      'Access denied: this wellbeing case is outside your assigned subject permissions.'
    );
  }

  public listWellbeingCases(
    actor: UserAccount,
    filters: { status?: string; priority?: string; studentId?: string } = {}
  ): WellbeingCaseRecord[] {
    if (actor.role !== 'admin' && actor.role !== 'teacher') {
      throw new HttpError(403, 'Staff permissions required.');
    }
    const rows = this.db
      .prepare('SELECT * FROM wellbeing_cases ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[];

    const assigned =
      actor.role === 'teacher' ? this.getTeacherAssignedSubjects(actor.id) : [];

    return rows
      .map((r) => this.getCaseRowHydrated(String(r.id))!)
      .filter((c) => {
        if (c.isSafeguardingRestricted && !this.isDesignatedSafeguarding(actor)) return false;
        if (actor.role === 'teacher') {
          const ok =
            c.assignedToUserId === actor.id ||
            c.subjectScopeIds.some((s) => assigned.includes(s)) ||
            (c.subjectScopeIds.length === 0 &&
              this.teacherHasScopeForStudent(actor, c.studentId));
          if (!ok) return false;
        }
        if (filters.status && filters.status !== 'ALL' && c.status !== filters.status) return false;
        if (filters.priority && filters.priority !== 'ALL' && c.priority !== filters.priority) return false;
        if (filters.studentId && c.studentId !== filters.studentId) return false;
        return true;
      });
  }

  public getWellbeingCaseDetail(actor: UserAccount, caseId: string): WellbeingCaseDetail {
    const caseRec = this.getCaseRowHydrated(caseId);
    if (!caseRec) throw new HttpError(404, 'Wellbeing case not found.');
    this.assertCanAccessCase(actor, caseRec);

    const evidenceRows = this.db
      .prepare('SELECT * FROM wellbeing_case_evidence WHERE case_id = ? ORDER BY created_at DESC')
      .all(caseId) as Record<string, unknown>[];
    const noteRows = this.db
      .prepare('SELECT * FROM wellbeing_case_notes WHERE case_id = ? ORDER BY created_at DESC')
      .all(caseId) as Record<string, unknown>[];
    const contactRows = this.db
      .prepare(
        'SELECT * FROM parent_contact_records WHERE case_id = ? ORDER BY contact_at DESC, version_number DESC'
      )
      .all(caseId) as Record<string, unknown>[];
    const actionRows = this.db
      .prepare('SELECT * FROM wellbeing_followup_actions WHERE case_id = ? ORDER BY due_date ASC')
      .all(caseId) as Record<string, unknown>[];
    const assignRows = this.db
      .prepare('SELECT * FROM wellbeing_case_assignments WHERE case_id = ? ORDER BY created_at DESC')
      .all(caseId) as Record<string, unknown>[];
    const warnRows = this.db
      .prepare('SELECT * FROM wellbeing_warnings WHERE linked_case_id = ? OR student_id = ? ORDER BY created_at DESC LIMIT 10')
      .all(caseId, caseRec.studentId) as Record<string, unknown>[];

    return {
      caseRecord: caseRec,
      evidence: evidenceRows.map((r) => ({
        id: String(r.id),
        caseId: String(r.case_id),
        evidenceType: String(r.evidence_type) as WellbeingCaseEvidenceRecord['evidenceType'],
        referenceId: String(r.reference_id),
        summary: String(r.summary),
        snapshotJson: String(r.snapshot_json || '{}'),
        attachedByUserId: String(r.attached_by_user_id),
        createdAt: String(r.created_at),
      })),
      notes: noteRows.map((r) => ({
        id: String(r.id),
        caseId: String(r.case_id),
        authorUserId: String(r.author_user_id),
        authorName: String(r.author_name),
        authorRole: String(r.author_role) as WellbeingCaseNoteRecord['authorRole'],
        noteType: String(r.note_type) as WellbeingCaseNoteRecord['noteType'],
        factualObservations: String(r.factual_observations),
        staffInterpretation: String(r.staff_interpretation || ''),
        limitationsNoted: String(r.limitations_noted || ''),
        supersedesNoteId: r.supersedes_note_id ? String(r.supersedes_note_id) : null,
        versionNumber: Number(r.version_number ?? 1),
        createdAt: String(r.created_at),
      })),
      parentContacts: contactRows.map((r) => this.hydrateParentContactRow(r)),
      followUpActions: actionRows.map((r) => ({
        id: String(r.id),
        caseId: String(r.case_id),
        title: String(r.title),
        description: String(r.description || ''),
        ownerUserId: String(r.owner_user_id),
        ownerName: String(r.owner_name),
        dueDate: String(r.due_date),
        status: String(r.status) as WellbeingFollowupActionRecord['status'],
        completionNotes: r.completion_notes ? String(r.completion_notes) : null,
        completedAt: r.completed_at ? String(r.completed_at) : null,
        createdAt: String(r.created_at),
      })),
      assignments: assignRows.map((r) => ({
        id: String(r.id),
        assignedToUserId: String(r.assigned_to_user_id),
        assignedToName: String(r.assigned_to_name),
        assignedByUserId: String(r.assigned_by_user_id),
        assignedByName: String(r.assigned_by_name),
        reason: String(r.reason || ''),
        createdAt: String(r.created_at),
      })),
      relatedWarnings: warnRows.map((r) => this.hydrateWarningRow(r)),
      recentActivitySummary: this.getStudentStudyTimeAnalytics(actor, caseRec.studentId, 7),
    };
  }

  private hydrateParentContactRow(r: Record<string, unknown>): ParentContactRecord {
    return {
      id: String(r.id),
      noteGroupId: String(r.note_group_id),
      versionNumber: Number(r.version_number ?? 1),
      supersedesNoteId: r.supersedes_note_id ? String(r.supersedes_note_id) : null,
      amendmentReason: r.amendment_reason ? String(r.amendment_reason) : null,
      isFinalized: Number(r.is_finalized ?? 0) === 1,
      finalizedAt: r.finalized_at ? String(r.finalized_at) : null,
      caseId: String(r.case_id),
      studentId: String(r.student_id),
      guardianUserId: r.guardian_user_id ? String(r.guardian_user_id) : null,
      staffUserId: String(r.staff_user_id),
      staffName: String(r.staff_name),
      contactAt: String(r.contact_at),
      contactMethod: String(r.contact_method) as ParentContactRecord['contactMethod'],
      contactOutcome: String(r.contact_outcome) as ParentContactRecord['contactOutcome'],
      factualObservations: String(r.factual_observations),
      directQuotations: String(r.direct_quotations || ''),
      staffOpinions: String(r.staff_opinions || ''),
      guidanceProvided: String(r.guidance_provided),
      parentResponse: String(r.parent_response || ''),
      agreedActions: String(r.agreed_actions || ''),
      followUpDate: r.follow_up_date ? String(r.follow_up_date) : null,
      evidenceRefs: parseJsonSafe(r.evidence_refs_json, []),
      resultingCaseStatus: String(r.resulting_case_status) as WellbeingCaseStatus,
      createdAt: String(r.created_at),
    };
  }

  public assignWellbeingCase(
    admin: UserAccount,
    caseId: string,
    assignedToUserId: string,
    reason = ''
  ): WellbeingCaseRecord {
    if (admin.role !== 'admin') {
      throw new HttpError(403, 'Only administrators can assign or reassign wellbeing cases.');
    }
    const caseRec = this.getCaseRowHydrated(caseId);
    if (!caseRec) throw new HttpError(404, 'Wellbeing case not found.');
    const assignee = this.academic.getUserById(assignedToUserId);
    if (!assignee || (assignee.role !== 'teacher' && assignee.role !== 'admin')) {
      throw new HttpError(400, 'Assignee must be an active teacher or administrator.');
    }

    const now = new Date().toISOString();
    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE wellbeing_cases
           SET assigned_to_user_id = ?, assigned_to_name = ?,
               status = CASE WHEN status IN ('DETECTED','PENDING_REVIEW') THEN 'UNDER_REVIEW' ELSE status END,
               updated_at = ?
           WHERE id = ?`
        )
        .run(assignee.id, assignee.name, now, caseId);

      this.db
        .prepare(
          `INSERT INTO wellbeing_case_assignments (
            id, case_id, assigned_to_user_id, assigned_to_name, assigned_by_user_id, assigned_by_name, reason, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `WCA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          caseId,
          assignee.id,
          assignee.name,
          admin.id,
          admin.name,
          String(reason || 'Assigned for wellbeing follow-up'),
          now
        );
    });

    this.academic.writeAuditLog({
      actorId: admin.id,
      actorName: admin.name,
      actorRole: admin.role,
      action: 'WELLBEING_CASE_ASSIGNED',
      targetType: 'wellbeing_case',
      targetId: caseId,
      details: { assignedToUserId: assignee.id, assignedToName: assignee.name, reason },
    });

    return this.getCaseRowHydrated(caseId)!;
  }

  public transitionWellbeingCase(
    actor: UserAccount,
    caseId: string,
    payload: {
      nextStatus: WellbeingCaseStatus;
      factualObservations?: string;
      staffInterpretation?: string;
      limitationsNoted?: string;
      dismissalReason?: string;
      resolutionSummary?: string;
      priority?: WellbeingCasePriority;
    }
  ): WellbeingCaseRecord {
    const caseRec = this.getCaseRowHydrated(caseId);
    if (!caseRec) throw new HttpError(404, 'Wellbeing case not found.');
    this.assertCanAccessCase(actor, caseRec);

    const next = payload.nextStatus;
    if (next === 'REFERRED_SAFEGUARDING') {
      this.assertSafeguardingPersonnel(actor);
    }
    if (next === 'DISMISSED' && !String(payload.dismissalReason || '').trim()) {
      throw new HttpError(400, 'A dismissal reason is required before dismissing a wellbeing case.');
    }

    const now = new Date().toISOString();
    const isClosed = next === 'RESOLVED' || next === 'DISMISSED';
    const safeguardingFlag = next === 'REFERRED_SAFEGUARDING' ? 1 : caseRec.isSafeguardingRestricted ? 1 : 0;

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE wellbeing_cases
           SET status = ?,
               priority = COALESCE(?, priority),
               dismissal_reason = COALESCE(?, dismissal_reason),
               resolution_summary = COALESCE(?, resolution_summary),
               is_safeguarding_restricted = ?,
               closed_at = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(
          next,
          payload.priority || null,
          payload.dismissalReason ? String(payload.dismissalReason).trim() : null,
          payload.resolutionSummary ? String(payload.resolutionSummary).trim() : null,
          safeguardingFlag,
          isClosed ? now : null,
          now,
          caseId
        );

      const obs = String(payload.factualObservations || `Case status transitioned from ${caseRec.status} to ${next}.`).trim();
      this.db
        .prepare(
          `INSERT INTO wellbeing_case_notes (
            id, case_id, author_user_id, author_name, author_role, note_type,
            factual_observations, staff_interpretation, limitations_noted, version_number, created_at
          ) VALUES (?, ?, ?, ?, ?, 'staff_review', ?, ?, ?, 1, ?)`
        )
        .run(
          `WCN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          caseId,
          actor.id,
          actor.name,
          actor.role,
          obs,
          String(payload.staffInterpretation || '').trim(),
          String(payload.limitationsNoted || '').trim(),
          now
        );
    });

    this.academic.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'WELLBEING_CASE_TRANSITIONED',
      targetType: 'wellbeing_case',
      targetId: caseId,
      details: { fromStatus: caseRec.status, toStatus: next, dismissalReason: payload.dismissalReason },
    });

    return this.getCaseRowHydrated(caseId)!;
  }

  public createParentContactRecord(
    actor: UserAccount,
    caseId: string,
    payload: {
      contactAt?: string;
      contactMethod: ParentContactRecord['contactMethod'];
      contactOutcome: ParentContactRecord['contactOutcome'];
      factualObservations: string;
      directQuotations?: string;
      staffOpinions?: string;
      guidanceProvided: string;
      parentResponse?: string;
      agreedActions?: string;
      followUpDate?: string | null;
      evidenceRefs?: { type: string; id: string; label: string }[];
      resultingCaseStatus?: WellbeingCaseStatus;
      finalizeImmediately?: boolean;
      guardianUserId?: string | null;
    }
  ): ParentContactRecord {
    const caseRec = this.getCaseRowHydrated(caseId);
    if (!caseRec) throw new HttpError(404, 'Wellbeing case not found.');
    this.assertCanAccessCase(actor, caseRec);

    const factualObs = String(payload.factualObservations || '').trim();
    const guidance = String(payload.guidanceProvided || '').trim();
    if (!factualObs || !guidance) {
      throw new HttpError(400, 'Both factual observations and guidance provided are required.');
    }

    const now = new Date().toISOString();
    const id = `PCR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const noteGroupId = `PCG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const finalized = Boolean(payload.finalizeImmediately);
    const nextCaseStatus: WellbeingCaseStatus =
      payload.resultingCaseStatus && payload.resultingCaseStatus !== 'REFERRED_SAFEGUARDING'
        ? payload.resultingCaseStatus
        : 'PARENT_CONTACTED';

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO parent_contact_records (
            id, note_group_id, version_number, supersedes_note_id, amendment_reason, is_finalized, finalized_at,
            case_id, student_id, guardian_user_id, staff_user_id, staff_name, contact_at, contact_method,
            contact_outcome, factual_observations, direct_quotations, staff_opinions, guidance_provided,
            parent_response, agreed_actions, follow_up_date, evidence_refs_json, resulting_case_status, created_at
          ) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          noteGroupId,
          finalized ? 1 : 0,
          finalized ? now : null,
          caseId,
          caseRec.studentId,
          payload.guardianUserId || null,
          actor.id,
          actor.name,
          payload.contactAt || now,
          payload.contactMethod,
          payload.contactOutcome,
          factualObs,
          String(payload.directQuotations || '').trim(),
          String(payload.staffOpinions || '').trim(),
          guidance,
          String(payload.parentResponse || '').trim(),
          String(payload.agreedActions || '').trim(),
          payload.followUpDate || null,
          JSON.stringify(payload.evidenceRefs || []),
          nextCaseStatus,
          now
        );

      this.db
        .prepare(
          `UPDATE wellbeing_cases SET status = ?, updated_at = ? WHERE id = ?`
        )
        .run(nextCaseStatus, now, caseId);
    });

    this.academic.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: finalized ? 'PARENT_CONTACT_RECORDED_FINAL' : 'PARENT_CONTACT_RECORDED_DRAFT',
      targetType: 'parent_contact_record',
      targetId: id,
      details: { caseId, method: payload.contactMethod, outcome: payload.contactOutcome },
    });

    const row = this.db
      .prepare('SELECT * FROM parent_contact_records WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return this.hydrateParentContactRow(row);
  }

  /**
   * Prevents silent editing of finalized contact notes. Only unfinalized drafts can be edited
   * in place; finalized records MUST go through amendParentContactRecord().
   */
  public updateDraftParentContactRecord(
    actor: UserAccount,
    noteId: string,
    patch: Partial<{
      factualObservations: string;
      directQuotations: string;
      staffOpinions: string;
      guidanceProvided: string;
      parentResponse: string;
      agreedActions: string;
      followUpDate: string | null;
    }>
  ): ParentContactRecord {
    const existingRow = this.db
      .prepare('SELECT * FROM parent_contact_records WHERE id = ?')
      .get(noteId) as Record<string, unknown> | undefined;
    if (!existingRow) throw new HttpError(404, 'Parent contact record not found.');
    const existing = this.hydrateParentContactRow(existingRow);

    const caseRec = this.getCaseRowHydrated(existing.caseId);
    if (!caseRec) throw new HttpError(404, 'Wellbeing case not found.');
    this.assertCanAccessCase(actor, caseRec);

    if (existing.isFinalized) {
      throw new HttpError(
        409,
        'Finalized parent contact notes are immutable and cannot be edited or deleted. Create a versioned amendment instead.'
      );
    }

    this.db
      .prepare(
        `UPDATE parent_contact_records
         SET factual_observations = ?, direct_quotations = ?, staff_opinions = ?,
             guidance_provided = ?, parent_response = ?, agreed_actions = ?, follow_up_date = ?
         WHERE id = ?`
      )
      .run(
        patch.factualObservations !== undefined ? patch.factualObservations : existing.factualObservations,
        patch.directQuotations !== undefined ? patch.directQuotations : existing.directQuotations,
        patch.staffOpinions !== undefined ? patch.staffOpinions : existing.staffOpinions,
        patch.guidanceProvided !== undefined ? patch.guidanceProvided : existing.guidanceProvided,
        patch.parentResponse !== undefined ? patch.parentResponse : existing.parentResponse,
        patch.agreedActions !== undefined ? patch.agreedActions : existing.agreedActions,
        patch.followUpDate !== undefined ? patch.followUpDate : existing.followUpDate,
        noteId
      );

    const updated = this.db
      .prepare('SELECT * FROM parent_contact_records WHERE id = ?')
      .get(noteId) as Record<string, unknown>;
    return this.hydrateParentContactRow(updated);
  }

  public finalizeParentContactRecord(actor: UserAccount, noteId: string): ParentContactRecord {
    const existingRow = this.db
      .prepare('SELECT * FROM parent_contact_records WHERE id = ?')
      .get(noteId) as Record<string, unknown> | undefined;
    if (!existingRow) throw new HttpError(404, 'Parent contact record not found.');
    const existing = this.hydrateParentContactRow(existingRow);

    const caseRec = this.getCaseRowHydrated(existing.caseId);
    if (!caseRec) throw new HttpError(404, 'Wellbeing case not found.');
    this.assertCanAccessCase(actor, caseRec);

    if (existing.isFinalized) return existing;

    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE parent_contact_records SET is_finalized = 1, finalized_at = ? WHERE id = ?')
      .run(now, noteId);

    this.academic.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'PARENT_CONTACT_FINALIZED',
      targetType: 'parent_contact_record',
      targetId: noteId,
      details: { caseId: existing.caseId, versionNumber: existing.versionNumber },
    });

    const row = this.db
      .prepare('SELECT * FROM parent_contact_records WHERE id = ?')
      .get(noteId) as Record<string, unknown>;
    return this.hydrateParentContactRow(row);
  }

  public amendParentContactRecord(
    actor: UserAccount,
    priorNoteId: string,
    payload: {
      amendmentReason: string;
      factualObservations: string;
      directQuotations?: string;
      staffOpinions?: string;
      guidanceProvided: string;
      parentResponse?: string;
      agreedActions?: string;
      followUpDate?: string | null;
    }
  ): ParentContactRecord {
    const priorRow = this.db
      .prepare('SELECT * FROM parent_contact_records WHERE id = ?')
      .get(priorNoteId) as Record<string, unknown> | undefined;
    if (!priorRow) throw new HttpError(404, 'Original parent contact record not found.');
    const prior = this.hydrateParentContactRow(priorRow);

    const caseRec = this.getCaseRowHydrated(prior.caseId);
    if (!caseRec) throw new HttpError(404, 'Wellbeing case not found.');
    this.assertCanAccessCase(actor, caseRec);

    const reason = String(payload.amendmentReason || '').trim();
    if (!reason) {
      throw new HttpError(400, 'An amendment reason is required when correcting a contact note.');
    }

    const maxVer = this.db
      .prepare(
        'SELECT COALESCE(MAX(version_number), 1) as mv FROM parent_contact_records WHERE note_group_id = ?'
      )
      .get(prior.noteGroupId) as { mv: number };
    const nextVer = Number(maxVer.mv || 1) + 1;
    const now = new Date().toISOString();
    const newId = `PCR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    this.db
      .prepare(
        `INSERT INTO parent_contact_records (
          id, note_group_id, version_number, supersedes_note_id, amendment_reason, is_finalized, finalized_at,
          case_id, student_id, guardian_user_id, staff_user_id, staff_name, contact_at, contact_method,
          contact_outcome, factual_observations, direct_quotations, staff_opinions, guidance_provided,
          parent_response, agreed_actions, follow_up_date, evidence_refs_json, resulting_case_status, created_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId,
        prior.noteGroupId,
        nextVer,
        prior.id,
        reason,
        now,
        prior.caseId,
        prior.studentId,
        prior.guardianUserId,
        actor.id,
        actor.name,
        prior.contactAt,
        prior.contactMethod,
        prior.contactOutcome,
        String(payload.factualObservations || prior.factualObservations).trim(),
        String(payload.directQuotations ?? prior.directQuotations).trim(),
        String(payload.staffOpinions ?? prior.staffOpinions).trim(),
        String(payload.guidanceProvided || prior.guidanceProvided).trim(),
        String(payload.parentResponse ?? prior.parentResponse).trim(),
        String(payload.agreedActions ?? prior.agreedActions).trim(),
        payload.followUpDate !== undefined ? payload.followUpDate : prior.followUpDate,
        JSON.stringify(prior.evidenceRefs),
        prior.resultingCaseStatus,
        now
      );

    this.academic.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'PARENT_CONTACT_AMENDED',
      targetType: 'parent_contact_record',
      targetId: newId,
      details: { supersedesNoteId: prior.id, noteGroupId: prior.noteGroupId, versionNumber: nextVer, reason },
    });

    const row = this.db
      .prepare('SELECT * FROM parent_contact_records WHERE id = ?')
      .get(newId) as Record<string, unknown>;
    return this.hydrateParentContactRow(row);
  }

  public addFollowupAction(
    actor: UserAccount,
    caseId: string,
    payload: { title: string; description?: string; dueDate: string; ownerUserId?: string }
  ): WellbeingFollowupActionRecord {
    const caseRec = this.getCaseRowHydrated(caseId);
    if (!caseRec) throw new HttpError(404, 'Wellbeing case not found.');
    this.assertCanAccessCase(actor, caseRec);

    const owner = payload.ownerUserId
      ? this.academic.getUserById(payload.ownerUserId) || actor
      : actor;
    const id = `WFA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO wellbeing_followup_actions (
          id, case_id, title, description, owner_user_id, owner_name, due_date, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
      )
      .run(
        id,
        caseId,
        String(payload.title || '').trim(),
        String(payload.description || '').trim(),
        owner.id,
        owner.name,
        String(payload.dueDate || now.slice(0, 10)),
        now
      );

    this.db
      .prepare(`UPDATE wellbeing_cases SET updated_at = ? WHERE id = ?`)
      .run(now, caseId);

    const r = this.db
      .prepare('SELECT * FROM wellbeing_followup_actions WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return {
      id: String(r.id),
      caseId: String(r.case_id),
      title: String(r.title),
      description: String(r.description || ''),
      ownerUserId: String(r.owner_user_id),
      ownerName: String(r.owner_name),
      dueDate: String(r.due_date),
      status: String(r.status) as WellbeingFollowupActionRecord['status'],
      completionNotes: null,
      completedAt: null,
      createdAt: String(r.created_at),
    };
  }

  public updateFollowupActionStatus(
    actor: UserAccount,
    actionId: string,
    status: WellbeingFollowupActionRecord['status'],
    completionNotes?: string
  ): WellbeingFollowupActionRecord {
    const existing = this.db
      .prepare('SELECT * FROM wellbeing_followup_actions WHERE id = ?')
      .get(actionId) as Record<string, unknown> | undefined;
    if (!existing) throw new HttpError(404, 'Follow-up action not found.');

    const caseRec = this.getCaseRowHydrated(String(existing.case_id));
    if (!caseRec) throw new HttpError(404, 'Wellbeing case not found.');
    this.assertCanAccessCase(actor, caseRec);

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE wellbeing_followup_actions
         SET status = ?, completion_notes = COALESCE(?, completion_notes), completed_at = ?
         WHERE id = ?`
      )
      .run(
        status,
        completionNotes ? String(completionNotes).trim() : null,
        status === 'COMPLETED' ? now : null,
        actionId
      );

    const r = this.db
      .prepare('SELECT * FROM wellbeing_followup_actions WHERE id = ?')
      .get(actionId) as Record<string, unknown>;
    return {
      id: String(r.id),
      caseId: String(r.case_id),
      title: String(r.title),
      description: String(r.description || ''),
      ownerUserId: String(r.owner_user_id),
      ownerName: String(r.owner_name),
      dueDate: String(r.due_date),
      status: String(r.status) as WellbeingFollowupActionRecord['status'],
      completionNotes: r.completion_notes ? String(r.completion_notes) : null,
      completedAt: r.completed_at ? String(r.completed_at) : null,
      createdAt: String(r.created_at),
    };
  }

  // =========================================================================
  // 5. RESTRICTED SAFEGUARDING REVIEW & HUMAN-APPROVED ESCALATION WORKFLOW
  // =========================================================================

  private hydrateSafeguardingRow(r: Record<string, unknown>): SafeguardingReviewRecord {
    return {
      id: String(r.id),
      caseId: String(r.case_id),
      studentId: String(r.student_id),
      studentName: String(r.student_name),
      concernsSummary: String(r.concerns_summary),
      uncertaintiesAndLimitations: String(r.uncertainties_and_limitations),
      chronology: parseJsonSafe<SafeguardingChronologyEntry[]>(r.chronology_json, []),
      decision: String(r.decision) as SafeguardingDecisionStatus,
      referralRecommended: Number(r.referral_recommended ?? 0) === 1,
      referralDraftText: String(r.referral_draft_text || ''),
      externalAuthorityRef: r.external_authority_ref ? String(r.external_authority_ref) : null,
      reviewedByUserId: String(r.reviewed_by_user_id),
      reviewedByName: String(r.reviewed_by_name),
      approvedByUserId: r.approved_by_user_id ? String(r.approved_by_user_id) : null,
      approvedByName: r.approved_by_name ? String(r.approved_by_name) : null,
      approvedAt: r.approved_at ? String(r.approved_at) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  public listSafeguardingReviews(actor: UserAccount): SafeguardingReviewRecord[] {
    this.assertSafeguardingPersonnel(actor);
    const rows = this.db
      .prepare('SELECT * FROM safeguarding_reviews ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.hydrateSafeguardingRow(r));
  }

  public initiateOrUpdateSafeguardingReview(
    actor: UserAccount,
    caseId: string,
    payload: {
      concernsSummary: string;
      uncertaintiesAndLimitations: string;
      chronology?: SafeguardingChronologyEntry[];
      decision?: SafeguardingDecisionStatus;
      referralRecommended?: boolean;
      referralDraftText?: string;
    }
  ): SafeguardingReviewRecord {
    this.assertSafeguardingPersonnel(actor);
    const caseRec = this.getCaseRowHydrated(caseId);
    if (!caseRec) throw new HttpError(404, 'Wellbeing case not found.');

    const concerns = String(payload.concernsSummary || '').trim();
    const uncertainties = String(payload.uncertaintiesAndLimitations || '').trim();
    if (!concerns || !uncertainties) {
      throw new HttpError(
        400,
        'Both concerns summary and recorded uncertainties/limitations are required for safeguarding review.'
      );
    }

    // Enforce human approval gate: direct APPROVED_FOR_REFERRAL or REFERRED_TO_AUTHORITY requires explicit approveSafeguardingReview step
    if (
      payload.decision === 'APPROVED_FOR_REFERRAL' ||
      payload.decision === 'REFERRED_TO_AUTHORITY'
    ) {
      throw new HttpError(
        400,
        'Safeguarding referrals require an explicit human approval step after reviewing evidence and draft documentation.'
      );
    }

    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT * FROM safeguarding_reviews WHERE case_id = ?')
      .get(caseId) as Record<string, unknown> | undefined;

    const autoChronology: SafeguardingChronologyEntry[] = payload.chronology?.length
      ? payload.chronology
      : [
          {
            occurredAt: caseRec.createdAt,
            source: `Case ${caseRec.id}`,
            factualDescription: caseRec.summaryOfConcern,
            limitationsOrContext: uncertainties,
          },
        ];

    const draftText =
      payload.referralDraftText ||
      [
        `SAFEGUARDING CONSULTATION DRAFT (REQUIRES HUMAN DESIGNATED OFFICER APPROVAL)`,
        `Student: ${caseRec.studentName} (${caseRec.studentId}) | Case Reference: ${caseRec.id}`,
        `Summary of Factual Concerns: ${concerns}`,
        `Uncertainties & Educational Data Limitations: ${uncertainties}`,
        `Note: Platform telemetry reflects study-time patterns and guardian communication logs only; it does not constitute clinical assessment.`,
      ].join('\n');

    let reviewId: string;
    this.dbWrapper.transaction(() => {
      if (existing) {
        reviewId = String(existing.id);
        this.db
          .prepare(
            `UPDATE safeguarding_reviews
             SET concerns_summary = ?, uncertainties_and_limitations = ?, chronology_json = ?,
                 decision = ?, referral_recommended = ?, referral_draft_text = ?,
                 reviewed_by_user_id = ?, reviewed_by_name = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            concerns,
            uncertainties,
            JSON.stringify(autoChronology),
            payload.decision || 'ASSESSMENT_IN_PROGRESS',
            payload.referralRecommended ? 1 : 0,
            draftText,
            actor.id,
            actor.name,
            now,
            reviewId
          );
      } else {
        reviewId = `SGR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        this.db
          .prepare(
            `INSERT INTO safeguarding_reviews (
              id, case_id, student_id, student_name, concerns_summary, uncertainties_and_limitations,
              chronology_json, decision, referral_recommended, referral_draft_text,
              reviewed_by_user_id, reviewed_by_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            reviewId,
            caseId,
            caseRec.studentId,
            caseRec.studentName,
            concerns,
            uncertainties,
            JSON.stringify(autoChronology),
            payload.decision || 'ASSESSMENT_IN_PROGRESS',
            payload.referralRecommended ? 1 : 0,
            draftText,
            actor.id,
            actor.name,
            now,
            now
          );
      }

      this.db
        .prepare(
          `UPDATE wellbeing_cases
           SET is_safeguarding_restricted = 1, status = 'REFERRED_SAFEGUARDING', updated_at = ?
           WHERE id = ?`
        )
        .run(now, caseId);
    });

    this.academic.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'SAFEGUARDING_REVIEW_UPDATED',
      targetType: 'safeguarding_review',
      targetId: reviewId!,
      details: { caseId, studentId: caseRec.studentId, decision: payload.decision || 'ASSESSMENT_IN_PROGRESS' },
    });

    const row = this.db
      .prepare('SELECT * FROM safeguarding_reviews WHERE id = ?')
      .get(reviewId!) as Record<string, unknown>;
    return this.hydrateSafeguardingRow(row);
  }

  public approveSafeguardingReview(
    actor: UserAccount,
    reviewId: string,
    payload: {
      decision: 'APPROVED_FOR_REFERRAL' | 'REFERRED_TO_AUTHORITY' | 'NOT_REFERRED_NO_RISK' | 'MONITORING_WITH_SUPPORT';
      externalAuthorityRef?: string;
    }
  ): SafeguardingReviewRecord {
    this.assertSafeguardingPersonnel(actor);
    const row = this.db
      .prepare('SELECT * FROM safeguarding_reviews WHERE id = ?')
      .get(reviewId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Safeguarding review not found.');

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE safeguarding_reviews
         SET decision = ?, external_authority_ref = COALESCE(?, external_authority_ref),
             approved_by_user_id = ?, approved_by_name = ?, approved_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        payload.decision,
        payload.externalAuthorityRef ? String(payload.externalAuthorityRef).trim() : null,
        actor.id,
        actor.name,
        now,
        now,
        reviewId
      );

    this.academic.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'SAFEGUARDING_DECISION_APPROVED',
      targetType: 'safeguarding_review',
      targetId: reviewId,
      details: { decision: payload.decision, externalAuthorityRef: payload.externalAuthorityRef || null },
    });

    const updated = this.db
      .prepare('SELECT * FROM safeguarding_reviews WHERE id = ?')
      .get(reviewId) as Record<string, unknown>;
    return this.hydrateSafeguardingRow(updated);
  }

  // =========================================================================
  // 6. VERSIONED AUDIT DOCUMENT GENERATION, ACCESS LOGGING & PDF EXPORT
  // =========================================================================

  private hydrateAuditDocRow(r: Record<string, unknown>): AuditDocumentRecord {
    return {
      id: String(r.id),
      reportCode: String(r.report_code),
      documentType: String(r.document_type) as AuditDocumentType,
      versionNumber: Number(r.version_number),
      studentId: String(r.student_id),
      studentName: String(r.student_name),
      caseId: r.case_id ? String(r.case_id) : null,
      safeguardingReviewId: r.safeguarding_review_id ? String(r.safeguarding_review_id) : null,
      isRestrictedSafeguarding: Number(r.is_restricted_safeguarding ?? 0) === 1,
      title: String(r.title),
      preparedByUserId: String(r.prepared_by_user_id),
      preparedByName: String(r.prepared_by_name),
      preparedByRole: String(r.prepared_by_role) as AuditDocumentRecord['preparedByRole'],
      periodStart: String(r.period_start),
      periodEnd: String(r.period_end),
      ruleVersionId: String(r.rule_version_id),
      ruleVersionTitle: String(r.rule_version_title),
      factualEvidenceSummary: parseJsonSafe<string[]>(r.factual_evidence_summary_json, []),
      dataSources: parseJsonSafe<string[]>(r.data_sources_json, []),
      interventionsSummary: parseJsonSafe<string[]>(r.interventions_summary_json, []),
      parentContactHistorySummary: parseJsonSafe<string[]>(r.parent_contact_history_summary_json, []),
      caseStatusAtGeneration: String(r.case_status_at_generation || 'N/A'),
      limitationsAndUncertainties: parseJsonSafe<string[]>(r.limitations_and_uncertainties_json, []),
      approvalStatus: String(r.approval_status) as AuditDocumentRecord['approvalStatus'],
      approvedByUserId: r.approved_by_user_id ? String(r.approved_by_user_id) : null,
      approvedByName: r.approved_by_name ? String(r.approved_by_name) : null,
      approvedAt: r.approved_at ? String(r.approved_at) : null,
      payloadJson: String(r.payload_json || '{}'),
      createdAt: String(r.created_at),
    };
  }

  private logAuditDocumentAccess(
    documentId: string,
    actor: UserAccount,
    action: AuditDocumentAccessLog['accessAction']
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_document_access_logs (
          id, document_id, accessor_user_id, accessor_name, accessor_role, access_action, accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `ADAL-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        documentId,
        actor.id,
        actor.name,
        actor.role,
        action,
        new Date().toISOString()
      );
  }

  public generateAuditDocument(
    actor: UserAccount,
    params: {
      documentType: AuditDocumentType;
      studentId: string;
      caseId?: string | null;
      safeguardingReviewId?: string | null;
      periodStart?: string;
      periodEnd?: string;
      title?: string;
      humanApproved?: boolean;
    }
  ): AuditDocumentRecord {
    if (actor.role !== 'admin' && actor.role !== 'teacher') {
      throw new HttpError(403, 'Staff authorization required to generate audit documents.');
    }

    const isSafeguardingDoc = params.documentType === 'safeguarding_referral_draft';
    let caseRec: WellbeingCaseRecord | null = null;
    if (params.caseId) {
      caseRec = this.getCaseRowHydrated(params.caseId);
      if (!caseRec) throw new HttpError(404, 'Referenced wellbeing case not found.');
    }

    if (isSafeguardingDoc || caseRec?.isSafeguardingRestricted || params.safeguardingReviewId) {
      this.assertSafeguardingPersonnel(actor);
    } else if (actor.role === 'teacher') {
      if (caseRec) this.assertCanAccessCase(actor, caseRec);
      else this.assertCanViewStudentWellbeing(actor, params.studentId);
    }

    const student = this.academic.getUserById(params.studentId);
    if (!student) throw new HttpError(404, 'Student not found.');

    const now = new Date().toISOString();
    const periodEnd = params.periodEnd || now.slice(0, 10);
    const periodStart =
      params.periodStart ||
      new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

    const analytics = this.getStudentStudyTimeAnalytics(actor, student.id, 14);
    const warnings = this.listStudentWarnings(actor, student.id);
    const rule = this.getActiveRuleForGrade(student.grade || 'Grade 5');

    const contactRows = params.caseId
      ? (this.db
          .prepare(
            `SELECT * FROM parent_contact_records WHERE case_id = ? ORDER BY contact_at ASC, version_number ASC`
          )
          .all(params.caseId) as Record<string, unknown>[]).map((r) =>
          this.hydrateParentContactRow(r)
        )
      : (this.db
          .prepare(
            `SELECT * FROM parent_contact_records WHERE student_id = ? ORDER BY contact_at ASC, version_number ASC`
          )
          .all(student.id) as Record<string, unknown>[]).map((r) =>
          this.hydrateParentContactRow(r)
        );

    const actionRows = params.caseId
      ? (this.db
          .prepare(`SELECT * FROM wellbeing_followup_actions WHERE case_id = ?`)
          .all(params.caseId) as Record<string, unknown>[])
      : [];

    let sgReview: SafeguardingReviewRecord | null = null;
    if (params.safeguardingReviewId) {
      const sgr = this.db
        .prepare('SELECT * FROM safeguarding_reviews WHERE id = ?')
        .get(params.safeguardingReviewId) as Record<string, unknown> | undefined;
      if (!sgr) throw new HttpError(404, 'Safeguarding review not found.');
      sgReview = this.hydrateSafeguardingRow(sgr);
    }

    const factualEvidenceSummary: string[] = [
      `Study totals (${periodStart} to ${periodEnd}): Scheduled ${analytics.weeklyTotals.scheduledMinutes} min | Session Open ${analytics.weeklyTotals.openMinutes} min | Observed Active ${analytics.weeklyTotals.activeMinutes} min | Idle/Unverified ${analytics.weeklyTotals.idleMinutes} min | Backgrounded ${analytics.weeklyTotals.backgroundMinutes} min | Logged Breaks ${analytics.weeklyTotals.breakMinutes} min.`,
      `Breakdown by mode: Practice active ${analytics.weeklyTotals.practiceActiveMinutes} min | Timed Mock Exam active ${analytics.weeklyTotals.mockExamActiveMinutes} min | Peak continuous stretch ${analytics.weeklyTotals.maxContinuousSessionMinutes} min.`,
      `Wellbeing warnings recorded in period: ${warnings.length} (${warnings.filter((w) => w.severity === 'staff_review_trigger').length} staff-review triggers).`,
    ];
    if (caseRec) {
      factualEvidenceSummary.push(`Case (${caseRec.id}): ${caseRec.summaryOfConcern}`);
    }
    if (sgReview) {
      factualEvidenceSummary.push(`Safeguarding Review (${sgReview.id}): ${sgReview.concernsSummary}`);
    }

    const dataSources: string[] = [
      ...analytics.recentSessions.map((s) => `Session ${s.sessionKey} (${s.contextMode})`),
      ...warnings.map((w) => `Warning ${w.id} (${w.triggerSource})`),
      ...contactRows.map((c) => `ParentContact ${c.id} (group ${c.noteGroupId} v${c.versionNumber})`),
    ];

    const interventionsSummary: string[] = [
      ...warnings.map(
        (w) => `Warning ${w.id}: decision=${w.parentDecision}; channels=${w.notifiedChannels.join(',') || 'none'}`
      ),
      ...actionRows.map(
        (a) => `Action ${a.id} (${a.status}): ${a.title} [Owner: ${a.owner_name}, Due: ${a.due_date}]`
      ),
    ];

    const parentContactHistorySummary = contactRows.map(
      (c) =>
        `[${c.contactAt}] v${c.versionNumber}${c.isFinalized ? ' (FINAL)' : ' (DRAFT)'} via ${c.contactMethod} (${c.contactOutcome}) by ${c.staffName}: Observations="${c.factualObservations}" | Guidance="${c.guidanceProvided}" | Parent Response="${c.parentResponse}"`
    );

    const limitationsAndUncertainties = [
      ...STANDARD_UNCERTAINTY_STATEMENTS,
      ...(sgReview ? [sgReview.uncertaintiesAndLimitations] : []),
    ];

    const existingMax = this.db
      .prepare(
        `SELECT COALESCE(MAX(version_number), 0) as mv FROM audit_documents WHERE document_type = ? AND student_id = ?`
      )
      .get(params.documentType, student.id) as { mv: number };
    const versionNumber = Number(existingMax.mv || 0) + 1;

    const docId = `ADOC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const reportCode = `M5-AUD-${params.documentType.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}-V${versionNumber}`;
    const approvalStatus =
      params.humanApproved && this.isDesignatedSafeguarding(actor) ? 'HUMAN_APPROVED' : 'DRAFT';

    const docTitle =
      params.title ||
      `${params.documentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} · ${student.name}`;

    this.db
      .prepare(
        `INSERT INTO audit_documents (
          id, report_code, document_type, version_number, student_id, student_name,
          case_id, safeguarding_review_id, is_restricted_safeguarding, title,
          prepared_by_user_id, prepared_by_name, prepared_by_role, period_start, period_end,
          rule_version_id, rule_version_title, factual_evidence_summary_json, data_sources_json,
          interventions_summary_json, parent_contact_history_summary_json, case_status_at_generation,
          limitations_and_uncertainties_json, approval_status, approved_by_user_id, approved_by_name,
          approved_at, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        docId,
        reportCode,
        params.documentType,
        versionNumber,
        student.id,
        student.name,
        params.caseId || null,
        params.safeguardingReviewId || null,
        isSafeguardingDoc || caseRec?.isSafeguardingRestricted ? 1 : 0,
        docTitle,
        actor.id,
        actor.name,
        actor.role,
        periodStart,
        periodEnd,
        rule.id,
        `${rule.title} (v${rule.versionNumber})`,
        JSON.stringify(factualEvidenceSummary),
        JSON.stringify(dataSources),
        JSON.stringify(interventionsSummary),
        JSON.stringify(parentContactHistorySummary),
        caseRec?.status || 'N/A',
        JSON.stringify(limitationsAndUncertainties),
        approvalStatus,
        approvalStatus === 'HUMAN_APPROVED' ? actor.id : null,
        approvalStatus === 'HUMAN_APPROVED' ? actor.name : null,
        approvalStatus === 'HUMAN_APPROVED' ? now : null,
        JSON.stringify({ analyticsSummary: analytics.weeklyTotals, warningsCount: warnings.length }),
        now
      );

    this.logAuditDocumentAccess(docId, actor, 'GENERATE');
    this.academic.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'AUDIT_DOCUMENT_GENERATED',
      targetType: 'audit_document',
      targetId: docId,
      details: { reportCode, documentType: params.documentType, studentId: student.id, versionNumber },
    });

    const row = this.db
      .prepare('SELECT * FROM audit_documents WHERE id = ?')
      .get(docId) as Record<string, unknown>;
    return this.hydrateAuditDocRow(row);
  }

  public listAuditDocuments(actor: UserAccount, studentId?: string): AuditDocumentRecord[] {
    if (actor.role !== 'admin' && actor.role !== 'teacher') {
      throw new HttpError(403, 'Staff authorization required to list audit documents.');
    }
    const rows = studentId
      ? (this.db
          .prepare('SELECT * FROM audit_documents WHERE student_id = ? ORDER BY created_at DESC')
          .all(studentId) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM audit_documents ORDER BY created_at DESC LIMIT 60')
          .all() as Record<string, unknown>[]);

    return rows
      .map((r) => this.hydrateAuditDocRow(r))
      .filter((doc) => {
        if (doc.isRestrictedSafeguarding && !this.isDesignatedSafeguarding(actor)) {
          return false;
        }
        if (actor.role === 'teacher') {
          return this.teacherHasScopeForStudent(actor, doc.studentId);
        }
        return true;
      });
  }

  public getAuditDocumentDetail(actor: UserAccount, docId: string): AuditDocumentRecord {
    const row = this.db
      .prepare('SELECT * FROM audit_documents WHERE id = ?')
      .get(docId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Audit document not found.');
    const doc = this.hydrateAuditDocRow(row);
    if (doc.isRestrictedSafeguarding || doc.documentType === 'safeguarding_referral_draft') {
      this.assertSafeguardingPersonnel(actor);
    } else if (actor.role !== 'admin') {
      this.assertCanViewStudentWellbeing(actor, doc.studentId);
    }
    this.logAuditDocumentAccess(doc.id, actor, 'VIEW');
    return doc;
  }

  public exportAuditDocumentPdf(
    actor: UserAccount,
    docId: string
  ): { filename: string; pdf: Buffer; document: AuditDocumentRecord } {
    const row = this.db
      .prepare('SELECT * FROM audit_documents WHERE id = ?')
      .get(docId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Audit document not found.');
    const doc = this.hydrateAuditDocRow(row);
    if (doc.isRestrictedSafeguarding || doc.documentType === 'safeguarding_referral_draft') {
      this.assertSafeguardingPersonnel(actor);
    } else if (actor.role !== 'admin') {
      this.assertCanViewStudentWellbeing(actor, doc.studentId);
    }
    this.logAuditDocumentAccess(doc.id, actor, 'EXPORT_PDF');
    return {
      filename: `${doc.reportCode}.pdf`,
      pdf: buildAuditDocumentPdfBuffer(doc),
      document: doc,
    };
  }

  public listAuditDocumentAccessLogs(
    actor: UserAccount,
    documentId?: string
  ): AuditDocumentAccessLog[] {
    if (actor.role !== 'admin' && !this.isDesignatedSafeguarding(actor)) {
      throw new HttpError(403, 'Access logs are restricted to administrators and safeguarding leads.');
    }
    const rows = documentId
      ? (this.db
          .prepare('SELECT * FROM audit_document_access_logs WHERE document_id = ? ORDER BY accessed_at DESC')
          .all(documentId) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM audit_document_access_logs ORDER BY accessed_at DESC LIMIT 80')
          .all() as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: String(r.id),
      documentId: String(r.document_id),
      accessorUserId: String(r.accessor_user_id),
      accessorName: String(r.accessor_name),
      accessorRole: String(r.accessor_role) as AuditDocumentAccessLog['accessorRole'],
      accessAction: String(r.access_action) as AuditDocumentAccessLog['accessAction'],
      accessedAt: String(r.accessed_at),
    }));
  }
}
