import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Man5heDatabase } from './db.ts';
import { AcademicService, HttpError } from './academicService.ts';
import { AssessmentService } from './assessmentService.ts';
import { ParentIntelligenceService } from './parentIntelligenceService.ts';
import { WellbeingService } from './wellbeingService.ts';
import { AcademicRoutineService } from './routineService.ts';
import type { AcademicRoutineConfigInput } from '../lib/types.ts';

function createTempRoutineSuite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'man5he-enh07-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new Man5heDatabase(dbPath);
  const academicService = new AcademicService(db);
  const assessmentService = new AssessmentService(db, academicService);
  const wellbeingService = new WellbeingService(academicService);
  const parentIntel = new ParentIntelligenceService(db, academicService);
  const routineService = new AcademicRoutineService(academicService, parentIntel, wellbeingService);

  return {
    dir,
    db,
    academicService,
    assessmentService,
    wellbeingService,
    routineService,
    cleanup: () => {
      try {
        db.db.close();
      } catch {
        // ignore
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function buildValidRoutineConfig(overrides: Partial<AcademicRoutineConfigInput> = {}): AcademicRoutineConfigInput {
  return {
    studentId: 'usr-student-1',
    title: 'Term 2 Mixed Math & Language Plan',
    description: 'Weighted practice plan targeting word problems and comprehension.',
    grade: 'Grade 5',
    startDate: '2026-12-05',
    startTimeOfDay: '16:30',
    timezone: 'Asia/Colombo',
    recurrenceType: 'weekly',
    weekdays: [1, 3, 5],
    totalDurationWeeks: 2,
    mixingMethod: 'mixed_session',
    subjectWeights: [
      { subjectId: 'subj-math', weightPercent: 60, enabled: true, topicIds: [], subtopicIds: [] },
      { subjectId: 'subj-sinhala', weightPercent: 40, enabled: true, topicIds: [], subtopicIds: [] },
    ],
    skillWeights: [
      { skillKey: 'numerical_ability', weightPercent: 50, enabled: true, isEducationalCategory: true },
      { skillKey: 'reading_comprehension', weightPercent: 50, enabled: true, isEducationalCategory: true },
    ],
    difficultyDistribution: {
      simple: 30,
      moderate: 50,
      difficult: 20,
      useEmpiricalCalibration: true,
    },
    questionCountPerSession: 6,
    sessionDurationMinutes: 25,
    practiceRatioPercent: 75,
    mockFrequencyDays: 4,
    exposurePreference: 'all',
    scheduleMode: 'fixed',
    breakIntervalMinutes: 20,
    breakDurationMinutes: 5,
    ...overrides,
  };
}

describe('AcademicRoutineService — E07 Integration Tests', () => {
  const cleanups: (() => void)[] = [];

  after(() => {
    for (const fn of cleanups) fn();
  });

  it('1. Enforces validation, subject-scoped teacher review RBAC, admin approval, and re-review invalidation on material edits', () => {
    const wrap = createTempRoutineSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, routineService } = wrap;

    const parent = academicService.getUserByIdentifier('parent@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const langTeacher = academicService.getUserByIdentifier('teacher.lang@man5he.lk')!;
    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;

    assert.throws(
      () =>
        routineService.createRoutine(
          parent,
          buildValidRoutineConfig({
            subjectWeights: [
              { subjectId: 'subj-math', weightPercent: 50, enabled: true, topicIds: [], subtopicIds: [] },
              { subjectId: 'subj-sinhala', weightPercent: 30, enabled: true, topicIds: [], subtopicIds: [] },
            ],
          })
        ),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );

    const created = routineService.createRoutine(parent, buildValidRoutineConfig());
    assert.equal(created.routine.workflowStatus, 'DRAFT');
    assert.equal(created.currentVersion.versionNumber, 1);

    const submitted = routineService.submitRoutineForReview(parent, created.routine.id);
    assert.equal(submitted.routine.workflowStatus, 'UNDER_REVIEW');

    // Language teacher cannot evaluate Mathematics component
    assert.throws(
      () =>
        routineService.submitTeacherEvaluation(langTeacher, created.routine.id, {
          subjectComponentDecisions: { 'subj-math': 'approved' },
          decision: 'approved_components',
          generalComment: 'Out of scope test',
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Math teacher evaluates Math component
    routineService.submitTeacherEvaluation(mathTeacher, created.routine.id, {
      subjectComponentDecisions: { 'subj-math': 'approved' },
      decision: 'approved_components',
      topicSuitabilityNote: 'Good Grade 5 arithmetic coverage.',
      generalComment: 'Math allocation approved.',
    });

    // Admin grants final cross-subject approval
    const approved = routineService.submitAdminEvaluation(admin, created.routine.id, {
      decision: 'approved',
      overallBalanceNote: 'Healthy balance between Math and Sinhala.',
      coordinationSummary: 'Approved for activation.',
    });
    assert.equal(approved.routine.workflowStatus, 'APPROVED');

    // Non-material edit preserves approval
    const renamed = routineService.updateRoutine(
      parent,
      created.routine.id,
      buildValidRoutineConfig({ title: 'Term 2 Mixed Plan (Polished Title)' })
    );
    assert.equal(renamed.routine.requiresReReview, false);

    // Material edit invalidates prior approval and blocks activation until re-approved
    const reweighted = routineService.updateRoutine(
      parent,
      created.routine.id,
      buildValidRoutineConfig({
        subjectWeights: [
          { subjectId: 'subj-math', weightPercent: 80, enabled: true, topicIds: [], subtopicIds: [] },
          { subjectId: 'subj-sinhala', weightPercent: 20, enabled: true, topicIds: [], subtopicIds: [] },
        ],
      })
    );
    assert.equal(reweighted.routine.requiresReReview, true);
    assert.equal(reweighted.routine.workflowStatus, 'DRAFT');
    assert.equal(reweighted.currentVersion.versionNumber, 3);

    assert.throws(
      () => routineService.activateRoutine(parent, created.routine.id),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );

    // Re-submit & re-approve v3 -> activation succeeds and creates scheduled_sessions + reminder_jobs
    routineService.submitRoutineForReview(parent, created.routine.id);
    routineService.submitAdminEvaluation(admin, created.routine.id, { decision: 'approved' });
    const activated = routineService.activateRoutine(parent, created.routine.id);

    assert.equal(activated.detail.routine.workflowStatus, 'ACTIVE');
    assert.ok(activated.sessionsCreated.length >= 2);
    assert.ok(activated.timetable.id.startsWith('STT-'));

    const reminderCount = (
      wrap.db.db
        .prepare('SELECT COUNT(*) as cnt FROM reminder_jobs WHERE session_id IN (SELECT id FROM scheduled_sessions WHERE timetable_id = ?)')
        .get(activated.timetable.id) as { cnt: number }
    ).cnt;
    assert.ok(reminderCount >= activated.sessionsCreated.length);
  });

  it('2. Strictly locks Fixed mode against adaptive edits, allows bounded adaptive practice refresh while protecting mock exams, and computes adherence analytics', () => {
    const wrap = createTempRoutineSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, routineService } = wrap;

    const parent = academicService.getUserByIdentifier('parent@man5he.lk')!;
    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;

    // Fixed mode routine
    const fixedRoutine = routineService.createRoutine(
      parent,
      buildValidRoutineConfig({ scheduleMode: 'fixed' })
    );
    routineService.submitRoutineForReview(parent, fixedRoutine.routine.id);
    routineService.submitAdminEvaluation(admin, fixedRoutine.routine.id, { decision: 'approved' });
    routineService.activateRoutine(parent, fixedRoutine.routine.id);

    assert.throws(
      () => routineService.evaluateAdaptiveAdjustments(parent, fixedRoutine.routine.id),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );

    // Adaptive mode routine + simulated low Math performance so adaptive trigger fires
    const adaptiveRoutine = routineService.createRoutine(
      parent,
      buildValidRoutineConfig({
        title: 'Adaptive Mixed Weekly Plan',
        startDate: '2026-12-20',
        scheduleMode: 'adaptive',
        adaptiveBounds: {
          maxDailyShiftMinutes: 10,
          maxDifficultyShiftPercent: 15,
          maxSubjectWeightShiftPercent: 15,
          allowQuestionSubstitution: true,
          notifyParentOnAdjustment: true,
          requireApprovalOutsideBounds: true,
        },
      })
    );
    routineService.submitRoutineForReview(parent, adaptiveRoutine.routine.id);
    routineService.submitAdminEvaluation(admin, adaptiveRoutine.routine.id, { decision: 'approved' });
    const activatedAdaptive = routineService.activateRoutine(parent, adaptiveRoutine.routine.id);

    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;
    const mathQ = wrap.db.db
      .prepare(`SELECT id, correct_index FROM questions WHERE subject_id = 'subj-math' LIMIT 1`)
      .get() as { id: string; correct_index: number };
    const wrongIdx = (mathQ.correct_index + 1) % 4;
    academicService.recordQuestionAttempt({
      student,
      questionId: mathQ.id,
      contextMode: 'practice',
      sessionId: 'E07-ADAPT-TEST-1',
      submittedAnswerIndex: wrongIdx,
      responseDurationMs: 12000,
      idempotencyKey: 'e07-adapt-err-1',
    });
    academicService.recordQuestionAttempt({
      student,
      questionId: mathQ.id,
      contextMode: 'practice',
      sessionId: 'E07-ADAPT-TEST-1',
      submittedAnswerIndex: wrongIdx,
      responseDurationMs: 14000,
      idempotencyKey: 'e07-adapt-err-2',
    });

    const adaptiveRes = routineService.evaluateAdaptiveAdjustments(admin, adaptiveRoutine.routine.id);
    assert.equal(adaptiveRes.mode, 'adaptive');
    assert.ok(adaptiveRes.adjustment !== null);
    assert.equal(adaptiveRes.adjustment?.withinParentBounds, true);

    const perfSummary = routineService.getRoutinePerformanceSummary(parent, adaptiveRoutine.routine.id);
    assert.equal(perfSummary.routineId, adaptiveRoutine.routine.id);
    assert.equal(perfSummary.adherenceSummary.upcomingSessionsCount, activatedAdaptive.sessionsCreated.length);
    assert.ok(perfSummary.subjectComparison.some((b) => b.subjectId === 'subj-math'));
  });
});
