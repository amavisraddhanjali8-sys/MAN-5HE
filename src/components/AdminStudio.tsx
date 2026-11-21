import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  CreditCard,
  Eraser,
  Eye,
  FileText,
  History,
  Layers,
  PenTool,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Sliders,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import { COGNITIVE_DOMAINS, calculateQuizDifficultyScore } from '../lib/psychometrics';
import type {
  AcademicConfig,
  AdminRecoveryRequestRecord,
  AuditLogRecord,
  CognitiveDomain,
  ExamPaper,
  GuardianStudentLink,
  NotificationRecord,
  PaperQualitySummary,
  QuizItem,
  StudentTrajectory,
  SubjectCategory,
  SubtopicNode,
  TopicNode,
} from '../lib/types';
import { AssessmentBuilderWorkspace } from './AssessmentBuilderWorkspace';
import { InterventionWorkspace } from './InterventionWorkspace';
import { KnowledgePublishingConsole } from './KnowledgePublishingConsole';
import { QuestionBankManager } from './QuestionBankManager';
import { QuestionReviewDrawer } from './QuestionReviewDrawer';
import { ScopedAnalyticsView } from './ScopedAnalyticsView';
import { TimetablePresetManager } from './TimetablePresetManager';

export type AdminSectionId =
  | 'overview'
  | 'curriculum'
  | 'papers'
  | 'people'
  | 'interventions'
  | 'knowledge'
  | 'settings';

interface AdminStudioProps {
  user?: AuthUser;
  activeSection?: AdminSectionId;
  onSectionChange?: (sec: AdminSectionId) => void;
  subjects?: SubjectCategory[];
  topics?: TopicNode[];
  subtopics?: SubtopicNode[];
  initialCaseId?: string | null;
  onClearInitialCase?: () => void;
  onOpenBilling?: () => void;
  onOpenDocs?: () => void;
}

export function AdminStudio({
  user: propUser,
  activeSection,
  onSectionChange,
  subjects: propSubjects,
  topics: propTopics,
  subtopics: propSubtopics,
  initialCaseId,
  onClearInitialCase,
  onOpenBilling,
  onOpenDocs,
}: AdminStudioProps) {
  const effectiveAdminUser: AuthUser = propUser || {
    id: 'usr-admin-1',
    userIdCode: 'M5-ADM-001',
    name: 'Platform Administrator',
    email: 'admin@man5he.lk',
    whatsappNumber: '+94 77 000 0001',
    role: 'admin',
    emailVerified: true,
    totpEnabled: false,
    subscriptionStatus: 'active',
    subscriptionPlanId: null,
    subscriptionExpiresAt: null,
    currentLevel: 'Scholarship Master',
    stars: 0,
    streakDays: 0,
    createdAt: '',
  };
  const [internalSection, setInternalSection] = useState<AdminSectionId>('overview');
  const currentSection = activeSection ?? internalSection;
  const setSection = (next: AdminSectionId) => {
    setInternalSection(next);
    onSectionChange?.(next);
  };

  // Curriculum hierarchy (loaded if not passed)
  const [subjects, setSubjects] = useState<SubjectCategory[]>(propSubjects || []);
  const [topics, setTopics] = useState<TopicNode[]>(propTopics || []);
  const [subtopics, setSubtopics] = useState<SubtopicNode[]>(propSubtopics || []);

  useEffect(() => {
    if (propSubjects && propSubjects.length > 0) setSubjects(propSubjects);
    if (propTopics && propTopics.length > 0) setTopics(propTopics);
    if (propSubtopics && propSubtopics.length > 0) setSubtopics(propSubtopics);
  }, [propSubjects, propTopics, propSubtopics]);

  const [quizzes, setQuizzes] = useState<
    (QuizItem & {
      stats?: {
        validAttempts: number;
        correctRate: number;
        incorrectRate: number;
        repeatedErrorStudentCount: number;
      };
    })[]
  >([]);
  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [totalVirtualPool, setTotalVirtualPool] = useState(500000);
  const [curatedCount, setCuratedCount] = useState(0);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'curated' | 'pool'>('all');
  const [subjectExplorerFilter, setSubjectExplorerFilter] = useState('All');

  // Admin Quiz Creator State
  const [createSubjectId, setCreateSubjectId] = useState('subj-math');
  const [createTopicId, setCreateTopicId] = useState('top-math-arith');
  const [createSubtopicId, setCreateSubtopicId] = useState('sub-math-div');
  const [questionSi, setQuestionSi] = useState('');
  const [questionEn, setQuestionEn] = useState('');
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [optC, setOptC] = useState('');
  const [optD, setOptD] = useState('');
  const [correctIndex, setCorrectIndex] = useState(0);
  const [memoryTrickTitle, setMemoryTrickTitle] = useState('');
  const [memoryTrickBody, setMemoryTrickBody] = useState('');
  const [explanation, setExplanation] = useState('');

  // Psychometric Attributes
  const [cognitiveDomain, setCognitiveDomain] = useState<CognitiveDomain>(
    'Mathematics & Word Problems'
  );
  const [intelligenceMeasure, setIntelligenceMeasure] = useState(68);
  const [correctProbability, setCorrectProbability] = useState(0.55);
  const [examPriority, setExamPriority] = useState(8);
  const [quizStrength, setQuizStrength] = useState(80);
  const [estimatedSeconds, setEstimatedSeconds] = useState(45);

  // Canvas Drawing Pad & Image Attachment
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [penColor, setPenColor] = useState('#158EE3');
  const [isEraser, setIsEraser] = useState(false);
  const [hasCanvasStrokes, setHasCanvasStrokes] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string>('');

  // Paper Builder State
  const [paperTitle, setPaperTitle] = useState('');
  const [paperTitleSi, setPaperTitleSi] = useState('');
  const [paperDesc, setPaperDesc] = useState('');
  const [paperDuration, setPaperDuration] = useState(15);
  const [selectedQuizIds, setSelectedQuizIds] = useState<string[]>([]);
  const [previewQuality, setPreviewQuality] = useState<PaperQualitySummary | null>(null);

  // Admin Platform Analytics State
  const [platformStats, setPlatformStats] = useState<{
    totalStudents: number;
    activePaidStudents: number;
    totalQuizCapacity: number;
    curatedQuizzesCount: number;
    papersCount: number;
    totalAttempts: number;
    averagePlatformScore: number;
    totalRevenueLkr: number;
    students: (AuthUser & { attemptCount: number; trajectory: StudentTrajectory })[];
  } | null>(null);

  // Teachers & Students Management
  const [teachers, setTeachers] = useState<
    (AuthUser & {
      activeCaseCount: number;
      resolvedCaseCount: number;
      actionsTakenCount: number;
    })[]
  >([]);
  const [teacherSubjectDrafts, setTeacherSubjectDrafts] = useState<Record<string, string[]>>({});
  const [scopedStudents, setScopedStudents] = useState<AuthUser[]>([]);
  const [newTeacherName, setNewTeacherName] = useState('');
  const [newTeacherEmail, setNewTeacherEmail] = useState('');
  const [newTeacherCode, setNewTeacherCode] = useState('');
  const [newTeacherWa, setNewTeacherWa] = useState('+94 77 ');
  const [newTeacherPassword, setNewTeacherPassword] = useState('Teacher@2026');
  const [newTeacherSubjects, setNewTeacherSubjects] = useState<string[]>(['subj-math']);

  // Academic Config, Audit Logs & Notification Oversight
  const [academicConfig, setAcademicConfig] = useState<AcademicConfig | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [oversightNotifications, setOversightNotifications] = useState<NotificationRecord[]>([]);
  const [recoveryRequests, setRecoveryRequests] = useState<AdminRecoveryRequestRecord[]>([]);
  const [recoveryReviewNotes, setRecoveryReviewNotes] = useState<Record<string, string>>({});
  const [recoveryOverrideContact, setRecoveryOverrideContact] = useState<Record<string, string>>({});

  // Enhancement 05: Timetable Presets & Multi-Guardian Family Links
  const [papersSubTab, setPapersSubTab] = useState<'assessments' | 'presets'>('assessments');
  const [guardianLinks, setGuardianLinks] = useState<GuardianStudentLink[]>([]);
  const [guardianDirectory, setGuardianDirectory] = useState<
    { id: string; name: string; email: string; userIdCode: string }[]
  >([]);
  const [newLinkGuardianId, setNewLinkGuardianId] = useState('');
  const [newLinkStudentId, setNewLinkStudentId] = useState('');
  const [newLinkRelationship, setNewLinkRelationship] = useState('Mother');

  // Drill-down drawers
  const [inspectedQuestionId, setInspectedQuestionId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(initialCaseId || null);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialCaseId) {
      setSelectedCaseId(initialCaseId);
    }
  }, [initialCaseId]);

  const loadAdminData = async () => {
    try {
      const [hRes, qRes, pRes, aRes] = await Promise.all([
        subjects.length === 0 ? api.getHierarchy() : Promise.resolve(null),
        api.getAdminQuizzes({
          source: sourceFilter,
          subjectId: subjectExplorerFilter,
        }),
        api.getPapers(),
        api.getAdminAnalytics(),
      ]);
      if (hRes) {
        setSubjects(hRes.subjects);
        setTopics(hRes.topics);
        setSubtopics(hRes.subtopics);
      }
      setQuizzes(qRes.quizzes);
      setTotalVirtualPool(qRes.totalVirtualPool);
      setCuratedCount(qRes.curatedCount);
      setPapers(pRes.papers);
      setPlatformStats(aRes);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const loadPeopleData = async () => {
    try {
      const [tRes, sRes, recRes, glRes] = await Promise.all([
        api.getTeachers(),
        api.getScopedStudents(),
        api.getAdminRecoveryRequests().catch(() => ({ requests: [] as AdminRecoveryRequestRecord[] })),
        api.getGuardianLinks().catch(() => ({ links: [] as GuardianStudentLink[], guardians: [] })),
      ]);
      setTeachers(tRes.teachers);
      const drafts: Record<string, string[]> = {};
      for (const t of tRes.teachers) {
        drafts[t.id] = [...(t.assignedSubjectIds || [])];
      }
      setTeacherSubjectDrafts(drafts);
      setScopedStudents(sRes.students);
      setRecoveryRequests(recRes.requests);
      setGuardianLinks(glRes.links);
      if (glRes.guardians) {
        setGuardianDirectory(glRes.guardians);
        if (!newLinkGuardianId && glRes.guardians.length > 0) {
          setNewLinkGuardianId(glRes.guardians[0].id);
        }
      }
      if (!newLinkStudentId && sRes.students.length > 0) {
        setNewLinkStudentId(sRes.students[0].id);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleCreateGuardianLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLinkGuardianId || !newLinkStudentId) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await api.createGuardianLink({
        guardianUserId: newLinkGuardianId,
        studentUserId: newLinkStudentId,
        relationshipLabel: newLinkRelationship.trim() || 'Guardian',
        verified: true,
        consentGiven: true,
      });
      setStatusMsg('Verified guardian-student family link saved.');
      await loadPeopleData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleToggleGuardianLinkPermission = async (
    link: GuardianStudentLink,
    patch: Partial<GuardianStudentLink>
  ) => {
    setErrorMsg(null);
    try {
      await api.updateGuardianLinkPermissions(link.id, patch);
      await loadPeopleData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleReviewRecoveryRequest = async (
    requestId: string,
    decision: 'APPROVE' | 'REJECT'
  ) => {
    setErrorMsg(null);
    setStatusMsg(null);
    const notes = (recoveryReviewNotes[requestId] || '').trim();
    if (!notes) {
      setErrorMsg('Enter verification review notes before approving or rejecting a recovery request.');
      return;
    }
    try {
      await api.reviewAdminRecoveryRequest(requestId, {
        decision,
        notes,
        newContactOverride: (recoveryOverrideContact[requestId] || '').trim() || undefined,
      });
      setStatusMsg(`Recovery request ${requestId} ${decision === 'APPROVE' ? 'approved & executed' : 'rejected'}.`);
      await loadPeopleData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const loadSettingsData = async () => {
    try {
      const [cfgRes, logRes] = await Promise.all([
        api.getAcademicConfig(),
        api.getAuditLogs(40),
      ]);
      setAcademicConfig(cfgRes.config);
      setAuditLogs(logRes.logs);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const loadOversightNotifications = async () => {
    try {
      const res = await api.getNotifications();
      setOversightNotifications(res.notifications);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadAdminData();
  }, [sourceFilter, subjectExplorerFilter]);

  useEffect(() => {
    if (currentSection === 'people') loadPeopleData();
    if (currentSection === 'settings') loadSettingsData();
    if (currentSection === 'interventions') loadOversightNotifications();
  }, [currentSection]);

  // Initialize blank white canvas pad when switching to curriculum tab
  useEffect(() => {
    if (currentSection !== 'curriculum') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [currentSection]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handleCanvasDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasCanvasStrokes(true);
  };

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasCoords(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = isEraser ? '#FFFFFF' : penColor;
    ctx.lineWidth = isEraser ? 16 : 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const handleCanvasUp = () => {
    setIsDrawing(false);
  };

  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasCanvasStrokes(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setUploadedImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubjectSelectForCreate = (nextSubjId: string) => {
    setCreateSubjectId(nextSubjId);
    const subj = subjects.find((s) => s.id === nextSubjId);
    if (subj) {
      setCognitiveDomain(subj.cognitiveDomain);
    }
    const firstTopic = topics.find((t) => t.subjectId === nextSubjId);
    if (firstTopic) {
      setCreateTopicId(firstTopic.id);
      const firstSubtopic = subtopics.find((st) => st.topicId === firstTopic.id);
      setCreateSubtopicId(firstSubtopic?.id || '');
    } else {
      setCreateTopicId('');
      setCreateSubtopicId('');
    }
  };

  const handleTopicSelectForCreate = (nextTopicId: string) => {
    setCreateTopicId(nextTopicId);
    const firstSubtopic = subtopics.find((st) => st.topicId === nextTopicId);
    setCreateSubtopicId(firstSubtopic?.id || '');
  };

  const handleCreateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    let finalImageUrl = uploadedImageUrl;
    if (!finalImageUrl && hasCanvasStrokes && canvasRef.current) {
      finalImageUrl = canvasRef.current.toDataURL('image/png');
    }

    try {
      const res = await api.createQuiz({
        subjectId: createSubjectId,
        topicId: createTopicId,
        subtopicId: createSubtopicId,
        questionSi,
        questionEn,
        options: [optA, optB, optC, optD],
        correctIndex,
        imageUrl: finalImageUrl || undefined,
        memoryTrickTitle,
        memoryTrickBody,
        explanation,
        attributes: {
          cognitiveDomain,
          intelligenceMeasure,
          correctProbability,
          examPriority,
          quizStrength,
          estimatedSeconds,
        },
      });
      setStatusMsg(
        `Saved quiz ${res.quiz.id} (${res.quiz.attributes.difficultyTier}) to SQLite curriculum bank!`
      );
      setQuestionSi('');
      setQuestionEn('');
      setOptA('');
      setOptB('');
      setOptC('');
      setOptD('');
      setMemoryTrickTitle('');
      setMemoryTrickBody('');
      setExplanation('');
      setUploadedImageUrl('');
      handleClearCanvas();
      await loadAdminData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleReassignSubject = async (questionId: string, newSubjectId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const firstTopic = topics.find((t) => t.subjectId === newSubjectId);
      const firstSubtopic = firstTopic
        ? subtopics.find((st) => st.topicId === firstTopic.id)
        : undefined;
      await api.reassignQuestionSubject(questionId, {
        subjectId: newSubjectId,
        topicId: firstTopic?.id,
        subtopicId: firstSubtopic?.id,
        changeNote: 'Reassigned subject category from Admin Curriculum Studio',
      });
      setStatusMsg(
        `Moved ${questionId} to ${subjects.find((s) => s.id === newSubjectId)?.nameEn || newSubjectId}. Teacher access visibility updated immediately while preserving historical attempts.`
      );
      await loadAdminData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const toggleQuizSelection = async (quizId: string) => {
    const next = selectedQuizIds.includes(quizId)
      ? selectedQuizIds.filter((id) => id !== quizId)
      : [...selectedQuizIds, quizId];
    setSelectedQuizIds(next);
    if (next.length > 0) {
      try {
        const res = await api.previewPaperQuality(next);
        setPreviewQuality(res.qualitySummary);
      } catch {
        // ignore
      }
    } else {
      setPreviewQuality(null);
    }
  };

  const handlePublishPaper = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.createPaper({
        title: paperTitle,
        titleSi: paperTitleSi || paperTitle,
        description: paperDesc,
        durationMinutes: paperDuration,
        quizIds: selectedQuizIds,
      });
      setStatusMsg(
        `Published ${res.paper.title} · Quality ${res.paper.qualitySummary.qualityIndex}/100 · Category: ${res.paper.qualitySummary.categoryLevel}`
      );
      setPaperTitle('');
      setPaperTitleSi('');
      setPaperDesc('');
      setSelectedQuizIds([]);
      setPreviewQuality(null);
      await loadAdminData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.createTeacher({
        name: newTeacherName,
        email: newTeacherEmail,
        userIdCode: newTeacherCode || undefined,
        whatsappNumber: newTeacherWa,
        password: newTeacherPassword,
        subjectIds: newTeacherSubjects,
      });
      setStatusMsg(
        `Created teacher account ${res.teacher.name} (${res.teacher.userIdCode}) with ${
          res.teacher.assignedSubjectIds?.length || 0
        } assigned subject(s).`
      );
      setNewTeacherName('');
      setNewTeacherEmail('');
      setNewTeacherCode('');
      await loadPeopleData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleToggleTeacherSubjectDraft = (teacherId: string, subjId: string) => {
    setTeacherSubjectDrafts((prev) => {
      const current = prev[teacherId] || [];
      const exists = current.includes(subjId);
      return {
        ...prev,
        [teacherId]: exists ? current.filter((id) => id !== subjId) : [...current, subjId],
      };
    });
  };

  const handleSaveTeacherSubjects = async (teacherId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const subjectIds = teacherSubjectDrafts[teacherId] || [];
      const res = await api.setTeacherSubjects(teacherId, subjectIds);
      setStatusMsg(
        `Updated subject permissions for ${res.teacher.name}: ${
          subjectIds.length === 0 ? 'All subjects revoked' : `${subjectIds.length} subject(s) active`
        }.`
      );
      await loadPeopleData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleToggleTeacherActive = async (teacher: AuthUser) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.updateTeacherStatus(teacher.id, teacher.active === false);
      setStatusMsg(
        `${res.teacher.name} is now ${res.teacher.active === false ? 'Inactive' : 'Active'}.`
      );
      await loadPeopleData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleToggleGuardianField = async (
    student: AuthUser,
    patch: { guardianContactVerified?: boolean; guardianConsentGiven?: boolean }
  ) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.updateStudentGuardian(student.id, patch);
      setStatusMsg(`Updated guardian consent/verification status for ${res.user.name}.`);
      await loadPeopleData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!academicConfig) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.updateAcademicConfig(academicConfig);
      setAcademicConfig(res.config);
      setStatusMsg('Academic thresholds, cooldown windows, and intervention rules saved.');
      await loadSettingsData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleRecalculate = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.recalculateAnalytics();
      setStatusMsg(
        `Recalculated analytics aggregates from authoritative attempts (${res.questionStatsUpdated} question summaries updated).`
      );
      await loadSettingsData();
      await loadAdminData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const liveDifficultyPreview = calculateQuizDifficultyScore({
    intelligenceMeasure,
    correctProbability,
    wrongProbability: Math.round((1 - correctProbability) * 100) / 100,
    examPriority,
    quizStrength,
    difficultyTier: 'Moderate',
    cognitiveDomain,
    estimatedSeconds,
  });

  const createTopicsList = topics.filter((t) => t.subjectId === createSubjectId);
  const createSubtopicsList = subtopics.filter((st) => st.topicId === createTopicId);

  return (
    <div className="space-y-6" data-testid="admin-studio">
      {/* Admin Header + Quick Section Switcher when standalone */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-extrabold text-[#0F2942]">
            Administrator Academic Governance &amp; Question Intelligence Studio
          </h1>
          <p className="text-xs text-[#526A84] mt-0.5 tabular-nums">
            Total Capacity: {(totalVirtualPool + curatedCount).toLocaleString()} Quizzes ({curatedCount} Curated DB + {totalVirtualPool.toLocaleString()} Parametric Pool) · {papers.length} Papers · {subjects.length} Subjects
          </p>
        </div>

        {!activeSection && (
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
            {(
              [
                { id: 'overview', label: 'Overview' },
                { id: 'curriculum', label: 'Curriculum & Questions' },
                { id: 'papers', label: 'Papers' },
                { id: 'people', label: 'Teachers & Students' },
                { id: 'interventions', label: 'Interventions' },
                { id: 'settings', label: 'Settings' },
              ] as { id: AdminSectionId; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSection(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                  currentSection === tab.id
                    ? 'bg-[#158EE3] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-sm text-[#9A2F09]">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] text-sm font-medium text-[#1E6323]">
          {statusMsg}
        </div>
      )}

      {/* SECTION 1: OVERVIEW */}
      {currentSection === 'overview' && (
        <div className="space-y-6">
          {platformStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-[#DCEBFA] p-5">
                <div className="text-xs text-[#526A84]">Paid Active Students</div>
                <div className="text-2xl font-display font-extrabold text-[#158EE3] tabular-nums mt-1">
                  {platformStats.activePaidStudents}/{platformStats.totalStudents}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-[#DCEBFA] p-5">
                <div className="text-xs text-[#526A84]">Total Revenue (LKR)</div>
                <div className="text-2xl font-display font-extrabold text-[#4CAF50] tabular-nums mt-1">
                  LKR {platformStats.totalRevenueLkr.toLocaleString('en-LK')}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-[#DCEBFA] p-5">
                <div className="text-xs text-[#526A84]">Platform Avg Round Score</div>
                <div className="text-2xl font-display font-extrabold text-[#F96A1B] tabular-nums mt-1">
                  {platformStats.averagePlatformScore}%
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-[#DCEBFA] p-5">
                <div className="text-xs text-[#526A84]">Round &amp; Exam Sessions</div>
                <div className="text-2xl font-display font-extrabold text-[#0F2942] tabular-nums mt-1">
                  {platformStats.totalAttempts}
                </div>
              </div>
            </div>
          )}

          <ScopedAnalyticsView
            role="admin"
            subjects={subjects}
            topics={topics}
            subtopics={subtopics}
            onInspectQuestion={(qId) => setInspectedQuestionId(qId)}
            onOpenInterventions={() => setSection('interventions')}
          />

          {platformStats && (
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6">
              <h2 className="text-base font-display font-bold text-[#0F2942] mb-4">
                Student Level Progression &amp; Scholarship Readiness
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#E5F0FA] text-xs text-[#526A84]">
                      <th className="py-2.5 pr-4 font-semibold">Student</th>
                      <th className="py-2.5 px-3 font-semibold">User ID</th>
                      <th className="py-2.5 px-3 font-semibold">Current Level</th>
                      <th className="py-2.5 px-3 font-semibold">Recommended Next</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Readiness</th>
                      <th className="py-2.5 pl-3 font-semibold text-right">Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F6FD]">
                    {platformStats.students.map((st) => (
                      <tr key={st.id}>
                        <td className="py-3 pr-4 font-semibold text-[#0F2942]">{st.name}</td>
                        <td className="py-3 px-3 font-mono text-xs text-[#526A84]">
                          {st.userIdCode}
                        </td>
                        <td className="py-3 px-3 text-xs text-[#0F2942]">{st.currentLevel}</td>
                        <td className="py-3 px-3 text-xs font-semibold text-[#158EE3]">
                          {st.trajectory.recommendedNextLevel}
                        </td>
                        <td className="py-3 px-3 text-right font-bold tabular-nums text-[#2E7D32]">
                          {st.trajectory.scholarshipReadinessPercent}%
                        </td>
                        <td className="py-3 pl-3 text-right font-bold tabular-nums text-[#F96A1B]">
                          {st.trajectory.improvementDeltaPercent >= 0 ? '+' : ''}
                          {st.trajectory.improvementDeltaPercent}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: CURRICULUM & QUESTIONS */}
      {currentSection === 'curriculum' && (
        <QuestionBankManager
          role="admin"
          user={effectiveAdminUser}
          subjects={subjects}
          topics={topics}
          subtopics={subtopics}
          onInspectQuestion={(qId) => setInspectedQuestionId(qId)}
          onQuestionsChanged={() => loadAdminData()}
        />
      )}

      {/* SECTION 3: EXAMINATION PAPERS, PRACTICE BUILDER & TIMETABLE PRESETS */}
      {currentSection === 'papers' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-[#DCEBFA] p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-[#526A84] px-2">
              Build cross-subject assessments, mock exams, or manage approved timetable presets for parents
            </div>
            <div className="flex items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
              <button
                type="button"
                onClick={() => setPapersSubTab('assessments')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 ${
                  papersSubTab === 'assessments'
                    ? 'bg-[#158EE3] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                Papers &amp; Assessments
              </button>
              <button
                type="button"
                data-testid="admin-tab-presets"
                onClick={() => setPapersSubTab('presets')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 ${
                  papersSubTab === 'presets'
                    ? 'bg-[#2E7D32] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                Timetable Presets Library
              </button>
            </div>
          </div>

          {papersSubTab === 'presets' ? (
            <TimetablePresetManager
              role="admin"
              user={effectiveAdminUser}
              subjects={subjects}
              topics={topics}
            />
          ) : (
            <>
              <AssessmentBuilderWorkspace
                role="admin"
                user={effectiveAdminUser}
                subjects={subjects}
                topics={topics}
                onAssessmentChanged={() => loadAdminData()}
              />

              {papers.length > 0 && (
                <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E5F0FA]">
                    <div className="text-sm font-display font-bold text-[#0F2942] flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[#158EE3]" />
                      <span>Standardized Timed Exam Papers Directory ({papers.length})</span>
                    </div>
                    <span className="text-xs text-[#526A84]">
                      Legacy &amp; calibrated Grade 5 timed papers
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {papers.map((p) => (
                      <div
                        key={p.id}
                        className="text-xs p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-[#0F2942] truncate">{p.title}</div>
                          <div className="text-[#526A84] truncate">{p.qualitySummary.categoryLevel}</div>
                        </div>
                        <span className="text-[#158EE3] font-bold shrink-0 tabular-nums">
                          {p.quizIds.length} Qs · {p.durationMinutes}m · Q:{p.qualitySummary.qualityIndex}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* SECTION 4: TEACHERS & STUDENTS (RBAC MATRIX + GUARDIAN CONSENT) */}
      {currentSection === 'people' && (
        <div className="space-y-6" data-testid="admin-people-section">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Create Teacher Form */}
            <form
              onSubmit={handleCreateTeacher}
              className="xl:col-span-4 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4"
            >
              <div className="flex items-center gap-2 pb-3 border-b border-[#E5F0FA]">
                <UserPlus className="w-4 h-4 text-[#158EE3]" />
                <h2 className="text-base font-display font-bold text-[#0F2942]">
                  Add Teacher Account
                </h2>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label htmlFor="t-name" className="block font-semibold text-[#476481] mb-1">
                    Full Name
                  </label>
                  <input
                    id="t-name"
                    type="text"
                    required
                    value={newTeacherName}
                    onChange={(e) => setNewTeacherName(e.target.value)}
                    placeholder="e.g. Mr. Ruwan Perera"
                    className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="t-email" className="block font-semibold text-[#476481] mb-1">
                    Teacher Email
                  </label>
                  <input
                    id="t-email"
                    type="email"
                    required
                    value={newTeacherEmail}
                    onChange={(e) => setNewTeacherEmail(e.target.value)}
                    placeholder="teacher.name@man5he.lk"
                    className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="t-code" className="block font-semibold text-[#476481] mb-1">
                      Teacher ID Code
                    </label>
                    <input
                      id="t-code"
                      type="text"
                      value={newTeacherCode}
                      onChange={(e) => setNewTeacherCode(e.target.value)}
                      placeholder="M5-TCH-03"
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="t-pw" className="block font-semibold text-[#476481] mb-1">
                      Initial Password
                    </label>
                    <input
                      id="t-pw"
                      type="text"
                      required
                      minLength={6}
                      value={newTeacherPassword}
                      onChange={(e) => setNewTeacherPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="t-wa" className="block font-semibold text-[#476481] mb-1">
                    WhatsApp Contact
                  </label>
                  <input
                    id="t-wa"
                    type="text"
                    value={newTeacherWa}
                    onChange={(e) => setNewTeacherWa(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
                  />
                </div>
                <div>
                  <div className="font-semibold text-[#476481] mb-1.5">
                    Initial Subject Assignments
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto p-2.5 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                    {subjects.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newTeacherSubjects.includes(s.id)}
                          onChange={() =>
                            setNewTeacherSubjects((prev) =>
                              prev.includes(s.id)
                                ? prev.filter((id) => id !== s.id)
                                : [...prev, s.id]
                            )
                          }
                          className="accent-[#158EE3]"
                        />
                        <span className="text-xs text-[#0F2942]">{s.nameEn}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
              >
                Create Teacher &amp; Grant Subject Access
              </button>
            </form>

            {/* Teacher Subject Permission Matrix */}
            <div className="xl:col-span-8 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
                <div>
                  <h2 className="text-base font-display font-bold text-[#0F2942]">
                    Teacher Accounts &amp; Subject Category Permissions
                  </h2>
                  <p className="text-xs text-[#526A84]">
                    Adding or removing a subject takes effect immediately across teacher dashboards and API queries.
                  </p>
                </div>
                <Users className="w-5 h-5 text-[#158EE3]" />
              </div>

              <div className="space-y-4">
                {teachers.map((t) => {
                  const draft = teacherSubjectDrafts[t.id] || [];
                  const isActive = t.active !== false;
                  return (
                    <div
                      key={t.id}
                      data-testid={`teacher-card-${t.userIdCode}`}
                      className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[#0F2942]">{t.name}</span>
                            <span className="text-xs font-mono text-[#158EE3]">{t.userIdCode}</span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                                isActive
                                  ? 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                                  : 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                              }`}
                            >
                              {isActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </div>
                          <div className="text-xs text-[#526A84] mt-0.5 tabular-nums">
                            {t.email} · {t.activeCaseCount} Active Cases · {t.resolvedCaseCount} Resolved · {t.actionsTakenCount} Actions
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleTeacherActive(t)}
                            className="px-3 py-1.5 text-xs font-semibold text-[#526A84] bg-white border border-[#CBE2FA] rounded-xl hover:text-[#0F2942]"
                          >
                            {isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveTeacherSubjects(t.id)}
                            className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
                          >
                            Save Permissions
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                        {subjects.map((s) => {
                          const checked = draft.includes(s.id);
                          return (
                            <label
                              key={s.id}
                              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                                checked
                                  ? 'bg-[#EBF5FF] border-[#99CAFA] text-[#0E4F80] font-semibold'
                                  : 'bg-white border-[#DCEBFA] text-[#526A84]'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleTeacherSubjectDraft(t.id, s.id)}
                                className="accent-[#158EE3]"
                              />
                              <span className="truncate">{s.nameEn}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Students & Guardian Consent Governance Table */}
          <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
            <div>
              <h2 className="text-base font-display font-bold text-[#0F2942]">
                Student Accounts &amp; Guardian Contact Verification / Consent
              </h2>
              <p className="text-xs text-[#526A84]">
                External Email and WhatsApp reports are withheld (`skipped_unverified`) whenever verification or guardian consent is false.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#E5F0FA] text-xs text-[#526A84]">
                    <th className="py-2.5 pr-4 font-semibold">Student</th>
                    <th className="py-2.5 px-3 font-semibold">Guardian &amp; WhatsApp</th>
                    <th className="py-2.5 px-3 font-semibold">Level / Plan</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Contact Verified</th>
                    <th className="py-2.5 pl-3 font-semibold text-center">Guardian Consent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F6FD]">
                  {scopedStudents.map((st) => (
                    <tr key={st.id}>
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-[#0F2942]">{st.name}</div>
                        <div className="text-[11px] font-mono text-[#526A84]">
                          {st.userIdCode} · {st.email}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-[#476481]">
                        <div>{st.guardianName || 'Guardian'}</div>
                        <div className="text-[11px] text-[#526A84]">{st.whatsappNumber}</div>
                      </td>
                      <td className="py-3 px-3 text-xs text-[#0F2942]">
                        <div>{st.currentLevel}</div>
                        <div className="text-[11px] text-[#2E7D32] font-semibold capitalize">
                          {st.subscriptionStatus}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleGuardianField(st, {
                              guardianContactVerified: !st.guardianContactVerified,
                            })
                          }
                          className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                            st.guardianContactVerified
                              ? 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                              : 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                          }`}
                        >
                          {st.guardianContactVerified ? 'Verified' : 'Unverified'}
                        </button>
                      </td>
                      <td className="py-3 pl-3 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleGuardianField(st, {
                              guardianConsentGiven: !st.guardianConsentGiven,
                            })
                          }
                          className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                            st.guardianConsentGiven
                              ? 'bg-[#EBF5FF] border-[#99CAFA] text-[#0E4F80]'
                              : 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                          }`}
                        >
                          {st.guardianConsentGiven ? 'Consent Active' : 'Withheld'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Verified Guardian-Student Family Links (Many-to-Many) */}
          <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
              <div>
                <h2 className="text-base font-display font-bold text-[#0F2942]">
                  Verified Guardian-Student Family Links ({guardianLinks.length})
                </h2>
                <p className="text-xs text-[#526A84]">
                  Authorize multiple guardians per student or one guardian managing multiple children with granular report &amp; schedule permissions.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleCreateGuardianLink}
              className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3.5 rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA] text-xs items-end"
            >
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Guardian</label>
                <select
                  value={newLinkGuardianId}
                  onChange={(e) => setNewLinkGuardianId(e.target.value)}
                  className="w-full px-2.5 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                >
                  {guardianDirectory.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.userIdCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Student</label>
                <select
                  value={newLinkStudentId}
                  onChange={(e) => setNewLinkStudentId(e.target.value)}
                  className="w-full px-2.5 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                >
                  {scopedStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.userIdCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Relationship</label>
                <input
                  type="text"
                  value={newLinkRelationship}
                  onChange={(e) => setNewLinkRelationship(e.target.value)}
                  placeholder="Mother / Father / Guardian"
                  className="w-full px-2.5 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                />
              </div>
              <button
                type="submit"
                className="py-2 px-4 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
              >
                Link Guardian &amp; Student
              </button>
            </form>

            {guardianLinks.length > 0 && (
              <div className="space-y-2 text-xs">
                {guardianLinks.map((lk) => (
                  <div
                    key={lk.id}
                    className="p-3 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <span className="font-bold text-[#0F2942]">{lk.guardianName}</span>{' '}
                      <span className="text-[#526A84]">({lk.relationshipLabel}) →</span>{' '}
                      <span className="font-bold text-[#158EE3]">{lk.studentName}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { field: 'verified', label: 'Verified' },
                          { field: 'consentGiven', label: 'Consent' },
                          { field: 'canViewReports', label: 'Reports' },
                          { field: 'canManageSchedule', label: 'Schedule' },
                          { field: 'studentCanEditSchedule', label: 'Child Edit' },
                        ] as const
                      ).map((flag) => {
                        const active = Boolean(lk[flag.field]);
                        return (
                          <button
                            key={flag.field}
                            type="button"
                            onClick={() =>
                              handleToggleGuardianLinkPermission(lk, { [flag.field]: !active })
                            }
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                              active
                                ? 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                                : 'bg-white border-[#DCEBFA] text-[#526A84]'
                            }`}
                          >
                            {flag.label}: {active ? 'ON' : 'OFF'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Account Recovery & Identity Verification Queue */}
          <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
              <div>
                <h2 className="text-base font-display font-bold text-[#0F2942]">
                  Auditable Identity &amp; Authenticator Recovery Queue ({recoveryRequests.length})
                </h2>
                <p className="text-xs text-[#526A84]">
                  Review lost-authenticator and lost-contact escalations with mandatory verification notes. Administrator accounts remain isolated from non-admin self-service recovery.
                </p>
              </div>
              <button
                type="button"
                onClick={loadPeopleData}
                className="px-3 py-1.5 text-xs font-semibold text-[#158EE3] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh Queue
              </button>
            </div>

            {recoveryRequests.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#526A84]">
                No pending or historical recovery escalations.
              </div>
            ) : (
              <div className="space-y-3">
                {recoveryRequests.map((rq) => (
                  <div
                    key={rq.id}
                    className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-[#0F2942]">
                          {rq.targetUserName || rq.requesterIdentifier}
                        </span>{' '}
                        <span className="font-mono text-[#158EE3]">
                          ({rq.requestType.replace(/_/g, ' ').toUpperCase()})
                        </span>
                      </div>
                      <span
                        className={`font-bold px-2.5 py-0.5 rounded-md border text-[11px] ${
                          rq.status === 'PENDING_APPROVAL'
                            ? 'bg-[#FFF8EB] border-[#F3D19C] text-[#9A5B00]'
                            : rq.status === 'COMPLETED'
                            ? 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                            : 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                        }`}
                      >
                        {rq.status}
                      </span>
                    </div>
                    <div className="text-[#476481]">
                      {rq.verificationNotes} · Submitted {new Date(rq.createdAt).toLocaleString()}
                    </div>
                    {rq.status === 'PENDING_APPROVAL' && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={recoveryReviewNotes[rq.id] || ''}
                          onChange={(e) =>
                            setRecoveryReviewNotes((p) => ({ ...p, [rq.id]: e.target.value }))
                          }
                          placeholder="Verification evidence & review notes (required)"
                          className="flex-1 min-w-[200px] px-3 py-1.5 bg-white border border-[#CBE2FA] rounded-xl text-xs"
                        />
                        {rq.requestType === 'contact_recovery' && (
                          <input
                            type="text"
                            value={recoveryOverrideContact[rq.id] || ''}
                            onChange={(e) =>
                              setRecoveryOverrideContact((p) => ({ ...p, [rq.id]: e.target.value }))
                            }
                            placeholder="Verified contact override (optional)"
                            className="px-3 py-1.5 bg-white border border-[#CBE2FA] rounded-xl text-xs"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => handleReviewRecoveryRequest(rq.id, 'APPROVE')}
                          className="px-3.5 py-1.5 font-bold text-white bg-[#2E7D32] rounded-xl hover:bg-[#236127]"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewRecoveryRequest(rq.id, 'REJECT')}
                          className="px-3.5 py-1.5 font-bold text-[#9A2F09] bg-[#FFF2ED] border border-[#FAC5B2] rounded-xl"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 5: INTERVENTIONS & ALERT OVERSIGHT */}
      {currentSection === 'interventions' && (
        <div className="space-y-6">
          <InterventionWorkspace
            subjects={subjects}
            topics={topics}
            initialCaseId={selectedCaseId}
            onInspectQuestion={(qId) => setInspectedQuestionId(qId)}
          />

          <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
              <div>
                <h2 className="text-base font-display font-bold text-[#0F2942]">
                  Notification Delivery Oversight &amp; Retry Queue
                </h2>
                <p className="text-xs text-[#526A84]">
                  Tracks in-app alerts, Email, and WhatsApp guardian notifications including withheld consent &amp; retries
                </p>
              </div>
              <button
                type="button"
                onClick={loadOversightNotifications}
                className="px-3 py-1.5 text-xs font-semibold text-[#158EE3] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>

            {oversightNotifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#526A84]">
                No notifications logged yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {oversightNotifications.slice(0, 20).map((n) => (
                  <div
                    key={n.id}
                    className="p-3 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-[#0F2942]">{n.title}</span>
                        <span className="px-2 py-0.5 rounded bg-white border border-[#CBE2FA] text-[10px] font-mono uppercase">
                          {n.channel}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${
                            n.deliveryStatus === 'delivered'
                              ? 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                              : 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                          }`}
                        >
                          {n.deliveryStatus}
                        </span>
                      </div>
                      <div className="text-[#526A84] mt-0.5 truncate">{n.body}</div>
                    </div>
                    {(n.deliveryStatus === 'failed' || n.deliveryStatus === 'skipped_unverified') && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.retryNotification(n.id);
                          loadOversightNotifications();
                        }}
                        className="px-3 py-1.5 text-xs font-bold text-[#158EE3] bg-white border border-[#CBE2FA] rounded-xl hover:bg-[#EBF5FF]"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 6: SETTINGS, THRESHOLDS, RECALCULATION & AUDIT LOGS */}
      {currentSection === 'settings' && (
        <div className="space-y-6" data-testid="admin-settings-section">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <form
              onSubmit={handleSaveConfig}
              className="xl:col-span-6 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4"
            >
              <div className="flex items-center gap-2 pb-3 border-b border-[#E5F0FA]">
                <Sliders className="w-4 h-4 text-[#158EE3]" />
                <h2 className="text-base font-display font-bold text-[#0F2942]">
                  Academic Thresholds &amp; Intervention Rules
                </h2>
              </div>

              {academicConfig && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="cfg-thresh" className="block font-semibold text-[#476481] mb-1">
                        Repeated Error Threshold (Default 3)
                      </label>
                      <input
                        id="cfg-thresh"
                        type="number"
                        min={2}
                        max={10}
                        value={academicConfig.repeatedErrorThreshold}
                        onChange={(e) =>
                          setAcademicConfig({
                            ...academicConfig,
                            repeatedErrorThreshold: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm font-bold tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="cfg-sustained" className="block font-semibold text-[#476481] mb-1">
                        Sustained Correct Needed to Flag Review
                      </label>
                      <input
                        id="cfg-sustained"
                        type="number"
                        min={1}
                        max={10}
                        value={academicConfig.sustainedCorrectRequiredForReview}
                        onChange={(e) =>
                          setAcademicConfig({
                            ...academicConfig,
                            sustainedCorrectRequiredForReview: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm font-bold tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="cfg-cooldown" className="block font-semibold text-[#476481] mb-1">
                        Alert Cooldown Window (Minutes)
                      </label>
                      <input
                        id="cfg-cooldown"
                        type="number"
                        min={1}
                        max={240}
                        value={academicConfig.notificationCooldownMinutes}
                        onChange={(e) =>
                          setAcademicConfig({
                            ...academicConfig,
                            notificationCooldownMinutes: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm font-bold tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="cfg-group" className="block font-semibold text-[#476481] mb-1">
                        Alert Grouping Window (Minutes)
                      </label>
                      <input
                        id="cfg-group"
                        type="number"
                        min={1}
                        max={120}
                        value={academicConfig.alertGroupingWindowMinutes}
                        onChange={(e) =>
                          setAcademicConfig({
                            ...academicConfig,
                            alertGroupingWindowMinutes: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm font-bold tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={academicConfig.requireTeacherReviewBeforeClose}
                        onChange={(e) =>
                          setAcademicConfig({
                            ...academicConfig,
                            requireTeacherReviewBeforeClose: e.target.checked,
                          })
                        }
                        className="accent-[#158EE3]"
                      />
                      <span className="font-medium text-[#0F2942]">
                        Require explicit teacher/admin confirmation before resolving monitoring cases
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={academicConfig.autoNotifyAdminsOnEscalation}
                        onChange={(e) =>
                          setAcademicConfig({
                            ...academicConfig,
                            autoNotifyAdminsOnEscalation: e.target.checked,
                          })
                        }
                        className="accent-[#158EE3]"
                      />
                      <span className="font-medium text-[#0F2942]">
                        Copy administrators on repeated-error escalation alerts
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center justify-center gap-2"
                  >
                    <Settings className="w-4 h-4" />
                    <span>Save Academic Governance Rules</span>
                  </button>
                </div>
              )}
            </form>

            {/* Recalculation & System Links */}
            <div className="xl:col-span-6 space-y-6">
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-[#E5F0FA]">
                  <RefreshCw className="w-4 h-4 text-[#4CAF50]" />
                  <h2 className="text-base font-display font-bold text-[#0F2942]">
                    Analytics Integrity &amp; Platform Tools
                  </h2>
                </div>
                <p className="text-xs text-[#526A84] leading-relaxed">
                  Recomputes every question&apos;s performance summary (valid attempts, first vs. repeat accuracy, median response pace, repeated-error student counts) directly from immutable SQLite attempt records.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleRecalculate}
                    className="px-4 py-2.5 text-xs font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Recalculate Analytics Aggregates</span>
                  </button>
                  {onOpenBilling && (
                    <button
                      type="button"
                      onClick={onOpenBilling}
                      className="px-4 py-2.5 text-xs font-semibold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl hover:bg-[#E5F2FF] flex items-center gap-1.5"
                    >
                      <CreditCard className="w-3.5 h-3.5 text-[#158EE3]" />
                      <span>Plans &amp; Billing</span>
                    </button>
                  )}
                  {onOpenDocs && (
                    <button
                      type="button"
                      onClick={onOpenDocs}
                      className="px-4 py-2.5 text-xs font-semibold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl hover:bg-[#E5F2FF] flex items-center gap-1.5"
                    >
                      <Shield className="w-3.5 h-3.5 text-[#158EE3]" />
                      <span>Architecture &amp; Docs</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Recent Audit Logs */}
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-[#E5F0FA]">
                  <History className="w-4 h-4 text-[#158EE3]" />
                  <h2 className="text-base font-display font-bold text-[#0F2942]">
                    Recent Academic &amp; Security Audit Logs
                  </h2>
                </div>
                {auditLogs.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#526A84]">
                    No audit entries recorded yet.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-2.5 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] text-xs flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-[#0F2942]">
                            {log.action} · <span className="font-mono text-[#158EE3]">{log.targetId}</span>
                          </div>
                          <div className="text-[11px] text-[#526A84]">
                            {log.actorName} ({log.actorRole}) · {log.detailsJson}
                          </div>
                        </div>
                        <span className="text-[10px] text-[#64748B] shrink-0 tabular-nums">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 6: KNOWLEDGE DISCOVERY & PUBLISHING */}
      {currentSection === 'knowledge' && (
        <KnowledgePublishingConsole
          role="admin"
          subjects={subjects}
          topics={topics}
          subtopics={subtopics}
        />
      )}

      <QuestionReviewDrawer
        questionId={inspectedQuestionId}
        onClose={() => setInspectedQuestionId(null)}
        onOpenCase={(cId) => {
          setInspectedQuestionId(null);
          setSelectedCaseId(cId);
          onClearInitialCase?.();
          setSection('interventions');
        }}
      />
    </div>
  );
}
