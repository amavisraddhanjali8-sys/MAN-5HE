import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyChecklist,
  detectDuplicateKnowledgeTopics,
  isChecklistComplete,
  isStudentEligibleForPublication,
  validateExternalResourceUrl,
  validatePublicationTransition,
  validateUploadPayload,
} from './knowledge.ts';

describe('Knowledge Security, Grade Filtering, Workflow & Duplicate Detection', () => {
  it('validates external URLs and blocks XSS schemes and private/loopback SSRF targets', () => {
    assert.equal(validateExternalResourceUrl('https://www.nie.lk/grade5/syllabus').valid, true);
    assert.equal(validateExternalResourceUrl('http://archaeology.gov.lk/sigiriya').valid, true);

    assert.equal(validateExternalResourceUrl('javascript:alert(1)').valid, false);
    assert.equal(validateExternalResourceUrl('data:text/html,<script>alert(1)</script>').valid, false);
    assert.equal(validateExternalResourceUrl('file:///etc/passwd').valid, false);
    assert.equal(validateExternalResourceUrl('http://localhost:3000/api/admin').valid, false);
    assert.equal(validateExternalResourceUrl('http://127.0.0.1:8080/secret').valid, false);
    assert.equal(validateExternalResourceUrl('http://169.254.169.254/latest/meta-data').valid, false);
    assert.equal(validateExternalResourceUrl('http://192.168.1.10/router').valid, false);
    assert.equal(validateExternalResourceUrl('http://10.0.0.5/internal').valid, false);
  });

  it('validates uploaded resource files by extension, MIME, size, and magic bytes', () => {
    // Valid PNG magic bytes
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    const validPng = validateUploadPayload({
      fileName: '../../diagram.png',
      mimeType: 'image/png',
      base64Data: pngBytes.toString('base64'),
    });
    assert.equal(validPng.valid, true);
    assert.equal(validPng.safeFileName, 'diagram.png');
    assert.equal(validPng.resourceType, 'image');

    // Valid PDF header
    const validPdf = validateUploadPayload({
      fileName: 'worksheet.pdf',
      mimeType: 'application/pdf',
      base64Data: Buffer.from('%PDF-1.7\n1 0 obj\n').toString('base64'),
    });
    assert.equal(validPdf.valid, true);
    assert.equal(validPdf.resourceType, 'pdf');

    // Reject disallowed extension (.html / .svg / .exe)
    assert.equal(
      validateUploadPayload({
        fileName: 'evil.svg',
        mimeType: 'image/svg+xml',
        base64Data: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),
      }).valid,
      false
    );

    // Reject MZ executable masquerading as PNG
    assert.equal(
      validateUploadPayload({
        fileName: 'fake.png',
        mimeType: 'image/png',
        base64Data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]).toString('base64'),
      }).valid,
      false
    );

    // Reject <script> embedded in txt
    assert.equal(
      validateUploadPayload({
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        base64Data: Buffer.from('<script>alert(1)</script>').toString('base64'),
      }).valid,
      false
    );

    // Reject oversized (> 5 MB)
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 64, 0x41);
    assert.equal(
      validateUploadPayload({
        fileName: 'big.txt',
        mimeType: 'text/plain',
        base64Data: oversized.toString('base64'),
      }).valid,
      false
    );
  });

  it('enforces Grade 5 eligibility and blocks wrong-grade or non-published publications', () => {
    assert.equal(
      isStudentEligibleForPublication(
        { grade: 'Grade 5', active: true },
        { status: 'PUBLISHED', targetGrades: ['Grade 5'] }
      ),
      true
    );
    assert.equal(
      isStudentEligibleForPublication(
        { grade: 'Grade 5', active: true },
        { status: 'PUBLISHED', targetGrades: ['All'] }
      ),
      true
    );
    assert.equal(
      isStudentEligibleForPublication(
        { grade: 'Grade 5', active: true },
        { status: 'PUBLISHED', targetGrades: ['Grade 6'] }
      ),
      false
    );
    assert.equal(
      isStudentEligibleForPublication(
        { grade: 'Grade 5', active: true },
        { status: 'PENDING_REVIEW', targetGrades: ['Grade 5'] }
      ),
      false
    );
    assert.equal(
      isStudentEligibleForPublication(
        { grade: 'Grade 5', active: false },
        { status: 'PUBLISHED', targetGrades: ['Grade 5'] }
      ),
      false
    );
  });

  it('enforces checklist completion and role-based editorial state transitions', () => {
    const incomplete = createEmptyChecklist(false);
    const complete = createEmptyChecklist(true);
    assert.equal(isChecklistComplete(incomplete), false);
    assert.equal(isChecklistComplete(complete), true);

    // Teacher can submit for review but cannot approve/publish without delegation
    assert.equal(
      validatePublicationTransition({
        actorRole: 'teacher',
        fromStatus: 'DRAFT',
        toStatus: 'PENDING_REVIEW',
        checklist: incomplete,
      }).allowed,
      true
    );
    assert.equal(
      validatePublicationTransition({
        actorRole: 'teacher',
        fromStatus: 'PENDING_REVIEW',
        toStatus: 'PUBLISHED',
        checklist: complete,
      }).allowed,
      false
    );

    // Admin cannot publish without complete 8-point checklist
    assert.equal(
      validatePublicationTransition({
        actorRole: 'admin',
        fromStatus: 'PENDING_REVIEW',
        toStatus: 'PUBLISHED',
        checklist: incomplete,
      }).allowed,
      false
    );

    // Admin can approve/publish once all 8 checks pass
    assert.equal(
      validatePublicationTransition({
        actorRole: 'admin',
        fromStatus: 'PENDING_REVIEW',
        toStatus: 'PUBLISHED',
        checklist: complete,
      }).allowed,
      true
    );

    // Scheduled status requires a valid timestamp
    assert.equal(
      validatePublicationTransition({
        actorRole: 'admin',
        fromStatus: 'APPROVED',
        toStatus: 'SCHEDULED',
        checklist: complete,
        scheduledFor: '',
      }).allowed,
      false
    );
    assert.equal(
      validatePublicationTransition({
        actorRole: 'admin',
        fromStatus: 'APPROVED',
        toStatus: 'SCHEDULED',
        checklist: complete,
        scheduledFor: '2026-12-01T08:00:00.000Z',
      }).allowed,
      true
    );
  });

  it('detects duplicate knowledge topics by URL and title token similarity', () => {
    const existing = [
      {
        id: 'PUB-1',
        title: 'Sigiriya Ancient Water Engineering and Rainwater Science',
        sourceUrl: 'https://www.archaeology.gov.lk/sigiriya/',
        status: 'PUBLISHED' as const,
      },
      {
        id: 'PUB-2',
        title: 'Old Withdrawn Draft',
        sourceUrl: 'https://example.org/withdrawn',
        status: 'WITHDRAWN' as const,
      },
    ];

    const byUrl = detectDuplicateKnowledgeTopics(
      'Unrelated Title',
      'https://www.archaeology.gov.lk/sigiriya',
      existing
    );
    assert.equal(byUrl.length, 1);
    assert.equal(byUrl[0].score, 1);

    const byTitle = detectDuplicateKnowledgeTopics(
      'Ancient Water Engineering at Sigiriya Garden',
      null,
      existing
    );
    assert.equal(byTitle.length, 1);
    assert.equal(byTitle[0].id, 'PUB-1');

    // Withdrawn items are ignored
    const withdrawnCheck = detectDuplicateKnowledgeTopics(
      'Old Withdrawn Draft',
      'https://example.org/withdrawn',
      existing
    );
    assert.equal(withdrawnCheck.length, 0);
  });
});
