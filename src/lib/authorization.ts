import type {
  CognitiveDomain,
  InterventionCase,
  QuestionAttempt,
  QuizItem,
  SubjectCategory,
  UserRole,
} from './types.ts';

export interface AuthorizationContext {
  userId: string;
  role: UserRole;
  assignedSubjectIds: string[];
}

export const DOMAIN_TO_SUBJECT_ID: Record<CognitiveDomain, string> = {
  'Mathematics & Word Problems': 'subj-math',
  'Logical & Number Patterns': 'subj-logic',
  'Sinhala Language & Proverbs': 'subj-sinhala',
  'Spatial & Geometric IQ': 'subj-spatial',
  'Environmental Studies (පරිසරය)': 'subj-env',
  'English & Comprehension': 'subj-english',
};

export function resolveQuestionSubjectId(
  question: Pick<QuizItem, 'subjectId' | 'attributes'>
): string {
  if (question.subjectId) return question.subjectId;
  return DOMAIN_TO_SUBJECT_ID[question.attributes.cognitiveDomain] || 'subj-math';
}

export function canAccessSubject(
  ctx: AuthorizationContext,
  subjectId: string
): boolean {
  if (ctx.role === 'admin') return true;
  if (ctx.role === 'teacher') {
    return ctx.assignedSubjectIds.includes(subjectId);
  }
  return false;
}

export function getAuthorizedSubjectIds(
  ctx: AuthorizationContext,
  allSubjects: SubjectCategory[]
): string[] {
  if (ctx.role === 'admin' || ctx.role === 'student' || ctx.role === 'parent') {
    return allSubjects.filter((s) => s.active).map((s) => s.id);
  }
  const activeSet = new Set(allSubjects.filter((s) => s.active).map((s) => s.id));
  return ctx.assignedSubjectIds.filter((id) => activeSet.has(id));
}

export function canAccessQuestion(
  ctx: AuthorizationContext,
  question: Pick<QuizItem, 'subjectId' | 'attributes'>
): boolean {
  if (ctx.role === 'admin') return true;
  if (ctx.role === 'student') return true;
  if (ctx.role !== 'teacher') return false;
  const currentSubjectId = resolveQuestionSubjectId(question);
  return ctx.assignedSubjectIds.includes(currentSubjectId);
}

export function filterAuthorizedQuestions<T extends Pick<QuizItem, 'subjectId' | 'attributes'>>(
  questions: T[],
  ctx: AuthorizationContext
): T[] {
  if (ctx.role === 'admin' || ctx.role === 'student') return questions;
  if (ctx.role !== 'teacher') return [];
  const allowed = new Set(ctx.assignedSubjectIds);
  return questions.filter((q) => allowed.has(resolveQuestionSubjectId(q)));
}

export function filterAuthorizedAttempts(
  attempts: QuestionAttempt[],
  ctx: AuthorizationContext,
  questionSubjectLookup?: Map<string, string>
): QuestionAttempt[] {
  if (ctx.role === 'admin') return attempts;
  if (ctx.role === 'student') {
    return attempts.filter((a) => a.studentId === ctx.userId);
  }
  if (ctx.role !== 'teacher') return [];
  const allowed = new Set(ctx.assignedSubjectIds);
  return attempts.filter((a) => {
    // Follow the question's current subject authorization scope if moved, otherwise attempt's subjectId
    const effectiveSubjectId = questionSubjectLookup?.get(a.questionId) || a.subjectId;
    return allowed.has(effectiveSubjectId);
  });
}

export function filterAuthorizedInterventionCases(
  cases: InterventionCase[],
  ctx: AuthorizationContext,
  questionSubjectLookup?: Map<string, string>
): InterventionCase[] {
  if (ctx.role === 'admin') return cases;
  if (ctx.role === 'student') {
    return cases.filter((c) => c.studentId === ctx.userId);
  }
  if (ctx.role !== 'teacher') return [];
  const allowed = new Set(ctx.assignedSubjectIds);
  return cases.filter((c) => {
    const effectiveSubjectId = questionSubjectLookup?.get(c.questionId) || c.subjectId;
    return allowed.has(effectiveSubjectId);
  });
}

export function canViewStudentRecord(
  ctx: AuthorizationContext,
  targetStudentId: string,
  studentAttemptSubjectIds: string[]
): boolean {
  if (ctx.role === 'admin') return true;
  if (ctx.role === 'student') return ctx.userId === targetStudentId;
  const allowed = new Set(ctx.assignedSubjectIds);
  return studentAttemptSubjectIds.some((sid) => allowed.has(sid));
}
