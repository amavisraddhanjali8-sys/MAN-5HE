import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateCountsByWeights,
  buildAllocationPlan,
  computeMaterialHash,
  planRoutineOccurrences,
  resolveQuestionDifficultyBucket,
  selectQuestionsForWeightedRoutine,
  validateRoutineConfig,
} from './routineEngine.ts';
import type {
  AcademicRoutineConfigInput,
  QuestionStats,
  QuizItem,
  StudentQuestionStat,
} from './types.ts';

function makeQuiz(
  id: string,
  subjectId: string,
  tier: 'Simple' | 'Moderate' | 'Challenging' | 'Master' = 'Moderate',
  topicId = 'top-math-arith',
  cognitiveSkill = 'Numerical Reasoning'
): QuizItem {
  return {
    id,
    source: 'curated',
    subjectId,
    topicId,
    grade: 'Grade 5',
    questionType: 'mcq',
    cognitiveSkill,
    hint: 'Step back and check the units.',
    questionSi: `ප්‍රශ්නය ${id}`,
    questionEn: `Question ${id}`,
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    memoryTrickTitle: 'Trick',
    memoryTrickBody: 'Think carefully.',
    explanation: 'Clear explanation.',
    approvalStatus: 'ACTIVE',
    createdAt: '2026-11-20T00:00:00.000Z',
    attributes: {
      cognitiveDomain: 'Mathematics & Word Problems',
      intelligenceMeasure: 60,
      correctProbability: 0.65,
      wrongProbability: 0.35,
      examPriority: 7,
      quizStrength: 75,
      difficultyTier: tier,
      estimatedSeconds: 45,
    },
  };
}

function makeBaseInput(overrides: Partial<AcademicRoutineConfigInput> = {}): AcademicRoutineConfigInput {
  return {
    studentId: 'usr-student-1',
    title: 'Focused Mixed Weekly Routine',
    description: 'Balanced Grade 5 Math and Logic study.',
    grade: 'Grade 5',
    startDate: '2026-12-01',
    startTimeOfDay: '16:30',
    timezone: 'Asia/Colombo',
    recurrenceType: 'weekly',
    weekdays: [1, 3, 5],
    totalDurationWeeks: 2,
    mixingMethod: 'mixed_session',
    subjectWeights: [
      { subjectId: 'subj-math', weightPercent: 60, enabled: true, topicIds: [], subtopicIds: [] },
      { subjectId: 'subj-logic', weightPercent: 40, enabled: true, topicIds: [], subtopicIds: [] },
    ],
    skillWeights: [
      { skillKey: 'numerical_ability', weightPercent: 50, enabled: true, isEducationalCategory: true },
      { skillKey: 'logical_reasoning', weightPercent: 50, enabled: true, isEducationalCategory: true },
    ],
    difficultyDistribution: {
      simple: 20,
      moderate: 50,
      difficult: 30,
      useEmpiricalCalibration: true,
    },
    questionCountPerSession: 10,
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

describe('routineEngine — Weighted Allocation, Empirical Calibration, Material Hash & Selection', () => {
  it('allocates exact integer counts summing to totalCount with Hamilton largest-remainder', () => {
    const alloc = allocateCountsByWeights(10, [
      { key: 'subj-math', weightPercent: 60 },
      { key: 'subj-logic', weightPercent: 25 },
      { key: 'subj-sinhala', weightPercent: 15 },
    ]);
    assert.equal(alloc['subj-math'] + alloc['subj-logic'] + alloc['subj-sinhala'], 10);
    assert.equal(alloc['subj-math'], 6);

    const plan = buildAllocationPlan({
      questionCount: 15,
      subjectWeights: [
        { subjectId: 'subj-math', weightPercent: 50, enabled: true, topicIds: [], subtopicIds: [] },
        { subjectId: 'subj-logic', weightPercent: 30, enabled: true, topicIds: [], subtopicIds: [] },
        { subjectId: 'subj-sinhala', weightPercent: 20, enabled: true, topicIds: [], subtopicIds: [] },
      ],
      skillWeights: [
        { skillKey: 'numerical_ability', weightPercent: 60, enabled: true, isEducationalCategory: true },
        { skillKey: 'logical_reasoning', weightPercent: 40, enabled: true, isEducationalCategory: true },
      ],
      difficultyDistribution: { simple: 34, moderate: 33, difficult: 33, useEmpiricalCalibration: true },
    });
    const diffTotal =
      plan.difficultyTargets.simple + plan.difficultyTargets.moderate + plan.difficultyTargets.difficult;
    assert.equal(diffTotal, 15);
  });

  it('rejects invalid weights not summing to 100% and single-subject mismatch', () => {
    const badWeights = validateRoutineConfig(
      makeBaseInput({
        subjectWeights: [
          { subjectId: 'subj-math', weightPercent: 55, enabled: true, topicIds: [], subtopicIds: [] },
          { subjectId: 'subj-logic', weightPercent: 30, enabled: true, topicIds: [], subtopicIds: [] },
        ],
      })
    );
    assert.equal(badWeights.valid, false);
    assert.ok(badWeights.errors.some((e) => e.includes('100%')));

    const badSingle = validateRoutineConfig(
      makeBaseInput({ mixingMethod: 'single_subject' })
    );
    assert.equal(badSingle.valid, false);
  });

  it('uses empirical difficulty when validAttempts >= 10 and falls back to author metadata otherwise', () => {
    const q = makeQuiz('Q-1', 'subj-math', 'Simple');
    const fewStats: Pick<QuestionStats, 'validAttempts' | 'correctRate'> = {
      validAttempts: 6,
      correctRate: 25,
    };
    const lowRes = resolveQuestionDifficultyBucket(q, fewStats, true);
    assert.equal(lowRes.calibrationSource, 'author_metadata');
    assert.equal(lowRes.effectiveTier, 'simple');

    const reliableStats: Pick<QuestionStats, 'validAttempts' | 'correctRate'> = {
      validAttempts: 24,
      correctRate: 32,
    };
    const empRes = resolveQuestionDifficultyBucket(q, reliableStats, true);
    assert.equal(empRes.calibrationSource, 'empirical_reliable');
    assert.equal(empRes.effectiveTier, 'difficult');
    assert.ok(empRes.discrepancyNote?.includes('Author marked "simple"'));
  });

  it('keeps material hash unchanged for non-material text tweaks and changes it on allocation edits', () => {
    const base = makeBaseInput();
    const renamed = makeBaseInput({ title: 'Edited Display Title Only', description: 'Polished parent notes' });
    assert.equal(computeMaterialHash(base), computeMaterialHash(renamed));

    const reweighted = makeBaseInput({
      subjectWeights: [
        { subjectId: 'subj-math', weightPercent: 50, enabled: true, topicIds: [], subtopicIds: [] },
        { subjectId: 'subj-logic', weightPercent: 50, enabled: true, topicIds: [], subtopicIds: [] },
      ],
    });
    assert.notEqual(computeMaterialHash(base), computeMaterialHash(reweighted));
  });

  it('selects weighted questions transparently and reports shortages without inventing fake questions', () => {
    const pool = [
      makeQuiz('QM-1', 'subj-math', 'Simple'),
      makeQuiz('QM-2', 'subj-math', 'Moderate'),
      makeQuiz('QM-3', 'subj-math', 'Challenging'),
      makeQuiz('QL-1', 'subj-logic', 'Moderate', 'top-logic-seq', 'Logical Reasoning'),
    ];
    const result = selectQuestionsForWeightedRoutine({
      questionPool: pool,
      questionStatsMap: new Map<string, QuestionStats>(),
      studentStatsMap: new Map<string, StudentQuestionStat>(),
      questionSkillMap: new Map(),
      repeatedErrorQuestionIds: new Set(),
      subjectWeights: [
        { subjectId: 'subj-math', weightPercent: 60, enabled: true, topicIds: [], subtopicIds: [] },
        { subjectId: 'subj-logic', weightPercent: 40, enabled: true, topicIds: [], subtopicIds: [] },
      ],
      skillWeights: [
        { skillKey: 'numerical_ability', weightPercent: 60, enabled: true, isEducationalCategory: true },
        { skillKey: 'logical_reasoning', weightPercent: 40, enabled: true, isEducationalCategory: true },
      ],
      difficultyDistribution: { simple: 30, moderate: 50, difficult: 20, useEmpiricalCalibration: true },
      grade: 'Grade 5',
      questionCount: 10,
      exposurePreference: 'all',
    });

    assert.equal(result.selectedCount, 4);
    assert.ok(result.shortages.some((s) => s.dimension === 'overall' && s.shortfall === 6));
    assert.ok(result.unmetTargets.length > 0);
  });

  it('builds occurrence slots cleanly for mixed_session and separate_sessions mixing', () => {
    const pool = [makeQuiz('QM-1', 'subj-math'), makeQuiz('QL-1', 'subj-logic')];
    const separateSlots = planRoutineOccurrences({
      input: makeBaseInput({ mixingMethod: 'separate_sessions', totalDurationWeeks: 1 }),
      selectedQuestions: pool,
      maxOccurrences: 2,
    });
    assert.equal(separateSlots.length, 4);
  });
});
