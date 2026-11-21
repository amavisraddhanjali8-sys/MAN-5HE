import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  api,
  type EnrichedInterventionCase,
  type InterventionCaseDetailResponse,
} from '../lib/api';
import type {
  InterventionStatus,
  InterventionTemplate,
  SubjectCategory,
  TopicNode,
} from '../lib/types';

interface InterventionWorkspaceProps {
  subjects: SubjectCategory[];
  topics: TopicNode[];
  initialCaseId?: string | null;
  onInspectQuestion?: (questionId: string) => void;
}

const STATUS_FILTERS: (InterventionStatus | 'All')[] = [
  'All',
  'OPEN',
  'UNDER_REVIEW',
  'INTERVENTION_ASSIGNED',
  'MONITORING',
  'RESOLVED',
  'DISMISSED',
];

function statusStyle(status: InterventionStatus) {
  switch (status) {
    case 'OPEN':
      return { bg: 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]', label: 'OPEN' };
    case 'UNDER_REVIEW':
      return { bg: 'bg-[#FFF9EE] border-[#FAD49B] text-[#7A4400]', label: 'UNDER REVIEW' };
    case 'INTERVENTION_ASSIGNED':
      return { bg: 'bg-[#EBF5FF] border-[#B9DCF9] text-[#0E4F80]', label: 'ASSIGNED' };
    case 'MONITORING':
      return { bg: 'bg-[#F3F9FF] border-[#99CAFA] text-[#158EE3]', label: 'MONITORING' };
    case 'RESOLVED':
      return { bg: 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]', label: 'RESOLVED' };
    case 'DISMISSED':
      return { bg: 'bg-[#F1F5F9] border-[#CBD5E1] text-[#475569]', label: 'DISMISSED' };
  }
}

export function InterventionWorkspace({
  subjects,
  topics,
  initialCaseId,
  onInspectQuestion,
}: InterventionWorkspaceProps) {
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [subjectFilter, setSubjectFilter] = useState<string>('All');
  const [cases, setCases] = useState<EnrichedInterventionCase[]>([]);
  const [templates, setTemplates] = useState<InterventionTemplate[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(initialCaseId || null);
  const [detail, setDetail] = useState<InterventionCaseDetailResponse | null>(null);

  // Action Form State
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [instructionTitle, setInstructionTitle] = useState('');
  const [instructionBody, setInstructionBody] = useState('');
  const [recommendedTopicId, setRecommendedTopicId] = useState('');
  const [actionNotes, setActionNotes] = useState('');
  const [dismissalReason, setDismissalReason] = useState('');
  const [notifyGuardian, setNotifyGuardian] = useState(true);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadCases = async () => {
    setLoading(true);
    try {
      const res = await api.getInterventions({
        status: statusFilter,
        subjectId: subjectFilter,
      });
      setCases(res.cases);
      setTemplates(res.templates);
      if (initialCaseId && res.cases.some((c) => c.id === initialCaseId)) {
        setSelectedCaseId(initialCaseId);
      } else if (!selectedCaseId && res.cases.length > 0) {
        setSelectedCaseId(res.cases[0].id);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCases();
  }, [statusFilter, subjectFilter]);

  useEffect(() => {
    if (initialCaseId) setSelectedCaseId(initialCaseId);
  }, [initialCaseId]);

  const loadCaseDetail = async (id: string) => {
    setErrorMsg(null);
    try {
      const res = await api.getInterventionDetail(id);
      setDetail(res);
      setInstructionTitle(res.caseDetail.instructionTitle || '');
      setInstructionBody(res.caseDetail.instructionBody || '');
      setRecommendedTopicId(
        res.caseDetail.recommendedPracticeTopicId || res.caseDetail.topicId || ''
      );
      setSelectedTemplateId(res.caseDetail.templateId || '');
      setDismissalReason('');
      setActionNotes('');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  useEffect(() => {
    if (selectedCaseId) {
      loadCaseDetail(selectedCaseId);
    } else {
      setDetail(null);
    }
  }, [selectedCaseId]);

  const handleTemplateSelect = (tplId: string) => {
    setSelectedTemplateId(tplId);
    const tpl = templates.find((t) => t.id === tplId);
    if (tpl) {
      setInstructionTitle(tpl.title);
      setInstructionBody(tpl.instructionTemplate);
    }
  };

  const handleTransition = async (nextStatus: InterventionStatus) => {
    if (!selectedCaseId) return;
    setSubmitting(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const updated = await api.applyInterventionAction(selectedCaseId, {
        nextStatus,
        templateId: selectedTemplateId || null,
        instructionTitle,
        instructionBody,
        recommendedPracticeTopicId: recommendedTopicId || null,
        notes: actionNotes,
        dismissalReason: nextStatus === 'DISMISSED' ? dismissalReason || actionNotes : undefined,
        resolutionNotes: nextStatus === 'RESOLVED' ? actionNotes || 'Confirmed student improvement.' : undefined,
        notifyGuardian,
      });
      setDetail(updated);
      setFeedback(`Case ${selectedCaseId} updated to ${nextStatus}.`);
      await loadCases();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const subjectTopics = detail
    ? topics.filter((t) => t.subjectId === detail.caseDetail.subjectId)
    : topics;

  return (
    <div className="space-y-5">
      {/* Filter Bar */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-display font-extrabold text-[#0F2942]">
            Repeated-Error Detection & Student Intervention Console
          </h2>
          <p className="text-xs text-[#526A84] mt-0.5">
            Cases trigger when repeated wrong attempts reach threshold. Single correct answers never auto-close cases—sustained improvement requires teacher confirmation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Filter interventions by subject"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="px-3 py-2 text-xs font-semibold text-[#0F2942] bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
          >
            <option value="All">All Authorized Subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameEn}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter interventions by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs font-semibold text-[#0F2942] bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
          >
            {STATUS_FILTERS.map((st) => (
              <option key={st} value={st}>
                {st === 'All' ? 'All Case Statuses' : st}
              </option>
            ))}
          </select>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-sm text-[#9A2F09] flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {feedback && (
        <div className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] text-sm font-medium text-[#1E6323]">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Queue */}
        <div className="xl:col-span-5 bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E5F0FA]">
            <span className="text-sm font-display font-bold text-[#0F2942]">
              Active & Historical Cases ({cases.length})
            </span>
          </div>

          {loading ? (
            <div className="py-10 text-center text-xs text-[#526A84]">Loading cases...</div>
          ) : cases.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#526A84]">
              No repeated-error intervention cases match the selected filters.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
              {cases.map((c) => {
                const st = statusStyle(c.status);
                const selected = c.id === selectedCaseId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    data-testid={`case-card-${c.id}`}
                    onClick={() => setSelectedCaseId(c.id)}
                    className={`w-full text-left p-4 rounded-2xl border transition-colors space-y-1.5 ${
                      selected
                        ? 'bg-[#EBF5FF] border-[#158EE3]'
                        : 'bg-[#F8FBFF] border-[#DCEBFA] hover:bg-[#EFF7FF]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono font-bold text-[#0F2942]">
                        {c.id} · {c.questionId}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md border font-bold ${st.bg}`}>
                        {st.label}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-[#0F2942]">
                      {c.studentName}{' '}
                      <span className="text-xs font-normal text-[#526A84]">({c.studentCode})</span>
                    </div>
                    <div className="text-xs text-[#476481] line-clamp-2">{c.questionSi}</div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1">
                      <span className="text-[#526A84]">{c.subjectName}</span>
                      <span className="font-bold text-[#C62828] tabular-nums">
                        {c.incorrectCount} Wrong Attempts
                      </span>
                    </div>
                    {c.readyForTeacherReview && (
                      <div className="text-[11px] font-bold text-[#1E6323] flex items-center gap-1 pt-0.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Sustained follow-up correct — Ready for teacher review</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Case Detail & Intervention Assignment */}
        <div className="xl:col-span-7 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-5">
          {!detail ? (
            <div className="py-16 text-center text-sm text-[#526A84]">
              Select a repeated-error case from the left queue to inspect attempts and assign learning guidance.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#E5F0FA]">
                <div>
                  <div className="text-xs font-mono font-bold text-[#158EE3]">
                    {detail.caseDetail.id} · {detail.caseDetail.subjectName} · {detail.caseDetail.topicName}
                  </div>
                  <h3 className="text-lg font-display font-extrabold text-[#0F2942] mt-0.5">
                    {detail.caseDetail.studentName} ({detail.caseDetail.studentCode})
                  </h3>
                  <div className="text-xs text-[#526A84] mt-0.5 tabular-nums">
                    Wrong count: <strong className="text-[#C62828]">{detail.caseDetail.incorrectCount}</strong> ·
                    Follow-up streak:{' '}
                    <strong className="text-[#2E7D32]">
                      {detail.caseDetail.consecutiveCorrectAfterCase}
                    </strong>{' '}
                    · Reopens: {detail.caseDetail.reopenCount}
                  </div>
                </div>
                {onInspectQuestion && (
                  <button
                    type="button"
                    onClick={() => onInspectQuestion(detail.caseDetail.questionId)}
                    className="px-3.5 py-2 text-xs font-bold text-[#158EE3] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl hover:bg-[#E5F2FF] flex items-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Inspect Question {detail.caseDetail.questionId}</span>
                  </button>
                )}
              </div>

              {/* Suggested Teaching Support (Explicitly marked awaiting review) */}
              {detail.caseDetail.suggestedSupportNote && (
                <div className="p-4 rounded-2xl bg-[#FFF9EE] border border-[#FDE1B2] space-y-1">
                  <div className="text-xs font-bold text-[#7C4D00] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[#F5A623]" />
                    <span>Automated Misconception Cue (Requires Teacher Review)</span>
                  </div>
                  <p className="text-xs text-[#613C00] leading-relaxed">
                    {detail.caseDetail.suggestedSupportNote}
                  </p>
                </div>
              )}

              {/* Chronological Attempt Sequence */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-[#0F2942]">
                  Chronological Attempt Timeline on {detail.caseDetail.questionId}
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.studentAttemptsOnQuestion.map((att) => (
                    <div
                      key={att.id}
                      className={`px-3 py-1.5 rounded-xl border text-[11px] tabular-nums flex items-center gap-1.5 ${
                        att.isCorrect === true
                          ? 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                          : att.isCorrect === false
                          ? 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                          : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#526A84]'
                      }`}
                    >
                      {att.isCorrect === true ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : att.isCorrect === false ? (
                        <XCircle className="w-3 h-3" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                      <span>
                        #{att.attemptSequenceNumber || 'skip'} · {att.contextMode} ·{' '}
                        {Math.round(att.responseDurationMs / 1000)}s
                        {att.hintUsed ? ' · hint' : ''}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-[#526A84]">
                  {detail.improvement.summaryNote}
                </div>
              </div>

              {/* Instruction Assignment & Workflow Form */}
              <div className="p-4 rounded-2xl bg-[#F7FBFF] border border-[#DCEBFA] space-y-3">
                <div className="text-xs font-bold text-[#0F2942] flex items-center gap-1.5">
                  <ClipboardList className="w-4 h-4 text-[#158EE3]" />
                  <span>Assign Learning Instructions & Follow-Up Practice</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label htmlFor="int-tpl" className="block font-semibold text-[#476481] mb-1">
                      Reusable Template
                    </label>
                    <select
                      id="int-tpl"
                      value={selectedTemplateId}
                      onChange={(e) => handleTemplateSelect(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                    >
                      <option value="">Custom Teacher Instruction...</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="int-topic" className="block font-semibold text-[#476481] mb-1">
                      Targeted Practice Topic / Prerequisite
                    </label>
                    <select
                      id="int-topic"
                      value={recommendedTopicId}
                      onChange={(e) => setRecommendedTopicId(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                    >
                      {subjectTopics.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="int-title" className="block text-xs font-semibold text-[#476481] mb-1">
                    Instruction Title (Shown to Student & Guardian)
                  </label>
                  <input
                    id="int-title"
                    type="text"
                    value={instructionTitle}
                    onChange={(e) => setInstructionTitle(e.target.value)}
                    placeholder="e.g. Queue Overlap Stick-Figure Recap"
                    className="w-full px-3 py-2 text-xs bg-white border border-[#CBE2FA] rounded-xl"
                  />
                </div>

                <div>
                  <label htmlFor="int-body" className="block text-xs font-semibold text-[#476481] mb-1">
                    Clear, Supportive Guidance for Student
                  </label>
                  <textarea
                    id="int-body"
                    rows={3}
                    value={instructionBody}
                    onChange={(e) => setInstructionBody(e.target.value)}
                    placeholder="Write encouraging step-by-step guidance for the student..."
                    className="w-full px-3 py-2 text-xs bg-white border border-[#CBE2FA] rounded-xl"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label htmlFor="int-notes" className="block font-semibold text-[#476481] mb-1">
                      Teacher Review / Resolution Notes
                    </label>
                    <input
                      id="int-notes"
                      type="text"
                      value={actionNotes}
                      onChange={(e) => setActionNotes(e.target.value)}
                      placeholder="Optional audit note"
                      className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                    />
                  </div>
                  <div>
                    <label htmlFor="int-dismiss" className="block font-semibold text-[#476481] mb-1">
                      Dismissal Reason (If Dismissing)
                    </label>
                    <input
                      id="int-dismiss"
                      type="text"
                      value={dismissalReason}
                      onChange={(e) => setDismissalReason(e.target.value)}
                      placeholder="e.g. Misclick verified during class"
                      className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-[#0F2942] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyGuardian}
                    onChange={(e) => setNotifyGuardian(e.target.checked)}
                    className="accent-[#158EE3]"
                  />
                  <span>
                    Notify verified &amp; consented guardian (
                    {detail.caseDetail.guardianContactVerified &&
                    detail.caseDetail.guardianConsentGiven
                      ? `${detail.caseDetail.guardianName || 'Guardian'} · Verified`
                      : 'Pending verification/consent — will log skipped_unverified'}
                    )
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {detail.caseDetail.status === 'OPEN' && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleTransition('UNDER_REVIEW')}
                      className="px-3.5 py-2 text-xs font-bold text-[#7A4400] bg-[#FFF9EE] border border-[#FAD49B] rounded-xl hover:bg-[#FEEFD6]"
                    >
                      Mark Under Review
                    </button>
                  )}
                  {(detail.caseDetail.status === 'OPEN' ||
                    detail.caseDetail.status === 'UNDER_REVIEW' ||
                    detail.caseDetail.status === 'MONITORING' ||
                    detail.caseDetail.status === 'INTERVENTION_ASSIGNED') && (
                    <button
                      type="button"
                      data-testid="assign-intervention-btn"
                      disabled={submitting}
                      onClick={() => handleTransition('INTERVENTION_ASSIGNED')}
                      className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Assign Instruction & Practice</span>
                    </button>
                  )}
                  {(detail.caseDetail.status === 'INTERVENTION_ASSIGNED' ||
                    detail.caseDetail.status === 'MONITORING') && (
                    <button
                      type="button"
                      data-testid="resolve-case-btn"
                      disabled={submitting}
                      onClick={() => handleTransition('RESOLVED')}
                      className="px-3.5 py-2 text-xs font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Confirm Resolved</span>
                    </button>
                  )}
                  {detail.caseDetail.status !== 'RESOLVED' &&
                    detail.caseDetail.status !== 'DISMISSED' && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleTransition('DISMISSED')}
                        className="px-3.5 py-2 text-xs font-semibold text-[#475569] bg-white border border-[#CBD5E1] rounded-xl hover:bg-[#F1F5F9]"
                      >
                        Dismiss Case
                      </button>
                    )}
                  {(detail.caseDetail.status === 'RESOLVED' ||
                    detail.caseDetail.status === 'DISMISSED') && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleTransition('OPEN')}
                      className="px-3.5 py-2 text-xs font-bold text-[#C62828] bg-[#FFF2ED] border border-[#FAC5B2] rounded-xl flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reopen Case</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Audit Trail of Intervention Actions */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-[#526A84]">
                  Case Audit Log ({detail.actions.length})
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {detail.actions.map((act) => (
                    <div
                      key={act.id}
                      className="p-2.5 rounded-xl bg-[#F8FBFF] border border-[#E5F0FA] text-[11px] flex items-start justify-between gap-3"
                    >
                      <div>
                        <span className="font-bold text-[#0F2942]">{act.actorName}</span>{' '}
                        <span className="text-[#158EE3] font-semibold">
                          ({act.actionType.replace(/_/g, ' ')})
                        </span>
                        : <span className="text-[#476481]">{act.notes}</span>
                      </div>
                      <span className="text-[#6E849C] shrink-0">
                        {new Date(act.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
