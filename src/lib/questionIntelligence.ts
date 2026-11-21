import type {
  QuestionAttempt,
  QuestionPerformanceMetrics,
  ResponseTimeDistribution,
  SampleSizeStatus,
} from './types.ts';

export const RESPONSE_TIME_ETHICAL_FRAMING =
  'Response time reflects pacing and solving strategy only—never intelligence, attention, or neurological traits.';

export function classifySampleSize(validAttempts: number): SampleSizeStatus {
  if (validAttempts < 3) return 'insufficient';
  if (validAttempts < 10) return 'preliminary';
  return 'reliable';
}

export function calculateResponseTimeDistribution(
  durationsMs: number[]
): ResponseTimeDistribution {
  const valid = durationsMs.filter((ms) => Number.isFinite(ms) && ms > 0).sort((a, b) => a - b);
  if (valid.length === 0) {
    return {
      sampleCount: 0,
      minMs: 0,
      medianMs: 0,
      p90Ms: 0,
      meanMs: 0,
      framingNote: RESPONSE_TIME_ETHICAL_FRAMING,
    };
  }
  const minMs = valid[0];
  const mid = Math.floor(valid.length / 2);
  const medianMs =
    valid.length % 2 === 1
      ? valid[mid]
      : Math.round((valid[mid - 1] + valid[mid]) / 2);
  const p90Idx = Math.min(valid.length - 1, Math.floor((valid.length - 1) * 0.9));
  const p90Ms = valid[p90Idx];
  const meanMs = Math.round(valid.reduce((acc, v) => acc + v, 0) / valid.length);

  return {
    sampleCount: valid.length,
    minMs,
    medianMs,
    p90Ms,
    meanMs,
    framingNote: RESPONSE_TIME_ETHICAL_FRAMING,
  };
}

function roundRate(correct: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((correct / total) * 1000) / 10;
}

export function calculateQuestionPerformance(
  questionId: string,
  attempts: QuestionAttempt[],
  repeatedErrorThreshold = 3
): QuestionPerformanceMetrics {
  const qAttempts = attempts.filter((a) => a.questionId === questionId);
  const validAnswered = qAttempts.filter((a) => a.submissionStatus === 'valid_answered');
  const skippedOrUnanswered = qAttempts.filter(
    (a) => a.submissionStatus === 'skipped' || a.submissionStatus === 'unanswered'
  );
  const timedOut = qAttempts.filter((a) => a.submissionStatus === 'timed_out');

  const uniqueStudentIds = new Set(validAnswered.map((a) => a.studentId));
  const correctAttempts = validAnswered.filter((a) => a.isCorrect === true);
  const incorrectAttempts = validAnswered.filter((a) => a.isCorrect === false);

  const validCount = validAnswered.length;
  const correctRate = validCount > 0 ? Math.round((correctAttempts.length / validCount) * 1000) / 10 : 0;
  const incorrectRate = validCount > 0 ? Math.round((incorrectAttempts.length / validCount) * 1000) / 10 : 0;

  // Keep first-attempt accuracy strictly separate from repeat-attempt accuracy
  const firstAttempts = validAnswered.filter((a) => a.attemptSequenceNumber === 1);
  const repeatAttempts = validAnswered.filter((a) => a.attemptSequenceNumber > 1);

  const hintAssisted = validAnswered.filter((a) => a.hintUsed);
  const unassisted = validAnswered.filter((a) => !a.hintUsed);

  // Count distinct students reaching configured repeated-error threshold
  const studentErrorCounts = new Map<string, number>();
  for (const att of incorrectAttempts) {
    studentErrorCounts.set(att.studentId, (studentErrorCounts.get(att.studentId) || 0) + 1);
  }
  let repeatedErrorStudentCount = 0;
  for (const cnt of studentErrorCounts.values()) {
    if (cnt >= repeatedErrorThreshold) {
      repeatedErrorStudentCount++;
    }
  }

  return {
    questionId,
    totalRecordedEvents: qAttempts.length,
    validAttemptCount: validCount,
    skippedOrUnansweredCount: skippedOrUnanswered.length,
    timedOutCount: timedOut.length,
    uniqueStudents: uniqueStudentIds.size,
    correctAttemptCount: correctAttempts.length,
    incorrectAttemptCount: incorrectAttempts.length,
    correctAttemptRate: correctRate,
    incorrectAttemptRate: incorrectRate,
    firstAttemptTotal: firstAttempts.length,
    firstAttemptAccuracy: roundRate(
      firstAttempts.filter((a) => a.isCorrect === true).length,
      firstAttempts.length
    ),
    repeatAttemptTotal: repeatAttempts.length,
    repeatAttemptAccuracy: roundRate(
      repeatAttempts.filter((a) => a.isCorrect === true).length,
      repeatAttempts.length
    ),
    hintAssistedTotal: hintAssisted.length,
    hintAssistedAccuracy: roundRate(
      hintAssisted.filter((a) => a.isCorrect === true).length,
      hintAssisted.length
    ),
    unassistedTotal: unassisted.length,
    unassistedAccuracy: roundRate(
      unassisted.filter((a) => a.isCorrect === true).length,
      unassisted.length
    ),
    repeatedErrorStudentCount,
    sampleSizeStatus: classifySampleSize(validCount),
    responseTimeStats: calculateResponseTimeDistribution(
      validAnswered.map((a) => a.responseDurationMs)
    ),
  };
}

export interface StudentImprovementSummary {
  comparableEvidenceSufficient: boolean;
  baselineAccuracyPercent: number | null;
  followUpAccuracyPercent: number | null;
  improvementDeltaPercent: number | null;
  baselineCount: number;
  followUpCount: number;
  summaryNote: string;
}

export function calculateStudentBaselineVsFollowUp(
  studentAttempts: QuestionAttempt[],
  subjectIdFilter?: string
): StudentImprovementSummary {
  const filtered = studentAttempts
    .filter(
      (a) =>
        a.submissionStatus === 'valid_answered' &&
        (!subjectIdFilter || a.subjectId === subjectIdFilter)
    )
    .sort((a, b) => a.attemptTimestamp.localeCompare(b.attemptTimestamp));

  if (filtered.length < 4) {
    return {
      comparableEvidenceSufficient: false,
      baselineAccuracyPercent: null,
      followUpAccuracyPercent: null,
      improvementDeltaPercent: null,
      baselineCount: filtered.length,
      followUpCount: 0,
      summaryNote: 'At least 4 valid answered attempts are needed for baseline vs follow-up comparison.',
    };
  }

  const split = Math.floor(filtered.length / 2);
  const baselineSlice = filtered.slice(0, split);
  const followUpSlice = filtered.slice(split);

  const baselineAcc =
    Math.round(
      (baselineSlice.filter((a) => a.isCorrect === true).length / baselineSlice.length) * 1000
    ) / 10;
  const followUpAcc =
    Math.round(
      (followUpSlice.filter((a) => a.isCorrect === true).length / followUpSlice.length) * 1000
    ) / 10;

  const delta = Math.round((followUpAcc - baselineAcc) * 10) / 10;
  return {
    comparableEvidenceSufficient: true,
    baselineAccuracyPercent: baselineAcc,
    followUpAccuracyPercent: followUpAcc,
    improvementDeltaPercent: delta,
    baselineCount: baselineSlice.length,
    followUpCount: followUpSlice.length,
    summaryNote:
      delta > 0
        ? `Improved +${delta}% from baseline (${baselineAcc}%) to follow-up (${followUpAcc}%).`
        : delta < 0
        ? `Declined ${delta}% from baseline (${baselineAcc}%) to follow-up (${followUpAcc}%).`
        : `Consistent at ${followUpAcc}% across baseline and follow-up.`,
  };
}
