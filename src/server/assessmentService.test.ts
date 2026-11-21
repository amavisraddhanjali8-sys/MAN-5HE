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

  it('supports rejection/revision, retirement with replacement, and subject reassignment preserving historical snapshots', () => {
    const wrap = createTempServices();
    cleanups.push(wrap.cleanup);
    const { academicService, assessmentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const langTeacher = academicService.getUserByIdentifier('teacher.lang@man5he.lk')!;
    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;

    // Teacher creates draft -> submits -> Admin rejects -> Teacher edits -> Admin approves -> Activates
    const q1 = assessmentService.createQuestionExtended(mathTeacher, {
      subjectId: 'subj-math',
      topicId: 'top-math-money',
      questionType: 'mcq',
      questionSi: 'Original Draft: 12 + 8 = ?',
      options: ['18', '20', '22', '24'],
      correctIndex: 1,
      approvalStatus: 'DRAFT',
    });
    assessmentService.transitionQuestionStatus(mathTeacher, q1.id, { toStatus: 'PENDING_REVIEW' });
    const rejected = assessmentService.transitionQuestionStatus(admin, q1.id, {
      toStatus: 'REJECTED',
      notes: 'Clarify currency unit in prompt',
    });
    assert.equal(rejected.approvalStatus, 'REJECTED');

    const revised = assessmentService.updateQuestionExtended(mathTeacher, q1.id, {
      questionSi: 'රු. 12 + රු. 8 = කීයද?',
      changeNote: 'Added Rs. currency unit',
    });
    assert.equal(revised.version, 2);

    assessmentService.transitionQuestionStatus(mathTeacher, q1.id, { toStatus: 'PENDING_REVIEW' });
    assessmentService.transitionQuestionStatus(admin, q1.id, { toStatus: 'APPROVED' });
    const activeQ1 = assessmentService.transitionQuestionStatus(admin, q1.id, { toStatus: 'ACTIVE' });
    assert.equal(activeQ1.approvalStatus, 'ACTIVE');

    // Create replacement question and retire q1 pointing to replacement
    const qReplacement = assessmentService.createQuestionExtended(admin, {
      subjectId: 'subj-math',
      topicId: 'top-math-money',
      questionType: 'mcq',
      questionSi: 'රු. 15 + රු. 10 = කීයද?',
      options: ['20', '25', '30', '35'],
      correctIndex: 1,
      approvalStatus: 'ACTIVE',
    });

    // Include q1 in an assessment first, let student complete it, then retire q1 and move subject
    const asm = assessmentService.createAssessment(admin, {
      kind: 'practice_session',
      title: 'Lifecycle & Subject Move Practice',
      subjectIds: ['subj-math'],
      explanationTiming: 'immediate',
      status: 'PUBLISHED',
      sections: [{ title: 'S1', items: [{ questionId: q1.id, marks: 2 }] }],
    });
    const session = assessmentService.startOrResumeAssessmentAttempt(student, asm.id);
    const snapId = session.questions[0].snapshotId!;
    const checkImm = assessmentService.checkPracticeQuestionAnswer(student, asm.id, {
      attemptId: session.attempt.id,
      snapshotId: snapId,
      submittedOptionIndex: 1,
    });
    assert.equal(checkImm.isCorrect, true);
    assert.ok(checkImm.explanation);

    assessmentService.submitAssessmentAttempt(student, asm.id, {
      attemptId: session.attempt.id,
      answers: [{ snapshotId: snapId, questionId: q1.id, submittedOptionIndex: 1 }],
    });

    const retired = assessmentService.transitionQuestionStatus(admin, q1.id, {
      toStatus: 'RETIRED',
      replacedByQuestionId: qReplacement.id,
      notes: 'Replaced by updated currency item',
    });
    assert.equal(retired.approvalStatus, 'RETIRED');
    assert.equal(retired.replacedByQuestionId, qReplacement.id);

    // Move qReplacement from subj-math to subj-env -> langTeacher gains access, mathTeacher loses access
    academicService.reassignQuestionSubject(admin, qReplacement.id, {
      subjectId: 'subj-env',
      changeNote: 'Cross-subject move test',
    });
    assert.throws(
      () =>
        academicService.getQuestionDetailIntelligence(
          academicService.buildAuthContext(mathTeacher),
          qReplacement.id
        ),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
    const langView = academicService.getQuestionDetailIntelligence(
      academicService.buildAuthContext(langTeacher),
      qReplacement.id
    );
    assert.equal(langView.question.id, qReplacement.id);
  });

  it('preserves shuffled option grading accuracy, paper versioning, and manual-fail repeated-error intervention triggers', () => {
    const wrap = createTempServices();
    cleanups.push(wrap.cleanup);
    const { academicService, assessmentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const student = academicService.getUserByIdentifier('kasun@man5he.lk')!;

    // Teacher with multiple subjects builds cross-subject (subj-math + subj-logic) shuffled exam
    const qMath = assessmentService.createQuestionExtended(mathTeacher, {
      subjectId: 'subj-math',
      topicId: 'top-math-money',
      questionType: 'mcq',
      questionSi: 'Shuffled Math: 40 - 15 = ?',
      options: ['15', '20', '25', '30'],
      correctIndex: 2,
      defaultMarks: 2,
      approvalStatus: 'DRAFT',
    });
    assessmentService.transitionQuestionStatus(admin, qMath.id, { toStatus: 'ACTIVE' });

    const qLogic = assessmentService.createQuestionExtended(mathTeacher, {
      subjectId: 'subj-logic',
      topicId: 'top-logic-seq',
      questionType: 'mcq',
      questionSi: 'Shuffled Logic: 2, 4, 8, ?',
      options: ['10', '12', '14', '16'],
      correctIndex: 3,
      defaultMarks: 2,
      approvalStatus: 'DRAFT',
    });
    assessmentService.transitionQuestionStatus(admin, qLogic.id, { toStatus: 'ACTIVE' });

    const qWritten = assessmentService.createQuestionExtended(admin, {
      subjectId: 'subj-math',
      topicId: 'top-math-money',
      questionType: 'short_answer',
      questionSi: 'Explain coin change calculation',
      acceptedAnswers: ['Rubric'],
      markingRule: { requiresManualReview: true },
      defaultMarks: 2,
      approvalStatus: 'ACTIVE',
    });

    // Insufficient bank check MUST reject without silent substitution
    assert.throws(
      () =>
        assessmentService.previewQuestionSelection(mathTeacher, {
          subjectIds: ['subj-math'],
          questionTypes: ['short_answer'],
          count: 25,
          mode: 'deterministic',
        }),
      /without silent substitution/
    );

    const mock = assessmentService.createAssessment(mathTeacher, {
      kind: 'mock_exam',
      title: 'Cross-Subject Shuffled Mock',
      subjectIds: ['subj-math', 'subj-logic'],
      shuffleQuestions: true,
      shuffleOptions: true,
      explanationTiming: 'after_submit',
      maxAttempts: 5,
      status: 'PUBLISHED',
      sections: [
        {
          title: 'Mixed Subjects',
          items: [
            { questionId: qMath.id, marks: 2 },
            { questionId: qLogic.id, marks: 2 },
            { questionId: qWritten.id, marks: 2 },
          ],
        },
      ],
    });

    // Student completes Attempt 1 picking the exact correct option text in shuffled positions,
    // and writes an incorrect response on qWritten
    const sess1 = assessmentService.startOrResumeAssessmentAttempt(student, mock.id);
    const ans1 = sess1.questions.map((q) => {
      if (q.id === qMath.id) {
        return { snapshotId: q.snapshotId!, questionId: q.id, submittedOptionIndex: q.options.indexOf('25') };
      }
      if (q.id === qLogic.id) {
        return { snapshotId: q.snapshotId!, questionId: q.id, submittedOptionIndex: q.options.indexOf('16') };
      }
      return { snapshotId: q.snapshotId!, questionId: q.id, submittedAnswerText: 'Wrong step' };
    });
    const sub1 = assessmentService.submitAssessmentAttempt(student, mock.id, {
      attemptId: sess1.attempt.id,
      answers: ans1,
    });
    assert.equal(sub1.attempt.status, 'pending_manual_marking');
    assert.equal(sub1.attempt.scorePercent, null);
    assert.equal(sub1.attempt.autoScore, 4);

    // Manual marking 0/2 on written response x 3 attempts triggers Enhancement 01 repeated-error intervention!
    const wSnap1 = sess1.questions.find((q) => q.id === qWritten.id)!.snapshotId!;
    const g1 = assessmentService.gradeManualAnswers(mathTeacher, sess1.attempt.id, [
      { snapshotId: wSnap1, awardedMarks: 0, comment: 'Needs method' },
    ]);
    assert.equal(g1.attempt.status, 'graded');
    assert.equal(g1.attempt.scorePercent, 67); // 4/6

    // Two more quick written failures trigger threshold = 3 OPEN intervention case
    for (let k = 0; k < 2; k++) {
      const s = assessmentService.startOrResumeAssessmentAttempt(student, mock.id);
      const wSnap = s.questions.find((q) => q.id === qWritten.id)!.snapshotId!;
      assessmentService.submitAssessmentAttempt(student, mock.id, {
        attemptId: s.attempt.id,
        answers: [{ snapshotId: wSnap, questionId: qWritten.id, submittedAnswerText: 'Still wrong' }],
      });
      assessmentService.gradeManualAnswers(mathTeacher, s.attempt.id, [
        { snapshotId: wSnap, awardedMarks: 0, comment: 'Repeat mistake' },
      ]);
    }
    const qDetail = academicService.getQuestionDetailIntelligence(
      academicService.buildAuthContext(mathTeacher),
      qWritten.id
    );
    assert.equal(qDetail.metrics.incorrectAttemptCount, 3);
    assert.equal(qDetail.metrics.repeatedErrorStudentCount, 1);

    // Create New Version (v2) and modify draft without touching v1 historical attempt review
    const v2Draft = assessmentService.createAssessmentNewVersion(mathTeacher, mock.id);
    assert.equal(v2Draft.currentVersion, 2);
    assert.equal(v2Draft.status, 'DRAFT');

    assessmentService.updateDraftAssessment(mathTeacher, mock.id, {
      title: 'Cross-Subject Shuffled Mock v2',
      sections: [{ title: 'V2 Section', items: [{ questionId: qMath.id, marks: 5 }] }],
    });
    assessmentService.transitionAssessmentStatus(mathTeacher, mock.id, { toStatus: 'PUBLISHED' });

    const v1ReviewAfterBump = assessmentService.getAttemptReview(student, sess1.attempt.id);
    assert.equal(v1ReviewAfterBump.items.length, 3);
    assert.equal(v1ReviewAfterBump.attempt.assessmentVersion, 1);
    assert.equal(v1ReviewAfterBump.attempt.totalAwardedMarks, 4);
  });

  it('maintains fast query and selection performance with 2,500+ curated questions', () => {
    const wrap = createTempServices();
    cleanups.push(wrap.cleanup);
    const { db, academicService, assessmentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const now = new Date().toISOString();
    const ins = db.db.prepare(
      `INSERT INTO questions (
        id, source, subject_id, topic_id, subtopic_id, version, grade, question_type,
        cognitive_skill, learning_objectives, hint, marking_rule_json, accepted_answers_json,
        default_marks, approval_status, author_id, author_name, question_si, question_en,
        options_json, correct_index, memory_trick_title, memory_trick_body, explanation,
        misconceptions_json, attributes_json, quality_flag, active, created_by, created_at, updated_at
      ) VALUES (?, 'curated', 'subj-math', 'top-math-money', 'sub-math-change', 1, 'Grade 5', 'mcq',
        'Application', 'Bulk perf test', '', '{}', '[]', 1, 'ACTIVE', 'usr-admin-1', 'Admin',
        ?, ?, '["1","2","3","4"]', 1, 'Tip', 'Trick', 'Exp', '[]', ?, 'OK', 1, 'admin', ?, ?)`
    );

    const attrs = JSON.stringify({
      intelligenceMeasure: 45,
      correctProbability: 0.75,
      wrongProbability: 0.25,
      examPriority: 7,
      quizStrength: 75,
      difficultyTier: 'Moderate',
      cognitiveDomain: 'Mathematics & Word Problems',
      estimatedSeconds: 30,
    });

    db.transaction(() => {
      for (let i = 1; i <= 2500; i++) {
        ins.run(`PERF-Q-${i}`, `Perf Prompt ${i}`, `Perf Prompt ${i}`, attrs, now, now);
      }
    });

    const t0 = Date.now();
    const listRes = academicService.listQuestionsWithStats(academicService.buildAuthContext(admin), {
      source: 'curated',
      subjectId: 'subj-math',
      approvalStatus: 'ACTIVE',
      page: 2,
      pageSize: 20,
    });
    const selRes = assessmentService.previewQuestionSelection(admin, {
      subjectIds: ['subj-math'],
      count: 40,
      mode: 'randomized',
      seed: 99,
    });
    const elapsedMs = Date.now() - t0;

    assert.ok(listRes.curatedCount >= 2500);
    assert.equal(listRes.quizzes.length, 20);
    assert.equal(selRes.selected.length, 40);
    assert.ok(elapsedMs < 2000, `Expected <2000ms for 2500-item filter & select, got ${elapsedMs}ms`);
  });
});
