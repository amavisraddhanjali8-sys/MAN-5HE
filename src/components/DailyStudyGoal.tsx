import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, SlidersHorizontal, Target } from 'lucide-react';
import type { AttemptRecord } from '../lib/types';
import {
  DEFAULT_DAILY_QUESTION_GOAL,
  MAX_DAILY_QUESTION_GOAL,
  MIN_DAILY_QUESTION_GOAL,
  evaluateDailyStudyGoal,
  sanitizeDailyGoalTarget,
} from '../lib/streak';

interface DailyStudyGoalProps {
  dailyGoalQuestions?: number;
  attempts: AttemptRecord[];
  onSaveGoal: (targetQuestions: number) => Promise<void>;
  onStartPractice: () => void;
}

const GOAL_PRESETS = [10, 15, 20, 30];

export function DailyStudyGoal({
  dailyGoalQuestions,
  attempts,
  onSaveGoal,
  onStartPractice,
}: DailyStudyGoalProps) {
  const activeTarget = sanitizeDailyGoalTarget(
    dailyGoalQuestions ?? DEFAULT_DAILY_QUESTION_GOAL
  );
  const [editing, setEditing] = useState(false);
  const [draftTarget, setDraftTarget] = useState<string>(String(activeTarget));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setDraftTarget(String(activeTarget));
  }, [activeTarget]);

  const status = evaluateDailyStudyGoal({
    targetQuestions: activeTarget,
    attempts,
  });

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const sanitized = sanitizeDailyGoalTarget(draftTarget);
    setSaving(true);
    setFeedback(null);
    try {
      await onSaveGoal(sanitized);
      setDraftTarget(String(sanitized));
      setEditing(false);
      setFeedback(`Daily study goal updated to ${sanitized} questions.`);
    } catch (err) {
      setFeedback((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Daily Study Goal"
      data-testid="daily-study-goal"
      className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EBF5FF] text-[#158EE3] flex items-center justify-center shrink-0">
            <Target className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-lg font-display font-bold text-[#0F2942]">
                Daily Study Goal
              </h2>
              <span className="text-xs font-medium text-[#526A84]">
                · දෛනික අධ්‍යයන ඉලක්කය
              </span>
            </div>
            <p className="text-xs text-[#476481] mt-0.5 tabular-nums">
              <strong data-testid="goal-progress-fraction" className="text-[#0F2942]">
                {status.completedQuestionsToday} / {status.targetQuestions}
              </strong>{' '}
              Questions Answered Today ·{' '}
              <span className="font-semibold text-[#158EE3]">
                {status.progressPercent}% Complete
              </span>
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={editing}
          onClick={() => {
            setEditing((open) => !open);
            setFeedback(null);
          }}
          className="px-4 py-2 text-xs font-bold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] hover:bg-[#E2F0FD] rounded-xl transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#158EE3]" aria-hidden="true" />
          <span>{editing ? 'Close Goal Editor' : 'Set Daily Study Goal'}</span>
        </button>
      </div>

      {/* Inline Goal Customizer */}
      {editing && (
        <form
          onSubmit={handleSave}
          data-testid="daily-goal-editor"
          className="p-4 rounded-2xl bg-[#F7FBFF] border border-[#DCEBFA] flex flex-wrap items-end justify-between gap-4"
        >
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#476481]">Quick Presets</div>
            <div className="flex flex-wrap items-center gap-2">
              {GOAL_PRESETS.map((preset) => {
                const selected = Number(draftTarget) === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDraftTarget(String(preset))}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors tabular-nums whitespace-nowrap shrink-0 ${
                      selected
                        ? 'bg-[#158EE3] border-[#158EE3] text-white'
                        : 'bg-white border-[#CBE2FA] text-[#0F2942] hover:bg-[#EBF5FF]'
                    }`}
                  >
                    {preset} Questions
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="daily-goal-input"
                className="block text-xs font-semibold text-[#476481] mb-1"
              >
                Custom Target ({MIN_DAILY_QUESTION_GOAL}–{MAX_DAILY_QUESTION_GOAL})
              </label>
              <input
                id="daily-goal-input"
                type="number"
                min={MIN_DAILY_QUESTION_GOAL}
                max={MAX_DAILY_QUESTION_GOAL}
                value={draftTarget}
                onChange={(e) => setDraftTarget(e.target.value)}
                className="w-28 px-3 py-2 text-sm font-mono font-bold text-[#0F2942] bg-white border border-[#CBE2FA] rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#158EE3]"
                required
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Goal'}
            </button>
          </div>
        </form>
      )}

      {/* Progress Bar */}
      <div className="space-y-2">
        <div
          role="progressbar"
          aria-label="Daily study goal progress"
          aria-valuenow={status.progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="w-full h-3.5 rounded-full bg-[#EBF5FF] overflow-hidden"
        >
          <div
            data-testid="daily-goal-progress-bar"
            className={`h-full rounded-full transition-all ${
              status.goalReached ? 'bg-[#4CAF50]' : 'bg-[#158EE3]'
            }`}
            style={{ width: `${Math.max(status.completedQuestionsToday > 0 ? 6 : 0, status.progressPercent)}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {status.goalReached ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#2E7D32]">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                Daily Goal Achieved! Completed {status.completedQuestionsToday} questions today.
              </span>
            </span>
          ) : (
            <span className="text-[#526A84] font-medium tabular-nums">
              {status.remainingQuestions} more question{status.remainingQuestions === 1 ? '' : 's'} to reach today&apos;s target of {status.targetQuestions}.
            </span>
          )}

          {!status.goalReached && (
            <button
              type="button"
              onClick={onStartPractice}
              className="text-xs font-bold text-[#158EE3] hover:text-[#0E69AA] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <span>Practice to Advance Goal</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className="text-xs font-semibold text-[#1E6323] bg-[#EEF9EF] border border-[#C1E8C4] rounded-xl px-3.5 py-2"
        >
          {feedback}
        </div>
      )}
    </section>
  );
}
