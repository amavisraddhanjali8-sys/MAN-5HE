export type ExamUrgencyLevel = 'normal' | 'warning' | 'urgent';

export interface ExamTimerInput {
  secondsLeft: number;
  timeLimitSeconds: number;
  answeredCount: number;
  totalQuestions: number;
}

export interface ExamTimerState {
  secondsLeft: number;
  timeLimitSeconds: number;
  formattedTime: string;
  remainingRatio: number;
  progressPercent: number;
  urgencyLevel: ExamUrgencyLevel;
  isUrgent: boolean;
  statusLabel: string;
  remainingQuestions: number;
  secondsPerRemainingQuestion: number | null;
  paceGuidance: string;
}

export interface RingGeometry {
  radius: number;
  circumference: number;
  strokeDashoffset: number;
}

export const URGENT_SECONDS_THRESHOLD = 60;
export const WARNING_RATIO_THRESHOLD = 0.35;

export function getUrgentThresholdSeconds(timeLimitSeconds: number): number {
  const safeTotal = Math.max(0, Math.round(timeLimitSeconds));
  if (safeTotal >= 120) {
    return URGENT_SECONDS_THRESHOLD;
  }
  if (safeTotal <= 0) {
    return 0;
  }
  return Math.max(10, Math.floor(safeTotal * 0.25));
}

export function formatExamClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function evaluateExamTimerState(input: ExamTimerInput): ExamTimerState {
  const safeTotal = Math.max(1, Math.round(input.timeLimitSeconds));
  const safeSeconds = Math.max(0, Math.min(safeTotal, Math.round(input.secondsLeft)));
  const safeTotalQuestions = Math.max(0, Math.round(input.totalQuestions));
  const safeAnswered = Math.max(0, Math.min(safeTotalQuestions, Math.round(input.answeredCount)));

  const remainingRatio = safeSeconds / safeTotal;
  const progressPercent = Math.round(remainingRatio * 100);
  const urgentThreshold = getUrgentThresholdSeconds(safeTotal);

  let urgencyLevel: ExamUrgencyLevel = 'normal';
  if (safeSeconds <= urgentThreshold) {
    urgencyLevel = 'urgent';
  } else if (remainingRatio <= WARNING_RATIO_THRESHOLD) {
    urgencyLevel = 'warning';
  }

  const isUrgent = urgencyLevel === 'urgent';
  const statusLabel =
    urgencyLevel === 'urgent'
      ? 'Urgent · Time Left'
      : urgencyLevel === 'warning'
      ? 'Final Stretch · Pace Up'
      : 'Time Left';

  const remainingQuestions = Math.max(0, safeTotalQuestions - safeAnswered);
  const secondsPerRemainingQuestion =
    remainingQuestions > 0 ? Math.max(1, Math.round(safeSeconds / remainingQuestions)) : null;

  const paceGuidance =
    safeTotalQuestions === 0
      ? 'No questions loaded'
      : remainingQuestions === 0
      ? 'All questions answered · Review or submit'
      : `${remainingQuestions} left · ~${secondsPerRemainingQuestion}s/question pace`;

  return {
    secondsLeft: safeSeconds,
    timeLimitSeconds: safeTotal,
    formattedTime: formatExamClock(safeSeconds),
    remainingRatio,
    progressPercent,
    urgencyLevel,
    isUrgent,
    statusLabel,
    remainingQuestions,
    secondsPerRemainingQuestion,
    paceGuidance,
  };
}

export function calculateRingGeometry(radius: number, remainingRatio: number): RingGeometry {
  const safeRadius = Math.max(1, radius);
  const clampedRatio = Math.max(0, Math.min(1, remainingRatio));
  const circumference = Number((2 * Math.PI * safeRadius).toFixed(2));
  const strokeDashoffset = Number((circumference * (1 - clampedRatio)).toFixed(2));
  return {
    radius: safeRadius,
    circumference,
    strokeDashoffset,
  };
}
