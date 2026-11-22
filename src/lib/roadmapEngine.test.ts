import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMissionRemediationNeed,
  buildProgressiveDifficultyWeights,
  computeExplorerRankFromXp,
  computeMissionRewards,
  computeProgressiveQuestionCount,
  detectPrerequisiteCycles,
  evaluateLevelCompletionEligibility,
  splitQuestionCountAcrossMissions,
} from './roadmapEngine.ts';
import type { QuizItem, RoadmapLevel, RoadmapLevelStatus, RoadmapMission } from './types.ts';

function sampleMission(overrides: Partial<RoadmapMission> = {}): RoadmapMission {
  return {
    id: 'RMIS-1',
    roadmapId: 'RMAP-1',
    versionNumber: 1,
    levelId: 'RLVL-1',
    sortOrder: 1,
    title: 'Mission 1',
    description: 'Practice steadily',
    missionType: 'topic_practice',
    subjectIds: ['subj-math'],
    topicIds: ['top-math-arith'],
    subtopicIds: [],
    questionCount: 4,
    difficultyDistribution: { Simple: 60, Moderate: 40, Challenging: 0, Master: 0 },
    timeLimitSeconds: null,
    isRequired: true,
    isRemedial: false,
    minPassAccuracyPercent: 60,
    xpReward: 30,
    starsReward: 2,
    coinsReward: 10,
    puzzleHintMode: false,
    allowRetry: true,
    maxAttemptsPerDay: 8,
    ...overrides,
  };
}

function sampleLevel(overrides: Partial<RoadmapLevel> = {}): RoadmapLevel {
  return {
    id: 'RLVL-1',
    roadmapId: 'RMAP-1',
    versionNumber: 1,
    stageId: 'RSTG-1',
    sequenceOrder: 1,
    title: 'Level 1 Foundations',
    description: 'Start strong',
    academicObjectives: ['Division fact families'],
    subjectIds: ['subj-math'],
    topicIds: ['top-math-arith'],
    subtopicIds: [],
    targetQuestionCount: 4,
    maxQuestionCount: 20,
    difficultyDistribution: { Simple: 60, Moderate: 40, Challenging: 0, Master: 0 },
    minMasteryAccuracyPercent: 70,
    requiredMissionsCount: 2,
    hasCheckpoint: true,
    specialUnlockNote: null,
    xpReward: 40,
    starsReward: 3,
    coinsReward: 15,
    unlockCosmeticId: null,
    prerequisiteLevelIds: [],
    ...overrides,
  };
}

describe('roadmapEngine — Progressive Growth, DAG Cycles, Eligibility & Fair Educational Rewards', () => {
  it('grows question count progressively with level order and caps at maxQuestionCount', () => {
    const formula = { baseQuestionCount: 4, incrementPerLevel: 3, maxQuestionCount: 15 };
    assert.equal(computeProgressiveQuestionCount({ sequenceOrder: 1, formula }), 4);
    assert.equal(computeProgressiveQuestionCount({ sequenceOrder: 2, formula }), 7);
    assert.equal(computeProgressiveQuestionCount({ sequenceOrder: 5, formula }), 15);

    const splits = splitQuestionCountAcrossMissions(14, 5);
    assert.deepEqual(splits, [5, 5, 4]);
    assert.equal(splits.reduce((a, b) => a + b, 0), 14);
  });

  it('shifts difficulty weights upward smoothly as level order advances', () => {
    const early = buildProgressiveDifficultyWeights(1, 5);
    const mid = buildProgressiveDifficultyWeights(3, 5);
    const late = buildProgressiveDifficultyWeights(5, 5);
    assert.ok(early.Simple > late.Simple);
    assert.ok(late.Challenging + late.Master > early.Challenging + early.Master);
    assert.equal(mid.Simple + mid.Moderate + mid.Challenging + mid.Master, 100);
  });

  it('detects prerequisite cycles accurately while allowing acyclic DAG progressions', () => {
    const valid = detectPrerequisiteCycles([
      { id: 'L1', prerequisiteLevelIds: [] },
      { id: 'L2', prerequisiteLevelIds: ['L1'] },
      { id: 'L3', prerequisiteLevelIds: ['L1', 'L2'] },
    ]);
    assert.equal(valid.length, 0);

    const cyclic = detectPrerequisiteCycles([
      { id: 'L1', prerequisiteLevelIds: ['L2'] },
      { id: 'L2', prerequisiteLevelIds: ['L1'] },
    ]);
    assert.ok(cyclic.length > 0);
  });

  it('requires mandatory missions and passing mastery checkpoint to complete a level', () => {
    const level = sampleLevel({ requiredMissionsCount: 2, hasCheckpoint: true, minMasteryAccuracyPercent: 75 });
    const m1 = sampleMission({ id: 'M1', isRequired: true, missionType: 'topic_practice' });
    const m2 = sampleMission({ id: 'M2', isRequired: true, missionType: 'mastery_checkpoint' });

    const incomplete = evaluateLevelCompletionEligibility({
      level,
      missions: [m1, m2],
      completedMissionIds: new Set(['M1']),
      bestCheckpointAccuracy: 60,
      checkpointPassed: false,
      prerequisiteStatuses: new Map<string, RoadmapLevelStatus>(),
      demonstratedObjectivesCount: 1,
    });
    assert.equal(incomplete.eligibleToComplete, false);
    assert.ok(incomplete.unmetCriteria.length >= 2);

    const eligible = evaluateLevelCompletionEligibility({
      level,
      missions: [m1, m2],
      completedMissionIds: new Set(['M1', 'M2']),
      bestCheckpointAccuracy: 85,
      checkpointPassed: true,
      prerequisiteStatuses: new Map<string, RoadmapLevelStatus>(),
      demonstratedObjectivesCount: 2,
    });
    assert.equal(eligible.eligibleToComplete, true);
  });

  it('prevents reward farming on already mastered missions and enforces wellbeing daily cap', () => {
    const mission = sampleMission({ xpReward: 40, starsReward: 3, coinsReward: 15 });

    const firstMastery = computeMissionRewards({
      mission,
      accuracyPercent: 95,
      masteryPassed: true,
      alreadyMasteredBefore: false,
      isWithinWellbeingDailyCap: true,
    });
    assert.equal(firstMastery.xp, 48);
    assert.equal(firstMastery.stars, 3);
    assert.equal(firstMastery.coins, 15);
    assert.equal(firstMastery.masteryAchievementEarned, true);

    const repeatFarming = computeMissionRewards({
      mission,
      accuracyPercent: 100,
      masteryPassed: true,
      alreadyMasteredBefore: true,
      isWithinWellbeingDailyCap: true,
    });
    assert.equal(repeatFarming.stars, 0);
    assert.equal(repeatFarming.coins, 0);
    assert.equal(repeatFarming.xp, 10);

    const wellbeingPaused = computeMissionRewards({
      mission,
      accuracyPercent: 95,
      masteryPassed: true,
      alreadyMasteredBefore: false,
      isWithinWellbeingDailyCap: false,
    });
    assert.equal(wellbeingPaused.stars, 0);
    assert.equal(wellbeingPaused.coins, 0);
  });

  it('detects weak topics for adaptive remediation without skipping levels and computes Explorer Ranks', () => {
    const q1 = { id: 'Q1', topicId: 'top-fractions' } as QuizItem;
    const q2 = { id: 'Q2', topicId: 'top-fractions' } as QuizItem;
    const q3 = { id: 'Q3', topicId: 'top-time' } as QuizItem;
    const rem = analyzeMissionRemediationNeed({
      questions: [q1, q2, q3],
      outcomes: [
        { questionId: 'Q1', isCorrect: false },
        { questionId: 'Q2', isCorrect: false },
        { questionId: 'Q3', isCorrect: true },
      ],
      minPassAccuracyPercent: 70,
      accuracyPercent: 33,
    });
    assert.equal(rem.needsRemediation, true);
    assert.equal(rem.weakTopicIds[0], 'top-fractions');

    const r1 = computeExplorerRankFromXp(50);
    const r2 = computeExplorerRankFromXp(150);
    assert.equal(r1.rank, 1);
    assert.equal(r2.rank, 2);
  });
});
