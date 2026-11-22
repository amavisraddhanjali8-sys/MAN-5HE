export type UserRole = 'student' | 'teacher' | 'parent' | 'admin';

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
    | 'knowledge_correction'
    | 'security_alert'
    | 'account_recovery'
    | 'system_update'
    | 'routine_review';
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
  username?: string;
  usernameUpdatedAt?: string | null;
  name: string;
  email: string;
  whatsappNumber: string;
  whatsappVerified?: boolean;
  role: UserRole;
  grade?: string; // e.g. 'Grade 5'
  delegatedPublishSubjects?: string[];
  safeguardingDesignated?: boolean;
  active?: boolean;
  guardianName?: string;
  guardianUserId?: string | null;
  guardianContactVerified?: boolean;
  guardianConsentGiven?: boolean;
  notificationPreferences?: NotificationPreferences;
  assignedSubjectIds?: string[]; // populated dynamically for teachers
  passwordHash: string;
  passwordUpdatedAt?: string | null;
  totpSecret: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  totpEnrolledAt?: string | null;
  totpMandatory?: boolean;
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
    | 'otp_recovery'
    | 'otp_contact_change'
    | 'security_alert'
    | 'invoice'
    | 'progress_report'
    | 'intervention'
    | 'knowledge_publication'
    | 'reminder'
    | 'wellbeing_guidance'
    | 'routine_review';
  otpCode?: string;
  htmlBody: string;
  textBody?: string;
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
    | 'knowledge_publication'
    | 'otp_recovery'
    | 'otp_contact_change'
    | 'security_alert'
    | 'reminder'
    | 'wellbeing_guidance'
    | 'routine_review';
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

// --- Enhancement 04: Secure Account Recovery, Identity Verification, Profile & TOTP ---
export type RecoveryChannel = 'email' | 'whatsapp';

export interface VerifiedRecoveryContact {
  id: string;
  userId: string;
  channel: RecoveryChannel;
  contactValue: string;
  isPrimary: boolean;
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenJti: string;
  deviceLabel: string;
  ipAddress: string;
  userAgent: string;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  isCurrent?: boolean;
}

export interface SecurityEventRecord {
  id: string;
  userId: string | null;
  actorId: string | null;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  channel: string | null;
  ipAddress: string | null;
  summary: string;
  metadataJson: string;
  createdAt: string;
}

export interface ContactChangeRequestRecord {
  id: string;
  userId: string;
  channel: RecoveryChannel;
  oldContact: string;
  newContact: string;
  status: 'PENDING' | 'VERIFIED' | 'CANCELLED' | 'EXPIRED' | 'ADMIN_REQUIRED';
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface AdminRecoveryRequestRecord {
  id: string;
  targetUserId: string;
  targetUserName?: string;
  targetUserEmail?: string;
  targetUserRole?: UserRole;
  requestType: 'authenticator_reset' | 'contact_recovery' | 'admin_account_recovery' | 'unlock';
  requesterIdentifier: string;
  verificationNotes: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  requestedByUserId: string | null;
  reviewedByAdminId: string | null;
  cooldownUntil: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TotpEnrollmentSummary {
  status: 'PENDING_SETUP' | 'ACTIVE' | 'DISABLED' | 'RECOVERY_LOCKED' | 'NOT_ENROLLED';
  guardianAssisted: boolean;
  verifiedAt: string | null;
  backupCodesRemaining: number;
  mandatoryForRole: boolean;
  lockedUntil: string | null;
}

export interface AccountSecurityStatus {
  userId: string;
  userIdCode: string;
  username: string;
  usernameUpdatedAt: string | null;
  role: UserRole;
  email: string;
  emailVerified: boolean;
  whatsappNumber: string;
  whatsappVerified: boolean;
  passwordUpdatedAt: string | null;
  totp: TotpEnrollmentSummary;
  contacts: VerifiedRecoveryContact[];
  pendingContactChanges: ContactChangeRequestRecord[];
  activeSessions: AuthSessionRecord[];
  recentSecurityEvents: SecurityEventRecord[];
  pendingRecoveryRequests: AdminRecoveryRequestRecord[];
  notificationPreferences: NotificationPreferences;
  linkedChildren: { id: string; name: string; userIdCode: string; totpEnabled: boolean; grade: string }[];
  linkedGuardian: { id: string; name: string; email: string; whatsappNumber: string } | null;
}

// --- Enhancement 05: Parent Learning Intelligence, Teaching Guidance & Smart Scheduling ---
export interface GuardianStudentLink {
  id: string;
  guardianUserId: string;
  guardianName?: string;
  guardianEmail?: string;
  guardianWhatsapp?: string;
  studentUserId: string;
  studentName?: string;
  studentUserIdCode?: string;
  studentGrade?: string;
  studentCurrentLevel?: PaperCategoryLevel;
  relationshipLabel: string;
  verified: boolean;
  consentGiven: boolean;
  canViewReports: boolean;
  canManageSchedule: boolean;
  canReceiveNotifications: boolean;
  studentCanEditSchedule: boolean;
  studentDailyMaxMinutes: number;
  studentRescheduleWindowHours: number;
  verifiedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParentTeachingGuidance {
  questionId: string;
  learningObjective: string;
  whatItTests: string;
  correctSolutionSteps: string[];
  plausibleErrorReasons: string[];
  teachingMethod: string;
  practicalExamples: string[];
  questionsToAskChild: string[];
  commonMistakesToAvoid: string[];
  followupPracticeSuggestion: string;
  teacherHelpIndicators: string[];
  shortCorrectNote: string;
  sourceType: 'educator_approved' | 'structured_curriculum' | 'ai_adapted';
  approvedByName?: string | null;
}

export type ReportCorrectnessStatus =
  | 'correct'
  | 'incorrect'
  | 'partially_correct'
  | 'unanswered'
  | 'pending_manual';

export interface ParentReportQuestionItem {
  snapshotId: string;
  questionId: string;
  questionVersion: number;
  subjectId: string;
  subjectName: string;
  topicId: string;
  topicName: string;
  subtopicId: string;
  subtopicName: string;
  questionType: QuestionType;
  difficulty: DifficultyTier;
  learningObjective: string;
  questionSi: string;
  questionEn: string;
  imageUrl?: string;
  options: [string, string, string, string];
  studentAnswerDisplay: string;
  submittedOptionIndex: number | null;
  submittedAnswerText: string | null;
  correctAnswerDisplay: string;
  correctIndex: number;
  markingCriteria: string;
  correctnessStatus: ReportCorrectnessStatus;
  awardedMarks: number;
  maxMarks: number;
  hint: string;
  stepByStepExplanation: string;
  memoryTrickTitle: string;
  memoryTrickBody: string;
  graderComment?: string | null;
  teachingGuidance: ParentTeachingGuidance;
  suggestedFollowupActivities: string[];
  relatedResources: {
    id: string;
    title: string;
    knowledgeType: KnowledgeType;
    summary: string;
  }[];
}

export interface ParentAssessmentReport {
  id: string;
  studentId: string;
  studentName: string;
  studentUserIdCode: string;
  attemptId: string;
  attemptSource: 'assessment_attempt' | 'round_attempt';
  assessmentId: string;
  assessmentTitle: string;
  assessmentKind: 'practice_session' | 'mock_exam';
  finalizationStatus: 'pending_manual_marking' | 'finalized';
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  partialCount: number;
  unansweredCount: number;
  pendingCount: number;
  awardedMarks: number;
  maxMarks: number;
  scorePercent: number | null;
  timeSpentSeconds: number;
  parentSummary: string;
  encouragementNote: string;
  mainImprovementAreas: {
    subjectId: string;
    subjectName: string;
    topicName: string;
    accuracyPercent: number;
    recommendedAction: string;
  }[];
  items: ParentReportQuestionItem[];
  recommendedResources: {
    id: string;
    title: string;
    subjectName: string;
    summary: string;
  }[];
  secureReportPath: string;
  generatedAt: string;
  finalizedAt: string | null;
  updatedAt: string;
}

export interface ReportDeliveryRecord {
  id: string;
  reportId: string;
  guardianUserId: string;
  guardianName?: string;
  channel: 'in_app' | 'email' | 'whatsapp';
  deliveryStage: 'completion_notice' | 'final_report';
  dedupeKey: string;
  deliveryStatus: 'delivered' | 'skipped_unverified' | 'skipped_preference' | 'failed';
  errorMessage?: string | null;
  sentAt: string;
}

export type LearningActivityType =
  | 'practice'
  | 'timed_practice'
  | 'mock_exam'
  | 'topic_revision'
  | 'followup_activity';

export type QuestionHistoryFilterMode =
  | 'all'
  | 'unattempted'
  | 'previously_attempted'
  | 'previously_incorrect'
  | 'repeated_error'
  | 'weak_areas'
  | 'revision_due';

export interface ScheduleQuestionFilters {
  grade?: string;
  subjectIds: string[];
  topicIds?: string[];
  subtopicIds?: string[];
  difficultyTiers?: DifficultyTier[];
  difficultyDistribution?: Partial<Record<DifficultyTier, number>>;
  questionTypes?: QuestionType[];
  cognitiveSkills?: string[];
  learningObjectiveQuery?: string;
  minMarks?: number;
  maxMarks?: number;
  minEstimatedSeconds?: number;
  maxEstimatedSeconds?: number;
  historyMode?: QuestionHistoryFilterMode;
  selectionMode?: AssessmentSelectionMode;
  balanceByTopic?: boolean;
  questionCount?: number;
}

export type TimetableRecurrenceType = 'one_time' | 'daily' | 'weekly' | 'weekdays' | 'custom';

export interface TimetablePresetActivity {
  id: string;
  presetId: string;
  versionNumber: number;
  sortOrder: number;
  title: string;
  activityType: LearningActivityType;
  dayOffset: number;
  timeOfDay: string; // HH:MM
  durationMinutes: number;
  recurrenceRule: TimetableRecurrenceType;
  subjectIds: string[];
  topicIds: string[];
  difficultyDistribution?: Partial<Record<DifficultyTier, number>>;
  filterCriteria: ScheduleQuestionFilters;
  fixedAssessmentId?: string | null;
  fixedPaperId?: string | null;
}

export interface TimetablePreset {
  id: string;
  title: string;
  description: string;
  creatorId: string;
  creatorName: string;
  creatorRole: UserRole;
  targetGrade: string;
  subjectIds: string[];
  topicIds: string[];
  recommendedFrequency: string;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'ARCHIVED';
  currentVersion: number;
  activities: TimetablePresetActivity[];
  createdAt: string;
  updatedAt: string;
}

export interface StudentTimetable {
  id: string;
  studentId: string;
  createdByUserId: string;
  sourcePresetId?: string | null;
  sourcePresetVersion?: number | null;
  title: string;
  description: string;
  timezone: string;
  startDate: string;
  endDate?: string | null;
  recurrenceType: TimetableRecurrenceType;
  weekdays: number[]; // 0=Sun..6=Sat
  exceptionDates: string[];
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

export type ScheduledSessionStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'MISSED'
  | 'PAUSED'
  | 'CANCELLED';

export interface ScheduledSessionRecord {
  id: string;
  timetableId?: string | null;
  studentId: string;
  studentName?: string;
  createdByUserId: string;
  title: string;
  activityType: LearningActivityType;
  timezone: string;
  scheduledStartUtc: string;
  scheduledEndUtc: string;
  durationMinutes: number;
  gracePeriodMinutes: number;
  recurrenceKey: string;
  status: ScheduledSessionStatus;
  maxAttempts: number;
  attemptsUsed: number;
  filterCriteria: ScheduleQuestionFilters;
  questionSnapshotIds?: string[];
  fixedAssessmentId?: string | null;
  fixedPaperId?: string | null;
  linkedAttemptId?: string | null;
  completedAt?: string | null;
  missedDetectedAt?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderPreferenceRecord {
  userId: string;
  studentId: string;
  leadTimesMinutes: number[];
  channels: {
    inApp: boolean;
    email: boolean;
    whatsapp: boolean;
  };
  dailyDigestEnabled: boolean;
  updatedAt: string;
}

export interface ReminderJobRecord {
  id: string;
  sessionId: string;
  recipientUserId: string;
  recipientRole: UserRole;
  channel: 'in_app' | 'email' | 'whatsapp';
  leadMinutes: number;
  scheduledForUtc: string;
  dedupeKey: string;
  status: 'PENDING' | 'SENT' | 'CANCELLED' | 'SKIPPED' | 'FAILED';
  sentAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

// --- Enhancement 06: Child Learning Wellbeing, Study-Time Intelligence & Safeguarding Audit ---
export type StudyActivityEventType =
  | 'session_open'
  | 'interaction_heartbeat'
  | 'question_viewed'
  | 'answer_selected'
  | 'hint_opened'
  | 'tab_backgrounded'
  | 'tab_resumed'
  | 'network_disconnected'
  | 'network_reconnected'
  | 'break_started'
  | 'break_ended'
  | 'paused'
  | 'resumed'
  | 'session_closed';

export type StudyActivityContextMode = 'practice' | 'timed_exam' | 'scheduled_session' | 'flashcards';

export interface StudyActivityEventInput {
  idempotencyKey: string;
  sessionKey: string;
  eventType: StudyActivityEventType;
  occurredAt?: string;
  contextMode: StudyActivityContextMode;
  deviceId: string;
  tabId: string;
  assessmentId?: string | null;
  scheduledSessionId?: string | null;
  paperId?: string | null;
  subjectId?: string | null;
  questionId?: string | null;
  durationHintSeconds?: number;
}

export interface StudyActivityEventRecord {
  id: string;
  userId: string;
  idempotencyKey: string;
  sessionKey: string;
  eventType: StudyActivityEventType;
  occurredAt: string;
  serverReceivedAt: string;
  contextMode: StudyActivityContextMode;
  deviceId: string;
  tabId: string;
  assessmentId: string | null;
  scheduledSessionId: string | null;
  paperId: string | null;
  subjectId: string | null;
  questionId: string | null;
}

export interface SessionActivitySummary {
  sessionKey: string;
  studentId: string;
  contextMode: StudyActivityContextMode;
  assessmentId: string | null;
  scheduledSessionId: string | null;
  paperId: string | null;
  subjectId: string | null;
  startedAt: string;
  endedAt: string;
  scheduledDurationSeconds: number;
  openDurationSeconds: number;
  activeDurationSeconds: number;
  idleDurationSeconds: number;
  backgroundDurationSeconds: number;
  breakTotalSeconds: number;
  breakCount: number;
  continuousPeakSeconds: number;
  interruptionCount: number;
  deviceCount: number;
  tabCount: number;
  inactivityThresholdSeconds: number;
  uncertaintyNote: string;
  updatedAt: string;
}

export interface DailyStudyBreakdownPoint {
  date: string;
  scheduledMinutes: number;
  openMinutes: number;
  activeMinutes: number;
  idleMinutes: number;
  backgroundMinutes: number;
  breakMinutes: number;
  practiceActiveMinutes: number;
  mockExamActiveMinutes: number;
  continuousPeakMinutes: number;
  sessionsCount: number;
}

export interface StudentStudyTimeAnalytics {
  studentId: string;
  studentName: string;
  grade: string;
  timezone: string;
  ruleVersionId: string;
  ruleVersionLabel: string;
  todaySummary: DailyStudyBreakdownPoint;
  weeklyTotals: {
    scheduledMinutes: number;
    openMinutes: number;
    activeMinutes: number;
    idleMinutes: number;
    backgroundMinutes: number;
    breakMinutes: number;
    practiceActiveMinutes: number;
    mockExamActiveMinutes: number;
    maxContinuousSessionMinutes: number;
    daysExceedingDailyGuideline: number;
  };
  dailySeries: DailyStudyBreakdownPoint[];
  recentSessions: SessionActivitySummary[];
  uncertaintyStatements: string[];
  guidelineSummary: {
    dailyWarningMinutes: number;
    dailyMaxMinutes: number;
    weeklyWarningMinutes: number;
    weeklyMaxMinutes: number;
    continuousSessionWarningMinutes: number;
    recommendedBreakMinutes: number;
    breakIntervalMinutes: number;
    educationalStandardNote: string;
  };
}

export type WellbeingWarningSeverity =
  | 'nominal'
  | 'advisory'
  | 'supportive_warning'
  | 'staff_review_trigger';

export type TimedAssessmentBreakPolicy =
  | 'warn_non_blocking_unless_paused'
  | 'suggest_pause_after_section'
  | 'strict_no_interrupt_until_submit';

export type WellbeingRuleApprovalStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'ARCHIVED';

export interface WellbeingRuleVersion {
  id: string;
  ruleSetId: string;
  versionNumber: number;
  grade: string;
  subjectId: string | null;
  title: string;
  educationalStandardNote: string;
  dailyWarningMinutes: number;
  dailyMaxMinutes: number;
  weeklyWarningMinutes: number;
  weeklyMaxMinutes: number;
  continuousSessionWarningMinutes: number;
  recommendedBreakMinutes: number;
  breakIntervalMinutes: number;
  inactivityThresholdSeconds: number;
  reminderFrequencyMinutes: number;
  warningSeverity: WellbeingWarningSeverity;
  timedAssessmentBreakPolicy: TimedAssessmentBreakPolicy;
  staffReviewDailyExceedCount: number;
  staffReviewConsecutiveDays: number;
  escalationContinuousDays: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  approvalStatus: WellbeingRuleApprovalStatus;
  createdByUserId: string;
  createdByName: string;
  approvedByAdminId: string | null;
  approvedAt: string | null;
  changeNote: string;
  createdAt: string;
}

export interface WellbeingRuleSet {
  id: string;
  title: string;
  grade: string;
  subjectId: string | null;
  isPlatformWide: boolean;
  currentActiveVersionId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  versions: WellbeingRuleVersion[];
}

export type ParentScheduleDecision =
  | 'pending'
  | 'adjusted'
  | 'proceeded_with_acknowledgement'
  | 'cancelled';

export interface WellbeingSuggestedChange {
  date: string;
  currentScheduledMinutes: number;
  recommendedMaxMinutes: number;
  suggestionText: string;
  recommendedBreakPlan: string;
}

export interface PreScheduleWellbeingValidationResult {
  studentId: string;
  ruleVersionId: string;
  ruleTitle: string;
  severity: WellbeingWarningSeverity;
  exceedsDailyWarning: boolean;
  exceedsDailyMax: boolean;
  exceedsWeeklyWarning: boolean;
  exceedsWeeklyMax: boolean;
  exceedsContinuousThreshold: boolean;
  insufficientPlannedBreaks: boolean;
  requiresStaffReview: boolean;
  proposedMinutesTotal: number;
  peakDailyCombinedMinutes: number;
  peakWeeklyCombinedMinutes: number;
  peakContinuousMinutes: number;
  supportiveTitle: string;
  supportiveMessage: string;
  educationalGuidelineNotice: string;
  exceededRules: string[];
  balancedSuggestions: WellbeingSuggestedChange[];
  dailyProjections: {
    date: string;
    existingMinutes: number;
    proposedMinutes: number;
    combinedMinutes: number;
  }[];
}

export interface WellbeingWarningRecord {
  id: string;
  studentId: string;
  studentName?: string;
  guardianUserId: string | null;
  triggerSource: 'pre_schedule' | 'live_session' | 'daily_threshold_sweep';
  ruleVersionId: string;
  severity: WellbeingWarningSeverity;
  scheduledMinutes: number;
  observedActiveMinutes: number;
  continuousMinutes: number;
  supportiveTitle: string;
  guidanceSummary: string;
  suggestedAdjustmentJson: string;
  parentDecision: ParentScheduleDecision;
  parentDecisionNotes: string | null;
  parentDecidedAt: string | null;
  notifiedChannels: string[];
  linkedCaseId: string | null;
  createdAt: string;
}

export type WellbeingCaseStatus =
  | 'DETECTED'
  | 'PENDING_REVIEW'
  | 'UNDER_REVIEW'
  | 'PARENT_CONTACTED'
  | 'FOLLOW_UP'
  | 'RESOLVED'
  | 'DISMISSED'
  | 'REOPENED'
  | 'REFERRED_SAFEGUARDING';

export type WellbeingCasePriority = 'low' | 'medium' | 'high' | 'urgent';

export interface WellbeingCaseRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: string;
  ongoingConcernKey: string;
  title: string;
  triggerCategory: string;
  status: WellbeingCaseStatus;
  priority: WellbeingCasePriority;
  ruleVersionId: string;
  assignedToUserId: string | null;
  assignedToName: string | null;
  subjectScopeIds: string[];
  isSafeguardingRestricted: boolean;
  dismissalReason: string | null;
  resolutionSummary: string | null;
  summaryOfConcern: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface WellbeingCaseNoteRecord {
  id: string;
  caseId: string;
  authorUserId: string;
  authorName: string;
  authorRole: UserRole | 'system';
  noteType: 'system_detection' | 'staff_review' | 'amendment';
  factualObservations: string;
  staffInterpretation: string;
  limitationsNoted: string;
  supersedesNoteId: string | null;
  versionNumber: number;
  createdAt: string;
}

export interface ParentContactRecord {
  id: string;
  noteGroupId: string;
  versionNumber: number;
  supersedesNoteId: string | null;
  amendmentReason: string | null;
  isFinalized: boolean;
  finalizedAt: string | null;
  caseId: string;
  studentId: string;
  guardianUserId: string | null;
  staffUserId: string;
  staffName: string;
  contactAt: string;
  contactMethod: 'phone' | 'whatsapp' | 'email' | 'in_person' | 'video_call';
  contactOutcome: 'connected' | 'left_message' | 'no_response' | 'scheduled_meeting';
  factualObservations: string;
  directQuotations: string;
  staffOpinions: string;
  guidanceProvided: string;
  parentResponse: string;
  agreedActions: string;
  followUpDate: string | null;
  evidenceRefs: { type: string; id: string; label: string }[];
  resultingCaseStatus: WellbeingCaseStatus;
  createdAt: string;
}

export interface WellbeingFollowupActionRecord {
  id: string;
  caseId: string;
  title: string;
  description: string;
  ownerUserId: string;
  ownerName: string;
  dueDate: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  completionNotes: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface WellbeingCaseEvidenceRecord {
  id: string;
  caseId: string;
  evidenceType:
    | 'wellbeing_warning'
    | 'session_activity'
    | 'timetable'
    | 'assessment_attempt'
    | 'parent_contact';
  referenceId: string;
  summary: string;
  snapshotJson: string;
  attachedByUserId: string;
  createdAt: string;
}

export interface WellbeingCaseDetail {
  caseRecord: WellbeingCaseRecord;
  evidence: WellbeingCaseEvidenceRecord[];
  notes: WellbeingCaseNoteRecord[];
  parentContacts: ParentContactRecord[];
  followUpActions: WellbeingFollowupActionRecord[];
  assignments: {
    id: string;
    assignedToUserId: string;
    assignedToName: string;
    assignedByUserId: string;
    assignedByName: string;
    reason: string;
    createdAt: string;
  }[];
  relatedWarnings: WellbeingWarningRecord[];
  recentActivitySummary: StudentStudyTimeAnalytics;
}

export type SafeguardingDecisionStatus =
  | 'ASSESSMENT_IN_PROGRESS'
  | 'MONITORING_WITH_SUPPORT'
  | 'NOT_REFERRED_NO_RISK'
  | 'DRAFT_REFERRAL_PREPARED'
  | 'APPROVED_FOR_REFERRAL'
  | 'REFERRED_TO_AUTHORITY';

export interface SafeguardingChronologyEntry {
  occurredAt: string;
  source: string;
  factualDescription: string;
  limitationsOrContext: string;
}

export interface SafeguardingReviewRecord {
  id: string;
  caseId: string;
  studentId: string;
  studentName: string;
  concernsSummary: string;
  uncertaintiesAndLimitations: string;
  chronology: SafeguardingChronologyEntry[];
  decision: SafeguardingDecisionStatus;
  referralRecommended: boolean;
  referralDraftText: string;
  externalAuthorityRef: string | null;
  reviewedByUserId: string;
  reviewedByName: string;
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AuditDocumentType =
  | 'student_activity_report'
  | 'scheduled_vs_observed_report'
  | 'wellbeing_warning_report'
  | 'parent_contact_followup_report'
  | 'internal_case_review_summary'
  | 'safeguarding_referral_draft';

export interface AuditDocumentRecord {
  id: string;
  reportCode: string;
  documentType: AuditDocumentType;
  versionNumber: number;
  studentId: string;
  studentName: string;
  caseId: string | null;
  safeguardingReviewId: string | null;
  isRestrictedSafeguarding: boolean;
  title: string;
  preparedByUserId: string;
  preparedByName: string;
  preparedByRole: UserRole;
  periodStart: string;
  periodEnd: string;
  ruleVersionId: string;
  ruleVersionTitle: string;
  factualEvidenceSummary: string[];
  dataSources: string[];
  interventionsSummary: string[];
  parentContactHistorySummary: string[];
  caseStatusAtGeneration: string;
  limitationsAndUncertainties: string[];
  approvalStatus: 'DRAFT' | 'HUMAN_APPROVED';
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  payloadJson: string;
  createdAt: string;
}

export interface AuditDocumentAccessLog {
  id: string;
  documentId: string;
  accessorUserId: string;
  accessorName: string;
  accessorRole: UserRole;
  accessAction: 'VIEW' | 'EXPORT_PDF' | 'GENERATE';
  accessedAt: string;
}

// --- Enhancement 07: Advanced Parent Academic Routine Builder, Weighted Learning Allocation & Teacher Evaluation ---

export type EducationalSkillCategory =
  | 'recall'
  | 'numerical_ability'
  | 'logical_reasoning'
  | 'reading_comprehension'
  | 'problem_solving'
  | 'spatial_reasoning'
  | 'attention_to_detail'
  | 'time_management'
  | 'critical_thinking';

export type SkillClassificationSource =
  | 'curated_metadata'
  | 'subject_curriculum_map'
  | 'teacher_tag';

export interface QuestionSkillMappingRecord {
  id: string;
  questionId: string;
  skillKey: EducationalSkillCategory;
  classificationSource: SkillClassificationSource;
  confidenceNote: string;
  educationalDisclaimer: string;
  createdAt: string;
}

export type RoutineMixingMethod =
  | 'single_subject'
  | 'mixed_session'
  | 'separate_sessions'
  | 'alternating'
  | 'daily_custom';

export type RoutineWorkflowStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'ACTIVE'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'PAUSED'
  | 'COMPLETED'
  | 'ARCHIVED';

export type RoutineScheduleMode = 'fixed' | 'adaptive';

export type RoutineDifficultyBucket = 'simple' | 'moderate' | 'difficult';

export type RoutineExposurePreference =
  | 'unattempted'
  | 'previously_incorrect'
  | 'repeated_error'
  | 'revision_due'
  | 'weak_areas'
  | 'all';

export interface RoutineSubjectWeight {
  subjectId: string;
  subjectName?: string;
  enabled: boolean;
  weightPercent: number;
  topicIds: string[];
  subtopicIds: string[];
}

export interface RoutineSkillWeight {
  skillKey: EducationalSkillCategory;
  skillLabel?: string;
  enabled: boolean;
  weightPercent: number;
  isEducationalCategory: true;
}

export interface RoutineDifficultyDistribution {
  simple: number;
  moderate: number;
  difficult: number;
  useEmpiricalCalibration: boolean;
}

export interface RoutineDailyRuleOverride {
  weekday: number; // 0 = Sunday .. 6 = Saturday
  label?: string;
  timeOfDay?: string;
  durationMinutes?: number;
  subjectWeights: RoutineSubjectWeight[];
  practiceSessionCount?: number;
  mockPaperCount?: number;
}

export interface RoutineAdaptiveBounds {
  maxDailyShiftMinutes: number;
  maxDifficultyShiftPercent: number;
  maxSubjectWeightShiftPercent: number;
  allowQuestionSubstitution: boolean;
  notifyParentOnAdjustment: boolean;
  requireApprovalOutsideBounds: boolean;
}

export interface RoutineReminderConfig {
  enabled: boolean;
  leadTimesMinutes: number[];
  channels: {
    inApp: boolean;
    email: boolean;
    whatsapp: boolean;
  };
}

export interface AcademicRoutineConfigInput {
  studentId: string;
  title: string;
  description?: string;
  grade?: string;
  startDate: string;
  startTimeOfDay: string; // HH:MM
  timezone?: string;
  recurrenceType: 'one_time' | 'daily' | 'weekly' | 'weekdays' | 'custom';
  weekdays?: number[];
  endDate?: string | null;
  totalDurationWeeks?: number | null;
  exceptionDates?: string[];
  mixingMethod: RoutineMixingMethod;
  subjectWeights: RoutineSubjectWeight[];
  skillWeights: RoutineSkillWeight[];
  difficultyDistribution: RoutineDifficultyDistribution;
  questionCountPerSession: number;
  sessionDurationMinutes: number;
  practiceRatioPercent: number; // e.g. 75% practice, 25% mock papers
  mockFrequencyDays?: number; // e.g. every N occurrences or weekly mock
  exposurePreference: RoutineExposurePreference;
  scheduleMode: RoutineScheduleMode;
  breakIntervalMinutes: number;
  breakDurationMinutes: number;
  dailyRuleOverrides?: RoutineDailyRuleOverride[];
  adaptiveBounds?: RoutineAdaptiveBounds;
  reminderConfig?: RoutineReminderConfig;
  excludedQuestionIds?: string[];
  changeNote?: string;
}

export interface RoutineVersionRecord {
  id: string;
  routineId: string;
  versionNumber: number;
  title: string;
  description: string;
  grade: string;
  startDate: string;
  startTimeOfDay: string;
  timezone: string;
  recurrenceType: TimetableRecurrenceType;
  weekdays: number[];
  endDate: string | null;
  totalDurationWeeks: number | null;
  exceptionDates: string[];
  mixingMethod: RoutineMixingMethod;
  subjectWeights: RoutineSubjectWeight[];
  skillWeights: RoutineSkillWeight[];
  difficultyDistribution: RoutineDifficultyDistribution;
  questionCountPerSession: number;
  sessionDurationMinutes: number;
  practiceRatioPercent: number;
  mockFrequencyDays: number;
  exposurePreference: RoutineExposurePreference;
  scheduleMode: RoutineScheduleMode;
  breakIntervalMinutes: number;
  breakDurationMinutes: number;
  dailyRuleOverrides: RoutineDailyRuleOverride[];
  adaptiveBounds: RoutineAdaptiveBounds;
  reminderConfig: RoutineReminderConfig;
  excludedQuestionIds: string[];
  materialHash: string;
  requiresReReview: boolean;
  changeNote: string;
  createdByUserId: string;
  createdAt: string;
}

export interface RoutineReviewAssignment {
  id: string;
  routineId: string;
  routineVersionId: string;
  reviewerUserId: string;
  reviewerName: string;
  reviewerRole: 'teacher' | 'admin';
  subjectIds: string[];
  status: 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  assignedAt: string;
  completedAt: string | null;
}

export interface RoutineTeacherEvaluation {
  id: string;
  routineId: string;
  routineVersionId: string;
  teacherUserId: string;
  teacherName: string;
  scopedSubjectIds: string[];
  subjectComponentDecisions: Record<string, 'approved' | 'changes_requested' | 'comment_only'>;
  decision: 'approved_components' | 'recommend_changes' | 'comment_only';
  topicSuitabilityNote: string;
  difficultySuitabilityNote: string;
  skillBalanceNote: string;
  evidenceComparisonNote: string;
  generalComment: string;
  recommendedChangesJson: string;
  createdAt: string;
}

export interface RoutineAdminEvaluation {
  id: string;
  routineId: string;
  routineVersionId: string;
  adminUserId: string;
  adminName: string;
  decision: 'approved' | 'changes_requested' | 'rejected' | 'comment_only';
  overallBalanceNote: string;
  wellbeingReviewNote: string;
  coordinationSummary: string;
  createdAt: string;
}

export interface RoutineChangeRequest {
  id: string;
  routineId: string;
  routineVersionId: string;
  requestedByUserId: string;
  requestedByName: string;
  requestedByRole: 'teacher' | 'admin';
  subjectId: string | null;
  category:
    | 'subject_weight'
    | 'topic_selection'
    | 'skill_focus'
    | 'difficulty_balance'
    | 'study_load_wellbeing'
    | 'schedule_timing'
    | 'other';
  summary: string;
  suggestedChangeJson: string;
  status: 'OPEN' | 'ADDRESSED' | 'DISMISSED';
  resolvedAt: string | null;
  createdAt: string;
}

export interface RoutineApprovalHistoryEntry {
  id: string;
  routineId: string;
  routineVersionId: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole | 'system';
  fromStatus: RoutineWorkflowStatus | null;
  toStatus: RoutineWorkflowStatus;
  action: string;
  note: string;
  createdAt: string;
}

export interface RoutineAdaptiveAdjustment {
  id: string;
  routineId: string;
  routineVersionId: string;
  triggeredAt: string;
  reasonSummary: string;
  adjustmentType:
    | 'subject_weight_shift'
    | 'difficulty_shift'
    | 'skill_emphasis'
    | 'question_substitution'
    | 'duration_trim';
  withinParentBounds: boolean;
  status: 'APPLIED' | 'PENDING_PARENT_APPROVAL' | 'APPROVED' | 'REJECTED';
  proposedChangesJson: string;
  constraintsPreservedNote: string;
  parentApprovedByUserId: string | null;
  resolvedAt: string | null;
}

export interface AcademicRoutineRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: string;
  guardianUserId: string;
  guardianName: string;
  title: string;
  description: string;
  workflowStatus: RoutineWorkflowStatus;
  scheduleMode: RoutineScheduleMode;
  currentVersionNumber: number;
  activeVersionNumber: number | null;
  linkedTimetableId: string | null;
  requiresReReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalibratedDifficultyResolution {
  questionId: string;
  authorTier: RoutineDifficultyBucket;
  empiricalTier: RoutineDifficultyBucket | null;
  effectiveTier: RoutineDifficultyBucket;
  calibrationSource: 'empirical_reliable' | 'author_metadata';
  validAttempts: number;
  correctRate: number | null;
  discrepancyNote: string | null;
}

export interface WeightedAllocationPlan {
  questionCount: number;
  subjectTargets: Record<string, number>;
  skillTargets: Record<string, number>;
  difficultyTargets: Record<RoutineDifficultyBucket, number>;
}

export interface RoutineQuestionSelectionResult {
  requestedCount: number;
  selectedCount: number;
  selectedQuestions: QuizItem[];
  allocatedBySubject: Record<string, number>;
  allocatedBySkill: Record<string, number>;
  allocatedByDifficulty: Record<RoutineDifficultyBucket, number>;
  calibratedResolutions: CalibratedDifficultyResolution[];
  shortages: {
    dimension: 'overall' | 'subject' | 'skill' | 'difficulty' | 'exposure';
    key: string;
    label: string;
    requestedCount: number;
    availableCount: number;
    shortfall: number;
    explanation: string;
  }[];
  unmetTargets: string[];
  substitutionNotes: string[];
}

export interface PlannedRoutineSlot {
  occurrenceIndex: number;
  localDate: string;
  timeOfDay: string;
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
  activityType: LearningActivityType;
  title: string;
  subjectIds: string[];
  subjectWeightsForSlot: Record<string, number>;
  questionIds: string[];
  breakNote: string | null;
}

export interface QuestionStats {
  questionId: string;
  subjectId: string;
  totalEvents: number;
  validAttempts: number;
  skippedCount: number;
  timedOutCount: number;
  uniqueStudents: number;
  correctAttempts: number;
  incorrectAttempts: number;
  correctRate: number;
  incorrectRate: number;
  firstAttemptTotal: number;
  firstAttemptCorrect: number;
  repeatAttemptTotal: number;
  repeatAttemptCorrect: number;
  hintAssistedTotal: number;
  hintAssistedCorrect: number;
  unassistedTotal: number;
  unassistedCorrect: number;
  repeatedErrorStudentCount: number;
  medianResponseMs: number;
  p90ResponseMs: number;
  updatedAt: string;
}

export interface StudentQuestionStat {
  studentId: string;
  questionId: string;
  subjectId: string;
  validAttempts: number;
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttemptAt: string;
}

export interface ScheduleConflictItem {
  conflictingSessionId: string;
  conflictingTitle: string;
  conflictingStartUtc: string;
  conflictingEndUtc: string;
  candidateStartUtc: string;
  candidateEndUtc: string;
  reason: string;
}

export interface RoutineValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  subjectWeightTotal: number;
  skillWeightTotal: number;
  difficultyTotal: number;
  allocationPlan: WeightedAllocationPlan;
  questionPreview: RoutineQuestionSelectionResult;
  plannedSlots: PlannedRoutineSlot[];
  scheduleConflicts: ScheduleConflictItem[];
  wellbeingCheck: PreScheduleWellbeingValidationResult | null;
}

export interface RoutinePerformanceSummary {
  routineId: string;
  routineVersionNumber: number;
  generatedAt: string;
  adherenceSummary: {
    plannedSessionsCount: number;
    deliveredSessionsCount: number;
    completedSessionsCount: number;
    missedSessionsCount: number;
    upcomingSessionsCount: number;
    completionRatePercent: number;
    plannedMinutesTotal: number;
    observedActiveMinutesTotal: number;
  };
  subjectComparison: {
    subjectId: string;
    subjectName: string;
    plannedWeightPercent: number;
    actualDeliveredPercent: number;
    questionsAttempted: number;
    correctCount: number;
    accuracyPercent: number | null;
    variancePercent: number;
  }[];
  skillComparison: {
    skillKey: EducationalSkillCategory;
    skillLabel: string;
    plannedWeightPercent: number;
    actualDeliveredPercent: number;
    questionsAttempted: number;
    accuracyPercent: number | null;
    educationalNote: string;
  }[];
  difficultyComparison: {
    tier: RoutineDifficultyBucket;
    plannedPercent: number;
    actualDeliveredPercent: number;
    questionsAttempted: number;
    accuracyPercent: number | null;
  }[];
  activityMixComparison: {
    plannedPracticePercent: number;
    actualPracticePercent: number;
    plannedMockPercent: number;
    actualMockPercent: number;
  };
  repeatedErrorsCount: number;
  shortageAndMissedExplanations: string[];
  wellbeingComplianceNote: string;
  scopeLimitationsNote: string;
}

export interface AcademicRoutineDetail {
  routine: AcademicRoutineRecord;
  currentVersion: RoutineVersionRecord;
  versions: RoutineVersionRecord[];
  reviewAssignments: RoutineReviewAssignment[];
  teacherEvaluations: RoutineTeacherEvaluation[];
  adminEvaluations: RoutineAdminEvaluation[];
  changeRequests: RoutineChangeRequest[];
  approvalHistory: RoutineApprovalHistoryEntry[];
  adaptiveAdjustments: RoutineAdaptiveAdjustment[];
  latestPerformanceSummary: RoutinePerformanceSummary | null;
  studentContext: {
    studentId: string;
    studentName: string;
    recentOverallAccuracyPercent: number | null;
    openInterventionCount: number;
    subjectMetrics: {
      subjectId: string;
      subjectName: string;
      attempts: number;
      accuracyPercent: number | null;
      repeatedErrorCount: number;
    }[];
  };
}

// --- Enhancement 08: Gamified Learning Roadmaps, Progressive Levels, Interactive Missions & Adaptive Challenges ---

export type RoadmapStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

export type RoadmapLevelStatus = 'LOCKED' | 'AVAILABLE' | 'ACTIVE' | 'COMPLETED';

export type RoadmapMissionType =
  | 'standard'
  | 'topic_practice'
  | 'mixed_topic'
  | 'puzzle'
  | 'timed_challenge'
  | 'revision'
  | 'mastery_checkpoint'
  | 'remedial'
  | 'final_stage_challenge';

export type RoadmapRewardType =
  | 'xp'
  | 'stars'
  | 'badge'
  | 'coins'
  | 'avatar_cosmetic'
  | 'stage_trophy'
  | 'mastery_achievement';

export interface RoadmapGrowthFormula {
  baseQuestionCount: number;
  incrementPerLevel: number;
  maxQuestionCount: number;
  maxQuestionsPerMission: number;
  maxSessionDurationMinutes: number;
}

export interface RoadmapDifficultyWeights {
  Simple: number;
  Moderate: number;
  Challenging: number;
  Master: number;
}

export interface RoadmapStage {
  id: string;
  roadmapId: string;
  versionNumber: number;
  sortOrder: number;
  title: string;
  description: string;
  themeColor: string;
  milestoneRewardBadgeId: string | null;
  createdAt: string;
}

export interface RoadmapLevel {
  id: string;
  roadmapId: string;
  versionNumber: number;
  stageId: string;
  sequenceOrder: number;
  title: string;
  description: string;
  academicObjectives: string[];
  subjectIds: string[];
  topicIds: string[];
  subtopicIds: string[];
  targetQuestionCount: number;
  maxQuestionCount: number;
  difficultyDistribution: RoadmapDifficultyWeights;
  minMasteryAccuracyPercent: number;
  requiredMissionsCount: number;
  hasCheckpoint: boolean;
  specialUnlockNote: string | null;
  xpReward: number;
  starsReward: number;
  coinsReward: number;
  unlockCosmeticId: string | null;
  prerequisiteLevelIds: string[];
}

export interface RoadmapMission {
  id: string;
  roadmapId: string;
  versionNumber: number;
  levelId: string;
  sortOrder: number;
  title: string;
  description: string;
  missionType: RoadmapMissionType;
  subjectIds: string[];
  topicIds: string[];
  subtopicIds: string[];
  questionCount: number;
  difficultyDistribution: RoadmapDifficultyWeights;
  timeLimitSeconds: number | null;
  isRequired: boolean;
  isRemedial: boolean;
  minPassAccuracyPercent: number;
  xpReward: number;
  starsReward: number;
  coinsReward: number;
  allowRetry: boolean;
  puzzleHintMode: boolean;
  maxAttemptsPerDay: number;
}

export interface RewardDefinition {
  id: string;
  code: string;
  rewardType: RoadmapRewardType;
  title: string;
  description: string;
  iconKey: string;
  cosmeticPreview: {
    slot?: 'avatar_frame' | 'companion' | 'crest';
    accentHex?: string;
    imageUrl?: string;
  };
  milestoneRuleText: string;
  active: boolean;
}

export interface GameRoadmapRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  grade: string;
  scopeType: 'subject' | 'mixed';
  subjectIds: string[];
  themeKey: string;
  bannerImageUrl: string | null;
  status: RoadmapStatus;
  currentVersion: number;
  growthFormula: RoadmapGrowthFormula;
  wellbeingMaxSessionMinutes: number;
  creatorUserId: string;
  creatorName: string;
  creatorRole: UserRole;
  approvedByUserId: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoadmapAvailabilityIssue {
  levelId: string;
  levelTitle: string;
  missionId?: string;
  missionTitle?: string;
  requestedCount: number;
  availableCount: number;
  message: string;
}

export interface StudentLevelProgressRecord {
  id: string;
  studentId: string;
  roadmapId: string;
  levelId: string;
  status: RoadmapLevelStatus;
  bestAccuracyPercent: number;
  missionsCompletedCount: number;
  checkpointPassed: boolean;
  objectivesCovered: string[];
  unlockedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface MissionAttemptRecord {
  id: string;
  studentId: string;
  roadmapId: string;
  levelId: string;
  missionId: string;
  questionSnapshotIds: string[];
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number;
  observedActiveSeconds: number;
  totalQuestions: number;
  correctCount: number;
  accuracyPercent: number | null;
  masteryPassed: boolean;
  rewardGranted: boolean;
  idempotencyKey: string;
}

export interface RewardTransactionRecord {
  id: string;
  studentId: string;
  roadmapId: string | null;
  levelId: string | null;
  missionAttemptId: string | null;
  rewardType: RoadmapRewardType;
  rewardDefId: string | null;
  amount: number;
  reason: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface StudentUnlockedRewardRecord {
  id: string;
  studentId: string;
  rewardDefId: string;
  reward: RewardDefinition;
  equipped: boolean;
  unlockedAt: string;
}

export interface MasteryCheckpointResultRecord {
  id: string;
  studentId: string;
  roadmapId: string;
  levelId: string;
  missionAttemptId: string;
  accuracyPercent: number;
  passed: boolean;
  weakTopicIds: string[];
  remediationRecommended: boolean;
  feedbackNote: string;
  createdAt: string;
}

export interface GameRoadmapDetail {
  roadmap: GameRoadmapRecord;
  stages: RoadmapStage[];
  levels: RoadmapLevel[];
  missions: RoadmapMission[];
  availabilityIssues: RoadmapAvailabilityIssue[];
  versions: {
    versionNumber: number;
    title: string;
    changeNote: string;
    createdAt: string;
  }[];
  studentProgress?: {
    enrolled: boolean;
    currentLevelId: string | null;
    levelProgress: StudentLevelProgressRecord[];
    recentAttempts: MissionAttemptRecord[];
    adaptiveRecommendations: {
      levelId: string;
      weakTopicIds: string[];
      weakTopicNames: string[];
      suggestedMissionId: string | null;
      explanation: string;
    }[];
  };
}

export interface StudentGamificationDashboard {
  studentId: string;
  studentName: string;
  totalXp: number;
  explorerRank: number;
  xpIntoCurrentRank: number;
  xpNeededForNextRank: number;
  totalStars: number;
  totalCoins: number;
  streakDays: number;
  unlockedRewards: StudentUnlockedRewardRecord[];
  allRewardDefinitions: RewardDefinition[];
  recentTransactions: RewardTransactionRecord[];
  roadmaps: GameRoadmapDetail[];
  wellbeingStatus: {
    dailyScheduledMinutes: number;
    dailyObservedActiveMinutes: number;
    dailyMaxMinutes: number;
    recommendedBreakMinutes: number;
    breakIntervalMinutes: number;
    shouldTakeBreakSoon: boolean;
    dailyLimitReached: boolean;
    supportiveMessage: string;
  };
}

export interface RoadmapMissionCompletionResult {
  attempt: MissionAttemptRecord;
  checkpointResult: MasteryCheckpointResultRecord | null;
  questionOutcomes: {
    questionId: string;
    isCorrect: boolean;
    correctIndex: number;
    selectedIndex: number | null;
    explanation: string;
    memoryTrickTitle: string;
    memoryTrickBody: string;
  }[];
  levelEvaluation: {
    levelId: string;
    previousStatus: RoadmapLevelStatus;
    newStatus: RoadmapLevelStatus;
    completedJustNow: boolean;
    encouragementMessage: string;
    unmetCriteria: string[];
    unlockedNextLevels: { levelId: string; title: string }[];
  };
  rewardsGranted: RewardTransactionRecord[];
  unlockedCosmetics: RewardDefinition[];
  remediationSuggestion: {
    triggered: boolean;
    weakTopicIds: string[];
    explanation: string;
    remedialMissionId: string | null;
  } | null;
}

export interface RoadmapProgressReport {
  studentId: string;
  studentName: string;
  roadmapId: string;
  roadmapName: string;
  completedLevelsCount: number;
  totalLevelsCount: number;
  currentLevelTitle: string | null;
  overallAccuracyPercent: number | null;
  totalMissionAttempts: number;
  observedActiveMinutes: number;
  skillsPracticed: { skillKey: EducationalSkillCategory; skillLabel: string; questionCount: number }[];
  repeatedErrorTopics: { topicId: string; topicName: string; errorCount: number }[];
  checkpointHistory: MasteryCheckpointResultRecord[];
  adaptiveExplanations: string[];
  suggestedNextActivities: string[];
}




