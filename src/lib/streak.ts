import type { AttemptRecord } from './types.ts';

export interface StreakBadgeTier {
  id: string;
  title: string;
  titleSi: string;
  minDays: number;
  description: string;
  tone: 'neutral' | 'blue' | 'gold' | 'green' | 'orange';
}

export const STREAK_BADGE_TIERS: StreakBadgeTier[] = [
  {
    id: 'starter',
    title: 'First Spark',
    titleSi: 'පළමු පියවර',
    minDays: 1,
    description: 'Completed your first daily practice session.',
    tone: 'blue',
  },
  {
    id: 'consistent-learner',
    title: 'Consistent Learner',
    titleSi: 'නිතිපතා ඉගෙනුම් පදක්කම',
    minDays: 5,
    description: 'Practiced regularly for 5+ consecutive days.',
    tone: 'green',
  },
  {
    id: 'streak-champion',
    title: 'Weekly Champion',
    titleSi: 'සතිපතා ජයග්‍රාහකයා',
    minDays: 7,
    description: 'Full 7-day scholarship study streak.',
    tone: 'gold',
  },
  {
    id: 'merit-guardian',
    title: 'Scholarship Master Streak',
    titleSi: 'ශිෂ්‍යත්ව විශිෂ්ට පදක්කම',
    minDays: 14,
    description: '14+ days of unstoppable Grade 5 dedication.',
    tone: 'orange',
  },
];

export interface DailyHabitSlot {
  isoDate: string;
  label: string;
  completed: boolean;
  isToday: boolean;
}

export interface DailyStreakSummary {
  streakDays: number;
  practicedToday: boolean;
  isConsistentLearner: boolean;
  earnedBadge: StreakBadgeTier | null;
  nextMilestone: StreakBadgeTier | null;
  daysToNextMilestone: number;
  progressPercentToNext: number;
  weeklySlots: DailyHabitSlot[];
  encouragementNote: string;
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function toIsoDay(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

export function diffCalendarDays(earlierIsoDay: string, laterIsoDay: string): number {
  const a = new Date(`${earlierIsoDay}T00:00:00.000Z`).getTime();
  const b = new Date(`${laterIsoDay}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Computes updated streakDays and lastPracticeDate when a student completes
 * a practice round or timed exam session.
 */
export function calculateUpdatedStreak(params: {
  currentStreakDays: number;
  lastPracticeDate?: string | null;
  now?: Date;
}): { streakDays: number; lastPracticeDate: string; incremented: boolean } {
  const todayIso = toIsoDay(params.now ?? new Date());
  const current = Math.max(0, Math.floor(params.currentStreakDays || 0));
  const lastDay = params.lastPracticeDate ? params.lastPracticeDate.slice(0, 10) : null;

  if (!lastDay) {
    // Backfill seamless progression for existing seeded accounts that already have an active streak
    const next = current > 0 ? current + 1 : 1;
    return { streakDays: next, lastPracticeDate: todayIso, incremented: true };
  }

  const gap = diffCalendarDays(lastDay, todayIso);
  if (gap <= 0) {
    // Already practiced today — keep streak intact without double counting
    return {
      streakDays: Math.max(1, current),
      lastPracticeDate: todayIso,
      incremented: false,
    };
  }
  if (gap === 1) {
    return {
      streakDays: current + 1,
      lastPracticeDate: todayIso,
      incremented: true,
    };
  }
  // Missed one or more calendar days — reset streak to 1 for today's session
  return {
    streakDays: 1,
    lastPracticeDate: todayIso,
    incremented: true,
  };
}

/**
 * Builds the dashboard streak summary, Consistent Learner badge status,
 * next milestone progress, and 7-day habit grid.
 */
export function evaluateDailyStreakStatus(params: {
  streakDays: number;
  lastPracticeDate?: string | null;
  attempts?: AttemptRecord[];
  now?: Date;
}): DailyStreakSummary {
  const now = params.now ?? new Date();
  const todayIso = toIsoDay(now);
  const streakDays = Math.max(0, Math.floor(params.streakDays || 0));

  const attemptDays = new Set<string>();
  for (const att of params.attempts || []) {
    if (att.submittedAt) {
      attemptDays.add(toIsoDay(att.submittedAt));
    }
  }
  if (params.lastPracticeDate) {
    attemptDays.add(params.lastPracticeDate.slice(0, 10));
  }

  const practicedToday =
    attemptDays.has(todayIso) ||
    (Boolean(params.lastPracticeDate) && params.lastPracticeDate!.slice(0, 10) === todayIso);

  // Build 7-day trailing calendar ending today
  const weeklySlots: DailyHabitSlot[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const slotDate = new Date(now.getTime() - offset * 86_400_000);
    const isoDate = toIsoDay(slotDate);
    const weekdayLabel = SHORT_WEEKDAYS[slotDate.getUTCDay()];

    // Determine completion from recorded attempts or contiguous streak window
    let completed = attemptDays.has(isoDate);
    if (!completed && streakDays > 0) {
      if (practicedToday) {
        completed = offset < streakDays;
      } else {
        // Streak counts consecutive days leading up to yesterday (offsets 1..streakDays)
        completed = offset >= 1 && offset <= streakDays;
      }
    }

    weeklySlots.push({
      isoDate,
      label: weekdayLabel,
      completed,
      isToday: offset === 0,
    });
  }

  // Highest earned tier
  let earnedBadge: StreakBadgeTier | null = null;
  let nextMilestone: StreakBadgeTier | null = null;
  for (const tier of STREAK_BADGE_TIERS) {
    if (streakDays >= tier.minDays) {
      earnedBadge = tier;
    } else if (!nextMilestone) {
      nextMilestone = tier;
    }
  }

  const isConsistentLearner = streakDays >= 5;
  const daysToNextMilestone = nextMilestone ? Math.max(0, nextMilestone.minDays - streakDays) : 0;

  let progressPercentToNext = 100;
  if (nextMilestone) {
    const prevFloor = earnedBadge ? earnedBadge.minDays : 0;
    const span = Math.max(1, nextMilestone.minDays - prevFloor);
    progressPercentToNext = Math.min(
      100,
      Math.max(0, Math.round(((streakDays - prevFloor) / span) * 100))
    );
  }

  let encouragementNote =
    'Start a quick 5-question practice round today to begin your study streak!';
  if (streakDays >= 5 && practicedToday) {
    encouragementNote = `Consistent Learner active! You completed today's study session (${streakDays}-day streak).`;
  } else if (streakDays >= 5 && !practicedToday) {
    encouragementNote = `Consistent Learner badge earned! Complete 1 round today to reach a ${streakDays + 1}-day streak.`;
  } else if (streakDays > 0 && practicedToday) {
    encouragementNote = `Great work today! ${Math.max(1, 5 - streakDays)} more day${5 - streakDays === 1 ? '' : 's'} to unlock the Consistent Learner badge.`;
  } else if (streakDays > 0) {
    encouragementNote = `Keep your ${streakDays}-day streak alive with one practice session today.`;
  }

  return {
    streakDays,
    practicedToday,
    isConsistentLearner,
    earnedBadge,
    nextMilestone,
    daysToNextMilestone,
    progressPercentToNext,
    weeklySlots,
    encouragementNote,
  };
}

export const DEFAULT_DAILY_QUESTION_GOAL = 15;
export const MIN_DAILY_QUESTION_GOAL = 5;
export const MAX_DAILY_QUESTION_GOAL = 100;

export function sanitizeDailyGoalTarget(target: unknown): number {
  const num = Number(target);
  if (!Number.isFinite(num)) return DEFAULT_DAILY_QUESTION_GOAL;
  return Math.max(
    MIN_DAILY_QUESTION_GOAL,
    Math.min(MAX_DAILY_QUESTION_GOAL, Math.round(num))
  );
}

export interface DailyStudyGoalStatus {
  targetQuestions: number;
  completedQuestionsToday: number;
  remainingQuestions: number;
  progressPercent: number;
  goalReached: boolean;
  sessionsToday: number;
}

export function evaluateDailyStudyGoal(params: {
  targetQuestions?: number | null;
  attempts?: AttemptRecord[];
  now?: Date;
}): DailyStudyGoalStatus {
  const targetQuestions = sanitizeDailyGoalTarget(
    params.targetQuestions ?? DEFAULT_DAILY_QUESTION_GOAL
  );
  const todayIso = toIsoDay(params.now ?? new Date());

  let completedQuestionsToday = 0;
  let sessionsToday = 0;
  for (const att of params.attempts || []) {
    if (att.submittedAt && toIsoDay(att.submittedAt) === todayIso) {
      completedQuestionsToday += Math.max(0, Math.round(att.totalQuestions || 0));
      sessionsToday += 1;
    }
  }

  const remainingQuestions = Math.max(0, targetQuestions - completedQuestionsToday);
  const progressPercent = Math.min(
    100,
    Math.round((completedQuestionsToday / targetQuestions) * 100)
  );
  const goalReached = completedQuestionsToday >= targetQuestions;

  return {
    targetQuestions,
    completedQuestionsToday,
    remainingQuestions,
    progressPercent,
    goalReached,
    sessionsToday,
  };
}

export interface HeaderStreakIndicator {
  streakDays: number;
  hasFireAnimation: boolean;
  label: string;
  dayText: string;
  statusCaption: string;
}

export function evaluateHeaderStreakBadge(streakDays: number): HeaderStreakIndicator {
  const safeDays = Math.max(0, Math.floor(streakDays || 0));
  const hasFireAnimation = safeDays > 3;
  const dayText = safeDays === 1 ? '1 Day' : `${safeDays} Days`;
  const statusCaption =
    safeDays > 3 ? 'On Fire!' : safeDays > 0 ? 'Keep Going!' : 'Start Today';

  return {
    streakDays: safeDays,
    hasFireAnimation,
    label: 'Daily Study Streak',
    dayText,
    statusCaption,
  };
}

