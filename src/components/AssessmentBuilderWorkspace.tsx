import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  Edit3,
  Plus,
  Printer,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  AssessmentAttemptReviewItem,
  AuthUser,
} from '../lib/api';
import type {
  AssessmentAttemptRecord,
  AssessmentKind,
  AssessmentRecord,
  AssessmentSection,
  AssessmentSelectionMode,
  AssessmentStatus,
  DifficultyTier,
  ExplanationTiming,
  KnowledgePublication,
  QuestionType,
  QuizItem,
  SubjectCategory,
  TopicNode,
} from '../lib/types';

interface AssessmentBuilderWorkspaceProps {
  role: 'admin' | 'teacher';
  user: AuthUser;
  subjects: SubjectCategory[];
  topics: TopicNode[];
  onAssessmentChanged?: () => void;
}

interface DraftSection {
  id: string;
  title: string;
  instructions: string;
  items: { question: QuizItem; marks: number }[];
}

const STATUS_BADGE: Record<AssessmentStatus, string> = {
  DRAFT: 'bg-[#F3F6FA] border-[#CBD5E1] text-[#475569]',
  VALIDATED: 'bg-[#EBF5FF] border-[#99CAFA] text-[#0E4F80]',
  APPROVED: 'bg-[#EBF5FF] border-[#99CAFA] text-[#0E4F80]',
  SCHEDULED: 'bg-[#FFF7EB] border-[#F5D399] text-[#8A5300]',
  PUBLISHED: 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]',
  ACTIVE: 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]',
  CLOSED: 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]',
  RESULTS_RELEASED: 'bg-[#EBF5FF] border-[#99CAFA] text-[#158EE3]',
  ARCHIVED: 'bg-[#F8FAFC] border-[#CBD5E1] text-[#64748B]',
  CANCELLED: 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]',
  WITHDRAWN: 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]',
};

export function AssessmentBuilderWorkspace({
  role,
  subjects,
  topics,
  onAssessmentChanged,
}: AssessmentBuilderWorkspaceProps) {
  const [kindFilter, setKindFilter] = useState<'All' | AssessmentKind>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Authorized approved questions + students + publications for builder & follow-up
  const [bankQuestions, setBankQuestions] = useState<QuizItem[]>([]);
  const [students, setStudents] = useState<AuthUser[]>([]);
  const [publications, setPublications] = useState<KnowledgePublication[]>([]);

  // Builder Modal/Panel State
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingAssessmentId, setEditingAssessmentId] = useState<string | null>(null);
  const [kind, setKind] = useState<AssessmentKind>('mock_exam');
  const [title, setTitle] = useState('');
  const [titleSi, setTitleSi] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [grade, setGrade] = useState('Grade 5');
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(
    subjects[0] ? [subjects[0].id] : []
  );
  const [selectionMode, setSelectionMode] = useState<AssessmentSelectionMode>('manual');
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [showHints, setShowHints] = useState(true);
  const [explanationTiming, setExplanationTiming] = useState<ExplanationTiming>('after_submit');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(20);
  const [maxAttempts, setMaxAttempts] = useState<number>(1);
  const [passMarkPercent, setPassMarkPercent] = useState<number>(50);
  const [targetType, setTargetType] = useState<'grade' | 'student'>('grade');
  const [targetValue, setTargetValue] = useState<string>('Grade 5');
  const [linkedPubIds, setLinkedPubIds] = useState<string[]>([]);

  // Sections
  const [sections, setSections] = useState<DraftSection[]>([
    { id: 'sec-1', title: 'Part I · Core Questions', instructions: '', items: [] },
  ]);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);

  // Auto-Selector Generator Controls
  const [autoCount, setAutoCount] = useState(4);
  const [autoMode, setAutoMode] = useState<AssessmentSelectionMode>('deterministic');
  const [autoSimpleQuota, setAutoSimpleQuota] = useState(0);
  const [autoModQuota, setAutoModQuota] = useState(0);
  const [autoChalQuota, setAutoChalQuota] = useState(0);
  const [autoStudentId, setAutoStudentId] = useState('');
  const [excludePreviouslyCorrect, setExcludePreviouslyCorrect] = useState(false);
  const [includeVirtualPool, setIncludeVirtualPool] = useState(false);
  const [pickerSubjectFilter, setPickerSubjectFilter] = useState('All');

  // Operations Panels (Analytics + Manual Grading + Printable + Follow-up)
  const [analyticsData, setAnalyticsData] = useState<Awaited<
    ReturnType<typeof api.getAssessmentAnalytics>
  > | null>(null);
  const [gradingAttempt, setGradingAttempt] = useState<{
    attempt: AssessmentAttemptRecord;
    items: AssessmentAttemptReviewItem[];
  } | null>(null);
  const [gradeInputs, setGradeInputs] = useState<
    Record<string, { awardedMarks: number; comment: string }>
  >({});
  const [printableData, setPrintableData] = useState<Awaited<
    ReturnType<typeof api.exportAssessmentPrintable>
  > | null>(null);
  const [printWithKey, setPrintWithKey] = useState(false);

  // Follow-up Form inside Analytics
  const [followUpStudentIds, setFollowUpStudentIds] = useState<string[]>([]);
  const [followUpTitle, setFollowUpTitle] = useState('');
  const [followUpBody, setFollowUpBody] = useState('');
  const [followUpPubId, setFollowUpPubId] = useState('');

  const loadWorkspaceData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [asmRes, qActiveRes, qApprRes, stuRes, pubRes] = await Promise.all([
        api.getAssessments({ kind: kindFilter, status: statusFilter }),
        api.getAdminQuizzes({ source: 'curated', approvalStatus: 'ACTIVE', pageSize: 100 }),
        api.getAdminQuizzes({ source: 'curated', approvalStatus: 'APPROVED', pageSize: 100 }),
        api.getScopedStudents(),
        api.getKnowledgePublications({ status: 'PUBLISHED' }),
      ]);
      setAssessments(asmRes.assessments);
      const mergedMap = new Map<string, QuizItem>();
      for (const q of [...qActiveRes.quizzes, ...qApprRes.quizzes]) mergedMap.set(q.id, q);
      setBankQuestions(Array.from(mergedMap.values()));
      setStudents(stuRes.students);
      setPublications(pubRes.publications);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspaceData();
  }, [kindFilter, statusFilter, subjects.map((s) => s.id).join(',')]);

  const openNewBuilder = (initialKind: AssessmentKind) => {
    setEditingAssessmentId(null);
    setKind(initialKind);
    setTitle('');
    setTitleSi('');
    setDescription('');
    setInstructions('');
    setGrade('Grade 5');
    setSelectedSubjectIds(subjects[0] ? [subjects[0].id] : []);
    setSelectionMode('manual');
    setShuffleQuestions(false);
    setShuffleOptions(false);
    setShowHints(initialKind === 'practice_session');
    setExplanationTiming(initialKind === 'practice_session' ? 'immediate' : 'after_submit');
    setTimeLimitMinutes(initialKind === 'practice_session' ? 10 : 20);
    setMaxAttempts(initialKind === 'practice_session' ? 5 : 1);
    setPassMarkPercent(50);
    setTargetType('grade');
    setTargetValue('Grade 5');
    setLinkedPubIds([]);
    setSections([{ id: 'sec-1', title: 'Part I · Core Questions', instructions: '', items: [] }]);
    setActiveSectionIdx(0);
    setShowBuilder(true);
  };

  const openEditDraftBuilder = async (assessmentId: string) => {
    setErrorMsg(null);
    try {
      const detail = await api.getAssessmentDetail(assessmentId);
      const a = detail.assessment;
      setEditingAssessmentId(a.id);
      setKind(a.kind);
      setTitle(a.title);
      setTitleSi(a.titleSi);
      setDescription(a.description);
      setInstructions(a.instructions);
      setGrade(a.grade);
      setSelectedSubjectIds(a.subjectIds);
      setSelectionMode(a.selectionMode);
      setShuffleQuestions(a.shuffleQuestions);
      setShuffleOptions(a.shuffleOptions);
      setShowHints(a.showHints);
      setExplanationTiming(a.explanationTiming);
      setTimeLimitMinutes(a.timeLimitMinutes ?? 15);
      setMaxAttempts(a.maxAttempts);
      setPassMarkPercent(a.passMarkPercent);
      setLinkedPubIds(a.config?.linkedKnowledgePublicationIds || []);
      const firstAsn = a.assignments[0];
      if (firstAsn && (firstAsn.targetType === 'grade' || firstAsn.targetType === 'student')) {
        setTargetType(firstAsn.targetType);
        setTargetValue(firstAsn.targetValue);
      }
      setSections(
        a.sections.map((sec) => ({
          id: sec.id,
          title: sec.title,
          instructions: sec.instructions,
          items: detail.snapshots
            .filter((s) => s.sectionId === sec.id)
            .map((s) => ({ question: s.snapshot, marks: s.marks })),
        }))
      );
      setActiveSectionIdx(0);
      setShowBuilder(true);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const toggleQuestionInSection = (q: QuizItem) => {
    const alreadyInAny = sections.some((s) => s.items.some((i) => i.question.id === q.id));
    if (alreadyInAny) {
      setSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          items: sec.items.filter((i) => i.question.id !== q.id),
        }))
      );
      return;
    }
    setSections((prev) =>
      prev.map((sec, idx) =>
        idx === activeSectionIdx
          ? { ...sec, items: [...sec.items, { question: q, marks: q.defaultMarks || 2 }] }
          : sec
      )
    );
  };

  const handleAutoSelectPreview = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    const subjIds = selectedSubjectIds.length > 0 ? selectedSubjectIds : subjects.map((s) => s.id);
    const dist: Partial<Record<DifficultyTier, number>> = {};
    if (autoSimpleQuota > 0) dist.Simple = autoSimpleQuota;
    if (autoModQuota > 0) dist.Moderate = autoModQuota;
    if (autoChalQuota > 0) dist.Challenging = autoChalQuota;

    try {
      const res = await api.previewQuestionSelection({
        subjectIds: subjIds,
        grade,
        count: autoCount,
        mode: autoMode,
        difficultyDistribution: Object.keys(dist).length > 0 ? dist : undefined,
        includeVirtualPool,
        targetStudentId: autoStudentId || undefined,
        excludePreviouslyCorrect,
      });
      const existingIds = new Set(sections.flatMap((s) => s.items.map((i) => i.question.id)));
      const freshItems = res.selectedQuestions
        .filter((q) => !existingIds.has(q.id))
        .map((q) => ({ question: q, marks: q.defaultMarks || 2 }));

      setSections((prev) =>
        prev.map((sec, idx) =>
          idx === activeSectionIdx ? { ...sec, items: [...sec.items, ...freshItems] } : sec
        )
      );
      setSelectionMode(autoMode);
      setStatusMsg(
        `Added ${freshItems.length} non-duplicate question(s) via ${autoMode} selection (Pool available: ${res.metadata.availablePoolCount}).`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleSaveAssessment = async (publishImmediately: boolean) => {
    setErrorMsg(null);
    setStatusMsg(null);

    const payloadSections = sections
      .filter((s) => s.items.length > 0)
      .map((s) => ({
        title: s.title,
        instructions: s.instructions,
        items: s.items.map((i) => ({ questionId: i.question.id, marks: i.marks })),
      }));

    if (payloadSections.length === 0) {
      setErrorMsg('Please add at least 1 question to a section before saving.');
      return;
    }

    const subjIds =
      selectedSubjectIds.length > 0
        ? selectedSubjectIds
        : Array.from(
            new Set(
              sections
                .flatMap((s) => s.items.map((i) => i.question.subjectId))
                .filter((x): x is string => Boolean(x))
            )
          );

    try {
      let saved: AssessmentRecord;
      if (editingAssessmentId) {
        const res = await api.updateDraftAssessment(editingAssessmentId, {
          title,
          titleSi: titleSi || title,
          description,
          instructions,
          grade,
          subjectIds: subjIds,
          selectionMode,
          shuffleQuestions,
          shuffleOptions,
          showHints,
          explanationTiming,
          timeLimitMinutes: timeLimitMinutes > 0 ? timeLimitMinutes : null,
          maxAttempts,
          passMarkPercent,
          config: { linkedKnowledgePublicationIds: linkedPubIds },
          sections: payloadSections,
          assignments: [{ targetType, targetValue }],
        });
        saved = res.assessment;
        if (publishImmediately) {
          const pubRes = await api.transitionAssessmentStatus(saved.id, { toStatus: 'PUBLISHED' });
          saved = pubRes.assessment;
        }
      } else {
        const res = await api.createAssessment({
          kind,
          title,
          titleSi: titleSi || title,
          description,
          instructions,
          grade,
          subjectIds: subjIds,
          selectionMode,
          shuffleQuestions,
          shuffleOptions,
          showHints,
          explanationTiming,
          timeLimitMinutes: timeLimitMinutes > 0 ? timeLimitMinutes : null,
          maxAttempts,
          passMarkPercent,
          status: publishImmediately ? 'PUBLISHED' : 'DRAFT',
          config: { linkedKnowledgePublicationIds: linkedPubIds },
          sections: payloadSections,
          assignments: [{ targetType, targetValue }],
        });
        saved = res.assessment;
      }

      setStatusMsg(
        `Saved ${saved.kind === 'practice_session' ? 'Practice Session' : 'Mock Exam'} "${saved.title}" (${saved.status} · ${saved.questionCount} Qs · ${saved.totalMarks} marks).`
      );
      setShowBuilder(false);
      await loadWorkspaceData();
      onAssessmentChanged?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleTransition = async (id: string, toStatus: AssessmentStatus) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.transitionAssessmentStatus(id, { toStatus });
      setStatusMsg(`Assessment "${res.assessment.title}" moved to ${res.assessment.status}.`);
      await loadWorkspaceData();
      onAssessmentChanged?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleOpenAnalytics = async (assessmentId: string) => {
    setErrorMsg(null);
    setGradingAttempt(null);
    try {
      const res = await api.getAssessmentAnalytics(assessmentId);
      setAnalyticsData(res);
      setFollowUpStudentIds(res.attempts.map((a) => a.studentId));
      setFollowUpTitle(`Follow-up Practice Plan · ${res.assessment.title}`);
      setFollowUpBody(
        'Review the linked knowledge guide and revise the topics flagged in your assessment.'
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleOpenManualGrading = async (attempt: AssessmentAttemptRecord) => {
    setErrorMsg(null);
    try {
      const res = await api.getAttemptReview(attempt.id);
      setGradingAttempt({ attempt: res.attempt, items: res.items });
      const init: Record<string, { awardedMarks: number; comment: string }> = {};
      for (const it of res.items) {
        init[it.snapshotId] = {
          awardedMarks: it.awardedMarks,
          comment: it.graderComment || '',
        };
      }
      setGradeInputs(init);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleSubmitManualGrades = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gradingAttempt) return;
    setErrorMsg(null);
    try {
      const grades = gradingAttempt.items
        .filter((it) => it.markingStatus === 'pending_manual' || it.markingStatus === 'manually_graded')
        .map((it) => ({
          snapshotId: it.snapshotId,
          awardedMarks: gradeInputs[it.snapshotId]?.awardedMarks ?? 0,
          comment: gradeInputs[it.snapshotId]?.comment ?? '',
        }));
      await api.gradeManualAnswers(gradingAttempt.attempt.id, grades);
      setStatusMsg('Manual marks saved and student attempt score recalculated.');
      setGradingAttempt(null);
      if (analyticsData) {
        await handleOpenAnalytics(analyticsData.assessment.id);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleExportPrintable = async (assessmentId: string, includeKey: boolean) => {
    setErrorMsg(null);
    try {
      const res = await api.exportAssessmentPrintable(assessmentId, includeKey);
      setPrintWithKey(includeKey);
      setPrintableData(res);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleDownloadJsonExport = () => {
    if (!printableData) return;
    const blob = new Blob([JSON.stringify(printableData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${printableData.assessment.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleAssignFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!analyticsData) return;
    setErrorMsg(null);
    try {
      const res = await api.assignFollowUpFromAssessment(analyticsData.assessment.id, {
        studentIds: Array.from(new Set(followUpStudentIds)),
        title: followUpTitle,
        body: followUpBody,
        recommendedTopicId: analyticsData.topicPerformance[0]?.topicId || null,
        linkedPublicationId: followUpPubId || null,
      });
      setStatusMsg(`Sent follow-up study plan to ${res.assignedCount} student(s).`);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const visiblePickerQuestions = bankQuestions.filter((q) => {
    if (pickerSubjectFilter !== 'All' && q.subjectId !== pickerSubjectFilter) return false;
    if (selectedSubjectIds.length > 0 && q.subjectId && !selectedSubjectIds.includes(q.subjectId)) {
      return false;
    }
    return true;
  });

  const totalDraftQuestions = sections.reduce((acc, s) => acc + s.items.length, 0);
  const totalDraftMarks = sections.reduce(
    (acc, s) => acc + s.items.reduce((m, i) => m + i.marks, 0),
    0
  );

  return (
    <div className="space-y-5" data-testid="assessment-builder-workspace">
      {/* Top Toolbar */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-display font-bold text-[#0F2942]">
            Custom Practice Sessions &amp; Structured Mock Examination Builder
          </h2>
          <p className="text-xs text-[#526A84] mt-0.5">
            Build subject-scoped practice rounds or multi-section mock exams using approved questions
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter assessment kind"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as 'All' | AssessmentKind)}
            className="px-3 py-2 text-xs font-semibold bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-[#0F2942]"
          >
            <option value="All">All Types</option>
            <option value="practice_session">Practice Sessions</option>
            <option value="mock_exam">Mock Examinations</option>
          </select>
          <select
            aria-label="Filter assessment status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs font-semibold bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-[#0F2942]"
          >
            <option value="All">All States</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ACTIVE">Active</option>
            <option value="CLOSED">Closed</option>
            <option value="RESULTS_RELEASED">Results Released</option>
          </select>
          <button
            type="button"
            data-testid="new-practice-btn"
            onClick={() => openNewBuilder('practice_session')}
            className="px-3.5 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Practice Session</span>
          </button>
          <button
            type="button"
            data-testid="new-mock-exam-btn"
            onClick={() => openNewBuilder('mock_exam')}
            className="px-3.5 py-2 text-xs font-bold text-white bg-[#F96A1B] hover:bg-[#DE580E] rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Mock Exam</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs font-medium text-[#9A2F09]">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="p-3.5 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] text-xs font-medium text-[#1E6323]">
          {statusMsg}
        </div>
      )}

      {/* Assessment Builder Drawer */}
      {showBuilder && (
        <div
          data-testid="assessment-builder-form"
          className="bg-white rounded-3xl border border-[#99CAFA] p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5F0FA]">
            <div>
              <h3 className="text-base font-display font-bold text-[#0F2942]">
                {editingAssessmentId
                  ? `Edit Draft ${editingAssessmentId}`
                  : kind === 'practice_session'
                  ? 'Build Custom Practice Session'
                  : 'Build Structured Mock Examination'}
              </h3>
              <p className="text-xs text-[#526A84] tabular-nums">
                {sections.length} Section(s) · {totalDraftQuestions} Question(s) · {totalDraftMarks} Total Marks
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowBuilder(false)}
              className="p-1.5 text-[#526A84] hover:text-[#0F2942]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <label htmlFor="ab-kind" className="block font-semibold text-[#476481] mb-1">
                Assessment Type
              </label>
              <select
                id="ab-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as AssessmentKind)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold"
              >
                <option value="practice_session">Custom Practice Session</option>
                <option value="mock_exam">Structured Mock Examination</option>
              </select>
            </div>
            <div>
              <label htmlFor="ab-title" className="block font-semibold text-[#476481] mb-1">
                Title (English)
              </label>
              <input
                id="ab-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Term 2 Mathematics Division Drill"
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
              />
            </div>
            <div>
              <label htmlFor="ab-titlesi" className="block font-semibold text-[#476481] mb-1">
                Sinhala Subtitle
              </label>
              <input
                id="ab-titlesi"
                type="text"
                value={titleSi}
                onChange={(e) => setTitleSi(e.target.value)}
                placeholder="ගණිතය පුහුණු සැසිය"
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
            <div>
              <label htmlFor="ab-grade" className="block font-semibold text-[#476481] mb-1">
                Grade
              </label>
              <select
                id="ab-grade"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="Grade 5">Grade 5</option>
                <option value="Grade 4">Grade 4</option>
                <option value="All">All Grades</option>
              </select>
            </div>
            <div>
              <label htmlFor="ab-time" className="block font-semibold text-[#476481] mb-1">
                Timer (min, 0=none)
              </label>
              <input
                id="ab-time"
                type="number"
                min={0}
                max={180}
                value={timeLimitMinutes}
                onChange={(e) => setTimeLimitMinutes(Math.max(0, Number(e.target.value)))}
                className="w-full px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="ab-att" className="block font-semibold text-[#476481] mb-1">
                Max Attempts
              </label>
              <input
                id="ab-att"
                type="number"
                min={1}
                max={20}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Math.max(1, Number(e.target.value)))}
                className="w-full px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="ab-pass" className="block font-semibold text-[#476481] mb-1">
                Pass Mark %
              </label>
              <input
                id="ab-pass"
                type="number"
                min={0}
                max={100}
                value={passMarkPercent}
                onChange={(e) => setPassMarkPercent(Number(e.target.value))}
                className="w-full px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="ab-exp" className="block font-semibold text-[#476481] mb-1">
                Explanation Timing
              </label>
              <select
                id="ab-exp"
                value={explanationTiming}
                onChange={(e) => setExplanationTiming(e.target.value as ExplanationTiming)}
                className="w-full px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="immediate">Immediate Feedback</option>
                <option value="after_submit">After Submit</option>
                <option value="after_release">After Results Release</option>
              </select>
            </div>
            <div>
              <label htmlFor="ab-target" className="block font-semibold text-[#476481] mb-1">
                Assign Target
              </label>
              <select
                id="ab-target"
                value={targetType === 'grade' ? `grade:${targetValue}` : `student:${targetValue}`}
                onChange={(e) => {
                  const [t, val] = e.target.value.split(':');
                  setTargetType(t as 'grade' | 'student');
                  setTargetValue(val);
                }}
                className="w-full px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="grade:Grade 5">All Grade 5 Students</option>
                <option value="grade:All">All Active Students</option>
                {students.map((st) => (
                  <option key={st.id} value={`student:${st.id}`}>
                    Student: {st.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Authorized Subjects + Delivery Toggles */}
          <div className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-bold text-[#0F2942]">Subjects:</span>
              {subjects.map((s) => {
                const checked = selectedSubjectIds.includes(s.id);
                return (
                  <label key={s.id} className="flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedSubjectIds((prev) =>
                          checked ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                        )
                      }
                      className="accent-[#158EE3]"
                    />
                    <span>{s.nameEn}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={shuffleQuestions}
                  onChange={(e) => setShuffleQuestions(e.target.checked)}
                  className="accent-[#158EE3]"
                />
                <span>Shuffle Questions</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={shuffleOptions}
                  onChange={(e) => setShuffleOptions(e.target.checked)}
                  className="accent-[#158EE3]"
                />
                <span>Shuffle Options</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={showHints}
                  onChange={(e) => setShowHints(e.target.checked)}
                  className="accent-[#158EE3]"
                />
                <span>Allow Hints</span>
              </label>
            </div>
          </div>

          {/* Question Selection Engine & Picker */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            {/* Left: Smart Auto-Select + Question Bank Picker */}
            <div className="xl:col-span-6 space-y-3">
              <div className="p-4 rounded-2xl bg-[#EBF5FF] border border-[#99CAFA] space-y-3 text-xs">
                <div className="font-bold text-[#0F2942] flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#158EE3]" />
                  <span>Automated Question Selection Engine (adds to Active Section)</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <span className="block text-[#476481] mb-1">Mode</span>
                    <select
                      aria-label="Selection mode"
                      value={autoMode}
                      onChange={(e) => setAutoMode(e.target.value as AssessmentSelectionMode)}
                      className="w-full px-2 py-1.5 bg-white border border-[#CBE2FA] rounded-lg font-semibold"
                    >
                      <option value="deterministic">Deterministic</option>
                      <option value="randomized">Randomized</option>
                      <option value="adaptive_gap">Adaptive Weak Gap</option>
                    </select>
                  </div>
                  <div>
                    <span className="block text-[#476481] mb-1">Count</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={autoCount}
                      onChange={(e) => setAutoCount(Math.max(1, Number(e.target.value)))}
                      className="w-full px-2 py-1.5 bg-white border border-[#CBE2FA] rounded-lg tabular-nums"
                    />
                  </div>
                  <div>
                    <span className="block text-[#476481] mb-1">Simple / Mod / Chal</span>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        min={0}
                        aria-label="Simple quota"
                        value={autoSimpleQuota}
                        onChange={(e) => setAutoSimpleQuota(Math.max(0, Number(e.target.value)))}
                        className="w-10 px-1 py-1.5 bg-white border border-[#CBE2FA] rounded-lg text-center tabular-nums"
                      />
                      <input
                        type="number"
                        min={0}
                        aria-label="Moderate quota"
                        value={autoModQuota}
                        onChange={(e) => setAutoModQuota(Math.max(0, Number(e.target.value)))}
                        className="w-10 px-1 py-1.5 bg-white border border-[#CBE2FA] rounded-lg text-center tabular-nums"
                      />
                      <input
                        type="number"
                        min={0}
                        aria-label="Challenging quota"
                        value={autoChalQuota}
                        onChange={(e) => setAutoChalQuota(Math.max(0, Number(e.target.value)))}
                        className="w-10 px-1 py-1.5 bg-white border border-[#CBE2FA] rounded-lg text-center tabular-nums"
                      />
                    </div>
                  </div>
                  <div>
                    <span className="block text-[#476481] mb-1">Student Target</span>
                    <select
                      aria-label="Adaptive student target"
                      value={autoStudentId}
                      onChange={(e) => setAutoStudentId(e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-[#CBE2FA] rounded-lg"
                    >
                      <option value="">General Pool</option>
                      {students.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={excludePreviouslyCorrect}
                        onChange={(e) => setExcludePreviouslyCorrect(e.target.checked)}
                        className="accent-[#158EE3]"
                      />
                      <span>Exclude Prior Correct</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeVirtualPool}
                        onChange={(e) => setIncludeVirtualPool(e.target.checked)}
                        className="accent-[#158EE3]"
                      />
                      <span>Include 500K Pool</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    data-testid="auto-select-preview-btn"
                    onClick={handleAutoSelectPreview}
                    className="px-3 py-1.5 font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-lg"
                  >
                    Auto-Select &amp; Add
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-[#0F2942]">
                    Approved Authorized Question Picker ({visiblePickerQuestions.length})
                  </span>
                  <select
                    aria-label="Filter picker subject"
                    value={pickerSubjectFilter}
                    onChange={(e) => setPickerSubjectFilter(e.target.value)}
                    className="px-2 py-1 bg-white border border-[#CBE2FA] rounded-lg"
                  >
                    <option value="All">All Authorized Subjects</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nameEn}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {visiblePickerQuestions.map((q) => {
                    const selected = sections.some((s) => s.items.some((i) => i.question.id === q.id));
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => toggleQuestionInSection(q)}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs flex items-start justify-between gap-2 ${
                          selected
                            ? 'bg-[#EBF5FF] border-[#158EE3]'
                            : 'bg-white border-[#DCEBFA] hover:bg-[#F3F9FF]'
                        }`}
                      >
                        <div>
                          <div className="font-mono font-bold text-[#158EE3]">
                            {q.id} · {(q.questionType || 'mcq').toUpperCase()} · {q.attributes.difficultyTier} · {q.defaultMarks || 1}mk
                          </div>
                          <div className="font-medium text-[#0F2942] mt-0.5">{q.questionSi}</div>
                        </div>
                        <CheckCircle2
                          className={`w-4 h-4 shrink-0 ${
                            selected ? 'text-[#158EE3]' : 'text-[#CBD5E1]'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: Multi-Section Assessment Structure + Linked Knowledge Guides */}
            <div className="xl:col-span-6 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#0F2942]">
                  Structured Sections (click section header to target additions)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = sections.length;
                    setSections((prev) => [
                      ...prev,
                      {
                        id: `sec-${Date.now()}`,
                        title: `Part ${nextIdx + 1} · Extended Section`,
                        instructions: '',
                        items: [],
                      },
                    ]);
                    setActiveSectionIdx(nextIdx);
                  }}
                  className="px-2.5 py-1 text-xs font-bold text-[#158EE3] bg-[#EBF5FF] border border-[#99CAFA] rounded-lg"
                >
                  + Add Section
                </button>
              </div>

              <div className="space-y-3">
                {sections.map((sec, sIdx) => {
                  const isActive = sIdx === activeSectionIdx;
                  const secMarks = sec.items.reduce((a, b) => a + b.marks, 0);
                  return (
                    <div
                      key={sec.id}
                      onClick={() => setActiveSectionIdx(sIdx)}
                      className={`p-3.5 rounded-2xl border space-y-2.5 cursor-pointer ${
                        isActive ? 'bg-[#F3F9FF] border-[#158EE3]' : 'bg-[#F8FBFF] border-[#DCEBFA]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={sec.title}
                          onChange={(e) =>
                            setSections((prev) =>
                              prev.map((s, idx) =>
                                idx === sIdx ? { ...s, title: e.target.value } : s
                              )
                            )
                          }
                          className="flex-1 px-2.5 py-1 text-xs font-bold text-[#0F2942] bg-white border border-[#CBE2FA] rounded-lg"
                        />
                        <span className="text-[11px] font-bold text-[#158EE3] tabular-nums shrink-0">
                          {sec.items.length} Qs · {secMarks} mks
                        </span>
                        {sections.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSections((prev) => prev.filter((_, idx) => idx !== sIdx));
                              setActiveSectionIdx(0);
                            }}
                            className="p-1 text-[#C62828]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {sec.items.length === 0 ? (
                        <div className="text-[11px] text-[#526A84]">
                          Click questions on the left or run Auto-Select to add items to this section.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {sec.items.map((item, qIdx) => (
                            <div
                              key={item.question.id}
                              className="p-2 rounded-xl bg-white border border-[#DCEBFA] flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="truncate font-medium text-[#0F2942]">
                                {qIdx + 1}. [{item.question.id}] {item.question.questionSi}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  aria-label={`Marks for ${item.question.id}`}
                                  value={item.marks}
                                  onChange={(e) => {
                                    const m = Math.max(1, Number(e.target.value));
                                    setSections((prev) =>
                                      prev.map((s, idx) =>
                                        idx === sIdx
                                          ? {
                                              ...s,
                                              items: s.items.map((it) =>
                                                it.question.id === item.question.id
                                                  ? { ...it, marks: m }
                                                  : it
                                              ),
                                            }
                                          : s
                                      )
                                    );
                                  }}
                                  className="w-12 px-1.5 py-0.5 text-center border border-[#CBE2FA] rounded-md tabular-nums font-bold"
                                />
                                <span className="text-[10px] text-[#526A84]">mk</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSections((prev) =>
                                      prev.map((s, idx) =>
                                        idx === sIdx
                                          ? {
                                              ...s,
                                              items: s.items.filter(
                                                (it) => it.question.id !== item.question.id
                                              ),
                                            }
                                          : s
                                      )
                                    )
                                  }
                                  className="p-1 text-[#C62828]"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {publications.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4] space-y-1.5 text-xs">
                  <div className="font-bold text-[#1E6323] flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Link Recommended Knowledge Guides (for Post-Assessment Revision)</span>
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                    {publications.map((pub) => {
                      const checked = linkedPubIds.includes(pub.id);
                      return (
                        <label key={pub.id} className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-[#B7E1BA] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setLinkedPubIds((prev) =>
                                checked ? prev.filter((x) => x !== pub.id) : [...prev, pub.id]
                              )
                            }
                            className="accent-[#2E7D32]"
                          />
                          <span className="truncate max-w-[200px]">{pub.title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-[#E5F0FA]">
            <button
              type="button"
              onClick={() => handleSaveAssessment(false)}
              data-testid="save-assessment-draft-btn"
              className="px-4 py-2 text-xs font-bold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] hover:bg-[#E5F2FF] rounded-xl"
            >
              Save as DRAFT
            </button>
            <button
              type="button"
              onClick={() => handleSaveAssessment(true)}
              data-testid="publish-assessment-btn"
              className="px-5 py-2 text-xs font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl"
            >
              Publish Assessment Now
            </button>
          </div>
        </div>
      )}

      {/* Existing Assessments Directory */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-3">
        {loading ? (
          <div className="py-8 text-center text-sm text-[#526A84]">Loading assessments...</div>
        ) : assessments.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#526A84]">
            No practice sessions or mock exams found for the selected filter.
          </div>
        ) : (
          assessments.map((a) => (
            <div
              key={a.id}
              data-testid={`assessment-row-${a.id}`}
              className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex flex-wrap items-start justify-between gap-4"
            >
              <div className="space-y-1 flex-1 min-w-[260px]">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-bold text-[#158EE3]">{a.id}</span>
                  <span
                    className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${STATUS_BADGE[a.status]}`}
                  >
                    {a.status}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-white border border-[#CBE2FA] text-[11px] font-semibold text-[#0F2942]">
                    {a.kind === 'practice_session' ? 'Practice Session' : 'Mock Exam'}
                  </span>
                  <span className="text-[#526A84] tabular-nums">
                    {a.questionCount} Qs · {a.totalMarks} Marks ·{' '}
                    {a.timeLimitMinutes ? `${a.timeLimitMinutes} min` : 'Untimed'} · {a.grade}
                  </span>
                </div>
                <div className="text-sm font-bold text-[#0F2942]">{a.title}</div>
                <div className="text-xs text-[#526A84]">
                  Author: {a.authorName} · Subjects:{' '}
                  {a.subjectIds
                    .map((sid) => subjects.find((s) => s.id === sid)?.nameEn || sid)
                    .join(', ')}{' '}
                  · Feedback: {a.explanationTiming.replace('_', ' ')}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {(a.status === 'DRAFT' || a.status === 'VALIDATED') && (
                  <>
                    <button
                      type="button"
                      onClick={() => openEditDraftBuilder(a.id)}
                      className="px-2.5 py-1.5 text-[11px] font-bold text-[#0F2942] bg-white border border-[#CBE2FA] rounded-lg flex items-center gap-1 whitespace-nowrap"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Draft</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTransition(a.id, 'PUBLISHED')}
                      className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-[#2E7D32] rounded-lg whitespace-nowrap"
                    >
                      Publish
                    </button>
                  </>
                )}

                {(a.status === 'PUBLISHED' || a.status === 'ACTIVE') && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleTransition(a.id, 'CLOSED')}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-[#9A2F09] bg-[#FFF2ED] border border-[#FAC5B2] rounded-lg whitespace-nowrap"
                    >
                      Close Window
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTransition(a.id, 'RESULTS_RELEASED')}
                      className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-[#158EE3] rounded-lg whitespace-nowrap"
                    >
                      Release Results
                    </button>
                  </>
                )}

                {a.status === 'CLOSED' && (
                  <button
                    type="button"
                    onClick={() => handleTransition(a.id, 'RESULTS_RELEASED')}
                    className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-[#158EE3] rounded-lg whitespace-nowrap"
                  >
                    Release Results
                  </button>
                )}

                <button
                  type="button"
                  data-testid={`analytics-btn-${a.id}`}
                  onClick={() => handleOpenAnalytics(a.id)}
                  className="px-2.5 py-1.5 text-[11px] font-bold text-[#158EE3] bg-white border border-[#CBE2FA] rounded-lg hover:bg-[#EBF5FF] flex items-center gap-1 whitespace-nowrap"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Results &amp; Grade</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportPrintable(a.id, false)}
                  className="px-2.5 py-1.5 text-[11px] font-semibold text-[#0F2942] bg-white border border-[#DCEBFA] rounded-lg flex items-center gap-1 whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Export</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await api.duplicateAssessment(a.id);
                    await loadWorkspaceData();
                  }}
                  className="px-2.5 py-1.5 text-[11px] font-semibold text-[#526A84] bg-white border border-[#DCEBFA] rounded-lg flex items-center gap-1 whitespace-nowrap"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Assessment Results, Manual Grading & Follow-Up Assignment Drawer */}
      {analyticsData && (
        <div
          data-testid="assessment-analytics-panel"
          className="bg-white rounded-3xl border border-[#99CAFA] p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5F0FA]">
            <div>
              <h3 className="text-base font-display font-bold text-[#0F2942]">
                Results, Analytics &amp; Manual Marking · {analyticsData.assessment.title}
              </h3>
              <p className="text-xs text-[#526A84] tabular-nums">
                {analyticsData.summary.completedCount} Completed · {analyticsData.summary.pendingManualCount} Pending Manual Marking · Avg {analyticsData.summary.averageScorePercent}% · Pass Rate {analyticsData.summary.passRatePercent}%
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAnalyticsData(null)}
              className="px-3 py-1.5 text-xs font-semibold text-[#526A84] bg-[#F3F9FF] rounded-lg"
            >
              Close Analytics
            </button>
          </div>

          {/* Student Attempts & Manual Marking Table */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-[#0F2942]">Student Attempts</h4>
            {analyticsData.attempts.length === 0 ? (
              <div className="text-xs text-[#526A84]">No student attempts recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E5F0FA] text-[#526A84]">
                      <th className="py-2 pr-3">Student</th>
                      <th className="py-2 px-3">Attempt #</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3 text-right">Marks</th>
                      <th className="py-2 px-3 text-right">Score %</th>
                      <th className="py-2 pl-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F6FD]">
                    {analyticsData.attempts.map((att) => (
                      <tr key={att.id}>
                        <td className="py-2.5 pr-3 font-semibold text-[#0F2942]">
                          {att.studentName} <span className="font-mono text-[#526A84]">({att.studentCode})</span>
                        </td>
                        <td className="py-2.5 px-3 tabular-nums">#{att.attemptNumber}</td>
                        <td className="py-2.5 px-3 font-semibold">
                          <span
                            className={
                              att.status === 'pending_manual_marking'
                                ? 'text-[#D97706]'
                                : 'text-[#2E7D32]'
                            }
                          >
                            {att.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {att.totalAwardedMarks}/{att.maxMarks}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold tabular-nums text-[#158EE3]">
                          {att.scorePercent ?? '—'}%
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenManualGrading(att)}
                            className="px-2.5 py-1 text-[11px] font-bold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] rounded-lg inline-flex items-center gap-1"
                          >
                            <ClipboardCheck className="w-3.5 h-3.5 text-[#158EE3]" />
                            <span>Inspect / Mark</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Manual Grading Form */}
          {gradingAttempt && (
            <form
              onSubmit={handleSubmitManualGrades}
              className="p-4 rounded-2xl bg-[#FFF9EE] border border-[#F5D399] space-y-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-[#7C4D00]">
                  Marking Attempt {gradingAttempt.attempt.id}
                </h4>
                <button
                  type="button"
                  onClick={() => setGradingAttempt(null)}
                  className="text-xs text-[#7C4D00] hover:underline"
                >
                  Cancel
                </button>
              </div>
              {gradingAttempt.items.map((it) => (
                <div key={it.snapshotId} className="p-3 rounded-xl bg-white border border-[#F5D399] text-xs space-y-1.5">
                  <div className="font-semibold text-[#0F2942]">
                    {it.sortOrder}. {it.questionSi} ({it.maxMarks} mks · {it.markingStatus})
                  </div>
                  <div className="text-[#476481]">
                    Student Response:{' '}
                    <strong>
                      {it.submittedAnswerText ||
                        (it.submittedOriginalOptionIndex !== null
                          ? it.options[it.submittedOriginalOptionIndex]
                          : 'No response')}
                    </strong>
                  </div>
                  {(it.markingStatus === 'pending_manual' || it.markingStatus === 'manually_graded') && (
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <label className="flex items-center gap-1.5 font-semibold">
                        <span>Award Marks (0–{it.maxMarks}):</span>
                        <input
                          type="number"
                          min={0}
                          max={it.maxMarks}
                          value={gradeInputs[it.snapshotId]?.awardedMarks ?? 0}
                          onChange={(e) =>
                            setGradeInputs((prev) => ({
                              ...prev,
                              [it.snapshotId]: {
                                awardedMarks: Number(e.target.value),
                                comment: prev[it.snapshotId]?.comment || '',
                              },
                            }))
                          }
                          className="w-16 px-2 py-1 border border-[#CBE2FA] rounded-lg tabular-nums"
                        />
                      </label>
                      <input
                        type="text"
                        value={gradeInputs[it.snapshotId]?.comment || ''}
                        onChange={(e) =>
                          setGradeInputs((prev) => ({
                            ...prev,
                            [it.snapshotId]: {
                              awardedMarks: prev[it.snapshotId]?.awardedMarks ?? 0,
                              comment: e.target.value,
                            },
                          }))
                        }
                        placeholder="Teacher feedback note..."
                        className="flex-1 min-w-[200px] px-2.5 py-1 border border-[#CBE2FA] rounded-lg"
                      />
                    </div>
                  )}
                </div>
              ))}
              <button
                type="submit"
                className="px-4 py-2 text-xs font-bold text-white bg-[#2E7D32] rounded-xl"
              >
                Save Manual Marks &amp; Finalize Score
              </button>
            </form>
          )}

          {/* Question-Level & Topic-Level Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2">
              <div className="font-bold text-[#0F2942]">Question-Level Accuracy</div>
              {analyticsData.questionAnalytics.map((qa) => (
                <div key={qa.snapshotId} className="flex items-center justify-between gap-2 border-t border-[#E5F0FA] pt-1.5">
                  <span className="truncate text-[#0F2942]">
                    {qa.sortOrder}. [{qa.questionId}] {qa.questionSi}
                  </span>
                  <span className="font-bold tabular-nums shrink-0 text-[#158EE3]">
                    {qa.accuracyPercent !== null ? `${qa.accuracyPercent}%` : 'Pending'}
                  </span>
                </div>
              ))}
            </div>

            <form
              onSubmit={handleAssignFollowUp}
              className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4] space-y-2.5"
            >
              <div className="font-bold text-[#1E6323] flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" />
                <span>Assign Follow-Up Study Plan &amp; Knowledge Guide</span>
              </div>
              <input
                type="text"
                required
                value={followUpTitle}
                onChange={(e) => setFollowUpTitle(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-[#B7E1BA] rounded-lg"
              />
              <textarea
                rows={2}
                required
                value={followUpBody}
                onChange={(e) => setFollowUpBody(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-[#B7E1BA] rounded-lg"
              />
              <select
                aria-label="Attach knowledge publication"
                value={followUpPubId}
                onChange={(e) => setFollowUpPubId(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-[#B7E1BA] rounded-lg"
              >
                <option value="">Optional: Link Knowledge Publication</option>
                {publications.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={followUpStudentIds.length === 0}
                className="px-4 py-1.5 font-bold text-white bg-[#2E7D32] rounded-lg disabled:opacity-50"
              >
                Send Follow-Up to Participating Students ({new Set(followUpStudentIds).size})
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Printable / Export Modal */}
      {printableData && (
        <div className="fixed inset-0 z-50 bg-[#0F2942]/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#DCEBFA] max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
              <div>
                <h3 className="text-base font-display font-bold text-[#0F2942]">
                  {printableData.assessment.title} · Printable Paper
                </h3>
                <p className="text-xs text-[#526A84]">
                  {printableData.assessment.totalMarks} Marks ·{' '}
                  {printableData.assessment.timeLimitMinutes
                    ? `${printableData.assessment.timeLimitMinutes} Minutes`
                    : 'Untimed'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExportPrintable(printableData.assessment.id, !printWithKey)}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#F3F9FF] border border-[#CBE2FA] rounded-lg text-[#0F2942]"
                >
                  {printWithKey ? 'Hide Answer Key' : 'Include Answer Key'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadJsonExport}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#F3F9FF] border border-[#CBE2FA] rounded-lg text-[#158EE3] flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-[#158EE3] rounded-lg flex items-center gap-1"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintableData(null)}
                  className="p-1.5 text-[#526A84]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {printableData.sections.map((sec) => (
              <div key={sec.id} className="space-y-3">
                <div className="text-sm font-bold text-[#0F2942] border-b border-[#E5F0FA] pb-1">
                  {sec.title} ({sec.totalMarks} Marks)
                </div>
                {sec.questions.map((q) => (
                  <div key={q.questionId} className="p-3 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] text-xs space-y-1.5">
                    <div className="font-semibold text-[#0F2942]">
                      {q.order}. {q.questionSi} <span className="text-[#526A84]">[{q.marks} mk]</span>
                    </div>
                    {(q.questionType === 'mcq' || q.questionType === 'true_false') && (
                      <div className="grid grid-cols-2 gap-1.5 pl-3 text-[#476481]">
                        {q.options.filter(Boolean).map((opt, idx) => (
                          <div key={idx}>
                            {['A', 'B', 'C', 'D'][idx]}. {opt}
                          </div>
                        ))}
                      </div>
                    )}
                    {printWithKey && (
                      <div className="p-2 rounded-lg bg-[#EEF9EF] border border-[#B7E1BA] text-[#1E6323]">
                        <strong>Answer:</strong>{' '}
                        {q.questionType === 'mcq' || q.questionType === 'true_false'
                          ? `${['A', 'B', 'C', 'D'][q.correctIndex ?? 0]} (${q.options[q.correctIndex ?? 0]})`
                          : (q.acceptedAnswers || []).join(' / ') || 'Manual Rubric'}{' '}
                        {q.explanation ? `· ${q.explanation}` : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
