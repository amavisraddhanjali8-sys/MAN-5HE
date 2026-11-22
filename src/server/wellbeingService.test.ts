import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Man5heDatabase } from './db.ts';
import { AcademicService, HttpError } from './academicService.ts';
import { WellbeingService } from './wellbeingService.ts';
import type { StudyActivityEventInput } from '../lib/types.ts';

function createTempSuite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'man5he-enh06-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new Man5heDatabase(dbPath);
  const academicService = new AcademicService(db);
  const wellbeingService = new WellbeingService(academicService);

  return {
    dir,
    db,
    academicService,
    wellbeingService,
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

describe('WellbeingService — Study-Time Intelligence, Rules, Pre-Schedule Validation, Cases, Immutable Contact Notes & Safeguarding', () => {
  const cleanups: (() => void)[] = [];

  after(() => {
    for (const fn of cleanups) fn();
  });

  it('1. Rejects prohibited surveillance fields, deduplicates events, merges overlapping multi-tab intervals, and separates active/idle/background/break time', () => {
    const wrap = createTempSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, wellbeingService } = wrap;
    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;

    // Reject invasive telemetry fields
    assert.throws(
      () =>
        wellbeingService.ingestActivityEvents(student, [
          {
            idempotencyKey: 'bad-keystroke-1',
            sessionKey: 'SES-BAD-1',
            eventType: 'interaction_heartbeat',
            contextMode: 'practice',
            deviceId: 'dev-1',
            tabId: 'tab-1',
            keystrokes: ['a', 'b'],
          } as unknown as StudyActivityEventInput,
        ]),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );

    const t0 = new Date(Date.now() - 45 * 60_000).getTime();
    const events: StudyActivityEventInput[] = [
      // Tab 1 open + active + idle + break + close
      {
        idempotencyKey: 'k-open-1',
        sessionKey: 'SES-MULTI-1',
        eventType: 'session_open',
        occurredAt: new Date(t0).toISOString(),
        contextMode: 'practice',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        subjectId: 'subj-math',
      },
      {
        idempotencyKey: 'k-act-1',
        sessionKey: 'SES-MULTI-1',
        eventType: 'question_viewed',
        occurredAt: new Date(t0 + 60_000).toISOString(),
        contextMode: 'practice',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        subjectId: 'subj-math',
      },
      {
        idempotencyKey: 'k-act-2',
        sessionKey: 'SES-MULTI-1',
        eventType: 'answer_selected',
        occurredAt: new Date(t0 + 180_000).toISOString(),
        contextMode: 'practice',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        subjectId: 'subj-math',
      },
      // Concurrent Tab 2 overlapping same active interval — should NOT double-count!
      {
        idempotencyKey: 'k-tab2-open',
        sessionKey: 'SES-MULTI-1',
        eventType: 'session_open',
        occurredAt: new Date(t0 + 60_000).toISOString(),
        contextMode: 'practice',
        deviceId: 'dev-1',
        tabId: 'tab-2',
        subjectId: 'subj-math',
      },
      {
        idempotencyKey: 'k-tab2-hb',
        sessionKey: 'SES-MULTI-1',
        eventType: 'interaction_heartbeat',
        occurredAt: new Date(t0 + 150_000).toISOString(),
        contextMode: 'practice',
        deviceId: 'dev-1',
        tabId: 'tab-2',
        subjectId: 'subj-math',
      },
      // Backgrounded period
      {
        idempotencyKey: 'k-bg-1',
        sessionKey: 'SES-MULTI-1',
        eventType: 'tab_backgrounded',
        occurredAt: new Date(t0 + 600_000).toISOString(),
        contextMode: 'practice',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        subjectId: 'subj-math',
      },
      {
        idempotencyKey: 'k-bg-res-1',
        sessionKey: 'SES-MULTI-1',
        eventType: 'tab_resumed',
        occurredAt: new Date(t0 + 900_000).toISOString(),
        contextMode: 'practice',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        subjectId: 'subj-math',
      },
      // Break interval
      {
        idempotencyKey: 'k-brk-start',
        sessionKey: 'SES-MULTI-1',
        eventType: 'break_started',
        occurredAt: new Date(t0 + 960_000).toISOString(),
        contextMode: 'practice',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        subjectId: 'subj-math',
      },
      {
        idempotencyKey: 'k-brk-end',
        sessionKey: 'SES-MULTI-1',
        eventType: 'break_ended',
        occurredAt: new Date(t0 + 1260_000).toISOString(),
        contextMode: 'practice',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        subjectId: 'subj-math',
      },
      {
        idempotencyKey: 'k-close-1',
        sessionKey: 'SES-MULTI-1',
        eventType: 'session_closed',
        occurredAt: new Date(t0 + 1500_000).toISOString(),
        contextMode: 'practice',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        subjectId: 'subj-math',
      },
    ];

    const firstIngest = wellbeingService.ingestActivityEvents(student, events);
    assert.equal(firstIngest.acceptedCount, events.length);
    assert.equal(firstIngest.deduplicatedCount, 0);

    // Duplicate batch is idempotent
    const secondIngest = wellbeingService.ingestActivityEvents(student, events);
    assert.equal(secondIngest.acceptedCount, 0);
    assert.equal(secondIngest.deduplicatedCount, events.length);

    const analytics = wellbeingService.getStudentStudyTimeAnalytics(student, student.id, 7);
    const ses = analytics.recentSessions.find((s) => s.sessionKey === 'SES-MULTI-1');
    assert.ok(ses);
    assert.equal(ses.openDurationSeconds, 1500);
    assert.equal(ses.tabCount, 2);
    assert.ok(ses.activeDurationSeconds < ses.openDurationSeconds);
    assert.ok(ses.idleDurationSeconds > 0);
    assert.equal(ses.backgroundDurationSeconds, 300);
    assert.equal(ses.breakTotalSeconds, 300);
    assert.ok(analytics.uncertaintyStatements.length >= 2);
  });

  it('2. Enforces admin approval for platform-wide rules and allows delegated subject-rule publishing by teachers', () => {
    const wrap = createTempSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, wellbeingService } = wrap;
    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;

    // Teacher attempting direct activation of platform-wide rule is blocked (403)
    assert.throws(
      () =>
        wellbeingService.createOrProposeRule(mathTeacher, {
          title: 'Teacher Platform Override',
          dailyWarningMinutes: 60,
          dailyMaxMinutes: 80,
          weeklyWarningMinutes: 300,
          weeklyMaxMinutes: 380,
          continuousSessionWarningMinutes: 30,
          recommendedBreakMinutes: 10,
          breakIntervalMinutes: 30,
          activateImmediately: true,
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Teacher proposes platform-wide guideline -> PENDING_REVIEW
    const proposal = wellbeingService.createOrProposeRule(mathTeacher, {
      ruleSetId: 'WBR-G5-CORE',
      title: 'Grade 5 Core Balanced Study Guidelines',
      dailyWarningMinutes: 70,
      dailyMaxMinutes: 85,
      weeklyWarningMinutes: 340,
      weeklyMaxMinutes: 420,
      continuousSessionWarningMinutes: 35,
      recommendedBreakMinutes: 10,
      breakIntervalMinutes: 35,
      changeNote: 'Recommended slightly softer daily threshold',
    });
    assert.equal(proposal.version.approvalStatus, 'PENDING_REVIEW');

    // Admin approves & activates proposal
    const approved = wellbeingService.approveWellbeingRuleVersion(admin, proposal.version.id);
    assert.equal(approved.approvalStatus, 'ACTIVE');
    assert.equal(approved.approvedByAdminId, admin.id);

    // Delegate subj-math to mathTeacher and verify subject-specific activation succeeds
    wrap.db.db
      .prepare(`UPDATE users SET delegated_publish_subjects_json = ? WHERE id = ?`)
      .run(JSON.stringify(['subj-math']), mathTeacher.id);
    const delegatedTeacher = academicService.getUserById(mathTeacher.id)!;

    const subjectRule = wellbeingService.createOrProposeRule(delegatedTeacher, {
      title: 'Grade 5 Math Word Problem Pacing',
      subjectId: 'subj-math',
      dailyWarningMinutes: 45,
      dailyMaxMinutes: 60,
      weeklyWarningMinutes: 200,
      weeklyMaxMinutes: 260,
      continuousSessionWarningMinutes: 25,
      recommendedBreakMinutes: 10,
      breakIntervalMinutes: 25,
      activateImmediately: true,
    });
    assert.equal(subjectRule.version.approvalStatus, 'ACTIVE');
    assert.equal(subjectRule.version.subjectId, 'subj-math');
  });

  it('3. Performs pre-schedule wellbeing validation, dispatches supportive non-accusatory guidance, and deduplicates staff review cases', () => {
    const wrap = createTempSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, wellbeingService } = wrap;
    const parent = academicService.getUserByIdentifier('parent@man5he.lk')!;
    const student = academicService.getUserByIdentifier('sayuri@man5he.lk')!;

    const today = new Date().toISOString().slice(0, 10);
    const validation = wellbeingService.validatePreSchedule(parent, {
      studentId: student.id,
      subjectIds: ['subj-math'],
      proposedSlots: [
        {
          localDate: today,
          startUtc: `${today}T10:00:00Z`,
          endUtc: `${today}T11:15:00Z`,
          durationMinutes: 75,
          title: 'Intense Morning Block',
        },
        {
          localDate: today,
          startUtc: `${today}T13:00:00Z`,
          endUtc: `${today}T14:00:00Z`,
          durationMinutes: 60,
          title: 'Intense Afternoon Block',
        },
      ],
    });

    assert.equal(validation.exceedsDailyMax, true);
    assert.equal(validation.exceedsContinuousThreshold, true);
    assert.equal(validation.requiresStaffReview, true);
    assert.ok(validation.balancedSuggestions.length >= 1);
    assert.ok(!/abuse|abusive|neurological|disorder|diagnos/i.test(validation.supportiveMessage));

    const firstRecord = wellbeingService.recordPreScheduleValidationDecision(parent, {
      studentId: student.id,
      validation,
      decision: 'proceeded_with_acknowledgement',
      decisionNotes: 'Parent noted break intervals planned after 30 min',
      subjectIds: ['subj-math'],
    });
    assert.ok(firstRecord.warning);
    assert.ok(firstRecord.openedCase);

    // Check email HTML & plain text + WhatsApp templates logged
    const emailLogs = academicService.getEmailLogs(parent.email);
    const waLogs = academicService.getWhatsAppLogs(parent.whatsappNumber);
    assert.ok(emailLogs.some((e) => e.htmlBody.includes('<') && (e.textBody || '').length > 20));
    assert.ok(waLogs.length >= 1);

    // Second trigger on same ongoing concern attaches evidence to existing case instead of creating duplicate
    const secondRecord = wellbeingService.recordPreScheduleValidationDecision(parent, {
      studentId: student.id,
      validation,
      decision: 'pending',
      subjectIds: ['subj-math'],
    });
    assert.equal(secondRecord.openedCase!.id, firstRecord.openedCase!.id);
  });

  it('4. Enforces subject scoping on wellbeing cases, dismissal reason validation, immutable contact notes, and versioned amendments', () => {
    const wrap = createTempSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, wellbeingService } = wrap;
    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;
    const langTeacher = academicService.getUserByIdentifier('teacher.lang@man5he.lk')!;

    // Out-of-scope teacher blocked from Math wellbeing case WBC-SEED-001
    assert.throws(
      () => wellbeingService.getWellbeingCaseDetail(langTeacher, 'WBC-SEED-001'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    const detail = wellbeingService.getWellbeingCaseDetail(mathTeacher, 'WBC-SEED-001');
    assert.equal(detail.caseRecord.id, 'WBC-SEED-001');

    // Dismissing without reason fails (400)
    assert.throws(
      () =>
        wellbeingService.transitionWellbeingCase(mathTeacher, 'WBC-SEED-001', {
          nextStatus: 'DISMISSED',
        }),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );

    // Admin assigns case to mathTeacher
    const assigned = wellbeingService.assignWellbeingCase(
      admin,
      'WBC-SEED-001',
      mathTeacher.id,
      'Subject teacher lead review'
    );
    assert.equal(assigned.assignedToUserId, mathTeacher.id);

    // Create draft parent contact record, finalize it, verify 409 on direct edit, then amend cleanly
    const draftNote = wellbeingService.createParentContactRecord(mathTeacher, 'WBC-SEED-001', {
      contactMethod: 'phone',
      contactOutcome: 'connected',
      factualObservations: 'Scheduled practice totaled 120 minutes across Saturday.',
      directQuotations: 'Parent stated: "Kasun rested for lunch between worksheets."',
      staffOpinions: 'Parent welcomed splitting sessions into 30-minute blocks.',
      guidanceProvided: 'Recommended 10-minute breaks between worksheets.',
      finalizeImmediately: false,
    });
    assert.equal(draftNote.isFinalized, false);

    const finalized = wellbeingService.finalizeParentContactRecord(mathTeacher, draftNote.id);
    assert.equal(finalized.isFinalized, true);

    assert.throws(
      () =>
        wellbeingService.updateDraftParentContactRecord(mathTeacher, finalized.id, {
          factualObservations: 'Silent rewrite attempt',
        }),
      (err: unknown) => err instanceof HttpError && err.status === 409
    );

    const amended = wellbeingService.amendParentContactRecord(mathTeacher, finalized.id, {
      amendmentReason: 'Corrected exact break duration noted by parent',
      factualObservations: 'Scheduled practice totaled 120 minutes with a verified 45-minute lunch break.',
      guidanceProvided: 'Recommended 10-minute breaks between 30-minute worksheets.',
    });
    assert.equal(amended.noteGroupId, finalized.noteGroupId);
    assert.equal(amended.versionNumber, 2);
    assert.equal(amended.supersedesNoteId, finalized.id);
    assert.equal(amended.isFinalized, true);
  });

  it('5. Enforces strict Safeguarding RBAC (403 for teachers), human approval gate, and Audit PDF export + access logs', () => {
    const wrap = createTempSuite();
    cleanups.push(wrap.cleanup);
    const { academicService, wellbeingService } = wrap;
    const admin = academicService.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academicService.getUserByIdentifier('teacher.math@man5he.lk')!;

    // Teacher blocked from safeguarding reviews & draft referral generation
    assert.throws(
      () => wellbeingService.listSafeguardingReviews(mathTeacher),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
    assert.throws(
      () =>
        wellbeingService.initiateOrUpdateSafeguardingReview(mathTeacher, 'WBC-SEED-001', {
          concernsSummary: 'Unauthorized attempt',
          uncertaintiesAndLimitations: 'N/A',
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
    assert.throws(
      () =>
        wellbeingService.generateAuditDocument(mathTeacher, {
          documentType: 'safeguarding_referral_draft',
          studentId: 'usr-student-2',
          caseId: 'WBC-SEED-001',
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Admin cannot bypass human approval gate directly inside initiateOrUpdateSafeguardingReview
    assert.throws(
      () =>
        wellbeingService.initiateOrUpdateSafeguardingReview(admin, 'WBC-SEED-001', {
          concernsSummary: 'Attempting bypass',
          uncertaintiesAndLimitations: 'Limited data',
          decision: 'APPROVED_FOR_REFERRAL',
        }),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );

    // Admin initiates review properly with uncertainties
    const review = wellbeingService.initiateOrUpdateSafeguardingReview(admin, 'WBC-SEED-001', {
      concernsSummary: 'Repeated late-night multi-hour study warnings across 5 consecutive days.',
      uncertaintiesAndLimitations:
        'Platform logs capture screen activity only and must be reviewed alongside family contact.',
      decision: 'DRAFT_REFERRAL_PREPARED',
      referralRecommended: true,
      referralDraftText: 'Factual chronology prepared for designated safeguarding review.',
    });
    assert.equal(review.decision, 'DRAFT_REFERRAL_PREPARED');
    assert.equal(review.approvedByUserId, null);

    // Explicit human approval updates review & case status
    const approved = wellbeingService.approveSafeguardingReview(admin, review.id, {
      decision: 'APPROVED_FOR_REFERRAL',
      externalAuthorityRef: 'CPA-REF-2026-009',
    });
    assert.equal(approved.decision, 'APPROVED_FOR_REFERRAL');
    assert.equal(approved.approvedByUserId, admin.id);

    const caseAfter = wellbeingService.getWellbeingCaseDetail(admin, 'WBC-SEED-001');
    assert.equal(caseAfter.caseRecord.status, 'REFERRED_SAFEGUARDING');
    assert.equal(caseAfter.caseRecord.isSafeguardingRestricted, true);

    // Teachers can no longer see restricted safeguarding cases
    assert.throws(
      () => wellbeingService.getWellbeingCaseDetail(mathTeacher, 'WBC-SEED-001'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Generate Audit Document + export PDF + verify access logs
    const doc = wellbeingService.generateAuditDocument(admin, {
      documentType: 'safeguarding_referral_draft',
      studentId: 'usr-student-2',
      caseId: 'WBC-SEED-001',
      safeguardingReviewId: review.id,
    });
    assert.ok(doc.limitationsAndUncertainties.length >= 2);
    assert.ok(doc.dataSources.length >= 1);

    const exported = wellbeingService.exportAuditDocumentPdf(admin, doc.id);
    assert.ok(exported.filename.endsWith('.pdf'));
    assert.ok(exported.pdf.subarray(0, 8).toString('utf8').startsWith('%PDF-1.4'));

    const logs = wellbeingService.listAuditDocumentAccessLogs(admin, doc.id);
    assert.ok(logs.some((l) => l.accessAction === 'GENERATE'));
    assert.ok(logs.some((l) => l.accessAction === 'EXPORT_PDF'));
  });
});
