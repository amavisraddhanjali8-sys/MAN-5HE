import type {
  AcademicConfig,
  AssessmentAttemptRecord,
  AssessmentAttemptStatus,
  AssessmentConfig,
  AssessmentKind,
  AssessmentRecord,
  AssessmentSection,
  AssessmentSelectionMode,
  AssessmentSnapshotItem,
  AssessmentStatus,
  AttemptContextMode,
  AttemptRecord,
  AttemptSubmissionStatus,
  AuditLogRecord,
  DifficultyTier,
  EmailLog,
  ExamPaper,
  ExplanationTiming,
  InterventionAction,
  InterventionCase,
  InterventionStatus,
  InterventionTemplate,
  InvoiceRecord,
  KnowledgeAnalyticsSummary,
  KnowledgeDiscoveryCandidate,
  KnowledgePublication,
  KnowledgeType,
  NotificationPreferences,
  NotificationRecord,
  PaperQualitySummary,
  PaymentPlan,
  PublicationCampaign,
  PublicationDelivery,
  PublicationEngagementType,
  PublicationLanguage,
  PublicationResource,
  PublicationReviewAction,
  PublicationStatus,
  PublicationVersion,
  QuestionApprovalStatus,
  QuestionAttempt,
  QuestionMarkingRule,
  QuestionPerformanceMetrics,
  QuestionReviewActionRecord,
  QuestionType,
  QuizItem,
  StudentQuizView,
  StudentTrajectory,
  SubjectCategory,
  SubtopicNode,
  TopicNode,
  UserRole,
  ValidationChecklist,
  WhatsAppLog,
} from './types';
import type { PracticeLevelMode, ProficiencyStreamConfig } from './practiceAdaptive';
import type { StudentImprovementSummary } from './questionIntelligence';

export interface AuthUser {
  id: string;
  userIdCode: string;
  name: string;
  email: string;
  whatsappNumber: string;
  role: UserRole;
  grade?: string;
  delegatedPublishSubjects?: string[];
  active?: boolean;
  guardianName?: string;
  guardianContactVerified?: boolean;
  guardianConsentGiven?: boolean;
  notificationPreferences?: NotificationPreferences;
  assignedSubjectIds?: string[];
  emailVerified: boolean;
  totpEnabled: boolean;
  subscriptionStatus: 'trial' | 'active';
  subscriptionPlanId: string | null;
  subscriptionExpiresAt: string | null;
  currentLevel: string;
  stars: number;
  streakDays: number;
  lastPracticeDate?: string | null;
  dailyGoalQuestions?: number;
  createdAt: string;
}

export interface ScopedAnalyticsResponse {
  scopeRole: UserRole;
  authorizedSubjectIds: string[];
  kpis: {
    totalRecordedEvents: number;
    validAttemptCount: number;
    skippedCount: number;
    timedOutCount: number;
    uniqueStudents: number;
    correctAttemptCount: number;
    incorrectAttemptCount: number;
    overallCorrectRate: number;
    overallIncorrectRate: number;
    avgResponseMs: number;
    activeInterventionsCount: number;
    resolvedInterventionsCount: number;
  };
  interventionCounts: {
    open: number;
    underReview: number;
    assigned: number;
    monitoring: number;
    resolved: number;
    dismissed: number;
    readyForTeacherReview: number;
  };
  attemptTrendSeries: {
    date: string;
    valid: number;
    correct: number;
    incorrect: number;
    correctRate: number;
  }[];
  mostIncorrectQuestions: (QuestionPerformanceMetrics & {
    questionSi: string;
    questionEn: string;
    subjectId: string;
    subjectName: string;
    topicId: string;
    topicName: string;
    difficultyTier: string;
    openCaseCount: number;
  })[];
  mostAttemptedQuestions: (QuestionPerformanceMetrics & {
    questionSi: string;
    questionEn: string;
    subjectId: string;
    subjectName: string;
    topicId: string;
    topicName: string;
    difficultyTier: string;
    openCaseCount: number;
  })[];
  difficultTopics: {
    topicId: string;
    topicName: string;
    subjectId: string;
    subjectName: string;
    valid: number;
    incorrect: number;
    correct: number;
    incorrectRate: number;
    correctRate: number;
  }[];
  studentPerformance: {
    studentId: string;
    studentName: string;
    userIdCode: string;
    validAttempts: number;
    correctAttempts: number;
    incorrectAttempts: number;
    accuracyPercent: number;
    openInterventionsCount: number;
    improvement: StudentImprovementSummary;
  }[];
  teacherActivity: (AuthUser & {
    activeCaseCount: number;
    resolvedCaseCount: number;
    actionsTakenCount: number;
  })[];
  ethicalFramingNote: string;
}

export interface QuestionDetailIntelligenceResponse {
  question: QuizItem & {
    subjectName: string;
    topicName: string;
    subtopicName: string;
  };
  metrics: QuestionPerformanceMetrics;
  versions: {
    id: string;
    version: number;
    subjectId: string;
    topicId: string;
    subtopicId: string;
    changedBy: string;
    changeNote: string;
    createdAt: string;
  }[];
  studentHistories: {
    studentId: string;
    studentName: string;
    userIdCode: string;
    validAttempts: number;
    correctCount: number;
    incorrectCount: number;
    skippedCount: number;
    lastAttemptAt: string;
    recentOutcomes: {
      isCorrect: boolean | null;
      status: string;
      timestamp: string;
      hintUsed: boolean;
      durationMs: number;
    }[];
  }[];
  relatedCases: InterventionCase[];
  ethicalFramingNote: string;
}

export interface EnrichedInterventionCase extends InterventionCase {
  studentName: string;
  studentCode: string;
  assignedTeacherName: string;
  subjectName: string;
  topicName: string;
  questionSi: string;
  difficultyTier: string;
}

export interface InterventionCaseDetailResponse {
  caseDetail: InterventionCase & {
    subjectName: string;
    topicName: string;
    prerequisiteTopicId: string | null;
    studentName: string;
    studentCode: string;
    guardianName: string;
    guardianContactVerified: boolean;
    guardianConsentGiven: boolean;
  };
  question: QuizItem | null;
  actions: InterventionAction[];
  studentAttemptsOnQuestion: QuestionAttempt[];
  improvement: StudentImprovementSummary;
  templates: InterventionTemplate[];
}

export interface StudentInterventionInstruction extends InterventionCase {
  teacherName: string;
  subjectName: string;
  topicName: string;
}

const TOKEN_KEY = 'man5he_session_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getAuthConfig: () =>
    apiRequest<{ enableEmailOtp: boolean; enableTotp: boolean; mfaRequired: boolean }>(
      '/api/auth/config'
    ),

  getCaptcha: () =>
    apiRequest<{ captchaToken: string; svgMarkup: string; promptHint: string }>(
      '/api/auth/captcha'
    ),

  registerInit: (body: Record<string, unknown>) =>
    apiRequest<{
      mfaRequired?: boolean;
      token?: string;
      user?: AuthUser;
      registrationId?: string;
      totpSecret?: string;
      otpAuthUri?: string;
      qrDataUrl?: string;
      message?: string;
    }>('/api/auth/register/init', { method: 'POST', body: JSON.stringify(body) }),

  registerVerify: (body: { registrationId: string; emailOtp: string; totpCode: string }) =>
    apiRequest<{ token: string; user: AuthUser }>('/api/auth/register/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  loginStep1: (body: Record<string, unknown>) =>
    apiRequest<{
      mfaRequired?: boolean;
      token?: string;
      user?: AuthUser;
      loginChallengeId?: string;
      maskedEmail?: string;
      userName?: string;
      message?: string;
    }>('/api/auth/login/step1', { method: 'POST', body: JSON.stringify(body) }),

  loginStep2: (body: { loginChallengeId: string; emailOtp: string; totpCode: string }) =>
    apiRequest<{ token: string; user: AuthUser }>('/api/auth/login/step2', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSandboxInbox: (email?: string) =>
    apiRequest<{ emails: EmailLog[] }>(
      `/api/auth/sandbox-inbox${email ? `?email=${encodeURIComponent(email)}` : ''}`
    ),

  getDemoTotpHelper: (identifier: string) =>
    apiRequest<{
      userIdCode: string;
      email: string;
      totpSecret: string;
      qrDataUrl: string;
      currentCode: string;
    }>(`/api/auth/demo-totp-helper?identifier=${encodeURIComponent(identifier)}`),

  getMe: () =>
    apiRequest<{ user: AuthUser; totpSetup: { secret: string; qrDataUrl: string } }>(
      '/api/auth/me'
    ),

  getPlans: () => apiRequest<{ plans: PaymentPlan[] }>('/api/payments/plans'),

  requestPaymentOtp: () =>
    apiRequest<{ paymentOtpChallengeId: string; message: string }>(
      '/api/payments/request-otp',
      { method: 'POST' }
    ),

  createCheckout: (body: {
    planId: string;
    gateway: string;
    paymentOtpChallengeId?: string;
    emailOtp?: string;
    totpCode?: string;
  }) =>
    apiRequest<{
      checkoutPayload: {
        merchantId: string;
        orderId: string;
        amountLkr: number;
        currency: string;
        gateway: string;
        planName: string;
        signature: string;
      };
    }>('/api/payments/create-checkout', { method: 'POST', body: JSON.stringify(body) }),

  confirmCheckoutWebhook: (body: { orderId: string; signature: string }) =>
    apiRequest<{ user: AuthUser; invoice: InvoiceRecord }>(
      '/api/payments/webhook/confirm',
      { method: 'POST', body: JSON.stringify(body) }
    ),

  getInvoices: () => apiRequest<{ invoices: InvoiceRecord[] }>('/api/payments/invoices'),

  getQuizStats: () =>
    apiRequest<{
      totalPoolCount: number;
      virtualPoolCount: number;
      curatedCount: number;
      papersCount: number;
    }>('/api/quizzes/stats'),

  getHierarchy: () =>
    apiRequest<{
      subjects: SubjectCategory[];
      topics: TopicNode[];
      subtopics: SubtopicNode[];
    }>('/api/subjects/hierarchy'),

  getPracticeRound: (params: {
    tier?: string;
    levelMode?: PracticeLevelMode;
    proficiency?: string;
    domain?: string;
    subjectId?: string;
    topicId?: string;
    subtopicId?: string;
    questionId?: string;
    count?: number;
    seed?: number;
  }) => {
    const q = new URLSearchParams();
    if (params.tier) q.set('tier', params.tier);
    if (params.levelMode) q.set('levelMode', params.levelMode);
    if (params.proficiency) q.set('proficiency', params.proficiency);
    if (params.domain) q.set('domain', params.domain);
    if (params.subjectId) q.set('subjectId', params.subjectId);
    if (params.topicId) q.set('topicId', params.topicId);
    if (params.subtopicId) q.set('subtopicId', params.subtopicId);
    if (params.questionId) q.set('questionId', params.questionId);
    if (params.count) q.set('count', String(params.count));
    if (params.seed) q.set('seed', String(params.seed));
    return apiRequest<{
      seed: number;
      subscriptionStatus: string;
      totalAvailablePool: number;
      streamConfig: ProficiencyStreamConfig | null;
      quizzes: QuizItem[];
    }>(`/api/quizzes/practice-round?${q.toString()}`);
  },

  submitQuestionAttempt: (body: {
    questionId: string;
    submittedAnswerIndex: number | null;
    submissionStatus?: AttemptSubmissionStatus;
    responseDurationMs: number;
    hintUsed?: boolean;
    contextMode: AttemptContextMode;
    sessionId: string;
    deliveryContext?: Record<string, unknown>;
    idempotencyKey: string;
    awardPracticeXp?: boolean;
  }) =>
    apiRequest<{
      attempt: QuestionAttempt;
      deduplicated: boolean;
      interventionCase: InterventionCase | null;
      caseEvent: string;
      user: AuthUser;
    }>('/api/attempts/submit', { method: 'POST', body: JSON.stringify(body) }),

  completePracticeRound: (body: {
    totalQuestions: number;
    correctCount: number;
    timeSpentSeconds: number;
    domainBreakdown: Record<string, { correct: number; total: number }>;
  }) =>
    apiRequest<{ attempt: AttemptRecord; trajectory: StudentTrajectory; user: AuthUser }>(
      '/api/quizzes/practice-complete',
      { method: 'POST', body: JSON.stringify(body) }
    ),

  getPapers: () => apiRequest<{ papers: ExamPaper[] }>('/api/papers'),

  startPaper: (paperId: string) =>
    apiRequest<{
      sessionId: string;
      paper: ExamPaper;
      timeLimitSeconds: number;
      questions: StudentQuizView[];
    }>(`/api/papers/${encodeURIComponent(paperId)}/start`),

  submitPaper: (
    paperId: string,
    body: {
      sessionId: string;
      answers: Record<string, number>;
      perQuestionDurationsMs?: Record<string, number>;
      timedOut?: boolean;
    }
  ) =>
    apiRequest<{
      attempt: AttemptRecord;
      trajectory: StudentTrajectory;
      reviewItems: {
        quizId: string;
        questionSi: string;
        selectedIndex: number | null;
        correctIndex: number;
        isCorrect: boolean;
        memoryTrickTitle: string;
        memoryTrickBody: string;
        explanation: string;
      }[];
      user: AuthUser;
      timedOutNotice: boolean;
    }>(`/api/papers/${encodeURIComponent(paperId)}/submit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getStudentAnalytics: () =>
    apiRequest<{
      user: AuthUser;
      attempts: AttemptRecord[];
      trajectory: StudentTrajectory;
      recentQuestionAnalytics?: ScopedAnalyticsResponse;
    }>('/api/analytics/student'),

  updateDailyStudyGoal: (targetQuestions: number) =>
    apiRequest<{ user: AuthUser; dailyGoalQuestions: number }>(
      '/api/analytics/daily-goal',
      {
        method: 'PATCH',
        body: JSON.stringify({ targetQuestions }),
      }
    ),

  getScopedAnalytics: (filters: {
    subjectId?: string;
    topicId?: string;
    subtopicId?: string;
    questionId?: string;
    difficulty?: string;
    dateFrom?: string;
    dateTo?: string;
    studentId?: string;
    interventionStatus?: string;
  } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v && v !== 'All') q.set(k, v);
    }
    const qs = q.toString();
    return apiRequest<ScopedAnalyticsResponse>(`/api/analytics/scoped${qs ? `?${qs}` : ''}`);
  },

  getAdminAnalytics: () =>
    apiRequest<{
      totalStudents: number;
      activePaidStudents: number;
      totalQuizCapacity: number;
      curatedQuizzesCount: number;
      papersCount: number;
      totalAttempts: number;
      averagePlatformScore: number;
      totalRevenueLkr: number;
      recentAttempts: AttemptRecord[];
      students: (AuthUser & { attemptCount: number; trajectory: StudentTrajectory })[];
    }>('/api/analytics/admin'),

  getAdminQuizzes: (params: {
    source?: string;
    subjectId?: string;
    topicId?: string;
    subtopicId?: string;
    domain?: string;
    difficulty?: string;
    grade?: string;
    questionType?: string;
    approvalStatus?: string;
    cognitiveSkill?: string;
    authorId?: string;
    performanceFlag?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const q = new URLSearchParams();
    if (params.source) q.set('source', params.source);
    if (params.subjectId) q.set('subjectId', params.subjectId);
    if (params.topicId) q.set('topicId', params.topicId);
    if (params.subtopicId) q.set('subtopicId', params.subtopicId);
    if (params.domain) q.set('domain', params.domain);
    if (params.difficulty) q.set('difficulty', params.difficulty);
    if (params.grade) q.set('grade', params.grade);
    if (params.questionType) q.set('questionType', params.questionType);
    if (params.approvalStatus) q.set('approvalStatus', params.approvalStatus);
    if (params.cognitiveSkill) q.set('cognitiveSkill', params.cognitiveSkill);
    if (params.authorId) q.set('authorId', params.authorId);
    if (params.performanceFlag) q.set('performanceFlag', params.performanceFlag);
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    return apiRequest<{
      totalVirtualPool: number;
      curatedCount: number;
      quizzes: (QuizItem & {
        stats?: {
          validAttempts: number;
          uniqueStudents: number;
          correctRate: number;
          incorrectRate: number;
          repeatedErrorStudentCount: number;
          skippedCount: number;
          timedOutCount: number;
          medianResponseMs: number;
        };
      })[];
    }>(`/api/admin/quizzes?${q.toString()}`);
  },

  getQuestionDetailIntelligence: (questionId: string) =>
    apiRequest<QuestionDetailIntelligenceResponse>(
      `/api/questions/${encodeURIComponent(questionId)}/intelligence`
    ),

  reassignQuestionSubject: (
    questionId: string,
    body: { subjectId: string; topicId?: string; subtopicId?: string; changeNote?: string }
  ) =>
    apiRequest<{ quiz: QuizItem }>(
      `/api/questions/${encodeURIComponent(questionId)}/reassign-subject`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  createQuiz: (body: Record<string, unknown>) =>
    apiRequest<{ quiz: QuizItem }>('/api/quizzes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteQuiz: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/quizzes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  previewPaperQuality: (quizIds: string[]) =>
    apiRequest<{ qualitySummary: PaperQualitySummary }>('/api/papers/preview-quality', {
      method: 'POST',
      body: JSON.stringify({ quizIds }),
    }),

  createPaper: (body: {
    title: string;
    titleSi: string;
    description: string;
    durationMinutes: number;
    quizIds: string[];
  }) =>
    apiRequest<{ paper: ExamPaper }>('/api/papers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getTeachers: () =>
    apiRequest<{
      teachers: (AuthUser & {
        activeCaseCount: number;
        resolvedCaseCount: number;
        actionsTakenCount: number;
      })[];
    }>('/api/admin/teachers'),

  createTeacher: (body: {
    name: string;
    email: string;
    userIdCode?: string;
    whatsappNumber?: string;
    password: string;
    subjectIds: string[];
  }) =>
    apiRequest<{ teacher: AuthUser }>('/api/admin/teachers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  setTeacherSubjects: (teacherId: string, subjectIds: string[]) =>
    apiRequest<{ teacher: AuthUser }>(
      `/api/admin/teachers/${encodeURIComponent(teacherId)}/subjects`,
      { method: 'PUT', body: JSON.stringify({ subjectIds }) }
    ),

  updateTeacherStatus: (teacherId: string, active: boolean) =>
    apiRequest<{ teacher: AuthUser }>(
      `/api/admin/teachers/${encodeURIComponent(teacherId)}/status`,
      { method: 'PATCH', body: JSON.stringify({ active }) }
    ),

  getScopedStudents: () =>
    apiRequest<{
      students: (AuthUser & {
        scopedValidAttempts: number;
        scopedAccuracyPercent: number;
        openInterventionsCount: number;
        improvement: StudentImprovementSummary;
      })[];
    }>('/api/admin/students'),

  updateStudentGuardian: (
    studentId: string,
    body: {
      guardianName?: string;
      whatsappNumber?: string;
      guardianContactVerified?: boolean;
      guardianConsentGiven?: boolean;
    }
  ) =>
    apiRequest<{ user: AuthUser }>(
      `/api/students/${encodeURIComponent(studentId)}/guardian`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  getAcademicConfig: () => apiRequest<{ config: AcademicConfig }>('/api/admin/config'),

  updateAcademicConfig: (body: Partial<AcademicConfig>) =>
    apiRequest<{ config: AcademicConfig }>('/api/admin/config', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  getAuditLogs: (limit = 50) =>
    apiRequest<{ logs: AuditLogRecord[] }>(`/api/admin/audit-logs?limit=${limit}`),

  recalculateAnalytics: () =>
    apiRequest<{ ok: boolean; questionStatsUpdated: number }>(
      '/api/admin/analytics/recalculate',
      { method: 'POST' }
    ),

  getInterventions: (filters: { status?: string; subjectId?: string; studentId?: string } = {}) => {
    const q = new URLSearchParams();
    if (filters.status && filters.status !== 'All') q.set('status', filters.status);
    if (filters.subjectId && filters.subjectId !== 'All') q.set('subjectId', filters.subjectId);
    if (filters.studentId && filters.studentId !== 'All') q.set('studentId', filters.studentId);
    const qs = q.toString();
    return apiRequest<{ cases: EnrichedInterventionCase[]; templates: InterventionTemplate[] }>(
      `/api/interventions${qs ? `?${qs}` : ''}`
    );
  },

  getInterventionDetail: (caseId: string) =>
    apiRequest<InterventionCaseDetailResponse>(
      `/api/interventions/${encodeURIComponent(caseId)}`
    ),

  applyInterventionAction: (
    caseId: string,
    body: {
      nextStatus?: InterventionStatus;
      templateId?: string | null;
      instructionTitle?: string;
      instructionBody?: string;
      recommendedPracticeTopicId?: string | null;
      notes?: string;
      dismissalReason?: string;
      resolutionNotes?: string;
      notifyGuardian?: boolean;
    }
  ) =>
    apiRequest<InterventionCaseDetailResponse>(
      `/api/interventions/${encodeURIComponent(caseId)}/actions`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  getStudentInterventions: () =>
    apiRequest<{ interventions: StudentInterventionInstruction[] }>('/api/student/interventions'),

  getNotifications: () =>
    apiRequest<{ notifications: NotificationRecord[]; unreadCount: number }>('/api/notifications'),

  markNotificationRead: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
    }),

  retryNotification: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/notifications/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    }),

  updateNotificationPreferences: (prefs: Partial<NotificationPreferences>) =>
    apiRequest<{ preferences: NotificationPreferences }>('/api/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(prefs),
    }),

  getCommunications: () =>
    apiRequest<{ emails: EmailLog[]; whatsapps: WhatsAppLog[] }>(
      '/api/communications/logs'
    ),

  sendProgressShare: () =>
    apiRequest<{ ok: boolean; message: string }>(
      '/api/communications/send-progress',
      { method: 'POST' }
    ),

  // --- Enhancement 02: Knowledge Discovery, Publishing & Distribution ---
  getKnowledgeAiStatus: () =>
    apiRequest<{ configured: boolean; model: string }>('/api/knowledge/ai-status'),

  generateKnowledgeAiDraft: (body: {
    sourceTitle: string;
    sourceUrl?: string;
    sourceExcerpt: string;
    targetGrade: string;
    language: string;
    subjectId?: string;
  }) =>
    apiRequest<{
      draft: {
        aiGenerated: true;
        reviewRequired: true;
        title: string;
        summary: string;
        simplifiedExplanation: string;
        suggestedSubjectId: string;
        suggestedGrades: string[];
        memoryTip: string;
        draftQuestions: {
          question: string;
          options: [string, string, string, string];
          correctIndex: number;
        }[];
        uncertaintyWarnings: string[];
      };
      duplicateMatches: { id: string; title: string; score: number }[];
    }>('/api/knowledge/ai-draft', { method: 'POST', body: JSON.stringify(body) }),

  getKnowledgePublications: (filters: {
    status?: string;
    subjectId?: string;
    topicId?: string;
    grade?: string;
    search?: string;
    bookmarkedOnly?: boolean;
  } = {}) => {
    const q = new URLSearchParams();
    if (filters.status && filters.status !== 'ALL') q.set('status', filters.status);
    if (filters.subjectId && filters.subjectId !== 'All') q.set('subjectId', filters.subjectId);
    if (filters.topicId && filters.topicId !== 'All') q.set('topicId', filters.topicId);
    if (filters.grade && filters.grade !== 'All') q.set('grade', filters.grade);
    if (filters.search) q.set('search', filters.search);
    if (filters.bookmarkedOnly) q.set('bookmarkedOnly', 'true');
    const qs = q.toString();
    return apiRequest<{ publications: KnowledgePublication[] }>(
      `/api/knowledge/publications${qs ? `?${qs}` : ''}`
    );
  },

  checkKnowledgeDuplicates: (title: string, sourceUrl?: string, excludeId?: string) => {
    const q = new URLSearchParams({ title });
    if (sourceUrl) q.set('sourceUrl', sourceUrl);
    if (excludeId) q.set('excludeId', excludeId);
    return apiRequest<{ duplicates: { id: string; title: string; score: number }[] }>(
      `/api/knowledge/publications/check-duplicates?${q.toString()}`
    );
  },

  getKnowledgePublicationDetail: (publicationId: string) =>
    apiRequest<{
      publication: KnowledgePublication;
      versions: PublicationVersion[];
      reviewActions: PublicationReviewAction[];
      campaigns: PublicationCampaign[];
      linkedQuizzes: QuizItem[];
    }>(`/api/knowledge/publications/${encodeURIComponent(publicationId)}`),

  createKnowledgePublication: (body: {
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
  }) =>
    apiRequest<{
      publication: KnowledgePublication;
      versions: PublicationVersion[];
      reviewActions: PublicationReviewAction[];
      duplicateWarnings: { id: string; title: string; score: number }[];
    }>('/api/knowledge/publications', { method: 'POST', body: JSON.stringify(body) }),

  updateKnowledgePublication: (
    publicationId: string,
    body: Record<string, unknown>
  ) =>
    apiRequest<{
      publication: KnowledgePublication;
      versions: PublicationVersion[];
      reviewActions: PublicationReviewAction[];
    }>(`/api/knowledge/publications/${encodeURIComponent(publicationId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  transitionKnowledgePublication: (
    publicationId: string,
    body: {
      toStatus: PublicationStatus;
      notes?: string;
      scheduledFor?: string | null;
      checklist?: Partial<ValidationChecklist>;
      correctionNotice?: string | null;
    }
  ) =>
    apiRequest<{
      publication: KnowledgePublication;
      versions: PublicationVersion[];
      reviewActions: PublicationReviewAction[];
    }>(`/api/knowledge/publications/${encodeURIComponent(publicationId)}/transition`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  issueKnowledgeCorrection: (
    publicationId: string,
    body: {
      correctionNotice: string;
      updatedBody?: string;
      updatedSummary?: string;
      notifyChannels?: ('in_app' | 'email' | 'whatsapp')[];
    }
  ) =>
    apiRequest<{
      publication: KnowledgePublication;
      campaign: PublicationCampaign | null;
    }>(`/api/knowledge/publications/${encodeURIComponent(publicationId)}/correction`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  uploadKnowledgeResource: (
    publicationId: string,
    body: {
      title: string;
      fileName: string;
      mimeType: string;
      base64Data: string;
      isCover?: boolean;
    }
  ) =>
    apiRequest<{ resource: PublicationResource }>(
      `/api/knowledge/publications/${encodeURIComponent(publicationId)}/resources/upload`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  addKnowledgeLinkResource: (
    publicationId: string,
    body: {
      resourceType: 'external_link' | 'video_link' | 'linked_quiz';
      title: string;
      externalUrl?: string;
      linkedQuizIds?: string[];
    }
  ) =>
    apiRequest<{ resource: PublicationResource }>(
      `/api/knowledge/publications/${encodeURIComponent(publicationId)}/resources/link`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  removeKnowledgeResource: (publicationId: string, resourceId: string) =>
    apiRequest<{ ok: boolean }>(
      `/api/knowledge/publications/${encodeURIComponent(publicationId)}/resources/${encodeURIComponent(
        resourceId
      )}`,
      { method: 'DELETE' }
    ),

  downloadAuthorizedResourceBlob: async (downloadUrl: string, fileName: string) => {
    const token = getStoredToken();
    const res = await fetch(downloadUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  },

  distributeKnowledgePublication: (
    publicationId: string,
    body: { channels: ('in_app' | 'email' | 'whatsapp')[]; idempotencyKey?: string }
  ) =>
    apiRequest<{
      campaign: PublicationCampaign;
      deliveries: PublicationDelivery[];
      deduplicated: boolean;
    }>(`/api/knowledge/publications/${encodeURIComponent(publicationId)}/distribute`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getCampaignDeliveries: (campaignId: string) =>
    apiRequest<{ deliveries: PublicationDelivery[] }>(
      `/api/knowledge/campaigns/${encodeURIComponent(campaignId)}/deliveries`
    ),

  retryCampaignDelivery: (deliveryId: string) =>
    apiRequest<{ ok: boolean }>(
      `/api/knowledge/deliveries/${encodeURIComponent(deliveryId)}/retry`,
      { method: 'POST' }
    ),

  recordKnowledgeEngagement: (
    publicationId: string,
    eventType: PublicationEngagementType,
    resourceId?: string | null,
    metadata?: Record<string, unknown>
  ) =>
    apiRequest<{ ok: boolean; bookmarked?: boolean }>(
      `/api/knowledge/publications/${encodeURIComponent(publicationId)}/engage`,
      {
        method: 'POST',
        body: JSON.stringify({ eventType, resourceId, metadata }),
      }
    ),

  getKnowledgeDiscoveryQueue: () =>
    apiRequest<{ candidates: KnowledgeDiscoveryCandidate[] }>('/api/knowledge/discovery'),

  addKnowledgeDiscoveryCandidate: (body: {
    title: string;
    summary: string;
    suggestedSubjectId: string;
    suggestedTopicId?: string;
    suggestedGrades?: string[];
    language?: PublicationLanguage;
    sourceTitle: string;
    sourceUrl: string;
    sourcePublishedAt?: string;
  }) =>
    apiRequest<{ candidate: KnowledgeDiscoveryCandidate }>('/api/knowledge/discovery', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateKnowledgeDiscoveryStatus: (id: string, status: 'CONVERTED' | 'DISMISSED') =>
    apiRequest<{ ok: boolean }>(`/api/knowledge/discovery/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  getKnowledgeAnalytics: () =>
    apiRequest<KnowledgeAnalyticsSummary>('/api/knowledge/analytics'),

  // --- Enhancement 03: Subject-Scoped Question Bank, Practice Sessions & Mock Assessments ---
  createQuestionExtended: (body: {
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
    attributes?: Partial<QuizItem['attributes']>;
  }) =>
    apiRequest<{ quiz: QuizItem }>('/api/questions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateQuestionExtended: (questionId: string, body: Record<string, unknown>) =>
    apiRequest<{ quiz: QuizItem }>(`/api/questions/${encodeURIComponent(questionId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  transitionQuestionStatus: (
    questionId: string,
    body: {
      toStatus: QuestionApprovalStatus;
      notes?: string;
      replacedByQuestionId?: string | null;
    }
  ) =>
    apiRequest<{ quiz: QuizItem }>(
      `/api/questions/${encodeURIComponent(questionId)}/transition`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  duplicateQuestion: (questionId: string) =>
    apiRequest<{ quiz: QuizItem }>(
      `/api/questions/${encodeURIComponent(questionId)}/duplicate`,
      { method: 'POST' }
    ),

  getQuestionReviewHistory: (questionId: string) =>
    apiRequest<{ reviews: QuestionReviewActionRecord[] }>(
      `/api/questions/${encodeURIComponent(questionId)}/reviews`
    ),

  bulkImportQuestions: (body: {
    format: 'json' | 'csv';
    content: string;
    defaultSubjectId?: string;
    initialStatus?: QuestionApprovalStatus;
  }) =>
    apiRequest<{
      importedCount: number;
      importedQuestions: QuizItem[];
      errors: { rowNumber: number; error: string }[];
    }>('/api/questions/bulk-import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  previewQuestionSelection: (body: {
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
  }) =>
    apiRequest<{
      selectedQuestions: QuizItem[];
      metadata: {
        availablePoolCount: number;
        distributionActual: Record<DifficultyTier, number>;
        topicsCovered: string[];
      };
    }>('/api/assessments/preview-selection', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getAssessments: (
    filters: { kind?: string; status?: string; subjectId?: string; grade?: string } = {}
  ) => {
    const q = new URLSearchParams();
    if (filters.kind && filters.kind !== 'All') q.set('kind', filters.kind);
    if (filters.status && filters.status !== 'All') q.set('status', filters.status);
    if (filters.subjectId && filters.subjectId !== 'All') q.set('subjectId', filters.subjectId);
    if (filters.grade && filters.grade !== 'All') q.set('grade', filters.grade);
    const qs = q.toString();
    return apiRequest<{ assessments: AssessmentRecord[] }>(
      `/api/assessments${qs ? `?${qs}` : ''}`
    );
  },

  createAssessment: (body: {
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
  }) =>
    apiRequest<{ assessment: AssessmentRecord }>('/api/assessments', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getAssessmentDetail: (assessmentId: string) =>
    apiRequest<{ assessment: AssessmentRecord; snapshots: AssessmentSnapshotItem[] }>(
      `/api/assessments/${encodeURIComponent(assessmentId)}`
    ),

  updateDraftAssessment: (assessmentId: string, body: Record<string, unknown>) =>
    apiRequest<{ assessment: AssessmentRecord }>(
      `/api/assessments/${encodeURIComponent(assessmentId)}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  transitionAssessmentStatus: (
    assessmentId: string,
    body: { toStatus: AssessmentStatus; scheduledFor?: string | null; notes?: string }
  ) =>
    apiRequest<{ assessment: AssessmentRecord }>(
      `/api/assessments/${encodeURIComponent(assessmentId)}/transition`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  duplicateAssessment: (assessmentId: string) =>
    apiRequest<{ assessment: AssessmentRecord }>(
      `/api/assessments/${encodeURIComponent(assessmentId)}/duplicate`,
      { method: 'POST' }
    ),

  exportAssessmentPrintable: (assessmentId: string, includeAnswerKey = false) =>
    apiRequest<{
      assessment: AssessmentRecord;
      exportedAt: string;
      exportedBy: string;
      sections: (AssessmentSection & {
        questions: {
          order: number;
          questionId: string;
          questionVersion: number;
          marks: number;
          questionType: QuestionType;
          questionSi: string;
          questionEn: string;
          options: [string, string, string, string];
          imageUrl?: string;
          correctIndex?: number;
          acceptedAnswers?: string[];
          markingRule?: QuestionMarkingRule;
          explanation?: string;
        }[];
      })[];
    }>(
      `/api/assessments/${encodeURIComponent(assessmentId)}/export?includeAnswerKey=${
        includeAnswerKey ? 'true' : 'false'
      }`
    ),

  getAssessmentAnalytics: (assessmentId: string) =>
    apiRequest<{
      assessment: AssessmentRecord;
      summary: {
        totalAttempts: number;
        completedCount: number;
        inProgressCount: number;
        pendingManualCount: number;
        uniqueParticipants: number;
        averageScorePercent: number;
        highestScorePercent: number;
        lowestScorePercent: number;
        passRatePercent: number;
      };
      questionAnalytics: {
        snapshotId: string;
        questionId: string;
        sortOrder: number;
        questionSi: string;
        questionType: QuestionType;
        topicId: string;
        topicName: string;
        marks: number;
        responsesCount: number;
        correctCount: number;
        pendingManualCount: number;
        accuracyPercent: number | null;
        avgDurationMs: number;
        qualityWarning: string | null;
      }[];
      topicPerformance: {
        topicId: string;
        topicName: string;
        total: number;
        wrong: number;
        accuracyPercent: number;
      }[];
      attempts: (AssessmentAttemptRecord & {
        studentName: string;
        studentCode: string;
      })[];
    }>(`/api/assessments/${encodeURIComponent(assessmentId)}/analytics`),

  assignFollowUpFromAssessment: (
    assessmentId: string,
    body: {
      studentIds: string[];
      title: string;
      body: string;
      recommendedTopicId?: string | null;
      linkedPublicationId?: string | null;
    }
  ) =>
    apiRequest<{ ok: boolean; assignedCount: number }>(
      `/api/assessments/${encodeURIComponent(assessmentId)}/assign-followup`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  gradeManualAnswers: (
    attemptId: string,
    grades: { answerId?: string; snapshotId?: string; awardedMarks: number; comment?: string }[]
  ) =>
    apiRequest<{
      attempt: AssessmentAttemptRecord;
      assessment: AssessmentRecord;
      resultsReleased: boolean;
      awaitingReleaseNotice: string | null;
      items: AssessmentAttemptReviewItem[];
    }>(`/api/assessment-attempts/${encodeURIComponent(attemptId)}/grade`, {
      method: 'POST',
      body: JSON.stringify({ grades }),
    }),

  getStudentAssessments: () =>
    apiRequest<{ assessments: StudentAssessmentListItem[] }>('/api/student/assessments'),

  startOrResumeAssessment: (assessmentId: string) =>
    apiRequest<{
      resumed: boolean;
      attempt: AssessmentAttemptRecord;
      assessment: AssessmentRecord;
      sections: AssessmentSection[];
      questions: StudentQuizView[];
      savedAnswers: {
        snapshotId: string;
        questionId: string;
        submittedOptionIndex: number | null;
        submittedAnswerText: string | null;
      }[];
      timeLimitSeconds: number;
      secondsRemaining: number;
    }>(`/api/assessments/${encodeURIComponent(assessmentId)}/start`, { method: 'POST' }),

  saveAssessmentProgress: (
    assessmentId: string,
    body: {
      attemptId: string;
      answers: {
        snapshotId: string;
        questionId: string;
        submittedOptionIndex?: number | null;
        submittedAnswerText?: string | null;
      }[];
    }
  ) =>
    apiRequest<{ ok: boolean; savedAt: string }>(
      `/api/assessments/${encodeURIComponent(assessmentId)}/save-progress`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  submitAssessmentAttempt: (
    assessmentId: string,
    body: {
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
  ) =>
    apiRequest<{
      deduplicated: boolean;
      attempt: AssessmentAttemptRecord;
      assessment: AssessmentRecord;
      review: {
        attempt: AssessmentAttemptRecord;
        assessment: AssessmentRecord;
        resultsReleased: boolean;
        awaitingReleaseNotice: string | null;
        items: AssessmentAttemptReviewItem[];
      };
      trajectory?: StudentTrajectory;
      user: AuthUser;
    }>(`/api/assessments/${encodeURIComponent(assessmentId)}/submit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getAttemptReview: (attemptId: string) =>
    apiRequest<{
      attempt: AssessmentAttemptRecord;
      assessment: AssessmentRecord;
      resultsReleased: boolean;
      awaitingReleaseNotice: string | null;
      items: AssessmentAttemptReviewItem[];
    }>(`/api/assessment-attempts/${encodeURIComponent(attemptId)}/review`),
};

export interface StudentAssessmentListItem extends AssessmentRecord {
  myAttemptCount: number;
  inProgressAttemptId: string | null;
  latestAttemptId: string | null;
  latestAttemptStatus: AssessmentAttemptStatus | null;
  latestScorePercent: number | null;
  latestAwardedMarks: number | null;
}

export interface AssessmentAttemptReviewItem {
  snapshotId: string;
  sectionId: string;
  sortOrder: number;
  questionId: string;
  questionType: QuestionType;
  questionSi: string;
  questionEn: string;
  options: [string, string, string, string];
  imageUrl?: string;
  correctIndex: number;
  acceptedAnswers: string[];
  submittedDisplayOptionIndex: number | null;
  submittedOriginalOptionIndex: number | null;
  submittedAnswerText: string | null;
  isCorrect: boolean | null;
  markingStatus: 'auto_graded' | 'pending_manual' | 'manually_graded';
  awardedMarks: number;
  maxMarks: number;
  graderComment: string | null;
  explanation: string;
  memoryTrickTitle: string;
  memoryTrickBody: string;
  markingNotes?: string;
}
