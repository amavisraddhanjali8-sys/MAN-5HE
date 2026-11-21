import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessQuestion,
  canAccessSubject,
  filterAuthorizedAttempts,
  filterAuthorizedInterventionCases,
  filterAuthorizedQuestions,
  type AuthorizationContext,
} from './authorization';
import type { InterventionCase, QuestionAttempt, QuizItem } from './types';

function makeQuiz(id: string, subjectId: string): QuizItem {
  return {
    id,
    source: 'curated',
    subjectId,
    questionSi: `Q ${id}`,
    questionEn: `Q ${id}`,
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    memoryTrickTitle: 'Trick',
    memoryTrickBody: 'Trick body',
    explanation: 'Expl',
    attributes: {
      intelligenceMeasure: 50,
      correctProbability: 0.7,
      wrongProbability: 0.3,
      examPriority: 7,
      quizStrength: 70,
      difficultyTier: 'Moderate',
      cognitiveDomain: 'Mathematics & Word Problems',
      estimatedSeconds: 30,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeAttempt(id: string, studentId: string, questionId: string, subjectId: string): QuestionAttempt {
  return {
    id,
    studentId,
    questionId,
    questionVersion: 1,
    subjectId,
    topicId: 'top-1',
    subtopicId: 'sub-1',
    attemptSequenceNumber: 1,
    submittedAnswerIndex: 1,
    submissionStatus: 'valid_answered',
    isCorrect: false,
    responseDurationMs: 12000,
    difficultyAtAttempt: 'Moderate',
    hintUsed: false,
    contextMode: 'practice',
    sessionId: 'S1',
    deliveryContext: {},
    idempotencyKey: `key-${id}`,
    attemptTimestamp: '2026-11-20T10:00:00.000Z',
  };
}

test('teacher with multiple assigned subjects accesses only authorized subjects and shared categories', () => {
  const mathAndLogicTeacher: AuthorizationContext = {
    userId: 'teacher-1',
    role: 'teacher',
    assignedSubjectIds: ['subj-math', 'subj-logic'],
  };
  const sharedMathTeacher: AuthorizationContext = {
    userId: 'teacher-2',
    role: 'teacher',
    assignedSubjectIds: ['subj-math', 'subj-sinhala'],
  };

  assert.equal(canAccessSubject(mathAndLogicTeacher, 'subj-math'), true);
  assert.equal(canAccessSubject(mathAndLogicTeacher, 'subj-logic'), true);
  assert.equal(canAccessSubject(mathAndLogicTeacher, 'subj-sinhala'), false);
  assert.equal(canAccessSubject(sharedMathTeacher, 'subj-math'), true);
  assert.equal(canAccessSubject(sharedMathTeacher, 'subj-logic'), false);
});

test('removing subject permission revokes question & attempt visibility immediately', () => {
  const qMath = makeQuiz('Q-1', 'subj-math');
  const qSinhala = makeQuiz('Q-2', 'subj-sinhala');

  let teacherCtx: AuthorizationContext = {
    userId: 'teacher-1',
    role: 'teacher',
    assignedSubjectIds: ['subj-math', 'subj-sinhala'],
  };
  assert.equal(filterAuthorizedQuestions([qMath, qSinhala], teacherCtx).length, 2);

  // Revoke Sinhala immediately
  teacherCtx = {
    ...teacherCtx,
    assignedSubjectIds: ['subj-math'],
  };
  const visible = filterAuthorizedQuestions([qMath, qSinhala], teacherCtx);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'Q-1');
  assert.equal(canAccessQuestion(teacherCtx, qSinhala), false);
});

test('moving a question to another subject switches authorization scope while retaining historical attempts', () => {
  const teacherMath: AuthorizationContext = {
    userId: 'teacher-math',
    role: 'teacher',
    assignedSubjectIds: ['subj-math'],
  };
  const teacherLogic: AuthorizationContext = {
    userId: 'teacher-logic',
    role: 'teacher',
    assignedSubjectIds: ['subj-logic'],
  };

  // Attempt originally recorded under subj-math
  const historicalAttempt = makeAttempt('ATT-1', 'stu-1', 'Q-MOVE', 'subj-math');
  // Question moved to subj-logic
  const currentSubjectLookup = new Map<string, string>([['Q-MOVE', 'subj-logic']]);

  assert.equal(
    filterAuthorizedAttempts([historicalAttempt], teacherMath, currentSubjectLookup).length,
    0
  );
  assert.equal(
    filterAuthorizedAttempts([historicalAttempt], teacherLogic, currentSubjectLookup).length,
    1
  );
});

test('student access strictly isolates records to own studentId', () => {
  const stuCtx: AuthorizationContext = {
    userId: 'stu-1',
    role: 'student',
    assignedSubjectIds: [],
  };
  const att1 = makeAttempt('A1', 'stu-1', 'Q1', 'subj-math');
  const att2 = makeAttempt('A2', 'stu-2', 'Q1', 'subj-math');
  const scopedAttempts = filterAuthorizedAttempts([att1, att2], stuCtx);
  assert.equal(scopedAttempts.length, 1);
  assert.equal(scopedAttempts[0].studentId, 'stu-1');

  const case1: InterventionCase = {
    id: 'C1',
    studentId: 'stu-1',
    questionId: 'Q1',
    subjectId: 'subj-math',
    topicId: 't1',
    subtopicId: 'st1',
    status: 'OPEN',
    incorrectCount: 3,
    thresholdTriggeredAt: 3,
    latestAttemptId: 'A1',
    assignedTeacherId: null,
    templateId: null,
    instructionTitle: '',
    instructionBody: '',
    suggestedSupportNote: '',
    recommendedPracticeTopicId: null,
    consecutiveCorrectAfterCase: 0,
    readyForTeacherReview: false,
    reopenCount: 0,
    dismissalReason: null,
    resolutionNotes: null,
    lastAlertSentAt: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    resolvedAt: null,
  };
  const case2 = { ...case1, id: 'C2', studentId: 'stu-2' };
  const scopedCases = filterAuthorizedInterventionCases([case1, case2], stuCtx);
  assert.equal(scopedCases.length, 1);
  assert.equal(scopedCases[0].id, 'C1');
});
