import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEmptyChecklist } from '../lib/knowledge.ts';
import { AcademicService, HttpError } from './academicService.ts';
import { generateEducationalKnowledgeDraft, isGeminiConfigured } from './aiKnowledge.ts';
import { Man5heDatabase } from './db.ts';
import { KnowledgeService } from './knowledgeService.ts';

function createTempKnowledgeEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'man5he-know-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const uploadDir = path.join(dir, 'knowledge_uploads');
  const db = new Man5heDatabase(dbPath, uploadDir);
  const academic = new AcademicService(db);
  const knowledge = new KnowledgeService(academic, uploadDir);
  return {
    dir,
    uploadDir,
    db,
    academic,
    knowledge,
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

describe('KnowledgeService RBAC, Publishing Workflow, Secure Resources, Distribution & Analytics', () => {
  const cleanups: (() => void)[] = [];

  after(() => {
    for (const fn of cleanups) fn();
  });

  it('enforces teacher subject-scoped access and immediate permission revocation', () => {
    const env = createTempKnowledgeEnv();
    cleanups.push(env.cleanup);
    const { academic, knowledge } = env;

    const admin = academic.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academic.getUserByIdentifier('teacher.math@man5he.lk')!;

    // Math teacher sees subj-math/subj-logic publications, NOT subj-sinhala (PUB-2026-003)
    const mathList = knowledge.listPublications(mathTeacher);
    assert.ok(mathList.some((p) => p.id === 'PUB-2026-001'));
    assert.ok(!mathList.some((p) => p.id === 'PUB-2026-003'));

    // Math teacher blocked from creating or inspecting unassigned subject
    assert.throws(
      () => knowledge.getPublicationDetail(mathTeacher, 'PUB-2026-003'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
    assert.throws(
      () =>
        knowledge.createPublication(mathTeacher, {
          title: 'Unauthorized Sinhala Guide',
          summary: 'Summary for unassigned subject test.',
          body: 'Detailed educational explanation for test.',
          subjectId: 'subj-sinhala',
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Create draft in assigned subj-math and verify teacher cannot publish directly
    const created = knowledge.createPublication(mathTeacher, {
      title: 'Time Conversion Clock Anchor',
      summary: 'Learn how to convert hours and minutes accurately using clock pizzas.',
      body: 'Every full hour equals 60 minutes. Break multi-hour problems into 60-minute slices.',
      subjectId: 'subj-math',
      topicId: 'top-math-time',
      subtopicId: 'sub-math-hours',
      targetGrades: ['Grade 5'],
      initialStatus: 'PENDING_REVIEW',
    });
    assert.equal(created.publication.status, 'PENDING_REVIEW');

    assert.throws(
      () =>
        knowledge.transitionPublicationStatus(mathTeacher, created.publication.id, {
          toStatus: 'PUBLISHED',
          checklist: createEmptyChecklist(true),
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Revoking subj-math from mathTeacher immediately revokes access to that draft
    academic.setTeacherSubjects(admin, mathTeacher.id, ['subj-logic']);
    const revokedTeacher = academic.getUserById(mathTeacher.id)!;
    assert.throws(
      () => knowledge.getPublicationDetail(revokedTeacher, created.publication.id),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
  });

  it('filters publications strictly by student grade and published status including downloads', () => {
    const env = createTempKnowledgeEnv();
    cleanups.push(env.cleanup);
    const { academic, knowledge } = env;

    const sayuri = academic.getUserByIdentifier('sayuri@man5he.lk')!;
    assert.equal(sayuri.grade, 'Grade 5');

    const studentFeed = knowledge.listPublications(sayuri);
    assert.ok(studentFeed.some((p) => p.id === 'PUB-2026-001'));
    assert.ok(studentFeed.some((p) => p.id === 'PUB-2026-002'));
    assert.ok(studentFeed.some((p) => p.id === 'PUB-2026-003'));
    assert.ok(!studentFeed.some((p) => p.id === 'PUB-2026-004'), 'Draft/pending items must stay hidden');
    assert.ok(!studentFeed.some((p) => p.id === 'PUB-2026-G6'), 'Grade 6 items must stay hidden');

    // Direct access to Grade 6 or PENDING_REVIEW returns 403
    assert.throws(
      () => knowledge.getPublicationDetail(sayuri, 'PUB-2026-G6'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
    assert.throws(
      () => knowledge.getPublicationDetail(sayuri, 'PUB-2026-004'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Seeded downloadable file in PUB-2026-001 is accessible to Grade 5 student
    const detail = knowledge.getPublicationDetail(sayuri, 'PUB-2026-001');
    const downloadable = detail.publication.resources.find((r) => r.downloadUrl);
    assert.ok(downloadable);
    const dl = knowledge.resolveAuthorizedDownload(sayuri, downloadable!.id);
    assert.ok(fs.existsSync(dl.filePath));
  });

  it('enforces checklist verification, scheduled auto-publishing, secure upload, and corrections', () => {
    const env = createTempKnowledgeEnv();
    cleanups.push(env.cleanup);
    const { academic, knowledge, uploadDir } = env;

    const admin = academic.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academic.getUserByIdentifier('teacher.math@man5he.lk')!;

    // Upload a valid PDF worksheet inside uploadDir
    const pdfRes = knowledge.addUploadedResource(mathTeacher, 'PUB-2026-004', {
      title: 'Number Pattern Grid Sheet',
      fileName: '../pattern-sheet.pdf',
      mimeType: 'application/pdf',
      base64Data: Buffer.from('%PDF-1.5\n%test worksheet\n').toString('base64'),
    });
    assert.ok(pdfRes.downloadUrl);
    const savedFiles = fs.readdirSync(uploadDir);
    assert.ok(savedFiles.some((f) => f.includes('pattern-sheet.pdf')));

    // Admin cannot schedule PUB-2026-004 with incomplete checklist
    assert.throws(
      () =>
        knowledge.transitionPublicationStatus(admin, 'PUB-2026-004', {
          toStatus: 'SCHEDULED',
          scheduledFor: '2026-05-01T08:00:00.000Z',
          checklist: createEmptyChecklist(false),
        }),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );

    // Admin verifies checklist and schedules for a future timestamp
    const futureSchedule = new Date(Date.now() + 86_400_000).toISOString();
    const afterSchedule = new Date(Date.now() + 172_800_000).toISOString();
    const scheduledDetail = knowledge.transitionPublicationStatus(admin, 'PUB-2026-004', {
      toStatus: 'SCHEDULED',
      scheduledFor: futureSchedule,
      checklist: createEmptyChecklist(true),
      notes: 'Verified and scheduled for release.',
    });
    assert.equal(scheduledDetail.publication.status, 'SCHEDULED');

    // Scheduler publishes idempotently once scheduled time passes
    const firstRun = knowledge.processScheduledPublications(afterSchedule);
    assert.equal(firstRun, 1);
    const secondRun = knowledge.processScheduledPublications(afterSchedule);
    assert.equal(secondRun, 0);

    const published = knowledge.getPublicationDetail(admin, 'PUB-2026-004');
    assert.equal(published.publication.status, 'PUBLISHED');

    // Issue official correction notice -> increments version & records action
    const corrected = knowledge.issueCorrectionNotice(admin, 'PUB-2026-004', {
      correctionNotice: 'Updated example 2 row increment from +3 to +4.',
      notifyChannels: ['in_app'],
    });
    assert.equal(corrected.publication.currentVersion, 2);
    assert.equal(
      corrected.publication.correctionNotice,
      'Updated example 2 row increment from +3 to +4.'
    );
    assert.ok(corrected.versions.length >= 2);
  });

  it('distributes campaigns idempotently while enforcing guardian consent and opt-in preferences, and separates delivery vs engagement analytics', () => {
    const env = createTempKnowledgeEnv();
    cleanups.push(env.cleanup);
    const { academic, knowledge } = env;

    const admin = academic.getUserByIdentifier('admin@man5he.lk')!;
    const mathTeacher = academic.getUserByIdentifier('teacher.math@man5he.lk')!;
    const sayuri = academic.getUserByIdentifier('sayuri@man5he.lk')!;
    const kasun = academic.getUserByIdentifier('kasun@man5he.lk')!;

    // Kasun: withhold guardian consent & verification; Sayuri: opt out of whatsapp only
    academic.updateStudentGuardianConsent(admin, kasun.id, {
      guardianContactVerified: false,
      guardianConsentGiven: false,
    });
    academic.updateNotificationPreferences(sayuri.id, {
      inApp: true,
      email: true,
      whatsapp: false,
      groupedSummary: false,
    });

    const camp1 = knowledge.dispatchCampaign(admin, 'PUB-2026-001', {
      channels: ['in_app', 'email', 'whatsapp'],
      idempotencyKey: 'test-cmp-001',
    });
    assert.equal(camp1.deduplicated, false);

    // Verify Kasun's email & whatsapp were skipped_unverified
    const kasunEmailDel = camp1.deliveries.find(
      (d) => d.recipientUserId === kasun.id && d.channel === 'email'
    );
    assert.equal(kasunEmailDel?.deliveryStatus, 'skipped_unverified');

    // Verify Sayuri's whatsapp was skipped_preference while email succeeded
    const sayuriWaDel = camp1.deliveries.find(
      (d) => d.recipientUserId === sayuri.id && d.channel === 'whatsapp'
    );
    const sayuriEmailDel = camp1.deliveries.find(
      (d) => d.recipientUserId === sayuri.id && d.channel === 'email'
    );
    assert.equal(sayuriWaDel?.deliveryStatus, 'skipped_preference');
    assert.equal(sayuriEmailDel?.deliveryStatus, 'delivered');

    // Duplicate campaign dispatch returns deduplicated = true without double sending
    const campDup = knowledge.dispatchCampaign(admin, 'PUB-2026-001', {
      channels: ['in_app', 'email', 'whatsapp'],
      idempotencyKey: 'test-cmp-001',
    });
    assert.equal(campDup.deduplicated, true);
    assert.equal(campDup.campaign.id, camp1.campaign.id);

    // Retry skipped_unverified fails until consent is verified, then succeeds
    assert.throws(
      () => knowledge.retryDelivery(admin, kasunEmailDel!.id),
      (err: unknown) => err instanceof HttpError && err.status === 400
    );
    academic.updateStudentGuardianConsent(admin, kasun.id, {
      guardianContactVerified: true,
      guardianConsentGiven: true,
    });
    assert.equal(knowledge.retryDelivery(admin, kasunEmailDel!.id).ok, true);

    // Record student engagement events and verify analytics separate delivery vs engagement and respect teacher scope
    knowledge.recordEngagementEvent(sayuri, 'PUB-2026-001', 'view');
    knowledge.recordEngagementEvent(sayuri, 'PUB-2026-001', 'link_click');
    knowledge.recordEngagementEvent(sayuri, 'PUB-2026-001', 'quiz_complete', null, {
      correct: true,
    });
    const bm = knowledge.recordEngagementEvent(sayuri, 'PUB-2026-001', 'bookmark');
    assert.equal(bm.bookmarked, true);

    const adminAnalytics = knowledge.getKnowledgeAnalytics(admin);
    assert.ok(adminAnalytics.deliveryMetrics.deliveredCount > 0);
    assert.ok(adminAnalytics.engagementMetrics.totalViews >= 1);
    assert.ok(adminAnalytics.engagementMetrics.uniqueViewers >= 1);

    const mathTeacherAnalytics = knowledge.getKnowledgeAnalytics(mathTeacher);
    assert.ok(
      mathTeacherAnalytics.bySubject.every(
        (s) => s.subjectId === 'subj-math' || s.subjectId === 'subj-logic' || s.subjectId === 'subj-spatial'
      )
    );
  });

  it('never fabricates AI drafts when GEMINI_API_KEY is unset or placeholder', async () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'MY_GEMINI_API_KEY';
    try {
      assert.equal(isGeminiConfigured(), false);
      await assert.rejects(
        () =>
          generateEducationalKnowledgeDraft({
            sourceTitle: 'NIE Math Note',
            sourceExcerpt: 'Division and multiplication are inverse facts.',
            targetGrade: 'Grade 5',
            language: 'bilingual',
            subjects: [],
          }),
        (err: unknown) => err instanceof HttpError && err.status === 503
      );
    } finally {
      if (prev === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });
});
