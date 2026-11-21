import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQuestionPerformance,
  calculateStudentBaselineVsFollowUp,
} from './questionIntelligence.ts';
import type { AttemptSubmissionStatus, QuestionAttempt } from './types.ts';

function makeQAttempt(overrides: Partial<QuestionAttempt> & { id: string }): QuestionAttempt {
  return {
    studentId: 'stu-1',
    questionId: 'Q-100',
    questionVersion: 1,
    subjectId: 'subj-math',
    topicId: 'top-1',
    subtopicId: 'sub-1',
    attemptSequenceNumber: 1,
    submittedAnswerIndex: 0,
    submissionStatus: 'valid_answered' as AttemptSubmissionStatus,
    isCorrect: true,
    responseDurationMs: 15000,
    difficultyAtAttempt: 'Moderate',
    hintUsed: false,
    contextMode: 'practice',
    sessionId: 'SES-1',
    deliveryContext: {},
    idempotencyKey: `idem-${overrides.id}`,
    attemptTimestamp: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

test('calculateQuestionPerformance separates skipped/timed_out from incorrect answers and splits first vs repeat & hint vs unassisted', () => {
  const attempts: QuestionAttempt[] = [
    // Student 1: 3 wrong then 1 right (reaches threshold 3!)
    makeQAttempt({ id: '1', studentId: 'stu-1', attemptSequenceNumber: 1, isCorrect: false, hintUsed: false, responseDurationMs: 10000 }),
    makeQAttempt({ id: '2', studentId: 'stu-1', attemptSequenceNumber: 2, isCorrect: false, hintUsed: true, responseDurationMs: 20000 }),
    makeQAttempt({ id: '3', studentId: 'stu-1', attemptSequenceNumber: 3, isCorrect: false, hintUsed: false, responseDurationMs: 30000 }),
    makeQAttempt({ id: '4', studentId: 'stu-1', attemptSequenceNumber: 4, isCorrect: true, hintUsed: true, responseDurationMs: 40000 }),
    // Student 2: 1 first-attempt correct unassisted
    makeQAttempt({ id: '5', studentId: 'stu-2', attemptSequenceNumber: 1, isCorrect: true, hintUsed: false, responseDurationMs: 12000 }),
    // Student 3: skipped and timed out (must NOT count as valid answered or wrong!)
    makeQAttempt({ id: '6', studentId: 'stu-3', attemptSequenceNumber: 0, submittedAnswerIndex: null, submissionStatus: 'skipped', isCorrect: null, responseDurationMs: 2000 }),
    makeQAttempt({ id: '7', studentId: 'stu-3', attemptSequenceNumber: 0, submittedAnswerIndex: null, submissionStatus: 'timed_out', isCorrect: null, responseDurationMs: 60000 }),
  ];

  const metrics = calculateQuestionPerformance('Q-100', attempts, 3);
  assert.equal(metrics.totalRecordedEvents, 7);
  assert.equal(metrics.validAttemptCount, 5);
  assert.equal(metrics.skippedOrUnansweredCount, 1);
  assert.equal(metrics.timedOutCount, 1);
  assert.equal(metrics.uniqueStudents, 2);
  assert.equal(metrics.correctAttemptCount, 2);
  assert.equal(metrics.incorrectAttemptCount, 3);
  assert.equal(metrics.correctAttemptRate, 40);
  assert.equal(metrics.incorrectAttemptRate, 60);
  assert.equal(metrics.firstAttemptTotal, 2);
  assert.equal(metrics.firstAttemptAccuracy, 50); // 1/2
  assert.equal(metrics.repeatAttemptTotal, 3);
  assert.equal(metrics.repeatAttemptAccuracy, 33.3); // 1/3
  assert.equal(metrics.hintAssistedTotal, 2);
  assert.equal(metrics.hintAssistedAccuracy, 50); // 1/2
  assert.equal(metrics.unassistedTotal, 3);
  assert.equal(metrics.unassistedAccuracy, 33.3); // 1/3
  assert.equal(metrics.repeatedErrorStudentCount, 1);
  assert.equal(metrics.sampleSizeStatus, 'preliminary');
  assert.equal(metrics.responseTimeStats.minMs, 10000);
  assert.equal(metrics.responseTimeStats.medianMs, 20000);
});

test('calculateStudentBaselineVsFollowUp enforces sufficient evidence and measures comparable improvement', () => {
  const tooFew = [
    makeQAttempt({ id: 'a', attemptTimestamp: '2026-11-01T10:00:00Z', isCorrect: false }),
    makeQAttempt({ id: 'b', attemptTimestamp: '2026-11-02T10:00:00Z', isCorrect: true }),
  ];
  const insufficient = calculateStudentBaselineVsFollowUp(tooFew);
  assert.equal(insufficient.comparableEvidenceSufficient, false);

  const enough = [
    makeQAttempt({ id: '1', attemptTimestamp: '2026-11-01T10:00:00Z', isCorrect: false }),
    makeQAttempt({ id: '2', attemptTimestamp: '2026-11-02T10:00:00Z', isCorrect: false }),
    makeQAttempt({ id: '3', attemptTimestamp: '2026-11-03T10:00:00Z', isCorrect: true }),
    makeQAttempt({ id: '4', attemptTimestamp: '2026-11-04T10:00:00Z', isCorrect: true }),
  ];
  const summary = calculateStudentBaselineVsFollowUp(enough);
  assert.equal(summary.comparableEvidenceSufficient, true);
  assert.equal(summary.baselineAccuracyPercent, 0);
  assert.equal(summary.followUpAccuracyPercent, 100);
  assert.equal(summary.improvementDeltaPercent, 100);
});
