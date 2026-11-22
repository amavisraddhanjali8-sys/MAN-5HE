import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import type {
  AuditDocumentAccessLog,
  AuditDocumentRecord,
  AuditDocumentType,
  ParentContactRecord,
  SafeguardingDecisionStatus,
  SafeguardingReviewRecord,
  WellbeingCaseDetail,
  WellbeingCaseRecord,
  WellbeingCaseStatus,
} from '../lib/types';

interface WellbeingCaseConsoleProps {
  role: 'admin' | 'teacher';
  user: AuthUser;
  teachers?: AuthUser[];
  students?: AuthUser[];
}

const CASE_STATUSES: WellbeingCaseStatus[] = [
  'DETECTED',
  'PENDING_REVIEW',
  'UNDER_REVIEW',
  'PARENT_CONTACTED',
  'FOLLOW_UP',
  'RESOLVED',
  'DISMISSED',
  'REOPENED',
  'REFERRED_SAFEGUARDING',
];

export function WellbeingCaseConsole({
  role,
  user,
  teachers = [],
  students = [],
}: WellbeingCaseConsoleProps) {
  const isSafeguardingLead = role === 'admin' || Boolean(user.safeguardingDesignated);

  const [consoleTab, setConsoleTab] = useState<'cases' | 'safeguarding' | 'audit'>('cases');
  const [cases, setCases] = useState<WellbeingCaseRecord[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseDetail, setCaseDetail] = useState<WellbeingCaseDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Case Transition State
  const [nextStatus, setNextStatus] = useState<WellbeingCaseStatus>('UNDER_REVIEW');
  const [factualObservations, setFactualObservations] = useState('');
  const [staffInterpretation, setStaffInterpretation] = useState('');
  const [limitationsNoted, setLimitationsNoted] = useState(
    'Online browser interaction measurements indicate screen activity only and cannot measure offline paper study or tiredness directly.'
  );
  const [dismissalReason, setDismissalReason] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [assigneeDraft, setAssigneeDraft] = useState('');

  // Structured Parent Contact Note State
  const [contactMethod, setContactMethod] =
    useState<ParentContactRecord['contactMethod']>('phone');
  const [contactOutcome, setContactOutcome] =
    useState<ParentContactRecord['contactOutcome']>('connected');
  const [contactFacts, setContactFacts] = useState('');
  const [contactQuotes, setContactQuotes] = useState('');
  const [contactOpinions, setContactOpinions] = useState('');
  const [contactGuidance, setContactGuidance] = useState('');
  const [contactParentResp, setContactParentResp] = useState('');
  const [contactAgreed, setContactAgreed] = useState('');
  const [contactFollowupDate, setContactFollowupDate] = useState('');
  const [finalizeContactNow, setFinalizeContactNow] = useState(true);

  // Amendment Modal/Inline Draft
  const [amendingNoteId, setAmendingNoteId] = useState<string | null>(null);
  const [amendReason, setAmendReason] = useState('');
  const [amendFacts, setAmendFacts] = useState('');
  const [amendQuotes, setAmendQuotes] = useState('');
  const [amendOpinions, setAmendOpinions] = useState('');
  const [amendGuidance, setAmendGuidance] = useState('');

  // Follow-up Action Draft
  const [followupTitle, setFollowupTitle] = useState('');
  const [followupDesc, setFollowupDesc] = useState('');
  const [followupDueDate, setFollowupDueDate] = useState(
    () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  );

  // Safeguarding Reviews State
  const [safeguardingReviews, setSafeguardingReviews] = useState<SafeguardingReviewRecord[]>([]);
  const [sgCaseId, setSgCaseId] = useState('');
  const [sgConcerns, setSgConcerns] = useState('');
  const [sgUncertainties, setSgUncertainties] = useState(
    'Observed online study-time alerts alone do not establish child harm without holistic family, educator, and wellbeing context.'
  );
  const [sgDecision, setSgDecision] =
    useState<SafeguardingDecisionStatus>('ASSESSMENT_IN_PROGRESS');
  const [sgReferralDraft, setSgReferralDraft] = useState('');
  const [sgRefCode, setSgRefCode] = useState('');

  // Audit Documents & Access Logs State
  const [auditDocs, setAuditDocs] = useState<AuditDocumentRecord[]>([]);
  const [accessLogs, setAccessLogs] = useState<AuditDocumentAccessLog[]>([]);
  const [docStudentId, setDocStudentId] = useState<string>('');
  const [docType, setDocType] = useState<AuditDocumentType>('student_activity_report');
  const [docTitle, setDocTitle] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<AuditDocumentRecord | null>(null);

  const loadCases = async () => {
    setLoading(true);
    try {
      const res = await api.getWellbeingCases({
        status: statusFilter,
        priority: priorityFilter,
      });
      setCases(res.cases);
      if (res.cases.length > 0) {
        const targetId =
          selectedCaseId && res.cases.some((c) => c.id === selectedCaseId)
            ? selectedCaseId
            : res.cases[0].id;
        setSelectedCaseId(targetId);
        if (!sgCaseId) setSgCaseId(targetId);
        if (!docStudentId) setDocStudentId(res.cases[0].studentId);
      } else {
        setSelectedCaseId(null);
        setCaseDetail(null);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadCaseDetail = async (caseId: string) => {
    try {
      const detail = await api.getWellbeingCaseDetail(caseId);
      setCaseDetail(detail);
      setAssigneeDraft(detail.caseRecord.assignedToUserId || '');
      if (!docStudentId) setDocStudentId(detail.caseRecord.studentId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const loadSafeguarding = async () => {
    if (!isSafeguardingLead) return;
    try {
      const res = await api.getSafeguardingReviews();
      setSafeguardingReviews(res.reviews);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const loadAuditDocs = async () => {
    try {
      const [docsRes, logsRes] = await Promise.all([
        api.getAuditDocuments(),
        isSafeguardingLead
          ? api.getAuditDocumentAccessLogs().catch(() => ({ logs: [] as AuditDocumentAccessLog[] }))
          : Promise.resolve({ logs: [] as AuditDocumentAccessLog[] }),
      ]);
      setAuditDocs(docsRes.documents);
      setAccessLogs(logsRes.logs);
      if (docsRes.documents.length > 0 && !selectedDoc) {
        setSelectedDoc(docsRes.documents[0]);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  useEffect(() => {
    loadCases();
  }, [statusFilter, priorityFilter]);

  useEffect(() => {
    if (selectedCaseId) {
      loadCaseDetail(selectedCaseId);
    }
  }, [selectedCaseId]);

  useEffect(() => {
    if (consoleTab === 'safeguarding') loadSafeguarding();
    if (consoleTab === 'audit') loadAuditDocs();
  }, [consoleTab]);

  const handleAssignCase = async () => {
    if (!selectedCaseId || !assigneeDraft) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await api.assignWellbeingCase(selectedCaseId, assigneeDraft, 'Assigned from Wellbeing Console');
      setStatusMsg('Case assigned and audit recorded.');
      await loadCases();
      await loadCaseDetail(selectedCaseId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleTransitionCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await api.transitionWellbeingCase(selectedCaseId, {
        nextStatus,
        factualObservations: factualObservations.trim() || undefined,
        staffInterpretation: staffInterpretation.trim() || undefined,
        limitationsNoted: limitationsNoted.trim() || undefined,
        dismissalReason: nextStatus === 'DISMISSED' ? dismissalReason.trim() : undefined,
        resolutionSummary: resolutionSummary.trim() || undefined,
      });
      setStatusMsg(`Case status updated to ${nextStatus}.`);
      setFactualObservations('');
      setStaffInterpretation('');
      setDismissalReason('');
      await loadCases();
      await loadCaseDetail(selectedCaseId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateContactRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const res = await api.createParentContactRecord(selectedCaseId, {
        contactMethod,
        contactOutcome,
        factualObservations: contactFacts.trim(),
        directQuotations: contactQuotes.trim(),
        staffOpinions: contactOpinions.trim(),
        guidanceProvided: contactGuidance.trim(),
        parentResponse: contactParentResp.trim(),
        agreedActions: contactAgreed.trim(),
        followUpDate: contactFollowupDate || null,
        finalizeImmediately: finalizeContactNow,
      });
      setStatusMsg(
        res.contact.isFinalized
          ? 'Parent contact record finalized (immutable audit entry saved).'
          : 'Draft parent contact note saved.'
      );
      setContactFacts('');
      setContactQuotes('');
      setContactOpinions('');
      setContactGuidance('');
      setContactParentResp('');
      setContactAgreed('');
      await loadCaseDetail(selectedCaseId);
      await loadCases();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleFinalizeContact = async (noteId: string) => {
    if (!selectedCaseId) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await api.finalizeParentContactRecord(noteId);
      setStatusMsg('Contact note finalized. Any future edits must be logged as versioned amendments.');
      await loadCaseDetail(selectedCaseId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitAmendment = async (e: React.FormEvent, noteId: string) => {
    e.preventDefault();
    if (!selectedCaseId) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await api.amendParentContactRecord(noteId, {
        amendmentReason: amendReason.trim(),
        factualObservations: amendFacts.trim(),
        directQuotations: amendQuotes.trim(),
        staffOpinions: amendOpinions.trim(),
        guidanceProvided: amendGuidance.trim(),
      });
      setStatusMsg(`Created immutable amendment v${res.contact.versionNumber}.`);
      setAmendingNoteId(null);
      setAmendReason('');
      await loadCaseDetail(selectedCaseId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId || !followupTitle.trim()) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await api.addWellbeingFollowupAction(selectedCaseId, {
        title: followupTitle.trim(),
        description: followupDesc.trim(),
        dueDate: followupDueDate,
      });
      setFollowupTitle('');
      setFollowupDesc('');
      setStatusMsg('Follow-up action added.');
      await loadCaseDetail(selectedCaseId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSafeguardingReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sgCaseId) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const res = await api.saveSafeguardingReview(sgCaseId, {
        concernsSummary: sgConcerns.trim(),
        uncertaintiesAndLimitations: sgUncertainties.trim(),
        decision: sgDecision,
        referralRecommended: sgDecision === 'DRAFT_REFERRAL_PREPARED',
        referralDraftText: sgReferralDraft.trim(),
      });
      setStatusMsg(`Safeguarding review ${res.review.id} saved (${res.review.decision}).`);
      await loadSafeguarding();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleApproveSafeguarding = async (
    reviewId: string,
    decision:
      | 'APPROVED_FOR_REFERRAL'
      | 'REFERRED_TO_AUTHORITY'
      | 'NOT_REFERRED_NO_RISK'
      | 'MONITORING_WITH_SUPPORT'
  ) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const res = await api.approveSafeguardingReview(reviewId, {
        decision,
        externalAuthorityRef: sgRefCode.trim() || undefined,
      });
      setStatusMsg(`Human safeguarding approval recorded: ${res.review.decision}.`);
      await loadSafeguarding();
      await loadCases();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateAuditDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetStudent = docStudentId || caseDetail?.caseRecord.studentId || students[0]?.id;
    if (!targetStudent) {
      setErrorMsg('Select a student or open a case first to generate an audit document.');
      return;
    }
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const res = await api.generateAuditDocument({
        documentType: docType,
        studentId: targetStudent,
        caseId: selectedCaseId,
        title: docTitle.trim() || undefined,
      });
      setSelectedDoc(res.document);
      setDocTitle('');
      setStatusMsg(
        `Generated audit document ${res.document.reportCode} (v${res.document.versionNumber}).`
      );
      await loadAuditDocs();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const studentChoices: { id: string; name: string }[] = [];
  const seenStud = new Set<string>();
  for (const s of students) {
    if (!seenStud.has(s.id)) {
      seenStud.add(s.id);
      studentChoices.push({ id: s.id, name: s.name });
    }
  }
  for (const c of cases) {
    if (!seenStud.has(c.studentId)) {
      seenStud.add(c.studentId);
      studentChoices.push({ id: c.studentId, name: c.studentName });
    }
  }

  return (
    <div className="space-y-5" data-testid="wellbeing-case-console">
      {/* Sub-Header Bar */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold text-[#158EE3]">
            Child Learning Wellbeing, Study-Time Intelligence &amp; Communication Governance
          </div>
          <h2 className="text-lg font-display font-extrabold text-[#0F2942]">
            {role === 'admin'
              ? 'Platform Wellbeing Cases, Safeguarding Escalation & Audit Archive'
              : 'Subject-Scoped Wellbeing Reviews & Parent Contact Records'}
          </h2>
          <p className="text-xs text-[#526A84]">
            Non-diagnostic workload reviews separating factual observations, direct quotations, staff opinions, and measurement uncertainties.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
          <button
            type="button"
            data-testid="wellbeing-tab-cases"
            onClick={() => setConsoleTab('cases')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 ${
              consoleTab === 'cases' ? 'bg-[#158EE3] text-white' : 'text-[#526A84] hover:text-[#0F2942]'
            }`}
          >
            Cases &amp; Contact Log ({cases.length})
          </button>

          {isSafeguardingLead && (
            <button
              type="button"
              data-testid="wellbeing-tab-safeguarding"
              onClick={() => setConsoleTab('safeguarding')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                consoleTab === 'safeguarding'
                  ? 'bg-[#C62828] text-white'
                  : 'text-[#9A2F09] hover:text-[#0F2942]'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Safeguarding Escalation</span>
            </button>
          )}

          <button
            type="button"
            data-testid="wellbeing-tab-audit"
            onClick={() => setConsoleTab('audit')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              consoleTab === 'audit'
                ? 'bg-[#0F2942] text-white'
                : 'text-[#526A84] hover:text-[#0F2942]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Audit Reports &amp; PDF</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs font-medium text-[#9A2F09] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {statusMsg && (
        <div className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] text-xs font-medium text-[#1E6323] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* TAB 1: CASES & STRUCTURED PARENT CONTACT LOG */}
      {consoleTab === 'cases' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left: Case Queue */}
          <div className="xl:col-span-4 bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E5F0FA]">
              <div className="text-sm font-display font-bold text-[#0F2942]">
                Wellbeing Cases ({cases.length})
              </div>
              <button
                type="button"
                onClick={loadCases}
                className="text-xs font-semibold text-[#158EE3] flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="ALL">All Statuses</option>
                {CASE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="ALL">All Priorities</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            {loading ? (
              <div className="py-8 text-center text-xs text-[#526A84]">Loading wellbeing cases...</div>
            ) : cases.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#526A84]">
                No wellbeing review cases match these filters.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
                {cases.map((c) => {
                  const selected = c.id === selectedCaseId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      data-testid={`wellbeing-case-item-${c.id}`}
                      onClick={() => setSelectedCaseId(c.id)}
                      className={`w-full text-left p-3.5 rounded-2xl border space-y-1.5 transition-colors ${
                        selected
                          ? 'bg-[#EBF5FF] border-[#158EE3]'
                          : 'bg-[#F8FBFF] border-[#DCEBFA] hover:bg-[#F3F9FF]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-bold text-[#158EE3]">{c.id}</span>
                        <span
                          className={`font-bold uppercase text-[10px] ${
                            c.priority === 'urgent' || c.priority === 'high'
                              ? 'text-[#C62828]'
                              : 'text-[#9A5B00]'
                          }`}
                        >
                          {c.priority} · {c.status}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-[#0F2942]">{c.studentName}</div>
                      <div className="text-[11px] text-[#476481] line-clamp-2">{c.title}</div>
                      {c.assignedToName && (
                        <div className="text-[10px] text-[#526A84]">Assigned: {c.assignedToName}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Case Detail, Study-Time Breakdown, Contact Log & Actions */}
          <div className="xl:col-span-8 space-y-5">
            {!caseDetail ? (
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-10 text-center text-sm text-[#526A84]">
                Select a wellbeing case to review study-time intelligence, structured evidence, and parent communication records.
              </div>
            ) : (
              <>
                {/* Case Header & 7-Day Study-Time Breakdown */}
                <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[#E5F0FA]">
                    <div>
                      <div className="text-xs font-bold text-[#158EE3]">
                        {caseDetail.caseRecord.id} · {caseDetail.caseRecord.studentName} (
                        {caseDetail.caseRecord.studentGrade})
                      </div>
                      <h3 className="text-lg font-display font-extrabold text-[#0F2942]">
                        {caseDetail.caseRecord.title}
                      </h3>
                      <p className="text-xs text-[#476481] mt-1">
                        {caseDetail.caseRecord.summaryOfConcern}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-bold text-[#0F2942]">{caseDetail.caseRecord.status}</div>
                      <div className="text-[11px] text-[#526A84] uppercase">
                        Priority: {caseDetail.caseRecord.priority}
                      </div>
                    </div>
                  </div>

                  {/* 7-Day Study Time Separation Table */}
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs tabular-nums">
                    <div className="p-3 rounded-xl bg-[#F3F9FF] border border-[#DCEBFA]">
                      <div className="text-[11px] text-[#526A84]">Scheduled (7d)</div>
                      <div className="text-lg font-extrabold text-[#0F2942]">
                        {caseDetail.recentActivitySummary.weeklyTotals.scheduledMinutes}m
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#EEF9EF] border border-[#C1E8C4]">
                      <div className="text-[11px] text-[#526A84]">Observed Active</div>
                      <div className="text-lg font-extrabold text-[#2E7D32]">
                        {caseDetail.recentActivitySummary.weeklyTotals.activeMinutes}m
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#FFF8EB] border border-[#F3D19C]">
                      <div className="text-[11px] text-[#526A84]">Idle / Unverified</div>
                      <div className="text-lg font-extrabold text-[#9A5B00]">
                        {caseDetail.recentActivitySummary.weeklyTotals.idleMinutes}m
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                      <div className="text-[11px] text-[#526A84]">Background Tab</div>
                      <div className="text-lg font-extrabold text-[#526A84]">
                        {caseDetail.recentActivitySummary.weeklyTotals.backgroundMinutes}m
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                      <div className="text-[11px] text-[#526A84]">Breaks Taken</div>
                      <div className="text-lg font-extrabold text-[#158EE3]">
                        {caseDetail.recentActivitySummary.weeklyTotals.breakMinutes}m
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#FFF2ED] border border-[#FAC5B2]">
                      <div className="text-[11px] text-[#526A84]">Peak Continuous</div>
                      <div className="text-lg font-extrabold text-[#C62828]">
                        {caseDetail.recentActivitySummary.weeklyTotals.maxContinuousSessionMinutes}m
                      </div>
                    </div>
                  </div>

                  {/* Measurement Uncertainty Disclosure */}
                  <div className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#CBE2FA] text-[11px] text-[#476481] space-y-1">
                    <div className="font-bold text-[#0F2942]">
                      Measurement Limitations &amp; Uncertainty Statements
                    </div>
                    {caseDetail.recentActivitySummary.uncertaintyStatements.map((u, idx) => (
                      <div key={idx}>• {u}</div>
                    ))}
                  </div>

                  {/* Evidence Attached */}
                  {caseDetail.evidence.length > 0 && (
                    <div className="space-y-1.5 text-xs">
                      <div className="font-bold text-[#0F2942]">
                        Supporting Evidence ({caseDetail.evidence.length})
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {caseDetail.evidence.map((ev) => (
                          <div
                            key={ev.id}
                            className="p-2.5 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] text-[11px]"
                          >
                            <div className="font-bold text-[#158EE3] uppercase">
                              {ev.evidenceType.replace(/_/g, ' ')} · {ev.referenceId}
                            </div>
                            <div className="text-[#476481] mt-0.5">{ev.summary}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Admin Assignment & Status Transition */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-[#E5F0FA] text-xs">
                    {role === 'admin' && teachers.length > 0 && (
                      <div className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2">
                        <div className="font-bold text-[#0F2942] flex items-center gap-1.5">
                          <UserCheck className="w-3.5 h-3.5 text-[#158EE3]" />
                          <span>Assign Responsible Staff Member</span>
                        </div>
                        <div className="flex gap-2">
                          <select
                            value={assigneeDraft}
                            onChange={(e) => setAssigneeDraft(e.target.value)}
                            className="flex-1 px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
                          >
                            <option value="">Select staff...</option>
                            <option value={user.id}>{user.name} (Admin)</option>
                            {teachers.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({t.userIdCode})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={busy || !assigneeDraft}
                            onClick={handleAssignCase}
                            className="px-3 py-1.5 font-bold text-white bg-[#158EE3] rounded-xl whitespace-nowrap shrink-0"
                          >
                            Assign
                          </button>
                        </div>
                      </div>
                    )}

                    <form
                      onSubmit={handleTransitionCase}
                      className={`p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2 ${
                        role !== 'admin' || teachers.length === 0 ? 'md:col-span-2' : ''
                      }`}
                    >
                      <div className="font-bold text-[#0F2942]">Update Case Workflow Status</div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={nextStatus}
                          onChange={(e) => setNextStatus(e.target.value as WellbeingCaseStatus)}
                          className="px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
                        >
                          {CASE_STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          disabled={busy}
                          data-testid="transition-wellbeing-case-btn"
                          className="px-3 py-1.5 font-bold text-white bg-[#0F2942] hover:bg-[#193B5C] rounded-xl whitespace-nowrap shrink-0"
                        >
                          Apply Transition
                        </button>
                      </div>
                      <input
                        type="text"
                        value={factualObservations}
                        onChange={(e) => setFactualObservations(e.target.value)}
                        placeholder="Factual observation note (optional)"
                        className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
                      />
                      {nextStatus === 'DISMISSED' && (
                        <input
                          type="text"
                          required
                          value={dismissalReason}
                          onChange={(e) => setDismissalReason(e.target.value)}
                          placeholder="Required dismissal reason (e.g. Verified offline break / duplicate)"
                          className="w-full px-2.5 py-1.5 bg-white border border-[#FAC5B2] rounded-xl"
                        />
                      )}
                      {nextStatus === 'RESOLVED' && (
                        <input
                          type="text"
                          value={resolutionSummary}
                          onChange={(e) => setResolutionSummary(e.target.value)}
                          placeholder="Resolution summary"
                          className="w-full px-2.5 py-1.5 bg-white border border-[#B7E1BA] rounded-xl"
                        />
                      )}
                    </form>
                  </div>
                </div>

                {/* Structured Immutable Parent Contact Log */}
                <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[#158EE3]" />
                      <h3 className="text-base font-display font-bold text-[#0F2942]">
                        Parent Communication &amp; Contact Log ({caseDetail.parentContacts.length})
                      </h3>
                    </div>
                    <span className="text-[11px] font-semibold text-[#526A84]">
                      Finalized Notes Are Immutable · Versioned Amendments Only
                    </span>
                  </div>

                  {/* New Contact Note Form */}
                  <form
                    onSubmit={handleCreateContactRecord}
                    className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-3 text-xs"
                  >
                    <div className="font-bold text-[#0F2942]">Record New Parent Contact</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block font-semibold text-[#476481] mb-1">Method</label>
                        <select
                          value={contactMethod}
                          onChange={(e) =>
                            setContactMethod(
                              e.target.value as ParentContactRecord['contactMethod']
                            )
                          }
                          className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
                        >
                          <option value="phone">Phone Call</option>
                          <option value="whatsapp">WhatsApp</option>
                          <option value="email">Email</option>
                          <option value="video_call">Video Call</option>
                          <option value="in_person">In-Person Meeting</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-[#476481] mb-1">Outcome</label>
                        <select
                          value={contactOutcome}
                          onChange={(e) =>
                            setContactOutcome(
                              e.target.value as ParentContactRecord['contactOutcome']
                            )
                          }
                          className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
                        >
                          <option value="connected">Connected &amp; Discussed</option>
                          <option value="scheduled_meeting">Scheduled Follow-Up Meeting</option>
                          <option value="left_message">Left Supportive Message</option>
                          <option value="no_response">No Response Yet</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-[#476481] mb-1">
                          Follow-Up Date
                        </label>
                        <input
                          type="date"
                          value={contactFollowupDate}
                          onChange={(e) => setContactFollowupDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-[#0E4F80] mb-1">
                          1. Factual Observations (Required)
                        </label>
                        <textarea
                          rows={2}
                          required
                          value={contactFacts}
                          onChange={(e) => setContactFacts(e.target.value)}
                          placeholder="Measurable times, session logs, schedule totals..."
                          className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-[#0F2942] mb-1">
                          2. Direct Quotations (Exact parent/student words)
                        </label>
                        <textarea
                          rows={2}
                          value={contactQuotes}
                          onChange={(e) => setContactQuotes(e.target.value)}
                          placeholder='e.g. Parent stated: "We practiced on paper before entering answers"'
                          className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-[#7C4D00] mb-1">
                          3. Staff Opinions (Clearly separated from facts)
                        </label>
                        <textarea
                          rows={2}
                          value={contactOpinions}
                          onChange={(e) => setContactOpinions(e.target.value)}
                          placeholder="Non-diagnostic educational observations & context..."
                          className="w-full px-3 py-2 bg-white border border-[#FDE1B2] rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-[#1E6323] mb-1">
                          4. Supportive Guidance Provided (Required)
                        </label>
                        <textarea
                          rows={2}
                          required
                          value={contactGuidance}
                          onChange={(e) => setContactGuidance(e.target.value)}
                          placeholder="Balanced break plan & spaced review suggestions..."
                          className="w-full px-3 py-2 bg-white border border-[#B7E1BA] rounded-xl"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={contactParentResp}
                        onChange={(e) => setContactParentResp(e.target.value)}
                        placeholder="Parent response summary"
                        className="px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                      />
                      <input
                        type="text"
                        value={contactAgreed}
                        onChange={(e) => setContactAgreed(e.target.value)}
                        placeholder="Agreed next steps / actions"
                        className="px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-[#0F2942]">
                        <input
                          type="checkbox"
                          checked={finalizeContactNow}
                          onChange={(e) => setFinalizeContactNow(e.target.checked)}
                          className="accent-[#158EE3]"
                        />
                        <span>Finalize immediately (locks note; future changes create versioned amendments)</span>
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        data-testid="submit-parent-contact-btn"
                        className="px-4 py-2 font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl whitespace-nowrap shrink-0"
                      >
                        Save Contact Record
                      </button>
                    </div>
                  </form>

                  {/* Historical Contact Records */}
                  <div className="space-y-3">
                    {caseDetail.parentContacts.map((pc) => (
                      <div
                        key={pc.id}
                        data-testid={`parent-contact-note-${pc.id}`}
                        className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-bold text-[#0F2942]">
                            v{pc.versionNumber} · {pc.contactMethod.toUpperCase()} ({pc.contactOutcome}) · By{' '}
                            {pc.staffName}
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-bold text-[11px] ${
                                pc.isFinalized ? 'text-[#2E7D32]' : 'text-[#9A5B00]'
                              }`}
                            >
                              {pc.isFinalized ? 'FINALIZED (IMMUTABLE)' : 'DRAFT'}
                            </span>
                            {!pc.isFinalized ? (
                              <button
                                type="button"
                                onClick={() => handleFinalizeContact(pc.id)}
                                className="px-2.5 py-1 font-bold text-white bg-[#2E7D32] rounded-lg"
                              >
                                Finalize Note
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid={`amend-contact-btn-${pc.id}`}
                                onClick={() => {
                                  setAmendingNoteId(amendingNoteId === pc.id ? null : pc.id);
                                  setAmendFacts(pc.factualObservations);
                                  setAmendQuotes(pc.directQuotations);
                                  setAmendOpinions(pc.staffOpinions);
                                  setAmendGuidance(pc.guidanceProvided);
                                }}
                                className="px-2.5 py-1 font-semibold text-[#158EE3] bg-white border border-[#CBE2FA] rounded-lg"
                              >
                                Amend (New Version)
                              </button>
                            )}
                          </div>
                        </div>

                        {pc.amendmentReason && (
                          <div className="text-[11px] text-[#9A5B00]">
                            <strong>Amendment Reason:</strong> {pc.amendmentReason} (Supersedes{' '}
                            {pc.supersedesNoteId})
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
                          <div className="p-2.5 rounded-xl bg-white border border-[#E5F0FA]">
                            <div className="font-bold text-[#0E4F80]">Factual Observations</div>
                            <div className="text-[#476481] mt-0.5">{pc.factualObservations}</div>
                          </div>
                          <div className="p-2.5 rounded-xl bg-white border border-[#E5F0FA]">
                            <div className="font-bold text-[#0F2942]">Direct Quotations</div>
                            <div className="text-[#476481] mt-0.5">
                              {pc.directQuotations || 'None recorded'}
                            </div>
                          </div>
                          <div className="p-2.5 rounded-xl bg-[#FFFDF7] border border-[#FDE1B2]">
                            <div className="font-bold text-[#7C4D00]">Staff Opinions</div>
                            <div className="text-[#613C00] mt-0.5">
                              {pc.staffOpinions || 'None recorded'}
                            </div>
                          </div>
                        </div>

                        <div className="text-[#0F2942]">
                          <strong>Guidance Provided:</strong> {pc.guidanceProvided}
                          {pc.agreedActions ? ` · Agreed Actions: ${pc.agreedActions}` : ''}
                        </div>

                        {amendingNoteId === pc.id && (
                          <form
                            onSubmit={(e) => handleSubmitAmendment(e, pc.id)}
                            className="p-3 rounded-xl bg-white border border-[#99CAFA] space-y-2"
                          >
                            <div className="font-bold text-[#0F2942]">
                              Create Immutable Versioned Amendment (v{pc.versionNumber + 1})
                            </div>
                            <input
                              type="text"
                              required
                              value={amendReason}
                              onChange={(e) => setAmendReason(e.target.value)}
                              placeholder="Required reason for amendment..."
                              className="w-full px-2.5 py-1.5 border border-[#CBE2FA] rounded-lg"
                            />
                            <textarea
                              rows={2}
                              required
                              value={amendFacts}
                              onChange={(e) => setAmendFacts(e.target.value)}
                              placeholder="Updated factual observations"
                              className="w-full px-2.5 py-1.5 border border-[#CBE2FA] rounded-lg"
                            />
                            <textarea
                              rows={2}
                              required
                              value={amendGuidance}
                              onChange={(e) => setAmendGuidance(e.target.value)}
                              placeholder="Updated guidance provided"
                              className="w-full px-2.5 py-1.5 border border-[#CBE2FA] rounded-lg"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setAmendingNoteId(null)}
                                className="px-3 py-1 font-semibold text-[#526A84]"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                className="px-3 py-1 font-bold text-white bg-[#158EE3] rounded-lg"
                              >
                                Save Amendment v{pc.versionNumber + 1}
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Follow-Up Actions */}
                <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3 text-xs">
                  <div className="flex items-center gap-2 pb-2 border-b border-[#E5F0FA]">
                    <ClipboardCheck className="w-4 h-4 text-[#2E7D32]" />
                    <h3 className="text-base font-display font-bold text-[#0F2942]">
                      Follow-Up Actions ({caseDetail.followUpActions.length})
                    </h3>
                  </div>

                  <form onSubmit={handleAddFollowup} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      value={followupTitle}
                      onChange={(e) => setFollowupTitle(e.target.value)}
                      placeholder="Follow-up action title..."
                      className="sm:col-span-2 px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                    <input
                      type="date"
                      value={followupDueDate}
                      onChange={(e) => setFollowupDueDate(e.target.value)}
                      className="px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                    <button
                      type="submit"
                      disabled={busy || !followupTitle.trim()}
                      className="px-3 py-2 font-bold text-white bg-[#2E7D32] hover:bg-[#236227] rounded-xl flex items-center justify-center gap-1 whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Action
                    </button>
                  </form>

                  <div className="space-y-2">
                    {caseDetail.followUpActions.map((act) => (
                      <div
                        key={act.id}
                        className="p-3 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] flex flex-wrap items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-bold text-[#0F2942]">{act.title}</div>
                          <div className="text-[11px] text-[#526A84]">
                            Owner: {act.ownerName} · Due: {act.dueDate} · Status: {act.status}
                          </div>
                        </div>
                        {act.status === 'PENDING' && (
                          <button
                            type="button"
                            onClick={async () => {
                              await api.updateWellbeingFollowupAction(act.id, 'COMPLETED');
                              if (selectedCaseId) await loadCaseDetail(selectedCaseId);
                            }}
                            className="px-2.5 py-1 font-bold text-[#2E7D32] bg-[#EEF9EF] border border-[#B7E1BA] rounded-lg"
                          >
                            Mark Completed
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: RESTRICTED SAFEGUARDING ESCALATION WORKFLOW */}
      {consoleTab === 'safeguarding' && isSafeguardingLead && (
        <div
          data-testid="safeguarding-review-panel"
          className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start"
        >
          <form
            onSubmit={handleSaveSafeguardingReview}
            className="xl:col-span-5 bg-white rounded-3xl border border-[#FAC5B2] p-6 space-y-3 text-xs"
          >
            <div className="flex items-center gap-2 pb-3 border-b border-[#F5E1DA]">
              <ShieldAlert className="w-4 h-4 text-[#C62828]" />
              <div>
                <h3 className="text-base font-display font-bold text-[#0F2942]">
                  Restricted Safeguarding Assessment
                </h3>
                <p className="text-[11px] text-[#9A2F09]">
                  Strictly restricted to Designated Safeguarding Lead / Admin. Teachers cannot view these records.
                </p>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">Wellbeing Case</label>
              <select
                value={sgCaseId}
                onChange={(e) => setSgCaseId(e.target.value)}
                required
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="">Select case...</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.studentName} ({c.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">
                Factual Concerns Summary (Required)
              </label>
              <textarea
                rows={3}
                required
                value={sgConcerns}
                onChange={(e) => setSgConcerns(e.target.value)}
                placeholder="Factual chronology summary and sustained wellbeing indicators..."
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">
                Mandatory Uncertainties &amp; Limitations
              </label>
              <textarea
                rows={2}
                required
                value={sgUncertainties}
                onChange={(e) => setSgUncertainties(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">
                Review Assessment Stage
              </label>
              <select
                value={sgDecision}
                onChange={(e) => setSgDecision(e.target.value as SafeguardingDecisionStatus)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="ASSESSMENT_IN_PROGRESS">Assessment In Progress</option>
                <option value="MONITORING_WITH_SUPPORT">Monitoring With Parent Support</option>
                <option value="DRAFT_REFERRAL_PREPARED">Draft Referral Prepared (Requires Human Approval)</option>
                <option value="NOT_REFERRED_NO_RISK">Not Referred — Supportive Resolution</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">
                Draft Referral Text (Optional until Referral Prepared)
              </label>
              <textarea
                rows={2}
                value={sgReferralDraft}
                onChange={(e) => setSgReferralDraft(e.target.value)}
                placeholder="Objective timeline and support attempted..."
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              data-testid="save-safeguarding-review-btn"
              className="w-full py-2.5 px-4 font-bold text-white bg-[#C62828] hover:bg-[#A61E1E] rounded-xl"
            >
              Save Restricted Safeguarding Review
            </button>
          </form>

          <div className="xl:col-span-7 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
              <h3 className="text-base font-display font-bold text-[#0F2942]">
                Safeguarding Review Records &amp; Human Approval Gate ({safeguardingReviews.length})
              </h3>
              <input
                type="text"
                value={sgRefCode}
                onChange={(e) => setSgRefCode(e.target.value)}
                placeholder="Authority Ref # (optional)"
                className="px-3 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>

            {safeguardingReviews.length === 0 ? (
              <div className="py-10 text-center text-[#526A84]">
                No safeguarding reviews initiated. Parental disagreement alone is never escalated without sustained safety concern and human review.
              </div>
            ) : (
              <div className="space-y-3">
                {safeguardingReviews.map((rev) => (
                  <div
                    key={rev.id}
                    data-testid={`safeguarding-review-${rev.id}`}
                    className="p-4 rounded-2xl bg-[#FFF8F6] border border-[#FAC5B2] space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-bold text-[#0F2942]">
                        {rev.id} · Case {rev.caseId} · {rev.studentName}
                      </div>
                      <span className="font-bold text-[#9A2F09] uppercase">{rev.decision}</span>
                    </div>
                    <p className="text-[#476481]">{rev.concernsSummary}</p>
                    <div className="p-2.5 rounded-xl bg-white border border-[#FAC5B2] text-[11px] text-[#526A84]">
                      <strong>Uncertainties &amp; Limitations:</strong> {rev.uncertaintiesAndLimitations}
                    </div>
                    {rev.approvedByName ? (
                      <div className="text-[11px] font-bold text-[#2E7D32]">
                        Human Approved By: {rev.approvedByName} ({rev.approvedAt})
                        {rev.externalAuthorityRef ? ` · Ref: ${rev.externalAuthorityRef}` : ''}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          data-testid={`approve-sg-referral-${rev.id}`}
                          onClick={() => handleApproveSafeguarding(rev.id, 'APPROVED_FOR_REFERRAL')}
                          className="px-3 py-1.5 font-bold text-white bg-[#C62828] rounded-xl"
                        >
                          Human Approve Referral
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproveSafeguarding(rev.id, 'MONITORING_WITH_SUPPORT')}
                          className="px-3 py-1.5 font-bold text-[#0E4F80] bg-[#EBF5FF] border border-[#99CAFA] rounded-xl"
                        >
                          Continue Support Monitoring
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproveSafeguarding(rev.id, 'NOT_REFERRED_NO_RISK')}
                          className="px-3 py-1.5 font-bold text-[#2E7D32] bg-[#EEF9EF] border border-[#B7E1BA] rounded-xl"
                        >
                          Close — No Referral Needed
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

      {/* TAB 3: AUDIT DOCUMENTS & BINARY PDF EXPORT */}
      {consoleTab === 'audit' && (
        <div
          data-testid="audit-documents-panel"
          className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start"
        >
          <form
            onSubmit={handleGenerateAuditDoc}
            className="xl:col-span-4 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3 text-xs"
          >
            <div className="font-bold text-base font-display text-[#0F2942] pb-2 border-b border-[#E5F0FA]">
              Generate Formal Audit Report
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">Document Type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as AuditDocumentType)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="student_activity_report">Student Study-Time &amp; Activity Report</option>
                <option value="scheduled_vs_observed_report">
                  Scheduled vs. Observed Active Time Report
                </option>
                <option value="wellbeing_warning_report">
                  Wellbeing Threshold Warnings &amp; Parent Decisions
                </option>
                <option value="parent_contact_followup_report">
                  Parent Contact &amp; Follow-Up Action Record
                </option>
                <option value="internal_case_review_summary">Internal Case Review Summary</option>
                {isSafeguardingLead && (
                  <option value="safeguarding_referral_draft">
                    Safeguarding Referral Draft (Restricted)
                  </option>
                )}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">Student</label>
              <select
                value={docStudentId}
                onChange={(e) => setDocStudentId(e.target.value)}
                required
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="">Select student...</option>
                {studentChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">Custom Title (Optional)</label>
              <input
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="e.g. Monthly Wellbeing Review"
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              data-testid="generate-audit-doc-btn"
              className="w-full py-2.5 px-4 font-bold text-white bg-[#0F2942] hover:bg-[#193B5C] rounded-xl"
            >
              Generate Versioned Audit Report
            </button>
          </form>

          <div className="xl:col-span-8 space-y-4 text-xs">
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3">
              <div className="font-bold text-base font-display text-[#0F2942]">
                Generated Audit Documents ({auditDocs.length})
              </div>
              {auditDocs.length === 0 ? (
                <div className="py-8 text-center text-[#526A84]">
                  No audit reports generated yet. Generate a report to view factual evidence, limitations, and export PDF.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {auditDocs.map((d) => (
                    <div
                      key={d.id}
                      data-testid={`audit-doc-${d.id}`}
                      className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-[#0F2942]">
                          {d.reportCode} v{d.versionNumber} · {d.title}
                        </div>
                        <div className="text-[11px] text-[#526A84]">
                          Student: {d.studentName} · Rule: {d.ruleVersionId} · By {d.preparedByName}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedDoc(d)}
                          className="px-3 py-1.5 font-semibold text-[#0F2942] bg-white border border-[#CBE2FA] rounded-xl"
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          data-testid={`export-audit-pdf-${d.id}`}
                          onClick={() => api.downloadAuditDocumentPdf(d.id, d.reportCode)}
                          className="px-3 py-1.5 font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl inline-flex items-center gap-1"
                        >
                          <Download className="w-3.5 h-3.5" /> PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedDoc && (
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E5F0FA]">
                  <div className="font-bold text-sm text-[#0F2942]">
                    {selectedDoc.reportCode} · {selectedDoc.title}
                  </div>
                  <span className="font-mono text-[11px] text-[#158EE3]">
                    {selectedDoc.documentType}
                  </span>
                </div>

                <div>
                  <div className="font-bold text-[#0E4F80] mb-1">Factual Evidence Summary</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[#476481]">
                    {selectedDoc.factualEvidenceSummary.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>

                <div className="p-3 rounded-2xl bg-[#FFFDF7] border border-[#FDE1B2]">
                  <div className="font-bold text-[#9A5B00] mb-1">
                    Mandatory Uncertainty &amp; Measurement Limitations
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[#613C00]">
                    {selectedDoc.limitationsAndUncertainties.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {isSafeguardingLead && accessLogs.length > 0 && (
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-2">
                <div className="font-bold text-[#0F2942]">
                  Audit Document Access Trail ({accessLogs.length})
                </div>
                <div className="space-y-1 max-h-44 overflow-y-auto text-[11px] text-[#526A84]">
                  {accessLogs.slice(0, 15).map((log) => (
                    <div key={log.id} className="flex justify-between gap-2">
                      <span>
                        <strong>{log.accessAction}</strong> · {log.documentId} by {log.accessorName} (
                        {log.accessorRole})
                      </span>
                      <span className="tabular-nums">{new Date(log.accessedAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
