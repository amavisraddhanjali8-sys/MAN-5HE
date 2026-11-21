import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttemptDeliveryOrder,
  canActorModifyQuestion,
  gradeSubmittedAnswer,
  parseBulkQuestionsPayload,
  selectQuestionsForAssessment,
  validateAssessmentTransition,
  validateQuestionTransition,
} from './assessmentEngine.ts';
import type { AuthorizationContext } from './authorization.ts';
import type { QuizItem } from './types.ts';

function makeQuiz(overrides: Partial<QuizItem> & { id: string }): QuizItem {
  return {
    source: 'curated',
    subjectId: 'subj-math',
    topicId: 'top-math-money',
    subtopicId: 'sub-math-change',
    grade: 'Grade 5',
    questionType: 'mcq',
    approvalStatus: 'ACTIVE',
    authorId: 'usr-teacher-1',
    defaultMarks: 2,
    questionSi: `ප්‍රශ්නය ${overrides.id}`,
    questionEn: `Question ${overrides.id}`,
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    correctIndex: 1,
    memoryTrickTitle: 'Tip',
    memoryTrickBody: 'Check carefully',
    explanation: 'Beta is correct.',
    attributes: {
      intelligenceMeasure: 55,
      correctProbability: 0.7,
      wrongProbability: 0.3,
      examPriority: 7,
      quizStrength: 80,
      difficultyTier: 'Moderate',
      cognitiveDomain: 'Mathematics & Word Problems',
      estimatedSeconds: 45,
    },
    createdAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

const adminCtx: AuthorizationContext = {
  userId: 'usr-admin-1',
  role: 'admin',
  assignedSubjectIds: ['subj-math', 'subj-logic', 'subj-sinhala', 'subj-env'],
};

const mathTeacherCtx: AuthorizationContext = {
  userId: 'usr-teacher-1',
  role: 'teacher',
  assignedSubjectIds: ['subj-math', 'subj-logic'],
};

describe('assessmentEngine — RBAC transitions, selection engine, grading & bulk import', () => {
  it('enforces question lifecycle transitions and ownership rules for teachers vs admins', () => {
    // Teacher cannot approve/activate/reject directly
    const teacherApprove = validateQuestionTransition({
      actorRole: 'teacher',
      isAuthor: true,
      fromStatus: 'DRAFT',
      toStatus: 'APPROVED',
    });
    assert.equal(teacherApprove.ok, false);

    // Teacher can submit own draft for review
    const teacherSubmit = validateQuestionTransition({
      actorRole: 'teacher',
      isAuthor: true,
      fromStatus: 'DRAFT',
      toStatus: 'PENDING_REVIEW',
    });
    assert.equal(teacherSubmit.ok, true);

    // Admin can approve and activate
    const adminApprove = validateQuestionTransition({
      actorRole: 'admin',
      isAuthor: false,
      fromStatus: 'PENDING_REVIEW',
      toStatus: 'APPROVED',
    });
    assert.equal(adminApprove.ok, true);

    // Teacher edit checks
    const draftOwnMath = makeQuiz({
      id: 'Q-OWN-DRAFT',
      subjectId: 'subj-math',
      authorId: 'usr-teacher-1',
      approvalStatus: 'DRAFT',
    });
    assert.equal(canActorModifyQuestion({ ctx: mathTeacherCtx, question: draftOwnMath }).canEdit, true);

    const activeOwnMath = makeQuiz({
      id: 'Q-OWN-ACTIVE',
      subjectId: 'subj-math',
      authorId: 'usr-teacher-1',
      approvalStatus: 'ACTIVE',
    });
    assert.equal(canActorModifyQuestion({ ctx: mathTeacherCtx, question: activeOwnMath }).canEdit, false);

    const draftOtherAuthor = makeQuiz({
      id: 'Q-OTHER-DRAFT',
      subjectId: 'subj-math',
      authorId: 'usr-teacher-99',
      approvalStatus: 'DRAFT',
    });
    assert.equal(canActorModifyQuestion({ ctx: mathTeacherCtx, question: draftOtherAuthor }).canEdit, false);

    const draftSinhala = makeQuiz({
      id: 'Q-SINHALA-DRAFT',
      subjectId: 'subj-sinhala',
      authorId: 'usr-teacher-1',
      approvalStatus: 'DRAFT',
    });
    assert.equal(canActorModifyQuestion({ ctx: mathTeacherCtx, question: draftSinhala }).canEdit, false);
    assert.equal(canActorModifyQuestion({ ctx: adminCtx, question: draftSinhala }).canEdit, true);
  });

  it('validates assessment workflow state transitions and author ownership', () => {
    assert.equal(
      validateAssessmentTransition({
        actorRole: 'admin',
        isAuthor: false,
        fromStatus: 'DRAFT',
        toStatus: 'RESULTS_RELEASED',
      }).ok,
      false
    );
    assert.equal(
      validateAssessmentTransition({
        actorRole: 'teacher',
        isAuthor: true,
        fromStatus: 'DRAFT',
        toStatus: 'PUBLISHED',
      }).ok,
      true
    );
    assert.equal(
      validateAssessmentTransition({
        actorRole: 'teacher',
        isAuthor: false,
        fromStatus: 'DRAFT',
        toStatus: 'PUBLISHED',
      }).ok,
      false
    );
  });

  it('selects non-duplicate questions respecting authorization, quotas, adaptive gap, and fails without silent substitution', () => {
    const pool: QuizItem[] = [
      makeQuiz({ id: 'M-1', subjectId: 'subj-math', topicId: 'top-math-money', attributes: { ...makeQuiz({ id: 'x' }).attributes, difficultyTier: 'Simple' } }),
      makeQuiz({ id: 'M-2', subjectId: 'subj-math', topicId: 'top-math-time', attributes: { ...makeQuiz({ id: 'x' }).attributes, difficultyTier: 'Moderate' } }),
      makeQuiz({ id: 'M-3', subjectId: 'subj-math', topicId: 'top-math-time', attributes: { ...makeQuiz({ id: 'x' }).attributes, difficultyTier: 'Challenging' } }),
      makeQuiz({ id: 'M-DRAFT', subjectId: 'subj-math', approvalStatus: 'DRAFT' }),
      makeQuiz({ id: 'S-1', subjectId: 'subj-sinhala', topicId: 'top-sin-grammar', attributes: { ...makeQuiz({ id: 'x' }).attributes, cognitiveDomain: 'Sinhala Language & Proverbs' } }),
    ];

    // Teacher attempting unassigned subject fails explicitly
    assert.throws(() =>
      selectQuestionsForAssessment({
        pool,
        ctx: mathTeacherCtx,
        subjectIds: ['subj-sinhala'],
        count: 1,
        mode: 'deterministic',
        seed: 42,
      })
    );

    // Never silently substitutes DRAFT or Sinhala questions when requesting 4 math questions
    assert.throws(
      () =>
        selectQuestionsForAssessment({
          pool,
          ctx: mathTeacherCtx,
          subjectIds: ['subj-math'],
          count: 4,
          mode: 'deterministic',
          seed: 42,
        }),
      /without silent substitution/
    );

    // Adaptive gap prioritizes top-math-time when it has higher weakness weight
    const adaptive = selectQuestionsForAssessment({
      pool,
      ctx: mathTeacherCtx,
      subjectIds: ['subj-math'],
      count: 2,
      mode: 'adaptive_gap',
      seed: 101,
      topicWeaknessWeights: new Map([['top-math-time', 10], ['top-math-money', 1]]),
    });
    assert.equal(adaptive.selected.length, 2);
    assert.ok(adaptive.selected.every((q) => q.topicId === 'top-math-time'));

    // Difficulty distribution quota
    const quotaRes = selectQuestionsForAssessment({
      pool,
      ctx: mathTeacherCtx,
      subjectIds: ['subj-math'],
      count: 3,
      mode: 'randomized',
      seed: 7,
      difficultyDistribution: { Simple: 1, Moderate: 1, Challenging: 1 },
    });
    assert.deepEqual(quotaRes.distributionApplied, { Simple: 1, Moderate: 1, Challenging: 1, Master: 0 });
    assert.equal(new Set(quotaRes.selected.map((q) => q.id)).size, 3);
  });

  it('preserves grading accuracy across shuffled MCQ options and grades true_false, numerical, and short_answer items', () => {
    const mcq = makeQuiz({
      id: 'Q-MCQ',
      questionType: 'mcq',
      options: ['Wrong A', 'Right Answer', 'Wrong C', 'Wrong D'],
      correctIndex: 1,
    });
    const delivery = buildAttemptDeliveryOrder({
      items: [{ snapshotId: 'SNAP-1', sectionId: 'sec-1', marks: 3, snapshot: mcq }],
      shuffleQuestions: false,
      shuffleOptions: true,
      showHints: true,
      seed: 2025,
    });

    const deliveredQ = delivery.studentQuestions[0] as unknown as Record<string, unknown>;
    assert.equal(deliveredQ.correctIndex, undefined);
    assert.equal(deliveredQ.explanation, undefined);

    const mapping = delivery.shuffledOptionsMap['SNAP-1'];
    const displayedRightIdx = mapping.findIndex((origIdx) => origIdx === 1);
    assert.ok(displayedRightIdx >= 0);

    const gradedCorrect = gradeSubmittedAnswer({
      question: mcq,
      marks: 3,
      submittedDisplayOptionIndex: displayedRightIdx,
      optionMapping: mapping,
    });
    assert.equal(gradedCorrect.isCorrect, true);
    assert.equal(gradedCorrect.awardedMarks, 3);
    assert.equal(gradedCorrect.originalOptionIndex, 1);

    // Numerical tolerance
    const numQ = makeQuiz({
      id: 'Q-NUM',
      questionType: 'numerical',
      acceptedAnswers: ['12.5'],
      markingRule: { numericTolerance: 0.1 },
    });
    assert.equal(
      gradeSubmittedAnswer({ question: numQ, marks: 2, submittedAnswerText: '12.55' }).isCorrect,
      true
    );
    assert.equal(
      gradeSubmittedAnswer({ question: numQ, marks: 2, submittedAnswerText: '13.0' }).isCorrect,
      false
    );

    // Auto short answer vs manual review short answer
    const shortAuto = makeQuiz({
      id: 'Q-SHORT-AUTO',
      questionType: 'short_answer',
      acceptedAnswers: ['Sri Jayawardenepura Kotte'],
      markingRule: { caseSensitive: false, requiresManualReview: false },
    });
    assert.equal(
      gradeSubmittedAnswer({ question: shortAuto, marks: 2, submittedAnswerText: '  sri jayawardenepura   kotte ' }).isCorrect,
      true
    );

    const shortManual = makeQuiz({
      id: 'Q-SHORT-MAN',
      questionType: 'short_answer',
      acceptedAnswers: ['Sample rubric'],
      markingRule: { requiresManualReview: true },
    });
    const pendingRes = gradeSubmittedAnswer({
      question: shortManual,
      marks: 4,
      submittedAnswerText: 'Student detailed explanation',
    });
    assert.equal(pendingRes.markingStatus, 'pending_manual');
    assert.equal(pendingRes.isCorrect, null);
    assert.equal(pendingRes.awardedMarks, 0);
  });

  it('parses CSV and JSON bulk imports cleanly and flags invalid rows', () => {
    const csvContent = [
      'subjectId,questionType,questionSi,optionA,optionB,optionC,optionD,correctIndex,acceptedAnswers,defaultMarks',
      'subj-math,mcq,"Find 10 + 15",20,25,30,35,1,,2',
      'subj-math,numerical,"Multiply 6 x 7",,,,,0,42|42.0,3',
      'subj-math,mcq,"Broken MCQ missing options",OnlyOne,,,0,,1',
    ].join('\n');

    const csvParsed = parseBulkQuestionsPayload({
      format: 'csv',
      content: csvContent,
      defaultSubjectId: 'subj-math',
      defaultStatus: 'PENDING_REVIEW',
    });
    assert.equal(csvParsed.items.length, 2);
    assert.equal(csvParsed.errors.length, 1);
    assert.equal(csvParsed.items[1].acceptedAnswers.length, 2);

    const jsonParsed = parseBulkQuestionsPayload({
      format: 'json',
      content: JSON.stringify([
        {
          subjectId: 'subj-logic',
          questionType: 'true_false',
          questionSi: '48 is divisible by 6',
          correctIndex: 0,
        },
        {
          subjectId: 'subj-logic',
          questionType: 'short_answer',
          questionSi: 'Missing answer rubric',
        },
      ]),
    });
    assert.equal(jsonParsed.items.length, 1);
    assert.equal(jsonParsed.errors.length, 1);
  });
});
