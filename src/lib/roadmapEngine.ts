import type {
  QuizItem,
  RoadmapDifficultyWeights,
  RoadmapGrowthFormula,
  RoadmapLevel,
  RoadmapLevelStatus,
  RoadmapMission,
  RoadmapMissionType,
  RoadmapRewardType,
  RoadmapStage,
} from './types.ts';

export const DEFAULT_ROADMAP_GROWTH_FORMULA: RoadmapGrowthFormula = {
  baseQuestionCount: 4,
  incrementPerLevel: 2,
  maxQuestionCount: 20,
  maxQuestionsPerMission: 6,
  maxSessionDurationMinutes: 30,
};

/**
 * Computes progressive question count for a level using either explicit count
 * or configurable formula, always bounded by maxQuestionCount.
 */
export function computeProgressiveQuestionCount(params: {
  sequenceOrder: number;
  explicitTargetCount?: number | null;
  formula?: Partial<RoadmapGrowthFormula>;
  levelMaxOverride?: number | null;
}): number {
  const formula = { ...DEFAULT_ROADMAP_GROWTH_FORMULA, ...(params.formula || {}) };
  const cap = Math.max(
    1,
    Math.min(100, Number(params.levelMaxOverride || formula.maxQuestionCount || 20))
  );
  if (params.explicitTargetCount && Number(params.explicitTargetCount) > 0) {
    return Math.max(1, Math.min(cap, Math.round(Number(params.explicitTargetCount))));
  }
  const order = Math.max(1, Math.round(params.sequenceOrder));
  const calculated = formula.baseQuestionCount + (order - 1) * formula.incrementPerLevel;
  return Math.max(1, Math.min(cap, calculated));
}

/**
 * Splits a level's target question count into age-appropriate bite-sized missions
 * so Grade 5 students aren't overloaded with long single sittings.
 */
export function splitQuestionCountAcrossMissions(
  totalQuestions: number,
  maxPerMission = 6
): number[] {
  const total = Math.max(1, Math.round(totalQuestions));
  const cap = Math.max(1, Math.min(20, Math.round(maxPerMission)));
  if (total <= cap) return [total];

  const missionCount = Math.ceil(total / cap);
  const base = Math.floor(total / missionCount);
  const rem = total % missionCount;
  const counts: number[] = [];
  for (let i = 0; i < missionCount; i++) {
    counts.push(base + (i < rem ? 1 : 0));
  }
  return counts;
}

/**
 * Returns progressive difficulty distribution weights by stage/sequence tier:
 * - Early levels (1): foundational Simple + Moderate
 * - Intermediate levels (2): balanced Moderate + Challenging introduction
 * - Advanced levels (3+): Challenging + Master problem solving alongside Moderate review
 */
export function buildProgressiveDifficultyWeights(
  sequenceOrder: number,
  totalLevelsInRoadmap = 4
): RoadmapDifficultyWeights {
  const progress =
    totalLevelsInRoadmap <= 1 ? 0 : (Math.max(1, sequenceOrder) - 1) / (totalLevelsInRoadmap - 1);
  if (progress <= 0.34) {
    return { Simple: 60, Moderate: 40, Challenging: 0, Master: 0 };
  }
  if (progress <= 0.67) {
    return { Simple: 25, Moderate: 55, Challenging: 20, Master: 0 };
  }
  return { Simple: 10, Moderate: 40, Challenging: 35, Master: 15 };
}

/**
 * Detects cyclic prerequisite dependencies across roadmap levels.
 */
export function detectPrerequisiteCycles(levels: Pick<RoadmapLevel, 'id' | 'prerequisiteLevelIds'>[]): string[] {
  const adj = new Map<string, string[]>();
  for (const lvl of levels) {
    adj.set(lvl.id, lvl.prerequisiteLevelIds || []);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  const cycles: string[] = [];

  const dfs = (nodeId: string) => {
    visited.add(nodeId);
    stack.add(nodeId);
    for (const dep of adj.get(nodeId) || []) {
      if (dep === nodeId) {
        cycles.push(`Level ${nodeId} cannot depend on itself.`);
        continue;
      }
      if (!visited.has(dep)) {
        dfs(dep);
      } else if (stack.has(dep)) {
        cycles.push(`Prerequisite cycle detected between ${nodeId} and ${dep}.`);
      }
    }
    stack.delete(nodeId);
  };

  for (const lvl of levels) {
    if (!visited.has(lvl.id)) dfs(lvl.id);
  }
  return cycles;
}

/**
 * Server-authoritative progression validation for completing a level and unlocking downstream levels.
 */
export function evaluateLevelCompletionEligibility(params: {
  level: RoadmapLevel;
  missions: RoadmapMission[];
  completedMissionIds: Set<string>;
  bestCheckpointAccuracy: number | null;
  checkpointPassed: boolean;
  prerequisiteStatuses: Map<string, RoadmapLevelStatus>;
  demonstratedObjectivesCount: number;
}): {
  eligibleToComplete: boolean;
  unmetCriteria: string[];
  encouragementMessage: string;
} {
  const { level, missions } = params;
  const unmetCriteria: string[] = [];

  for (const prereqId of level.prerequisiteLevelIds || []) {
    if (params.prerequisiteStatuses.get(prereqId) !== 'COMPLETED') {
      unmetCriteria.push(`Prerequisite level (${prereqId}) must be completed first.`);
    }
  }

  const requiredMissions = missions.filter((m) => m.levelId === level.id && m.isRequired);
  const completedRequired = requiredMissions.filter((m) => params.completedMissionIds.has(m.id));
  const minRequired = Math.min(
    Math.max(1, level.requiredMissionsCount || requiredMissions.length),
    Math.max(1, requiredMissions.length)
  );

  if (completedRequired.length < minRequired) {
    unmetCriteria.push(
      `Complete ${minRequired - completedRequired.length} more required mission(s) (${completedRequired.length}/${minRequired} finished).`
    );
  }

  if (level.hasCheckpoint) {
    const checkpointMissions = missions.filter(
      (m) =>
        m.levelId === level.id &&
        (m.missionType === 'mastery_checkpoint' || m.missionType === 'final_stage_challenge')
    );
    if (checkpointMissions.length > 0 && !params.checkpointPassed) {
      const currentAcc =
        params.bestCheckpointAccuracy !== null ? `${Math.round(params.bestCheckpointAccuracy)}%` : 'not yet attempted';
      unmetCriteria.push(
        `Reach ${level.minMasteryAccuracyPercent}% on the level mastery checkpoint (best: ${currentAcc}).`
      );
    }
  }

  if (level.academicObjectives.length > 0 && params.demonstratedObjectivesCount === 0 && completedRequired.length === 0) {
    unmetCriteria.push('Practice at least one learning objective in this level.');
  }

  const eligibleToComplete = unmetCriteria.length === 0;
  const encouragementMessage = eligibleToComplete
    ? `Wonderful effort! You mastered "${level.title}" and unlocked the next stage.`
    : `Great steady practice on "${level.title}"! Keep going at your own pace — every retry helps strengthen these concepts.`;

  return {
    eligibleToComplete,
    unmetCriteria,
    encouragementMessage,
  };
}

/**
 * Transparent, non-manipulative Grade 5 educational reward computation.
 * Prevents reward farming: repeated completions of an already-mastered mission only award
 * a small effort XP note (or 0 stars/coins) after daily effort check, with zero streak traps.
 */
export function computeMissionRewards(params: {
  mission: RoadmapMission;
  accuracyPercent: number;
  masteryPassed: boolean;
  alreadyMasteredBefore: boolean;
  isWithinWellbeingDailyCap: boolean;
}): {
  xp: number;
  stars: number;
  coins: number;
  masteryAchievementEarned: boolean;
  explanation: string;
} {
  const { mission, accuracyPercent, masteryPassed, alreadyMasteredBefore, isWithinWellbeingDailyCap } = params;

  if (!isWithinWellbeingDailyCap) {
    return {
      xp: 5,
      stars: 0,
      coins: 0,
      masteryAchievementEarned: false,
      explanation: 'Great effort! Daily study balance limit reached — bonus rewards pause automatically so you can rest.',
    };
  }

  if (alreadyMasteredBefore) {
    return {
      xp: 10,
      stars: 0,
      coins: 0,
      masteryAchievementEarned: false,
      explanation: 'Revision practice logged (+10 XP for steady review; milestone stars/coins were already earned).',
    };
  }

  if (!masteryPassed) {
    // Reward honest learning effort even when below mastery threshold — never punitive!
    const effortXp = Math.max(10, Math.round(mission.xpReward * 0.4));
    return {
      xp: effortXp,
      stars: 1,
      coins: 5,
      masteryAchievementEarned: false,
      explanation: `Effort recognized (+${effortXp} XP, +1 Star). Review the helpful hints and try again whenever you feel ready!`,
    };
  }

  const bonusRatio = accuracyPercent >= 90 ? 1.2 : 1.0;
  return {
    xp: Math.round(mission.xpReward * bonusRatio),
    stars: mission.starsReward,
    coins: mission.coinsReward,
    masteryAchievementEarned: accuracyPercent >= 85,
    explanation: `Mission mastered (${Math.round(accuracyPercent)}%)! Earned +${Math.round(
      mission.xpReward * bonusRatio
    )} XP, +${mission.starsReward} Stars, +${mission.coinsReward} Explorer Coins.`,
  };
}

/**
 * Adaptive remediation detector: identifies weak topics from checkpoint/mission mistakes
 * without skipping mandatory curriculum levels.
 */
export function analyzeMissionRemediationNeed(params: {
  questions: QuizItem[];
  outcomes: { questionId: string; isCorrect: boolean }[];
  minPassAccuracyPercent: number;
  accuracyPercent: number;
}): {
  needsRemediation: boolean;
  weakTopicIds: string[];
  explanation: string;
} {
  const qMap = new Map(params.questions.map((q) => [q.id, q]));
  const topicErrors = new Map<string, number>();

  for (const out of params.outcomes) {
    if (!out.isCorrect) {
      const q = qMap.get(out.questionId);
      if (q?.topicId) {
        topicErrors.set(q.topicId, (topicErrors.get(q.topicId) || 0) + 1);
      }
    }
  }

  const weakTopicIds = Array.from(topicErrors.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([topicId]) => topicId);

  const needsRemediation =
    params.accuracyPercent < params.minPassAccuracyPercent || weakTopicIds.length >= 2;

  const explanation = needsRemediation
    ? `Scored ${Math.round(params.accuracyPercent)}% (target ${params.minPassAccuracyPercent}%). A calm remedial practice round on ${weakTopicIds.length || 1} topic area(s) is suggested before retrying the checkpoint.`
    : `Strong understanding (${Math.round(params.accuracyPercent)}%) across assigned learning objectives.`;

  return {
    needsRemediation,
    weakTopicIds,
    explanation,
  };
}

export function computeExplorerRankFromXp(totalXp: number): {
  rank: number;
  xpIntoCurrentRank: number;
  xpNeededForNextRank: number;
} {
  const safeXp = Math.max(0, Math.round(totalXp));
  const step = 120;
  const rank = Math.floor(safeXp / step) + 1;
  const xpIntoCurrentRank = safeXp % step;
  return {
    rank,
    xpIntoCurrentRank,
    xpNeededForNextRank: step,
  };
}
