import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectQuestionsForAssessment } from './assessmentEngine.ts';
import {
  buildStructuredTeachingGuide,
  computeSessionCountdownState,
  convertLocalDateTimeToUtcIso,
  detectScheduleConflicts,
  expandRecurrenceDates,
  formatUtcInTimeZone,
  isValidTimeZone,
} from './learningScheduler.ts';
import type { AuthorizationContext } from './authorization.ts';
import type { QuizItem } from './types.ts';

function makeQuestion(
  id: string,
  subjectId: string,
  topicId: string,
  tier: QuizItem['attributes']['difficultyTier'],
  marks = 1,
  estimatedSeconds = 40,
  questionType: QuizItem['questionType'] = 'mcq',
  learningObjectives = 'Understand Grade 5 arithmetic reasoning'
): QuizItem {
  return {
    id,
    source: 'curated',
    subjectId,
    topicId,
    subtopicId: `${topicId}-sub`,
    grade: 'Grade 5',
    questionType,
    defaultMarks: marks,
    learningObjectives,
    questionSi: `ප්‍රශ්නය ${id}`,
    questionEn: `Question ${id}`,
    options: ['10', '20', '30', '40'],
    correctIndex: 1,
    memoryTrickTitle: 'Step-by-step trick',
    memoryTrickBody: 'Break the problem into small pieces first.',
    explanation: '20 is the exact verified answer.',
    attributes: {
      intelligenceMeasure: 65,
      correctProbability: 0.65,
      wrongProbability: 0.35,
      examPriority: 7,
      quizStrength: 80,
      difficultyTier: tier,
      cognitiveDomain: 'Mathematics & Word Problems',
      estimatedSeconds,
    },
    active: true,
    approvalStatus: 'ACTIVE',
  };
}

describe('Learning Scheduler Utilities & Extended Assessment Selection', () => {
  it('converts local date/time + IANA timezone accurately to UTC across Colombo and London DST', () => {
    assert.equal(isValidTimeZone('Asia/Colombo'), true);
    assert.equal(isValidTimeZone('Invalid/Timezone'), false);

    // Asia/Colombo is UTC+05:30 all year -> 17:30 local = 12:00 UTC
    const colomboUtc = convertLocalDateTimeToUtcIso('2026-06-15', '17:30', 'Asia/Colombo');
    assert.equal(colomboUtc, '2026-06-15T12:00:00.000Z');
    const backColombo = formatUtcInTimeZone(colomboUtc, 'Asia/Colombo');
    assert.equal(backColombo.dateStr, '2026-06-15');
    assert.equal(backColombo.timeStr, '17:30');

    // Europe/London in January is UTC+00:00; in July (BST) is UTC+01:00
    const londonWinter = convertLocalDateTimeToUtcIso('2026-01-15', '16:00', 'Europe/London');
    assert.equal(londonWinter, '2026-01-15T16:00:00.000Z');
    const londonSummer = convertLocalDateTimeToUtcIso('2026-07-15', '16:00', 'Europe/London');
    assert.equal(londonSummer, '2026-07-15T15:00:00.000Z');
  });

  it('expands recurrence dates cleanly with exception dates and conflict detection', () => {
    const dates = expandRecurrenceDates({
      startDate: '2026-05-04', // Monday
      endDate: '2026-05-10', // Sunday
      recurrenceType: 'weekdays',
      exceptionDates: ['2026-05-06'], // Skip Wednesday
    });
    assert.deepEqual(dates, ['2026-05-04', '2026-05-05', '2026-05-07', '2026-05-08']);

    const conflicts = detectScheduleConflicts(
      [
        {
          id: 'SES-1',
          title: 'Existing Math',
          status: 'SCHEDULED',
          scheduledStartUtc: '2026-05-04T11:00:00.000Z',
          scheduledEndUtc: '2026-05-04T11:30:00.000Z',
        },
        {
          id: 'SES-DONE',
          title: 'Old Completed',
          status: 'COMPLETED',
          scheduledStartUtc: '2026-05-04T12:00:00.000Z',
          scheduledEndUtc: '2026-05-04T12:30:00.000Z',
        },
      ],
      [
        {
          startUtc: '2026-05-04T11:15:00.000Z',
          endUtc: '2026-05-04T11:45:00.000Z',
          title: 'Overlapping Slot',
        },
        {
          startUtc: '2026-05-04T12:00:00.000Z',
          endUtc: '2026-05-04T12:30:00.000Z',
          title: 'After Completed Slot',
        },
      ]
    );
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].conflictingSessionId, 'SES-1');
  });

  it('computes live session countdown phases accurately across upcoming, ready, grace, and missed states', () => {
    const sess = {
      scheduledStartUtc: '2026-05-04T12:00:00.000Z',
      scheduledEndUtc: '2026-05-04T12:30:00.000Z',
      gracePeriodMinutes: 15,
      status: 'SCHEDULED' as const,
    };
    const startMs = Date.parse(sess.scheduledStartUtc);

    assert.equal(computeSessionCountdownState(sess, startMs - 95_000).phase, 'upcoming');
    assert.equal(computeSessionCountdownState(sess, startMs + 60_000).phase, 'ready_now');
    assert.equal(computeSessionCountdownState(sess, startMs + 35 * 60_000).phase, 'in_grace');
    assert.equal(computeSessionCountdownState(sess, startMs + 50 * 60_000).phase, 'missed');
  });

  it('builds structured 9-point parent teaching guidance with supportive non-diagnostic language', () => {
    const q = makeQuestion('CUR-X', 'subj-math', 'top-math-arith', 'Moderate');
    const guide = buildStructuredTeachingGuide({
      question: q,
      subjectName: 'Mathematics',
      topicName: 'Arithmetic Operations',
      submittedOptionIndex: 0,
    });

    assert.equal(guide.questionId, 'CUR-X');
    assert.ok(guide.whatItTests.length > 10);
    assert.ok(guide.correctSolutionSteps.length >= 2);
    assert.ok(guide.plausibleErrorReasons.length >= 1);
    assert.ok(guide.teachingMethod.length > 10);
    assert.ok(guide.practicalExamples.length >= 1);
    assert.ok(guide.questionsToAskChild.length >= 2);
    assert.ok(guide.commonMistakesToAvoid.length >= 1);
    assert.ok(guide.followupPracticeSuggestion.length > 10);
    assert.ok(guide.teacherHelpIndicators.length >= 1);
    // Child-safety: never outputs psychological diagnoses
    const combined = JSON.stringify(guide).toLowerCase();
    assert.equal(combined.includes('adhd'), false);
    assert.equal(combined.includes('dyslexia'), false);
    assert.equal(combined.includes('disorder'), false);
  });

  it('filters questions by history mode, marks/time bounds, learning objectives, and rejects insufficient matches cleanly', () => {
    const adminCtx: AuthorizationContext = {
      userId: 'usr-admin-1',
      role: 'admin',
      assignedSubjectIds: [],
    };
    const pool: QuizItem[] = [
      makeQuestion('Q1', 'subj-math', 't1', 'Simple', 1, 25, 'mcq', 'Division fact families'),
      makeQuestion('Q2', 'subj-math', 't2', 'Moderate', 2, 45, 'numerical', 'Division remainder'),
      makeQuestion('Q3', 'subj-math', 't1', 'Challenging', 3, 70, 'mcq', 'Fraction sharing'),
      makeQuestion('Q4', 'subj-sinhala', 't3', 'Simple', 1, 30, 'mcq', 'Sinhala proverbs'),
    ];

    // History mode: previously_incorrect
    const missedSel = selectQuestionsForAssessment({
      pool,
      ctx: adminCtx,
      subjectIds: ['subj-math'],
      historyMode: 'previously_incorrect',
      incorrectQuestionIds: new Set(['Q2', 'Q3']),
      count: 2,
      mode: 'deterministic',
      seed: 1,
      balanceByTopic: true,
    });
    assert.deepEqual(
      missedSel.selected.map((q) => q.id),
      ['Q2', 'Q3']
    );

    // Filter by learning objective query & marks range
    const objSel = selectQuestionsForAssessment({
      pool,
      ctx: adminCtx,
      subjectIds: ['subj-math'],
      learningObjectiveQuery: 'Division',
      minMarks: 2,
      maxMarks: 3,
      count: 1,
      mode: 'deterministic',
      seed: 1,
    });
    assert.equal(objSel.selected[0].id, 'Q2');

    // Strictly rejects without silent substitution when fewer matching questions exist
    assert.throws(
      () =>
        selectQuestionsForAssessment({
          pool,
          ctx: adminCtx,
          subjectIds: ['subj-math'],
          historyMode: 'repeated_error',
          repeatedErrorQuestionIds: new Set(['Q1']),
          count: 3,
          mode: 'randomized',
          seed: 1,
        }),
      /Insufficient eligible questions/
    );
  });
});
