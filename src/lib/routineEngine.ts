import { convertLocalDateTimeToUtcIso, expandRecurrenceDates, isValidTimeZone } from './learningScheduler.ts';
import type {
  AcademicRoutineConfigInput,
  CalibratedDifficultyResolution,
  EducationalSkillCategory,
  LearningActivityType,
  PlannedRoutineSlot,
  QuestionStats,
  QuizItem,
  RoutineAdaptiveBounds,
  RoutineDifficultyBucket,
  RoutineDifficultyDistribution,
  RoutineQuestionSelectionResult,
  RoutineSkillWeight,
  RoutineSubjectWeight,
  StudentQuestionStat,
  WeightedAllocationPlan,
} from './types.ts';

export const EDUCATIONAL_SKILL_DISCLAIMER =
  'Skill categories represent educational practice focus areas for Grade 5 preparation (not clinical, psychological, or medical assessments).';

export interface EducationalSkillDefinition {
  key: EducationalSkillCategory;
  label: string;
  description: string;
  defaultSubjects: string[];
}

export const EDUCATIONAL_SKILL_DEFINITIONS: EducationalSkillDefinition[] = [
  {
    key: 'recall',
    label: 'Recall & Fact Retrieval',
    description: 'Remembering curriculum facts, vocabulary, proverbs, and definitions.',
    defaultSubjects: ['subj-env', 'subj-sinhala', 'subj-english'],
  },
  {
    key: 'numerical_ability',
    label: 'Numerical Ability',
    description: 'Accurate arithmetic operations, money, time, and measurement conversions.',
    defaultSubjects: ['subj-math'],
  },
  {
    key: 'logical_reasoning',
    label: 'Logical Reasoning',
    description: 'Identifying sequence rules, ordering queues, and deductive relationships.',
    defaultSubjects: ['subj-logic', 'subj-math'],
  },
  {
    key: 'reading_comprehension',
    label: 'Reading Comprehension',
    description: 'Extracting exact meaning from bilingual passages and story prompts.',
    defaultSubjects: ['subj-sinhala', 'subj-english'],
  },
  {
    key: 'problem_solving',
    label: 'Problem-Solving',
    description: 'Breaking multi-step word stories into manageable calculation steps.',
    defaultSubjects: ['subj-math', 'subj-logic'],
  },
  {
    key: 'spatial_reasoning',
    label: 'Spatial Reasoning',
    description: 'Visualizing perimeter, symmetry, mirror patterns, and geometric shapes.',
    defaultSubjects: ['subj-spatial'],
  },
  {
    key: 'attention_to_detail',
    label: 'Attention to Detail',
    description: 'Spotting subtle wording cues, units, overlap (-1), and grammar particles.',
    defaultSubjects: ['subj-sinhala', 'subj-logic', 'subj-math'],
  },
  {
    key: 'time_management',
    label: 'Time Management',
    description: 'Practicing steady pacing on timed practice and mock exam items.',
    defaultSubjects: ['subj-math', 'subj-logic', 'subj-spatial'],
  },
  {
    key: 'critical_thinking',
    label: 'Critical Thinking',
    description: 'Comparing options carefully and avoiding common scholarship distractors.',
    defaultSubjects: ['subj-logic', 'subj-env', 'subj-english'],
  },
];

export const SKILL_LABEL_MAP = new Map<EducationalSkillCategory, string>(
  EDUCATIONAL_SKILL_DEFINITIONS.map((d) => [d.key, d.label])
);

export const DEFAULT_ADAPTIVE_BOUNDS: RoutineAdaptiveBounds = {
  maxDailyShiftMinutes: 15,
  maxDifficultyShiftPercent: 15,
  maxSubjectWeightShiftPercent: 15,
  allowQuestionSubstitution: true,
  notifyParentOnAdjustment: true,
  requireApprovalOutsideBounds: true,
};

export function normalizeDifficultyBucket(rawTier?: string | null): RoutineDifficultyBucket {
  const lower = String(rawTier || 'moderate').toLowerCase().trim();
  if (lower === 'simple' || lower === 'easy' || lower === 'foundation') return 'simple';
  if (lower === 'challenging' || lower === 'master' || lower === 'difficult' || lower === 'hard') {
    return 'difficult';
  }
  return 'moderate';
}

export function resolveQuestionDifficultyBucket(
  question: QuizItem,
  stats?: Pick<QuestionStats, 'validAttempts' | 'correctRate'> | null,
  useEmpiricalCalibration = true
): CalibratedDifficultyResolution {
  const authorTier = normalizeDifficultyBucket(question.attributes?.difficultyTier);
  const validAttempts = Number(stats?.validAttempts ?? 0);
  const correctRate =
    stats && Number.isFinite(stats.correctRate) && validAttempts > 0
      ? Number(stats.correctRate)
      : null;

  let empiricalTier: RoutineDifficultyBucket | null = null;
  if (validAttempts >= 10 && correctRate !== null) {
    if (correctRate >= 75) empiricalTier = 'simple';
    else if (correctRate >= 45) empiricalTier = 'moderate';
    else empiricalTier = 'difficult';
  }

  const useEmpirical = Boolean(useEmpiricalCalibration && empiricalTier !== null);
  const effectiveTier = useEmpirical && empiricalTier ? empiricalTier : authorTier;
  const discrepancyNote =
    empiricalTier && empiricalTier !== authorTier
      ? `Author marked "${authorTier}" but ${validAttempts} empirical attempts show ${correctRate?.toFixed(0)}% accuracy ("${empiricalTier}").`
      : null;

  return {
    questionId: question.id,
    authorTier,
    empiricalTier,
    effectiveTier,
    calibrationSource: useEmpirical ? 'empirical_reliable' : 'author_metadata',
    validAttempts,
    correctRate,
    discrepancyNote,
  };
}

export function mapQuestionToDefaultSkills(question: QuizItem): EducationalSkillCategory[] {
  const skills = new Set<EducationalSkillCategory>();
  const cog = String(question.cognitiveSkill || '').toLowerCase();
  const text = `${question.questionEn || ''} ${question.questionSi || ''} ${question.learningObjectives || ''}`.toLowerCase();
  const subj = question.subjectId || '';

  if (subj === 'subj-math') {
    skills.add('numerical_ability');
    skills.add('problem_solving');
  } else if (subj === 'subj-logic') {
    skills.add('logical_reasoning');
    skills.add('critical_thinking');
  } else if (subj === 'subj-spatial') {
    skills.add('spatial_reasoning');
    skills.add('attention_to_detail');
  } else if (subj === 'subj-sinhala' || subj === 'subj-english') {
    skills.add('reading_comprehension');
    skills.add('recall');
  } else if (subj === 'subj-env') {
    skills.add('recall');
    skills.add('critical_thinking');
  }

  if (cog.includes('recall') || cog.includes('memory') || cog.includes('vocab')) {
    skills.add('recall');
  }
  if (cog.includes('numeric') || cog.includes('comput')) {
    skills.add('numerical_ability');
  }
  if (cog.includes('reason') || cog.includes('logic') || cog.includes('multi-step')) {
    skills.add('logical_reasoning');
    skills.add('problem_solving');
  }
  if (cog.includes('comprehen')) {
    skills.add('reading_comprehension');
  }
  if (cog.includes('spatial') || cog.includes('geom')) {
    skills.add('spatial_reasoning');
  }

  if (text.includes('queue') || text.includes('difference') || text.includes('careful') || text.includes('particle')) {
    skills.add('attention_to_detail');
  }
  if (Number(question.attributes?.estimatedSeconds ?? 35) >= 40) {
    skills.add('time_management');
  }

  if (skills.size === 0) {
    skills.add('problem_solving');
  }
  return Array.from(skills).slice(0, 3);
}

/**
 * Deterministic largest-remainder (Hamilton) allocation so integer counts sum
 * exactly to totalCount without silent drift or floating-point rounding loss.
 */
export function allocateCountsByWeights<T extends string>(
  totalCount: number,
  weightedItems: { key: T; weightPercent: number }[]
): Record<T, number> {
  const result = {} as Record<T, number>;
  const active = weightedItems.filter((w) => Number(w.weightPercent) > 0);
  for (const w of weightedItems) {
    result[w.key] = 0;
  }
  if (totalCount <= 0 || active.length === 0) return result;

  const totalWeight = active.reduce((s, w) => s + Number(w.weightPercent), 0);
  if (totalWeight <= 0) return result;

  const shares = active.map((w, idx) => {
    const exact = (totalCount * Number(w.weightPercent)) / totalWeight;
    const floorVal = Math.floor(exact);
    return {
      key: w.key,
      idx,
      floorVal,
      remainder: exact - floorVal,
    };
  });

  let assigned = shares.reduce((s, item) => s + item.floorVal, 0);
  for (const s of shares) {
    result[s.key] = s.floorVal;
  }

  shares.sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) return b.remainder - a.remainder;
    return a.key.localeCompare(b.key);
  });

  let cursor = 0;
  while (assigned < totalCount && shares.length > 0) {
    const target = shares[cursor % shares.length];
    result[target.key] = (result[target.key] || 0) + 1;
    assigned++;
    cursor++;
  }
  return result;
}

export function buildAllocationPlan(params: {
  questionCount: number;
  subjectWeights: RoutineSubjectWeight[];
  skillWeights: RoutineSkillWeight[];
  difficultyDistribution: RoutineDifficultyDistribution;
}): WeightedAllocationPlan {
  const count = Math.max(1, Math.round(params.questionCount));
  const enabledSubj = params.subjectWeights.filter((s) => s.enabled && s.weightPercent > 0);
  const enabledSkills = params.skillWeights.filter((s) => s.enabled && s.weightPercent > 0);

  const subjectTargets = allocateCountsByWeights(
    count,
    enabledSubj.map((s) => ({ key: s.subjectId, weightPercent: s.weightPercent }))
  );
  const skillTargets = allocateCountsByWeights(
    count,
    enabledSkills.map((s) => ({ key: s.skillKey, weightPercent: s.weightPercent }))
  );
  const difficultyTargets = allocateCountsByWeights<RoutineDifficultyBucket>(count, [
    { key: 'simple', weightPercent: Math.max(0, Number(params.difficultyDistribution.simple || 0)) },
    { key: 'moderate', weightPercent: Math.max(0, Number(params.difficultyDistribution.moderate || 0)) },
    { key: 'difficult', weightPercent: Math.max(0, Number(params.difficultyDistribution.difficult || 0)) },
  ]);

  return {
    questionCount: count,
    subjectTargets,
    skillTargets,
    difficultyTargets,
  };
}

export function computeMaterialHash(input: AcademicRoutineConfigInput): string {
  const canonical = {
    grade: input.grade || 'Grade 5',
    startDate: input.startDate,
    endDate: input.endDate || null,
    totalDurationWeeks: input.totalDurationWeeks || null,
    recurrenceType: input.recurrenceType,
    weekdays: [...(input.weekdays || [])].sort(),
    mixingMethod: input.mixingMethod,
    subjectWeights: [...(input.subjectWeights || [])]
      .filter((s) => s.enabled)
      .map((s) => ({
        subjectId: s.subjectId,
        weightPercent: Number(s.weightPercent),
        topicIds: [...(s.topicIds || [])].sort(),
        subtopicIds: [...(s.subtopicIds || [])].sort(),
      }))
      .sort((a, b) => a.subjectId.localeCompare(b.subjectId)),
    skillWeights: [...(input.skillWeights || [])]
      .filter((s) => s.enabled)
      .map((s) => ({ skillKey: s.skillKey, weightPercent: Number(s.weightPercent) }))
      .sort((a, b) => a.skillKey.localeCompare(b.skillKey)),
    difficultyDistribution: input.difficultyDistribution,
    questionCountPerSession: Number(input.questionCountPerSession),
    sessionDurationMinutes: Number(input.sessionDurationMinutes),
    practiceRatioPercent: Number(input.practiceRatioPercent),
    exposurePreference: input.exposurePreference,
    scheduleMode: input.scheduleMode,
    breakIntervalMinutes: Number(input.breakIntervalMinutes),
    breakDurationMinutes: Number(input.breakDurationMinutes),
    dailyRuleOverrides: input.dailyRuleOverrides || [],
  };
  const str = JSON.stringify(canonical);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `mh_${(h >>> 0).toString(16)}`;
}

export interface RoutineConfigValidationOutput {
  valid: boolean;
  errors: string[];
  warnings: string[];
  subjectWeightTotal: number;
  skillWeightTotal: number;
  difficultyTotal: number;
}

export function validateRoutineConfig(input: AcademicRoutineConfigInput): RoutineConfigValidationOutput {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!String(input.title || '').trim()) {
    errors.push('Routine title is required.');
  }
  if (!String(input.studentId || '').trim()) {
    errors.push('Target student is required.');
  }
  const tz = input.timezone || 'Asia/Colombo';
  if (!isValidTimeZone(tz)) {
    errors.push(`Invalid IANA timezone: ${tz}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate || ''))) {
    errors.push('Start date must use YYYY-MM-DD format.');
  }
  if (!/^\d{2}:\d{2}$/.test(String(input.startTimeOfDay || ''))) {
    errors.push('Start time must use HH:MM 24-hour format.');
  }
  if (input.endDate && input.startDate && input.endDate < input.startDate) {
    errors.push('End date cannot be earlier than start date.');
  }

  const enabledSubjects = (input.subjectWeights || []).filter((s) => s.enabled);
  if (enabledSubjects.length === 0) {
    errors.push('Enable at least one subject in the routine allocation.');
  }
  for (const s of input.subjectWeights || []) {
    if (Number(s.weightPercent) < 0 || Number(s.weightPercent) > 100) {
      errors.push(`Subject weight for ${s.subjectId} must be between 0% and 100%.`);
    }
    if (!s.enabled && Number(s.weightPercent) > 0) {
      errors.push(`Disabled subject ${s.subjectId} cannot retain a non-zero weight.`);
    }
  }
  const subjectWeightTotal = Math.round(
    enabledSubjects.reduce((sum, s) => sum + Number(s.weightPercent || 0), 0) * 100
  ) / 100;
  if (enabledSubjects.length > 0 && Math.abs(subjectWeightTotal - 100) > 0.01) {
    errors.push(`Enabled subject weights must total 100% (currently ${subjectWeightTotal}%).`);
  }

  if (input.mixingMethod === 'single_subject' && enabledSubjects.length !== 1) {
    errors.push('Single-subject routine requires exactly one enabled subject at 100%.');
  }
  if (input.mixingMethod !== 'single_subject' && enabledSubjects.length === 1) {
    warnings.push('Only one subject is enabled; schedule will run focused single-subject blocks.');
  }

  const enabledSkills = (input.skillWeights || []).filter((s) => s.enabled);
  const skillWeightTotal = Math.round(
    enabledSkills.reduce((sum, s) => sum + Number(s.weightPercent || 0), 0) * 100
  ) / 100;
  for (const sk of input.skillWeights || []) {
    if (Number(sk.weightPercent) < 0 || Number(sk.weightPercent) > 100) {
      errors.push(`Skill weight for ${sk.skillKey} must be between 0% and 100%.`);
    }
  }
  if (enabledSkills.length > 0 && Math.abs(skillWeightTotal - 100) > 0.01) {
    errors.push(`Enabled educational skill weights must total 100% (currently ${skillWeightTotal}%).`);
  }

  const diff = input.difficultyDistribution || { simple: 30, moderate: 50, difficult: 20, useEmpiricalCalibration: true };
  if (diff.simple < 0 || diff.moderate < 0 || diff.difficult < 0) {
    errors.push('Difficulty percentages cannot be negative.');
  }
  const difficultyTotal = Math.round((Number(diff.simple) + Number(diff.moderate) + Number(diff.difficult)) * 100) / 100;
  if (Math.abs(difficultyTotal - 100) > 0.01) {
    errors.push(`Difficulty distribution must total 100% (currently ${difficultyTotal}%).`);
  }

  if (Number(input.questionCountPerSession) < 1 || Number(input.questionCountPerSession) > 100) {
    errors.push('Question count per session must be between 1 and 100.');
  }
  if (Number(input.sessionDurationMinutes) < 5 || Number(input.sessionDurationMinutes) > 180) {
    errors.push('Session duration must be between 5 and 180 minutes.');
  }
  if (Number(input.practiceRatioPercent) < 0 || Number(input.practiceRatioPercent) > 100) {
    errors.push('Practice vs. mock ratio must be between 0% and 100%.');
  }
  if (Number(input.breakIntervalMinutes) < 10 || Number(input.breakDurationMinutes) < 0) {
    errors.push('Break interval must be at least 10 minutes and break duration cannot be negative.');
  }

  if (input.mixingMethod === 'daily_custom' && (!input.dailyRuleOverrides || input.dailyRuleOverrides.length === 0)) {
    warnings.push('Daily custom mixing is selected without weekday overrides; default subject weights will apply.');
  }
  for (const ov of input.dailyRuleOverrides || []) {
    const activeDaySubj = (ov.subjectWeights || []).filter((s) => s.enabled);
    const daySum = Math.round(activeDaySubj.reduce((s, w) => s + Number(w.weightPercent || 0), 0) * 100) / 100;
    if (activeDaySubj.length > 0 && Math.abs(daySum - 100) > 0.01) {
      errors.push(`Daily override for weekday ${ov.weekday} must total 100% (currently ${daySum}%).`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    subjectWeightTotal,
    skillWeightTotal,
    difficultyTotal,
  };
}

function deterministicScoreOffset(seed: number, id: string): number {
  let h = seed ^ 0x9e3779b9;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x85ebca6b);
  }
  return ((h >>> 0) % 1000) / 10_000;
}

export function selectQuestionsForWeightedRoutine(params: {
  questionPool: QuizItem[];
  questionStatsMap: Map<string, QuestionStats>;
  studentStatsMap: Map<string, StudentQuestionStat>;
  questionSkillMap: Map<string, EducationalSkillCategory[]>;
  repeatedErrorQuestionIds: Set<string>;
  subjectWeights: RoutineSubjectWeight[];
  skillWeights: RoutineSkillWeight[];
  difficultyDistribution: RoutineDifficultyDistribution;
  grade: string;
  questionCount: number;
  exposurePreference: AcademicRoutineConfigInput['exposurePreference'];
  excludedQuestionIds?: string[];
  seed?: number;
  subjectNameLookup?: Map<string, string>;
}): RoutineQuestionSelectionResult {
  const excludedSet = new Set(params.excludedQuestionIds || []);
  const enabledSubjects = params.subjectWeights.filter((s) => s.enabled && s.weightPercent > 0);
  const enabledSubjMap = new Map(enabledSubjects.map((s) => [s.subjectId, s]));
  const enabledSkills = params.skillWeights.filter((s) => s.enabled && s.weightPercent > 0);
  const seed = params.seed ?? 42;

  const plan = buildAllocationPlan({
    questionCount: params.questionCount,
    subjectWeights: enabledSubjects,
    skillWeights: enabledSkills,
    difficultyDistribution: params.difficultyDistribution,
  });

  // 1. Hard eligibility filter (Grade, ACTIVE approval, subject/topic/subtopic rules, exclusions)
  const hardEligible = params.questionPool.filter((q) => {
    if (excludedSet.has(q.id)) return false;
    if ((q.approvalStatus || 'ACTIVE') !== 'ACTIVE') return false;
    if (q.grade && params.grade && q.grade !== params.grade) return false;
    const sw = enabledSubjMap.get(q.subjectId || '');
    if (!sw) return false;
    if (sw.topicIds && sw.topicIds.length > 0 && !sw.topicIds.includes(q.topicId || '')) {
      return false;
    }
    if (sw.subtopicIds && sw.subtopicIds.length > 0 && !sw.subtopicIds.includes(q.subtopicId || '')) {
      return false;
    }
    return true;
  });

  // Annotate calibration + skills + exposure classification
  const annotated = hardEligible.map((q) => {
    const qStats = params.questionStatsMap.get(q.id) || null;
    const sStats = params.studentStatsMap.get(q.id) || null;
    const cal = resolveQuestionDifficultyBucket(
      q,
      qStats,
      params.difficultyDistribution.useEmpiricalCalibration
    );
    const mappedSkills = params.questionSkillMap.get(q.id) || mapQuestionToDefaultSkills(q);
    const isUnattempted = !sStats || sStats.validAttempts === 0;
    const hasIncorrect = Boolean(sStats && sStats.incorrectAttempts > 0);
    const isRepeatedError = params.repeatedErrorQuestionIds.has(q.id) || Boolean(sStats && sStats.incorrectAttempts >= 2);
    const isRevisionDue = Boolean(
      sStats &&
        sStats.validAttempts > 0 &&
        (sStats.incorrectAttempts > 0 ||
          Date.now() - Date.parse(sStats.lastAttemptAt) > 5 * 86_400_000)
    );

    let exposureMatch = true;
    let exposureScore = 1;
    if (params.exposurePreference === 'unattempted') {
      exposureMatch = isUnattempted;
      exposureScore = isUnattempted ? 5 : 0;
    } else if (params.exposurePreference === 'previously_incorrect') {
      exposureMatch = hasIncorrect;
      exposureScore = hasIncorrect ? 5 : 0;
    } else if (params.exposurePreference === 'repeated_error') {
      exposureMatch = isRepeatedError;
      exposureScore = isRepeatedError ? 6 : hasIncorrect ? 2 : 0;
    } else if (params.exposurePreference === 'revision_due') {
      exposureMatch = isRevisionDue || isUnattempted;
      exposureScore = isRevisionDue ? 5 : isUnattempted ? 3 : 1;
    } else if (params.exposurePreference === 'weak_areas') {
      exposureScore = isRepeatedError ? 6 : hasIncorrect ? 5 : isUnattempted ? 3 : 1;
    }

    return {
      question: q,
      cal,
      skills: mappedSkills,
      exposureMatch,
      exposureScore,
    };
  });

  const strictMatched =
    params.exposurePreference === 'all' || params.exposurePreference === 'weak_areas'
      ? annotated
      : annotated.filter((c) => c.exposureMatch);

  const shortages: RoutineQuestionSelectionResult['shortages'] = [];
  const unmetTargets: string[] = [];
  const substitutionNotes: string[] = [];

  if (strictMatched.length < annotated.length && strictMatched.length < plan.questionCount) {
    shortages.push({
      dimension: 'exposure',
      key: params.exposurePreference,
      label: `Exposure filter (${params.exposurePreference})`,
      requestedCount: plan.questionCount,
      availableCount: strictMatched.length,
      shortfall: plan.questionCount - strictMatched.length,
      explanation: `Only ${strictMatched.length} active question(s) strictly match "${params.exposurePreference}"; keeping preference prioritized without inventing questions.`,
    });
  }

  // Candidate pool: prefer strict exposure match first, and only backfill from remaining hard-eligible pool while recording explicit shortage/substitution notes
  const workingPool = [...strictMatched];
  if (workingPool.length < plan.questionCount) {
    const strictIds = new Set(workingPool.map((w) => w.question.id));
    const fallbackPool = annotated.filter((a) => !strictIds.has(a.question.id));
    if (fallbackPool.length > 0 && params.exposurePreference !== 'all') {
      substitutionNotes.push(
        `Included ${Math.min(fallbackPool.length, plan.questionCount - workingPool.length)} additional active approved question(s) from selected subjects after exhausting "${params.exposurePreference}" items.`
      );
      workingPool.push(...fallbackPool);
    }
  }

  // Greedy multi-criteria target matching loop
  const remainingSubj = { ...plan.subjectTargets };
  const remainingDiff = { ...plan.difficultyTargets };
  const remainingSkill = { ...plan.skillTargets };
  const chosen: typeof annotated = [];
  const chosenIds = new Set<string>();

  const targetCount = Math.min(plan.questionCount, workingPool.length);

  for (let step = 0; step < targetCount; step++) {
    let bestCandidate: (typeof annotated)[number] | null = null;
    let bestScore = -Infinity;

    for (const cand of workingPool) {
      if (chosenIds.has(cand.question.id)) continue;
      let score = cand.exposureScore * 1.5;

      const sNeed = remainingSubj[cand.question.subjectId || ''] || 0;
      if (sNeed > 0) score += 10;

      const dNeed = remainingDiff[cand.cal.effectiveTier] || 0;
      if (dNeed > 0) score += 6;

      let skillHits = 0;
      for (const sk of cand.skills) {
        if ((remainingSkill[sk] || 0) > 0) skillHits++;
      }
      score += skillHits * 4;

      if (!cand.exposureMatch) score -= 8;
      score += deterministicScoreOffset(seed, cand.question.id);

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = cand;
      }
    }

    if (!bestCandidate) break;
    chosen.push(bestCandidate);
    chosenIds.add(bestCandidate.question.id);

    const subjId = bestCandidate.question.subjectId || '';
    if ((remainingSubj[subjId] || 0) > 0) remainingSubj[subjId] -= 1;
    if ((remainingDiff[bestCandidate.cal.effectiveTier] || 0) > 0) {
      remainingDiff[bestCandidate.cal.effectiveTier] -= 1;
    }
    for (const sk of bestCandidate.skills) {
      if ((remainingSkill[sk] || 0) > 0) {
        remainingSkill[sk] -= 1;
        break;
      }
    }
  }

  const allocatedBySubject: Record<string, number> = {};
  const allocatedBySkill: Record<string, number> = {};
  const allocatedByDifficulty: Record<RoutineDifficultyBucket, number> = {
    simple: 0,
    moderate: 0,
    difficult: 0,
  };

  for (const c of chosen) {
    const sid = c.question.subjectId || 'unknown';
    allocatedBySubject[sid] = (allocatedBySubject[sid] || 0) + 1;
    allocatedByDifficulty[c.cal.effectiveTier] += 1;
    for (const sk of c.skills) {
      allocatedBySkill[sk] = (allocatedBySkill[sk] || 0) + 1;
    }
  }

  if (chosen.length < plan.questionCount) {
    shortages.push({
      dimension: 'overall',
      key: 'total_questions',
      label: 'Total Approved Questions',
      requestedCount: plan.questionCount,
      availableCount: chosen.length,
      shortfall: plan.questionCount - chosen.length,
      explanation: `Requested ${plan.questionCount} question(s), but only ${chosen.length} approved active question(s) exist for these criteria.`,
    });
    unmetTargets.push(`Overall count shortfall: ${chosen.length}/${plan.questionCount} questions available.`);
  }

  for (const [sid, target] of Object.entries(plan.subjectTargets)) {
    const actual = allocatedBySubject[sid] || 0;
    if (actual < target) {
      const sLabel = params.subjectNameLookup?.get(sid) || sid;
      shortages.push({
        dimension: 'subject',
        key: sid,
        label: sLabel,
        requestedCount: target,
        availableCount: actual,
        shortfall: target - actual,
        explanation: `${sLabel} targeted ${target} question(s) but only ${actual} active match(es) were available.`,
      });
      unmetTargets.push(`${sLabel}: ${actual}/${target} targeted questions.`);
    }
  }

  for (const tier of ['simple', 'moderate', 'difficult'] as RoutineDifficultyBucket[]) {
    const target = plan.difficultyTargets[tier] || 0;
    const actual = allocatedByDifficulty[tier] || 0;
    if (actual < target) {
      shortages.push({
        dimension: 'difficulty',
        key: tier,
        label: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Difficulty`,
        requestedCount: target,
        availableCount: actual,
        shortfall: target - actual,
        explanation: `Targeted ${target} ${tier} question(s); ${actual} available matching active bank rules.`,
      });
      unmetTargets.push(`Difficulty "${tier}": ${actual}/${target}.`);
    }
  }

  for (const [sk, target] of Object.entries(plan.skillTargets)) {
    const actual = allocatedBySkill[sk] || 0;
    if (target > 0 && actual === 0) {
      const label = SKILL_LABEL_MAP.get(sk as EducationalSkillCategory) || sk;
      shortages.push({
        dimension: 'skill',
        key: sk,
        label,
        requestedCount: target,
        availableCount: 0,
        shortfall: target,
        explanation: `No eligible active questions currently carry skill focus "${label}".`,
      });
      unmetTargets.push(`Skill "${label}": 0/${target}.`);
    }
  }

  return {
    requestedCount: plan.questionCount,
    selectedCount: chosen.length,
    selectedQuestions: chosen.map((c) => c.question),
    allocatedBySubject,
    allocatedBySkill,
    allocatedByDifficulty,
    calibratedResolutions: chosen.map((c) => c.cal),
    shortages,
    unmetTargets,
    substitutionNotes,
  };
}

export function planRoutineOccurrences(params: {
  input: AcademicRoutineConfigInput;
  selectedQuestions: QuizItem[];
  subjectNameLookup?: Map<string, string>;
  maxOccurrences?: number;
}): PlannedRoutineSlot[] {
  const { input } = params;
  const tz = isValidTimeZone(input.timezone || 'Asia/Colombo')
    ? (input.timezone || 'Asia/Colombo')
    : 'Asia/Colombo';

  let effectiveEndDate = input.endDate || undefined;
  if (!effectiveEndDate && input.totalDurationWeeks && input.totalDurationWeeks > 0) {
    const baseMs = Date.parse(`${input.startDate}T00:00:00Z`);
    const endMs = baseMs + input.totalDurationWeeks * 7 * 86_400_000;
    effectiveEndDate = new Date(endMs).toISOString().slice(0, 10);
  }

  const dates = expandRecurrenceDates({
    startDate: input.startDate,
    endDate: effectiveEndDate,
    recurrenceType: input.recurrenceType,
    weekdays: input.weekdays,
    exceptionDates: input.exceptionDates,
    maxOccurrences: params.maxOccurrences ?? 30,
  });

  const enabledSubjects = input.subjectWeights.filter((s) => s.enabled && s.weightPercent > 0);
  const overrideMap = new Map(
    (input.dailyRuleOverrides || []).map((o) => [o.weekday, o])
  );
  const mockEveryN = Math.max(1, Number(input.mockFrequencyDays || 5));
  const practiceRatio = Number(input.practiceRatioPercent ?? 75);

  const slots: PlannedRoutineSlot[] = [];

  dates.forEach((localDate, occIdx) => {
    const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
    const dayOverride = input.mixingMethod === 'daily_custom' ? overrideMap.get(weekday) : undefined;
    const dayTime = dayOverride?.timeOfDay || input.startTimeOfDay;
    const dayDuration = Math.max(
      5,
      Math.min(180, Number(dayOverride?.durationMinutes ?? input.sessionDurationMinutes))
    );

    const activeDayWeights = (
      dayOverride?.subjectWeights?.length ? dayOverride.subjectWeights : enabledSubjects
    ).filter((s) => s.enabled && s.weightPercent > 0);

    const isMockDay =
      practiceRatio === 0 ||
      (practiceRatio < 100 && (occIdx + 1) % mockEveryN === 0);
    const activityType: LearningActivityType = isMockDay ? 'mock_exam' : 'practice';

    const breakNote =
      dayDuration > input.breakIntervalMinutes && input.breakDurationMinutes > 0
        ? `Includes recommended ${input.breakDurationMinutes}-minute break every ${input.breakIntervalMinutes} minutes.`
        : null;

    if (input.mixingMethod === 'separate_sessions' && activeDayWeights.length > 1) {
      let offsetMinutes = 0;
      const perBlockMin = Math.max(10, Math.round(dayDuration / activeDayWeights.length));
      for (const sw of activeDayWeights) {
        const startBaseUtc = convertLocalDateTimeToUtcIso(localDate, dayTime, tz);
        const startMs = Date.parse(startBaseUtc) + offsetMinutes * 60_000;
        const endMs = startMs + perBlockMin * 60_000;
        const sName = params.subjectNameLookup?.get(sw.subjectId) || sw.subjectId;
        const qIds = params.selectedQuestions
          .filter((q) => q.subjectId === sw.subjectId)
          .map((q) => q.id);
        slots.push({
          occurrenceIndex: occIdx,
          localDate,
          timeOfDay: dayTime,
          startUtc: new Date(startMs).toISOString(),
          endUtc: new Date(endMs).toISOString(),
          durationMinutes: perBlockMin,
          activityType,
          title: `${input.title} — ${sName}`,
          subjectIds: [sw.subjectId],
          subjectWeightsForSlot: { [sw.subjectId]: 100 },
          questionIds: qIds.length ? qIds : params.selectedQuestions.map((q) => q.id),
          breakNote,
        });
        offsetMinutes += perBlockMin + Math.max(0, Number(input.breakDurationMinutes || 5));
      }
    } else if (input.mixingMethod === 'alternating' && activeDayWeights.length > 1) {
      // Proportional rotation cycle built from smallest weights
      const rotationPool: string[] = [];
      for (const sw of activeDayWeights) {
        const reps = Math.max(1, Math.round(sw.weightPercent / 20));
        for (let r = 0; r < reps; r++) rotationPool.push(sw.subjectId);
      }
      const chosenSubjId = rotationPool[occIdx % rotationPool.length];
      const sName = params.subjectNameLookup?.get(chosenSubjId) || chosenSubjId;
      const startUtc = convertLocalDateTimeToUtcIso(localDate, dayTime, tz);
      const endUtc = new Date(Date.parse(startUtc) + dayDuration * 60_000).toISOString();
      const qIds = params.selectedQuestions
        .filter((q) => q.subjectId === chosenSubjId)
        .map((q) => q.id);
      slots.push({
        occurrenceIndex: occIdx,
        localDate,
        timeOfDay: dayTime,
        startUtc,
        endUtc,
        durationMinutes: dayDuration,
        activityType,
        title: `${input.title} · ${sName}`,
        subjectIds: [chosenSubjId],
        subjectWeightsForSlot: { [chosenSubjId]: 100 },
        questionIds: qIds.length ? qIds : params.selectedQuestions.map((q) => q.id),
        breakNote,
      });
    } else {
      const startUtc = convertLocalDateTimeToUtcIso(localDate, dayTime, tz);
      const endUtc = new Date(Date.parse(startUtc) + dayDuration * 60_000).toISOString();
      const weightsRecord: Record<string, number> = {};
      for (const sw of activeDayWeights) {
        weightsRecord[sw.subjectId] = Number(sw.weightPercent);
      }
      slots.push({
        occurrenceIndex: occIdx,
        localDate,
        timeOfDay: dayTime,
        startUtc,
        endUtc,
        durationMinutes: dayDuration,
        activityType,
        title: input.title,
        subjectIds: activeDayWeights.map((s) => s.subjectId),
        subjectWeightsForSlot: weightsRecord,
        questionIds: params.selectedQuestions.map((q) => q.id),
        breakNote,
      });
    }
  });

  return slots;
}
