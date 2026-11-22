import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectProhibitedSurveillancePayload,
  mergeOverlappingIntervals,
  summarizeSingleSession,
  validateScheduleWellbeing,
} from './wellbeingEngine.ts';
import type {
  ScheduledSessionRecord,
  StudyActivityEventRecord,
  WellbeingRuleVersion,
} from './types.ts';

const SAMPLE_RULE: WellbeingRuleVersion = {
  id: 'WBRV-1',
  ruleSetId: 'WBR-G5-CORE',
  versionNumber: 1,
  grade: 'Grade 5',
  subjectId: null,
  title: 'Grade 5 Balanced Study Guideline',
  educationalStandardNote:
    'Educational pacing guideline for Grade 5 students; not a clinical or medical standard.',
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
  createdByName: 'Admin',
  approvedByAdminId: 'usr-admin-1',
  approvedAt: '2026-01-01T00:00:00.000Z',
  changeNote: 'Initial Grade 5 guideline',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('wellbeingEngine', () => {
  it('merges overlapping browser tab intervals so multi-tab study never double-counts', () => {
    const merged = mergeOverlappingIntervals([
      { startMs: 1000, endMs: 11000 },
      { startMs: 6000, endMs: 16000 },
      { startMs: 20000, endMs: 25000 },
    ]);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged[0], { startMs: 1000, endMs: 16000 });
    assert.deepEqual(merged[1], { startMs: 20000, endMs: 25000 });
  });

  it('distinguishes active interaction from idle open browser time, backgrounding, and breaks', () => {
    const base = Date.parse('2026-11-20T10:00:00.000Z');
    const mk = (
      offsetSec: number,
      eventType: StudyActivityEventRecord['eventType'],
      tabId = 'tab-1'
    ): StudyActivityEventRecord => ({
      id: `EV-${offsetSec}-${tabId}`,
      userId: 'usr-student-1',
      idempotencyKey: `k-${offsetSec}-${tabId}`,
      sessionKey: 'SES-TEST-1',
      eventType,
      occurredAt: new Date(base + offsetSec * 1000).toISOString(),
      serverReceivedAt: new Date(base + offsetSec * 1000).toISOString(),
      contextMode: 'practice',
      deviceId: 'dev-1',
      tabId,
      assessmentId: null,
      scheduledSessionId: null,
      paperId: null,
      subjectId: 'subj-math',
      questionId: 'CUR-002',
    });

    // 0s open, 60s answer (active 60s), then silent until 360s (threshold 120s -> 60-180s active, 180-360s idle=180s)
    // 360s tab_backgrounded -> 480s tab_resumed (120s backgrounded)
    // 480s break_started -> 780s break_ended (300s break), 840s session_closed
    const summary = summarizeSingleSession({
      sessionKey: 'SES-TEST-1',
      studentId: 'usr-student-1',
      inactivityThresholdSeconds: 120,
      events: [
        mk(0, 'session_open'),
        mk(60, 'answer_selected'),
        mk(360, 'tab_backgrounded'),
        mk(480, 'tab_resumed'),
        mk(480, 'break_started'),
        mk(780, 'break_ended'),
        mk(840, 'session_closed'),
      ],
    });

    assert.equal(summary.openDurationSeconds, 840);
    assert.equal(summary.activeDurationSeconds, 240); // 0-180 (180s) + 780-840 (60s)
    assert.equal(summary.idleDurationSeconds, 180);
    assert.equal(summary.backgroundDurationSeconds, 120);
    assert.equal(summary.breakTotalSeconds, 300);
    assert.equal(summary.breakCount, 1);
    assert.match(summary.uncertaintyNote, /reading offline or away/i);
  });

  it('rejects/flags prohibited invasive surveillance fields cleanly', () => {
    assert.deepEqual(
      detectProhibitedSurveillancePayload({ eventType: 'question_viewed', tabId: 't1' }),
      []
    );
    const detected = detectProhibitedSurveillancePayload({
      eventType: 'interaction_heartbeat',
      keystrokes: '2+2=4',
      latitude: 6.9271,
      webcam: true,
    });
    assert.ok(detected.includes('keystrokes'));
    assert.ok(detected.includes('latitude'));
    assert.ok(detected.includes('webcam'));
  });

  it('validates pre-schedule workload with combined existing sessions and generates non-accusatory guidance', () => {
    const existing: ScheduledSessionRecord[] = [
      {
        id: 'SES-EX-1',
        timetableId: 'TT-1',
        studentId: 'usr-student-1',
        createdByUserId: 'usr-parent-1',
        title: 'Existing Math Slot',
        activityType: 'practice',
        timezone: 'Asia/Colombo',
        scheduledStartUtc: '2026-12-01T10:00:00.000Z',
        scheduledEndUtc: '2026-12-01T11:00:00.000Z',
        durationMinutes: 60,
        gracePeriodMinutes: 15,
        recurrenceKey: 'r1',
        status: 'SCHEDULED',
        maxAttempts: 1,
        attemptsUsed: 0,
        filterCriteria: { subjectIds: ['subj-math'] },
        notes: '',
        createdAt: '2026-11-20T00:00:00.000Z',
        updatedAt: '2026-11-20T00:00:00.000Z',
      },
    ];

    const res = validateScheduleWellbeing({
      studentId: 'usr-student-1',
      existingSessions: existing,
      proposedSlots: [
        {
          localDate: '2026-12-01',
          startUtc: '2026-12-01T11:00:00.000Z',
          endUtc: '2026-12-01T11:50:00.000Z',
          durationMinutes: 50,
        },
        {
          localDate: '2026-12-02',
          startUtc: '2026-12-02T11:00:00.000Z',
          endUtc: '2026-12-02T12:45:00.000Z',
          durationMinutes: 105,
        },
      ],
      rule: SAMPLE_RULE,
    });

    assert.equal(res.exceedsDailyMax, true);
    assert.equal(res.exceedsContinuousThreshold, true);
    assert.equal(res.insufficientPlannedBreaks, true);
    assert.equal(res.requiresStaffReview, true); // 2 days over max triggers staffReviewDailyExceedCount=2
    assert.ok(res.balancedSuggestions.length >= 1);
    assert.doesNotMatch(res.supportiveMessage.toLowerCase(), /\babuse\b|\bdiagnos|\bdamage\b/);
    assert.match(res.educationalGuidelineNotice, /not a clinical or medical/i);
  });
});
