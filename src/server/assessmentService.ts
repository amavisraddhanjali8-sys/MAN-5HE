import crypto from 'node:crypto';
import {
  buildAttemptDeliveryOrder,
  canActorModifyQuestion,
  gradeSubmittedAnswer,
  parseBulkQuestionsPayload,
  selectQuestionsForAssessment,
  validateAssessmentTransition,
  validateQuestionTransition,
} from '../lib/assessmentEngine.ts';
import {
  DOMAIN_TO_SUBJECT_ID,
  canAccessQuestion,
  canAccessSubject,
  resolveQuestionSubjectId,
  type AuthorizationContext,
} from '../lib/authorization.ts';
import {
  TOTAL_VIRTUAL_POOL_SIZE,
  calculateQuizDifficultyScore,
  classifyDifficultyTier,
  evaluateStudentTrajectory,
  generateVirtualQuizFromPool,
} from '../lib/psychometrics.ts';
import type {
  AssessmentAnswerRecord,
  AssessmentAssignment,
  AssessmentAttemptRecord,
  AssessmentAttemptStatus,
  AssessmentConfig,
  AssessmentKind,
  AssessmentRecord,
  AssessmentSection,
  AssessmentSelectionMode,
  AssessmentSnapshotItem,
  AssessmentStatus,
  CognitiveDomain,
  DifficultyTier,
  ExplanationTiming,
  QuestionApprovalStatus,
  QuestionMarkingRule,
  QuestionMisconception,
  QuestionReviewActionRecord,
  QuestionType,
  QuizItem,
  StudentQuizView,
  UserAccount,
} from '../lib/types.ts';
import { AcademicService, HttpError, rowToQuiz } from './academicService.ts';
import { Man5heDatabase, resolveDefaultHierarchyForQuestion } from './db.ts';

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class AssessmentService {
  private readonly dbWrapper: Man5heDatabase;
  private readonly academicService: AcademicService;
  private onAttemptCompletedHook?: (attemptId: string, stage: 'submitted' | 'graded') => void;

  constructor(dbWrapper: Man5heDatabase, academicService: AcademicService) {
    this.dbWrapper = dbWrapper;
    this.academicService = academicService;
  }

  public setOnAttemptCompletedHook(
    hook: (attemptId: string, stage: 'submitted' | 'graded') => void
  ): void {
    this.onAttemptCompletedHook = hook;
  }

  private get db() {
    return this.dbWrapper.db;
  }

  // =========================================================================
  // 1. SUBJECT-SCOPED QUESTION BANK CRUD, BULK IMPORT & LIFECYCLE
  // =========================================================================

  public createQuestionExtended(
    actor: UserAccount,
    payload: {
      subjectId?: string;
      topicId?: string;
      subtopicId?: string;
      grade?: string;
      questionType?: QuestionType;
      cognitiveSkill?: string;
      learningObjectives?: string;
      hint?: string;
      markingRule?: QuestionMarkingRule;
      acceptedAnswers?: string[];
      defaultMarks?: number;
      approvalStatus?: QuestionApprovalStatus;
      questionSi: string;
      questionEn?: string;
      options?: string[];
      correctIndex?: number;
      imageUrl?: string;
      memoryTrickTitle?: string;
      memoryTrickBody?: string;
      explanation?: string;
      misconceptions?: QuestionMisconception[];
      attributes?: Partial<QuizItem['attributes']>;
    }
  ): QuizItem {
    if (actor.role === 'student') {
      throw new HttpError(403, 'Students cannot author question bank items.');
    }

    const ctx = this.academicService.buildAuthContext(actor);
    const domain: CognitiveDomain =
      (payload.attributes?.cognitiveDomain as CognitiveDomain) || 'Mathematics & Word Problems';
    const subjectId = payload.subjectId || DOMAIN_TO_SUBJECT_ID[domain] || 'subj-math';

    const subjectRow = this.db
      .prepare('SELECT id, cognitive_domain FROM subjects WHERE id = ?')
      .get(subjectId) as { id: string; cognitive_domain: string } | undefined;
    if (!subjectRow) {
      throw new HttpError(400, `Unknown subject category: ${subjectId}`);
    }

    if (actor.role === 'teacher' && !canAccessSubject(ctx, subjectId)) {
      throw new HttpError(
        403,
        'Access denied: You can only create questions inside your assigned subject categories.'
      );
    }

    const qType: QuestionType = payload.questionType || 'mcq';
    if (!['mcq', 'numerical', 'true_false', 'short_answer'].includes(qType)) {
      throw new HttpError(400, `Unsupported question type: ${qType}`);
    }

    const requestedStatus: QuestionApprovalStatus =
      payload.approvalStatus || (actor.role === 'admin' ? 'ACTIVE' : 'DRAFT');
    if (
      actor.role === 'teacher' &&
      requestedStatus !== 'DRAFT' &&
      requestedStatus !== 'PENDING_REVIEW'
    ) {
      throw new HttpError(
        403,
        'Teachers may create questions as DRAFT or submit them for PENDING_REVIEW. Administrator approval is required to publish.'
      );
    }

    const questionSi = String(payload.questionSi || '').trim();
    if (!questionSi) {
      throw new HttpError(400, 'Question prompt is required.');
    }

    let options: [string, string, string, string] = ['', '', '', ''];
    let correctIndex = 0;
    let acceptedAnswers = (payload.acceptedAnswers || [])
      .map((s) => String(s).trim())
      .filter(Boolean);

    if (qType === 'mcq') {
      const rawOpts = Array.isArray(payload.options) ? payload.options.map((o) => String(o).trim()) : [];
      if (rawOpts.length !== 4 || rawOpts.some((o) => !o)) {
        throw new HttpError(400, 'MCQ questions require 4 non-empty options.');
      }
      options = [rawOpts[0], rawOpts[1], rawOpts[2], rawOpts[3]];
      correctIndex = Math.max(0, Math.min(3, Number(payload.correctIndex ?? 0)));
      if (acceptedAnswers.length === 0) acceptedAnswers = [options[correctIndex]];
    } else if (qType === 'true_false') {
      const rawOpts = Array.isArray(payload.options) ? payload.options : [];
      options = [
        String(rawOpts[0] || 'True (සත්‍යයි)').trim(),
        String(rawOpts[1] || 'False (අසත්‍යයි)').trim(),
        '',
        '',
      ];
      correctIndex = Number(payload.correctIndex) === 1 ? 1 : 0;
      if (acceptedAnswers.length === 0) {
        acceptedAnswers = [correctIndex === 0 ? 'True' : 'False'];
      }
    } else {
      // numerical or short_answer
      const rawOpts = Array.isArray(payload.options) ? payload.options : [];
      if (acceptedAnswers.length === 0 && rawOpts[0]) {
        acceptedAnswers = [String(rawOpts[0]).trim()];
      }
      if (acceptedAnswers.length === 0 && !payload.markingRule?.requiresManualReview) {
        throw new HttpError(
          400,
          `${qType} questions require at least one accepted answer or manual marking enabled.`
        );
      }
      options = [acceptedAnswers[0] || '', '', '', ''];
      correctIndex = 0;
    }

    const fallbackHier = resolveDefaultHierarchyForQuestion('NEW', subjectRow.cognitive_domain as CognitiveDomain);
    const defaultTopicRow = this.db
      .prepare('SELECT id FROM topics WHERE subject_id = ? ORDER BY sort_order ASC LIMIT 1')
      .get(subjectId) as { id: string } | undefined;
    const topicId = payload.topicId || defaultTopicRow?.id || fallbackHier.topicId;
    const defaultSubRow = this.db
      .prepare('SELECT id FROM subtopics WHERE topic_id = ? ORDER BY sort_order ASC LIMIT 1')
      .get(topicId) as { id: string } | undefined;
    const subtopicId = payload.subtopicId || defaultSubRow?.id || fallbackHier.subtopicId;

    const correctProb = Math.max(
      0.05,
      Math.min(0.95, Number(payload.attributes?.correctProbability ?? 0.65))
    );
    const baseAttrs = {
      intelligenceMeasure: Number(payload.attributes?.intelligenceMeasure ?? 58),
      correctProbability: correctProb,
      wrongProbability: Math.round((1 - correctProb) * 100) / 100,
      examPriority: Number(payload.attributes?.examPriority ?? 7),
      quizStrength: Number(payload.attributes?.quizStrength ?? 75),
      difficultyTier: 'Moderate' as DifficultyTier,
      cognitiveDomain: subjectRow.cognitive_domain as CognitiveDomain,
      estimatedSeconds: Math.max(10, Number(payload.attributes?.estimatedSeconds ?? 40)),
    };
    baseAttrs.difficultyTier =
      payload.attributes?.difficultyTier ||
      classifyDifficultyTier(calculateQuizDifficultyScore(baseAttrs));

    const totalCurated = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM questions').get() as { cnt: number }
    ).cnt;
    const id = `CUR-${String(totalCurated + 1).padStart(3, '0')}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;
    const now = new Date().toISOString();

    const quiz: QuizItem = {
      id,
      source: 'curated',
      subjectId,
      topicId,
      subtopicId,
      version: 1,
      grade: String(payload.grade || 'Grade 5').trim(),
      questionType: qType,
      cognitiveSkill: String(payload.cognitiveSkill || 'Application').trim(),
      learningObjectives: String(payload.learningObjectives || '').trim(),
      hint: String(payload.hint || '').trim(),
      markingRule: payload.markingRule || {},
      acceptedAnswers,
      defaultMarks: Math.max(1, Number(payload.defaultMarks ?? 1)),
      approvalStatus: requestedStatus,
      authorId: actor.id,
      authorName: actor.name,
      reviewerId: actor.role === 'admin' && requestedStatus === 'ACTIVE' ? actor.id : null,
      reviewerName: actor.role === 'admin' && requestedStatus === 'ACTIVE' ? actor.name : null,
      reviewedAt: actor.role === 'admin' && requestedStatus === 'ACTIVE' ? now : null,
      questionSi,
      questionEn: String(payload.questionEn || questionSi).trim(),
      options,
      correctIndex,
      imageUrl: payload.imageUrl ? String(payload.imageUrl) : undefined,
      memoryTrickTitle: String(payload.memoryTrickTitle || 'Psychological Memory Cue').trim(),
      memoryTrickBody: String(
        payload.memoryTrickBody || 'Break the problem into small visual steps and verify!'
      ).trim(),
      explanation: String(
        payload.explanation || 'Reviewed via Grade 5 Scholarship rubric.'
      ).trim(),
      misconceptions: payload.misconceptions || [],
      qualityFlag: 'OK',
      attributes: baseAttrs,
      createdAt: now,
      updatedAt: now,
    };

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO questions (
            id, source, subject_id, topic_id, subtopic_id, version, grade, question_type,
            cognitive_skill, learning_objectives, hint, marking_rule_json, accepted_answers_json,
            default_marks, approval_status, author_id, author_name, reviewer_id, reviewer_name,
            reviewed_at, question_si, question_en, options_json, correct_index, image_url,
            memory_trick_title, memory_trick_body, explanation, misconceptions_json, attributes_json,
            quality_flag, active, created_by, created_at, updated_at
          ) VALUES (?, 'curated', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OK', 1, ?, ?, ?)`
        )
        .run(
          quiz.id,
          subjectId,
          topicId,
          subtopicId,
          quiz.grade!,
          qType,
          quiz.cognitiveSkill!,
          quiz.learningObjectives!,
          quiz.hint!,
          JSON.stringify(quiz.markingRule),
          JSON.stringify(acceptedAnswers),
          quiz.defaultMarks!,
          requestedStatus,
          actor.id,
          actor.name,
          quiz.reviewerId || null,
          quiz.reviewerName || null,
          quiz.reviewedAt || null,
          quiz.questionSi,
          quiz.questionEn,
          JSON.stringify(quiz.options),
          quiz.correctIndex,
          quiz.imageUrl || null,
          quiz.memoryTrickTitle,
          quiz.memoryTrickBody,
          quiz.explanation,
          JSON.stringify(quiz.misconceptions || []),
          JSON.stringify(quiz.attributes),
          actor.email,
          now,
          now
        );

      this.db
        .prepare(
          `INSERT INTO question_versions (
            id, question_id, version, subject_id, topic_id, subtopic_id, snapshot_json, changed_by, change_note, created_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `QV-${quiz.id}-v1`,
          quiz.id,
          subjectId,
          topicId,
          subtopicId,
          JSON.stringify(quiz),
          actor.email,
          `Created question (${requestedStatus})`,
          now
        );

      this.insertQuestionReviewAction({
        questionId: quiz.id,
        actor,
        actionType: 'CREATED',
        fromStatus: null,
        toStatus: requestedStatus,
        notes: `Question authored by ${actor.name} (${actor.role}).`,
      });

      this.academicService.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'QUESTION_CREATED',
        targetType: 'question',
        targetId: quiz.id,
        details: { subjectId, topicId, subtopicId, qType, grade: quiz.grade, status: requestedStatus },
      });
    });

    return quiz;
  }

  public updateQuestionExtended(
    actor: UserAccount,
    questionId: string,
    payload: {
      subjectId?: string;
      topicId?: string;
      subtopicId?: string;
      grade?: string;
      questionType?: QuestionType;
      cognitiveSkill?: string;
      learningObjectives?: string;
      hint?: string;
      markingRule?: QuestionMarkingRule;
      acceptedAnswers?: string[];
      defaultMarks?: number;
      questionSi?: string;
      questionEn?: string;
      options?: string[];
      correctIndex?: number;
      imageUrl?: string | null;
      memoryTrickTitle?: string;
      memoryTrickBody?: string;
      explanation?: string;
      changeNote?: string;
      attributes?: Partial<QuizItem['attributes']>;
    }
  ): QuizItem {
    const existingRow = this.db
      .prepare('SELECT * FROM questions WHERE id = ? AND active = 1')
      .get(questionId) as Record<string, unknown> | undefined;
    if (!existingRow) {
      throw new HttpError(404, `Question ${questionId} not found.`);
    }

    const existing = rowToQuiz(existingRow);
    const ctx = this.academicService.buildAuthContext(actor);
    const perm = canActorModifyQuestion({ ctx, question: existing });
    if (!perm.canEdit) {
      throw new HttpError(403, perm.reason || 'Not authorized to edit this question.');
    }

    const nextSubjectId = payload.subjectId || resolveQuestionSubjectId(existing);
    if (actor.role === 'teacher' && !canAccessSubject(ctx, nextSubjectId)) {
      throw new HttpError(403, 'Cannot move question into an unassigned subject category.');
    }

    const nextType = payload.questionType || existing.questionType || 'mcq';
    const nextOptions: [string, string, string, string] = Array.isArray(payload.options)
      ? [
          String(payload.options[0] ?? ''),
          String(payload.options[1] ?? ''),
          String(payload.options[2] ?? ''),
          String(payload.options[3] ?? ''),
        ]
      : existing.options;

    const nextAccepted = Array.isArray(payload.acceptedAnswers)
      ? payload.acceptedAnswers.map((s) => String(s).trim()).filter(Boolean)
      : existing.acceptedAnswers || [];

    const nextAttrs = {
      ...existing.attributes,
      ...(payload.attributes || {}),
    };
    if (payload.attributes && !payload.attributes.difficultyTier) {
      nextAttrs.difficultyTier = classifyDifficultyTier(calculateQuizDifficultyScore(nextAttrs));
    }

    const nextVersion = (existing.version || 1) + 1;
    const now = new Date().toISOString();

    const updated: QuizItem = {
      ...existing,
      subjectId: nextSubjectId,
      topicId: payload.topicId || existing.topicId,
      subtopicId: payload.subtopicId || existing.subtopicId,
      version: nextVersion,
      grade: payload.grade || existing.grade || 'Grade 5',
      questionType: nextType,
      cognitiveSkill:
        payload.cognitiveSkill !== undefined ? payload.cognitiveSkill : existing.cognitiveSkill,
      learningObjectives:
        payload.learningObjectives !== undefined
          ? payload.learningObjectives
          : existing.learningObjectives,
      hint: payload.hint !== undefined ? payload.hint : existing.hint,
      markingRule: payload.markingRule !== undefined ? payload.markingRule : existing.markingRule,
      acceptedAnswers: nextAccepted,
      defaultMarks:
        payload.defaultMarks !== undefined
          ? Math.max(1, Number(payload.defaultMarks))
          : existing.defaultMarks || 1,
      questionSi: payload.questionSi !== undefined ? String(payload.questionSi).trim() : existing.questionSi,
      questionEn: payload.questionEn !== undefined ? String(payload.questionEn).trim() : existing.questionEn,
      options: nextOptions,
      correctIndex:
        payload.correctIndex !== undefined
          ? Math.max(0, Math.min(3, Number(payload.correctIndex)))
          : existing.correctIndex,
      imageUrl: payload.imageUrl === null ? undefined : payload.imageUrl ?? existing.imageUrl,
      memoryTrickTitle:
        payload.memoryTrickTitle !== undefined
          ? payload.memoryTrickTitle.trim()
          : existing.memoryTrickTitle,
      memoryTrickBody:
        payload.memoryTrickBody !== undefined
          ? payload.memoryTrickBody.trim()
          : existing.memoryTrickBody,
      explanation:
        payload.explanation !== undefined ? payload.explanation.trim() : existing.explanation,
      attributes: nextAttrs,
      updatedAt: now,
    };

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE questions SET
            subject_id = ?, topic_id = ?, subtopic_id = ?, version = ?, grade = ?,
            question_type = ?, cognitive_skill = ?, learning_objectives = ?, hint = ?,
            marking_rule_json = ?, accepted_answers_json = ?, default_marks = ?,
            question_si = ?, question_en = ?, options_json = ?, correct_index = ?,
            image_url = ?, memory_trick_title = ?, memory_trick_body = ?, explanation = ?,
            attributes_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          updated.subjectId!,
          updated.topicId!,
          updated.subtopicId!,
          nextVersion,
          updated.grade!,
          updated.questionType!,
          updated.cognitiveSkill || 'Application',
          updated.learningObjectives || '',
          updated.hint || '',
          JSON.stringify(updated.markingRule || {}),
          JSON.stringify(updated.acceptedAnswers || []),
          updated.defaultMarks!,
          updated.questionSi,
          updated.questionEn,
          JSON.stringify(updated.options),
          updated.correctIndex,
          updated.imageUrl || null,
          updated.memoryTrickTitle,
          updated.memoryTrickBody,
          updated.explanation,
          JSON.stringify(updated.attributes),
          now,
          questionId
        );

      this.db
        .prepare(
          `INSERT INTO question_versions (
            id, question_id, version, subject_id, topic_id, subtopic_id, snapshot_json, changed_by, change_note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `QV-${questionId}-v${nextVersion}`,
          questionId,
          nextVersion,
          updated.subjectId!,
          updated.topicId!,
          updated.subtopicId!,
          JSON.stringify(updated),
          actor.email,
          payload.changeNote || `Updated to v${nextVersion}`,
          now
        );

      this.academicService.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'QUESTION_UPDATED',
        targetType: 'question',
        targetId: questionId,
        details: { version: nextVersion, changeNote: payload.changeNote || '' },
      });
    });

    return updated;
  }

  public transitionQuestionStatus(
    actor: UserAccount,
    questionId: string,
    payload: {
      toStatus: QuestionApprovalStatus;
      notes?: string;
      replacedByQuestionId?: string | null;
    }
  ): QuizItem {
    const row = this.db
      .prepare('SELECT * FROM questions WHERE id = ? AND active = 1')
      .get(questionId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new HttpError(404, `Question ${questionId} not found.`);
    }
    const existing = rowToQuiz(row);
    const ctx = this.academicService.buildAuthContext(actor);
    if (!canAccessQuestion(ctx, existing)) {
      throw new HttpError(403, 'Access denied: question subject is outside your assigned permissions.');
    }

    const fromStatus = existing.approvalStatus || 'ACTIVE';
    const check = validateQuestionTransition({
      actorRole: actor.role,
      isAuthor: !existing.authorId || existing.authorId === actor.id,
      fromStatus,
      toStatus: payload.toStatus,
    });
    if (!check.ok) {
      throw new HttpError(403, check.reason || 'Transition not permitted.');
    }

    const replacementId = payload.replacedByQuestionId
      ? String(payload.replacedByQuestionId).trim()
      : null;
    if (payload.toStatus === 'RETIRED' && replacementId) {
      if (replacementId === questionId) {
        throw new HttpError(400, 'Replacement question cannot be the same question.');
      }
      const replacement = this.academicService.resolveQuizById(replacementId);
      if (!replacement) {
        throw new HttpError(404, `Replacement question ${replacementId} not found.`);
      }
      if (!canAccessQuestion(ctx, replacement)) {
        throw new HttpError(
          403,
          'Replacement question must belong to a subject within your authorization scope.'
        );
      }
      if (replacement.approvalStatus === 'RETIRED') {
        throw new HttpError(400, `Replacement question ${replacementId} is already RETIRED.`);
      }
    }

    const now = new Date().toISOString();
    const isAdminReview =
      actor.role === 'admin' &&
      (payload.toStatus === 'APPROVED' ||
        payload.toStatus === 'ACTIVE' ||
        payload.toStatus === 'REJECTED');

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE questions SET
            approval_status = ?,
            reviewer_id = COALESCE(?, reviewer_id),
            reviewer_name = COALESCE(?, reviewer_name),
            reviewed_at = COALESCE(?, reviewed_at),
            rejection_reason = ?,
            retired_at = ?,
            replaced_by_question_id = COALESCE(?, replaced_by_question_id),
            updated_at = ?
           WHERE id = ?`
        )
        .run(
          payload.toStatus,
          isAdminReview ? actor.id : null,
          isAdminReview ? actor.name : null,
          isAdminReview ? now : null,
          payload.toStatus === 'REJECTED' ? String(payload.notes || 'Needs revision') : null,
          payload.toStatus === 'RETIRED' ? now : null,
          replacementId,
          now,
          questionId
        );

      this.insertQuestionReviewAction({
        questionId,
        actor,
        actionType: `STATUS_${payload.toStatus}`,
        fromStatus,
        toStatus: payload.toStatus,
        notes: [String(payload.notes || ''), replacementId ? `Replaced by ${replacementId}` : '']
          .filter(Boolean)
          .join(' · '),
      });

      this.academicService.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'QUESTION_STATUS_CHANGED',
        targetType: 'question',
        targetId: questionId,
        details: {
          fromStatus,
          toStatus: payload.toStatus,
          replacedByQuestionId: replacementId,
          notes: payload.notes || '',
        },
      });
    });

    return rowToQuiz(
      this.db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId) as Record<
        string,
        unknown
      >
    );
  }

  public duplicateQuestion(actor: UserAccount, questionId: string): QuizItem {
    const source = this.academicService.resolveQuizById(questionId);
    if (!source) {
      throw new HttpError(404, `Question ${questionId} not found.`);
    }
    const ctx = this.academicService.buildAuthContext(actor);
    if (!canAccessQuestion(ctx, source)) {
      throw new HttpError(403, 'Access denied: cannot duplicate question outside your assigned subjects.');
    }

    return this.createQuestionExtended(actor, {
      subjectId: resolveQuestionSubjectId(source),
      topicId: source.topicId,
      subtopicId: source.subtopicId,
      grade: source.grade || 'Grade 5',
      questionType: source.questionType || 'mcq',
      cognitiveSkill: source.cognitiveSkill,
      learningObjectives: source.learningObjectives,
      hint: source.hint,
      markingRule: source.markingRule,
      acceptedAnswers: source.acceptedAnswers,
      defaultMarks: source.defaultMarks,
      approvalStatus: 'DRAFT',
      questionSi: `${source.questionSi} (Copy)`,
      questionEn: source.questionEn ? `${source.questionEn} (Copy)` : '',
      options: [...source.options],
      correctIndex: source.correctIndex,
      imageUrl: source.imageUrl,
      memoryTrickTitle: source.memoryTrickTitle,
      memoryTrickBody: source.memoryTrickBody,
      explanation: source.explanation,
      attributes: source.attributes,
    });
  }

  public bulkImportQuestions(
    actor: UserAccount,
    payload: {
      format: 'json' | 'csv';
      content: string;
      defaultSubjectId?: string;
      initialStatus?: QuestionApprovalStatus;
    }
  ) {
    if (actor.role === 'student') {
      throw new HttpError(403, 'Students cannot bulk import questions.');
    }
    const ctx = this.academicService.buildAuthContext(actor);
    const requestedDefaultStatus: QuestionApprovalStatus =
      payload.initialStatus || (actor.role === 'admin' ? 'ACTIVE' : 'DRAFT');

    if (
      actor.role === 'teacher' &&
      requestedDefaultStatus !== 'DRAFT' &&
      requestedDefaultStatus !== 'PENDING_REVIEW'
    ) {
      throw new HttpError(
        403,
        'Teachers can bulk import questions only as DRAFT or PENDING_REVIEW.'
      );
    }

    const parsed = parseBulkQuestionsPayload({
      format: payload.format,
      content: payload.content,
      defaultSubjectId: payload.defaultSubjectId,
      defaultStatus: requestedDefaultStatus,
    });

    const rowErrors = [...parsed.errors];
    const imported: QuizItem[] = [];

    for (const item of parsed.items) {
      if (actor.role === 'teacher' && !canAccessSubject(ctx, item.subjectId)) {
        rowErrors.push({
          rowNumber: item.rowNumber,
          error: `Subject ${item.subjectId} is outside your assigned teacher subjects.`,
        });
        continue;
      }
      const statusToApply: QuestionApprovalStatus =
        actor.role === 'teacher' &&
        item.initialStatus !== 'DRAFT' &&
        item.initialStatus !== 'PENDING_REVIEW'
          ? 'DRAFT'
          : item.initialStatus;

      try {
        const created = this.createQuestionExtended(actor, {
          subjectId: item.subjectId,
          topicId: item.topicId,
          subtopicId: item.subtopicId,
          grade: item.grade,
          questionType: item.questionType,
          cognitiveSkill: item.cognitiveSkill,
          learningObjectives: item.learningObjectives,
          hint: item.hint,
          markingRule: item.markingRule,
          acceptedAnswers: item.acceptedAnswers,
          defaultMarks: item.defaultMarks,
          approvalStatus: statusToApply,
          questionSi: item.questionSi,
          questionEn: item.questionEn,
          options: item.options,
          correctIndex: item.correctIndex,
          memoryTrickTitle: item.memoryTrickTitle,
          memoryTrickBody: item.memoryTrickBody,
          explanation: item.explanation,
          attributes: {
            estimatedSeconds: item.estimatedSeconds,
            difficultyTier: item.difficultyTier,
          },
        });
        imported.push(created);
      } catch (err) {
        rowErrors.push({
          rowNumber: item.rowNumber,
          error: (err as Error).message,
        });
      }
    }

    this.academicService.writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'QUESTIONS_BULK_IMPORTED',
      targetType: 'question_bank',
      targetId: payload.format,
      details: {
        importedCount: imported.length,
        errorCount: rowErrors.length,
        importedIds: imported.map((q) => q.id),
      },
    });

    return {
      importedCount: imported.length,
      importedQuestions: imported,
      errors: rowErrors,
    };
  }

  public getQuestionReviewHistory(ctx: AuthorizationContext, questionId: string): QuestionReviewActionRecord[] {
    const q = this.academicService.resolveQuizById(questionId);
    if (!q) {
      throw new HttpError(404, `Question ${questionId} not found.`);
    }
    if (!canAccessQuestion(ctx, q)) {
      throw new HttpError(403, 'Access denied to question outside your assigned subjects.');
    }
    const rows = this.db
      .prepare('SELECT * FROM question_review_actions WHERE question_id = ? ORDER BY created_at DESC')
      .all(questionId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      questionId: String(r.question_id),
      actorId: String(r.actor_id),
      actorName: String(r.actor_name),
      actorRole: String(r.actor_role) as QuestionReviewActionRecord['actorRole'],
      actionType: String(r.action_type),
      fromStatus: r.from_status ? (String(r.from_status) as QuestionApprovalStatus) : null,
      toStatus: String(r.to_status) as QuestionApprovalStatus,
      notes: String(r.notes || ''),
      createdAt: String(r.created_at),
    }));
  }

  private insertQuestionReviewAction(params: {
    questionId: string;
    actor: UserAccount;
    actionType: string;
    fromStatus: QuestionApprovalStatus | null;
    toStatus: QuestionApprovalStatus;
    notes: string;
  }) {
    this.db
      .prepare(
        `INSERT INTO question_review_actions (
          id, question_id, actor_id, actor_name, actor_role, action_type, from_status, to_status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `QRA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        params.questionId,
        params.actor.id,
        params.actor.name,
        params.actor.role,
        params.actionType,
        params.fromStatus,
        params.toStatus,
        params.notes,
        new Date().toISOString()
      );
  }

  // =========================================================================
  // 2. QUESTION SELECTION ENGINE & PRACTICE / MOCK ASSESSMENT BUILDER
  // =========================================================================

  private assertTeacherCanManageSubjects(ctx: AuthorizationContext, subjectIds: string[]) {
    if (ctx.role === 'student') {
      throw new HttpError(403, 'Students cannot create or manage assessments.');
    }
    if (ctx.role === 'teacher') {
      if (subjectIds.length === 0) {
        throw new HttpError(403, 'Teachers must select at least one assigned subject.');
      }
      for (const sid of subjectIds) {
        if (!canAccessSubject(ctx, sid)) {
          throw new HttpError(
            403,
            `Access denied: subject ${sid} is outside your assigned teacher permissions.`
          );
        }
      }
    }
  }

  public previewQuestionSelection(
    actor: UserAccount,
    params: {
      subjectIds: string[];
      topicIds?: string[];
      subtopicIds?: string[];
      grade?: string;
      questionTypes?: QuestionType[];
      cognitiveSkills?: string[];
      difficultyDistribution?: Partial<Record<DifficultyTier, number>>;
      count: number;
      mode: AssessmentSelectionMode;
      seed?: number;
      includeVirtualPool?: boolean;
      targetStudentId?: string;
      excludePreviouslyCorrect?: boolean;
      excludeRecentDays?: number;
    }
  ) {
    const ctx = this.academicService.buildAuthContext(actor);
    this.assertTeacherCanManageSubjects(ctx, params.subjectIds || []);

    const curated = this.academicService.listCuratedQuestions(ctx, false);
    const pool: QuizItem[] = [...curated];

    if (params.includeVirtualPool) {
      const targetSubjs = new Set(params.subjectIds || []);
      for (let i = 1; i <= 250; i++) {
        const vq = generateVirtualQuizFromPool(i);
        const hier = resolveDefaultHierarchyForQuestion(vq.id, vq.attributes.cognitiveDomain);
        const enriched: QuizItem = {
          ...vq,
          subjectId: hier.subjectId,
          topicId: hier.topicId,
          subtopicId: hier.subtopicId,
          version: 1,
          grade: 'Grade 5',
          questionType: 'mcq',
          approvalStatus: 'ACTIVE',
          defaultMarks: 1,
        };
        if (targetSubjs.size > 0 && !targetSubjs.has(enriched.subjectId!)) continue;
        if (!canAccessQuestion(ctx, enriched)) continue;
        pool.push(enriched);
      }
    }

    const excludedQuestionIds = new Set<string>();
    const topicWeaknessWeights = new Map<string, number>();

    if (params.targetStudentId) {
      if (params.excludePreviouslyCorrect) {
        const correctRows = this.db
          .prepare(
            `SELECT DISTINCT question_id FROM question_attempts
             WHERE student_id = ? AND submission_status = 'valid_answered' AND is_correct = 1`
          )
          .all(params.targetStudentId) as { question_id: string }[];
        for (const r of correctRows) excludedQuestionIds.add(r.question_id);
      }
      if (params.excludeRecentDays && params.excludeRecentDays > 0) {
        const cutoff = new Date(
          Date.now() - params.excludeRecentDays * 86_400_000
        ).toISOString();
        const recentRows = this.db
          .prepare(
            `SELECT DISTINCT question_id FROM question_attempts
             WHERE student_id = ? AND attempt_timestamp >= ?`
          )
          .all(params.targetStudentId, cutoff) as { question_id: string }[];
        for (const r of recentRows) excludedQuestionIds.add(r.question_id);
      }
      if (params.mode === 'adaptive_gap') {
        const topicStats = this.db
          .prepare(
            `SELECT topic_id,
              SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as wrong_cnt,
              COUNT(*) as total_cnt
             FROM question_attempts
             WHERE student_id = ? AND submission_status = 'valid_answered'
             GROUP BY topic_id`
          )
          .all(params.targetStudentId) as {
          topic_id: string;
          wrong_cnt: number;
          total_cnt: number;
        }[];
        for (const ts of topicStats) {
          topicWeaknessWeights.set(
            ts.topic_id,
            ts.total_cnt > 0 ? ts.wrong_cnt / ts.total_cnt : 0
          );
        }
      }
    }

    try {
      return selectQuestionsForAssessment({
        pool,
        ctx,
        subjectIds: params.subjectIds || [],
        topicIds: params.topicIds,
        subtopicIds: params.subtopicIds,
        grade: params.grade || 'Grade 5',
        questionTypes: params.questionTypes,
        cognitiveSkills: params.cognitiveSkills,
        difficultyDistribution: params.difficultyDistribution,
        count: Number(params.count || 5),
        mode: params.mode || 'deterministic',
        seed: Number(params.seed || Date.now()),
        includeDrafts: false,
        excludedQuestionIds,
        topicWeaknessWeights,
      });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  }

  public createAssessment(
    actor: UserAccount,
    payload: {
      kind: AssessmentKind;
      title: string;
      titleSi?: string;
      description?: string;
      instructions?: string;
      grade?: string;
      subjectIds: string[];
      topicIds?: string[];
      subtopicIds?: string[];
      selectionMode?: AssessmentSelectionMode;
      shuffleQuestions?: boolean;
      shuffleOptions?: boolean;
      showHints?: boolean;
      explanationTiming?: ExplanationTiming;
      timeLimitMinutes?: number | null;
      maxAttempts?: number;
      passMarkPercent?: number;
      availableFrom?: string | null;
      availableUntil?: string | null;
      scheduledFor?: string | null;
      status?: AssessmentStatus;
      config?: AssessmentConfig;
      sections: {
        title: string;
        instructions?: string;
        subjectId?: string | null;
        items: { questionId: string; marks?: number }[];
      }[];
      assignments?: { targetType: 'grade' | 'cohort' | 'student'; targetValue: string }[];
    }
  ): AssessmentRecord {
    const ctx = this.academicService.buildAuthContext(actor);
    const title = String(payload.title || '').trim();
    if (!title) {
      throw new HttpError(400, 'Assessment title is required.');
    }
    if (!Array.isArray(payload.sections) || payload.sections.length === 0) {
      throw new HttpError(400, 'At least one section with questions is required.');
    }

    const declaredSubjects = Array.from(new Set(payload.subjectIds || []));
    this.assertTeacherCanManageSubjects(ctx, declaredSubjects);

    const seenQIds = new Set<string>();
    const resolvedSections: {
      sectionId: string;
      sortOrder: number;
      title: string;
      instructions: string;
      subjectId: string | null;
      totalMarks: number;
      items: {
        question: QuizItem;
        marks: number;
        sortOrder: number;
      }[];
    }[] = [];

    let totalMarks = 0;
    let globalSort = 1;
    const allSubjectsUsed = new Set<string>(declaredSubjects);

    for (let sIdx = 0; sIdx < payload.sections.length; sIdx++) {
      const sec = payload.sections[sIdx];
      if (!Array.isArray(sec.items) || sec.items.length === 0) {
        throw new HttpError(400, `Section "${sec.title || sIdx + 1}" must include at least 1 question.`);
      }
      const secItems: { question: QuizItem; marks: number; sortOrder: number }[] = [];
      let secMarks = 0;

      for (const item of sec.items) {
        if (seenQIds.has(item.questionId)) {
          throw new HttpError(
            400,
            `Duplicate question ${item.questionId} detected across assessment sections.`
          );
        }
        seenQIds.add(item.questionId);

        const q = this.academicService.resolveQuizById(item.questionId);
        if (!q) {
          throw new HttpError(404, `Selected question ${item.questionId} was not found.`);
        }
        const qSubj = resolveQuestionSubjectId(q);
        if (ctx.role === 'teacher' && !canAccessSubject(ctx, qSubj)) {
          throw new HttpError(
            403,
            `Access denied: question ${q.id} belongs to unassigned subject ${qSubj}.`
          );
        }
        const status = q.approvalStatus || 'ACTIVE';
        if (status !== 'APPROVED' && status !== 'ACTIVE') {
          throw new HttpError(
            400,
            `Question ${q.id} has status ${status}. Only APPROVED or ACTIVE questions may be added to an assessment.`
          );
        }

        allSubjectsUsed.add(qSubj);
        const marks = Math.max(1, Number(item.marks ?? q.defaultMarks ?? 1));
        secMarks += marks;
        secItems.push({ question: q, marks, sortOrder: globalSort++ });
      }

      totalMarks += secMarks;
      resolvedSections.push({
        sectionId: `SEC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        sortOrder: sIdx + 1,
        title: String(sec.title || `Section ${sIdx + 1}`).trim(),
        instructions: String(sec.instructions || '').trim(),
        subjectId: sec.subjectId || null,
        totalMarks: secMarks,
        items: secItems,
      });
    }

    const prefix = payload.kind === 'practice_session' ? 'PRC' : 'ASM';
    const assessmentId = `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const initialStatus: AssessmentStatus = payload.status || 'DRAFT';
    const finalSubjects = Array.from(allSubjectsUsed);

    this.assertTeacherCanManageSubjects(ctx, finalSubjects);

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO assessments (
            id, kind, title, title_si, description, instructions, grade, subject_ids_json,
            topic_ids_json, subtopic_ids_json, author_id, author_name, author_role,
            reviewer_id, reviewer_name, status, selection_mode, shuffle_questions,
            shuffle_options, show_hints, explanation_timing, time_limit_minutes, max_attempts,
            total_marks, pass_mark_percent, available_from, available_until, scheduled_for,
            results_released_at, current_version, config_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
        )
        .run(
          assessmentId,
          payload.kind,
          title,
          String(payload.titleSi || title).trim(),
          String(payload.description || '').trim(),
          String(payload.instructions || '').trim(),
          String(payload.grade || 'Grade 5').trim(),
          JSON.stringify(finalSubjects),
          JSON.stringify(payload.topicIds || []),
          JSON.stringify(payload.subtopicIds || []),
          actor.id,
          actor.name,
          actor.role,
          actor.role === 'admin' && (initialStatus === 'PUBLISHED' || initialStatus === 'ACTIVE')
            ? actor.id
            : null,
          actor.role === 'admin' && (initialStatus === 'PUBLISHED' || initialStatus === 'ACTIVE')
            ? actor.name
            : null,
          initialStatus,
          payload.selectionMode || 'manual',
          payload.shuffleQuestions ? 1 : 0,
          payload.shuffleOptions ? 1 : 0,
          payload.showHints !== false ? 1 : 0,
          payload.explanationTiming ||
            (payload.kind === 'practice_session' ? 'immediate' : 'after_submit'),
          payload.timeLimitMinutes ?? (payload.kind === 'mock_exam' ? 20 : null),
          Math.max(1, Number(payload.maxAttempts ?? (payload.kind === 'practice_session' ? 5 : 1))),
          totalMarks,
          Math.max(0, Math.min(100, Number(payload.passMarkPercent ?? 50))),
          payload.availableFrom || null,
          payload.availableUntil || null,
          payload.scheduledFor || null,
          null,
          JSON.stringify(payload.config || {}),
          now,
          now
        );

      const insSec = this.db.prepare(
        `INSERT INTO assessment_sections (id, assessment_id, version_number, sort_order, title, instructions, subject_id, total_marks)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
      );
      const insSnap = this.db.prepare(
        `INSERT INTO assessment_question_snapshots (id, assessment_id, version_number, section_id, sort_order, question_id, question_version, marks, snapshot_json)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`
      );

      for (const sec of resolvedSections) {
        insSec.run(
          sec.sectionId,
          assessmentId,
          sec.sortOrder,
          sec.title,
          sec.instructions,
          sec.subjectId,
          sec.totalMarks
        );
        for (const item of sec.items) {
          insSnap.run(
            `SNAP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
            assessmentId,
            sec.sectionId,
            item.sortOrder,
            item.question.id,
            item.question.version || 1,
            item.marks,
            JSON.stringify(item.question)
          );
        }
      }

      const assignments =
        payload.assignments && payload.assignments.length > 0
          ? payload.assignments
          : [{ targetType: 'grade' as const, targetValue: String(payload.grade || 'Grade 5') }];
      const insAsgn = this.db.prepare(
        `INSERT INTO assessment_assignments (id, assessment_id, target_type, target_value, assigned_by, assigned_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const a of assignments) {
        insAsgn.run(
          `AASN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          assessmentId,
          a.targetType,
          a.targetValue,
          actor.id,
          now
        );
      }

      this.academicService.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'ASSESSMENT_CREATED',
        targetType: payload.kind,
        targetId: assessmentId,
        details: {
          title,
          subjectIds: finalSubjects,
          questionCount: seenQIds.size,
          totalMarks,
          status: initialStatus,
        },
      });
    });

    return this.getAssessmentDetailScoped(actor, assessmentId).assessment;
  }

  public listAssessmentsScoped(
    actor: UserAccount,
    filters: { kind?: string; status?: string; subjectId?: string; grade?: string } = {}
  ): AssessmentRecord[] {
    if (actor.role === 'student') {
      throw new HttpError(403, 'Use student assessment endpoint for student catalog.');
    }
    const ctx = this.academicService.buildAuthContext(actor);
    if (
      ctx.role === 'teacher' &&
      filters.subjectId &&
      filters.subjectId !== 'All' &&
      !canAccessSubject(ctx, filters.subjectId)
    ) {
      throw new HttpError(403, 'Access denied for unassigned subject category.');
    }

    const rows = this.db
      .prepare('SELECT * FROM assessments ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[];

    const list: AssessmentRecord[] = [];
    for (const r of rows) {
      const rec = this.hydrateAssessmentRow(r);
      if (ctx.role === 'teacher') {
        const allAuthorized =
          rec.subjectIds.length > 0 &&
          rec.subjectIds.every((sid) => canAccessSubject(ctx, sid));
        if (!allAuthorized) continue;
      }
      if (filters.kind && filters.kind !== 'All' && rec.kind !== filters.kind) continue;
      if (filters.status && filters.status !== 'All' && rec.status !== filters.status) continue;
      if (filters.grade && filters.grade !== 'All' && rec.grade !== filters.grade) continue;
      if (
        filters.subjectId &&
        filters.subjectId !== 'All' &&
        !rec.subjectIds.includes(filters.subjectId)
      ) {
        continue;
      }
      list.push(rec);
    }
    return list;
  }

  public getAssessmentDetailScoped(actor: UserAccount, assessmentId: string) {
    if (actor.role === 'student') {
      throw new HttpError(403, 'Authoring details are restricted to teachers and administrators.');
    }
    const row = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new HttpError(404, `Assessment ${assessmentId} not found.`);
    }
    const assessment = this.hydrateAssessmentRow(row);
    const ctx = this.academicService.buildAuthContext(actor);
    if (ctx.role === 'teacher') {
      const allAuthorized =
        assessment.subjectIds.length > 0 &&
        assessment.subjectIds.every((sid) => canAccessSubject(ctx, sid));
      if (!allAuthorized) {
        throw new HttpError(
          403,
          'Access denied: assessment includes subjects outside your current teacher assignments.'
        );
      }
    }

    const snapshots = this.getAssessmentSnapshots(assessmentId, assessment.currentVersion);
    return {
      assessment,
      snapshots,
    };
  }

  public updateDraftAssessment(
    actor: UserAccount,
    assessmentId: string,
    payload: {
      title?: string;
      titleSi?: string;
      description?: string;
      instructions?: string;
      grade?: string;
      subjectIds?: string[];
      topicIds?: string[];
      subtopicIds?: string[];
      selectionMode?: AssessmentSelectionMode;
      shuffleQuestions?: boolean;
      shuffleOptions?: boolean;
      showHints?: boolean;
      explanationTiming?: ExplanationTiming;
      timeLimitMinutes?: number | null;
      maxAttempts?: number;
      passMarkPercent?: number;
      availableFrom?: string | null;
      availableUntil?: string | null;
      scheduledFor?: string | null;
      config?: AssessmentConfig;
      sections?: {
        title: string;
        instructions?: string;
        subjectId?: string | null;
        items: { questionId: string; marks?: number }[];
      }[];
      assignments?: { targetType: 'grade' | 'cohort' | 'student'; targetValue: string }[];
    }
  ): AssessmentRecord {
    const { assessment } = this.getAssessmentDetailScoped(actor, assessmentId);
    if (actor.role === 'teacher' && assessment.authorId !== actor.id) {
      throw new HttpError(403, 'Teachers can only edit assessments they authored.');
    }
    if (assessment.status !== 'DRAFT' && assessment.status !== 'VALIDATED') {
      throw new HttpError(
        400,
        `Cannot edit an assessment in ${assessment.status} status. Duplicate it into a new DRAFT first.`
      );
    }

    const ctx = this.academicService.buildAuthContext(actor);
    const nextSubjects = payload.subjectIds
      ? Array.from(new Set(payload.subjectIds))
      : assessment.subjectIds;
    this.assertTeacherCanManageSubjects(ctx, nextSubjects);

    const now = new Date().toISOString();
    let totalMarks = assessment.totalMarks;
    const allSubjectsUsed = new Set<string>(nextSubjects);
    const resolvedSections: {
      sectionId: string;
      sortOrder: number;
      title: string;
      instructions: string;
      subjectId: string | null;
      totalMarks: number;
      items: { question: QuizItem; marks: number; sortOrder: number }[];
    }[] = [];

    if (Array.isArray(payload.sections)) {
      if (payload.sections.length === 0) {
        throw new HttpError(400, 'At least one section with questions is required.');
      }
      totalMarks = 0;
      let globalSort = 1;
      const seenQIds = new Set<string>();
      for (let sIdx = 0; sIdx < payload.sections.length; sIdx++) {
        const sec = payload.sections[sIdx];
        if (!Array.isArray(sec.items) || sec.items.length === 0) {
          throw new HttpError(400, `Section "${sec.title || sIdx + 1}" must include at least 1 question.`);
        }
        const secItems: { question: QuizItem; marks: number; sortOrder: number }[] = [];
        let secMarks = 0;
        for (const item of sec.items) {
          if (seenQIds.has(item.questionId)) {
            throw new HttpError(400, `Duplicate question ${item.questionId} detected across sections.`);
          }
          seenQIds.add(item.questionId);
          const q = this.academicService.resolveQuizById(item.questionId);
          if (!q) throw new HttpError(404, `Question ${item.questionId} not found.`);
          const qSubj = resolveQuestionSubjectId(q);
          if (ctx.role === 'teacher' && !canAccessSubject(ctx, qSubj)) {
            throw new HttpError(403, `Access denied: question ${q.id} belongs to unassigned subject ${qSubj}.`);
          }
          const st = q.approvalStatus || 'ACTIVE';
          if (st !== 'APPROVED' && st !== 'ACTIVE') {
            throw new HttpError(400, `Question ${q.id} is ${st}. Only APPROVED or ACTIVE questions allowed.`);
          }
          allSubjectsUsed.add(qSubj);
          const marks = Math.max(1, Number(item.marks ?? q.defaultMarks ?? 1));
          secMarks += marks;
          secItems.push({ question: q, marks, sortOrder: globalSort++ });
        }
        totalMarks += secMarks;
        resolvedSections.push({
          sectionId: `SEC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          sortOrder: sIdx + 1,
          title: String(sec.title || `Section ${sIdx + 1}`).trim(),
          instructions: String(sec.instructions || '').trim(),
          subjectId: sec.subjectId || null,
          totalMarks: secMarks,
          items: secItems,
        });
      }
    }

    const finalSubjects = Array.from(allSubjectsUsed);
    this.assertTeacherCanManageSubjects(ctx, finalSubjects);

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE assessments SET
            title = ?, title_si = ?, description = ?, instructions = ?, grade = ?,
            subject_ids_json = ?, topic_ids_json = ?, subtopic_ids_json = ?,
            selection_mode = ?, shuffle_questions = ?, shuffle_options = ?, show_hints = ?,
            explanation_timing = ?, time_limit_minutes = ?, max_attempts = ?, total_marks = ?,
            pass_mark_percent = ?, available_from = ?, available_until = ?, scheduled_for = ?,
            config_json = ?, status = 'DRAFT', updated_at = ?
           WHERE id = ?`
        )
        .run(
          payload.title !== undefined ? String(payload.title).trim() : assessment.title,
          payload.titleSi !== undefined ? String(payload.titleSi).trim() : assessment.titleSi,
          payload.description !== undefined ? String(payload.description).trim() : assessment.description,
          payload.instructions !== undefined ? String(payload.instructions).trim() : assessment.instructions,
          payload.grade !== undefined ? String(payload.grade).trim() : assessment.grade,
          JSON.stringify(finalSubjects),
          JSON.stringify(payload.topicIds ?? assessment.topicIds),
          JSON.stringify(payload.subtopicIds ?? assessment.subtopicIds),
          payload.selectionMode ?? assessment.selectionMode,
          (payload.shuffleQuestions ?? assessment.shuffleQuestions) ? 1 : 0,
          (payload.shuffleOptions ?? assessment.shuffleOptions) ? 1 : 0,
          (payload.showHints ?? assessment.showHints) ? 1 : 0,
          payload.explanationTiming ?? assessment.explanationTiming,
          payload.timeLimitMinutes !== undefined ? payload.timeLimitMinutes : assessment.timeLimitMinutes,
          payload.maxAttempts !== undefined ? Math.max(1, Number(payload.maxAttempts)) : assessment.maxAttempts,
          totalMarks,
          payload.passMarkPercent !== undefined
            ? Math.max(0, Math.min(100, Number(payload.passMarkPercent)))
            : assessment.passMarkPercent,
          payload.availableFrom !== undefined ? payload.availableFrom : assessment.availableFrom,
          payload.availableUntil !== undefined ? payload.availableUntil : assessment.availableUntil,
          payload.scheduledFor !== undefined ? payload.scheduledFor : assessment.scheduledFor,
          JSON.stringify(payload.config ?? assessment.config),
          now,
          assessmentId
        );

      if (resolvedSections.length > 0) {
        this.db
          .prepare('DELETE FROM assessment_question_snapshots WHERE assessment_id = ? AND version_number = ?')
          .run(assessmentId, assessment.currentVersion);
        this.db
          .prepare('DELETE FROM assessment_sections WHERE assessment_id = ? AND version_number = ?')
          .run(assessmentId, assessment.currentVersion);

        const insSec = this.db.prepare(
          `INSERT INTO assessment_sections (id, assessment_id, version_number, sort_order, title, instructions, subject_id, total_marks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const insSnap = this.db.prepare(
          `INSERT INTO assessment_question_snapshots (id, assessment_id, version_number, section_id, sort_order, question_id, question_version, marks, snapshot_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        for (const sec of resolvedSections) {
          insSec.run(
            sec.sectionId,
            assessmentId,
            assessment.currentVersion,
            sec.sortOrder,
            sec.title,
            sec.instructions,
            sec.subjectId,
            sec.totalMarks
          );
          for (const item of sec.items) {
            insSnap.run(
              `SNAP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
              assessmentId,
              assessment.currentVersion,
              sec.sectionId,
              item.sortOrder,
              item.question.id,
              item.question.version || 1,
              item.marks,
              JSON.stringify(item.question)
            );
          }
        }
      }

      if (Array.isArray(payload.assignments) && payload.assignments.length > 0) {
        this.db.prepare('DELETE FROM assessment_assignments WHERE assessment_id = ?').run(assessmentId);
        const insAsgn = this.db.prepare(
          `INSERT INTO assessment_assignments (id, assessment_id, target_type, target_value, assigned_by, assigned_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const a of payload.assignments) {
          insAsgn.run(
            `AASN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            assessmentId,
            a.targetType,
            a.targetValue,
            actor.id,
            now
          );
        }
      }

      this.academicService.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'ASSESSMENT_DRAFT_UPDATED',
        targetType: assessment.kind,
        targetId: assessmentId,
        details: { totalMarks, questionCount: resolvedSections.reduce((a, s) => a + s.items.length, 0) },
      });
    });

    return this.getAssessmentDetailScoped(actor, assessmentId).assessment;
  }

  public transitionAssessmentStatus(
    actor: UserAccount,
    assessmentId: string,
    payload: { toStatus: AssessmentStatus; scheduledFor?: string | null; notes?: string }
  ): AssessmentRecord {
    const { assessment } = this.getAssessmentDetailScoped(actor, assessmentId);
    const check = validateAssessmentTransition({
      actorRole: actor.role,
      isAuthor: assessment.authorId === actor.id,
      fromStatus: assessment.status,
      toStatus: payload.toStatus,
    });
    if (!check.ok) {
      throw new HttpError(403, check.reason || 'Assessment status transition not permitted.');
    }

    if (
      (payload.toStatus === 'PUBLISHED' ||
        payload.toStatus === 'ACTIVE' ||
        payload.toStatus === 'VALIDATED') &&
      assessment.questionCount === 0
    ) {
      throw new HttpError(400, 'Cannot validate or publish an assessment with zero questions.');
    }

    const now = new Date().toISOString();
    const isReleasing = payload.toStatus === 'RESULTS_RELEASED';

    this.dbWrapper.transaction(() => {
      this.db
        .prepare(
          `UPDATE assessments SET
            status = ?,
            scheduled_for = COALESCE(?, scheduled_for),
            results_released_at = CASE WHEN ? = 1 THEN ? ELSE results_released_at END,
            reviewer_id = COALESCE(reviewer_id, ?),
            reviewer_name = COALESCE(reviewer_name, ?),
            updated_at = ?
           WHERE id = ?`
        )
        .run(
          payload.toStatus,
          payload.scheduledFor || null,
          isReleasing ? 1 : 0,
          now,
          actor.role === 'admin' ? actor.id : null,
          actor.role === 'admin' ? actor.name : null,
          now,
          assessmentId
        );

      if (isReleasing) {
        const participantRows = this.db
          .prepare(
            `SELECT DISTINCT student_id FROM assessment_attempts WHERE assessment_id = ? AND status != 'in_progress'`
          )
          .all(assessmentId) as { student_id: string }[];
        for (const p of participantRows) {
          this.academicService.insertNotificationRow({
            recipientUserId: p.student_id,
            recipientRole: 'student',
            channel: 'in_app',
            category: 'progress_report',
            title: `Results Released · ${assessment.title}`,
            body: `Your graded marks and explanations for "${assessment.title}" are now available to review.`,
            relatedStudentId: p.student_id,
            relatedSubjectId: assessment.subjectIds[0],
            dedupeKey: `asm-release-${assessmentId}-${p.student_id}`,
            deliveryStatus: 'delivered',
          });
        }
      }

      this.academicService.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: `ASSESSMENT_${payload.toStatus}`,
        targetType: assessment.kind,
        targetId: assessmentId,
        details: { fromStatus: assessment.status, toStatus: payload.toStatus, notes: payload.notes || '' },
      });
    });

    return this.getAssessmentDetailScoped(actor, assessmentId).assessment;
  }

  public duplicateAssessment(actor: UserAccount, assessmentId: string): AssessmentRecord {
    const { assessment, snapshots } = this.getAssessmentDetailScoped(actor, assessmentId);
    const bySection = new Map<string, { questionId: string; marks: number }[]>();
    for (const s of snapshots) {
      const list = bySection.get(s.sectionId) || [];
      list.push({ questionId: s.questionId, marks: s.marks });
      bySection.set(s.sectionId, list);
    }

    return this.createAssessment(actor, {
      kind: assessment.kind,
      title: `${assessment.title} (Copy)`,
      titleSi: `${assessment.titleSi} (පිටපත)`,
      description: assessment.description,
      instructions: assessment.instructions,
      grade: assessment.grade,
      subjectIds: assessment.subjectIds,
      topicIds: assessment.topicIds,
      subtopicIds: assessment.subtopicIds,
      selectionMode: assessment.selectionMode,
      shuffleQuestions: assessment.shuffleQuestions,
      shuffleOptions: assessment.shuffleOptions,
      showHints: assessment.showHints,
      explanationTiming: assessment.explanationTiming,
      timeLimitMinutes: assessment.timeLimitMinutes,
      maxAttempts: assessment.maxAttempts,
      passMarkPercent: assessment.passMarkPercent,
      status: 'DRAFT',
      config: assessment.config,
      sections: assessment.sections.map((sec) => ({
        title: sec.title,
        instructions: sec.instructions,
        subjectId: sec.subjectId,
        items: bySection.get(sec.id) || [],
      })),
    });
  }

  public createAssessmentNewVersion(actor: UserAccount, assessmentId: string): AssessmentRecord {
    const { assessment, snapshots } = this.getAssessmentDetailScoped(actor, assessmentId);
    if (actor.role === 'teacher' && assessment.authorId !== actor.id) {
      throw new HttpError(403, 'Teachers can only create new versions for assessments they authored.');
    }
    if (assessment.status === 'DRAFT' || assessment.status === 'VALIDATED') {
      throw new HttpError(
        400,
        'This assessment version is already in an editable DRAFT/VALIDATED state.'
      );
    }

    const ctx = this.academicService.buildAuthContext(actor);
    this.assertTeacherCanManageSubjects(ctx, assessment.subjectIds);

    const prevVersion = assessment.currentVersion;
    const nextVersion = prevVersion + 1;
    const now = new Date().toISOString();

    this.dbWrapper.transaction(() => {
      const sectionIdMap = new Map<string, string>();
      const insSec = this.db.prepare(
        `INSERT INTO assessment_sections (id, assessment_id, version_number, sort_order, title, instructions, subject_id, total_marks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const sec of assessment.sections) {
        const newSecId = `SEC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        sectionIdMap.set(sec.id, newSecId);
        insSec.run(
          newSecId,
          assessmentId,
          nextVersion,
          sec.sortOrder,
          sec.title,
          sec.instructions,
          sec.subjectId,
          sec.totalMarks
        );
      }

      const insSnap = this.db.prepare(
        `INSERT INTO assessment_question_snapshots (id, assessment_id, version_number, section_id, sort_order, question_id, question_version, marks, snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const snap of snapshots) {
        const mappedSecId = sectionIdMap.get(snap.sectionId) || snap.sectionId;
        insSnap.run(
          `SNAP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          assessmentId,
          nextVersion,
          mappedSecId,
          snap.sortOrder,
          snap.questionId,
          snap.questionVersion,
          snap.marks,
          JSON.stringify(snap.snapshot)
        );
      }

      this.db
        .prepare(
          `UPDATE assessments SET
            current_version = ?,
            status = 'DRAFT',
            results_released_at = NULL,
            updated_at = ?
           WHERE id = ?`
        )
        .run(nextVersion, now, assessmentId);

      this.academicService.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'ASSESSMENT_NEW_VERSION_CREATED',
        targetType: assessment.kind,
        targetId: assessmentId,
        details: { fromVersion: prevVersion, toVersion: nextVersion },
      });
    });

    return this.getAssessmentDetailScoped(actor, assessmentId).assessment;
  }

  public exportAssessmentPrintable(
    actor: UserAccount,
    assessmentId: string,
    includeAnswerKey = false
  ) {
    const { assessment, snapshots } = this.getAssessmentDetailScoped(actor, assessmentId);
    return {
      assessment,
      exportedAt: new Date().toISOString(),
      exportedBy: actor.name,
      sections: assessment.sections.map((sec) => ({
        ...sec,
        questions: snapshots
          .filter((s) => s.sectionId === sec.id)
          .map((s) => ({
            order: s.sortOrder,
            questionId: s.questionId,
            questionVersion: s.questionVersion,
            marks: s.marks,
            questionType: s.snapshot.questionType || 'mcq',
            questionSi: s.snapshot.questionSi,
            questionEn: s.snapshot.questionEn,
            options: s.snapshot.options,
            imageUrl: s.snapshot.imageUrl,
            ...(includeAnswerKey
              ? {
                  correctIndex: s.snapshot.correctIndex,
                  acceptedAnswers: s.snapshot.acceptedAnswers,
                  markingRule: s.snapshot.markingRule,
                  explanation: s.snapshot.explanation,
                }
              : {}),
          })),
      })),
    };
  }

  // =========================================================================
  // 3. STUDENT ASSESSMENT PARTICIPATION, RESUMABLE TIMING & SUBMISSION
  // =========================================================================

  public listStudentAssessments(student: UserAccount) {
    const rows = this.db
      .prepare(
        `SELECT * FROM assessments
         WHERE status IN ('PUBLISHED','ACTIVE','CLOSED','RESULTS_RELEASED')
         ORDER BY updated_at DESC`
      )
      .all() as Record<string, unknown>[];

    const attemptsRows = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE student_id = ? ORDER BY attempt_number DESC')
      .all(student.id) as Record<string, unknown>[];
    const attemptsByAsm = new Map<string, AssessmentAttemptRecord[]>();
    for (const ar of attemptsRows) {
      const att = this.hydrateAttemptRow(ar);
      const list = attemptsByAsm.get(att.assessmentId) || [];
      list.push(att);
      attemptsByAsm.set(att.assessmentId, list);
    }

    const stuGrade = student.grade || 'Grade 5';
    const result = [];

    for (const r of rows) {
      const rec = this.hydrateAssessmentRow(r);
      const targeted =
        rec.assignments.length === 0 ||
        rec.assignments.some(
          (a) =>
            (a.targetType === 'grade' && (a.targetValue === stuGrade || a.targetValue === 'All')) ||
            (a.targetType === 'student' && a.targetValue === student.id) ||
            a.targetType === 'cohort'
        );
      if (!targeted) continue;

      const myAttempts = attemptsByAsm.get(rec.id) || [];
      const inProgress = myAttempts.find((a) => a.status === 'in_progress') || null;
      const latestCompleted = myAttempts.find((a) => a.status !== 'in_progress') || null;
      const canShowScore =
        latestCompleted &&
        (rec.explanationTiming !== 'after_release' || rec.status === 'RESULTS_RELEASED');

      result.push({
        ...rec,
        myAttemptCount: myAttempts.length,
        inProgressAttemptId: inProgress?.id || null,
        latestAttemptId: latestCompleted?.id || null,
        latestAttemptStatus: latestCompleted?.status || null,
        latestScorePercent: canShowScore ? latestCompleted.scorePercent : null,
        latestAwardedMarks: canShowScore ? latestCompleted.totalAwardedMarks : null,
      });
    }

    return result;
  }

  public startOrResumeAssessmentAttempt(student: UserAccount, assessmentId: string) {
    const row = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new HttpError(404, 'Assessment not found.');
    }
    const assessment = this.hydrateAssessmentRow(row);
    if (assessment.status !== 'PUBLISHED' && assessment.status !== 'ACTIVE') {
      throw new HttpError(
        403,
        `Assessment "${assessment.title}" is currently ${assessment.status} and cannot be started.`
      );
    }

    const nowMs = Date.now();
    if (assessment.availableFrom && nowMs < Date.parse(assessment.availableFrom)) {
      throw new HttpError(403, 'This assessment is not yet open for student attempts.');
    }
    if (assessment.availableUntil && nowMs > Date.parse(assessment.availableUntil)) {
      throw new HttpError(403, 'The availability window for this assessment has closed.');
    }

    const snapshots = this.getAssessmentSnapshots(assessmentId, assessment.currentVersion);
    if (snapshots.length === 0) {
      throw new HttpError(400, 'This assessment has no questions configured.');
    }

    // Check existing in-progress attempt first (resume cleanly OR auto-close if expired)
    const inProgRow = this.db
      .prepare(
        `SELECT * FROM assessment_attempts
         WHERE assessment_id = ? AND student_id = ? AND status = 'in_progress'
         ORDER BY attempt_number DESC LIMIT 1`
      )
      .get(assessmentId, student.id) as Record<string, unknown> | undefined;

    if (inProgRow) {
      const existingAttempt = this.hydrateAttemptRow(inProgRow);
      if (existingAttempt.expiresAt && nowMs > Date.parse(existingAttempt.expiresAt)) {
        // Auto-submit expired in-progress session before enforcing maxAttempts
        this.finalizeAttemptInternal({
          student,
          assessment,
          attempt: existingAttempt,
          snapshots,
          submittedAnswers: [],
          perQuestionDurationsMs: {},
          hintUsedQuestionIds: [],
          timedOut: true,
        });
      } else {
        const snapMap = new Map(snapshots.map((s) => [s.id, s]));
        const orderedItems = existingAttempt.shuffledOrder
          .map((sid) => snapMap.get(sid))
          .filter(Boolean) as AssessmentSnapshotItem[];
        const studentQuestions = orderedItems.map((s) =>
          this.buildSanitizedQuestionFromAttempt(s, existingAttempt, assessment.showHints)
        );
        const savedRows = this.db
          .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?')
          .all(existingAttempt.id) as Record<string, unknown>[];
        const savedAnswers = savedRows.map((ar) => ({
          snapshotId: String(ar.snapshot_id),
          questionId: String(ar.question_id),
          submittedOptionIndex:
            ar.submitted_option_index === null || ar.submitted_option_index === undefined
              ? null
              : Number(ar.submitted_option_index),
          submittedAnswerText: ar.submitted_answer_text ? String(ar.submitted_answer_text) : null,
        }));
        const timeLimitSeconds = assessment.timeLimitMinutes
          ? assessment.timeLimitMinutes * 60
          : 0;
        const secondsRemaining = existingAttempt.expiresAt
          ? Math.max(0, Math.round((Date.parse(existingAttempt.expiresAt) - nowMs) / 1000))
          : timeLimitSeconds;

        return {
          resumed: true,
          attempt: existingAttempt,
          assessment,
          sections: assessment.sections,
          questions: studentQuestions,
          savedAnswers,
          timeLimitSeconds,
          secondsRemaining,
        };
      }
    }

    const totalCompleted = (
      this.db
        .prepare('SELECT COUNT(*) as cnt FROM assessment_attempts WHERE assessment_id = ? AND student_id = ?')
        .get(assessmentId, student.id) as { cnt: number }
    ).cnt;

    if (totalCompleted >= assessment.maxAttempts) {
      throw new HttpError(
        403,
        `Attempt limit reached (${assessment.maxAttempts}/${assessment.maxAttempts} used).`
      );
    }

    const attemptNumber = totalCompleted + 1;
    const seed =
      crypto.createHash('sha256').update(`${assessmentId}:${student.id}:${attemptNumber}`).digest().readUInt32BE(0);
    const plan = buildAttemptDeliveryOrder({
      items: snapshots.map((s) => ({
        snapshotId: s.id,
        sectionId: s.sectionId,
        marks: s.marks,
        snapshot: s.snapshot,
      })),
      shuffleQuestions: assessment.shuffleQuestions,
      shuffleOptions: assessment.shuffleOptions,
      showHints: assessment.showHints,
      seed,
    });

    const attemptId = `AATT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const startedAt = new Date(nowMs).toISOString();
    const timeLimitSeconds = assessment.timeLimitMinutes ? assessment.timeLimitMinutes * 60 : 0;
    const expiresAt =
      timeLimitSeconds > 0 ? new Date(nowMs + timeLimitSeconds * 1000).toISOString() : null;

    const newAttempt: AssessmentAttemptRecord = {
      id: attemptId,
      assessmentId,
      assessmentVersion: assessment.currentVersion,
      studentId: student.id,
      attemptNumber,
      status: 'in_progress',
      startedAt,
      expiresAt,
      submittedAt: null,
      serverDurationSeconds: 0,
      shuffledOrder: plan.shuffledSnapshotIds,
      shuffledOptionsMap: plan.shuffledOptionsMap,
      autoScore: 0,
      manualScore: 0,
      totalAwardedMarks: 0,
      maxMarks: assessment.totalMarks,
      scorePercent: null,
      idempotencyKey: `start-${attemptId}`,
    };

    this.db
      .prepare(
        `INSERT INTO assessment_attempts (
          id, assessment_id, assessment_version, student_id, attempt_number, status,
          started_at, expires_at, server_duration_seconds, shuffled_order_json,
          shuffled_options_map_json, auto_score, manual_score, total_awarded_marks,
          max_marks, score_percent, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, 0, ?, ?, 0, 0, 0, ?, NULL, ?)`
      )
      .run(
        newAttempt.id,
        newAttempt.assessmentId,
        newAttempt.assessmentVersion,
        newAttempt.studentId,
        newAttempt.attemptNumber,
        newAttempt.startedAt,
        newAttempt.expiresAt,
        JSON.stringify(newAttempt.shuffledOrder),
        JSON.stringify(newAttempt.shuffledOptionsMap),
        newAttempt.maxMarks,
        newAttempt.idempotencyKey
      );

    return {
      resumed: false,
      attempt: newAttempt,
      assessment,
      sections: assessment.sections,
      questions: plan.studentQuestions,
      savedAnswers: [],
      timeLimitSeconds,
      secondsRemaining: timeLimitSeconds,
    };
  }

  public saveAssessmentProgress(
    student: UserAccount,
    assessmentId: string,
    payload: {
      attemptId: string;
      answers: {
        snapshotId: string;
        questionId: string;
        submittedOptionIndex?: number | null;
        submittedAnswerText?: string | null;
      }[];
    }
  ) {
    const attemptRow = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE id = ? AND assessment_id = ?')
      .get(payload.attemptId, assessmentId) as Record<string, unknown> | undefined;
    if (!attemptRow) {
      throw new HttpError(404, 'Assessment attempt not found.');
    }
    const attempt = this.hydrateAttemptRow(attemptRow);
    if (attempt.studentId !== student.id) {
      throw new HttpError(403, 'Not authorized to update another student’s attempt.');
    }
    if (attempt.status !== 'in_progress') {
      throw new HttpError(400, 'This attempt has already been submitted.');
    }
    if (attempt.expiresAt && Date.now() > Date.parse(attempt.expiresAt) + 5000) {
      throw new HttpError(400, 'Assessment timer has expired.');
    }

    const now = new Date().toISOString();
    const upsert = this.db.prepare(
      `INSERT INTO assessment_answers (
        id, attempt_id, snapshot_id, question_id, question_version, submitted_answer_text,
        submitted_option_index, marking_status, awarded_marks, max_marks, response_duration_ms,
        hint_used, answered_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, 'auto_graded', 0, 1, 0, 0, ?)
      ON CONFLICT(attempt_id, snapshot_id) DO UPDATE SET
        submitted_answer_text = excluded.submitted_answer_text,
        submitted_option_index = excluded.submitted_option_index,
        answered_at = excluded.answered_at`
    );

    this.dbWrapper.transaction(() => {
      for (const a of payload.answers || []) {
        upsert.run(
          `AANS-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          attempt.id,
          a.snapshotId,
          a.questionId,
          a.submittedAnswerText ?? null,
          typeof a.submittedOptionIndex === 'number' ? a.submittedOptionIndex : null,
          now
        );
      }
    });

    return { ok: true, savedAt: now };
  }

  public checkPracticeQuestionAnswer(
    student: UserAccount,
    assessmentId: string,
    payload: {
      attemptId: string;
      snapshotId: string;
      submittedOptionIndex?: number | null;
      submittedAnswerText?: string | null;
    }
  ) {
    const attemptRow = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE id = ? AND assessment_id = ?')
      .get(payload.attemptId, assessmentId) as Record<string, unknown> | undefined;
    if (!attemptRow) {
      throw new HttpError(404, 'Assessment attempt not found.');
    }
    const attempt = this.hydrateAttemptRow(attemptRow);
    if (attempt.studentId !== student.id) {
      throw new HttpError(403, 'Not authorized to inspect another student’s attempt.');
    }
    if (attempt.status !== 'in_progress') {
      throw new HttpError(400, 'This attempt has already been submitted.');
    }
    if (attempt.expiresAt && Date.now() > Date.parse(attempt.expiresAt) + 5000) {
      throw new HttpError(400, 'Assessment timer has expired.');
    }

    const asmRow = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId) as
      | Record<string, unknown>
      | undefined;
    if (!asmRow) throw new HttpError(404, 'Assessment not found.');
    const assessment = this.hydrateAssessmentRow(asmRow);
    if (assessment.kind !== 'practice_session' || assessment.explanationTiming !== 'immediate') {
      throw new HttpError(
        403,
        'Immediate question feedback is enabled only for practice sessions configured with immediate explanations.'
      );
    }

    const snapshots = this.getAssessmentSnapshots(assessmentId, attempt.assessmentVersion);
    const snap = snapshots.find((s) => s.id === payload.snapshotId);
    if (!snap) {
      throw new HttpError(404, 'Question snapshot not found in this attempt.');
    }

    const dispIdx =
      typeof payload.submittedOptionIndex === 'number' ? payload.submittedOptionIndex : null;
    const mapping = attempt.shuffledOptionsMap[snap.id];
    const gradeRes = gradeSubmittedAnswer({
      question: snap.snapshot,
      marks: snap.marks,
      submittedDisplayOptionIndex: dispIdx,
      submittedAnswerText: payload.submittedAnswerText ?? null,
      optionMapping: mapping,
    });

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO assessment_answers (
          id, attempt_id, snapshot_id, question_id, question_version, submitted_answer_text,
          submitted_option_index, marking_status, awarded_marks, max_marks, response_duration_ms,
          hint_used, answered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'auto_graded', 0, ?, 0, 0, ?)
        ON CONFLICT(attempt_id, snapshot_id) DO UPDATE SET
          submitted_answer_text = excluded.submitted_answer_text,
          submitted_option_index = excluded.submitted_option_index,
          answered_at = excluded.answered_at`
      )
      .run(
        `AANS-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        attempt.id,
        snap.id,
        snap.questionId,
        snap.questionVersion,
        gradeRes.submittedAnswerText,
        dispIdx,
        snap.marks,
        now
      );

    let correctDisplayOptionIndex: number | null = snap.snapshot.correctIndex;
    if (mapping && mapping.length > 0) {
      const foundDisp = mapping.indexOf(snap.snapshot.correctIndex);
      if (foundDisp >= 0) correctDisplayOptionIndex = foundDisp;
    }

    return {
      snapshotId: snap.id,
      questionId: snap.questionId,
      isCorrect: gradeRes.isCorrect,
      markingStatus: gradeRes.markingStatus,
      awardedMarks: gradeRes.awardedMarks,
      maxMarks: snap.marks,
      correctDisplayOptionIndex,
      acceptedAnswers: snap.snapshot.acceptedAnswers || [],
      explanation: snap.snapshot.explanation,
      memoryTrickTitle: snap.snapshot.memoryTrickTitle,
      memoryTrickBody: snap.snapshot.memoryTrickBody,
    };
  }

  public submitAssessmentAttempt(
    student: UserAccount,
    assessmentId: string,
    payload: {
      attemptId: string;
      idempotencyKey?: string;
      answers: {
        snapshotId: string;
        questionId: string;
        submittedOptionIndex?: number | null;
        submittedAnswerText?: string | null;
      }[];
      perQuestionDurationsMs?: Record<string, number>;
      hintUsedQuestionIds?: string[];
      timedOut?: boolean;
    }
  ) {
    const attemptRow = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE id = ? AND assessment_id = ?')
      .get(payload.attemptId, assessmentId) as Record<string, unknown> | undefined;
    if (!attemptRow) {
      throw new HttpError(404, 'Assessment attempt not found.');
    }
    const attempt = this.hydrateAttemptRow(attemptRow);
    if (attempt.studentId !== student.id) {
      throw new HttpError(403, 'Not authorized to submit another student’s attempt.');
    }

    const row = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new HttpError(404, 'Assessment not found.');
    const assessment = this.hydrateAssessmentRow(row);
    const snapshots = this.getAssessmentSnapshots(assessmentId, attempt.assessmentVersion);

    // Idempotent duplicate submission return
    if (attempt.status !== 'in_progress') {
      const review = this.getAttemptReview(student, attempt.id);
      return {
        deduplicated: true,
        attempt,
        assessment,
        review,
        user: this.academicService.sanitizeUser(this.academicService.getUserById(student.id)!),
      };
    }

    return this.finalizeAttemptInternal({
      student,
      assessment,
      attempt,
      snapshots,
      submittedAnswers: payload.answers || [],
      perQuestionDurationsMs: payload.perQuestionDurationsMs || {},
      hintUsedQuestionIds: payload.hintUsedQuestionIds || [],
      timedOut: Boolean(payload.timedOut),
      idempotencyKey: payload.idempotencyKey,
    });
  }

  private finalizeAttemptInternal(params: {
    student: UserAccount;
    assessment: AssessmentRecord;
    attempt: AssessmentAttemptRecord;
    snapshots: AssessmentSnapshotItem[];
    submittedAnswers: {
      snapshotId: string;
      questionId: string;
      submittedOptionIndex?: number | null;
      submittedAnswerText?: string | null;
    }[];
    perQuestionDurationsMs: Record<string, number>;
    hintUsedQuestionIds: string[];
    timedOut: boolean;
    idempotencyKey?: string;
  }) {
    const { student, assessment, attempt, snapshots } = params;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const startedMs = Date.parse(attempt.startedAt);
    const rawElapsedSec = Math.max(1, Math.round((nowMs - startedMs) / 1000));
    const maxAllowedSec = assessment.timeLimitMinutes ? assessment.timeLimitMinutes * 60 : rawElapsedSec;
    const isServerExpired = Boolean(
      attempt.expiresAt && nowMs > Date.parse(attempt.expiresAt) + 10_000
    );
    const finalTimedOut = params.timedOut || isServerExpired;
    const serverDurationSeconds = assessment.timeLimitMinutes
      ? Math.min(rawElapsedSec, maxAllowedSec)
      : rawElapsedSec;

    // Merge incoming answers with any autosaved answers in DB
    const savedRows = this.db
      .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?')
      .all(attempt.id) as Record<string, unknown>[];
    const answerBySnapshot = new Map<
      string,
      { submittedOptionIndex: number | null; submittedAnswerText: string | null }
    >();
    for (const sr of savedRows) {
      answerBySnapshot.set(String(sr.snapshot_id), {
        submittedOptionIndex:
          sr.submitted_option_index === null || sr.submitted_option_index === undefined
            ? null
            : Number(sr.submitted_option_index),
        submittedAnswerText: sr.submitted_answer_text ? String(sr.submitted_answer_text) : null,
      });
    }
    for (const a of params.submittedAnswers) {
      answerBySnapshot.set(a.snapshotId, {
        submittedOptionIndex:
          typeof a.submittedOptionIndex === 'number' ? a.submittedOptionIndex : null,
        submittedAnswerText: a.submittedAnswerText ?? null,
      });
    }

    const hintSet = new Set(params.hintUsedQuestionIds);
    let autoScore = 0;
    let maxMarks = 0;
    let hasPendingManual = false;
    let correctCount = 0;
    const domainBreakdown: Record<string, { correct: number; total: number }> = {};

    const gradedRecords: {
      snapshot: AssessmentSnapshotItem;
      submittedDisplayOptionIndex: number | null;
      originalOptionIndex: number | null;
      submittedAnswerText: string | null;
      isCorrect: boolean | null;
      markingStatus: 'auto_graded' | 'pending_manual';
      awardedMarks: number;
    }[] = [];

    for (const snap of snapshots) {
      maxMarks += snap.marks;
      const ans = answerBySnapshot.get(snap.id);
      const dispIdx = ans?.submittedOptionIndex ?? null;
      const ansText = ans?.submittedAnswerText ?? null;
      const optionMapping = attempt.shuffledOptionsMap[snap.id];

      const gradeRes = gradeSubmittedAnswer({
        question: snap.snapshot,
        marks: snap.marks,
        submittedDisplayOptionIndex: dispIdx,
        submittedAnswerText: ansText,
        optionMapping,
      });

      if (gradeRes.markingStatus === 'pending_manual') {
        hasPendingManual = true;
      } else {
        autoScore += gradeRes.awardedMarks;
        if (gradeRes.isCorrect) correctCount++;
      }

      const dom = snap.snapshot.attributes.cognitiveDomain;
      if (!domainBreakdown[dom]) domainBreakdown[dom] = { correct: 0, total: 0 };
      domainBreakdown[dom].total += 1;
      if (gradeRes.isCorrect === true) domainBreakdown[dom].correct += 1;

      gradedRecords.push({
        snapshot: snap,
        submittedDisplayOptionIndex: dispIdx,
        originalOptionIndex: gradeRes.originalOptionIndex,
        submittedAnswerText: gradeRes.submittedAnswerText,
        isCorrect: gradeRes.isCorrect,
        markingStatus: gradeRes.markingStatus,
        awardedMarks: gradeRes.awardedMarks,
      });
    }

    const finalAttemptStatus: AssessmentAttemptStatus = hasPendingManual
      ? 'pending_manual_marking'
      : finalTimedOut
      ? 'timed_out'
      : 'graded';

    const scorePercent: number | null = hasPendingManual
      ? null
      : maxMarks > 0
      ? Math.round((autoScore / maxMarks) * 100)
      : 0;

    this.dbWrapper.transaction(() => {
      const upsertAns = this.db.prepare(
        `INSERT INTO assessment_answers (
          id, attempt_id, snapshot_id, question_id, question_version, submitted_answer_text,
          submitted_option_index, is_correct, marking_status, awarded_marks, max_marks,
          response_duration_ms, hint_used, answered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id, snapshot_id) DO UPDATE SET
          submitted_answer_text = excluded.submitted_answer_text,
          submitted_option_index = excluded.submitted_option_index,
          is_correct = excluded.is_correct,
          marking_status = excluded.marking_status,
          awarded_marks = excluded.awarded_marks,
          response_duration_ms = excluded.response_duration_ms,
          hint_used = excluded.hint_used,
          answered_at = excluded.answered_at`
      );

      for (const gr of gradedRecords) {
        const durMs = Math.max(
          500,
          Number(params.perQuestionDurationsMs[gr.snapshot.questionId] || 15_000)
        );
        upsertAns.run(
          `AANS-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          attempt.id,
          gr.snapshot.id,
          gr.snapshot.questionId,
          gr.snapshot.questionVersion,
          gr.submittedAnswerText,
          gr.submittedDisplayOptionIndex,
          gr.isCorrect === null ? null : gr.isCorrect ? 1 : 0,
          gr.markingStatus,
          gr.awardedMarks,
          gr.snapshot.marks,
          durMs,
          hintSet.has(gr.snapshot.questionId) ? 1 : 0,
          nowIso
        );
      }

      this.db
        .prepare(
          `UPDATE assessment_attempts SET
            status = ?, submitted_at = ?, server_duration_seconds = ?,
            auto_score = ?, manual_score = 0, total_awarded_marks = ?,
            max_marks = ?, score_percent = ?, idempotency_key = COALESCE(?, idempotency_key)
           WHERE id = ?`
        )
        .run(
          finalAttemptStatus,
          nowIso,
          serverDurationSeconds,
          autoScore,
          autoScore,
          maxMarks,
          scorePercent,
          params.idempotencyKey || null,
          attempt.id
        );
    });

    // Feed unified question_attempts & repeated-error intervention engine cleanly
    for (const gr of gradedRecords) {
      const q = gr.snapshot.snapshot;
      const hasResponse =
        gr.submittedDisplayOptionIndex !== null ||
        Boolean(gr.submittedAnswerText && gr.submittedAnswerText.trim());
      const subStatus = hasResponse
        ? 'valid_answered'
        : finalTimedOut
        ? 'timed_out'
        : 'unanswered';
      if (gr.markingStatus === 'pending_manual' && hasResponse) {
        // Pending manual responses will feed accuracy once teacher grades them; skip false-negative auto-error trigger
        continue;
      }
      this.academicService.recordQuestionAttempt({
        student,
        questionId: q.id,
        submittedAnswerIndex: gr.originalOptionIndex,
        submissionStatus: subStatus,
        responseDurationMs: Math.max(
          500,
          Number(params.perQuestionDurationsMs[q.id] || 15_000)
        ),
        hintUsed: hintSet.has(q.id),
        contextMode: assessment.kind === 'practice_session' ? 'practice' : 'timed_exam',
        sessionId: attempt.id,
        deliveryContext: { paperId: assessment.id },
        idempotencyKey: `asm-${attempt.id}-${gr.snapshot.id}`,
        awardPracticeXp: assessment.kind === 'practice_session',
        overrideIsCorrect: gr.isCorrect,
      });
    }

    // Record summary round attempt & guardian notification
    const starsEarned =
      correctCount * 4 + (scorePercent !== null && scorePercent >= assessment.passMarkPercent ? 10 : 2);
    const { attempt: roundAttempt, user: refreshedUser, trajectory } =
      this.academicService.recordRoundAttemptAndUpdateUser({
        user: student,
        paperId: assessment.id,
        paperTitle: assessment.title,
        mode: assessment.kind === 'practice_session' ? 'practice' : 'timed_exam',
        paperCategory: student.currentLevel,
        totalQuestions: snapshots.length,
        correctCount,
        timeLimitSeconds: assessment.timeLimitMinutes ? assessment.timeLimitMinutes * 60 : 0,
        timeSpentSeconds: serverDurationSeconds,
        starsEarned,
        domainBreakdown,
      });

    const reportScoreLabel = scorePercent !== null ? `${scorePercent}%` : 'Pending Teacher Mark';
    this.academicService.dispatchActivityEmailAndWhatsApp({
      user: refreshedUser,
      attempt: roundAttempt,
      trajectory,
      emailSubject: `${assessment.kind === 'mock_exam' ? 'Exam' : 'Practice'} Report: ${assessment.title} (${reportScoreLabel}) · මං 5හේ`,
      whatsappCategory: assessment.kind === 'mock_exam' ? 'exam_report' : 'milestone',
    });

    const updatedAttempt = this.hydrateAttemptRow(
      this.db.prepare('SELECT * FROM assessment_attempts WHERE id = ?').get(attempt.id) as Record<
        string,
        unknown
      >
    );

    try {
      this.onAttemptCompletedHook?.(attempt.id, 'submitted');
    } catch {
      // Do not fail assessment submission if parent report hook encounters an error
    }

    return {
      deduplicated: false,
      attempt: updatedAttempt,
      assessment,
      review: this.getAttemptReview(refreshedUser, attempt.id),
      trajectory,
      user: this.academicService.sanitizeUser(refreshedUser),
    };
  }

  public getAttemptReview(actor: UserAccount, attemptId: string) {
    const attemptRow = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE id = ?')
      .get(attemptId) as Record<string, unknown> | undefined;
    if (!attemptRow) {
      throw new HttpError(404, 'Assessment attempt not found.');
    }
    const attempt = this.hydrateAttemptRow(attemptRow);
    if (actor.role === 'student' && attempt.studentId !== actor.id) {
      throw new HttpError(403, 'Access denied: you may only view your own assessment results.');
    }

    const asmRow = this.db
      .prepare('SELECT * FROM assessments WHERE id = ?')
      .get(attempt.assessmentId) as Record<string, unknown> | undefined;
    if (!asmRow) throw new HttpError(404, 'Assessment not found.');
    const assessment = this.hydrateAssessmentRow(asmRow);

    if (actor.role === 'teacher') {
      const ctx = this.academicService.buildAuthContext(actor);
      const allowed =
        assessment.subjectIds.length > 0 &&
        assessment.subjectIds.every((sid) => canAccessSubject(ctx, sid));
      if (!allowed) {
        throw new HttpError(
          403,
          'Access denied: assessment results belong to an unassigned subject.'
        );
      }
    }

    if (actor.role === 'student' && attempt.status === 'in_progress') {
      throw new HttpError(403, 'Answers and scores are locked until submission.');
    }

    const resultsWithheldForStudent =
      actor.role === 'student' &&
      assessment.explanationTiming === 'after_release' &&
      assessment.status !== 'RESULTS_RELEASED';

    if (resultsWithheldForStudent) {
      return {
        attempt: {
          ...attempt,
          scorePercent: null,
          autoScore: 0,
          manualScore: 0,
          totalAwardedMarks: 0,
        },
        assessment,
        resultsReleased: false,
        awaitingReleaseNotice:
          'Your submission is recorded safely. Scores, explanations, and answer keys will unlock once the teacher/administrator publishes results.',
        items: [],
      };
    }

    const snapshots = this.getAssessmentSnapshots(assessment.id, attempt.assessmentVersion);
    const ansRows = this.db
      .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?')
      .all(attempt.id) as Record<string, unknown>[];
    const ansMap = new Map<string, AssessmentAnswerRecord>();
    for (const ar of ansRows) {
      const rec = this.hydrateAnswerRow(ar);
      ansMap.set(rec.snapshotId, rec);
    }

    const items = snapshots.map((s) => {
      const a = ansMap.get(s.id);
      const mapping = attempt.shuffledOptionsMap[s.id];
      const origSelectedIdx =
        a?.submittedOptionIndex !== null &&
        a?.submittedOptionIndex !== undefined &&
        mapping &&
        a.submittedOptionIndex < mapping.length
          ? mapping[a.submittedOptionIndex]
          : a?.submittedOptionIndex ?? null;

      return {
        snapshotId: s.id,
        sectionId: s.sectionId,
        sortOrder: s.sortOrder,
        questionId: s.questionId,
        questionType: s.snapshot.questionType || 'mcq',
        questionSi: s.snapshot.questionSi,
        questionEn: s.snapshot.questionEn,
        options: s.snapshot.options,
        imageUrl: s.snapshot.imageUrl,
        correctIndex: s.snapshot.correctIndex,
        acceptedAnswers: s.snapshot.acceptedAnswers || [],
        submittedDisplayOptionIndex: a?.submittedOptionIndex ?? null,
        submittedOriginalOptionIndex: origSelectedIdx,
        submittedAnswerText: a?.submittedAnswerText ?? null,
        isCorrect: a?.isCorrect ?? null,
        markingStatus: a?.markingStatus ?? 'auto_graded',
        awardedMarks: a?.awardedMarks ?? 0,
        maxMarks: s.marks,
        graderComment: a?.graderComment ?? null,
        explanation: s.snapshot.explanation,
        memoryTrickTitle: s.snapshot.memoryTrickTitle,
        memoryTrickBody: s.snapshot.memoryTrickBody,
        markingNotes:
          actor.role === 'student' ? undefined : s.snapshot.markingRule?.markingNotes,
      };
    });

    return {
      attempt,
      assessment,
      resultsReleased: true,
      awaitingReleaseNotice: null,
      items,
    };
  }

  // =========================================================================
  // 4. MANUAL MARKING, ASSESSMENT ANALYTICS & FOLLOW-UP ASSIGNMENTS
  // =========================================================================

  public gradeManualAnswers(
    actor: UserAccount,
    attemptId: string,
    grades: { answerId?: string; snapshotId?: string; awardedMarks: number; comment?: string }[]
  ) {
    if (actor.role === 'student') {
      throw new HttpError(403, 'Students cannot grade assessments.');
    }
    const attemptRow = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE id = ?')
      .get(attemptId) as Record<string, unknown> | undefined;
    if (!attemptRow) throw new HttpError(404, 'Attempt not found.');
    const attempt = this.hydrateAttemptRow(attemptRow);
    const { assessment } = this.getAssessmentDetailScoped(actor, attempt.assessmentId);

    const newlyGradedForIntelligence: {
      snapshotId: string;
      questionId: string;
      isCorrect: boolean;
      responseDurationMs: number;
      hintUsed: boolean;
    }[] = [];

    this.dbWrapper.transaction(() => {
      for (const g of grades) {
        const ansRow = g.answerId
          ? (this.db
              .prepare('SELECT * FROM assessment_answers WHERE id = ? AND attempt_id = ?')
              .get(g.answerId, attemptId) as Record<string, unknown> | undefined)
          : (this.db
              .prepare('SELECT * FROM assessment_answers WHERE snapshot_id = ? AND attempt_id = ?')
              .get(g.snapshotId || '', attemptId) as Record<string, unknown> | undefined);
        if (!ansRow) continue;

        const maxM = Number(ansRow.max_marks ?? 1);
        const awarded = Math.max(0, Math.min(maxM, Number(g.awardedMarks || 0)));
        const isCorrect = awarded >= maxM * 0.5 ? 1 : 0;

        this.db
          .prepare(
            `UPDATE assessment_answers SET
              awarded_marks = ?, is_correct = ?, marking_status = 'manually_graded',
              grader_id = ?, grader_comment = ?
             WHERE id = ?`
          )
          .run(awarded, isCorrect, actor.id, String(g.comment || '').trim(), String(ansRow.id));

        if (String(ansRow.marking_status) === 'pending_manual') {
          newlyGradedForIntelligence.push({
            snapshotId: String(ansRow.snapshot_id),
            questionId: String(ansRow.question_id),
            isCorrect: isCorrect === 1,
            responseDurationMs: Math.max(500, Number(ansRow.response_duration_ms ?? 15_000)),
            hintUsed: Number(ansRow.hint_used ?? 0) === 1,
          });
        }
      }

      const allAns = this.db
        .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?')
        .all(attemptId) as Record<string, unknown>[];

      let autoScore = 0;
      let manualScore = 0;
      let pendingManualCount = 0;
      for (const ar of allAns) {
        const st = String(ar.marking_status);
        const m = Number(ar.awarded_marks ?? 0);
        if (st === 'pending_manual') pendingManualCount++;
        else if (st === 'manually_graded') manualScore += m;
        else autoScore += m;
      }

      const totalAwarded = autoScore + manualScore;
      const pct =
        attempt.maxMarks > 0 ? Math.round((totalAwarded / attempt.maxMarks) * 100) : 0;
      const nextStatus: AssessmentAttemptStatus =
        pendingManualCount > 0 ? 'pending_manual_marking' : 'graded';

      this.db
        .prepare(
          `UPDATE assessment_attempts SET
            auto_score = ?, manual_score = ?, total_awarded_marks = ?,
            score_percent = ?, status = ?
           WHERE id = ?`
        )
        .run(autoScore, manualScore, totalAwarded, pct, nextStatus, attemptId);

      this.academicService.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'ASSESSMENT_MANUAL_MARKED',
        targetType: assessment.kind,
        targetId: attemptId,
        details: { assessmentId: assessment.id, totalAwarded, scorePercent: pct, status: nextStatus },
      });
    });

    if (newlyGradedForIntelligence.length > 0) {
      const student = this.academicService.getUserById(attempt.studentId);
      if (student) {
        for (const item of newlyGradedForIntelligence) {
          this.academicService.recordQuestionAttempt({
            student,
            questionId: item.questionId,
            submittedAnswerIndex: null,
            submissionStatus: 'valid_answered',
            responseDurationMs: item.responseDurationMs,
            hintUsed: item.hintUsed,
            contextMode: assessment.kind === 'practice_session' ? 'practice' : 'timed_exam',
            sessionId: attempt.id,
            deliveryContext: { paperId: assessment.id },
            idempotencyKey: `asm-${attempt.id}-${item.snapshotId}`,
            awardPracticeXp: false,
            overrideIsCorrect: item.isCorrect,
          });
        }
      }
    }

    try {
      this.onAttemptCompletedHook?.(attemptId, 'graded');
    } catch {
      // Do not block grading response if report hook fails
    }

    return this.getAttemptReview(actor, attemptId);
  }

  public getAssessmentAnalytics(actor: UserAccount, assessmentId: string) {
    const { assessment, snapshots } = this.getAssessmentDetailScoped(actor, assessmentId);
    const attemptRows = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE assessment_id = ? ORDER BY submitted_at DESC')
      .all(assessmentId) as Record<string, unknown>[];
    const attempts = attemptRows.map((r) => this.hydrateAttemptRow(r));

    const completed = attempts.filter((a) => a.status !== 'in_progress');
    const pendingManual = attempts.filter((a) => a.status === 'pending_manual_marking');
    const scores = completed
      .map((a) => a.scorePercent)
      .filter((s): s is number => typeof s === 'number');

    const avgScore = scores.length
      ? Math.round((scores.reduce((acc, v) => acc + v, 0) / scores.length) * 10) / 10
      : 0;
    const passCount = scores.filter((s) => s >= assessment.passMarkPercent).length;
    const passRate = scores.length ? Math.round((passCount / scores.length) * 1000) / 10 : 0;

    const studentUsers = this.db
      .prepare("SELECT id, name, user_id_code FROM users WHERE role = 'student'")
      .all() as { id: string; name: string; user_id_code: string }[];
    const userMap = new Map(studentUsers.map((u) => [u.id, u]));

    const ansRows = completed.length
      ? (this.db
          .prepare(
            `SELECT aa.* FROM assessment_answers aa
             JOIN assessment_attempts att ON att.id = aa.attempt_id
             WHERE att.assessment_id = ? AND att.status != 'in_progress'`
          )
          .all(assessmentId) as Record<string, unknown>[])
      : [];
    const answers = ansRows.map((r) => this.hydrateAnswerRow(r));

    const topicLookup = new Map(
      (this.db.prepare('SELECT id, name_en FROM topics').all() as { id: string; name_en: string }[]).map(
        (t) => [t.id, t.name_en]
      )
    );

    const questionAnalytics = snapshots.map((s) => {
      const qAnswers = answers.filter((a) => a.snapshotId === s.id);
      const graded = qAnswers.filter((a) => a.markingStatus !== 'pending_manual');
      const correct = graded.filter((a) => a.isCorrect === true).length;
      const accuracy = graded.length ? Math.round((correct / graded.length) * 1000) / 10 : null;
      const avgDurationMs = qAnswers.length
        ? Math.round(
            qAnswers.reduce((acc, a) => acc + a.responseDurationMs, 0) / qAnswers.length
          )
        : 0;
      const qualityWarning =
        graded.length >= 2 && accuracy !== null && accuracy < 40
          ? 'High error rate (<40%): consider review or follow-up guide'
          : null;

      return {
        snapshotId: s.id,
        questionId: s.questionId,
        sortOrder: s.sortOrder,
        questionSi: s.snapshot.questionSi,
        questionType: s.snapshot.questionType || 'mcq',
        topicId: s.snapshot.topicId || '',
        topicName: topicLookup.get(s.snapshot.topicId || '') || 'Topic',
        marks: s.marks,
        responsesCount: qAnswers.length,
        correctCount: correct,
        pendingManualCount: qAnswers.filter((a) => a.markingStatus === 'pending_manual').length,
        accuracyPercent: accuracy,
        avgDurationMs,
        qualityWarning,
      };
    });

    const weakTopicsMap = new Map<
      string,
      { topicId: string; topicName: string; total: number; wrong: number }
    >();
    for (const qa of questionAnalytics) {
      if (qa.responsesCount === 0) continue;
      const cur = weakTopicsMap.get(qa.topicId) || {
        topicId: qa.topicId,
        topicName: qa.topicName,
        total: 0,
        wrong: 0,
      };
      cur.total += qa.responsesCount;
      cur.wrong += Math.max(0, qa.responsesCount - qa.correctCount);
      weakTopicsMap.set(qa.topicId, cur);
    }
    const topicPerformance = Array.from(weakTopicsMap.values()).map((t) => ({
      ...t,
      accuracyPercent: t.total > 0 ? Math.round(((t.total - t.wrong) / t.total) * 1000) / 10 : 0,
    }));

    const attemptSummaries = attempts.map((a) => {
      const stu = userMap.get(a.studentId);
      return {
        ...a,
        studentName: stu?.name || a.studentId,
        studentCode: stu?.user_id_code || a.studentId,
      };
    });

    return {
      assessment,
      summary: {
        totalAttempts: attempts.length,
        completedCount: completed.length,
        inProgressCount: attempts.filter((a) => a.status === 'in_progress').length,
        pendingManualCount: pendingManual.length,
        uniqueParticipants: new Set(attempts.map((a) => a.studentId)).size,
        averageScorePercent: avgScore,
        highestScorePercent: scores.length ? Math.max(...scores) : 0,
        lowestScorePercent: scores.length ? Math.min(...scores) : 0,
        passRatePercent: passRate,
      },
      questionAnalytics,
      topicPerformance,
      attempts: attemptSummaries,
    };
  }

  public assignFollowUpFromAssessment(
    actor: UserAccount,
    assessmentId: string,
    payload: {
      studentIds: string[];
      title: string;
      body: string;
      recommendedTopicId?: string | null;
      linkedPublicationId?: string | null;
    }
  ) {
    const { assessment } = this.getAssessmentDetailScoped(actor, assessmentId);
    if (!Array.isArray(payload.studentIds) || payload.studentIds.length === 0) {
      throw new HttpError(400, 'Select at least one student for follow-up assignment.');
    }

    const now = new Date().toISOString();
    let assignedCount = 0;

    this.dbWrapper.transaction(() => {
      for (const stuId of payload.studentIds) {
        const stu = this.academicService.getUserById(stuId);
        if (!stu || stu.role !== 'student') continue;

        this.academicService.insertNotificationRow({
          recipientUserId: stu.id,
          recipientRole: 'student',
          channel: 'in_app',
          category: 'follow_up_ready',
          title: payload.title.trim() || `Follow-up Study Plan · ${assessment.title}`,
          body: payload.body.trim() || 'Your teacher assigned follow-up revision based on your recent assessment.',
          relatedStudentId: stu.id,
          relatedSubjectId: assessment.subjectIds[0],
          dedupeKey: `asm-followup-${assessmentId}-${stu.id}-${Date.now()}`,
          deliveryStatus: 'delivered',
        });

        // If a knowledge publication is attached, also add a direct notification linking the publication
        if (payload.linkedPublicationId) {
          this.db
            .prepare(
              `UPDATE notifications SET related_publication_id = ?
               WHERE recipient_user_id = ? AND related_publication_id IS NULL
               AND id = (SELECT id FROM notifications WHERE recipient_user_id = ? ORDER BY created_at DESC LIMIT 1)`
            )
            .run(payload.linkedPublicationId, stu.id, stu.id);
        }

        assignedCount++;
      }

      this.academicService.writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'ASSESSMENT_FOLLOWUP_ASSIGNED',
        targetType: assessment.kind,
        targetId: assessmentId,
        details: {
          studentIds: payload.studentIds,
          recommendedTopicId: payload.recommendedTopicId || null,
          linkedPublicationId: payload.linkedPublicationId || null,
          assignedCount,
          assignedAt: now,
        },
      });
    });

    return { ok: true, assignedCount };
  }

  // =========================================================================
  // INTERNAL ROW HYDRATION HELPERS
  // =========================================================================

  private getAssessmentSnapshots(assessmentId: string, versionNumber: number): AssessmentSnapshotItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM assessment_question_snapshots
         WHERE assessment_id = ? AND version_number = ?
         ORDER BY sort_order ASC`
      )
      .all(assessmentId, versionNumber) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      assessmentId: String(r.assessment_id),
      versionNumber: Number(r.version_number ?? 1),
      sectionId: String(r.section_id),
      sortOrder: Number(r.sort_order ?? 1),
      questionId: String(r.question_id),
      questionVersion: Number(r.question_version ?? 1),
      marks: Number(r.marks ?? 1),
      snapshot: parseJsonSafe<QuizItem>(r.snapshot_json, {
        id: String(r.question_id),
        source: 'curated',
        questionSi: String(r.question_id),
        questionEn: String(r.question_id),
        options: ['', '', '', ''],
        correctIndex: 0,
        memoryTrickTitle: '',
        memoryTrickBody: '',
        explanation: '',
        attributes: {
          intelligenceMeasure: 50,
          correctProbability: 0.7,
          wrongProbability: 0.3,
          examPriority: 7,
          quizStrength: 70,
          difficultyTier: 'Moderate',
          cognitiveDomain: 'Mathematics & Word Problems',
          estimatedSeconds: 30,
        },
        createdAt: '',
      }),
    }));
  }

  private buildSanitizedQuestionFromAttempt(
    snap: AssessmentSnapshotItem,
    attempt: AssessmentAttemptRecord,
    showHints: boolean
  ): StudentQuizView {
    const q = snap.snapshot;
    const qType = q.questionType || 'mcq';
    const mapping = attempt.shuffledOptionsMap[snap.id] || [0, 1, 2, 3];
    const displayedOptions = (
      qType === 'mcq'
        ? mapping.map((orig) => q.options[orig] || '')
        : qType === 'true_false'
        ? [q.options[0] || 'True', q.options[1] || 'False', '', '']
        : q.options
    ) as [string, string, string, string];

    return {
      id: q.id,
      source: q.source,
      subjectId: q.subjectId,
      topicId: q.topicId,
      subtopicId: q.subtopicId,
      version: q.version,
      grade: q.grade || 'Grade 5',
      questionType: qType,
      marks: snap.marks,
      sectionId: snap.sectionId,
      snapshotId: snap.id,
      questionSi: q.questionSi,
      questionEn: q.questionEn,
      options: displayedOptions,
      imageUrl: q.imageUrl,
      attributes: q.attributes,
      hint: showHints ? q.hint : undefined,
    };
  }

  private hydrateAssessmentRow(row: Record<string, unknown>): AssessmentRecord {
    const id = String(row.id);
    const version = Number(row.current_version ?? 1);
    const sectionRows = this.db
      .prepare(
        'SELECT * FROM assessment_sections WHERE assessment_id = ? AND version_number = ? ORDER BY sort_order ASC'
      )
      .all(id, version) as Record<string, unknown>[];
    const sections: AssessmentSection[] = sectionRows.map((s) => ({
      id: String(s.id),
      assessmentId: String(s.assessment_id),
      versionNumber: Number(s.version_number ?? 1),
      sortOrder: Number(s.sort_order ?? 1),
      title: String(s.title),
      instructions: String(s.instructions || ''),
      subjectId: s.subject_id ? String(s.subject_id) : null,
      totalMarks: Number(s.total_marks ?? 0),
    }));

    const questionCount = (
      this.db
        .prepare(
          'SELECT COUNT(*) as cnt FROM assessment_question_snapshots WHERE assessment_id = ? AND version_number = ?'
        )
        .get(id, version) as { cnt: number }
    ).cnt;

    const assignRows = this.db
      .prepare('SELECT * FROM assessment_assignments WHERE assessment_id = ?')
      .all(id) as Record<string, unknown>[];
    const assignments: AssessmentAssignment[] = assignRows.map((a) => ({
      id: String(a.id),
      assessmentId: String(a.assessment_id),
      targetType: String(a.target_type) as AssessmentAssignment['targetType'],
      targetValue: String(a.target_value),
      assignedBy: String(a.assigned_by),
      assignedAt: String(a.assigned_at),
    }));

    return {
      id,
      kind: String(row.kind) as AssessmentKind,
      title: String(row.title),
      titleSi: String(row.title_si || ''),
      description: String(row.description || ''),
      instructions: String(row.instructions || ''),
      grade: String(row.grade || 'Grade 5'),
      subjectIds: parseJsonSafe<string[]>(row.subject_ids_json, []),
      topicIds: parseJsonSafe<string[]>(row.topic_ids_json, []),
      subtopicIds: parseJsonSafe<string[]>(row.subtopic_ids_json, []),
      authorId: String(row.author_id),
      authorName: String(row.author_name),
      authorRole: String(row.author_role) as AssessmentRecord['authorRole'],
      reviewerId: row.reviewer_id ? String(row.reviewer_id) : null,
      reviewerName: row.reviewer_name ? String(row.reviewer_name) : null,
      status: String(row.status) as AssessmentStatus,
      selectionMode: String(row.selection_mode || 'manual') as AssessmentSelectionMode,
      shuffleQuestions: Number(row.shuffle_questions ?? 0) === 1,
      shuffleOptions: Number(row.shuffle_options ?? 0) === 1,
      showHints: Number(row.show_hints ?? 1) === 1,
      explanationTiming: String(row.explanation_timing || 'after_submit') as ExplanationTiming,
      timeLimitMinutes:
        row.time_limit_minutes === null || row.time_limit_minutes === undefined
          ? null
          : Number(row.time_limit_minutes),
      maxAttempts: Number(row.max_attempts ?? 1),
      totalMarks: Number(row.total_marks ?? 0),
      passMarkPercent: Number(row.pass_mark_percent ?? 50),
      availableFrom: row.available_from ? String(row.available_from) : null,
      availableUntil: row.available_until ? String(row.available_until) : null,
      scheduledFor: row.scheduled_for ? String(row.scheduled_for) : null,
      resultsReleasedAt: row.results_released_at ? String(row.results_released_at) : null,
      currentVersion: version,
      config: parseJsonSafe<AssessmentConfig>(row.config_json, {}),
      sections,
      questionCount,
      assignments,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private hydrateAttemptRow(row: Record<string, unknown>): AssessmentAttemptRecord {
    return {
      id: String(row.id),
      assessmentId: String(row.assessment_id),
      assessmentVersion: Number(row.assessment_version ?? 1),
      studentId: String(row.student_id),
      attemptNumber: Number(row.attempt_number ?? 1),
      status: String(row.status) as AssessmentAttemptStatus,
      startedAt: String(row.started_at),
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      submittedAt: row.submitted_at ? String(row.submitted_at) : null,
      serverDurationSeconds: Number(row.server_duration_seconds ?? 0),
      shuffledOrder: parseJsonSafe<string[]>(row.shuffled_order_json, []),
      shuffledOptionsMap: parseJsonSafe<Record<string, number[]>>(
        row.shuffled_options_map_json,
        {}
      ),
      autoScore: Number(row.auto_score ?? 0),
      manualScore: Number(row.manual_score ?? 0),
      totalAwardedMarks: Number(row.total_awarded_marks ?? 0),
      maxMarks: Number(row.max_marks ?? 0),
      scorePercent:
        row.score_percent === null || row.score_percent === undefined
          ? null
          : Number(row.score_percent),
      idempotencyKey: String(row.idempotency_key),
    };
  }

  private hydrateAnswerRow(row: Record<string, unknown>): AssessmentAnswerRecord {
    return {
      id: String(row.id),
      attemptId: String(row.attempt_id),
      snapshotId: String(row.snapshot_id),
      questionId: String(row.question_id),
      questionVersion: Number(row.question_version ?? 1),
      submittedAnswerText: row.submitted_answer_text ? String(row.submitted_answer_text) : null,
      submittedOptionIndex:
        row.submitted_option_index === null || row.submitted_option_index === undefined
          ? null
          : Number(row.submitted_option_index),
      isCorrect:
        row.is_correct === null || row.is_correct === undefined
          ? null
          : Number(row.is_correct) === 1,
      markingStatus: String(row.marking_status) as AssessmentAnswerRecord['markingStatus'],
      awardedMarks: Number(row.awarded_marks ?? 0),
      maxMarks: Number(row.max_marks ?? 1),
      graderId: row.grader_id ? String(row.grader_id) : null,
      graderComment: row.grader_comment ? String(row.grader_comment) : null,
      responseDurationMs: Number(row.response_duration_ms ?? 0),
      hintUsed: Number(row.hint_used ?? 0) === 1,
      answeredAt: String(row.answered_at),
    };
  }
}
