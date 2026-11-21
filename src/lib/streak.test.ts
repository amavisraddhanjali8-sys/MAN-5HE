import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateUpdatedStreak,
  evaluateDailyStreakStatus,
  evaluateDailyStudyGoal,
  evaluateHeaderStreakBadge,
  sanitizeDailyGoalTarget,
} from './streak.ts';
import type { AttemptRecord } from './types.ts';

test('calculateUpdatedStreak increments on first practice, prevents same-day double count, and resets on gap', () => {
  const day1 = new Date('2026-11-10T10:00:00.000Z');
  const first = calculateUpdatedStreak({
    currentStreakDays: 0,
    lastPracticeDate: null,
    now: day1,
  });
  assert.equal(first.streakDays, 1);
  assert.equal(first.lastPracticeDate, '2026-11-10');
  assert.equal(first.incremented, true);

  // Same day repeat should keep streak at 1
  const repeat = calculateUpdatedStreak({
    currentStreakDays: first.streakDays,
    lastPracticeDate: first.lastPracticeDate,
    now: new Date('2026-11-10T18:30:00.000Z'),
  });
  assert.equal(repeat.streakDays, 1);
  assert.equal(repeat.incremented, false);

  // Next consecutive day increments to 2
  const day2 = calculateUpdatedStreak({
    currentStreakDays: repeat.streakDays,
    lastPracticeDate: repeat.lastPracticeDate,
    now: new Date('2026-11-11T09:00:00.000Z'),
  });
  assert.equal(day2.streakDays, 2);
  assert.equal(day2.incremented, true);

  // Missing a day resets streak back to 1
  const gapReset = calculateUpdatedStreak({
    currentStreakDays: 6,
    lastPracticeDate: '2026-11-11',
    now: new Date('2026-11-14T09:00:00.000Z'),
  });
  assert.equal(gapReset.streakDays, 1);
  assert.equal(gapReset.lastPracticeDate, '2026-11-14');
});

test('evaluateDailyStreakStatus awards Consistent Learner badge at 5+ days and builds 7-day strip', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');

  const early = evaluateDailyStreakStatus({
    streakDays: 3,
    lastPracticeDate: '2026-11-16',
    now,
  });
  assert.equal(early.isConsistentLearner, false);
  assert.equal(early.practicedToday, true);
  assert.equal(early.earnedBadge?.id, 'starter');
  assert.equal(early.nextMilestone?.id, 'consistent-learner');
  assert.equal(early.daysToNextMilestone, 2);
  assert.equal(early.weeklySlots.length, 7);
  assert.equal(early.weeklySlots[6].isToday, true);
  assert.equal(early.weeklySlots[6].completed, true);

  const consistent = evaluateDailyStreakStatus({
    streakDays: 6,
    lastPracticeDate: '2026-11-15',
    now,
  });
  assert.equal(consistent.isConsistentLearner, true);
  assert.equal(consistent.practicedToday, false);
  assert.equal(consistent.earnedBadge?.title, 'Consistent Learner');
  assert.equal(consistent.nextMilestone?.title, 'Weekly Champion');
  assert.equal(consistent.daysToNextMilestone, 1);
  assert.equal(consistent.weeklySlots[6].completed, false);
  assert.equal(consistent.weeklySlots[5].completed, true);
});

test('evaluateDailyStudyGoal counts only today questions and clamps target bounds', () => {
  assert.equal(sanitizeDailyGoalTarget(2), 5);
  assert.equal(sanitizeDailyGoalTarget(250), 100);
  assert.equal(sanitizeDailyGoalTarget(20), 20);

  const now = new Date('2026-11-16T12:00:00.000Z');
  const attempts: AttemptRecord[] = [
    {
      id: 'a-today',
      userId: 'u1',
      paperId: 'p1',
      paperTitle: 'Practice',
      mode: 'practice',
      paperCategory: 'Balanced Standard',
      totalQuestions: 8,
      correctCount: 6,
      scorePercent: 75,
      timeLimitSeconds: 0,
      timeSpentSeconds: 120,
      starsEarned: 18,
      domainBreakdown: {},
      submittedAt: '2026-11-16T08:00:00.000Z',
    },
    {
      id: 'a-yesterday',
      userId: 'u1',
      paperId: 'p2',
      paperTitle: 'Yesterday Paper',
      mode: 'timed_exam',
      paperCategory: 'Balanced Standard',
      totalQuestions: 10,
      correctCount: 8,
      scorePercent: 80,
      timeLimitSeconds: 900,
      timeSpentSeconds: 600,
      starsEarned: 25,
      domainBreakdown: {},
      submittedAt: '2026-11-15T08:00:00.000Z',
    },
  ];

  const inProgress = evaluateDailyStudyGoal({ targetQuestions: 20, attempts, now });
  assert.equal(inProgress.completedQuestionsToday, 8);
  assert.equal(inProgress.remainingQuestions, 12);
  assert.equal(inProgress.progressPercent, 40);
  assert.equal(inProgress.goalReached, false);
  assert.equal(inProgress.sessionsToday, 1);

  const reached = evaluateDailyStudyGoal({ targetQuestions: 8, attempts, now });
  assert.equal(reached.progressPercent, 100);
  assert.equal(reached.remainingQuestions, 0);
  assert.equal(reached.goalReached, true);
});

test('evaluateHeaderStreakBadge triggers fire animation strictly for streaks longer than 3 days', () => {
  const zero = evaluateHeaderStreakBadge(0);
  assert.equal(zero.streakDays, 0);
  assert.equal(zero.hasFireAnimation, false);
  assert.equal(zero.dayText, '0 Days');
  assert.equal(zero.statusCaption, 'Start Today');

  const one = evaluateHeaderStreakBadge(1);
  assert.equal(one.dayText, '1 Day');
  assert.equal(one.hasFireAnimation, false);

  const exactlyThree = evaluateHeaderStreakBadge(3);
  assert.equal(exactlyThree.hasFireAnimation, false);
  assert.equal(exactlyThree.statusCaption, 'Keep Going!');

  const fourPlus = evaluateHeaderStreakBadge(4);
  assert.equal(fourPlus.hasFireAnimation, true);
  assert.equal(fourPlus.dayText, '4 Days');
  assert.equal(fourPlus.statusCaption, 'On Fire!');
  assert.equal(fourPlus.label, 'Daily Study Streak');
});

