import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canAccessSubject, type AuthorizationContext } from '../lib/authorization.ts';
import {
  DEFAULT_GRADE,
  createEmptyChecklist,
  detectDuplicateKnowledgeTopics,
  isStudentEligibleForPublication,
  validateExternalResourceUrl,
  validatePublicationTransition,
  validateUploadPayload,
} from '../lib/knowledge.ts';
import {
  buildKnowledgeEmailHtml,
  buildKnowledgeWhatsAppMessage,
} from '../lib/notifications.ts';
import type {
  KnowledgeAnalyticsSummary,
  KnowledgeDiscoveryCandidate,
  KnowledgePublication,
  KnowledgeType,
  PublicationCampaign,
  PublicationDelivery,
  PublicationEngagementType,
  PublicationLanguage,
  PublicationResource,
  PublicationReviewAction,
  PublicationStatus,
  PublicationVersion,
  UserAccount,
  UserRole,
  ValidationChecklist,
} from '../lib/types.ts';
import { AcademicService, HttpError } from './academicService.ts';
import { resolveKnowledgeUploadDir } from './db.ts';

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class KnowledgeService {
  private readonly academic: AcademicService;
  private readonly uploadDir: string;

  constructor(academic: AcademicService, customUploadDir?: string) {
    this.academic = academic;
    this.uploadDir = path.resolve(customUploadDir || resolveKnowledgeUploadDir());
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private get db() {
    return this.academic.dbWrapper.db;
  }

  private rowToResource(r: Record<string, unknown>): PublicationResource {
    const id = String(r.id);
    const hasFile = Boolean(r.storage_path);
    return {
      id,
      publicationId: String(r.publication_id),
      resourceType: String(r.resource_type) as PublicationResource['resourceType'],
      title: String(r.title),
      mimeType: String(r.mime_type || 'application/octet-stream'),
      sizeBytes: Number(r.size_bytes ?? 0),
      downloadUrl: hasFile ? `/api/knowledge/resources/${encodeURIComponent(id)}/download` : null,
      externalUrl: r.external_url ? String(r.external_url) : null,
      linkedQuizIds: parseJsonSafe<string[]>(r.linked_quiz_ids_json, []),
      isCover: Number(r.is_cover ?? 0) === 1,
      sortOrder: Number(r.sort_order ?? 0),
      uploadedBy: String(r.uploaded_by),
      createdAt: String(r.created_at),
    };
  }

  private loadResourcesForPublication(pubId: string): PublicationResource[] {
    const rows = this.db
      .prepare('SELECT * FROM publication_resources WHERE publication_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(pubId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToResource(r));
  }

  private rowToPublication(
    r: Record<string, unknown>,
    resources?: PublicationResource[],
    bookmarkedIds?: Set<string>
  ): KnowledgePublication {
    const id = String(r.id);
    const resList = resources ?? this.loadResourcesForPublication(id);
    const coverResource = resList.find((res) => res.isCover && res.downloadUrl);
    return {
      id,
      title: String(r.title),
      summary: String(r.summary),
      body: String(r.body),
      knowledgeType: String(r.knowledge_type) as KnowledgeType,
      subjectId: String(r.subject_id),
      topicId: String(r.topic_id),
      subtopicId: String(r.subtopic_id),
      targetGrades: parseJsonSafe<string[]>(r.target_grades_json, [DEFAULT_GRADE]),
      language: String(r.language || 'bilingual') as PublicationLanguage,
      audienceGroup: String(r.audience_group || 'all_students'),
      learningNeeds: String(r.learning_needs || ''),
      coverImageUrl: coverResource?.downloadUrl || (r.cover_image_url ? String(r.cover_image_url) : null),
      sourceTitle: String(r.source_title || ''),
      sourceUrl: r.source_url ? String(r.source_url) : null,
      sourcePublishedAt: r.source_published_at ? String(r.source_published_at) : null,
      verificationDate: r.verification_date ? String(r.verification_date) : null,
      authorId: String(r.author_id),
      authorName: String(r.author_name),
      authorRole: String(r.author_role) as UserRole,
      reviewerId: r.reviewer_id ? String(r.reviewer_id) : null,
      reviewerName: r.reviewer_name ? String(r.reviewer_name) : null,
      status: String(r.status) as PublicationStatus,
      scheduledFor: r.scheduled_for ? String(r.scheduled_for) : null,
      publishedAt: r.published_at ? String(r.published_at) : null,
      correctionNotice: r.correction_notice ? String(r.correction_notice) : null,
      aiAssisted: Number(r.ai_assisted ?? 0) === 1,
      aiDraftWarnings: parseJsonSafe<string[]>(r.ai_draft_warnings_json, []),
      checklist: parseJsonSafe<ValidationChecklist>(r.checklist_json, createEmptyChecklist(false)),
      currentVersion: Number(r.current_version ?? 1),
      resources: resList,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      bookmarked: bookmarkedIds ? bookmarkedIds.has(id) : undefined,
    };
  }

  private assertTeacherOrAdminSubjectAccess(
    user: UserAccount,
    ctx: AuthorizationContext,
    subjectId: string
  ): void {
    if (user.role === 'admin') return;
    if (user.role !== 'teacher') {
      throw new HttpError(403, 'Teacher or Administrator access required.');
    }
    if (!canAccessSubject(ctx, subjectId)) {
      throw new HttpError(
        403,
        'Access denied: You are not assigned to this subject category.'
      );
    }
  }

  private isTeacherAuthorizedForPublication(
    user: UserAccount,
    ctx: AuthorizationContext,
    pub: Pick<KnowledgePublication, 'subjectId' | 'authorId'>
  ): boolean {
    if (user.role === 'admin') return true;
    if (user.role !== 'teacher') return false;
    return canAccessSubject(ctx, pub.subjectId);
  }

  public listPublications(
    user: UserAccount,
    filters: {
      status?: string;
      subjectId?: string;
      topicId?: string;
      grade?: string;
      search?: string;
      bookmarkedOnly?: boolean;
    } = {}
  ): KnowledgePublication[] {
    this.processScheduledPublications();

    const ctx = this.academic.buildAuthContext(user);
    if (
      user.role === 'teacher' &&
      filters.subjectId &&
      filters.subjectId !== 'All' &&
      !canAccessSubject(ctx, filters.subjectId)
    ) {
      throw new HttpError(403, 'Access denied: Subject category is outside your assigned subjects.');
    }

    const rows = this.db
      .prepare('SELECT * FROM knowledge_publications ORDER BY COALESCE(published_at, updated_at, created_at) DESC')
      .all() as Record<string, unknown>[];

    const savedRows =
      user.role === 'student'
        ? (this.db
            .prepare('SELECT publication_id FROM student_saved_publications WHERE student_id = ?')
            .all(user.id) as { publication_id: string }[])
        : [];
    const bookmarkedSet = new Set(savedRows.map((s) => s.publication_id));

    const allResourcesRows = this.db
      .prepare('SELECT * FROM publication_resources ORDER BY sort_order ASC, created_at ASC')
      .all() as Record<string, unknown>[];
    const resourcesByPub = new Map<string, PublicationResource[]>();
    for (const rr of allResourcesRows) {
      const res = this.rowToResource(rr);
      const list = resourcesByPub.get(res.publicationId) || [];
      list.push(res);
      resourcesByPub.set(res.publicationId, list);
    }

    let list = rows.map((r) =>
      this.rowToPublication(r, resourcesByPub.get(String(r.id)) || [], bookmarkedSet)
    );

    if (user.role === 'student') {
      list = list.filter((p) => isStudentEligibleForPublication(user, p));
    } else if (user.role === 'teacher') {
      list = list.filter((p) => this.isTeacherAuthorizedForPublication(user, ctx, p));
    }

    if (filters.status && filters.status !== 'ALL') {
      list = list.filter((p) => p.status === filters.status);
    }
    if (filters.subjectId && filters.subjectId !== 'All') {
      list = list.filter((p) => p.subjectId === filters.subjectId);
    }
    if (filters.topicId && filters.topicId !== 'All') {
      list = list.filter((p) => p.topicId === filters.topicId);
    }
    if (filters.grade && filters.grade !== 'All') {
      list = list.filter(
        (p) => p.targetGrades.includes('All') || p.targetGrades.includes(filters.grade!)
      );
    }
    if (filters.bookmarkedOnly && user.role === 'student') {
      list = list.filter((p) => Boolean(p.bookmarked));
    }
    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.id.toLowerCase().includes(q) ||
          p.title.toLowerCase().includes(q) ||
          p.summary.toLowerCase().includes(q) ||
          p.body.toLowerCase().includes(q)
      );
    }

    return list;
  }

  public getPublicationDetail(user: UserAccount, publicationId: string) {
    this.processScheduledPublications();
    const row = this.db
      .prepare('SELECT * FROM knowledge_publications WHERE id = ?')
      .get(publicationId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new HttpError(404, 'Knowledge publication not found.');
    }

    const saved =
      user.role === 'student'
        ? Boolean(
            this.db
              .prepare(
                'SELECT 1 FROM student_saved_publications WHERE student_id = ? AND publication_id = ?'
              )
              .get(user.id, publicationId)
          )
        : false;
    const pub = this.rowToPublication(
      row,
      undefined,
      saved ? new Set([publicationId]) : new Set()
    );

    const ctx = this.academic.buildAuthContext(user);
    if (user.role === 'student') {
      if (!isStudentEligibleForPublication(user, pub)) {
        throw new HttpError(403, 'This publication is not available for your grade or is not published.');
      }
    } else if (user.role === 'teacher') {
      if (!this.isTeacherAuthorizedForPublication(user, ctx, pub)) {
        throw new HttpError(403, 'Access denied: Publication belongs to an unassigned subject.');
      }
    }

    const versions = (
      this.db
        .prepare('SELECT * FROM publication_versions WHERE publication_id = ? ORDER BY version_number DESC')
        .all(publicationId) as Record<string, unknown>[]
    ).map(
      (v): PublicationVersion => ({
        id: String(v.id),
        publicationId: String(v.publication_id),
        versionNumber: Number(v.version_number),
        title: String(v.title),
        summary: String(v.summary),
        body: String(v.body),
        changeNote: String(v.change_note),
        changedBy: String(v.changed_by),
        changedByName: String(v.changed_by_name),
        createdAt: String(v.created_at),
      })
    );

    const reviewActions = (
      this.db
        .prepare('SELECT * FROM publication_review_actions WHERE publication_id = ? ORDER BY created_at DESC')
        .all(publicationId) as Record<string, unknown>[]
    ).map(
      (a): PublicationReviewAction => ({
        id: String(a.id),
        publicationId: String(a.publication_id),
        actorId: String(a.actor_id),
        actorName: String(a.actor_name),
        actorRole: String(a.actor_role) as UserRole | 'system',
        actionType: String(a.action_type),
        fromStatus: a.from_status ? (String(a.from_status) as PublicationStatus) : null,
        toStatus: String(a.to_status) as PublicationStatus,
        notes: String(a.notes || ''),
        createdAt: String(a.created_at),
      })
    );

    const campaigns =
      user.role === 'student'
        ? []
        : this.listCampaignsForPublication(publicationId);

    const linkedQuizIds = pub.resources
      .filter((r) => r.resourceType === 'linked_quiz')
      .flatMap((r) => r.linkedQuizIds);
    const linkedQuizzes = linkedQuizIds
      .map((qid) => this.academic.resolveQuizById(qid))
      .filter(Boolean);

    return {
      publication: pub,
      versions,
      reviewActions,
      campaigns,
      linkedQuizzes,
    };
  }

  public checkDuplicates(params: { title: string; sourceUrl?: string | null; excludeId?: string }) {
    const rows = this.db
      .prepare('SELECT id, title, source_url, status FROM knowledge_publications')
      .all() as Record<string, unknown>[];
    const existing = rows
      .filter((r) => String(r.id) !== params.excludeId)
      .map((r) => ({
        id: String(r.id),
        title: String(r.title),
        sourceUrl: r.source_url ? String(r.source_url) : null,
        status: String(r.status) as PublicationStatus,
      }));
    return detectDuplicateKnowledgeTopics(params.title, params.sourceUrl, existing);
  }

  public createPublication(
    actor: UserAccount,
    payload: {
      title: string;
      summary: string;
      body: string;
      knowledgeType?: KnowledgeType;
      subjectId: string;
      topicId?: string;
      subtopicId?: string;
      targetGrades?: string[];
      language?: PublicationLanguage;
      audienceGroup?: string;
      learningNeeds?: string;
      sourceTitle?: string;
      sourceUrl?: string | null;
      sourcePublishedAt?: string | null;
      checklist?: Partial<ValidationChecklist>;
      aiAssisted?: boolean;
      aiDraftWarnings?: string[];
      initialStatus?: 'DRAFT' | 'PENDING_REVIEW';
    }
  ) {
    if (actor.role === 'student') {
      throw new HttpError(403, 'Only teachers and administrators can author publications.');
    }

    const ctx = this.academic.buildAuthContext(actor);
    const subjectId = String(payload.subjectId || '').trim();
    if (!subjectId) {
      throw new HttpError(400, 'Subject category is required.');
    }
    this.assertTeacherOrAdminSubjectAccess(actor, ctx, subjectId);

    const title = String(payload.title || '').trim();
    const summary = String(payload.summary || '').trim();
    const body = String(payload.body || '').trim();
    if (title.length < 4 || summary.length < 10 || body.length < 15) {
      throw new HttpError(
        400,
        'Provide a clear title (min 4 chars), summary (min 10 chars), and educational explanation (min 15 chars).'
      );
    }

    let safeSourceUrl: string | null = null;
    if (payload.sourceUrl && String(payload.sourceUrl).trim()) {
      const check = validateExternalResourceUrl(String(payload.sourceUrl));
      if (!check.valid) {
        throw new HttpError(400, `Source URL rejected: ${check.reason}`);
      }
      safeSourceUrl = check.normalizedUrl!;
    }

    const subjectRow = this.db.prepare('SELECT id FROM subjects WHERE id = ?').get(subjectId);
    if (!subjectRow) {
      throw new HttpError(400, `Invalid subject ID: ${subjectId}`);
    }

    const topicRow =
      payload.topicId
        ? (this.db.prepare('SELECT id FROM topics WHERE id = ?').get(payload.topicId) as { id: string } | undefined)
        : (this.db.prepare('SELECT id FROM topics WHERE subject_id = ? ORDER BY sort_order ASC LIMIT 1').get(subjectId) as { id: string } | undefined);
    const topicId = topicRow?.id || `${subjectId}-general`;

    const subtopicRow =
      payload.subtopicId
        ? (this.db.prepare('SELECT id FROM subtopics WHERE id = ?').get(payload.subtopicId) as { id: string } | undefined)
        : (this.db.prepare('SELECT id FROM subtopics WHERE topic_id = ? ORDER BY sort_order ASC LIMIT 1').get(topicId) as { id: string } | undefined);
    const subtopicId = subtopicRow?.id || `${topicId}-sub`;

    const duplicates = this.checkDuplicates({ title, sourceUrl: safeSourceUrl });
    const targetGrades =
      Array.isArray(payload.targetGrades) && payload.targetGrades.length > 0
        ? payload.targetGrades.map(String)
        : [DEFAULT_GRADE];
    const checklist: ValidationChecklist = {
      ...createEmptyChecklist(false),
      ...(payload.checklist || {}),
    };
    const status: PublicationStatus =
      payload.initialStatus === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'DRAFT';

    const countRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM knowledge_publications')
      .get() as { cnt: number };
    const id = `PUB-2026-${String(countRow.cnt + 1).padStart(3, '0')}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;
    const now = new Date().toISOString();

    this.academic.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO knowledge_publications (
            id, title, summary, body, knowledge_type, subject_id, topic_id, subtopic_id,
            target_grades_json, language, audience_group, learning_needs, cover_image_url,
            source_title, source_url, source_published_at, verification_date,
            author_id, author_name, author_role, reviewer_id, reviewer_name,
            status, scheduled_for, published_at, correction_notice, ai_assisted,
            ai_draft_warnings_json, checklist_json, current_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          id,
          title,
          summary,
          body,
          payload.knowledgeType || 'concept_guide',
          subjectId,
          topicId,
          subtopicId,
          JSON.stringify(targetGrades),
          payload.language || 'bilingual',
          String(payload.audienceGroup || 'all_students'),
          String(payload.learningNeeds || ''),
          String(payload.sourceTitle || ''),
          safeSourceUrl,
          payload.sourcePublishedAt || null,
          actor.id,
          actor.name,
          actor.role,
          status,
          payload.aiAssisted ? 1 : 0,
          JSON.stringify(payload.aiDraftWarnings || []),
          JSON.stringify(checklist),
          now,
          now
        );

      this.db
        .prepare(
          `INSERT INTO publication_versions (
            id, publication_id, version_number, title, summary, body, change_note, changed_by, changed_by_name, created_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `PV-${id}-v1`,
          id,
          title,
          summary,
          body,
          status === 'PENDING_REVIEW' ? 'Created and submitted for review' : 'Initial draft created',
          actor.id,
          actor.name,
          now
        );

      this.db
        .prepare(
          `INSERT INTO publication_review_actions (
            id, publication_id, actor_id, actor_name, actor_role, action_type, from_status, to_status, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
        )
        .run(
          `PRA-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          id,
          actor.id,
          actor.name,
          actor.role,
          status === 'PENDING_REVIEW' ? 'SUBMITTED_FOR_REVIEW' : 'DRAFT_CREATED',
          status,
          payload.aiAssisted ? 'AI-assisted draft queued for human verification.' : 'Manual draft created.',
          now
        );

      this.academic.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'KNOWLEDGE_PUBLICATION_CREATED',
        targetType: 'knowledge_publication',
        targetId: id,
        details: { subjectId, targetGrades, status, duplicateMatches: duplicates.length },
      });
    });

    return {
      ...this.getPublicationDetail(actor, id),
      duplicateWarnings: duplicates,
    };
  }

  public updatePublication(
    actor: UserAccount,
    publicationId: string,
    payload: {
      title?: string;
      summary?: string;
      body?: string;
      knowledgeType?: KnowledgeType;
      subjectId?: string;
      topicId?: string;
      subtopicId?: string;
      targetGrades?: string[];
      language?: PublicationLanguage;
      audienceGroup?: string;
      learningNeeds?: string;
      sourceTitle?: string;
      sourceUrl?: string | null;
      sourcePublishedAt?: string | null;
      checklist?: Partial<ValidationChecklist>;
      changeNote?: string;
    }
  ) {
    const existingDetail = this.getPublicationDetail(actor, publicationId);
    const cur = existingDetail.publication;
    const ctx = this.academic.buildAuthContext(actor);

    this.assertTeacherOrAdminSubjectAccess(actor, ctx, cur.subjectId);
    const nextSubjectId = payload.subjectId ? String(payload.subjectId) : cur.subjectId;
    this.assertTeacherOrAdminSubjectAccess(actor, ctx, nextSubjectId);

    if (actor.role === 'teacher' && (cur.status === 'PUBLISHED' || cur.status === 'WITHDRAWN')) {
      throw new HttpError(
        403,
        'Published items require administrator approval to edit or issue corrections.'
      );
    }

    let safeSourceUrl = cur.sourceUrl;
    if (payload.sourceUrl !== undefined) {
      if (payload.sourceUrl && String(payload.sourceUrl).trim()) {
        const check = validateExternalResourceUrl(String(payload.sourceUrl));
        if (!check.valid) throw new HttpError(400, `Source URL rejected: ${check.reason}`);
        safeSourceUrl = check.normalizedUrl!;
      } else {
        safeSourceUrl = null;
      }
    }

    const nextTitle = payload.title !== undefined ? String(payload.title).trim() : cur.title;
    const nextSummary = payload.summary !== undefined ? String(payload.summary).trim() : cur.summary;
    const nextBody = payload.body !== undefined ? String(payload.body).trim() : cur.body;
    const nextChecklist: ValidationChecklist = {
      ...cur.checklist,
      ...(payload.checklist || {}),
    };
    const nextVersion = cur.currentVersion + 1;
    const now = new Date().toISOString();

    this.academic.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE knowledge_publications SET
            title = ?, summary = ?, body = ?, knowledge_type = ?, subject_id = ?, topic_id = ?, subtopic_id = ?,
            target_grades_json = ?, language = ?, audience_group = ?, learning_needs = ?,
            source_title = ?, source_url = ?, source_published_at = ?, checklist_json = ?,
            current_version = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextTitle,
          nextSummary,
          nextBody,
          payload.knowledgeType || cur.knowledgeType,
          nextSubjectId,
          payload.topicId || cur.topicId,
          payload.subtopicId || cur.subtopicId,
          JSON.stringify(payload.targetGrades?.length ? payload.targetGrades : cur.targetGrades),
          payload.language || cur.language,
          payload.audienceGroup !== undefined ? String(payload.audienceGroup) : cur.audienceGroup,
          payload.learningNeeds !== undefined ? String(payload.learningNeeds) : cur.learningNeeds,
          payload.sourceTitle !== undefined ? String(payload.sourceTitle) : cur.sourceTitle,
          safeSourceUrl,
          payload.sourcePublishedAt !== undefined ? payload.sourcePublishedAt : cur.sourcePublishedAt,
          JSON.stringify(nextChecklist),
          nextVersion,
          now,
          publicationId
        );

      this.db
        .prepare(
          `INSERT INTO publication_versions (
            id, publication_id, version_number, title, summary, body, change_note, changed_by, changed_by_name, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `PV-${publicationId}-v${nextVersion}`,
          publicationId,
          nextVersion,
          nextTitle,
          nextSummary,
          nextBody,
          String(payload.changeNote || 'Content & metadata updated'),
          actor.id,
          actor.name,
          now
        );

      this.academic.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'KNOWLEDGE_PUBLICATION_UPDATED',
        targetType: 'knowledge_publication',
        targetId: publicationId,
        details: { version: nextVersion, subjectId: nextSubjectId },
      });
    });

    return this.getPublicationDetail(actor, publicationId);
  }

  public transitionPublicationStatus(
    actor: UserAccount,
    publicationId: string,
    payload: {
      toStatus: PublicationStatus;
      notes?: string;
      scheduledFor?: string | null;
      checklist?: Partial<ValidationChecklist>;
      correctionNotice?: string | null;
    }
  ) {
    const existing = this.getPublicationDetail(actor, publicationId).publication;
    const ctx = this.academic.buildAuthContext(actor);
    this.assertTeacherOrAdminSubjectAccess(actor, ctx, existing.subjectId);

    const mergedChecklist: ValidationChecklist = {
      ...existing.checklist,
      ...(payload.checklist || {}),
    };

    const hasDelegatedPublish = Boolean(
      actor.delegatedPublishSubjects?.includes(existing.subjectId)
    );

    const check = validatePublicationTransition({
      actorRole: actor.role,
      hasDelegatedPublish,
      fromStatus: existing.status,
      toStatus: payload.toStatus,
      checklist: mergedChecklist,
      scheduledFor: payload.scheduledFor,
    });
    if (!check.allowed) {
      throw new HttpError(403, check.reason || 'Transition not permitted.');
    }

    if (payload.toStatus === 'REJECTED' && !String(payload.notes || '').trim()) {
      throw new HttpError(400, 'Please provide rejection feedback notes for the author.');
    }

    const now = new Date().toISOString();
    const isPublishingNow = payload.toStatus === 'PUBLISHED';
    const isApproving = payload.toStatus === 'APPROVED' || payload.toStatus === 'SCHEDULED' || isPublishingNow;

    this.academic.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE knowledge_publications SET
            status = ?,
            checklist_json = ?,
            reviewer_id = COALESCE(?, reviewer_id),
            reviewer_name = COALESCE(?, reviewer_name),
            verification_date = COALESCE(?, verification_date),
            scheduled_for = ?,
            published_at = COALESCE(?, published_at),
            correction_notice = COALESCE(?, correction_notice),
            updated_at = ?
           WHERE id = ?`
        )
        .run(
          payload.toStatus,
          JSON.stringify(mergedChecklist),
          isApproving || payload.toStatus === 'REJECTED' ? actor.id : null,
          isApproving || payload.toStatus === 'REJECTED' ? actor.name : null,
          isApproving ? now : null,
          payload.toStatus === 'SCHEDULED' ? payload.scheduledFor! : null,
          isPublishingNow ? now : null,
          payload.correctionNotice ? String(payload.correctionNotice).trim() : null,
          now,
          publicationId
        );

      this.db
        .prepare(
          `INSERT INTO publication_review_actions (
            id, publication_id, actor_id, actor_name, actor_role, action_type, from_status, to_status, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `PRA-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          publicationId,
          actor.id,
          actor.name,
          actor.role,
          `STATUS_${payload.toStatus}`,
          existing.status,
          payload.toStatus,
          String(payload.notes || ''),
          now
        );

      this.academic.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: `KNOWLEDGE_STATUS_${payload.toStatus}`,
        targetType: 'knowledge_publication',
        targetId: publicationId,
        details: { fromStatus: existing.status, toStatus: payload.toStatus, notes: payload.notes || '' },
      });
    });

    return this.getPublicationDetail(actor, publicationId);
  }

  public issueCorrectionNotice(
    actor: UserAccount,
    publicationId: string,
    payload: {
      correctionNotice: string;
      updatedBody?: string;
      updatedSummary?: string;
      notifyChannels?: ('in_app' | 'email' | 'whatsapp')[];
    }
  ) {
    if (actor.role !== 'admin') {
      throw new HttpError(403, 'Only administrators can issue official correction notices.');
    }
    const detail = this.getPublicationDetail(actor, publicationId);
    const cur = detail.publication;
    const notice = String(payload.correctionNotice || '').trim();
    if (notice.length < 8) {
      throw new HttpError(400, 'Provide a clear correction notice explanation.');
    }

    const now = new Date().toISOString();
    const nextVersion = cur.currentVersion + 1;
    const nextBody = payload.updatedBody ? String(payload.updatedBody).trim() : cur.body;
    const nextSummary = payload.updatedSummary ? String(payload.updatedSummary).trim() : cur.summary;

    this.academic.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE knowledge_publications SET
            correction_notice = ?, body = ?, summary = ?, current_version = ?, verification_date = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(notice, nextBody, nextSummary, nextVersion, now, now, publicationId);

      this.db
        .prepare(
          `INSERT INTO publication_versions (
            id, publication_id, version_number, title, summary, body, change_note, changed_by, changed_by_name, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `PV-${publicationId}-v${nextVersion}`,
          publicationId,
          nextVersion,
          cur.title,
          nextSummary,
          nextBody,
          `Correction notice: ${notice}`,
          actor.id,
          actor.name,
          now
        );

      this.db
        .prepare(
          `INSERT INTO publication_review_actions (
            id, publication_id, actor_id, actor_name, actor_role, action_type, from_status, to_status, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, 'CORRECTION_ISSUED', ?, ?, ?, ?)`
        )
        .run(
          `PRA-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          publicationId,
          actor.id,
          actor.name,
          actor.role,
          cur.status,
          cur.status,
          notice,
          now
        );
    });

    let campaign: PublicationCampaign | null = null;
    if (payload.notifyChannels && payload.notifyChannels.length > 0 && cur.status === 'PUBLISHED') {
      const res = this.dispatchCampaign(actor, publicationId, {
        channels: payload.notifyChannels,
        idempotencyKey: `correction-${publicationId}-v${nextVersion}`,
        isCorrection: true,
      });
      campaign = res.campaign;
    }

    return {
      ...this.getPublicationDetail(actor, publicationId),
      campaign,
    };
  }

  public processScheduledPublications(nowIso: string = new Date().toISOString()): number {
    const dueRows = this.db
      .prepare(
        `SELECT id, scheduled_for FROM knowledge_publications WHERE status = 'SCHEDULED' AND scheduled_for IS NOT NULL AND scheduled_for <= ?`
      )
      .all(nowIso) as { id: string; scheduled_for: string }[];

    if (dueRows.length === 0) return 0;

    let publishedCount = 0;
    this.academic.dbWrapper.transaction(() => {
      for (const row of dueRows) {
        const res = this.db
          .prepare(
            `UPDATE knowledge_publications
             SET status = 'PUBLISHED', published_at = COALESCE(published_at, ?), updated_at = ?
             WHERE id = ? AND status = 'SCHEDULED'`
          )
          .run(nowIso, nowIso, row.id);
        if (Number(res.changes ?? 0) > 0) {
          publishedCount++;
          this.db
            .prepare(
              `INSERT INTO publication_review_actions (
                id, publication_id, actor_id, actor_name, actor_role, action_type, from_status, to_status, notes, created_at
              ) VALUES (?, ?, 'system', 'Scheduled Publisher', 'system', 'AUTO_PUBLISHED', 'SCHEDULED', 'PUBLISHED', ?, ?)`
            )
            .run(
              `PRA-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
              row.id,
              `Automatically published at scheduled time ${row.scheduled_for}.`,
              nowIso
            );
        }
      }
    });

    return publishedCount;
  }

  // --- Resource Attachments & Secure Download ---
  public addUploadedResource(
    actor: UserAccount,
    publicationId: string,
    payload: {
      title: string;
      fileName: string;
      mimeType: string;
      base64Data: string;
      isCover?: boolean;
    }
  ): PublicationResource {
    const detail = this.getPublicationDetail(actor, publicationId);
    const ctx = this.academic.buildAuthContext(actor);
    this.assertTeacherOrAdminSubjectAccess(actor, ctx, detail.publication.subjectId);

    const checked = validateUploadPayload({
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      base64Data: payload.base64Data,
    });
    if (!checked.valid || !checked.buffer || !checked.safeFileName) {
      throw new HttpError(400, checked.reason || 'Invalid file upload.');
    }

    const resId = `RES-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const storedFileName = `${resId}-${checked.safeFileName}`;
    const targetPath = path.resolve(this.uploadDir, storedFileName);
    if (!targetPath.startsWith(this.uploadDir + path.sep)) {
      throw new HttpError(400, 'Invalid storage path.');
    }

    fs.writeFileSync(targetPath, checked.buffer);
    const now = new Date().toISOString();
    const isCover = Boolean(payload.isCover && checked.resourceType === 'image');

    this.academic.dbWrapper.transaction(() => {
      if (isCover) {
        this.db
          .prepare('UPDATE publication_resources SET is_cover = 0 WHERE publication_id = ?')
          .run(publicationId);
      }
      this.db
        .prepare(
          `INSERT INTO publication_resources (
            id, publication_id, resource_type, title, mime_type, size_bytes, storage_path,
            external_url, linked_quiz_ids_json, is_cover, sort_order, uploaded_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?, ?, ?)`
        )
        .run(
          resId,
          publicationId,
          checked.resourceType!,
          String(payload.title || checked.safeFileName).trim(),
          checked.resourceType === 'pdf'
            ? 'application/pdf'
            : payload.mimeType || 'application/octet-stream',
          checked.buffer!.length,
          storedFileName,
          isCover ? 1 : 0,
          detail.publication.resources.length + 1,
          actor.id,
          now
        );
    });

    const row = this.db
      .prepare('SELECT * FROM publication_resources WHERE id = ?')
      .get(resId) as Record<string, unknown>;
    return this.rowToResource(row);
  }

  public addLinkOrQuizResource(
    actor: UserAccount,
    publicationId: string,
    payload: {
      resourceType: 'external_link' | 'video_link' | 'linked_quiz';
      title: string;
      externalUrl?: string;
      linkedQuizIds?: string[];
    }
  ): PublicationResource {
    const detail = this.getPublicationDetail(actor, publicationId);
    const ctx = this.academic.buildAuthContext(actor);
    this.assertTeacherOrAdminSubjectAccess(actor, ctx, detail.publication.subjectId);

    const title = String(payload.title || '').trim();
    if (!title) {
      throw new HttpError(400, 'Resource title is required.');
    }

    let safeUrl: string | null = null;
    let quizIds: string[] = [];

    if (payload.resourceType === 'linked_quiz') {
      quizIds = Array.isArray(payload.linkedQuizIds)
        ? payload.linkedQuizIds.map(String).filter(Boolean)
        : [];
      if (quizIds.length === 0) {
        throw new HttpError(400, 'Select at least one quiz ID to link.');
      }
    } else {
      const check = validateExternalResourceUrl(String(payload.externalUrl || ''));
      if (!check.valid || !check.normalizedUrl) {
        throw new HttpError(400, check.reason || 'Invalid external URL.');
      }
      safeUrl = check.normalizedUrl;
    }

    const resId = `RES-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO publication_resources (
          id, publication_id, resource_type, title, mime_type, size_bytes, storage_path,
          external_url, linked_quiz_ids_json, is_cover, sort_order, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, 0, ?, ?, ?)`
      )
      .run(
        resId,
        publicationId,
        payload.resourceType,
        title,
        payload.resourceType === 'linked_quiz' ? 'application/json' : 'text/html',
        safeUrl,
        JSON.stringify(quizIds),
        detail.publication.resources.length + 1,
        actor.id,
        now
      );

    const row = this.db
      .prepare('SELECT * FROM publication_resources WHERE id = ?')
      .get(resId) as Record<string, unknown>;
    return this.rowToResource(row);
  }

  public removeResource(actor: UserAccount, publicationId: string, resourceId: string): void {
    const detail = this.getPublicationDetail(actor, publicationId);
    const ctx = this.academic.buildAuthContext(actor);
    this.assertTeacherOrAdminSubjectAccess(actor, ctx, detail.publication.subjectId);

    const row = this.db
      .prepare('SELECT * FROM publication_resources WHERE id = ? AND publication_id = ?')
      .get(resourceId, publicationId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Resource not found.');

    if (row.storage_path) {
      const rel = String(row.storage_path);
      const resolved = path.resolve(this.uploadDir, rel);
      if (resolved.startsWith(this.uploadDir + path.sep) && fs.existsSync(resolved)) {
        try {
          fs.unlinkSync(resolved);
        } catch {
          // ignore cleanup failure
        }
      }
    }
    this.db.prepare('DELETE FROM publication_resources WHERE id = ?').run(resourceId);
  }

  public resolveAuthorizedDownload(
    user: UserAccount,
    resourceId: string
  ): { filePath: string; fileName: string; mimeType: string; publicationId: string } {
    const row = this.db
      .prepare('SELECT * FROM publication_resources WHERE id = ?')
      .get(resourceId) as Record<string, unknown> | undefined;
    if (!row || !row.storage_path) {
      throw new HttpError(404, 'Downloadable resource not found.');
    }

    const publicationId = String(row.publication_id);
    // Reuses full RBAC + grade + published-status enforcement!
    this.getPublicationDetail(user, publicationId);

    const rel = String(row.storage_path);
    const resolved = path.resolve(this.uploadDir, rel);
    if (!resolved.startsWith(this.uploadDir + path.sep) || !fs.existsSync(resolved)) {
      throw new HttpError(404, 'Stored resource file is unavailable.');
    }

    if (user.role === 'student') {
      this.recordEngagementEvent(user, publicationId, 'resource_download', resourceId);
    }

    return {
      filePath: resolved,
      fileName: path.basename(rel).replace(/^RES-[A-Z0-9]+-/, ''),
      mimeType: String(row.mime_type || 'application/octet-stream'),
      publicationId,
    };
  }

  // --- Multi-Channel Distribution Campaigns (Idempotent + Consent/Opt-in Enforced) ---
  public dispatchCampaign(
    actor: UserAccount,
    publicationId: string,
    payload: {
      channels: ('in_app' | 'email' | 'whatsapp')[];
      idempotencyKey?: string;
      isCorrection?: boolean;
    }
  ): {
    campaign: PublicationCampaign;
    deliveries: PublicationDelivery[];
    deduplicated: boolean;
  } {
    if (actor.role !== 'admin') {
      throw new HttpError(403, 'Only administrators can distribute knowledge campaigns across channels.');
    }

    const detail = this.getPublicationDetail(actor, publicationId);
    const pub = detail.publication;
    if (pub.status !== 'PUBLISHED') {
      throw new HttpError(400, 'Publication must be PUBLISHED before distributing notifications.');
    }

    const channels = Array.from(new Set(payload.channels || ['in_app']));
    if (channels.length === 0) {
      throw new HttpError(400, 'Select at least one distribution channel.');
    }

    const idemKey = String(
      payload.idempotencyKey || `cmp-${publicationId}-${channels.slice().sort().join('-')}-v${pub.currentVersion}`
    );

    const existingCamp = this.db
      .prepare('SELECT * FROM publication_campaigns WHERE idempotency_key = ?')
      .get(idemKey) as Record<string, unknown> | undefined;
    if (existingCamp) {
      return {
        campaign: this.rowToCampaign(existingCamp),
        deliveries: this.listDeliveriesForCampaign(String(existingCamp.id)),
        deduplicated: true,
      };
    }

    const subjectRow = this.db
      .prepare('SELECT name_en FROM subjects WHERE id = ?')
      .get(pub.subjectId) as { name_en: string } | undefined;
    const subjectName = subjectRow?.name_en || pub.subjectId;

    const studentRows = this.db
      .prepare("SELECT * FROM users WHERE role = 'student' AND active = 1")
      .all() as Record<string, unknown>[];

    const eligibleStudents = studentRows
      .map((r) => this.academic.getUserById(String(r.id))!)
      .filter((stu) => isStudentEligibleForPublication(stu, pub));

    const campaignId = `CMP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const deepLinkPath = `/?view=knowledge&pub=${encodeURIComponent(pub.id)}`;

    let deliveredCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    this.academic.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO publication_campaigns (
            id, publication_id, publication_title, triggered_by, triggered_by_name,
            channels_json, target_grades_json, idempotency_key,
            total_eligible, delivered_count, skipped_count, failed_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`
        )
        .run(
          campaignId,
          pub.id,
          pub.title,
          actor.id,
          actor.name,
          JSON.stringify(channels),
          JSON.stringify(pub.targetGrades),
          idemKey,
          eligibleStudents.length,
          now
        );

      const insertDelivery = this.db.prepare(
        `INSERT OR IGNORE INTO publication_deliveries (
          id, campaign_id, publication_id, recipient_user_id, recipient_name, recipient_role,
          channel, delivery_status, retry_count, error_message, delivered_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'student', ?, ?, 0, ?, ?, ?)`
      );

      for (const stu of eligibleStudents) {
        const prefs = stu.notificationPreferences || {
          inApp: true,
          email: true,
          whatsapp: true,
          groupedSummary: false,
        };

        for (const ch of channels) {
          const deliveryId = `DLV-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
          let status: PublicationDelivery['deliveryStatus'] = 'delivered';
          let errMsg: string | null = null;

          if (ch === 'in_app') {
            if (!prefs.inApp) {
              status = 'skipped_preference';
              errMsg = 'Student opted out of in-app alerts.';
              skippedCount++;
            } else {
              this.db
                .prepare(
                  `INSERT INTO notifications (
                    id, recipient_user_id, recipient_role, channel, category, title, body,
                    related_subject_id, related_publication_id, dedupe_key, delivery_status, retry_count, created_at
                  ) VALUES (?, ?, 'student', 'in_app', ?, ?, ?, ?, ?, ?, 'delivered', 0, ?)`
                )
                .run(
                  `NTF-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
                  stu.id,
                  payload.isCorrection ? 'knowledge_correction' : 'knowledge_publication',
                  payload.isCorrection ? `Correction: ${pub.title}` : `New Guide: ${pub.title}`,
                  payload.isCorrection && pub.correctionNotice ? pub.correctionNotice : pub.summary,
                  pub.subjectId,
                  pub.id,
                  `kpub-${campaignId}-${stu.id}-in_app`,
                  now
                );
              deliveredCount++;
            }
          } else if (ch === 'email') {
            if (!prefs.email) {
              status = 'skipped_preference';
              errMsg = 'Recipient opted out of email digests.';
              skippedCount++;
            } else if (!stu.guardianContactVerified || !stu.guardianConsentGiven) {
              status = 'skipped_unverified';
              errMsg = 'Guardian contact unverified or consent withheld.';
              skippedCount++;
            } else {
              this.academic.recordEmailLog({
                toEmail: stu.email,
                subject: payload.isCorrection
                  ? `Correction Notice: ${pub.title} · මං 5හේ`
                  : `New Learning Guide: ${pub.title} · මං 5හේ`,
                category: 'knowledge_publication',
                htmlBody: buildKnowledgeEmailHtml({
                  recipientName: stu.name,
                  publicationTitle: pub.title,
                  publicationId: pub.id,
                  subjectName,
                  targetGrades: pub.targetGrades,
                  summary: pub.summary,
                  sourceTitle: pub.sourceTitle,
                  deepLinkPath,
                  isCorrection: payload.isCorrection,
                  correctionNotice: pub.correctionNotice,
                }),
              });
              deliveredCount++;
            }
          } else if (ch === 'whatsapp') {
            if (!prefs.whatsapp) {
              status = 'skipped_preference';
              errMsg = 'Recipient opted out of WhatsApp alerts.';
              skippedCount++;
            } else if (!stu.guardianContactVerified || !stu.guardianConsentGiven) {
              status = 'skipped_unverified';
              errMsg = 'Guardian WhatsApp unverified or consent withheld.';
              skippedCount++;
            } else {
              this.academic.recordWhatsAppLog({
                toNumber: stu.whatsappNumber,
                category: 'knowledge_publication',
                messageText: buildKnowledgeWhatsAppMessage({
                  recipientName: stu.name,
                  publicationTitle: pub.title,
                  publicationId: pub.id,
                  subjectName,
                  targetGrades: pub.targetGrades,
                  summary: pub.summary,
                  deepLinkPath,
                  isCorrection: payload.isCorrection,
                  correctionNotice: pub.correctionNotice,
                }),
              });
              deliveredCount++;
            }
          }

          insertDelivery.run(
            deliveryId,
            campaignId,
            pub.id,
            stu.id,
            stu.name,
            ch,
            status,
            errMsg,
            status === 'delivered' ? now : null,
            now
          );
        }
      }

      this.db
        .prepare(
          `UPDATE publication_campaigns SET delivered_count = ?, skipped_count = ?, failed_count = ? WHERE id = ?`
        )
        .run(deliveredCount, skippedCount, failedCount, campaignId);

      this.academic.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'KNOWLEDGE_CAMPAIGN_DISPATCHED',
        targetType: 'publication_campaign',
        targetId: campaignId,
        details: {
          publicationId: pub.id,
          channels,
          totalEligible: eligibleStudents.length,
          deliveredCount,
          skippedCount,
        },
      });
    });

    const campRow = this.db
      .prepare('SELECT * FROM publication_campaigns WHERE id = ?')
      .get(campaignId) as Record<string, unknown>;

    return {
      campaign: this.rowToCampaign(campRow),
      deliveries: this.listDeliveriesForCampaign(campaignId),
      deduplicated: false,
    };
  }

  public retryDelivery(actor: UserAccount, deliveryId: string) {
    if (actor.role !== 'admin') {
      throw new HttpError(403, 'Administrator access required to retry campaign deliveries.');
    }
    const row = this.db
      .prepare('SELECT * FROM publication_deliveries WHERE id = ?')
      .get(deliveryId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Delivery record not found.');

    const recipient = this.academic.getUserById(String(row.recipient_user_id));
    if (!recipient) throw new HttpError(404, 'Recipient account no longer exists.');
    if (
      String(row.delivery_status) === 'skipped_unverified' &&
      (!recipient.guardianContactVerified || !recipient.guardianConsentGiven)
    ) {
      throw new HttpError(
        400,
        'Guardian contact verification and consent are still required before delivering.'
      );
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE publication_deliveries SET delivery_status = 'delivered', retry_count = retry_count + 1, error_message = NULL, delivered_at = ? WHERE id = ?`
      )
      .run(now, deliveryId);

    const campId = String(row.campaign_id);
    const counts = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) as d,
           SUM(CASE WHEN delivery_status LIKE 'skipped_%' THEN 1 ELSE 0 END) as s,
           SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) as f
         FROM publication_deliveries WHERE campaign_id = ?`
      )
      .get(campId) as { d: number; s: number; f: number };
    this.db
      .prepare(
        `UPDATE publication_campaigns SET delivered_count = ?, skipped_count = ?, failed_count = ? WHERE id = ?`
      )
      .run(Number(counts.d || 0), Number(counts.s || 0), Number(counts.f || 0), campId);

    return { ok: true };
  }

  private rowToCampaign(r: Record<string, unknown>): PublicationCampaign {
    return {
      id: String(r.id),
      publicationId: String(r.publication_id),
      publicationTitle: String(r.publication_title),
      triggeredBy: String(r.triggered_by),
      triggeredByName: String(r.triggered_by_name),
      channels: parseJsonSafe<('in_app' | 'email' | 'whatsapp')[]>(r.channels_json, []),
      targetGrades: parseJsonSafe<string[]>(r.target_grades_json, []),
      idempotencyKey: String(r.idempotency_key),
      totalEligible: Number(r.total_eligible ?? 0),
      deliveredCount: Number(r.delivered_count ?? 0),
      skippedCount: Number(r.skipped_count ?? 0),
      failedCount: Number(r.failed_count ?? 0),
      createdAt: String(r.created_at),
    };
  }

  public listCampaignsForPublication(publicationId: string): PublicationCampaign[] {
    const rows = this.db
      .prepare('SELECT * FROM publication_campaigns WHERE publication_id = ? ORDER BY created_at DESC')
      .all(publicationId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToCampaign(r));
  }

  public listDeliveriesForCampaign(campaignId: string): PublicationDelivery[] {
    const rows = this.db
      .prepare('SELECT * FROM publication_deliveries WHERE campaign_id = ? ORDER BY recipient_name ASC, channel ASC')
      .all(campaignId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      campaignId: String(r.campaign_id),
      publicationId: String(r.publication_id),
      recipientUserId: String(r.recipient_user_id),
      recipientName: String(r.recipient_name),
      recipientRole: String(r.recipient_role) as UserRole,
      channel: String(r.channel) as PublicationDelivery['channel'],
      deliveryStatus: String(r.delivery_status) as PublicationDelivery['deliveryStatus'],
      retryCount: Number(r.retry_count ?? 0),
      errorMessage: r.error_message ? String(r.error_message) : null,
      deliveredAt: r.delivered_at ? String(r.delivered_at) : null,
      createdAt: String(r.created_at),
    }));
  }

  // --- Engagement & Bookmarking (Distinct from Delivery!) ---
  public recordEngagementEvent(
    user: UserAccount,
    publicationId: string,
    eventType: PublicationEngagementType,
    resourceId?: string | null,
    metadata: Record<string, unknown> = {}
  ): { ok: boolean; bookmarked?: boolean } {
    const detail = this.getPublicationDetail(user, publicationId);
    const now = new Date().toISOString();

    if (eventType === 'bookmark') {
      const existing = this.db
        .prepare(
          'SELECT 1 FROM student_saved_publications WHERE student_id = ? AND publication_id = ?'
        )
        .get(user.id, publicationId);
      if (existing) {
        this.db
          .prepare(
            'DELETE FROM student_saved_publications WHERE student_id = ? AND publication_id = ?'
          )
          .run(user.id, publicationId);
        return { ok: true, bookmarked: false };
      }
      this.db
        .prepare(
          'INSERT INTO student_saved_publications (student_id, publication_id, saved_at) VALUES (?, ?, ?)'
        )
        .run(user.id, publicationId, now);
      this.db
        .prepare(
          `INSERT INTO publication_engagement_events (id, publication_id, user_id, event_type, resource_id, metadata_json, created_at)
           VALUES (?, ?, ?, 'bookmark', ?, ?, ?)`
        )
        .run(
          `ENG-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          detail.publication.id,
          user.id,
          resourceId || null,
          JSON.stringify(metadata),
          now
        );
      return { ok: true, bookmarked: true };
    }

    this.db
      .prepare(
        `INSERT INTO publication_engagement_events (id, publication_id, user_id, event_type, resource_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `ENG-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        detail.publication.id,
        user.id,
        eventType,
        resourceId || null,
        JSON.stringify(metadata),
        now
      );

    return { ok: true };
  }

  // --- Discovery Queue ---
  public listDiscoveryQueue(actor: UserAccount): KnowledgeDiscoveryCandidate[] {
    if (actor.role === 'student') {
      throw new HttpError(403, 'Access denied.');
    }
    const ctx = this.academic.buildAuthContext(actor);
    const rows = this.db
      .prepare('SELECT * FROM knowledge_discovery_queue ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];

    return rows
      .map((r): KnowledgeDiscoveryCandidate => ({
        id: String(r.id),
        title: String(r.title),
        summary: String(r.summary),
        suggestedSubjectId: String(r.suggested_subject_id),
        suggestedTopicId: String(r.suggested_topic_id),
        suggestedGrades: parseJsonSafe<string[]>(r.suggested_grades_json, [DEFAULT_GRADE]),
        language: String(r.language || 'bilingual') as PublicationLanguage,
        sourceTitle: String(r.source_title),
        sourceUrl: String(r.source_url),
        sourcePublishedAt: String(r.source_published_at),
        relevanceScore: Number(r.relevance_score ?? 0.8),
        duplicateMatches: parseJsonSafe(r.duplicate_matches_json, []),
        uncertaintyFlags: parseJsonSafe(r.uncertainty_flags_json, []),
        aiGenerated: Number(r.ai_generated ?? 0) === 1,
        status: String(r.status) as KnowledgeDiscoveryCandidate['status'],
        createdBy: String(r.created_by),
        createdAt: String(r.created_at),
      }))
      .filter((c) => actor.role === 'admin' || canAccessSubject(ctx, c.suggestedSubjectId));
  }

  public addDiscoveryCandidate(
    actor: UserAccount,
    payload: {
      title: string;
      summary: string;
      suggestedSubjectId: string;
      suggestedTopicId?: string;
      suggestedGrades?: string[];
      language?: PublicationLanguage;
      sourceTitle: string;
      sourceUrl: string;
      sourcePublishedAt?: string;
      uncertaintyFlags?: string[];
      aiGenerated?: boolean;
    }
  ): KnowledgeDiscoveryCandidate {
    if (actor.role === 'student') {
      throw new HttpError(403, 'Access denied.');
    }
    const ctx = this.academic.buildAuthContext(actor);
    this.assertTeacherOrAdminSubjectAccess(actor, ctx, payload.suggestedSubjectId);

    const urlCheck = validateExternalResourceUrl(payload.sourceUrl);
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      throw new HttpError(400, urlCheck.reason || 'Valid verified source URL is required.');
    }

    const dupes = this.checkDuplicates({
      title: payload.title,
      sourceUrl: urlCheck.normalizedUrl,
    });
    const flags = [...(payload.uncertaintyFlags || [])];
    if (dupes.length > 0) {
      flags.push(`Possible overlap with existing publication: ${dupes[0].id} (${dupes[0].title})`);
    }

    const id = `DSC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO knowledge_discovery_queue (
          id, title, summary, suggested_subject_id, suggested_topic_id, suggested_grades_json,
          language, source_title, source_url, source_published_at, relevance_score,
          duplicate_matches_json, uncertainty_flags_json, ai_generated, status, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?)`
      )
      .run(
        id,
        payload.title.trim(),
        payload.summary.trim(),
        payload.suggestedSubjectId,
        payload.suggestedTopicId || '',
        JSON.stringify(payload.suggestedGrades?.length ? payload.suggestedGrades : [DEFAULT_GRADE]),
        payload.language || 'bilingual',
        payload.sourceTitle.trim(),
        urlCheck.normalizedUrl,
        payload.sourcePublishedAt || now.slice(0, 10),
        dupes.length > 0 ? 0.55 : 0.9,
        JSON.stringify(dupes),
        JSON.stringify(flags),
        payload.aiGenerated ? 1 : 0,
        actor.id,
        now
      );

    return this.listDiscoveryQueue(actor).find((c) => c.id === id)!;
  }

  public updateDiscoveryCandidateStatus(
    actor: UserAccount,
    candidateId: string,
    status: 'CONVERTED' | 'DISMISSED'
  ): void {
    const row = this.db
      .prepare('SELECT suggested_subject_id FROM knowledge_discovery_queue WHERE id = ?')
      .get(candidateId) as { suggested_subject_id: string } | undefined;
    if (!row) throw new HttpError(404, 'Discovery candidate not found.');
    const ctx = this.academic.buildAuthContext(actor);
    this.assertTeacherOrAdminSubjectAccess(actor, ctx, row.suggested_subject_id);
    this.db
      .prepare('UPDATE knowledge_discovery_queue SET status = ? WHERE id = ?')
      .run(status, candidateId);
  }

  // --- Scoped Publication & Engagement Analytics ---
  public getKnowledgeAnalytics(actor: UserAccount): KnowledgeAnalyticsSummary {
    if (actor.role === 'student') {
      throw new HttpError(403, 'Access denied.');
    }
    this.processScheduledPublications();

    const publications = this.listPublications(actor);
    const pubIds = new Set(publications.map((p) => p.id));

    const subjectRows = this.db.prepare('SELECT id, name_en FROM subjects').all() as {
      id: string;
      name_en: string;
    }[];
    const subjectNames = new Map(subjectRows.map((s) => [s.id, s.name_en]));

    const statusCounts = new Map<PublicationStatus, number>();
    const gradeCounts = new Map<string, number>();
    const subjPubCounts = new Map<string, number>();

    for (const p of publications) {
      statusCounts.set(p.status, (statusCounts.get(p.status) || 0) + 1);
      subjPubCounts.set(p.subjectId, (subjPubCounts.get(p.subjectId) || 0) + 1);
      for (const g of p.targetGrades) {
        gradeCounts.set(g, (gradeCounts.get(g) || 0) + 1);
      }
    }

    const engRows = (
      this.db.prepare('SELECT * FROM publication_engagement_events').all() as Record<string, unknown>[]
    ).filter((e) => pubIds.has(String(e.publication_id)));

    const delivRows = (
      this.db.prepare('SELECT * FROM publication_deliveries').all() as Record<string, unknown>[]
    ).filter((d) => pubIds.has(String(d.publication_id)));

    const campRows = (
      this.db.prepare('SELECT * FROM publication_campaigns').all() as Record<string, unknown>[]
    ).filter((c) => pubIds.has(String(c.publication_id)));

    const uniqueViewerSet = new Set<string>();
    let totalViews = 0;
    let resourceDownloads = 0;
    let externalLinkClicks = 0;
    let quizCompletions = 0;
    let bookmarksCount = 0;

    const perPubEng = new Map<
      string,
      {
        views: number;
        viewers: Set<string>;
        downloads: number;
        clicks: number;
        quizzes: number;
      }
    >();

    for (const e of engRows) {
      const pid = String(e.publication_id);
      const uid = String(e.user_id);
      const et = String(e.event_type) as PublicationEngagementType;
      const entry = perPubEng.get(pid) || {
        views: 0,
        viewers: new Set<string>(),
        downloads: 0,
        clicks: 0,
        quizzes: 0,
      };
      if (et === 'view') {
        totalViews++;
        uniqueViewerSet.add(uid);
        entry.views++;
        entry.viewers.add(uid);
      } else if (et === 'resource_download') {
        resourceDownloads++;
        entry.downloads++;
      } else if (et === 'link_click') {
        externalLinkClicks++;
        entry.clicks++;
      } else if (et === 'quiz_complete') {
        quizCompletions++;
        entry.quizzes++;
      } else if (et === 'bookmark') {
        bookmarksCount++;
      }
      perPubEng.set(pid, entry);
    }

    const perPubDelivered = new Map<string, number>();
    let deliveredCount = 0;
    let skippedUnverifiedCount = 0;
    let skippedPreferenceCount = 0;
    let failedCount = 0;

    for (const d of delivRows) {
      const st = String(d.delivery_status);
      const pid = String(d.publication_id);
      if (st === 'delivered') {
        deliveredCount++;
        perPubDelivered.set(pid, (perPubDelivered.get(pid) || 0) + 1);
      } else if (st === 'skipped_unverified') {
        skippedUnverifiedCount++;
      } else if (st === 'skipped_preference') {
        skippedPreferenceCount++;
      } else if (st === 'failed') {
        failedCount++;
      }
    }

    const subjViewCounts = new Map<string, number>();
    for (const p of publications) {
      const e = perPubEng.get(p.id);
      subjViewCounts.set(p.subjectId, (subjViewCounts.get(p.subjectId) || 0) + (e?.views || 0));
    }

    return {
      totalPublications: publications.length,
      publishedCount: statusCounts.get('PUBLISHED') || 0,
      pendingReviewCount: statusCounts.get('PENDING_REVIEW') || 0,
      scheduledCount: statusCounts.get('SCHEDULED') || 0,
      byStatus: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
      bySubject: Array.from(subjPubCounts.entries()).map(([subjectId, count]) => ({
        subjectId,
        subjectName: subjectNames.get(subjectId) || subjectId,
        count,
        views: subjViewCounts.get(subjectId) || 0,
      })),
      byGrade: Array.from(gradeCounts.entries()).map(([grade, count]) => ({ grade, count })),
      deliveryMetrics: {
        totalCampaigns: campRows.length,
        deliveredCount,
        skippedUnverifiedCount,
        skippedPreferenceCount,
        failedCount,
      },
      engagementMetrics: {
        totalViews,
        uniqueViewers: uniqueViewerSet.size,
        resourceDownloads,
        externalLinkClicks,
        quizCompletions,
        bookmarksCount,
      },
      topPublications: publications
        .map((p) => {
          const e = perPubEng.get(p.id);
          return {
            id: p.id,
            title: p.title,
            subjectId: p.subjectId,
            subjectName: subjectNames.get(p.subjectId) || p.subjectId,
            status: p.status,
            views: e?.views || 0,
            uniqueViewers: e?.viewers.size || 0,
            downloads: e?.downloads || 0,
            linkClicks: e?.clicks || 0,
            quizCompletions: e?.quizzes || 0,
            deliveredCount: perPubDelivered.get(p.id) || 0,
          };
        })
        .sort((a, b) => b.views + b.downloads - (a.views + a.downloads))
        .slice(0, 10),
    };
  }
}
