import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Man5heDatabase } from './db.ts';
import { AcademicService, HttpError } from './academicService.ts';
import { AssessmentService } from './assessmentService.ts';
import { ParentIntelligenceService } from './parentIntelligenceService.ts';

function createTempSuite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'man5he-enh05-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new Man5heDatabase(dbPath);
  const academicService = new AcademicService(db);
  const assessmentService = new AssessmentService(db, academicService);
  const parentService = new ParentIntelligenceService(db, academicService);
  assessmentService.setOnAttemptCompletedHook(async (attemptId) => {
    await parentService.generateReportForAssessmentAttempt(attemptId, {
      sendCompletionNoticeIfPending: true,
      useAiAdaptation: false,
    });
  });

  return {
    dir,
    db,
    academicService,
    assessmentService,
    parentService,
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

describe('ParentIntelligenceService — Links, Automatic Reports, Teaching Guides, Presets, Timetables & Sweep', () => {
  const cleanups: (() => void)[] = [];

  after(() => {
    for (const fn of cleanups) fn();
  });

  it('enforces verified multi-guardian & multi-student link isolation and blocks unrelated guardians', () => {
    const wrap = createTempSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, parentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const parent1 = academicService.getUserByIdentifier('parent@man5he.lk')!;
    const student1 = academicService.getUserByIdentifier('sayuri@man5he.lk')!;
    const student2 = academicService.getUserByIdentifier('kasun@man5he.lk')!;

    // Seeded link exists for parent1 -> student1, NOT student2
    const initialLinks = parentService.getLinkedStudents(parent1);
    assert.equal(initialLinks.length, 1);
    assert.equal(initialLinks[0].studentUserId, student1.id);

    assert.throws(
      () => parentService.listStudentReports(parent1, student2.id),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Admin links parent1 to student2 as well (one guardian -> multiple children)
    const link2 = parentService.createOrVerifyGuardianLink(admin, {
      guardianUserId: parent1.id,
      studentUserId: student2.id,
      relationshipLabel: 'Aunt / Guardian',
      verified: true,
      consentGiven: true,
      canViewReports: true,
      canManageSchedule: true,
    });
    assert.equal(link2.studentUserId, student2.id);

    const updatedLinks = parentService.getLinkedStudents(parent1);
    assert.equal(updatedLinks.length, 2);

    // Register second parent account and link them to student1 (multiple guardians -> one student)
    const parent2Account = academicService.createStudentUser({
      userIdCode: 'M5-PAR-02',
      username: 'ruwan.father',
      name: 'Ruwan Father',
      email: 'father.sayuri@man5he.lk',
      whatsappNumber: '+94775552222',
      passwordHash: parent1.passwordHash,
      totpSecret: parent1.totpSecret,
      totpEnabled: false,
    });
    wrap.db.db.prepare(`UPDATE users SET role = 'parent' WHERE id = ?`).run(parent2Account.id);
    const linkFather = parentService.createOrVerifyGuardianLink(admin, {
      guardianUserId: parent2Account.id,
      studentUserId: student1.id,
      relationshipLabel: 'Father',
      verified: true,
      consentGiven: true,
    });
    assert.equal(linkFather.guardianUserId, parent2Account.id);
    assert.equal(parentService.getVerifiedLinksForStudent(student1.id).length, 2);
  });

  it('generates automatic question-level reports, holds manual-marking finals until graded, and exports HTML/PDF securely', async () => {
    const wrap = createTempSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, assessmentService, parentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;
    const parent = academicService.getUserByIdentifier('parent@man5he.lk')!;
    const unrelatedTeacher = academicService.getUserByIdentifier('teacher.lang@man5he.lk')!;

    // Create 1 MCQ + 1 manual-marking short answer question in an assessment
    const manualQDraft = assessmentService.createQuestionExtended(mathTeacher, {
      subjectId: 'subj-math',
      topicId: 'top-math-money',
      subtopicId: 'sub-math-bus',
      questionType: 'short_answer',
      questionSi: 'Explain why 24 / 6 = 4 using groups.',
      questionEn: 'Explain why 24 / 6 = 4 using equal groups.',
      markingRule: { requiresManualReview: true },
      defaultMarks: 3,
      approvalStatus: 'PENDING_REVIEW',
      explanation: '24 divided into 6 equal groups leaves 4 in each group.',
      memoryTrickTitle: 'Equal Sharing',
      memoryTrickBody: 'Think of sharing 24 mangoes among 6 friends.',
    });
    const manualQ = assessmentService.transitionQuestionStatus(admin, manualQDraft.id, {
      toStatus: 'ACTIVE',
      notes: 'Approved for diagnostic test',
    });

    const asm = assessmentService.createAssessment(admin, {
      kind: 'practice_session',
      title: 'Fraction & Division Diagnostic',
      subjectIds: ['subj-math'],
      status: 'PUBLISHED',
      sections: [
        {
          title: 'Section A',
          subjectId: 'subj-math',
          items: [
            { questionId: 'CUR-002', marks: 1 },
            { questionId: manualQ.id, marks: 3 },
          ],
        },
      ],
    });

    const started = assessmentService.startOrResumeAssessmentAttempt(student, asm.id);
    const snapMcq = started.questions.find((q) => q.id === 'CUR-002')!;
    const snapManual = started.questions.find((q) => q.id === manualQ.id)!;

    const cur002 = academicService.resolveQuizById('CUR-002')!;
    const wrongIdx = (cur002.correctIndex + 1) % cur002.options.length;
    assessmentService.submitAssessmentAttempt(student, asm.id, {
      attemptId: started.attempt.id,
      idempotencyKey: 'enh05-manual-test-1',
      answers: [
        {
          snapshotId: snapMcq.snapshotId!,
          questionId: 'CUR-002',
          submittedOptionIndex: wrongIdx,
        },
        {
          snapshotId: snapManual.snapshotId!,
          questionId: manualQ.id,
          submittedAnswerText: 'Six friends each get four mangoes.',
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 50));

    // While pending manual marking, report is created as pending_manual_marking and final_report is NOT sent yet
    const listPending = parentService.listStudentReports(parent, student.id);
    const reportPending = listPending.reports.find((r) => r.attemptId === started.attempt.id)!;
    assert.ok(reportPending);
    assert.equal(reportPending.finalizationStatus, 'pending_manual_marking');
    const pendingDeliveries = listPending.deliveriesByReport[reportPending.id] || [];
    assert.equal(
      pendingDeliveries.some((d) => d.deliveryStage === 'completion_notice'),
      true
    );
    assert.equal(
      pendingDeliveries.some((d) => d.deliveryStage === 'final_report'),
      false
    );

    // Teacher grades the manual response -> final report & notifications auto-generated!
    assessmentService.gradeManualAnswers(mathTeacher, started.attempt.id, [
      { snapshotId: snapManual.snapshotId!, awardedMarks: 3, comment: 'Clear group explanation!' },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    const listFinal = parentService.listStudentReports(parent, student.id);
    const reportFinal = listFinal.reports.find((r) => r.id === reportPending.id)!;
    assert.equal(reportFinal.finalizationStatus, 'finalized');
    assert.ok(reportFinal.items.length >= 2);
    assert.ok(reportFinal.items[0].teachingGuidance.teachingMethod.length > 10);

    const finalDeliveries = listFinal.deliveriesByReport[reportFinal.id] || [];
    assert.equal(
      finalDeliveries.some((d) => d.deliveryStage === 'final_report' && d.channel === 'email'),
      true
    );
    assert.equal(
      finalDeliveries.some((d) => d.deliveryStage === 'final_report' && d.channel === 'whatsapp'),
      true
    );

    // HTML & PDF binary export checks + unauthorized export block
    const htmlExport = parentService.exportReportHtml(parent, reportFinal.id);
    assert.ok(htmlExport.html.includes('Parent Teaching Guide'));
    assert.ok(htmlExport.html.includes('1. What this tests:'));
    assert.ok(htmlExport.html.includes('Short Reinforcement Note:'));
    const pdfExport = parentService.exportReportPdf(parent, reportFinal.id);
    assert.ok(pdfExport.pdf.subarray(0, 8).toString('utf8').startsWith('%PDF-1.4'));

    assert.throws(
      () => parentService.exportReportPdf(unrelatedTeacher, reportFinal.id),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Legacy round report generation works seamlessly too
    const legacyRpt = await parentService.createReportForRoundAttempt({
      student,
      attempt: {
        id: 'ATT-LEG-TEST-1',
        userId: student.id,
        paperId: 'PRACTICE-ROUND',
        paperTitle: 'Evening Practice Round',
        mode: 'practice',
        paperCategory: 'Balanced Standard',
        totalQuestions: 1,
        correctCount: 0,
        scorePercent: 0,
        timeLimitSeconds: 900,
        timeSpentSeconds: 90,
        starsEarned: 1,
        domainBreakdown: { 'Mathematics & Word Problems': { correct: 0, total: 1 } },
        submittedAt: new Date().toISOString(),
      },
      assessmentKind: 'practice_session',
      items: [{ quizId: 'CUR-002', selectedIndex: wrongIdx, isCorrect: false }],
      sendNotifications: false,
      useAiAdaptation: false,
    });
    assert.ok(legacyRpt.items[0].teachingGuidance.questionsToAskChild.length >= 2);
  });

  it('enforces subject-scoped preset creation, isolated preset application, custom timetable filtering, conflict check, rescheduling, and sweep reminders', () => {
    const wrap = createTempSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, parentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const parent = academicService.getUserByIdentifier('parent@man5he.lk')!;
    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;

    // Math teacher blocked from creating preset referencing subj-sinhala
    assert.throws(
      () =>
        parentService.createTimetablePreset(mathTeacher, {
          title: 'Unauthorized Cross-Subject Preset',
          description: 'Blocked',
          subjectIds: ['subj-sinhala'],
          activities: [
            {
              title: 'Sinhala Slot',
              activityType: 'practice',
              dayOffset: 0,
              timeOfDay: '17:00',
              durationMinutes: 20,
              subjectIds: ['subj-sinhala'],
            },
          ],
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Math teacher creates valid math preset -> admin publishes it
    const teacherPreset = parentService.createTimetablePreset(mathTeacher, {
      title: 'Math Quick Win Plan',
      description: 'Focused arithmetic practice',
      subjectIds: ['subj-math'],
      status: 'PENDING_REVIEW',
      activities: [
        {
          title: 'Arithmetic Warmup',
          activityType: 'practice',
          dayOffset: 1,
          timeOfDay: '17:00',
          durationMinutes: 25,
          recurrenceRule: 'one_time',
          subjectIds: ['subj-math'],
          filterCriteria: {
            subjectIds: ['subj-math'],
            questionCount: 2,
            historyMode: 'all',
          },
        },
      ],
    });
    const publishedPreset = parentService.transitionTimetablePresetStatus(
      admin,
      teacherPreset.id,
      'publish'
    );
    assert.equal(publishedPreset.status, 'PUBLISHED');

    // Guardian applies preset to student -> isolated copy created
    const futureDate = '2026-12-10';
    const applied = parentService.applyPresetToStudent(parent, {
      presetId: publishedPreset.id,
      studentId: student.id,
      startDate: futureDate,
      timezone: 'Asia/Colombo',
    });
    assert.equal(applied.sessions.length, 1);
    const appliedSession = applied.sessions[0];

    // Editing source preset title/version must NOT overwrite the student's existing session!
    parentService.updateTimetablePreset(admin, publishedPreset.id, {
      title: 'Mutated Admin Preset v2',
      activities: [
        {
          title: 'Completely Different Activity',
          activityType: 'mock_exam',
          dayOffset: 2,
          timeOfDay: '19:00',
          durationMinutes: 45,
          recurrenceRule: 'one_time',
          subjectIds: ['subj-math'],
        },
      ],
    });
    const dashboardAfterEdit = parentService.getStudentScheduleDashboard(parent, student.id);
    const preserved = dashboardAfterEdit.sessions.find((s) => s.id === appliedSession.id)!;
    assert.equal(preserved.title, 'Arithmetic Warmup');

    // Conflict rejection (409) when scheduling an overlapping custom timetable
    const localFmtStart = appliedSession.scheduledStartUtc.slice(0, 10);
    assert.throws(
      () =>
        parentService.createCustomTimetable(parent, {
          studentId: student.id,
          title: 'Conflicting Math Block',
          activityType: 'practice',
          timezone: 'Asia/Colombo',
          startDate: '2026-12-11',
          endDate: '2026-12-11',
          timeOfDay: '17:10',
          durationMinutes: 25,
          recurrenceType: 'one_time',
          filterCriteria: { subjectIds: ['subj-math'], questionCount: 2 },
        }),
      (err: unknown) => err instanceof HttpError && err.status === 409
    );
    assert.ok(localFmtStart);

    // Insufficient question filter rejection without silent substitution (400)
    assert.throws(
      () =>
        parentService.createCustomTimetable(parent, {
          studentId: student.id,
          title: 'Impossible Filter Request',
          activityType: 'practice',
          timezone: 'Asia/Colombo',
          startDate: '2026-12-14',
          timeOfDay: '18:00',
          durationMinutes: 20,
          recurrenceType: 'one_time',
          filterCriteria: {
            subjectIds: ['subj-math'],
            learningObjectiveQuery: 'NonexistentQuantumTopic999',
            questionCount: 5,
          },
        }),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );

    // Create valid non-overlapping custom session on 2026-12-09 (before 2026-12-11 appliedSession)
    const custom = parentService.createCustomTimetable(parent, {
      studentId: student.id,
      title: 'Evening Non-Verbal Reasoning',
      activityType: 'topic_revision',
      timezone: 'Asia/Colombo',
      startDate: '2026-12-09',
      timeOfDay: '18:00',
      durationMinutes: 20,
      gracePeriodMinutes: 15,
      recurrenceType: 'one_time',
      filterCriteria: { subjectIds: ['subj-math'], questionCount: 2 },
    });
    const customSession = custom.sessions[0];

    // Guardian locks student self-edit -> student blocked from rescheduling (403)
    const guardianLink = parentService
      .getLinkedStudents(parent)
      .find((l) => l.studentUserId === student.id)!;
    parentService.updateGuardianLinkPermissions(parent, guardianLink.id, {
      studentCanEditSchedule: false,
    });
    assert.throws(
      () =>
        parentService.rescheduleSession(student, customSession.id, {
          newDate: '2026-12-09',
          newTimeOfDay: '18:30',
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Guardian enables student self-edit with 2-hour window & 30-min cap -> student can shift 1h, blocked at 5h
    parentService.updateGuardianLinkPermissions(parent, guardianLink.id, {
      studentCanEditSchedule: true,
      studentDailyMaxMinutes: 30,
      studentRescheduleWindowHours: 2,
    });
    const studentShifted = parentService.rescheduleSession(student, customSession.id, {
      newDate: '2026-12-09',
      newTimeOfDay: '19:00',
      timezone: 'Asia/Colombo',
    });
    assert.ok(studentShifted.scheduledStartUtc);
    assert.throws(
      () =>
        parentService.rescheduleSession(student, customSession.id, {
          newDate: '2026-12-10',
          newTimeOfDay: '10:00',
          timezone: 'Asia/Colombo',
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Guardian reschedules -> old PENDING reminders cancelled & new PENDING reminders created
    const moved = parentService.rescheduleSession(parent, customSession.id, {
      newDate: '2026-12-09',
      newTimeOfDay: '19:30',
      timezone: 'Asia/Colombo',
    });
    const cancelledJobs = wrap.db.db
      .prepare(`SELECT COUNT(*) AS c FROM reminder_jobs WHERE session_id = ? AND status = 'CANCELLED'`)
      .get(moved.id) as { c: number };
    const activeJobs = wrap.db.db
      .prepare(`SELECT COUNT(*) AS c FROM reminder_jobs WHERE session_id = ? AND status = 'PENDING'`)
      .get(moved.id) as { c: number };
    assert.ok(cancelledJobs.c > 0);
    assert.ok(activeJobs.c > 0);

    // Sweep right before start sends due reminders once (idempotent) with HTML + plain text
    const startMs = Date.parse(moved.scheduledStartUtc);
    const sweep1 = parentService.runSchedulerSweep(startMs - 5 * 60_000);
    assert.ok(sweep1.remindersSent > 0);
    const reminderEmails = academicService.getEmailLogs(parent.email).filter((e) => e.category === 'reminder');
    assert.ok(reminderEmails.length >= 1);
    assert.ok(reminderEmails[0].textBody && reminderEmails[0].textBody.includes('MAN 5HE Study Reminder'));
    const sweep2 = parentService.runSchedulerSweep(startMs - 5 * 60_000);
    assert.equal(sweep2.remindersSent, 0); // deduplicated

    // Launching session freezes snapshot questions & resuming does not double-count attemptsUsed
    const launched = parentService.startScheduledSession(student, moved.id);
    assert.equal(launched.launchMode, 'practice_questions');
    assert.equal(launched.quizzes.length, 2);
    assert.equal(launched.session.attemptsUsed, 1);
    const resumed = parentService.startScheduledSession(student, moved.id);
    assert.equal(resumed.session.attemptsUsed, 1);
    const completed = parentService.completeScheduledSession(student, moved.id, 'ATT-DONE-1');
    assert.equal(completed.status, 'COMPLETED');

    // Completed session respecting maxAttempts=1 cannot be started again (400)
    assert.throws(
      () => parentService.startScheduledSession(student, moved.id),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );

    // Timetable-level pause -> resume -> cancel updates child sessions and reminders
    const ttPaused = parentService.updateTimetableStatus(parent, custom.timetable.id, 'pause');
    assert.equal(ttPaused.timetable.status, 'PAUSED');

    // Sweep after grace period marks uncompleted applied session as MISSED
    const appliedEndPlusGrace = Date.parse(appliedSession.scheduledEndUtc) + 30 * 60_000;
    const missedSweep = parentService.runSchedulerSweep(appliedEndPlusGrace);
    assert.ok(missedSweep.missedMarked >= 1);
    const missedCheck = wrap.db.db
      .prepare('SELECT status FROM scheduled_sessions WHERE id = ?')
      .get(appliedSession.id) as { status: string };
    assert.equal(missedCheck.status, 'MISSED');

    // Corrupted/missing snapshot ID rejects cleanly rather than substituting random questions
    wrap.db.db
      .prepare(`UPDATE scheduled_sessions SET status = 'SCHEDULED', attempts_used = 0, question_snapshot_ids_json = ? WHERE id = ?`)
      .run(JSON.stringify(['NONEXISTENT-Q-99999']), appliedSession.id);
    assert.throws(
      () => parentService.startScheduledSession(student, appliedSession.id),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );
  });

  it('persists plain-text email alternatives, preserves exact question version snapshots, and sanitizes report exports against XSS/unsafe URLs', async () => {
    const wrap = createTempSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, assessmentService, parentService } = wrap;

    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;
    const parent = academicService.getUserByIdentifier('parent@man5he.lk')!;

    // Create a question with an unsafe javascript: imageUrl and HTML payload to verify report sanitizer
    const qDraft = assessmentService.createQuestionExtended(mathTeacher, {
      subjectId: 'subj-math',
      topicId: 'top-math-money',
      subtopicId: 'sub-math-bus',
      questionType: 'mcq',
      questionSi: 'Original Version One Question <script>alert(1)</script>',
      questionEn: 'Original Version One Question <script>alert(1)</script>',
      options: ['10', '20', '30', '40'],
      correctIndex: 1,
      imageUrl: 'javascript:alert("xss")',
      defaultMarks: 2,
      approvalStatus: 'PENDING_REVIEW',
      explanation: '20 is the exact answer in Version 1.',
      memoryTrickTitle: 'Double Ten',
      memoryTrickBody: 'Two tens make twenty.',
    });
    const approvedQ = assessmentService.transitionQuestionStatus(admin, qDraft.id, {
      toStatus: 'ACTIVE',
      notes: 'Approved for version check',
    });
    const asm = assessmentService.createAssessment(admin, {
      kind: 'practice_session',
      title: 'Version Preservation Check',
      subjectIds: ['subj-math'],
      status: 'PUBLISHED',
      sections: [
        {
          title: 'Main',
          subjectId: 'subj-math',
          items: [{ questionId: approvedQ.id, marks: 2 }],
        },
      ],
    });

    const started = assessmentService.startOrResumeAssessmentAttempt(student, asm.id);
    const snap = started.questions[0];

    // Admin updates the question in the bank AFTER attempt started (version bumps to v2)
    assessmentService.updateQuestionExtended(admin, approvedQ.id, {
      questionSi: 'Edited Version Two Question Should Not Alter Snapshot',
      questionEn: 'Edited Version Two Question Should Not Alter Snapshot',
    });

    // Submit unanswered -> status is 'unanswered' and preserved text reflects Version 1!
    assessmentService.submitAssessmentAttempt(student, asm.id, {
      attemptId: started.attempt.id,
      idempotencyKey: 'ver-preserve-1',
      answers: [{ snapshotId: snap.snapshotId!, questionId: qDraft.id, submittedOptionIndex: null }],
    });
    await new Promise((r) => setTimeout(r, 50));

    const { reports } = parentService.listStudentReports(parent, student.id);
    const report = reports.find((r) => r.attemptId === started.attempt.id)!;
    assert.ok(report);
    assert.equal(report.items[0].correctnessStatus, 'unanswered');
    assert.ok(report.items[0].questionEn.includes('Original Version One Question'));
    assert.equal(report.items[0].questionEn.includes('Version Two'), false);

    // Verify email_logs contains both HTML and plain-text report body
    const reportEmail = academicService
      .getEmailLogs(parent.email)
      .find((e) => e.category === 'progress_report' && e.subject.includes('Version Preservation Check'));
    assert.ok(reportEmail);
    assert.ok(reportEmail.textBody && reportEmail.textBody.includes('MAN 5HE Final Learning Report'));

    // Verify HTML export escapes script tag and drops unsafe javascript: img URL
    const htmlExport = parentService.exportReportHtml(parent, report.id);
    assert.equal(htmlExport.html.includes('<script>alert(1)</script>'), false);
    assert.ok(htmlExport.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.equal(htmlExport.html.includes('javascript:alert'), false);

    // Unauthenticated / unrelated teacher cannot inspect student report
    const langTeacher = academicService.getUserByIdentifier('teacher.lang@man5he.lk')!;
    assert.throws(
      () => parentService.getReportDetail(langTeacher, report.id),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
  });
});

