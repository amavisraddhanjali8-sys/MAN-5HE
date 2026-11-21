import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Man5heDatabase } from './db.ts';
import { AcademicService, HttpError } from './academicService.ts';

function createTempService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'man5he-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new Man5heDatabase(dbPath);
  const service = new AcademicService(db);
  return {
    dir,
    db,
    service,
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

describe('AcademicService SQLite RBAC, Question Intelligence & Intervention Engine', () => {
  const cleanups: (() => void)[] = [];

  after(() => {
    for (const fn of cleanups) fn();
  });

  it('enforces many-to-many teacher subject authorization and revokes access immediately', () => {
    const ctxWrap = createTempService();
    cleanups.push(ctxWrap.cleanup);
    const { service } = ctxWrap;

    const admin = service.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = service.getUserByIdentifier('teacher.math@man5he.lk')!;
    const langTeacher = service.getUserByIdentifier('teacher.lang@man5he.lk')!;

    assert.ok(admin && mathTeacher && langTeacher);

    // Math teacher can inspect CUR-002 (subj-math) and CUR-007 (subj-logic)
    const tMathCtx = service.buildAuthContext(mathTeacher);
    const detailMath = service.getQuestionDetailIntelligence(tMathCtx, 'CUR-002');
    assert.equal(detailMath.question.id, 'CUR-002');

    // Math teacher MUST receive 403 for CUR-006 (subj-sinhala)
    assert.throws(
      () => service.getQuestionDetailIntelligence(tMathCtx, 'CUR-006'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Math teacher MUST receive 403 when querying unassigned subject analytics
    assert.throws(
      () => service.getScopedAnalytics(tMathCtx, { subjectId: 'subj-sinhala' }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Grant shared subject (subj-math) to Language teacher -> both now manage subj-math
    const updatedLang = service.setTeacherSubjects(admin, langTeacher.id, [
      'subj-sinhala',
      'subj-env',
      'subj-english',
      'subj-math',
    ]);
    assert.ok(updatedLang.assignedSubjectIds.includes('subj-math'));
    const tLangCtx1 = service.buildAuthContext(service.getUserById(langTeacher.id)!);
    assert.equal(service.getQuestionDetailIntelligence(tLangCtx1, 'CUR-002').question.id, 'CUR-002');

    // Immediately revoke subj-math from Math teacher -> immediate 403
    service.setTeacherSubjects(admin, mathTeacher.id, ['subj-logic']);
    const revokedMathCtx = service.buildAuthContext(service.getUserById(mathTeacher.id)!);
    assert.throws(
      () => service.getQuestionDetailIntelligence(revokedMathCtx, 'CUR-002'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
  });

  it('transfers question visibility when moved to another subject while preserving historical attempts', () => {
    const ctxWrap = createTempService();
    cleanups.push(ctxWrap.cleanup);
    const { service } = ctxWrap;

    const admin = service.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = service.getUserByIdentifier('teacher.math@man5he.lk')!;
    const langTeacher = service.getUserByIdentifier('teacher.lang@man5he.lk')!;

    // Before move: CUR-003 is subj-spatial (visible to mathTeacher, hidden from langTeacher)
    const beforeStats = service.getQuestionDetailIntelligence(
      service.buildAuthContext(mathTeacher),
      'CUR-003'
    );
    const prevValidAttempts = beforeStats.metrics.validAttemptCount;
    assert.ok(prevValidAttempts >= 1);

    // Move CUR-003 from subj-spatial to subj-env
    const moved = service.reassignQuestionSubject(admin, 'CUR-003', {
      subjectId: 'subj-env',
      changeNote: 'Reclassified geometry garden question under Environmental Studies',
    });
    assert.equal(moved.subjectId, 'subj-env');
    assert.equal(moved.version, 2);

    // Now mathTeacher loses access (403) and langTeacher gains access WITH historical attempts intact
    assert.throws(
      () => service.getQuestionDetailIntelligence(service.buildAuthContext(mathTeacher), 'CUR-003'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
    const afterLangView = service.getQuestionDetailIntelligence(
      service.buildAuthContext(langTeacher),
      'CUR-003'
    );
    assert.equal(afterLangView.metrics.validAttemptCount, prevValidAttempts);
    assert.equal(afterLangView.versions.length, 2);
  });

  it('records idempotent attempts, separates skipped/timed_out, triggers cases, never auto-closes on 1 right answer, and reopens on recurrence', () => {
    const ctxWrap = createTempService();
    cleanups.push(ctxWrap.cleanup);
    const { service } = ctxWrap;

    const admin = service.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = service.getUserByIdentifier('teacher.math@man5he.lk')!;
    const student = service.getUserByIdentifier('kasun@man5he.lk')!;

    // Create fresh question CUR-TEST in subj-math
    const q = service.createQuestion(admin, {
      subjectId: 'subj-math',
      topicId: 'top-math-time',
      subtopicId: 'sub-math-hours',
      questionSi: 'පැය 3 ක් මිනිත්තු කීයද?',
      questionEn: 'How many minutes are in 3 hours?',
      options: ['120', '180', '240', '300'],
      correctIndex: 1,
      memoryTrickTitle: '3 Clock Pizzas',
      memoryTrickBody: '60 x 3 = 180 minutes.',
      explanation: '3 hours * 60 = 180 minutes.',
    });

    // 1. Record skipped and timed_out -> MUST NOT count as incorrect or increment attempt_sequence_number
    const skipRes = service.recordQuestionAttempt({
      student,
      questionId: q.id,
      submittedAnswerIndex: null,
      submissionStatus: 'skipped',
      responseDurationMs: 4000,
      contextMode: 'practice',
      sessionId: 'SES-T1',
      idempotencyKey: 'idem-skip-1',
    });
    assert.equal(skipRes.attempt.isCorrect, null);
    assert.equal(skipRes.attempt.attemptSequenceNumber, 0);

    const timeoutRes = service.recordQuestionAttempt({
      student,
      questionId: q.id,
      submittedAnswerIndex: null,
      submissionStatus: 'timed_out',
      responseDurationMs: 60000,
      contextMode: 'timed_exam',
      sessionId: 'SES-T2',
      idempotencyKey: 'idem-timeout-1',
    });
    assert.equal(timeoutRes.attempt.isCorrect, null);

    // 2. Submit wrong answer #1 (and replay with same idempotencyKey -> deduplicated!)
    const w1 = service.recordQuestionAttempt({
      student,
      questionId: q.id,
      submittedAnswerIndex: 0,
      submissionStatus: 'valid_answered',
      responseDurationMs: 22000,
      contextMode: 'practice',
      sessionId: 'SES-T3',
      idempotencyKey: 'idem-w1',
    });
    assert.equal(w1.attempt.attemptSequenceNumber, 1);
    assert.equal(w1.attempt.isCorrect, false);
    assert.equal(w1.caseEvent, 'none');

    const w1Dup = service.recordQuestionAttempt({
      student,
      questionId: q.id,
      submittedAnswerIndex: 0,
      submissionStatus: 'valid_answered',
      responseDurationMs: 22000,
      contextMode: 'practice',
      sessionId: 'SES-T3',
      idempotencyKey: 'idem-w1',
    });
    assert.equal(w1Dup.deduplicated, true);
    assert.equal(w1Dup.attempt.id, w1.attempt.id);

    // 3. Submit wrong answer #2 and #3 -> triggers OPEN intervention case
    service.recordQuestionAttempt({
      student,
      questionId: q.id,
      submittedAnswerIndex: 2,
      submissionStatus: 'valid_answered',
      responseDurationMs: 25000,
      contextMode: 'practice',
      sessionId: 'SES-T4',
      idempotencyKey: 'idem-w2',
    });
    const w3 = service.recordQuestionAttempt({
      student,
      questionId: q.id,
      submittedAnswerIndex: 3,
      submissionStatus: 'valid_answered',
      responseDurationMs: 19000,
      hintUsed: true,
      contextMode: 'practice',
      sessionId: 'SES-T5',
      idempotencyKey: 'idem-w3',
    });
    assert.equal(w3.caseEvent, 'case_created');
    assert.ok(w3.interventionCase);
    assert.equal(w3.interventionCase!.status, 'OPEN');
    assert.equal(w3.interventionCase!.incorrectCount, 3);
    const caseId = w3.interventionCase!.id;

    // 4. Rapid 4th wrong answer inside 30-min cooldown updates count WITHOUT duplicate alert spam
    const w4 = service.recordQuestionAttempt({
      student,
      questionId: q.id,
      submittedAnswerIndex: 0,
      submissionStatus: 'valid_answered',
      responseDurationMs: 15000,
      contextMode: 'practice',
      sessionId: 'SES-T6',
      idempotencyKey: 'idem-w4',
    });
    assert.equal(w4.caseEvent, 'case_updated_cooldown');
    assert.equal(w4.interventionCase!.incorrectCount, 4);

    // 5. Teacher assigns intervention
    const tCtx = service.buildAuthContext(mathTeacher);
    const assigned = service.applyInterventionAction(mathTeacher, caseId, {
      nextStatus: 'INTERVENTION_ASSIGNED',
      templateId: 'tpl-prereq-recap',
      instructionTitle: 'Clock Pizza 60-Min Drill',
      instructionBody: 'Multiply hours by 60 first using 3 pizza groups.',
      recommendedPracticeTopicId: 'top-math-time',
    });
    assert.equal(assigned.caseDetail.status, 'INTERVENTION_ASSIGNED');

    // 6. Single correct follow-up MUST NOT auto-close; transitions to MONITORING (1/2)
    const c1 = service.recordQuestionAttempt({
      student,
      questionId: q.id,
      submittedAnswerIndex: 1,
      submissionStatus: 'valid_answered',
      responseDurationMs: 14000,
      contextMode: 'targeted_intervention',
      sessionId: 'SES-T7',
      idempotencyKey: 'idem-c1',
    });
    assert.equal(c1.interventionCase!.status, 'MONITORING');
    assert.equal(c1.interventionCase!.consecutiveCorrectAfterCase, 1);
    assert.equal(c1.interventionCase!.readyForTeacherReview, false);

    // 7. Second consecutive correct flags readyForTeacherReview = true, still MONITORING until teacher resolves
    const c2 = service.recordQuestionAttempt({
      student,
      questionId: q.id,
      submittedAnswerIndex: 1,
      submissionStatus: 'valid_answered',
      responseDurationMs: 11000,
      contextMode: 'targeted_intervention',
      sessionId: 'SES-T8',
      idempotencyKey: 'idem-c2',
    });
    assert.equal(c2.interventionCase!.status, 'MONITORING');
    assert.equal(c2.interventionCase!.consecutiveCorrectAfterCase, 2);
    assert.equal(c2.interventionCase!.readyForTeacherReview, true);

    // 8. Teacher resolves case
    const resolved = service.applyInterventionAction(mathTeacher, caseId, {
      nextStatus: 'RESOLVED',
      resolutionNotes: 'Mastered hour-to-minute multiplication consistently.',
    });
    assert.equal(resolved.caseDetail.status, 'RESOLVED');

    // 9. New wrong attempt later -> automatically reopens same case!
    const w5 = service.recordQuestionAttempt({
      student,
      questionId: q.id,
      submittedAnswerIndex: 0,
      submissionStatus: 'valid_answered',
      responseDurationMs: 21000,
      contextMode: 'practice',
      sessionId: 'SES-T9',
      idempotencyKey: 'idem-w5',
    });
    assert.equal(w5.caseEvent, 'case_reopened');
    assert.equal(w5.interventionCase!.id, caseId);
    assert.equal(w5.interventionCase!.status, 'OPEN');
    assert.equal(w5.interventionCase!.reopenCount, 1);

    // 10. Check metrics accuracy and recalculation consistency
    const detailBeforeRecalc = service.getQuestionDetailIntelligence(tCtx, q.id);
    assert.equal(detailBeforeRecalc.metrics.validAttemptCount, 7); // 5 wrong + 2 correct
    assert.equal(detailBeforeRecalc.metrics.skippedOrUnansweredCount, 1);
    assert.equal(detailBeforeRecalc.metrics.timedOutCount, 1);
    assert.equal(detailBeforeRecalc.metrics.firstAttemptAccuracy, 0);
    assert.equal(detailBeforeRecalc.metrics.repeatAttemptTotal, 6);

    const recalc = service.recalculateAllAnalytics(admin);
    assert.equal(recalc.ok, true);
    const listAfterRecalc = service.listQuestionsWithStats(tCtx, { search: q.id });
    assert.equal(listAfterRecalc.quizzes[0].stats.validAttempts, 7);
    assert.equal(listAfterRecalc.quizzes[0].stats.skippedCount, 1);
    assert.equal(listAfterRecalc.quizzes[0].stats.timedOutCount, 1);
  });

  it('respects guardian verification and consent before dispatching external student notifications', () => {
    const ctxWrap = createTempService();
    cleanups.push(ctxWrap.cleanup);
    const { service } = ctxWrap;

    const admin = service.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = service.getUserByIdentifier('teacher.math@man5he.lk')!;
    const kasun = service.getUserByIdentifier('kasun@man5he.lk')!;

    // Revoke guardian consent for Kasun
    service.updateStudentGuardianConsent(admin, kasun.id, {
      guardianContactVerified: false,
      guardianConsentGiven: false,
    });

    // Assign updated instruction on CASE-SEED-002 -> external guardian message must be skipped_unverified
    service.applyInterventionAction(mathTeacher, 'CASE-SEED-002', {
      nextStatus: 'INTERVENTION_ASSIGNED',
      instructionTitle: 'Bus Net Change Practice',
      instructionBody: 'Count net exit first before subtracting from 42.',
      notifyGuardian: true,
    });

    const kasunFresh = service.getUserById(kasun.id)!;
    const notifList = service.listNotifications(kasunFresh);
    const skippedNotif = notifList.notifications.find(
      (n) => n.deliveryStatus === 'skipped_unverified'
    );
    assert.ok(skippedNotif, 'Expected external guardian alert to be marked skipped_unverified');

    // Retrying while consent is still false must fail safely
    assert.throws(
      () => service.retryNotification(admin, skippedNotif!.id),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );

    // Once guardian is verified and consented, retry succeeds
    service.updateStudentGuardianConsent(admin, kasun.id, {
      guardianContactVerified: true,
      guardianConsentGiven: true,
    });
    const retried = service.retryNotification(admin, skippedNotif!.id);
    assert.equal(retried.ok, true);
  });
});
