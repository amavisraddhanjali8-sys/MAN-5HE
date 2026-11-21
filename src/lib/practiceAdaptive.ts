import type {
  DifficultyTier,
  PaperCategoryLevel,
  QuizItem,
  StudentTrajectory,
} from './types.ts';

export type PracticeLevelMode = 'Easy' | 'Medium' | 'Hard';

export const PRACTICE_LEVEL_MODES: PracticeLevelMode[] = ['Easy', 'Medium', 'Hard'];

export interface ProficiencyStreamConfig {
  proficiencyLevel: PaperCategoryLevel;
  levelMode: PracticeLevelMode;
  allowedTiers: DifficultyTier[];
  targetTier: DifficultyTier;
  summaryLabel: string;
}

export function normalizeProficiencyLevel(
  level?: string | null
): PaperCategoryLevel {
  if (
    level === 'Foundation Simple' ||
    level === 'Balanced Standard' ||
    level === 'Advanced Challenging' ||
    level === 'Scholarship Master'
  ) {
    return level;
  }
  return 'Balanced Standard';
}

/**
 * Resolves which question DifficultyTiers belong in the practice stream
 * for a chosen Easy / Medium / Hard toggle given the student's trajectory proficiency.
 */
export function resolvePracticeStreamConfig(params: {
  levelMode: PracticeLevelMode;
  proficiencyLevel?: string | null;
}): ProficiencyStreamConfig {
  const proficiencyLevel = normalizeProficiencyLevel(params.proficiencyLevel);
  const { levelMode } = params;

  const matrix: Record<
    PaperCategoryLevel,
    Record<PracticeLevelMode, { allowedTiers: DifficultyTier[]; targetTier: DifficultyTier }>
  > = {
    'Foundation Simple': {
      Easy: { allowedTiers: ['Simple'], targetTier: 'Simple' },
      Medium: { allowedTiers: ['Simple', 'Moderate'], targetTier: 'Moderate' },
      Hard: { allowedTiers: ['Moderate', 'Challenging'], targetTier: 'Challenging' },
    },
    'Balanced Standard': {
      Easy: { allowedTiers: ['Simple'], targetTier: 'Simple' },
      Medium: { allowedTiers: ['Moderate'], targetTier: 'Moderate' },
      Hard: { allowedTiers: ['Challenging', 'Master'], targetTier: 'Challenging' },
    },
    'Advanced Challenging': {
      Easy: { allowedTiers: ['Simple', 'Moderate'], targetTier: 'Moderate' },
      Medium: { allowedTiers: ['Challenging'], targetTier: 'Challenging' },
      Hard: { allowedTiers: ['Challenging', 'Master'], targetTier: 'Master' },
    },
    'Scholarship Master': {
      Easy: { allowedTiers: ['Moderate'], targetTier: 'Moderate' },
      Medium: { allowedTiers: ['Challenging', 'Master'], targetTier: 'Challenging' },
      Hard: { allowedTiers: ['Master'], targetTier: 'Master' },
    },
  };

  const entry = matrix[proficiencyLevel][levelMode];
  const tierText = entry.allowedTiers.join(' + ');

  return {
    proficiencyLevel,
    levelMode,
    allowedTiers: entry.allowedTiers,
    targetTier: entry.targetTier,
    summaryLabel: `${levelMode} for ${proficiencyLevel} (${tierText})`,
  };
}

/**
 * Filters an incoming question stream according to the resolved trajectory proficiency
 * and selected Easy / Medium / Hard toggle.
 */
export function filterQuestionStreamByProficiency(
  quizzes: QuizItem[],
  params: {
    levelMode: PracticeLevelMode;
    trajectory?: Pick<StudentTrajectory, 'currentLevel'> | null;
    fallbackLevel?: string | null;
  }
): { filtered: QuizItem[]; config: ProficiencyStreamConfig } {
  const proficiencyLevel = params.trajectory?.currentLevel ?? params.fallbackLevel;
  const config = resolvePracticeStreamConfig({
    levelMode: params.levelMode,
    proficiencyLevel,
  });
  const allowedSet = new Set<DifficultyTier>(config.allowedTiers);
  const filtered = quizzes.filter((q) => allowedSet.has(q.attributes.difficultyTier));
  return { filtered, config };
}
