export type UserRole = 'student' | 'teacher' | 'admin';

export type CognitiveDomain =
  | 'Logical & Number Patterns'
  | 'Mathematics & Word Problems'
  | 'Sinhala Language & Proverbs'
  | 'Spatial & Geometric IQ'
  | 'Environmental Studies (පරිසරය)'
  | 'English & Comprehension';

export type DifficultyTier = 'Simple' | 'Moderate' | 'Challenging' | 'Master';

export type PaperCategoryLevel =
  | 'Foundation Simple'
  | 'Balanced Standard'
  | 'Advanced Challenging'
  | 'Scholarship Master';

export interface QuizAttributes {
  intelligenceMeasure: number; // 1-100: cognitive reasoning complexity index
  correctProbability: number; // 0.05-0.95: expected correct response probability
  wrongProbability: number; // 0.05-0.95: 1 - correctProbability
  examPriority: number; // 1-10: importance for Grade 5 Scholarship exam
  quizStrength: number; // 1-100: psychometric discrimination power
  difficultyTier: DifficultyTier;
  cognitiveDomain: CognitiveDomain;
  estimatedSeconds: number;
}

export interface SubjectCategory {
  id: string;
  slug: string;
  nameEn: string;
  nameSi: string;
  nameTa: string;
  cognitiveDomain: CognitiveDomain;
  sortOrder: number;
  active: boolean;
}

export interface TopicNode {
  id: string;
  subjectId: string;
  nameEn: string;
  nameSi: string;
  prerequisiteTopicId?: string | null;
  sortOrder: number;
}

export interface SubtopicNode {
  id: string;
  topicId: string;
  subjectId: string;
  nameEn: string;
  nameSi: string;
  sortOrder: number;
}

export interface TeacherSubjectAssignment {
  id: string;
  teacherId: string;
  subjectId: string;
  assignedByAdminId: string;
  assignedAt: string;
}

export interface QuestionMisconception {
  optionIndex: number;
  misconceptionLabel: string;
  suggestedIntervention: string;
}

export type QuestionQualityFlag = 'OK' | 'NEEDS_REVIEW' | 'HIGH_ERROR_RATE' | 'AMBIGUOUS_TIMING';

export type QuestionType = 'mcq' | 'numerical' | 'true_false' | 'short_answer';

export type QuestionApprovalStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'ACTIVE'
  | 'REJECTED'
  | 'RETIRED';

export interface QuestionMarkingRule {
  numericTolerance?: number;
  caseSensitive?: boolean;
  requiresManualReview?: boolean;
  markingNotes?: string;
}

export interface QuizItem {
  id: string;
  source: 'curated' | 'pool_500k';
  subjectId?: string;
  topicId?: string;
  subtopicId?: string;
  version?: number;
  grade?: string;
  questionType?: QuestionType;
  cognitiveSkill?: string;
  learningObjectives?: string;
  hint?: string;
  markingRule?: QuestionMarkingRule;
  acceptedAnswers?: string[];
  defaultMarks?: number;
  approvalStatus?: QuestionApprovalStatus;
  authorId?: string;
  authorName?: string;
  reviewerId?: string | null;
  reviewerName?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  retiredAt?: string | null;
  replacedByQuestionId?: string | null;
  questionSi: string;
  questionEn: string;
  options: [string, string, string, string];
  correctIndex: number; // 0-3
  imageUrl?: string; // Uploaded image or canvas drawing data URL
  memoryTrickTitle: string;
  memoryTrickBody: string; // Child-specific psychological remembering technique
  explanation: string;
  misconceptions?: QuestionMisconception[];
  qualityFlag?: QuestionQualityFlag;
  attributes: QuizAttributes;
  createdAt: string;
  updatedAt?: string;
}

export interface StudentQuizView {
  id: string;
  source: 'curated' | 'pool_500k';
  subjectId?: string;
  topicId?: string;
  subtopicId?: string;
  version?: number;
  grade?: string;
  questionType?: QuestionType;
  marks?: number;
  sectionId?: string;
  snapshotId?: string;
  questionSi: string;
  questionEn: string;
  options: [string, string, string, string];
  imageUrl?: string;
  attributes: QuizAttributes;
  hint?: string;
  // In practice mode, memoryTrick & explanation are revealed after selection or via study helper.
  // In timed exam mode, these fields are strictly omitted from the API response.
  memoryTrickTitle?: string;
  memoryTrickBody?: string;
  explanation?: string;
  correctIndex?: number;
  acceptedAnswers?: string[];
}

export interface PaperQualitySummary {
  qualityIndex: number; // 0-100
  averageDifficulty: number; // 0-100
  averageIntelligence: number; // 0-100
  averagePriority: number; // 1-10
  averageStrength: number; // 1-100
  domainCoverageCount: number;
  estimatedPassMark: number; // percentage
  categoryLevel: PaperCategoryLevel;
  recommendation: string;
}

export interface ExamPaper {
  id: string;
  title: string;
  titleSi: string;
  description: string;
  durationMinutes: number;
  quizIds: string[];
  qualitySummary: PaperQualitySummary;
  createdBy: string;
  createdAt: string;
  published: boolean;
}

export interface AttemptRecord {
  id: string;
  userId: string;
  paperId: string;
  paperTitle: string;
  mode: 'practice' | 'timed_exam';
  paperCategory: PaperCategoryLevel;
  totalQuestions: number;
  correctCount: number;
  scorePercent: number;
  timeLimitSeconds: number;
  timeSpentSeconds: number;
  starsEarned: number;
  domainBreakdown: Record<string, { correct: number; total: number }>;
  submittedAt: string;
}

export type AttemptSubmissionStatus =
  | 'valid_answered'
  | 'skipped'
  | 'unanswered'
  | 'timed_out'
  | 'invalid';

export type AttemptContextMode = 'practice' | 'timed_exam' | 'targeted_intervention';

export interface QuestionAttempt {
  id: string;
  studentId: string;
  questionId: string;
  questionVersion: number;
  subjectId: string;
  topicId: string;
  subtopicId: string;
  attemptSequenceNumber: number; // 1 for first valid attempt on this question, 2+ for repeats
  submittedAnswerIndex: number | null;
  submissionStatus: AttemptSubmissionStatus;
  isCorrect: boolean | null; // strictly null for skipped / unanswered / timed_out / invalid
  responseDurationMs: number;
  difficultyAtAttempt: DifficultyTier;
  hintUsed: boolean;
  contextMode: AttemptContextMode;
  sessionId: string;
  deliveryContext: {
    paperId?: string;
    adaptiveLevelMode?: string;
    interventionCaseId?: string;
  };
  idempotencyKey: string;
  attemptTimestamp: string;
}

export type SampleSizeStatus = 'insufficient' | 'preliminary' | 'reliable';

export interface ResponseTimeDistribution {
  sampleCount: number;
  minMs: number;
  medianMs: number;
  p90Ms: number;
  meanMs: number;
  framingNote: string;
}

export interface QuestionPerformanceMetrics {
  questionId: string;
  totalRecordedEvents: number;
  validAttemptCount: number;
  skippedOrUnansweredCount: number;
  timedOutCount: number;
  uniqueStudents: number;
  correctAttemptCount: number;
  incorrectAttemptCount: number;
  correctAttemptRate: number; // 0-100
  incorrectAttemptRate: number; // 0-100
  firstAttemptTotal: number;
  firstAttemptAccuracy: number | null; // separated from repeat attempts
  repeatAttemptTotal: number;
  repeatAttemptAccuracy: number | null;
  hintAssistedTotal: number;
  hintAssistedAccuracy: number | null;
  unassistedTotal: number;
  unassistedAccuracy: number | null;
  repeatedErrorStudentCount: number;
  sampleSizeStatus: SampleSizeStatus;
  responseTimeStats: ResponseTimeDistribution;
}

export type InterventionStatus =
  | 'OPEN'
  | 'UNDER_REVIEW'
  | 'INTERVENTION_ASSIGNED'
  | 'MONITORING'
  | 'RESOLVED'
  | 'DISMISSED';

export interface InterventionCase {
  id: string;
  studentId: string;
  questionId: string;
  subjectId: string;
  topicId: string;
  subtopicId: string;
  status: InterventionStatus;
  incorrectCount: number;
  thresholdTriggeredAt: number;
  latestAttemptId: string;
  assignedTeacherId: string | null;
  templateId: string | null;
  instructionTitle: string;
  instructionBody: string;
  suggestedSupportNote: string; // clearly marked as suggestion awaiting teacher review
  recommendedPracticeTopicId: string | null;
  consecutiveCorrectAfterCase: number;
  readyForTeacherReview: boolean;
  reopenCount: number;
  dismissalReason: string | null;
  resolutionNotes: string | null;
  lastAlertSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface InterventionAction {
  id: string;
  caseId: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole | 'system';
  actionType:
    | 'CASE_OPENED'
    | 'THRESHOLD_INCREMENTED'
    | 'STATUS_CHANGED'
    | 'INSTRUCTION_ASSIGNED'
    | 'PRACTICE_FOLLOWUP'
    | 'CASE_RESOLVED'
    | 'CASE_DISMISSED'
    | 'CASE_REOPENED';
  fromStatus: InterventionStatus | null;
  toStatus: InterventionStatus;
  notes: string;
  templateUsed: string | null;
  createdAt: string;
}

export interface InterventionTemplate {
  id: string;
  title: string;
  subjectId: string | 'all';
  misconceptionFocus: string;
  instructionTemplate: string;
  recommendedPracticeMinutes: number;
}

export interface AcademicConfig {
  repeatedErrorThreshold: number; // default 3
  notificationCooldownMinutes: number; // default 30
  alertGroupingWindowMinutes: number; // default 15
  sustainedCorrectRequiredForReview: number; // default 2
  autoNotifyAdminsOnEscalation: boolean;
  requireTeacherReviewBeforeClose: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface NotificationPreferences {
  inApp: boolean;
  email: boolean;
  whatsapp: boolean;
  groupedSummary: boolean;
}

export interface NotificationRecord {
  id: string;
  recipientUserId: string;
  recipientRole: UserRole;
  channel: 'in_app' | 'email' | 'whatsapp';
  category:
    | 'repeated_error_alert'
    | 'intervention_assigned'
    | 'follow_up_ready'
    | 'progress_report'
    | 'admin_oversight'
    | 'knowledge_publication'
    | 'knowledge_correction';
  title: string;
  body: string;
  relatedCaseId?: string | null;
  relatedStudentId?: string | null;
  relatedSubjectId?: string | null;
  relatedPublicationId?: string | null;
  dedupeKey: string;
  deliveryStatus: 'delivered' | 'queued' | 'retrying' | 'failed' | 'skipped_unverified';
  retryCount: number;
  errorMessage?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole | 'system';
  action: string;
  targetType: string;
  targetId: string;
  detailsJson: string;
  createdAt: string;
}

export interface StudentTrajectory {
  currentLevel: PaperCategoryLevel;
  recommendedNextLevel: PaperCategoryLevel;
  scholarshipReadinessPercent: number; // 0-100
  improvementDeltaPercent: number;
  totalStars: number;
  studyMinutesWeek: number;
  badgesCount: number;
  weakDomains: { domain: string; accuracyPercent: number }[];
  dailyStudySeries: { day: string; score: number; minutes: number }[];
  recommendationNote: string;
}

export interface UserAccount {
  id: string;
  userIdCode: string; // e.g. M5-2026-001
  name: string;
  email: string;
  whatsappNumber: string;
  role: UserRole;
  grade?: string; // e.g. 'Grade 5'
  delegatedPublishSubjects?: string[];
  active?: boolean;
  guardianName?: string;
  guardianContactVerified?: boolean;
  guardianConsentGiven?: boolean;
  notificationPreferences?: NotificationPreferences;
  assignedSubjectIds?: string[]; // populated dynamically for teachers
  passwordHash: string;
  totpSecret: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  subscriptionStatus: 'trial' | 'active';
  subscriptionPlanId: string | null;
  subscriptionExpiresAt: string | null;
  currentLevel: PaperCategoryLevel;
  stars: number;
  streakDays: number;
  lastPracticeDate?: string | null;
  dailyGoalQuestions?: number;
  createdAt: string;
}

export interface PaymentPlan {
  id: string;
  name: string;
  nameSi: string;
  audience: string;
  priceLkr: number;
  durationDays: number;
  features: string[];
  recommended?: boolean;
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  userId: string;
  userName: string;
  userEmail: string;
  planId: string;
  planName: string;
  amountLkr: number;
  gateway: 'PayHere LKR' | 'Stripe Card';
  gatewayRef: string;
  signatureVerified: boolean;
  status: 'paid' | 'pending';
  createdAt: string;
}

export interface EmailLog {
  id: string;
  toEmail: string;
  subject: string;
  category:
    | 'otp_register'
    | 'otp_login'
    | 'otp_payment'
    | 'invoice'
    | 'progress_report'
    | 'intervention'
    | 'knowledge_publication';
  otpCode?: string;
  htmlBody: string;
  sentAt: string;
}

export interface WhatsAppLog {
  id: string;
  toNumber: string;
  category:
    | 'registration'
    | 'payment'
    | 'exam_report'
    | 'milestone'
    | 'intervention'
    | 'knowledge_publication';
  messageText: string;
  deliveryStatus: 'queued' | 'delivered' | 'failed' | 'skipped_unverified';
  sentAt: string;
}

// --- Enhancement 02: Knowledge Discovery, Publishing & Distribution ---
export type KnowledgeType =
  | 'concept_guide'
  | 'curriculum_discovery'
  | 'exam_strategy'
  | 'science_update'
  | 'worksheet_pack'
  | 'correction_notice';

export type PublicationStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'ARCHIVED'
  | 'WITHDRAWN'
  | 'REJECTED';

export type PublicationLanguage = 'si' | 'en' | 'ta' | 'bilingual';

export type PublicationResourceType =
  | 'image'
  | 'pdf'
  | 'document'
  | 'worksheet'
  | 'external_link'
  | 'video_link'
  | 'linked_quiz';

export interface ValidationChecklist {
  factualAccuracy: boolean;
  sourceReliability: boolean;
  gradeSuitability: boolean;
  curriculumRelevance: boolean;
  languageClarity: boolean;
  resourceSafety: boolean;
  copyrightLicensing: boolean;
  accessibility: boolean;
  notes?: string;
}

export interface PublicationResource {
  id: string;
  publicationId: string;
  resourceType: PublicationResourceType;
  title: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string | null;
  externalUrl: string | null;
  linkedQuizIds: string[];
  isCover: boolean;
  sortOrder: number;
  uploadedBy: string;
  createdAt: string;
}

export interface PublicationVersion {
  id: string;
  publicationId: string;
  versionNumber: number;
  title: string;
  summary: string;
  body: string;
  changeNote: string;
  changedBy: string;
  changedByName: string;
  createdAt: string;
}

export interface PublicationReviewAction {
  id: string;
  publicationId: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole | 'system';
  actionType: string;
  fromStatus: PublicationStatus | null;
  toStatus: PublicationStatus;
  notes: string;
  createdAt: string;
}

export interface KnowledgePublication {
  id: string;
  title: string;
  summary: string;
  body: string;
  knowledgeType: KnowledgeType;
  subjectId: string;
  topicId: string;
  subtopicId: string;
  targetGrades: string[];
  language: PublicationLanguage;
  audienceGroup: string;
  learningNeeds: string;
  coverImageUrl: string | null;
  sourceTitle: string;
  sourceUrl: string | null;
  sourcePublishedAt: string | null;
  verificationDate: string | null;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  reviewerId: string | null;
  reviewerName: string | null;
  status: PublicationStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
  correctionNotice: string | null;
  aiAssisted: boolean;
  aiDraftWarnings: string[];
  checklist: ValidationChecklist;
  currentVersion: number;
  resources: PublicationResource[];
  createdAt: string;
  updatedAt: string;
  bookmarked?: boolean;
}

export interface PublicationCampaign {
  id: string;
  publicationId: string;
  publicationTitle: string;
  triggeredBy: string;
  triggeredByName: string;
  channels: ('in_app' | 'email' | 'whatsapp')[];
  targetGrades: string[];
  idempotencyKey: string;
  totalEligible: number;
  deliveredCount: number;
  skippedCount: number;
  failedCount: number;
  createdAt: string;
}

export interface PublicationDelivery {
  id: string;
  campaignId: string;
  publicationId: string;
  recipientUserId: string;
  recipientName: string;
  recipientRole: UserRole;
  channel: 'in_app' | 'email' | 'whatsapp';
  deliveryStatus: 'delivered' | 'skipped_unverified' | 'skipped_preference' | 'failed';
  retryCount: number;
  errorMessage: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export type PublicationEngagementType =
  | 'view'
  | 'resource_download'
  | 'link_click'
  | 'quiz_complete'
  | 'bookmark';

export interface KnowledgeDiscoveryCandidate {
  id: string;
  title: string;
  summary: string;
  suggestedSubjectId: string;
  suggestedTopicId: string;
  suggestedGrades: string[];
  language: PublicationLanguage;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublishedAt: string;
  relevanceScore: number;
  duplicateMatches: { id: string; title: string; score: number }[];
  uncertaintyFlags: string[];
  aiGenerated: boolean;
  status: 'NEW' | 'CONVERTED' | 'DISMISSED';
  createdBy: string;
  createdAt: string;
}

export interface KnowledgeAnalyticsSummary {
  totalPublications: number;
  publishedCount: number;
  pendingReviewCount: number;
  scheduledCount: number;
  byStatus: { status: PublicationStatus; count: number }[];
  bySubject: { subjectId: string; subjectName: string; count: number; views: number }[];
  byGrade: { grade: string; count: number }[];
  deliveryMetrics: {
    totalCampaigns: number;
    deliveredCount: number;
    skippedUnverifiedCount: number;
    skippedPreferenceCount: number;
    failedCount: number;
  };
  engagementMetrics: {
    totalViews: number;
    uniqueViewers: number;
    resourceDownloads: number;
    externalLinkClicks: number;
    quizCompletions: number;
    bookmarksCount: number;
  };
  topPublications: {
    id: string;
    title: string;
    subjectId: string;
    subjectName: string;
    status: PublicationStatus;
    views: number;
    uniqueViewers: number;
    downloads: number;
    linkClicks: number;
    quizCompletions: number;
    deliveredCount: number;
  }[];
}

// --- Enhancement 03: Subject-Scoped Question Bank, Practice Sessions & Mock Examinations ---
export type AssessmentKind = 'practice_session' | 'mock_exam';

export type AssessmentStatus =
  | 'DRAFT'
  | 'VALIDATED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'ACTIVE'
  | 'CLOSED'
  | 'RESULTS_RELEASED'
  | 'ARCHIVED'
  | 'CANCELLED'
  | 'WITHDRAWN';

export type AssessmentSelectionMode = 'manual' | 'deterministic' | 'randomized' | 'adaptive_gap';

export type ExplanationTiming = 'immediate' | 'after_submit' | 'after_release';

export interface QuestionReviewActionRecord {
  id: string;
  questionId: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole | 'system';
  actionType: string;
  fromStatus: QuestionApprovalStatus | null;
  toStatus: QuestionApprovalStatus;
  notes: string;
  createdAt: string;
}

export interface AssessmentSection {
  id: string;
  assessmentId: string;
  versionNumber: number;
  sortOrder: number;
  title: string;
  instructions: string;
  subjectId: string | null;
  totalMarks: number;
}

export interface AssessmentSnapshotItem {
  id: string;
  assessmentId: string;
  versionNumber: number;
  sectionId: string;
  sortOrder: number;
  questionId: string;
  questionVersion: number;
  marks: number;
  snapshot: QuizItem;
}

export interface AssessmentConfig {
  questionCount?: number;
  difficultyDistribution?: Partial<Record<DifficultyTier, number>>;
  questionTypes?: QuestionType[];
  cognitiveSkills?: string[];
  excludePreviouslyCorrect?: boolean;
  excludeRecentDays?: number;
  linkedKnowledgePublicationIds?: string[];
  targetCohort?: string;
}

export interface AssessmentAssignment {
  id: string;
  assessmentId: string;
  targetType: 'grade' | 'cohort' | 'student';
  targetValue: string;
  assignedBy: string;
  assignedAt: string;
}

export interface AssessmentRecord {
  id: string;
  kind: AssessmentKind;
  title: string;
  titleSi: string;
  description: string;
  instructions: string;
  grade: string;
  subjectIds: string[];
  topicIds: string[];
  subtopicIds: string[];
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  reviewerId: string | null;
  reviewerName: string | null;
  status: AssessmentStatus;
  selectionMode: AssessmentSelectionMode;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showHints: boolean;
  explanationTiming: ExplanationTiming;
  timeLimitMinutes: number | null;
  maxAttempts: number;
  totalMarks: number;
  passMarkPercent: number;
  availableFrom: string | null;
  availableUntil: string | null;
  scheduledFor: string | null;
  resultsReleasedAt: string | null;
  currentVersion: number;
  config: AssessmentConfig;
  sections: AssessmentSection[];
  questionCount: number;
  assignments: AssessmentAssignment[];
  createdAt: string;
  updatedAt: string;
}

export type AssessmentAttemptStatus =
  | 'in_progress'
  | 'submitted'
  | 'pending_manual_marking'
  | 'graded'
  | 'timed_out';

export interface AssessmentAttemptRecord {
  id: string;
  assessmentId: string;
  assessmentVersion: number;
  studentId: string;
  attemptNumber: number;
  status: AssessmentAttemptStatus;
  startedAt: string;
  expiresAt: string | null;
  submittedAt: string | null;
  serverDurationSeconds: number;
  shuffledOrder: string[];
  shuffledOptionsMap: Record<string, number[]>;
  autoScore: number;
  manualScore: number;
  totalAwardedMarks: number;
  maxMarks: number;
  scorePercent: number | null;
  idempotencyKey: string;
}

export interface AssessmentAnswerRecord {
  id: string;
  attemptId: string;
  snapshotId: string;
  questionId: string;
  questionVersion: number;
  submittedAnswerText: string | null;
  submittedOptionIndex: number | null;
  isCorrect: boolean | null;
  markingStatus: 'auto_graded' | 'pending_manual' | 'manually_graded';
  awardedMarks: number;
  maxMarks: number;
  graderId: string | null;
  graderComment: string | null;
  responseDurationMs: number;
  hintUsed: boolean;
  answeredAt: string;
}


