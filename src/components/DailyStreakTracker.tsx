import React from 'react';
import { ArrowRight, Award, Check, CheckCircle2, Clock, Flame, ShieldCheck } from 'lucide-react';
import type { AttemptRecord } from '../lib/types';
import { evaluateDailyStreakStatus } from '../lib/streak';

interface DailyStreakTrackerProps {
  streakDays: number;
  lastPracticeDate?: string | null;
  attempts: AttemptRecord[];
  onStartPractice: () => void;
}

export function DailyStreakTracker({
  streakDays,
  lastPracticeDate,
  attempts,
  onStartPractice,
}: DailyStreakTrackerProps) {
  const summary = evaluateDailyStreakStatus({
    streakDays,
    lastPracticeDate,
    attempts,
  });

  return (
    <section
      aria-label="Daily Practice Streak Tracker"
      data-testid="daily-streak-tracker"
      className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-5"
    >
      {/* Top Row: Day Streak Counter + Consistent Learner Badge */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-start sm:items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#FFF3EC] text-[#F96A1B] flex items-center justify-center shrink-0">
            <Flame className="w-7 h-7" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span
                data-testid="day-streak-count"
                className="text-3xl font-display font-extrabold text-[#0F2942] tabular-nums leading-none"
              >
                {summary.streakDays}
              </span>
              <h2 className="text-lg font-display font-bold text-[#0F2942]">
                Day Streak
              </h2>
              <span className="text-xs font-medium text-[#526A84]">
                · දිනපතා පුහුණු පෙළ
              </span>
            </div>

            <p className="text-xs text-[#476481] mt-1.5 leading-relaxed max-w-lg">
              {summary.encouragementNote}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium">
              {summary.practicedToday ? (
                <span className="inline-flex items-center gap-1.5 text-[#2E7D32] font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Today&apos;s session complete</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[#C24D0A] font-semibold">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Today&apos;s session pending</span>
                </span>
              )}
              {summary.nextMilestone && (
                <span className="text-[#526A84] tabular-nums">
                  Next: {summary.nextMilestone.title} ({summary.nextMilestone.minDays} Days · {summary.daysToNextMilestone} left)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Consistent Learner Badge */}
        <div
          data-testid="consistent-learner-badge"
          className={`rounded-2xl px-4 py-3.5 flex items-center gap-3.5 shrink-0 md:min-w-[260px] ${
            summary.isConsistentLearner
              ? 'bg-[#EEF9EF] text-[#1E6323]'
              : 'bg-[#F3F9FF] text-[#0F2942]'
          }`}
        >
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
              summary.isConsistentLearner
                ? 'bg-[#4CAF50] text-white'
                : 'bg-[#DCEEFF] text-[#158EE3]'
            }`}
          >
            {summary.isConsistentLearner ? (
              <ShieldCheck className="w-6 h-6" aria-hidden="true" />
            ) : (
              <Award className="w-6 h-6" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-display font-bold truncate">
                Consistent Learner
              </span>
              <span className="text-xs font-bold tabular-nums shrink-0">
                {summary.isConsistentLearner
                  ? 'Unlocked'
                  : `${Math.min(summary.streakDays, 5)}/5d`}
              </span>
            </div>
            <div className="text-xs opacity-85 truncate">
              නිතිපතා ඉගෙනුම් පදක්කම
            </div>
            {!summary.isConsistentLearner ? (
              <div className="mt-2 h-1.5 w-full rounded-full bg-[#DCEBFA] overflow-hidden">
                <div
                  className="h-full bg-[#158EE3] rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.round((summary.streakDays / 5) * 100))}%` }}
                />
              </div>
            ) : (
              <div className="mt-0.5 text-[11px] font-semibold opacity-90">
                {summary.earnedBadge && summary.earnedBadge.id !== 'consistent-learner'
                  ? `Tier: ${summary.earnedBadge.title}`
                  : '5+ Consecutive Study Days'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Strip: 7-Day Habit Tracker & Quick Practice CTA */}
      <div className="pt-4 border-t border-[#E5F0FA] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="grid grid-cols-7 gap-2 flex-1" role="list" aria-label="Last 7 days practice history">
          {summary.weeklySlots.map((slot) => (
            <div
              key={slot.isoDate}
              role="listitem"
              aria-label={`${slot.label}: ${slot.completed ? 'Completed' : slot.isToday ? 'Pending today' : 'Missed'}`}
              className="flex flex-col items-center gap-1.5"
            >
              <span
                className={`text-[11px] font-semibold ${
                  slot.isToday ? 'text-[#158EE3]' : 'text-[#526A84]'
                }`}
              >
                {slot.isToday ? 'Today' : slot.label}
              </span>
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                  slot.completed
                    ? 'bg-[#4CAF50] text-white'
                    : slot.isToday
                    ? 'bg-[#FFF3EC] text-[#F96A1B] border border-dashed border-[#F96A1B]'
                    : 'bg-[#F3F9FF] text-[#8FA8C1]'
                }`}
              >
                {slot.completed ? (
                  <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                ) : slot.isToday ? (
                  <Flame className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <span className="text-xs font-mono" aria-hidden="true">-</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onStartPractice}
          className={`px-4 py-2.5 text-xs font-bold rounded-xl transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 ${
            summary.practicedToday
              ? 'bg-[#F3F9FF] text-[#0F2942] border border-[#CBE2FA] hover:bg-[#E2F0FD]'
              : 'bg-[#F96A1B] text-white hover:bg-[#DE580E]'
          }`}
        >
          <span>{summary.practicedToday ? 'Bonus Practice' : 'Practice Today'}</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
