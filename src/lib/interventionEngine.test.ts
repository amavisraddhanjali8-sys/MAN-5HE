import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ACADEMIC_CONFIG,
  evaluateCorrectFollowUpForCase,
  evaluateWrongAttemptForCase,
  validateCaseTransition,
} from './interventionEngine.ts';
import type { InterventionCase } from './types.ts';

function makeCase(overrides: Partial<InterventionCase> = {}): InterventionCase {
  return {
    id: 'CASE-1',
    studentId: 'stu-1',
    questionId: 'Q-1',
    subjectId: 'subj-math',
    topicId: 'top-1',
    subtopicId: 'sub-1',
    status: 'OPEN',
    incorrectCount: 3,
    thresholdTriggeredAt: 3,
    latestAttemptId: 'ATT-3',
    assignedTeacherId: null,
    templateId: null,
    instructionTitle: '',
    instructionBody: '',
    suggestedSupportNote: 'Suggested support',
    recommendedPracticeTopicId: 'top-1',
    consecutiveCorrectAfterCase: 0,
    readyForTeacherReview: false,
    reopenCount: 0,
    dismissalReason: null,
    resolutionNotes: null,
    lastAlertSentAt: '2026-11-20T10:00:00.000Z',
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

test('triggers repeated-error case strictly at configured threshold and avoids duplicate active cases with cooldown', () => {
  const now = Date.parse('2026-11-20T10:05:00.000Z');

  // 2 wrong attempts < threshold 3 -> no case
  const below = evaluateWrongAttemptForCase({
    incorrectCount: 2,
    existingCasesForStudentQuestion: [],
    config: DEFAULT_ACADEMIC_CONFIG,
    nowMs: now,
  });
  assert.equal(below.action, 'none');
  assert.equal(below.shouldDispatchAlert, false);

  // 3rd wrong attempt -> create case & send alert
  const created = evaluateWrongAttemptForCase({
    incorrectCount: 3,
    existingCasesForStudentQuestion: [],
    config: DEFAULT_ACADEMIC_CONFIG,
    nowMs: now,
  });
  assert.equal(created.action, 'create_case');
  assert.equal(created.shouldDispatchAlert, true);

  // 4th wrong attempt 5 minutes later -> updates active case, suppresses alert within 30 min cooldown
  const rapidRepeat = evaluateWrongAttemptForCase({
    incorrectCount: 4,
    existingCasesForStudentQuestion: [makeCase({ lastAlertSentAt: '2026-11-20T10:00:00.000Z' })],
    config: DEFAULT_ACADEMIC_CONFIG,
    nowMs: Date.parse('2026-11-20T10:05:00.000Z'),
  });
  assert.equal(rapidRepeat.action, 'update_active_case');
  assert.equal(rapidRepeat.shouldDispatchAlert, false);
});

test('never auto-closes case on single correct answer; requires sustained follow-up and teacher review', () => {
  const assignedCase = makeCase({ status: 'INTERVENTION_ASSIGNED', consecutiveCorrectAfterCase: 0 });
  const firstRight = evaluateCorrectFollowUpForCase({
    activeCase: assignedCase,
    config: DEFAULT_ACADEMIC_CONFIG,
  });
  assert.equal(firstRight.autoClosed, false);
  assert.equal(firstRight.nextStatus, 'MONITORING');
  assert.equal(firstRight.nextConsecutiveCorrect, 1);
  assert.equal(firstRight.readyForTeacherReview, false);

  const secondRight = evaluateCorrectFollowUpForCase({
    activeCase: { ...assignedCase, status: firstRight.nextStatus, consecutiveCorrectAfterCase: 1 },
    config: DEFAULT_ACADEMIC_CONFIG,
  });
  assert.equal(secondRight.autoClosed, false);
  assert.equal(secondRight.nextStatus, 'MONITORING');
  assert.equal(secondRight.readyForTeacherReview, true);
});

test('reopens resolved case when difficulty recurs and enforces state transition rules', () => {
  const resolved = makeCase({ status: 'RESOLVED' });
  const reopen = evaluateWrongAttemptForCase({
    incorrectCount: 4,
    existingCasesForStudentQuestion: [resolved],
    config: DEFAULT_ACADEMIC_CONFIG,
    nowMs: Date.parse('2026-11-21T10:00:00.000Z'),
  });
  assert.equal(reopen.action, 'reopen_case');
  assert.equal(reopen.shouldDispatchAlert, true);

  assert.equal(validateCaseTransition('OPEN', 'UNDER_REVIEW').ok, true);
  assert.equal(validateCaseTransition('OPEN', 'RESOLVED').ok, false);
  assert.equal(validateCaseTransition('MONITORING', 'RESOLVED').ok, true);
  assert.equal(validateCaseTransition('RESOLVED', 'OPEN').ok, true);
});
