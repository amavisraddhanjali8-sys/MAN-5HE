import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Man5heDatabase } from './db.ts';
import { AcademicService, HttpError } from './academicService.ts';
import { AssessmentService } from './assessmentService.ts';

function createTempServices() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'man5he-asm-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new Man5heDatabase(dbPath);
  const academicService = new AcademicService(db);
  const assessmentService = new AssessmentService(db, academicService);
  return {
    dir,
    db,
    academicService,
    assessmentService,
    cleanup: () => {
      try {
        db.db.close();
      } catch {
        // ignore
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('AssessmentService SQLite RBAC, Snapshot Immutability, Multi-Type Attempts & Manual Marking', () => {
  const cleanups: (() => void)[] = [];

  after(() => {
    for (const fn of cleanups) fn();
  });

  it('enforces subject-scoped question authoring, admin approval workflow, bulk import, and immediate permission revocation', () => {
    const wrap = createTempServices();
    cleanups.push(wrap.cleanup);
    const { academicService, assessmentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;

    // Teacher cannot author in subj-sinhala
    assert.throws(
      () =>
        assessmentService.createQuestionExtended(mathTeacher, {
          subjectId: 'subj-sinhala',
          questionType: 'mcq',
          questionSi: 'Unauthorized Sinhala question',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Teacher creates a numerical question as DRAFT in subj-math, submits for review
    const created = assessmentService.createQuestionExtended(mathTeacher, {
      subjectId: 'subj-math',
      topicId: 'top-math-money',
      subtopicId: 'sub-math-change',
      questionType: 'numerical',
      questionSi: 'රු. 250 කින් රු. 175 ක් අඩු කළ විට ඉතිරිය කීයද?',
      questionEn: 'What is 250 minus 175?',
      acceptedAnswers: ['75'],
      markingRule: { numericTolerance: 0 },
      defaultMarks: 2,
      approvalStatus: 'DRAFT',
    });
    assert.equal(created.approvalStatus, 'DRAFT');

    // Teacher cannot approve own question
    assert.throws(
      () =>
        assessmentService.transitionQuestionStatus(mathTeacher, created.id, {
          toStatus: 'APPROVED',
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Teacher submits for review -> Admin activates it
    const pending = assessmentService.transitionQuestionStatus(mathTeacher, created.id, {
      toStatus: 'PENDING_REVIEW',
      notes: 'Ready for review',
    });
    assert.equal(pending.approvalStatus, 'PENDING_REVIEW');

    const activated = assessmentService.transitionQuestionStatus(admin, created.id, {
      toStatus: 'ACTIVE',
      notes: 'Verified answer and rubric',
    });
    assert.equal(activated.approvalStatus, 'ACTIVE');

    // Bulk import JSON for mathTeacher (mixed valid + invalid row + unauthorized subject row rejected/error)
    const bulkRes = assessmentService.bulkImportQuestions(mathTeacher, {
      format: 'json',
      defaultSubjectId: 'subj-math',
      content: JSON.stringify([
        {
          subjectId: 'subj-math',
          questionType: 'true_false',
          questionSi: '100 සංඛ්‍යාව 4න් ඉතිරි නැතිව බෙදේ.',
          correctIndex: 0,
        },
        {
          subjectId: 'subj-sinhala',
          questionType: 'true_false',
          questionSi: 'Unassigned subject row',
          correctIndex: 0,
        },
      ]),
    });
    assert.equal(bulkRes.importedCount, 1);
    assert.equal(bulkRes.errors.length, 1);

    // Build an assessment as mathTeacher using created question
    const asm = assessmentService.createAssessment(mathTeacher, {
      kind: 'practice_session',
      title: 'Teacher Math Sprint',
      subjectIds: ['subj-math'],
      status: 'PUBLISHED',
      sections: [
        {
          title: 'Section A',
          subjectId: 'subj-math',
          items: [{ questionId: created.id, marks: 2 }],
        },
      ],
    });
    assert.equal(asm.totalMarks, 2);

    // Revoke subj-math from mathTeacher -> immediate 403 on question update, assessment detail, analytics & export
    academicService.setTeacherSubjects(admin, mathTeacher.id, ['subj-logic']);
    const revokedTeacher = academicService.getUserById(mathTeacher.id)!;

    assert.throws(
      () => assessmentService.getAssessmentDetailScoped(revokedTeacher, asm.id),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
    assert.throws(
      () => assessmentService.exportAssessmentPrintable(revokedTeacher, asm.id, false),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Student cannot call teacher/admin assessment endpoints
    assert.throws(
      () => assessmentService.listAssessmentsScoped(student),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
  });

  it('guarantees snapshot immutability when questions are edited after assessment creation', () => {
    const wrap = createTempServices();
    cleanups.push(wrap.cleanup);
    const { academicService, assessmentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;

    const q = assessmentService.createQuestionExtended(admin, {
      subjectId: 'subj-math',
      topicId: 'top-math-money',
      questionType: 'mcq',
      questionSi: 'Original Prompt V1: 5 + 5 = ?',
      questionEn: 'Original Prompt V1: 5 + 5 = ?',
      options: ['8', '10', '12', '14'],
      correctIndex: 1,
      defaultMarks: 2,
      approvalStatus: 'ACTIVE',
    });

    const asm = assessmentService.createAssessment(admin, {
      kind: 'mock_exam',
      title: 'Snapshot Lock Exam',
      subjectIds: ['subj-math'],
      shuffleQuestions: false,
      shuffleOptions: false,
      explanationTiming: 'immediate',
      status: 'PUBLISHED',
      sections: [
        {
          title: 'Part I',
          subjectId: 'subj-math',
          items: [{ questionId: q.id, marks: 2 }],
        },
      ],
    });

    // Edit question in bank to V2 with totally different prompt & correct answer
    const qV2 = assessmentService.updateQuestionExtended(admin, q.id, {
      questionSi: 'Edited Prompt V2: 9 + 9 = ?',
      questionEn: 'Edited Prompt V2: 9 + 9 = ?',
      options: ['16', '17', '18', '19'],
      correctIndex: 2,
      changeNote: 'Updated to V2 after exam publication',
    });
    assert.equal(qV2.version, 2);

    // Student starts exam -> MUST see V1 prompt & V1 options & be graded against V1 answer (index 1 = '10')
    const session = assessmentService.startOrResumeAssessmentAttempt(student, asm.id);
    assert.equal(session.questions[0].questionSi, 'Original Prompt V1: 5 + 5 = ?');
    assert.deepEqual(session.questions[0].options, ['8', '10', '12', '14']);

    const snapId = session.questions[0].snapshotId!;
    const submitted = assessmentService.submitAssessmentAttempt(student, asm.id, {
      attemptId: session.attempt.id,
      answers: [{ snapshotId: snapId, questionId: q.id, submittedOptionIndex: 1 }],
    });

    assert.equal(submitted.attempt.totalAwardedMarks, 2);
    assert.equal(submitted.attempt.scorePercent, 100);
    assert.equal(submitted.review.items[0].questionSi, 'Original Prompt V1: 5 + 5 = ?');
  });

  it('supports resumable attempts, idempotent submit, manual marking queue, and after_release result gating', () => {
    const wrap = createTempServices();
    cleanups.push(wrap.cleanup);
    const { academicService, assessmentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;

    const qAuto = assessmentService.createQuestionExtended(admin, {
      subjectId: 'subj-math',
      topicId: 'top-math-time',
      questionType: 'numerical',
      questionSi: 'පැය 2 කට මිනිත්තු කීයද?',
      acceptedAnswers: ['120'],
      defaultMarks: 2,
      approvalStatus: 'ACTIVE',
    });

    const qManual = assessmentService.createQuestionExtended(admin, {
      subjectId: 'subj-math',
      topicId: 'top-math-money',
      questionType: 'short_answer',
      questionSi: 'ඔබේ පිළිතුර පියවරෙන් පියවර පැහැදිලි කරන්න.',
      acceptedAnswers: ['Step-by-step explanation'],
      markingRule: { requiresManualReview: true, markingNotes: 'Award 3 marks for clear steps.' },
      defaultMarks: 3,
      approvalStatus: 'ACTIVE',
    });

    const exam = assessmentService.createAssessment(mathTeacher, {
      kind: 'mock_exam',
      title: 'Gated Manual Review Mock',
      subjectIds: ['subj-math'],
      shuffleQuestions: false,
      shuffleOptions: false,
      explanationTiming: 'after_release',
      timeLimitMinutes: 30,
      maxAttempts: 1,
      status: 'PUBLISHED',
      sections: [
        {
          title: 'Mixed Section',
          subjectId: 'subj-math',
          items: [
            { questionId: qAuto.id, marks: 2 },
            { questionId: qManual.id, marks: 3 },
          ],
        },
      ],
    });

    // Start & save progress
    const started = assessmentService.startOrResumeAssessmentAttempt(student, exam.id);
    assert.equal(started.resumed, false);
    const autoSnap = started.questions.find((q) => q.id === qAuto.id)!.snapshotId!;
    const manSnap = started.questions.find((q) => q.id === qManual.id)!.snapshotId!;

    assessmentService.saveAssessmentProgress(student, exam.id, {
      attemptId: started.attempt.id,
      answers: [{ snapshotId: autoSnap, questionId: qAuto.id, submittedAnswerText: '120' }],
    });

    // Resume returns saved progress and same attempt ID
    const resumed = assessmentService.startOrResumeAssessmentAttempt(student, exam.id);
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.attempt.id, started.attempt.id);
    assert.equal(resumed.savedAnswers.length, 1);
    assert.equal(resumed.savedAnswers[0].submittedAnswerText, '120');

    // Review MUST throw 403 while in_progress
    assert.throws(
      () => assessmentService.getAttemptReview(student, started.attempt.id),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Submit both auto + manual answer
    const sub1 = assessmentService.submitAssessmentAttempt(student, exam.id, {
      attemptId: started.attempt.id,
      answers: [
        { snapshotId: autoSnap, questionId: qAuto.id, submittedAnswerText: '120' },
        { snapshotId: manSnap, questionId: qManual.id, submittedAnswerText: '200 - 150 = 50 step' },
      ],
    });
    assert.equal(sub1.attempt.status, 'pending_manual_marking');
    assert.equal(sub1.attempt.autoScore, 2);

    // Duplicate submit is idempotent
    const subDup = assessmentService.submitAssessmentAttempt(student, exam.id, {
      attemptId: started.attempt.id,
      answers: [],
    });
    assert.equal(subDup.deduplicated, true);

    // Results withheld from student while assessment is still PUBLISHED (explanationTiming = after_release)
    const gatedReview = assessmentService.getAttemptReview(student, started.attempt.id);
    assert.equal(gatedReview.resultsReleased, false);
    assert.equal(gatedReview.items.length, 0);

    // Teacher grades the manual question -> attempt becomes graded (2 + 3 = 5/5 = 100%)
    const afterGrade = assessmentService.gradeManualAnswers(mathTeacher, started.attempt.id, [
      { snapshotId: manSnap, awardedMarks: 3, comment: 'Clear step-by-step working' },
    ]);
    assert.equal(afterGrade.attempt.status, 'graded');
    assert.equal(afterGrade.attempt.manualScore, 3);
    assert.equal(afterGrade.attempt.totalAwardedMarks, 5);
    assert.equal(afterGrade.attempt.scorePercent, 100);

    // Close & release results -> student now sees full scores, explanations & teacher comment
    assessmentService.transitionAssessmentStatus(mathTeacher, exam.id, { toStatus: 'CLOSED' });
    assessmentService.transitionAssessmentStatus(mathTeacher, exam.id, { toStatus: 'RESULTS_RELEASED' });

    const unlockedReview = assessmentService.getAttemptReview(student, started.attempt.id);
    assert.equal(unlockedReview.resultsReleased, true);
    assert.equal(unlockedReview.attempt.scorePercent, 100);
    assert.equal(unlockedReview.items.length, 2);
    assert.equal(unlockedReview.items[1].graderComment, 'Clear step-by-step working');

    // Analytics & Export check
    const analytics = assessmentService.getAssessmentAnalytics(mathTeacher, exam.id);
    assert.equal(analytics.attempts.length, 1);
    assert.equal(analytics.questionAnalytics.length, 2);
    const printableNoKey = assessmentService.exportAssessmentPrintable(mathTeacher, exam.id, false);
    assert.equal((printableNoKey.sections[0].questions[0] as Record<string, unknown>).correctIndex, undefined);
    assert.equal((printableNoKey.sections[0].questions[0] as Record<string, unknown>).explanation, undefined);
    const printableWithKey = assessmentService.exportAssessmentPrintable(mathTeacher, exam.id, true);
    assert.ok((printableWithKey.sections[0].questions[0] as Record<string, unknown>).explanation);
  });

  it('auto-closes expired server-side attempt cleanly when student re-opens assessment', () => {
    const wrap = createTempServices();
    cleanups.push(wrap.cleanup);
    const { db, academicService, assessmentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;

    const q = assessmentService.createQuestionExtended(admin, {
      subjectId: 'subj-math',
      questionType: 'true_false',
      questionSi: '10 > 5',
      correctIndex: 0,
      approvalStatus: 'ACTIVE',
    });

    const timedExam = assessmentService.createAssessment(admin, {
      kind: 'mock_exam',
      title: 'Expiry Check Paper',
      subjectIds: ['subj-math'],
      timeLimitMinutes: 5,
      maxAttempts: 2,
      status: 'PUBLISHED',
      sections: [{ title: 'S1', items: [{ questionId: q.id, marks: 1 }] }],
    });

    const started = assessmentService.startOrResumeAssessmentAttempt(student, timedExam.id);
    // Simulate expired timestamp in SQLite
    db.db
      .prepare('UPDATE assessment_attempts SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), started.attempt.id);

    // Calling startOrResume again auto-closes expired attempt #1 and starts attempt #2 cleanly
    const second = assessmentService.startOrResumeAssessmentAttempt(student, timedExam.id);
    assert.equal(second.resumed, false);
    assert.equal(second.attempt.attemptNumber, 2);

    const closedRow = db.db
      .prepare('SELECT status FROM assessment_attempts WHERE id = ?')
      .get(started.attempt.id) as { status: string };
    assert.equal(closedRow.status, 'timed_out');
  });
});
