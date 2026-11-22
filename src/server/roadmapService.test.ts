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
import { GamifiedRoadmapService } from './roadmapService.ts';

function createTempRoadmapSuite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'man5he-enh08-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new Man5heDatabase(dbPath);
  const academicService = new AcademicService(db);
  const assessmentService = new AssessmentService(db, academicService);
  const wellbeingService = new WellbeingService(academicService);
  const parentIntel = new ParentIntelligenceService(db, academicService);
  const roadmapService = new GamifiedRoadmapService(academicService, parentIntel, wellbeingService);

  return {
    dir,
    db,
    academicService,
    assessmentService,
    roadmapService,
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

describe('GamifiedRoadmapService — E08 Integration Tests', () => {
  const cleanups: (() => void)[] = [];

  after(() => {
    for (const fn of cleanups) fn();
  });

  it('1. Enforces teacher subject RBAC, rejects prerequisite cycles, publishes roadmap, and syncs mission timetable schedules', () => {
    const wrap = createTempRoadmapSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, roadmapService } = wrap;

    const langTeacher = academicService.getUserByIdentifier('teacher.lang@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const parent = academicService.getUserByIdentifier('parent@man5he.lk')!;

    // Teacher cannot author roadmap for unassigned subject
    assert.throws(
      () =>
        roadmapService.createRoadmap(langTeacher, {
          name: 'Unauthorized Math Quest',
          description: 'Blocked',
          subjectIds: ['subj-math'],
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Math teacher creates Math quest
    const created = roadmapService.createRoadmap(mathTeacher, {
      name: 'Arithmetic Trail',
      description: 'Progressive Grade 5 arithmetic path',
      subjectIds: ['subj-math'],
      growthFormula: { baseQuestionCount: 2, incrementPerLevel: 2, maxQuestionCount: 10 },
    });
    const stg = roadmapService.createStage(mathTeacher, created.roadmap.id, {
      title: 'Stage 1: Basics',
    });

    const d1 = roadmapService.upsertLevel(mathTeacher, created.roadmap.id, {
      stageId: stg.id,
      sequenceOrder: 1,
      title: 'Level 1 Warmup',
      subjectIds: ['subj-math'],
      autoGenerateMissions: true,
    });
    const lvl1 = d1.levels[0];
    assert.ok(d1.missions.length >= 1);

    // Reject self-cyclic prerequisite
    assert.throws(
      () =>
        roadmapService.upsertLevel(mathTeacher, created.roadmap.id, {
          id: lvl1.id,
          stageId: stg.id,
          sequenceOrder: 1,
          title: 'Level 1 Warmup',
          prerequisiteLevelIds: [lvl1.id],
        }),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );

    // Teacher submits for review -> Admin publishes
    roadmapService.transitionRoadmapStatus(mathTeacher, created.roadmap.id, {
      toStatus: 'PENDING_REVIEW',
    });
    const published = roadmapService.transitionRoadmapStatus(admin, created.roadmap.id, {
      toStatus: 'PUBLISHED',
    });
    assert.equal(published.roadmap.status, 'PUBLISHED');

    // Parent schedules a mission into student timetable + reminder job
    const sched = roadmapService.scheduleMissionToTimetable(parent, {
      studentId: 'usr-student-1',
      missionId: d1.missions[0].id,
      startDate: '2026-12-10',
      timeOfDay: '17:00',
    });
    assert.ok(sched.sessionId.startsWith('SS-'));
  });

  it('2. Blocks locked level missions, hides correctIndex, guarantees idempotent completion without double rewards, unlocks Level 2, and triggers remedial missions cleanly', () => {
    const wrap = createTempRoadmapSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, roadmapService, db } = wrap;

    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;
    const parent = academicService.getUserByIdentifier('parent@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const langTeacher = academicService.getUserByIdentifier('teacher.lang@man5he.lk')!;

    const dashboard = roadmapService.getStudentDashboard(student);
    assert.ok(dashboard.roadmaps.length >= 2);

    const island = dashboard.roadmaps.find((r) => r.roadmap.id === 'RMAP-SCHOLAR-ADVENTURE')!;
    assert.ok(island);

    // Locked Level 2 cannot be started before Level 1 completes
    const lockedLevel = island.studentProgress!.levelProgress.find((lp) => lp.status === 'LOCKED')!;
    const lockedMission = island.missions.find((m) => m.levelId === lockedLevel.levelId)!;
    assert.throws(
      () => roadmapService.startMission(student, lockedMission.id),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    const getCorrectAnswers = (qIds: string[], allWrong = false) =>
      qIds.map((qId) => {
        const row = db.db.prepare('SELECT correct_index FROM questions WHERE id = ?').get(qId) as {
          correct_index: number;
        };
        return {
          questionId: qId,
          selectedIndex: allWrong ? (row.correct_index + 1) % 4 : row.correct_index,
          hintUsed: false,
          responseDurationMs: 5000,
        };
      });

    // Complete Level 1 (RMIS-1) -> unlocks Level 2 (RLVL-2)
    const startLvl1 = roadmapService.startMission(student, 'RMIS-1');
    assert.equal('correctIndex' in startLvl1.questions[0], false);

    const starsBefore = (
      db.db.prepare('SELECT stars FROM users WHERE id = ?').get(student.id) as { stars: number }
    ).stars;

    const compLvl1 = roadmapService.completeMission(student, 'RMIS-1', {
      missionAttemptId: startLvl1.missionAttemptId,
      idempotencyKey: 'e08-prac-idem-1',
      answers: getCorrectAnswers(startLvl1.questions.map((q) => q.id)),
      durationSeconds: 60,
      observedActiveSeconds: 55,
    });
    assert.equal(compLvl1.attempt.masteryPassed, true);
    assert.equal(compLvl1.levelEvaluation.completedJustNow, true);
    assert.ok(compLvl1.levelEvaluation.unlockedNextLevels.some((u) => u.levelId === 'RLVL-2'));
    assert.ok(compLvl1.rewardsGranted.some((r) => r.rewardType === 'xp'));

    const starsAfterFirst = (
      db.db.prepare('SELECT stars FROM users WHERE id = ?').get(student.id) as { stars: number }
    ).stars;
    assert.ok(starsAfterFirst > starsBefore);

    // Duplicate replay returns identical completion without double stars/XP
    const compLvl1Replay = roadmapService.completeMission(student, 'RMIS-1', {
      missionAttemptId: startLvl1.missionAttemptId,
      idempotencyKey: 'e08-prac-idem-1',
      answers: getCorrectAnswers(startLvl1.questions.map((q) => q.id)),
      durationSeconds: 60,
      observedActiveSeconds: 55,
    });
    const starsAfterReplay = (
      db.db.prepare('SELECT stars FROM users WHERE id = ?').get(student.id) as { stars: number }
    ).stars;
    assert.equal(starsAfterReplay, starsAfterFirst);
    assert.equal(compLvl1Replay.attempt.id, compLvl1.attempt.id);

    // Complete RMIS-2 puzzle in Level 2
    const startM2 = roadmapService.startMission(student, 'RMIS-2');
    roadmapService.completeMission(student, 'RMIS-2', {
      missionAttemptId: startM2.missionAttemptId,
      idempotencyKey: 'e08-m2-1',
      answers: getCorrectAnswers(startM2.questions.map((q) => q.id)),
      durationSeconds: 45,
      observedActiveSeconds: 40,
    });

    // Fail Level 2 Mastery Checkpoint (RMIS-3) -> spawns non-blocking remedial mission
    const startFailCk = roadmapService.startMission(student, 'RMIS-3');
    const compFailCk = roadmapService.completeMission(student, 'RMIS-3', {
      missionAttemptId: startFailCk.missionAttemptId,
      idempotencyKey: 'e08-ck-fail-1',
      answers: getCorrectAnswers(startFailCk.questions.map((q) => q.id), true),
      durationSeconds: 45,
      observedActiveSeconds: 40,
    });
    assert.equal(compFailCk.attempt.masteryPassed, false);
    assert.equal(compFailCk.remediationSuggestion?.triggered, true);
    assert.ok(compFailCk.remediationSuggestion?.remedialMissionId);

    // Pass Level 2 Mastery Checkpoint -> completes Level 2 & unlocks Level 3
    const startPassCk = roadmapService.startMission(student, 'RMIS-3');
    const compPassCk = roadmapService.completeMission(student, 'RMIS-3', {
      missionAttemptId: startPassCk.missionAttemptId,
      idempotencyKey: 'e08-ck-pass-1',
      answers: getCorrectAnswers(startPassCk.questions.map((q) => q.id)),
      durationSeconds: 70,
      observedActiveSeconds: 65,
    });
    assert.equal(compPassCk.attempt.masteryPassed, true);
    assert.equal(compPassCk.levelEvaluation.completedJustNow, true);
    assert.ok(compPassCk.levelEvaluation.unlockedNextLevels.some((u) => u.levelId === 'RLVL-3'));

    // Parent & Teacher progress reports work and stay scoped
    const parentReport = roadmapService.getRoadmapProgressReport(parent, student.id);
    assert.ok(parentReport.some((r) => r.completedLevelsCount >= 2));

    const teacherReport = roadmapService.getRoadmapProgressReport(mathTeacher, student.id);
    assert.ok(teacherReport.some((r) => r.roadmapId === 'RMAP-MATH-MASTERY'));
    assert.throws(
      () => roadmapService.getRoadmapProgressReport(langTeacher, student.id, 'RMAP-MATH-MASTERY'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
  });
});
