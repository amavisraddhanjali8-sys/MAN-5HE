import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Edit3,
  Eraser,
  Eye,
  FileUp,
  History,
  PenTool,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import { COGNITIVE_DOMAINS, calculateQuizDifficultyScore } from '../lib/psychometrics';
import type {
  CognitiveDomain,
  QuestionApprovalStatus,
  QuestionReviewActionRecord,
  QuestionType,
  QuizItem,
  SubjectCategory,
  SubtopicNode,
  TopicNode,
} from '../lib/types';

type QuestionWithStats = QuizItem & {
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
};

interface QuestionBankManagerProps {
  role: 'admin' | 'teacher';
  user: AuthUser;
  subjects: SubjectCategory[];
  topics: TopicNode[];
  subtopics: SubtopicNode[];
  onInspectQuestion: (questionId: string) => void;
  onQuestionsChanged?: () => void;
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Multiple Choice',
  numerical: 'Numerical',
  true_false: 'True / False',
  short_answer: 'Short Answer',
};

const STATUS_STYLE: Record<QuestionApprovalStatus, string> = {
  DRAFT: 'bg-[#F3F6FA] border-[#CBD5E1] text-[#475569]',
  PENDING_REVIEW: 'bg-[#FFF7EB] border-[#F5D399] text-[#8A5300]',
  APPROVED: 'bg-[#EBF5FF] border-[#99CAFA] text-[#0E4F80]',
  ACTIVE: 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]',
  REJECTED: 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]',
  RETIRED: 'bg-[#F8FAFC] border-[#CBD5E1] text-[#64748B]',
};

const SAMPLE_CSV = `subjectId,topicId,grade,questionType,questionSi,questionEn,options,correctIndex,acceptedAnswers,defaultMarks,cognitiveSkill,hint,explanation,memoryTrickTitle,memoryTrickBody
subj-math,top-math-arith,Grade 5,mcq,"72 ÷ 8 + 15 යනු කීයද?","What is 72 ÷ 8 + 15?","20|24|26|28",1,"24",2,"Application","Divide first, then add 15.","72 ÷ 8 = 9; 9 + 15 = 24.","Division First Bridge","Always cross the division bridge before walking the plus road!"
subj-math,top-math-arith,Grade 5,numerical,"125 × 8 හි අගය කීයද?","Calculate 125 × 8","","0","1000",2,"Recall","Think of 125 × 4 = 500, then double it.","125 × 8 = 1000.","Eighths of 1000","125 × 8 always makes a clean thousand!"`;

const SAMPLE_JSON = JSON.stringify(
  [
    {
      subjectId: 'subj-math',
      topicId: 'top-math-time',
      grade: 'Grade 5',
      questionType: 'true_false',
      questionSi: 'වසරකට දින 365ක් ඇති අතර අධික අවුරුද්දකට දින 366ක් ඇත.',
      questionEn: 'A regular year has 365 days and a leap year has 366 days.',
      options: ['True (සත්‍යයි)', 'False (අසත්‍යයි)'],
      correctIndex: 0,
      defaultMarks: 1,
      cognitiveSkill: 'Recall',
      explanation: 'Leap years add February 29 every 4 years.',
      memoryTrickTitle: 'Leap Year Day',
      memoryTrickBody: 'Every 4th February hops up to 29 days!',
    },
  ],
  null,
  2
);

export function QuestionBankManager({
  role,
  user,
  subjects,
  topics,
  subtopics,
  onInspectQuestion,
  onQuestionsChanged,
}: QuestionBankManagerProps) {
  // Filters
  const [sourceFilter, setSourceFilter] = useState<'curated' | 'all' | 'pool'>('curated');
  const [subjectId, setSubjectId] = useState<string>('All');
  const [topicId, setTopicId] = useState<string>('All');
  const [subtopicId, setSubtopicId] = useState<string>('All');
  const [gradeFilter, setGradeFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [difficultyFilter, setDifficultyFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [perfFilter, setPerfFilter] = useState<string>('All');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  const [questions, setQuestions] = useState<QuestionWithStats[]>([]);
  const [totalVirtualPool, setTotalVirtualPool] = useState(500000);
  const [curatedCount, setCuratedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Authoring / Editing panel state
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formSubjectId, setFormSubjectId] = useState<string>(subjects[0]?.id || 'subj-math');
  const [formTopicId, setFormTopicId] = useState<string>('');
  const [formSubtopicId, setFormSubtopicId] = useState<string>('');
  const [formGrade, setFormGrade] = useState<string>('Grade 5');
  const [formType, setFormType] = useState<QuestionType>('mcq');
  const [formSkill, setFormSkill] = useState<string>('Application');
  const [formMarks, setFormMarks] = useState<number>(2);
  const [formQuestionSi, setFormQuestionSi] = useState('');
  const [formQuestionEn, setFormQuestionEn] = useState('');
  const [formObjectives, setFormObjectives] = useState('');
  const [formHint, setFormHint] = useState('');
  const [formOptA, setFormOptA] = useState('');
  const [formOptB, setFormOptB] = useState('');
  const [formOptC, setFormOptC] = useState('');
  const [formOptD, setFormOptD] = useState('');
  const [formCorrectIndex, setFormCorrectIndex] = useState<number>(0);
  const [formAcceptedText, setFormAcceptedText] = useState('');
  const [formNumericTolerance, setFormNumericTolerance] = useState<number>(0);
  const [formManualReview, setFormManualReview] = useState<boolean>(false);
  const [formMarkingNotes, setFormMarkingNotes] = useState('');
  const [formMemoryTitle, setFormMemoryTitle] = useState('');
  const [formMemoryBody, setFormMemoryBody] = useState('');
  const [formExplanation, setFormExplanation] = useState('');
  const [formStatus, setFormStatus] = useState<QuestionApprovalStatus>(
    role === 'admin' ? 'ACTIVE' : 'DRAFT'
  );
  const [formChangeNote, setFormChangeNote] = useState('');
  const [formCognitiveDomain, setFormCognitiveDomain] = useState<CognitiveDomain>(
    subjects[0]?.cognitiveDomain || 'Mathematics & Word Problems'
  );
  const [formIntelligence, setFormIntelligence] = useState(65);
  const [formCorrectProb, setFormCorrectProb] = useState(0.6);
  const [formPriority, setFormPriority] = useState(8);
  const [formStrength, setFormStrength] = useState(80);
  const [formEstSeconds, setFormEstSeconds] = useState(45);

  // Canvas Sketchpad + Image Attachment
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [penColor, setPenColor] = useState('#158EE3');
  const [isEraser, setIsEraser] = useState(false);
  const [hasCanvasStrokes, setHasCanvasStrokes] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string>('');

  // Bulk Import Modal State
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkFormat, setBulkFormat] = useState<'csv' | 'json'>('csv');
  const [bulkContent, setBulkContent] = useState(SAMPLE_CSV);
  const [bulkDefaultSubject, setBulkDefaultSubject] = useState(subjects[0]?.id || 'subj-math');
  const [bulkInitialStatus, setBulkInitialStatus] = useState<QuestionApprovalStatus>(
    role === 'admin' ? 'ACTIVE' : 'DRAFT'
  );
  const [bulkResult, setBulkResult] = useState<{
    importedCount: number;
    errors: { rowNumber: number; error: string }[];
  } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Inline Reject Prompt & Review Audit Expansion
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [expandedReviewQId, setExpandedReviewQId] = useState<string | null>(null);
  const [reviewHistory, setReviewHistory] = useState<QuestionReviewActionRecord[]>([]);

  useEffect(() => {
    if (subjects.length > 0 && !subjects.some((s) => s.id === formSubjectId)) {
      const first = subjects[0];
      setFormSubjectId(first.id);
      setBulkDefaultSubject(first.id);
      setFormCognitiveDomain(first.cognitiveDomain);
      const t = topics.find((tp) => tp.subjectId === first.id);
      setFormTopicId(t?.id || '');
      const st = t ? subtopics.find((s) => s.topicId === t.id) : undefined;
      setFormSubtopicId(st?.id || '');
    }
  }, [subjects]);

  const loadQuestions = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getAdminQuizzes({
        source: role === 'teacher' ? 'curated' : sourceFilter,
        subjectId,
        topicId,
        subtopicId,
        grade: gradeFilter,
        questionType: typeFilter,
        difficulty: difficultyFilter,
        approvalStatus: statusFilter,
        performanceFlag: perfFilter,
        search,
        page,
        pageSize: 20,
      });
      setQuestions(res.quizzes);
      setTotalVirtualPool(res.totalVirtualPool);
      setCuratedCount(res.curatedCount);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuestions();
  }, [
    sourceFilter,
    subjectId,
    topicId,
    subtopicId,
    gradeFilter,
    typeFilter,
    difficultyFilter,
    statusFilter,
    perfFilter,
    search,
    page,
    subjects.map((s) => s.id).join(','),
  ]);

  useEffect(() => {
    if (!showEditor) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [showEditor, editingId]);

  const resetForm = (targetSubjectId?: string) => {
    const sid = targetSubjectId || subjects[0]?.id || 'subj-math';
    const subjObj = subjects.find((s) => s.id === sid);
    const firstTopic = topics.find((t) => t.subjectId === sid);
    const firstSub = firstTopic ? subtopics.find((st) => st.topicId === firstTopic.id) : undefined;

    setEditingId(null);
    setFormSubjectId(sid);
    setFormTopicId(firstTopic?.id || '');
    setFormSubtopicId(firstSub?.id || '');
    setFormGrade('Grade 5');
    setFormType('mcq');
    setFormSkill('Application');
    setFormMarks(2);
    setFormQuestionSi('');
    setFormQuestionEn('');
    setFormObjectives('');
    setFormHint('');
    setFormOptA('');
    setFormOptB('');
    setFormOptC('');
    setFormOptD('');
    setFormCorrectIndex(0);
    setFormAcceptedText('');
    setFormNumericTolerance(0);
    setFormManualReview(false);
    setFormMarkingNotes('');
    setFormMemoryTitle('');
    setFormMemoryBody('');
    setFormExplanation('');
    setFormStatus(role === 'admin' ? 'ACTIVE' : 'DRAFT');
    setFormChangeNote('');
    setFormCognitiveDomain(subjObj?.cognitiveDomain || 'Mathematics & Word Problems');
    setFormIntelligence(65);
    setFormCorrectProb(0.6);
    setFormPriority(8);
    setFormStrength(80);
    setFormEstSeconds(45);
    setUploadedImageUrl('');
    setHasCanvasStrokes(false);
  };

  const openNewQuestionForm = () => {
    resetForm();
    setShowEditor(true);
  };

  const openEditQuestionForm = (q: QuestionWithStats) => {
    setEditingId(q.id);
    setFormSubjectId(q.subjectId || subjects[0]?.id || 'subj-math');
    setFormTopicId(q.topicId || '');
    setFormSubtopicId(q.subtopicId || '');
    setFormGrade(q.grade || 'Grade 5');
    setFormType(q.questionType || 'mcq');
    setFormSkill(q.cognitiveSkill || 'Application');
    setFormMarks(q.defaultMarks || 1);
    setFormQuestionSi(q.questionSi);
    setFormQuestionEn(q.questionEn || '');
    setFormObjectives(q.learningObjectives || '');
    setFormHint(q.hint || '');
    setFormOptA(q.options[0] || '');
    setFormOptB(q.options[1] || '');
    setFormOptC(q.options[2] || '');
    setFormOptD(q.options[3] || '');
    setFormCorrectIndex(q.correctIndex || 0);
    setFormAcceptedText((q.acceptedAnswers || []).join(', '));
    setFormNumericTolerance(q.markingRule?.numericTolerance ?? 0);
    setFormManualReview(Boolean(q.markingRule?.requiresManualReview));
    setFormMarkingNotes(q.markingRule?.markingNotes || '');
    setFormMemoryTitle(q.memoryTrickTitle || '');
    setFormMemoryBody(q.memoryTrickBody || '');
    setFormExplanation(q.explanation || '');
    setFormStatus(q.approvalStatus || 'ACTIVE');
    setFormChangeNote('');
    setFormCognitiveDomain(q.attributes.cognitiveDomain);
    setFormIntelligence(q.attributes.intelligenceMeasure);
    setFormCorrectProb(q.attributes.correctProbability);
    setFormPriority(q.attributes.examPriority);
    setFormStrength(q.attributes.quizStrength);
    setFormEstSeconds(q.attributes.estimatedSeconds);
    setUploadedImageUrl(q.imageUrl || '');
    setHasCanvasStrokes(false);
    setShowEditor(true);
  };

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
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
      if (typeof reader.result === 'string') setUploadedImageUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    let finalImageUrl = uploadedImageUrl;
    if (!finalImageUrl && hasCanvasStrokes && canvasRef.current) {
      finalImageUrl = canvasRef.current.toDataURL('image/png');
    }

    const acceptedAnswers = formAcceptedText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const options =
      formType === 'mcq'
        ? [formOptA, formOptB, formOptC, formOptD]
        : formType === 'true_false'
        ? [formOptA || 'True (සත්‍යයි)', formOptB || 'False (අසත්‍යයි)', '', '']
        : [acceptedAnswers[0] || '', '', '', ''];

    const markingRule = {
      ...(formType === 'numerical' ? { numericTolerance: formNumericTolerance } : {}),
      ...(formType === 'short_answer'
        ? { requiresManualReview: formManualReview, markingNotes: formMarkingNotes }
        : {}),
    };

    try {
      if (editingId) {
        const res = await api.updateQuestionExtended(editingId, {
          subjectId: formSubjectId,
          topicId: formTopicId || undefined,
          subtopicId: formSubtopicId || undefined,
          grade: formGrade,
          questionType: formType,
          cognitiveSkill: formSkill,
          learningObjectives: formObjectives,
          hint: formHint,
          markingRule,
          acceptedAnswers,
          defaultMarks: formMarks,
          questionSi: formQuestionSi,
          questionEn: formQuestionEn || formQuestionSi,
          options,
          correctIndex: formCorrectIndex,
          imageUrl: finalImageUrl || null,
          memoryTrickTitle: formMemoryTitle,
          memoryTrickBody: formMemoryBody,
          explanation: formExplanation,
          changeNote: formChangeNote || undefined,
          attributes: {
            cognitiveDomain: formCognitiveDomain,
            intelligenceMeasure: formIntelligence,
            correctProbability: formCorrectProb,
            examPriority: formPriority,
            quizStrength: formStrength,
            estimatedSeconds: formEstSeconds,
          },
        });
        setStatusMsg(`Updated question ${res.quiz.id} to version v${res.quiz.version}.`);
      } else {
        const res = await api.createQuestionExtended({
          subjectId: formSubjectId,
          topicId: formTopicId || undefined,
          subtopicId: formSubtopicId || undefined,
          grade: formGrade,
          questionType: formType,
          cognitiveSkill: formSkill,
          learningObjectives: formObjectives,
          hint: formHint,
          markingRule,
          acceptedAnswers,
          defaultMarks: formMarks,
          approvalStatus: formStatus,
          questionSi: formQuestionSi,
          questionEn: formQuestionEn || formQuestionSi,
          options,
          correctIndex: formCorrectIndex,
          imageUrl: finalImageUrl || undefined,
          memoryTrickTitle: formMemoryTitle,
          memoryTrickBody: formMemoryBody,
          explanation: formExplanation,
          attributes: {
            cognitiveDomain: formCognitiveDomain,
            intelligenceMeasure: formIntelligence,
            correctProbability: formCorrectProb,
            examPriority: formPriority,
            quizStrength: formStrength,
            estimatedSeconds: formEstSeconds,
          },
        });
        setStatusMsg(
          `Created ${res.quiz.questionType?.toUpperCase()} question ${res.quiz.id} (${res.quiz.approvalStatus}).`
        );
      }
      setShowEditor(false);
      resetForm();
      await loadQuestions();
      onQuestionsChanged?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleTransitionStatus = async (
    qId: string,
    toStatus: QuestionApprovalStatus,
    notes?: string
  ) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.transitionQuestionStatus(qId, { toStatus, notes });
      setStatusMsg(`Question ${res.quiz.id} transitioned to ${res.quiz.approvalStatus}.`);
      setRejectingId(null);
      setRejectNote('');
      await loadQuestions();
      onQuestionsChanged?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleDuplicate = async (qId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.duplicateQuestion(qId);
      setStatusMsg(`Duplicated ${qId} into new DRAFT ${res.quiz.id}.`);
      await loadQuestions();
      onQuestionsChanged?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleReassignSubject = async (qId: string, newSubjId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const firstTopic = topics.find((t) => t.subjectId === newSubjId);
      const firstSub = firstTopic
        ? subtopics.find((st) => st.topicId === firstTopic.id)
        : undefined;
      await api.reassignQuestionSubject(qId, {
        subjectId: newSubjId,
        topicId: firstTopic?.id,
        subtopicId: firstSub?.id,
        changeNote: 'Reassigned subject category from Question Bank',
      });
      setStatusMsg(`Moved ${qId} to ${subjects.find((s) => s.id === newSubjId)?.nameEn || newSubjId}.`);
      await loadQuestions();
      onQuestionsChanged?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleToggleReviews = async (qId: string) => {
    if (expandedReviewQId === qId) {
      setExpandedReviewQId(null);
      return;
    }
    try {
      const res = await api.getQuestionReviewHistory(qId);
      setReviewHistory(res.reviews);
      setExpandedReviewQId(qId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleBulkImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkBusy(true);
    setErrorMsg(null);
    setBulkResult(null);
    try {
      const res = await api.bulkImportQuestions({
        format: bulkFormat,
        content: bulkContent,
        defaultSubjectId: bulkDefaultSubject,
        initialStatus: bulkInitialStatus,
      });
      setBulkResult({ importedCount: res.importedCount, errors: res.errors });
      if (res.importedCount > 0) {
        setStatusMsg(`Bulk imported ${res.importedCount} question(s) into Question Bank.`);
        await loadQuestions();
        onQuestionsChanged?.();
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.json')) setBulkFormat('json');
    else setBulkFormat('csv');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setBulkContent(reader.result);
    };
    reader.readAsText(file);
  };

  const visibleFilterTopics =
    subjectId === 'All' ? topics : topics.filter((t) => t.subjectId === subjectId);
  const visibleFilterSubtopics =
    topicId === 'All'
      ? subjectId === 'All'
        ? subtopics
        : subtopics.filter((st) => st.subjectId === subjectId)
      : subtopics.filter((st) => st.topicId === topicId);

  const formTopics = topics.filter((t) => t.subjectId === formSubjectId);
  const formSubtopics = subtopics.filter((st) => st.topicId === formTopicId);
  const liveDifficulty = calculateQuizDifficultyScore({
    intelligenceMeasure: formIntelligence,
    correctProbability: formCorrectProb,
    wrongProbability: Math.round((1 - formCorrectProb) * 100) / 100,
    examPriority: formPriority,
    quizStrength: formStrength,
    difficultyTier: 'Moderate',
    cognitiveDomain: formCognitiveDomain,
    estimatedSeconds: formEstSeconds,
  });

  return (
    <div className="space-y-5" data-testid="question-bank-manager">
      {/* Header & Action Bar */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-display font-bold text-[#0F2942]">
              {role === 'admin'
                ? 'Central Question Bank & Lifecycle Moderation'
                : 'Subject-Scoped Question Bank & Authoring'}
            </h2>
            <p className="text-xs text-[#526A84] mt-0.5 tabular-nums">
              {curatedCount} Curated Questions
              {role === 'admin' ? ` · ${totalVirtualPool.toLocaleString()} Parametric Pool` : ''} ·{' '}
              {subjects.length} Authorized Subject{subjects.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="open-bulk-import-btn"
              onClick={() => {
                setBulkResult(null);
                setShowBulkModal(true);
              }}
              className="px-3.5 py-2 text-xs font-bold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] hover:bg-[#E5F2FF] rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <FileUp className="w-3.5 h-3.5 text-[#158EE3]" />
              <span>Bulk Import (CSV / JSON)</span>
            </button>
            <button
              type="button"
              data-testid="new-question-btn"
              onClick={() => (showEditor ? setShowEditor(false) : openNewQuestionForm())}
              className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {showEditor ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{showEditor ? 'Close Editor' : 'Create Question'}</span>
            </button>
          </div>
        </div>

        {/* Multi-Facet Search & Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs pt-2 border-t border-[#E5F0FA]">
          <div className="col-span-2 relative">
            <Search className="w-3.5 h-3.5 text-[#7C97B2] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Search questions"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search text or ID..."
              className="w-full pl-8 pr-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
            />
          </div>
          <select
            aria-label="Filter by subject"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setTopicId('All');
              setSubtopicId('All');
              setPage(1);
            }}
            className="px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942]"
          >
            <option value="All">All Subjects ({subjects.length})</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameEn}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by topic"
            value={topicId}
            onChange={(e) => {
              setTopicId(e.target.value);
              setSubtopicId('All');
              setPage(1);
            }}
            className="px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942]"
          >
            <option value="All">All Topics</option>
            {visibleFilterTopics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nameEn}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by subtopic"
            value={subtopicId}
            onChange={(e) => {
              setSubtopicId(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942]"
          >
            <option value="All">All Subtopics</option>
            {visibleFilterSubtopics.map((st) => (
              <option key={st.id} value={st.id}>
                {st.nameEn}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by question type"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942]"
          >
            <option value="All">All Types</option>
            <option value="mcq">MCQ</option>
            <option value="numerical">Numerical</option>
            <option value="true_false">True / False</option>
            <option value="short_answer">Short Answer</option>
          </select>
          <select
            aria-label="Filter by approval status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942]"
          >
            <option value="All">All States</option>
            <option value="ACTIVE">Active</option>
            <option value="APPROVED">Approved</option>
            <option value="PENDING_REVIEW">Pending Review</option>
            <option value="DRAFT">Draft</option>
            <option value="REJECTED">Rejected</option>
            <option value="RETIRED">Retired</option>
          </select>
          <select
            aria-label="Filter by difficulty"
            value={difficultyFilter}
            onChange={(e) => {
              setDifficultyFilter(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942]"
          >
            <option value="All">All Difficulty</option>
            <option value="Simple">Simple</option>
            <option value="Moderate">Moderate</option>
            <option value="Challenging">Challenging</option>
            <option value="Master">Master</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by grade"
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-lg font-medium text-[#0F2942]"
            >
              <option value="All">All Grades</option>
              <option value="Grade 5">Grade 5</option>
              <option value="Grade 4">Grade 4</option>
            </select>
            <select
              aria-label="Filter by performance flag"
              value={perfFilter}
              onChange={(e) => setPerfFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-lg font-medium text-[#0F2942]"
            >
              <option value="All">All Attempt Flags</option>
              <option value="repeated_error">Has Repeated-Error Students</option>
              <option value="low_accuracy">Low Accuracy (&lt;50%)</option>
            </select>
          </div>
          {role === 'admin' && (
            <div className="flex items-center gap-1 p-1 bg-[#F3F9FF] rounded-lg border border-[#DCEBFA]">
              {(['curated', 'all', 'pool'] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSourceFilter(src)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md capitalize ${
                    sourceFilter === src ? 'bg-[#158EE3] text-white' : 'text-[#526A84]'
                  }`}
                >
                  {src === 'pool' ? '500K Pool' : src}
                </button>
              ))}
            </div>
          )}
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

      {/* Question Creator / Editor Drawer */}
      {showEditor && (
        <form
          onSubmit={handleSaveQuestion}
          data-testid="question-author-form"
          className="bg-white rounded-3xl border border-[#99CAFA] p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
            <h3 className="text-base font-display font-bold text-[#0F2942]">
              {editingId ? `Edit Question ${editingId}` : 'Author New Multi-Type Question'}
            </h3>
            <span className="text-xs font-bold text-[#158EE3] tabular-nums">
              Computed Psychometric Score: {liveDifficulty}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div className="lg:col-span-2">
              <label htmlFor="qb-subj" className="block font-semibold text-[#476481] mb-1">
                Subject Category
              </label>
              <select
                id="qb-subj"
                value={formSubjectId}
                onChange={(e) => {
                  const sid = e.target.value;
                  setFormSubjectId(sid);
                  const subj = subjects.find((s) => s.id === sid);
                  if (subj) setFormCognitiveDomain(subj.cognitiveDomain);
                  const t = topics.find((tp) => tp.subjectId === sid);
                  setFormTopicId(t?.id || '');
                  const st = t ? subtopics.find((x) => x.topicId === t.id) : undefined;
                  setFormSubtopicId(st?.id || '');
                }}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="qb-top" className="block font-semibold text-[#476481] mb-1">
                Topic
              </label>
              <select
                id="qb-top"
                value={formTopicId}
                onChange={(e) => {
                  setFormTopicId(e.target.value);
                  const st = subtopics.find((x) => x.topicId === e.target.value);
                  setFormSubtopicId(st?.id || '');
                }}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-medium"
              >
                {formTopics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="qb-subtop" className="block font-semibold text-[#476481] mb-1">
                Subtopic
              </label>
              <select
                id="qb-subtop"
                value={formSubtopicId}
                onChange={(e) => setFormSubtopicId(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-medium"
              >
                {formSubtopics.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="qb-type" className="block font-semibold text-[#476481] mb-1">
                Question Type
              </label>
              <select
                id="qb-type"
                value={formType}
                onChange={(e) => setFormType(e.target.value as QuestionType)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold"
              >
                <option value="mcq">Multiple Choice (MCQ)</option>
                <option value="numerical">Numerical Response</option>
                <option value="true_false">True / False</option>
                <option value="short_answer">Short Answer</option>
              </select>
            </div>
            <div>
              <label htmlFor="qb-grade" className="block font-semibold text-[#476481] mb-1">
                Grade &amp; Marks
              </label>
              <div className="flex gap-1.5">
                <select
                  id="qb-grade"
                  value={formGrade}
                  onChange={(e) => setFormGrade(e.target.value)}
                  className="flex-1 px-2 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                >
                  <option value="Grade 5">Grade 5</option>
                  <option value="Grade 4">Grade 4</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={20}
                  aria-label="Default marks"
                  value={formMarks}
                  onChange={(e) => setFormMarks(Math.max(1, Number(e.target.value)))}
                  className="w-14 px-2 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-center tabular-nums font-bold"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <label htmlFor="qb-si" className="block font-semibold text-[#476481] mb-1">
                Question Prompt (Sinhala / Primary)
              </label>
              <textarea
                id="qb-si"
                rows={2}
                required
                value={formQuestionSi}
                onChange={(e) => setFormQuestionSi(e.target.value)}
                placeholder="උදා: රූපයේ දැක්වෙන ත්‍රිකෝණයේ වටප්‍රමාණය කීයද?"
                className="w-full px-3.5 py-2 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="qb-en" className="block font-semibold text-[#476481] mb-1">
                English Translation / Subtitle
              </label>
              <textarea
                id="qb-en"
                rows={2}
                value={formQuestionEn}
                onChange={(e) => setFormQuestionEn(e.target.value)}
                placeholder="Optional English translation"
                className="w-full px-3.5 py-2 text-sm bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>
          </div>

          {/* Type-specific answer configuration */}
          {formType === 'mcq' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Option A', val: formOptA, set: setFormOptA, idx: 0 },
                { label: 'Option B', val: formOptB, set: setFormOptB, idx: 1 },
                { label: 'Option C', val: formOptC, set: setFormOptC, idx: 2 },
                { label: 'Option D', val: formOptD, set: setFormOptD, idx: 3 },
              ].map((o) => (
                <div key={o.label} className="p-2.5 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-[#476481]">{o.label}</span>
                    <label className="flex items-center gap-1 text-[11px] font-bold text-[#2E7D32] cursor-pointer">
                      <input
                        type="radio"
                        name="qb-correct-opt"
                        checked={formCorrectIndex === o.idx}
                        onChange={() => setFormCorrectIndex(o.idx)}
                        className="accent-[#4CAF50]"
                      />
                      Correct
                    </label>
                  </div>
                  <input
                    type="text"
                    required
                    value={o.val}
                    onChange={(e) => o.set(e.target.value)}
                    placeholder={`Enter ${o.label}`}
                    className="w-full px-2.5 py-1.5 text-sm bg-white border border-[#CBE2FA] rounded-lg"
                  />
                </div>
              ))}
            </div>
          )}

          {formType === 'true_false' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'True Label', val: formOptA || 'True (සත්‍යයි)', set: setFormOptA, idx: 0 },
                { label: 'False Label', val: formOptB || 'False (අසත්‍යයි)', set: setFormOptB, idx: 1 },
              ].map((o) => (
                <div key={o.label} className="p-3 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-center justify-between gap-3">
                  <input
                    type="text"
                    value={o.val}
                    onChange={(e) => o.set(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-sm bg-white border border-[#CBE2FA] rounded-lg"
                  />
                  <label className="flex items-center gap-1.5 text-xs font-bold text-[#2E7D32] cursor-pointer shrink-0">
                    <input
                      type="radio"
                      name="qb-tf-correct"
                      checked={formCorrectIndex === o.idx}
                      onChange={() => setFormCorrectIndex(o.idx)}
                      className="accent-[#4CAF50]"
                    />
                    Correct
                  </label>
                </div>
              ))}
            </div>
          )}

          {(formType === 'numerical' || formType === 'short_answer') && (
            <div className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#CBE2FA] grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="md:col-span-2">
                <label htmlFor="qb-accepted" className="block font-semibold text-[#476481] mb-1">
                  Accepted Answer(s) (comma-separated)
                </label>
                <input
                  id="qb-accepted"
                  type="text"
                  value={formAcceptedText}
                  onChange={(e) => setFormAcceptedText(e.target.value)}
                  required={!formManualReview}
                  placeholder={
                    formType === 'numerical'
                      ? 'e.g. 240, 240.0'
                      : 'e.g. photosynthesis, ප්‍රභාසංශ්ලේෂණය'
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-[#CBE2FA] rounded-xl"
                />
              </div>
              {formType === 'numerical' ? (
                <div>
                  <label htmlFor="qb-tol" className="block font-semibold text-[#476481] mb-1">
                    Numeric Tolerance (±)
                  </label>
                  <input
                    id="qb-tol"
                    type="number"
                    min={0}
                    step={0.01}
                    value={formNumericTolerance}
                    onChange={(e) => setFormNumericTolerance(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
                  />
                </div>
              ) : (
                <div className="flex flex-col justify-center gap-2">
                  <label className="flex items-center gap-2 font-semibold text-[#0F2942] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formManualReview}
                      onChange={(e) => setFormManualReview(e.target.checked)}
                      className="accent-[#158EE3]"
                    />
                    <span>Requires Manual Teacher Marking</span>
                  </label>
                  <input
                    type="text"
                    value={formMarkingNotes}
                    onChange={(e) => setFormMarkingNotes(e.target.value)}
                    placeholder="Rubric note for grader..."
                    className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-lg"
                  />
                </div>
              )}
            </div>
          )}

          {/* Metadata & Hints */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label htmlFor="qb-skill" className="block font-semibold text-[#476481] mb-1">
                Cognitive Skill
              </label>
              <select
                id="qb-skill"
                value={formSkill}
                onChange={(e) => setFormSkill(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="Recall">Recall</option>
                <option value="Comprehension">Comprehension</option>
                <option value="Application">Application</option>
                <option value="Analysis">Analysis</option>
                <option value="Problem Solving">Problem Solving</option>
              </select>
            </div>
            <div>
              <label htmlFor="qb-obj" className="block font-semibold text-[#476481] mb-1">
                Learning Objective
              </label>
              <input
                id="qb-obj"
                type="text"
                value={formObjectives}
                onChange={(e) => setFormObjectives(e.target.value)}
                placeholder="e.g. Divide 2-digit numbers fluently"
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="qb-hint" className="block font-semibold text-[#476481] mb-1">
                Practice Hint (optional)
              </label>
              <input
                id="qb-hint"
                type="text"
                value={formHint}
                onChange={(e) => setFormHint(e.target.value)}
                placeholder="Step-1 hint for guided practice"
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>
          </div>

          {/* Canvas Drawing + Image Attachment */}
          <div className="p-4 rounded-2xl bg-[#F7FBFF] border border-[#DCEBFA] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-[#0F2942] flex items-center gap-1.5">
                <PenTool className="w-3.5 h-3.5 text-[#158EE3]" />
                <span>Diagram Sketchpad or Image Attachment</span>
              </div>
              <div className="flex items-center gap-2">
                {['#158EE3', '#F96A1B', '#0F2942', '#4CAF50'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Pen ${c}`}
                    onClick={() => {
                      setPenColor(c);
                      setIsEraser(false);
                    }}
                    className={`w-4 h-4 rounded-full border-2 ${
                      penColor === c && !isEraser ? 'border-[#0F2942] scale-110' : 'border-white'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setIsEraser((v) => !v)}
                  className={`px-2 py-1 text-[11px] font-semibold rounded-lg border flex items-center gap-1 ${
                    isEraser
                      ? 'bg-[#0F2942] text-white border-[#0F2942]'
                      : 'bg-white text-[#526A84] border-[#CBE2FA]'
                  }`}
                >
                  <Eraser className="w-3 h-3" /> Eraser
                </button>
                <button
                  type="button"
                  onClick={handleClearCanvas}
                  className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-white text-[#526A84] border border-[#CBE2FA]"
                >
                  Clear
                </button>
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-[#158EE3] bg-white border border-[#CBE2FA] rounded-lg cursor-pointer hover:bg-[#EBF5FF]">
                  <Upload className="w-3 h-3" />
                  <span>Upload Image</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
              </div>
            </div>
            <canvas
              ref={canvasRef}
              width={480}
              height={130}
              onMouseDown={(e) => {
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d');
                if (!canvas || !ctx) return;
                const { x, y } = getCanvasCoords(e);
                ctx.beginPath();
                ctx.moveTo(x, y);
                setIsDrawing(true);
                setHasCanvasStrokes(true);
              }}
              onMouseMove={(e) => {
                if (!isDrawing) return;
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d');
                if (!canvas || !ctx) return;
                const { x, y } = getCanvasCoords(e);
                ctx.lineTo(x, y);
                ctx.strokeStyle = isEraser ? '#FFFFFF' : penColor;
                ctx.lineWidth = isEraser ? 16 : 3;
                ctx.lineCap = 'round';
                ctx.stroke();
              }}
              onMouseUp={() => setIsDrawing(false)}
              onMouseLeave={() => setIsDrawing(false)}
              className="w-full h-28 bg-white rounded-xl border border-[#CBE2FA] cursor-crosshair"
            />
            {uploadedImageUrl && (
              <div className="flex items-center justify-between text-xs text-[#2E7D32]">
                <span>Image attached.</span>
                <button
                  type="button"
                  onClick={() => setUploadedImageUrl('')}
                  className="text-[#C62828] font-semibold hover:underline"
                >
                  Remove Image
                </button>
              </div>
            )}
          </div>

          {/* Memory Trick & Explanation */}
          <div className="p-4 rounded-2xl bg-[#FFF9EE] border border-[#FDE1B2] grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <label htmlFor="qb-mt-title" className="block font-semibold text-[#7C4D00] mb-1">
                Memory Trick Title
              </label>
              <input
                id="qb-mt-title"
                type="text"
                value={formMemoryTitle}
                onChange={(e) => setFormMemoryTitle(e.target.value)}
                placeholder="e.g. Rainbow Bridge Trick"
                className="w-full px-3 py-2 bg-white border border-[#F5D399] rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="qb-mt-body" className="block font-semibold text-[#7C4D00] mb-1">
                Child Memory Trick Body
              </label>
              <input
                id="qb-mt-body"
                type="text"
                required
                value={formMemoryBody}
                onChange={(e) => setFormMemoryBody(e.target.value)}
                placeholder="Mnemonic story or cue..."
                className="w-full px-3 py-2 bg-white border border-[#F5D399] rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="qb-exp" className="block font-semibold text-[#7C4D00] mb-1">
                Step-by-Step Explanation
              </label>
              <input
                id="qb-exp"
                type="text"
                value={formExplanation}
                onChange={(e) => setFormExplanation(e.target.value)}
                placeholder="Clear worked solution"
                className="w-full px-3 py-2 bg-white border border-[#F5D399] rounded-xl"
              />
            </div>
          </div>

          {/* Psychometrics + Initial State */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs pt-2 border-t border-[#E5F0FA]">
            <div>
              <span className="block font-semibold text-[#476481] mb-1">
                Intel: {formIntelligence}/100
              </span>
              <input
                type="range"
                min={10}
                max={100}
                value={formIntelligence}
                onChange={(e) => setFormIntelligence(Number(e.target.value))}
                className="w-full accent-[#158EE3]"
              />
            </div>
            <div>
              <span className="block font-semibold text-[#476481] mb-1">
                P(Correct): {Math.round(formCorrectProb * 100)}%
              </span>
              <input
                type="range"
                min={0.1}
                max={0.95}
                step={0.05}
                value={formCorrectProb}
                onChange={(e) => setFormCorrectProb(Number(e.target.value))}
                className="w-full accent-[#F96A1B]"
              />
            </div>
            <div>
              <span className="block font-semibold text-[#476481] mb-1">
                Priority: {formPriority}/10
              </span>
              <input
                type="range"
                min={1}
                max={10}
                value={formPriority}
                onChange={(e) => setFormPriority(Number(e.target.value))}
                className="w-full accent-[#F5A623]"
              />
            </div>
            <div>
              <span className="block font-semibold text-[#476481] mb-1">
                Est. Time: {formEstSeconds}s
              </span>
              <input
                type="range"
                min={15}
                max={150}
                value={formEstSeconds}
                onChange={(e) => setFormEstSeconds(Number(e.target.value))}
                className="w-full accent-[#4CAF50]"
              />
            </div>
            <div>
              <label htmlFor="qb-dom" className="block font-semibold text-[#476481] mb-1">
                Domain
              </label>
              <select
                id="qb-dom"
                value={formCognitiveDomain}
                onChange={(e) => setFormCognitiveDomain(e.target.value as CognitiveDomain)}
                className="w-full px-2 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-lg"
              >
                {COGNITIVE_DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E5F0FA]">
            {editingId ? (
              <input
                type="text"
                value={formChangeNote}
                onChange={(e) => setFormChangeNote(e.target.value)}
                placeholder="Revision change note (optional)"
                className="flex-1 min-w-[220px] px-3 py-2 text-xs bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            ) : (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-[#476481]">Save State:</span>
                <select
                  aria-label="Initial question state"
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as QuestionApprovalStatus)}
                  className="px-3 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942]"
                >
                  <option value="DRAFT">Save as DRAFT</option>
                  <option value="PENDING_REVIEW">Submit for Review (PENDING_REVIEW)</option>
                  {role === 'admin' && <option value="APPROVED">Save as APPROVED</option>}
                  {role === 'admin' && <option value="ACTIVE">Publish Immediately (ACTIVE)</option>}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                className="px-4 py-2 text-xs font-semibold text-[#526A84] bg-[#F3F9FF] border border-[#DCEBFA] rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="save-question-submit"
                className="px-5 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
              >
                {editingId ? 'Save Revision' : 'Save Question'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Question Bank List */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-3">
        {loading ? (
          <div className="py-10 text-center text-sm text-[#526A84]">Loading Question Bank...</div>
        ) : questions.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#526A84]">
            No questions match the selected filters inside your authorized subjects.
          </div>
        ) : (
          questions.map((q) => {
            const subjName =
              subjects.find((s) => s.id === q.subjectId)?.nameEn || q.attributes.cognitiveDomain;
            const topicName = topics.find((t) => t.id === q.topicId)?.nameEn || '';
            const qStatus: QuestionApprovalStatus = q.approvalStatus || 'ACTIVE';
            const qType: QuestionType = q.questionType || 'mcq';
            const isAuthor = !q.authorId || q.authorId === user.id;
            const teacherCanEdit =
              role === 'teacher' &&
              q.source === 'curated' &&
              isAuthor &&
              (qStatus === 'DRAFT' || qStatus === 'REJECTED');
            const canEdit = role === 'admin' ? q.source === 'curated' : teacherCanEdit;

            return (
              <div
                key={q.id}
                data-testid={`qb-row-${q.id}`}
                className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-[260px]">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-[#158EE3]">{q.id}</span>
                      <span className="font-mono text-[11px] text-[#526A84]">v{q.version || 1}</span>
                      <span
                        className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${STATUS_STYLE[qStatus]}`}
                      >
                        {qStatus}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-white border border-[#CBE2FA] text-[11px] font-semibold text-[#0F2942]">
                        {QUESTION_TYPE_LABELS[qType]}
                      </span>
                      <span className="text-[#476481] font-semibold">
                        {subjName}
                        {topicName ? ` · ${topicName}` : ''}
                      </span>
                      <span className="text-[#526A84] tabular-nums">
                        · {q.attributes.difficultyTier} · {q.defaultMarks || 1} mk
                      </span>
                    </div>

                    <div className="text-sm font-semibold text-[#0F2942]">{q.questionSi}</div>
                    {q.questionEn && q.questionEn !== q.questionSi && (
                      <div className="text-xs text-[#526A84]">{q.questionEn}</div>
                    )}

                    {q.rejectionReason && qStatus === 'REJECTED' && (
                      <div className="text-xs text-[#9A2F09] bg-[#FFF2ED] border border-[#FAC5B2] rounded-lg px-2.5 py-1.5">
                        <strong>Rejection note:</strong> {q.rejectionReason}
                      </div>
                    )}

                    {q.stats && (
                      <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] tabular-nums text-[#476481]">
                        <span>
                          Attempts: <strong className="text-[#0F2942]">{q.stats.validAttempts}</strong>
                        </span>
                        <span>
                          Correct: <strong className="text-[#2E7D32]">{q.stats.correctRate}%</strong>
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-[#F96A1B]" />
                          Repeat-Error Students: <strong>{q.stats.repeatedErrorStudentCount}</strong>
                        </span>
                        <span>
                          Median Time: <strong>{Math.round((q.stats.medianResponseMs || 0) / 1000)}s</strong>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Row Actions */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onInspectQuestion(q.id)}
                      className="px-2.5 py-1.5 text-[11px] font-bold text-[#158EE3] bg-white border border-[#CBE2FA] rounded-lg hover:bg-[#EBF5FF] flex items-center gap-1 whitespace-nowrap"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Stats</span>
                    </button>

                    {q.source === 'curated' && (
                      <>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openEditQuestionForm(q)}
                            className="px-2.5 py-1.5 text-[11px] font-bold text-[#0F2942] bg-white border border-[#CBE2FA] rounded-lg hover:bg-[#EBF5FF] flex items-center gap-1 whitespace-nowrap"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDuplicate(q.id)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold text-[#526A84] bg-white border border-[#DCEBFA] rounded-lg hover:text-[#0F2942] flex items-center gap-1 whitespace-nowrap"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Duplicate</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleReviews(q.id)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold text-[#526A84] bg-white border border-[#DCEBFA] rounded-lg hover:text-[#0F2942] flex items-center gap-1 whitespace-nowrap"
                        >
                          <History className="w-3.5 h-3.5" />
                          <span>Log</span>
                        </button>
                      </>
                    )}

                    {/* Lifecycle buttons */}
                    {role === 'teacher' &&
                      q.source === 'curated' &&
                      isAuthor &&
                      (qStatus === 'DRAFT' || qStatus === 'REJECTED') && (
                        <button
                          type="button"
                          onClick={() =>
                            handleTransitionStatus(
                              q.id,
                              'PENDING_REVIEW',
                              'Submitted by subject teacher for administrator approval'
                            )
                          }
                          className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-[#158EE3] rounded-lg hover:bg-[#1176BE] flex items-center gap-1 whitespace-nowrap"
                        >
                          <Send className="w-3 h-3" />
                          <span>Submit Review</span>
                        </button>
                      )}

                    {role === 'admin' &&
                      q.source === 'curated' &&
                      (qStatus === 'DRAFT' || qStatus === 'PENDING_REVIEW' || qStatus === 'APPROVED') && (
                        <button
                          type="button"
                          data-testid={`approve-q-${q.id}`}
                          onClick={() =>
                            handleTransitionStatus(q.id, 'ACTIVE', 'Approved & activated by admin')
                          }
                          className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-[#2E7D32] rounded-lg hover:bg-[#236126] flex items-center gap-1 whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>
                      )}

                    {role === 'admin' &&
                      q.source === 'curated' &&
                      qStatus === 'PENDING_REVIEW' && (
                        <button
                          type="button"
                          onClick={() => {
                            setRejectingId(q.id);
                            setRejectNote('');
                          }}
                          className="px-2.5 py-1.5 text-[11px] font-bold text-[#9A2F09] bg-[#FFF2ED] border border-[#FAC5B2] rounded-lg flex items-center gap-1 whitespace-nowrap"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                      )}

                    {role === 'admin' &&
                      q.source === 'curated' &&
                      (qStatus === 'ACTIVE' || qStatus === 'APPROVED') && (
                        <button
                          type="button"
                          onClick={() => handleTransitionStatus(q.id, 'RETIRED', 'Retired from bank')}
                          className="px-2.5 py-1.5 text-[11px] font-semibold text-[#526A84] bg-white border border-[#DCEBFA] rounded-lg hover:text-[#9A2F09] whitespace-nowrap"
                        >
                          Retire
                        </button>
                      )}

                    {role === 'admin' && q.source === 'curated' && (
                      <button
                        type="button"
                        aria-label={`Delete ${q.id}`}
                        onClick={async () => {
                          await api.deleteQuiz(q.id);
                          loadQuestions();
                          onQuestionsChanged?.();
                        }}
                        className="p-1.5 text-[#C62828] hover:bg-[#FFF2ED] rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Admin Reassign Subject Inline */}
                {role === 'admin' && q.source === 'curated' && subjects.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-[#E5F0FA] text-[11px]">
                    <span className="text-[#526A84]">
                      Author: <strong>{q.authorName || 'System'}</strong>
                      {q.reviewerName ? ` · Reviewer: ${q.reviewerName}` : ''}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#526A84] font-semibold">Move Subject:</span>
                      <select
                        aria-label={`Move subject for ${q.id}`}
                        value={q.subjectId || ''}
                        onChange={(e) => handleReassignSubject(q.id, e.target.value)}
                        className="px-2 py-1 bg-white border border-[#CBE2FA] rounded-lg font-semibold text-[#0F2942]"
                      >
                        {subjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nameEn}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Reject inline input */}
                {rejectingId === q.id && (
                  <div className="p-3 rounded-xl bg-[#FFF2ED] border border-[#FAC5B2] flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="text"
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Enter reason for rejection / revision guidance..."
                      className="flex-1 min-w-[200px] px-3 py-1.5 bg-white border border-[#FAC5B2] rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => handleTransitionStatus(q.id, 'REJECTED', rejectNote)}
                      className="px-3 py-1.5 font-bold text-white bg-[#C62828] rounded-lg"
                    >
                      Confirm Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectingId(null)}
                      className="px-2.5 py-1.5 text-[#526A84] bg-white rounded-lg border border-[#DCEBFA]"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Expandable Review Audit Trail */}
                {expandedReviewQId === q.id && (
                  <div className="p-3 rounded-xl bg-white border border-[#CBE2FA] space-y-1.5 text-xs">
                    <div className="font-bold text-[#0F2942]">Question Review &amp; Lifecycle Log</div>
                    {reviewHistory.length === 0 ? (
                      <div className="text-[#526A84]">No lifecycle review logs recorded yet.</div>
                    ) : (
                      reviewHistory.map((rev) => (
                        <div key={rev.id} className="flex flex-wrap justify-between gap-2 text-[11px] text-[#476481] border-t border-[#F0F6FD] pt-1">
                          <span>
                            <strong>{rev.actorName}</strong> ({rev.actorRole}) · {rev.actionType} ({rev.fromStatus || 'NEW'} → {rev.toStatus})
                            {rev.notes ? ` — ${rev.notes}` : ''}
                          </span>
                          <span className="font-mono text-[#7C97B2]">{rev.createdAt.slice(0, 16).replace('T', ' ')}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between pt-2 text-xs text-[#526A84]">
          <span>Page {page}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 bg-[#F8FBFF] border border-[#DCEBFA] rounded-lg font-semibold disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={questions.length < 20}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 bg-[#F8FBFF] border border-[#DCEBFA] rounded-lg font-semibold disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-[#0F2942]/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleBulkImportSubmit}
            data-testid="bulk-import-modal"
            className="bg-white rounded-3xl border border-[#DCEBFA] max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#E5F0FA]">
              <h3 className="text-base font-display font-bold text-[#0F2942]">
                Bulk Question Import (CSV / JSON)
              </h3>
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="p-1.5 text-[#526A84] hover:text-[#0F2942]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label htmlFor="bi-format" className="block font-semibold text-[#476481] mb-1">
                  Format
                </label>
                <select
                  id="bi-format"
                  value={bulkFormat}
                  onChange={(e) => {
                    const f = e.target.value as 'csv' | 'json';
                    setBulkFormat(f);
                    setBulkContent(f === 'csv' ? SAMPLE_CSV : SAMPLE_JSON);
                  }}
                  className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold"
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON Array</option>
                </select>
              </div>
              <div>
                <label htmlFor="bi-subj" className="block font-semibold text-[#476481] mb-1">
                  Fallback Subject
                </label>
                <select
                  id="bi-subj"
                  value={bulkDefaultSubject}
                  onChange={(e) => setBulkDefaultSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="bi-state" className="block font-semibold text-[#476481] mb-1">
                  Initial Workflow State
                </label>
                <select
                  id="bi-state"
                  value={bulkInitialStatus}
                  onChange={(e) => setBulkInitialStatus(e.target.value as QuestionApprovalStatus)}
                  className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold"
                >
                  <option value="DRAFT">DRAFT</option>
                  <option value="PENDING_REVIEW">PENDING_REVIEW</option>
                  {role === 'admin' && <option value="ACTIVE">ACTIVE (Approved)</option>}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl font-semibold text-[#158EE3] cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Load .csv / .json File</span>
                <input type="file" accept=".csv,.json,text/csv,application/json" onChange={handleBulkFileLoad} className="hidden" />
              </label>
              <button
                type="button"
                onClick={() => setBulkContent(bulkFormat === 'csv' ? SAMPLE_CSV : SAMPLE_JSON)}
                className="text-xs font-semibold text-[#158EE3] hover:underline"
              >
                Load Sample Template
              </button>
            </div>

            <textarea
              rows={8}
              value={bulkContent}
              onChange={(e) => setBulkContent(e.target.value)}
              className="w-full p-3 font-mono text-xs bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
            />

            {bulkResult && (
              <div className="p-3 rounded-xl bg-[#F3F9FF] border border-[#CBE2FA] text-xs space-y-1.5">
                <div className="font-bold text-[#0F2942]">
                  Imported: <span className="text-[#2E7D32]">{bulkResult.importedCount}</span> · Row Errors:{' '}
                  <span className="text-[#C62828]">{bulkResult.errors.length}</span>
                </div>
                {bulkResult.errors.map((err, i) => (
                  <div key={i} className="text-[#9A2F09]">
                    Row {err.rowNumber}: {err.error}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="px-4 py-2 text-xs font-semibold text-[#526A84] bg-[#F3F9FF] rounded-xl"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={bulkBusy}
                data-testid="submit-bulk-import"
                className="px-5 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl disabled:opacity-50"
              >
                {bulkBusy ? 'Importing...' : 'Run Scoped Bulk Import'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
