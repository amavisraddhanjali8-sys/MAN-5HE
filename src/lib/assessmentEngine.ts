import type { AuthorizationContext } from './authorization.ts';
import { canAccessSubject, resolveQuestionSubjectId } from './authorization.ts';
import { seededShuffle } from './psychometrics.ts';
import type {
  AssessmentSelectionMode,
  AssessmentStatus,
  DifficultyTier,
  QuestionApprovalStatus,
  QuestionHistoryFilterMode,
  QuestionType,
  QuizItem,
  StudentQuizView,
  UserRole,
} from './types.ts';

// --- Question Lifecycle State Machine ---
const QUESTION_TRANSITIONS: Record<QuestionApprovalStatus, QuestionApprovalStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED'],
  PENDING_REVIEW: ['APPROVED', 'ACTIVE', 'REJECTED', 'DRAFT'],
  APPROVED: ['ACTIVE', 'DRAFT', 'RETIRED'],
  ACTIVE: ['RETIRED', 'DRAFT'],
  REJECTED: ['DRAFT', 'PENDING_REVIEW', 'RETIRED'],
  RETIRED: ['DRAFT'],
};

export function validateQuestionTransition(params: {
  actorRole: UserRole;
  isAuthor: boolean;
  fromStatus: QuestionApprovalStatus;
  toStatus: QuestionApprovalStatus;
}): { ok: boolean; reason?: string } {
  const { actorRole, isAuthor, fromStatus, toStatus } = params;
  if (actorRole === 'student' || actorRole === 'parent') {
    return { ok: false, reason: 'Students and parents cannot alter question lifecycle states.' };
  }
  const allowedTargets = QUESTION_TRANSITIONS[fromStatus] || [];
  if (!allowedTargets.includes(toStatus)) {
    return {
      ok: false,
      reason: `Invalid question lifecycle transition from ${fromStatus} to ${toStatus}.`,
    };
  }
  if (actorRole === 'teacher') {
    // Teachers may submit their drafts/rejected items for review, move back to draft, or retire own draft
    if (toStatus === 'APPROVED' || toStatus === 'ACTIVE' || toStatus === 'REJECTED') {
      return {
        ok: false,
        reason: 'Only administrators can approve, activate, or reject questions for bank publication.',
      };
    }
    if (!isAuthor && fromStatus !== 'DRAFT') {
      return {
        ok: false,
        reason: 'Teachers can only modify lifecycle state of questions they authored.',
      };
    }
  }
  return { ok: true };
}

export function canActorModifyQuestion(params: {
  ctx: AuthorizationContext;
  question: QuizItem;
}): { canEdit: boolean; reason?: string } {
  const { ctx, question } = params;
  if (ctx.role === 'student' || ctx.role === 'parent') {
    return { canEdit: false, reason: 'Students and parents cannot edit questions.' };
  }
  const subjectId = resolveQuestionSubjectId(question);
  if (ctx.role === 'teacher' && !canAccessSubject(ctx, subjectId)) {
    return {
      canEdit: false,
      reason: 'Access denied: question subject is outside your assigned subjects.',
    };
  }
  if (ctx.role === 'admin') {
    return { canEdit: true };
  }
  // Teachers can edit questions in their assigned subjects if they authored them and they are DRAFT or REJECTED
  const status = question.approvalStatus || 'ACTIVE';
  const isOwner = !question.authorId || question.authorId === ctx.userId;
  if (!isOwner) {
    return {
      canEdit: false,
      reason: 'Teachers can only edit questions they authored; duplicate to propose a variant.',
    };
  }
  if (status === 'APPROVED' || status === 'ACTIVE' || status === 'RETIRED') {
    return {
      canEdit: false,
      reason: `Cannot directly edit a ${status} question as teacher; duplicate or create a new draft revision.`,
    };
  }
  return { canEdit: true };
}

// --- Assessment Lifecycle State Machine ---
const ASSESSMENT_TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  DRAFT: ['VALIDATED', 'APPROVED', 'PUBLISHED', 'ACTIVE', 'CANCELLED'],
  VALIDATED: ['APPROVED', 'PUBLISHED', 'ACTIVE', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'PUBLISHED', 'ACTIVE', 'DRAFT', 'CANCELLED'],
  SCHEDULED: ['PUBLISHED', 'ACTIVE', 'WITHDRAWN', 'CANCELLED'],
  PUBLISHED: ['ACTIVE', 'CLOSED', 'WITHDRAWN', 'ARCHIVED'],
  ACTIVE: ['CLOSED', 'WITHDRAWN', 'RESULTS_RELEASED'],
  CLOSED: ['RESULTS_RELEASED', 'ARCHIVED', 'ACTIVE'],
  RESULTS_RELEASED: ['ARCHIVED', 'CLOSED'],
  ARCHIVED: ['DRAFT'],
  CANCELLED: ['DRAFT'],
  WITHDRAWN: ['DRAFT', 'ARCHIVED'],
};

export function validateAssessmentTransition(params: {
  actorRole: UserRole;
  isAuthor: boolean;
  fromStatus: AssessmentStatus;
  toStatus: AssessmentStatus;
}): { ok: boolean; reason?: string } {
  if (params.actorRole === 'student' || params.actorRole === 'parent') {
    return { ok: false, reason: 'Students and parents cannot change assessment workflow state.' };
  }
  const allowed = ASSESSMENT_TRANSITIONS[params.fromStatus] || [];
  if (!allowed.includes(params.toStatus)) {
    return {
      ok: false,
      reason: `Invalid assessment transition from ${params.fromStatus} to ${params.toStatus}.`,
    };
  }
  if (params.actorRole === 'teacher' && !params.isAuthor) {
    return {
      ok: false,
      reason: 'Teachers can only manage assessments they authored inside their assigned subjects.',
    };
  }
  return { ok: true };
}

// --- Question Selection Engine ---
export interface QuestionSelectionRequest {
  pool: QuizItem[];
  ctx: AuthorizationContext;
  subjectIds: string[];
  topicIds?: string[];
  subtopicIds?: string[];
  grade?: string;
  questionTypes?: QuestionType[];
  cognitiveSkills?: string[];
  difficultyTiers?: DifficultyTier[];
  difficultyDistribution?: Partial<Record<DifficultyTier, number>>;
  learningObjectiveQuery?: string;
  minMarks?: number;
  maxMarks?: number;
  minEstimatedSeconds?: number;
  maxEstimatedSeconds?: number;
  historyMode?: QuestionHistoryFilterMode;
  attemptedQuestionIds?: Set<string>;
  incorrectQuestionIds?: Set<string>;
  repeatedErrorQuestionIds?: Set<string>;
  revisionDueQuestionIds?: Set<string>;
  weakTopicIds?: Set<string>;
  balanceByTopic?: boolean;
  count: number;
  mode: AssessmentSelectionMode;
  seed: number;
  includeDrafts?: boolean;
  excludedQuestionIds?: Set<string>;
  topicWeaknessWeights?: Map<string, number>;
}

export interface QuestionSelectionResult {
  selected: QuizItem[];
  eligibleCount: number;
  distributionApplied: Record<DifficultyTier, number>;
}

export function selectQuestionsForAssessment(
  req: QuestionSelectionRequest
): QuestionSelectionResult {
  const {
    pool,
    ctx,
    subjectIds,
    topicIds = [],
    subtopicIds = [],
    grade = 'Grade 5',
    questionTypes = [],
    cognitiveSkills = [],
    difficultyTiers = [],
    difficultyDistribution,
    learningObjectiveQuery = '',
    minMarks,
    maxMarks,
    minEstimatedSeconds,
    maxEstimatedSeconds,
    historyMode = 'all',
    attemptedQuestionIds,
    incorrectQuestionIds,
    repeatedErrorQuestionIds,
    revisionDueQuestionIds,
    weakTopicIds,
    balanceByTopic = false,
    count,
    mode,
    seed,
    includeDrafts = false,
    excludedQuestionIds,
    topicWeaknessWeights,
  } = req;

  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error('Assessment question count must be between 1 and 200.');
  }

  // Enforce authorization before selection
  if (ctx.role === 'teacher') {
    if (subjectIds.length === 0) {
      throw new Error('Teachers must specify at least one assigned subject.');
    }
    for (const sid of subjectIds) {
      if (!canAccessSubject(ctx, sid)) {
        throw new Error(`Subject ${sid} is outside your assigned teacher permissions.`);
      }
    }
  }

  const allowedSubjects = new Set(
    subjectIds.length > 0
      ? subjectIds
      : ctx.role === 'teacher'
      ? ctx.assignedSubjectIds
      : []
  );
  const topicFilter = new Set(topicIds.filter(Boolean));
  const subtopicFilter = new Set(subtopicIds.filter(Boolean));
  const typeFilter = new Set(questionTypes);
  const tierFilter = new Set(difficultyTiers);
  const skillFilter = new Set(cognitiveSkills.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const loNeedle = learningObjectiveQuery.trim().toLowerCase();

  // Strictly filter eligible pool; NEVER silently substitute unapproved/unauthorized items
  const seenIds = new Set<string>();
  const eligible: QuizItem[] = [];

  for (const q of pool) {
    if (seenIds.has(q.id)) continue;
    const subjId = resolveQuestionSubjectId(q);
    if (ctx.role === 'teacher' && !canAccessSubject(ctx, subjId)) continue;
    if (allowedSubjects.size > 0 && !allowedSubjects.has(subjId)) continue;
    if (topicFilter.size > 0 && (!q.topicId || !topicFilter.has(q.topicId))) continue;
    if (subtopicFilter.size > 0 && (!q.subtopicId || !subtopicFilter.has(q.subtopicId))) continue;

    const qGrade = q.grade || 'Grade 5';
    if (grade && grade !== 'All' && qGrade !== grade) continue;

    const approval = q.approvalStatus || 'ACTIVE';
    if (!includeDrafts && approval !== 'APPROVED' && approval !== 'ACTIVE') continue;

    const qType = q.questionType || 'mcq';
    if (typeFilter.size > 0 && !typeFilter.has(qType)) continue;

    if (tierFilter.size > 0 && !tierFilter.has(q.attributes.difficultyTier)) continue;

    if (skillFilter.size > 0) {
      const qSkill = (q.cognitiveSkill || q.attributes.cognitiveDomain || '').toLowerCase();
      if (!skillFilter.has(qSkill)) continue;
    }

    if (loNeedle) {
      const hay = `${q.learningObjectives || ''} ${q.memoryTrickTitle || ''} ${q.questionEn || ''}`.toLowerCase();
      if (!hay.includes(loNeedle)) continue;
    }

    const qMarks = Number(q.defaultMarks ?? 1);
    if (typeof minMarks === 'number' && qMarks < minMarks) continue;
    if (typeof maxMarks === 'number' && qMarks > maxMarks) continue;

    const qTime = Number(q.attributes.estimatedSeconds || 45);
    if (typeof minEstimatedSeconds === 'number' && qTime < minEstimatedSeconds) continue;
    if (typeof maxEstimatedSeconds === 'number' && qTime > maxEstimatedSeconds) continue;

    if (historyMode === 'unattempted' && attemptedQuestionIds?.has(q.id)) continue;
    if (historyMode === 'previously_attempted' && !attemptedQuestionIds?.has(q.id)) continue;
    if (historyMode === 'previously_incorrect' && !incorrectQuestionIds?.has(q.id)) continue;
    if (historyMode === 'repeated_error' && !repeatedErrorQuestionIds?.has(q.id)) continue;
    if (historyMode === 'revision_due' && !revisionDueQuestionIds?.has(q.id)) continue;
    if (historyMode === 'weak_areas' && weakTopicIds && weakTopicIds.size > 0) {
      if (!q.topicId || !weakTopicIds.has(q.topicId)) continue;
    }

    if (excludedQuestionIds && excludedQuestionIds.has(q.id)) continue;

    seenIds.add(q.id);
    eligible.push(q);
  }

  if (eligible.length < count) {
    throw new Error(
      `Insufficient eligible questions matching criteria: requested ${count}, but only ${eligible.length} approved/active question(s) are available without silent substitution.`
    );
  }

  const orderPool = (items: QuizItem[], localSeed: number): QuizItem[] => {
    if (mode === 'deterministic') {
      return [...items].sort((a, b) => a.id.localeCompare(b.id));
    }
    if (mode === 'adaptive_gap' && topicWeaknessWeights) {
      return [...items].sort((a, b) => {
        const wA = topicWeaknessWeights.get(a.topicId || '') || 0;
        const wB = topicWeaknessWeights.get(b.topicId || '') || 0;
        if (wB !== wA) return wB - wA;
        return a.id.localeCompare(b.id);
      });
    }
    if (balanceByTopic) {
      const shuffled = seededShuffle(items, localSeed);
      const buckets = new Map<string, QuizItem[]>();
      for (const it of shuffled) {
        const key = it.topicId || resolveQuestionSubjectId(it);
        const arr = buckets.get(key) || [];
        arr.push(it);
        buckets.set(key, arr);
      }
      const balanced: QuizItem[] = [];
      const keys = Array.from(buckets.keys());
      let added = true;
      while (added) {
        added = false;
        for (const k of keys) {
          const next = buckets.get(k)?.shift();
          if (next) {
            balanced.push(next);
            added = true;
          }
        }
      }
      return balanced;
    }
    return seededShuffle(items, localSeed);
  };

  let chosen: QuizItem[] = [];
  const chosenIds = new Set<string>();

  if (difficultyDistribution) {
    const tiers: DifficultyTier[] = ['Simple', 'Moderate', 'Challenging', 'Master'];
    let requestedFromTiers = 0;
    for (const tier of tiers) {
      const tierCount = Number(difficultyDistribution[tier] || 0);
      if (tierCount <= 0) continue;
      requestedFromTiers += tierCount;
      const tierPool = orderPool(
        eligible.filter((q) => q.attributes.difficultyTier === tier && !chosenIds.has(q.id)),
        seed + tiers.indexOf(tier) * 101
      );
      if (tierPool.length < tierCount) {
        throw new Error(
          `Insufficient ${tier} questions: requested ${tierCount}, found ${tierPool.length} matching criteria.`
        );
      }
      for (let i = 0; i < tierCount; i++) {
        chosen.push(tierPool[i]);
        chosenIds.add(tierPool[i].id);
      }
    }
    if (requestedFromTiers > count) {
      throw new Error(
        `Difficulty distribution sum (${requestedFromTiers}) exceeds requested question count (${count}).`
      );
    }
    if (chosen.length < count) {
      const remainder = orderPool(
        eligible.filter((q) => !chosenIds.has(q.id)),
        seed + 997
      );
      for (const item of remainder) {
        if (chosen.length >= count) break;
        chosen.push(item);
        chosenIds.add(item.id);
      }
    }
  } else {
    chosen = orderPool(eligible, seed).slice(0, count);
  }

  const distributionApplied: Record<DifficultyTier, number> = {
    Simple: 0,
    Moderate: 0,
    Challenging: 0,
    Master: 0,
  };
  for (const q of chosen) {
    distributionApplied[q.attributes.difficultyTier] += 1;
  }

  return {
    selected: chosen,
    eligibleCount: eligible.length,
    distributionApplied,
  };
}

// --- Deterministic Question & Option Shuffler (Grading-Safe) ---
export interface AttemptDeliveryPlan {
  shuffledSnapshotIds: string[];
  shuffledOptionsMap: Record<string, number[]>; // snapshotId -> array where index=displayIdx, value=originalOptionIdx
  studentQuestions: StudentQuizView[];
}

export function buildAttemptDeliveryOrder(params: {
  items: {
    snapshotId: string;
    sectionId: string;
    marks: number;
    snapshot: QuizItem;
  }[];
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showHints: boolean;
  seed: number;
}): AttemptDeliveryPlan {
  const ordered = params.shuffleQuestions
    ? seededShuffle(params.items, params.seed)
    : [...params.items];

  const shuffledSnapshotIds: string[] = [];
  const shuffledOptionsMap: Record<string, number[]> = {};
  const studentQuestions: StudentQuizView[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i];
    const q = entry.snapshot;
    const qType = q.questionType || 'mcq';
    shuffledSnapshotIds.push(entry.snapshotId);

    let optionMapping = [0, 1, 2, 3];
    if (params.shuffleOptions && qType === 'mcq') {
      optionMapping = seededShuffle([0, 1, 2, 3], params.seed + (i + 1) * 31);
    } else if (qType === 'true_false') {
      optionMapping = [0, 1];
    }
    shuffledOptionsMap[entry.snapshotId] = optionMapping;

    const displayedOptions = (
      qType === 'mcq'
        ? optionMapping.map((origIdx) => q.options[origIdx] || '')
        : qType === 'true_false'
        ? [q.options[0] || 'True', q.options[1] || 'False', '', '']
        : q.options
    ) as [string, string, string, string];

    studentQuestions.push({
      id: q.id,
      source: q.source,
      subjectId: q.subjectId,
      topicId: q.topicId,
      subtopicId: q.subtopicId,
      version: q.version,
      grade: q.grade || 'Grade 5',
      questionType: qType,
      marks: entry.marks,
      sectionId: entry.sectionId,
      snapshotId: entry.snapshotId,
      questionSi: q.questionSi,
      questionEn: q.questionEn,
      options: displayedOptions,
      imageUrl: q.imageUrl,
      attributes: q.attributes,
      hint: params.showHints ? q.hint : undefined,
      // Strictly omit correctIndex, acceptedAnswers, explanation, and memoryTrick before release
    });
  }

  return {
    shuffledSnapshotIds,
    shuffledOptionsMap,
    studentQuestions,
  };
}

// --- Multi-Type Grading Engine ---
export interface GradeAnswerResult {
  originalOptionIndex: number | null;
  submittedAnswerText: string | null;
  isCorrect: boolean | null;
  markingStatus: 'auto_graded' | 'pending_manual';
  awardedMarks: number;
}

export function gradeSubmittedAnswer(params: {
  question: QuizItem;
  marks: number;
  submittedDisplayOptionIndex?: number | null;
  submittedAnswerText?: string | null;
  optionMapping?: number[];
}): GradeAnswerResult {
  const qType = params.question.questionType || 'mcq';
  const marks = Math.max(1, Number(params.marks || params.question.defaultMarks || 1));

  if (qType === 'mcq' || qType === 'true_false') {
    const dispIdx =
      typeof params.submittedDisplayOptionIndex === 'number' &&
      Number.isInteger(params.submittedDisplayOptionIndex)
        ? params.submittedDisplayOptionIndex
        : null;

    if (dispIdx === null || dispIdx < 0) {
      return {
        originalOptionIndex: null,
        submittedAnswerText: null,
        isCorrect: false,
        markingStatus: 'auto_graded',
        awardedMarks: 0,
      };
    }

    const mapping = params.optionMapping;
    const origIdx =
      mapping && dispIdx < mapping.length ? mapping[dispIdx] : dispIdx;
    const isCorrect = origIdx === params.question.correctIndex;
    return {
      originalOptionIndex: origIdx,
      submittedAnswerText: params.question.options[origIdx] ?? null,
      isCorrect,
      markingStatus: 'auto_graded',
      awardedMarks: isCorrect ? marks : 0,
    };
  }

  const rawText = (params.submittedAnswerText ?? '').trim();
  if (!rawText) {
    return {
      originalOptionIndex: null,
      submittedAnswerText: null,
      isCorrect: false,
      markingStatus: params.question.markingRule?.requiresManualReview
        ? 'pending_manual'
        : 'auto_graded',
      awardedMarks: 0,
    };
  }

  if (qType === 'numerical') {
    const submittedNum = Number(rawText.replace(/,/g, ''));
    const accepted = params.question.acceptedAnswers?.length
      ? params.question.acceptedAnswers
      : [params.question.options[params.question.correctIndex] || ''];
    const tolerance = Number(params.question.markingRule?.numericTolerance ?? 0.001);

    if (!Number.isFinite(submittedNum)) {
      return {
        originalOptionIndex: null,
        submittedAnswerText: rawText,
        isCorrect: false,
        markingStatus: 'auto_graded',
        awardedMarks: 0,
      };
    }

    const isMatch = accepted.some((ans) => {
      const target = Number(String(ans).replace(/,/g, '').trim());
      return Number.isFinite(target) && Math.abs(submittedNum - target) <= tolerance;
    });

    return {
      originalOptionIndex: null,
      submittedAnswerText: rawText,
      isCorrect: isMatch,
      markingStatus: 'auto_graded',
      awardedMarks: isMatch ? marks : 0,
    };
  }

  // short_answer
  if (params.question.markingRule?.requiresManualReview) {
    return {
      originalOptionIndex: null,
      submittedAnswerText: rawText,
      isCorrect: null,
      markingStatus: 'pending_manual',
      awardedMarks: 0,
    };
  }

  const caseSensitive = Boolean(params.question.markingRule?.caseSensitive);
  const normalize = (val: string) =>
    caseSensitive ? val.trim() : val.trim().toLowerCase().replace(/\s+/g, ' ');
  const acceptedList = params.question.acceptedAnswers?.length
    ? params.question.acceptedAnswers
    : [params.question.options[params.question.correctIndex] || ''];

  const isMatch = acceptedList.some((ans) => normalize(ans) === normalize(rawText));
  return {
    originalOptionIndex: null,
    submittedAnswerText: rawText,
    isCorrect: isMatch,
    markingStatus: 'auto_graded',
    awardedMarks: isMatch ? marks : 0,
  };
}

// --- CSV / JSON Bulk Question Parser ---
export interface ParsedBulkQuestionInput {
  rowNumber: number;
  subjectId: string;
  topicId?: string;
  subtopicId?: string;
  grade: string;
  questionType: QuestionType;
  questionSi: string;
  questionEn: string;
  options: [string, string, string, string];
  correctIndex: number;
  acceptedAnswers: string[];
  markingRule?: QuizItem['markingRule'];
  defaultMarks: number;
  cognitiveSkill: string;
  learningObjectives: string;
  hint: string;
  memoryTrickTitle: string;
  memoryTrickBody: string;
  explanation: string;
  estimatedSeconds: number;
  difficultyTier?: DifficultyTier;
  initialStatus: QuestionApprovalStatus;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseBulkQuestionsPayload(params: {
  format: 'json' | 'csv';
  content: string;
  defaultSubjectId?: string;
  defaultStatus?: QuestionApprovalStatus;
}): { items: ParsedBulkQuestionInput[]; errors: { rowNumber: number; error: string }[] } {
  const items: ParsedBulkQuestionInput[] = [];
  const errors: { rowNumber: number; error: string }[] = [];
  const defaultStatus = params.defaultStatus || 'DRAFT';

  if (params.format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(params.content);
    } catch {
      return { items: [], errors: [{ rowNumber: 0, error: 'Invalid JSON syntax.' }] };
    }
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed as { questions?: unknown[] })?.questions;
    if (!Array.isArray(arr)) {
      return {
        items: [],
        errors: [{ rowNumber: 0, error: 'Expected JSON array or { questions: [...] }.' }],
      };
    }

    arr.forEach((raw, idx) => {
      const rowNum = idx + 1;
      const obj = (raw || {}) as Record<string, unknown>;
      const subjectId = String(obj.subjectId || params.defaultSubjectId || '').trim();
      const questionSi = String(obj.questionSi || obj.question || '').trim();
      const qType = (String(obj.questionType || 'mcq') as QuestionType);
      const memoryTrickBody = String(
        obj.memoryTrickBody || 'Use visual chunking and step-by-step checking.'
      ).trim();

      if (!subjectId || !questionSi) {
        errors.push({ rowNumber: rowNum, error: 'Missing subjectId or question prompt.' });
        return;
      }
      if (!['mcq', 'numerical', 'true_false', 'short_answer'].includes(qType)) {
        errors.push({ rowNumber: rowNum, error: `Unsupported questionType: ${qType}` });
        return;
      }

      const rawOpts = Array.isArray(obj.options) ? obj.options.map(String) : [];
      const options: [string, string, string, string] =
        qType === 'true_false'
          ? [rawOpts[0] || 'True', rawOpts[1] || 'False', '', '']
          : [
              rawOpts[0] || '',
              rawOpts[1] || '',
              rawOpts[2] || '',
              rawOpts[3] || '',
            ];

      if (qType === 'mcq' && options.some((o) => !o.trim())) {
        errors.push({ rowNumber: rowNum, error: 'MCQ requires 4 non-empty options.' });
        return;
      }

      const acceptedAnswers = Array.isArray(obj.acceptedAnswers)
        ? obj.acceptedAnswers.map((a) => String(a).trim()).filter(Boolean)
        : obj.acceptedAnswer
        ? [String(obj.acceptedAnswer).trim()]
        : [];
      const markingRule =
        obj.markingRule && typeof obj.markingRule === 'object'
          ? (obj.markingRule as QuizItem['markingRule'])
          : undefined;
      const requiresManualReview = Boolean(markingRule?.requiresManualReview);

      if (
        (qType === 'numerical' || qType === 'short_answer') &&
        acceptedAnswers.length === 0 &&
        !requiresManualReview
      ) {
        errors.push({
          rowNumber: rowNum,
          error: `${qType} requires acceptedAnswers or acceptedAnswer unless requiresManualReview is true.`,
        });
        return;
      }

      items.push({
        rowNumber: rowNum,
        subjectId,
        topicId: obj.topicId ? String(obj.topicId).trim() : undefined,
        subtopicId: obj.subtopicId ? String(obj.subtopicId).trim() : undefined,
        grade: String(obj.grade || 'Grade 5').trim(),
        questionType: qType,
        questionSi,
        questionEn: String(obj.questionEn || questionSi).trim(),
        options,
        correctIndex: Math.max(0, Math.min(3, Number(obj.correctIndex ?? 0))),
        acceptedAnswers,
        markingRule,
        defaultMarks: Math.max(1, Number(obj.defaultMarks ?? 1)),
        cognitiveSkill: String(obj.cognitiveSkill || 'Application').trim(),
        learningObjectives: String(obj.learningObjectives || '').trim(),
        hint: String(obj.hint || '').trim(),
        memoryTrickTitle: String(obj.memoryTrickTitle || 'Memory Technique').trim(),
        memoryTrickBody,
        explanation: String(obj.explanation || 'Grade 5 scholarship rubric solution.').trim(),
        estimatedSeconds: Math.max(10, Number(obj.estimatedSeconds ?? 40)),
        difficultyTier: obj.difficultyTier as DifficultyTier | undefined,
        initialStatus: (obj.approvalStatus as QuestionApprovalStatus) || defaultStatus,
      });
    });

    return { items, errors };
  }

  // CSV parsing: expected header columns (order-flexible by header name)
  const lines = params.content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return {
      items: [],
      errors: [{ rowNumber: 0, error: 'CSV must include a header row and at least one question row.' }],
    };
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const colIdx = (name: string) => headers.indexOf(name.toLowerCase());

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const get = (name: string) => {
      const idx = colIdx(name);
      return idx >= 0 && idx < cols.length ? cols[idx] : '';
    };

    const subjectId = get('subjectId') || params.defaultSubjectId || '';
    const questionSi = get('questionSi') || get('question');
    const qType = (get('questionType') || 'mcq') as QuestionType;
    if (!subjectId || !questionSi) {
      errors.push({ rowNumber: i + 1, error: 'Missing subjectId or questionSi.' });
      continue;
    }
    if (!['mcq', 'numerical', 'true_false', 'short_answer'].includes(qType)) {
      errors.push({ rowNumber: i + 1, error: `Unsupported questionType: ${qType}` });
      continue;
    }

    const pipeOptions = get('options')
      ? get('options').split('|').map((s) => s.trim())
      : [];
    const options: [string, string, string, string] =
      qType === 'true_false'
        ? [
            get('optionA') || pipeOptions[0] || 'True',
            get('optionB') || pipeOptions[1] || 'False',
            '',
            '',
          ]
        : [
            get('optionA') || pipeOptions[0] || '',
            get('optionB') || pipeOptions[1] || '',
            get('optionC') || pipeOptions[2] || '',
            get('optionD') || pipeOptions[3] || '',
          ];
    if (qType === 'mcq' && options.some((o) => !o)) {
      errors.push({
        rowNumber: i + 1,
        error: 'MCQ CSV row requires optionA..optionD or pipe-delimited options (A|B|C|D).',
      });
      continue;
    }

    const acceptedRaw = get('acceptedAnswers') || get('acceptedAnswer');
    const acceptedAnswers = acceptedRaw
      ? acceptedRaw.split('|').map((s) => s.trim()).filter(Boolean)
      : [];
    const requiresManualReview = get('requiresManualReview').toLowerCase() === 'true';
    const tolStr = get('numericTolerance');
    const markingRule: QuizItem['markingRule'] | undefined =
      requiresManualReview || tolStr
        ? {
            requiresManualReview,
            ...(tolStr ? { numericTolerance: Number(tolStr) } : {}),
          }
        : undefined;

    if (
      (qType === 'numerical' || qType === 'short_answer') &&
      acceptedAnswers.length === 0 &&
      !requiresManualReview
    ) {
      errors.push({
        rowNumber: i + 1,
        error: `${qType} CSV row requires acceptedAnswers unless requiresManualReview is true.`,
      });
      continue;
    }

    items.push({
      rowNumber: i + 1,
      subjectId,
      topicId: get('topicId') || undefined,
      subtopicId: get('subtopicId') || undefined,
      grade: get('grade') || 'Grade 5',
      questionType: qType,
      questionSi,
      questionEn: get('questionEn') || questionSi,
      options,
      correctIndex: Math.max(0, Math.min(3, Number(get('correctIndex') || 0))),
      acceptedAnswers,
      markingRule,
      defaultMarks: Math.max(1, Number(get('defaultMarks') || 1)),
      cognitiveSkill: get('cognitiveSkill') || 'Application',
      learningObjectives: get('learningObjectives'),
      hint: get('hint'),
      memoryTrickTitle: get('memoryTrickTitle') || 'Memory Technique',
      memoryTrickBody: get('memoryTrickBody') || 'Apply step-by-step reasoning and verify.',
      explanation: get('explanation') || 'Grade 5 scholarship rubric solution.',
      estimatedSeconds: Math.max(10, Number(get('estimatedSeconds') || 40)),
      difficultyTier: (get('difficultyTier') || undefined) as DifficultyTier | undefined,
      initialStatus: defaultStatus,
    });
  }

  return { items, errors };
}
