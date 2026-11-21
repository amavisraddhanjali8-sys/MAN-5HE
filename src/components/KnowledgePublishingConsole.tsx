import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  Link2,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../lib/api';
import { SUPPORTED_GRADES, createEmptyChecklist, isChecklistComplete } from '../lib/knowledge';
import type {
  KnowledgeAnalyticsSummary,
  KnowledgeDiscoveryCandidate,
  KnowledgePublication,
  KnowledgeType,
  PublicationCampaign,
  PublicationDelivery,
  PublicationLanguage,
  PublicationReviewAction,
  PublicationStatus,
  PublicationVersion,
  QuizItem,
  SubjectCategory,
  SubtopicNode,
  TopicNode,
  UserRole,
  ValidationChecklist,
} from '../lib/types';

interface KnowledgePublishingConsoleProps {
  role: UserRole;
  subjects: SubjectCategory[];
  topics: TopicNode[];
  subtopics: SubtopicNode[];
}

const CHECKLIST_LABELS: { key: keyof Omit<ValidationChecklist, 'notes'>; label: string }[] = [
  { key: 'factualAccuracy', label: 'Factual accuracy verified' },
  { key: 'sourceReliability', label: 'Source attribution & reliability confirmed' },
  { key: 'gradeSuitability', label: 'Target grade & age appropriateness checked' },
  { key: 'curriculumRelevance', label: 'Sri Lanka Scholarship curriculum relevance confirmed' },
  { key: 'languageClarity', label: 'Language clarity & child-friendly tone verified' },
  { key: 'resourceSafety', label: 'Attachments & external links scanned for safety' },
  { key: 'copyrightLicensing', label: 'Copyright & licensing attribution cleared' },
  { key: 'accessibility', label: 'Formatting & readable structure verified' },
];

export function KnowledgePublishingConsole({
  role,
  subjects,
  topics,
  subtopics,
}: KnowledgePublishingConsoleProps) {
  const [subView, setSubView] = useState<'publications' | 'discovery' | 'analytics'>('publications');
  const [publications, setPublications] = useState<KnowledgePublication[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [subjectFilter, setSubjectFilter] = useState('All');
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailPub, setDetailPub] = useState<KnowledgePublication | null>(null);
  const [versions, setVersions] = useState<PublicationVersion[]>([]);
  const [reviewActions, setReviewActions] = useState<PublicationReviewAction[]>([]);
  const [campaigns, setCampaigns] = useState<PublicationCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<PublicationDelivery[]>([]);

  // Editor form state (New or Edit)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [knowledgeType, setKnowledgeType] = useState<KnowledgeType>('concept_guide');
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'subj-math');
  const [topicId, setTopicId] = useState('');
  const [subtopicId, setSubtopicId] = useState('');
  const [targetGrades, setTargetGrades] = useState<string[]>(['Grade 5']);
  const [language, setLanguage] = useState<PublicationLanguage>('bilingual');
  const [learningNeeds, setLearningNeeds] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourcePublishedAt, setSourcePublishedAt] = useState('');
  const [checklist, setChecklist] = useState<ValidationChecklist>(createEmptyChecklist(false));
  const [aiAssisted, setAiAssisted] = useState(false);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [duplicateWarnings, setDuplicateWarnings] = useState<
    { id: string; title: string; score: number }[]
  >([]);

  // AI Draft & Discovery Assistant state
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; model: string }>({
    configured: false,
    model: 'gemini-4-hydrogen',
  });
  const [aiExcerpt, setAiExcerpt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  // Resource attachment state
  const [linkType, setLinkType] = useState<'external_link' | 'video_link'>('external_link');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [availableQuizzes, setAvailableQuizzes] = useState<QuizItem[]>([]);
  const [selectedQuizIds, setSelectedQuizIds] = useState<string[]>([]);

  // Workflow / Distribution / Correction state
  const [reviewNotes, setReviewNotes] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [correctionText, setCorrectionText] = useState('');
  const [distChannels, setDistChannels] = useState<('in_app' | 'email' | 'whatsapp')[]>([
    'in_app',
    'email',
    'whatsapp',
  ]);

  // Discovery Queue & Analytics
  const [discoveryCandidates, setDiscoveryCandidates] = useState<KnowledgeDiscoveryCandidate[]>([]);
  const [candTitle, setCandTitle] = useState('');
  const [candSummary, setCandSummary] = useState('');
  const [candSourceTitle, setCandSourceTitle] = useState('');
  const [candSourceUrl, setCandSourceUrl] = useState('');
  const [candSubjectId, setCandSubjectId] = useState(subjects[0]?.id || 'subj-math');
  const [analytics, setAnalytics] = useState<KnowledgeAnalyticsSummary | null>(null);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (subjects.length > 0 && !subjects.some((s) => s.id === subjectId)) {
      setSubjectId(subjects[0].id);
      setCandSubjectId(subjects[0].id);
    }
  }, [subjects]);

  const loadPublications = async () => {
    setLoading(true);
    try {
      const [pubRes, aiRes] = await Promise.all([
        api.getKnowledgePublications({ status: statusFilter, subjectId: subjectFilter }),
        api.getKnowledgeAiStatus().catch(() => ({ configured: false, model: 'gemini-4-hydrogen' })),
      ]);
      setPublications(pubRes.publications);
      setAiStatus(aiRes);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPublications();
  }, [statusFilter, subjectFilter]);

  useEffect(() => {
    if (subView === 'discovery') {
      api
        .getKnowledgeDiscoveryQueue()
        .then((res) => setDiscoveryCandidates(res.candidates))
        .catch((err) => setErrorMsg((err as Error).message));
    } else if (subView === 'analytics') {
      api
        .getKnowledgeAnalytics()
        .then((res) => setAnalytics(res))
        .catch((err) => setErrorMsg((err as Error).message));
    }
  }, [subView]);

  const openDetail = async (pubId: string) => {
    setSelectedId(pubId);
    setShowCreateForm(false);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const [detail, qRes] = await Promise.all([
        api.getKnowledgePublicationDetail(pubId),
        api.getAdminQuizzes({ source: 'curated' }).catch(() => ({ quizzes: [] as QuizItem[] })),
      ]);
      setDetailPub(detail.publication);
      setVersions(detail.versions);
      setReviewActions(detail.reviewActions);
      setCampaigns(detail.campaigns);
      setChecklist(detail.publication.checklist);
      setAvailableQuizzes(qRes.quizzes);
      if (detail.campaigns.length > 0) {
        const firstCid = detail.campaigns[0].id;
        setSelectedCampaignId(firstCid);
        if (role === 'admin') {
          const dRes = await api.getCampaignDeliveries(firstCid);
          setDeliveries(dRes.deliveries);
        }
      } else {
        setSelectedCampaignId(null);
        setDeliveries([]);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleCreatePublication = async (submitForReview: boolean) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.createKnowledgePublication({
        title,
        summary,
        body,
        knowledgeType,
        subjectId,
        topicId: topicId || undefined,
        subtopicId: subtopicId || undefined,
        targetGrades,
        language,
        learningNeeds,
        sourceTitle,
        sourceUrl: sourceUrl || null,
        sourcePublishedAt: sourcePublishedAt || null,
        checklist,
        aiAssisted,
        aiDraftWarnings: aiWarnings,
        initialStatus: submitForReview ? 'PENDING_REVIEW' : 'DRAFT',
      });
      setDuplicateWarnings(res.duplicateWarnings || []);
      setStatusMsg(
        submitForReview
          ? `Publication ${res.publication.id} submitted for administrator review.`
          : `Draft ${res.publication.id} saved.`
      );
      setShowCreateForm(false);
      await loadPublications();
      await openDetail(res.publication.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleRunAiDraft = async () => {
    setAiBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.generateKnowledgeAiDraft({
        sourceTitle: sourceTitle || 'Verified Source Excerpt',
        sourceUrl: sourceUrl || undefined,
        sourceExcerpt: aiExcerpt,
        targetGrade: targetGrades[0] || 'Grade 5',
        language,
        subjectId,
      });
      setTitle(res.draft.title);
      setSummary(res.draft.summary);
      setBody(
        [
          res.draft.simplifiedExplanation,
          res.draft.memoryTip ? `Memory Tip: ${res.draft.memoryTip}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      );
      setSubjectId(res.draft.suggestedSubjectId);
      setTargetGrades(res.draft.suggestedGrades);
      setAiAssisted(true);
      setAiWarnings(res.draft.uncertaintyWarnings);
      setDuplicateWarnings(res.duplicateMatches);
      setStatusMsg('AI draft populated as unverified DRAFT. Review checklist before submitting.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const handleCheckDuplicates = async () => {
    if (!title.trim()) return;
    try {
      const res = await api.checkKnowledgeDuplicates(title, sourceUrl || undefined);
      setDuplicateWarnings(res.duplicates);
    } catch {
      // ignore
    }
  };

  const handleSaveChecklist = async () => {
    if (!detailPub) return;
    setErrorMsg(null);
    try {
      const res = await api.updateKnowledgePublication(detailPub.id, {
        checklist,
        changeNote: 'Updated editorial verification checklist',
      });
      setDetailPub(res.publication);
      setStatusMsg('Verification checklist saved.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleTransition = async (toStatus: PublicationStatus) => {
    if (!detailPub) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.transitionKnowledgePublication(detailPub.id, {
        toStatus,
        notes: reviewNotes,
        scheduledFor: toStatus === 'SCHEDULED' ? new Date(scheduledFor).toISOString() : undefined,
        checklist,
      });
      setDetailPub(res.publication);
      setVersions(res.versions);
      setReviewActions(res.reviewActions);
      setReviewNotes('');
      setStatusMsg(`Publication transitioned to ${res.publication.status}.`);
      await loadPublications();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isCover = false) => {
    const file = e.target.files?.[0];
    if (!file || !detailPub) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = typeof reader.result === 'string' ? reader.result : '';
        await api.uploadKnowledgeResource(detailPub.id, {
          title: file.name,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data: result,
          isCover,
        });
        setStatusMsg(`Uploaded resource "${file.name}".`);
        await openDetail(detailPub.id);
      } catch (err) {
        setErrorMsg((err as Error).message);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAddExternalLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailPub) return;
    setErrorMsg(null);
    try {
      await api.addKnowledgeLinkResource(detailPub.id, {
        resourceType: linkType,
        title: linkTitle,
        externalUrl: linkUrl,
      });
      setLinkTitle('');
      setLinkUrl('');
      setStatusMsg('External reference added.');
      await openDetail(detailPub.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleLinkQuizzes = async () => {
    if (!detailPub || selectedQuizIds.length === 0) return;
    setErrorMsg(null);
    try {
      await api.addKnowledgeLinkResource(detailPub.id, {
        resourceType: 'linked_quiz',
        title: `Linked Scholarship Quizzes (${selectedQuizIds.length})`,
        linkedQuizIds: selectedQuizIds,
      });
      setSelectedQuizIds([]);
      setStatusMsg('Linked curriculum quizzes to publication.');
      await openDetail(detailPub.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleDistribute = async () => {
    if (!detailPub) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.distributeKnowledgePublication(detailPub.id, {
        channels: distChannels,
      });
      setStatusMsg(
        res.deduplicated
          ? 'Campaign already dispatched for this publication version (deduplicated).'
          : `Campaign dispatched: ${res.campaign.deliveredCount} delivered, ${res.campaign.skippedCount} skipped.`
      );
      await openDetail(detailPub.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleIssueCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailPub) return;
    setErrorMsg(null);
    try {
      await api.issueKnowledgeCorrection(detailPub.id, {
        correctionNotice: correctionText,
        notifyChannels: ['in_app', 'email', 'whatsapp'],
      });
      setCorrectionText('');
      setStatusMsg('Official correction notice recorded & distributed.');
      await openDetail(detailPub.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleAddDiscovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await api.addKnowledgeDiscoveryCandidate({
        title: candTitle,
        summary: candSummary,
        suggestedSubjectId: candSubjectId,
        suggestedGrades: ['Grade 5'],
        sourceTitle: candSourceTitle,
        sourceUrl: candSourceUrl,
      });
      setCandTitle('');
      setCandSummary('');
      setCandSourceTitle('');
      setCandSourceUrl('');
      const res = await api.getKnowledgeDiscoveryQueue();
      setDiscoveryCandidates(res.candidates);
      setStatusMsg('Discovery lead added with duplicate & relevance check.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const convertCandidateToDraft = async (c: KnowledgeDiscoveryCandidate) => {
    setTitle(c.title);
    setSummary(c.summary);
    setBody(
      `${c.summary}\n\nVerified Reference: ${c.sourceTitle} (${c.sourceUrl}). Expand with Grade 5 Scholarship explanations before review.`
    );
    setSubjectId(c.suggestedSubjectId);
    setTargetGrades(c.suggestedGrades);
    setSourceTitle(c.sourceTitle);
    setSourceUrl(c.sourceUrl);
    setSourcePublishedAt(c.sourcePublishedAt);
    setDuplicateWarnings(c.duplicateMatches);
    await api.updateKnowledgeDiscoveryStatus(c.id, 'CONVERTED');
    setSubView('publications');
    setShowCreateForm(true);
    setSelectedId(null);
  };

  const subjectName = (sId: string) => subjects.find((s) => s.id === sId)?.nameEn || sId;
  const visibleTopics = topics.filter((t) => t.subjectId === subjectId);
  const visibleSubtopics = subtopics.filter((st) => st.topicId === topicId);

  return (
    <div className="space-y-6" data-testid="knowledge-publishing-console">
      {/* Header & Sub-View Switcher */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold text-[#158EE3]">
            {role === 'admin'
              ? 'Global Knowledge Discovery, Publishing & Distribution'
              : 'Subject-Scoped Knowledge Authoring & Engagement'}
          </div>
          <h2 className="text-lg font-display font-extrabold text-[#0F2942]">
            Educational Knowledge Publishing Studio
          </h2>
          <p className="text-xs text-[#526A84]">
            Prepare verified Grade 5 learning guides, manage attachments, and distribute across In-App, Email &amp; WhatsApp
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
            {(
              [
                { id: 'publications', label: 'Publications' },
                { id: 'discovery', label: 'Discovery Queue' },
                { id: 'analytics', label: 'Engagement Analytics' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubView(tab.id)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  subView === tab.id
                    ? 'bg-[#158EE3] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            data-testid="new-publication-btn"
            onClick={() => {
              setSubView('publications');
              setShowCreateForm(true);
              setSelectedId(null);
              setDetailPub(null);
              setTitle('');
              setSummary('');
              setBody('');
              setSourceTitle('');
              setSourceUrl('');
              setChecklist(createEmptyChecklist(false));
              setAiAssisted(false);
              setAiWarnings([]);
              setDuplicateWarnings([]);
            }}
            className="px-4 py-2 text-xs font-bold text-white bg-[#F96A1B] hover:bg-[#DE580E] rounded-xl flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Publication</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3.5 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] text-xs font-semibold text-[#1E6323]">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs font-semibold text-[#9A2F09]">
          {errorMsg}
        </div>
      )}

      {/* SUBVIEW 1: PUBLICATIONS & EDITOR */}
      {subView === 'publications' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left Queue List */}
          <div className="xl:col-span-5 bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                aria-label="Filter publications by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942]"
              >
                <option value="ALL">All Statuses</option>
                <option value="DRAFT">DRAFT</option>
                <option value="PENDING_REVIEW">PENDING_REVIEW</option>
                <option value="APPROVED">APPROVED</option>
                <option value="SCHEDULED">SCHEDULED</option>
                <option value="PUBLISHED">PUBLISHED</option>
                <option value="ARCHIVED">ARCHIVED</option>
                <option value="WITHDRAWN">WITHDRAWN</option>
              </select>

              <select
                aria-label="Filter publications by subject"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942] flex-1"
              >
                <option value="All">All Authorized Subjects</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameEn}
                  </option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="py-8 text-center text-xs text-[#526A84]">Loading publications...</div>
            ) : publications.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#526A84]">
                No publications in this queue.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
                {publications.map((pub) => (
                  <button
                    key={pub.id}
                    type="button"
                    data-testid={`pub-row-${pub.id}`}
                    onClick={() => openDetail(pub.id)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-colors space-y-1.5 ${
                      selectedId === pub.id
                        ? 'bg-[#EBF5FF] border-[#158EE3]'
                        : 'bg-[#F8FBFF] border-[#DCEBFA] hover:border-[#99C8F5]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono font-bold text-[#158EE3]">{pub.id}</span>
                      <span
                        className={`font-bold ${
                          pub.status === 'PUBLISHED'
                            ? 'text-[#2E7D32]'
                            : pub.status === 'PENDING_REVIEW'
                            ? 'text-[#D97706]'
                            : pub.status === 'WITHDRAWN' || pub.status === 'REJECTED'
                            ? 'text-[#C62828]'
                            : 'text-[#476481]'
                        }`}
                      >
                        {pub.status}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-[#0F2942] leading-snug">{pub.title}</div>
                    <div className="text-[11px] text-[#526A84]">
                      {subjectName(pub.subjectId)} · {pub.targetGrades.join(', ')} · v{pub.currentVersion}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Workspace: Create Form or Publication Inspector */}
          <div className="xl:col-span-7 space-y-5">
            {showCreateForm ? (
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-[#E5F0FA] pb-3">
                  <h3 className="text-base font-display font-bold text-[#0F2942]">
                    Create Knowledge Publication
                  </h3>
                  <span className="text-[11px] font-semibold text-[#526A84]">
                    {aiStatus.configured
                      ? `AI Draft Assist Ready (${aiStatus.model})`
                      : 'Manual Authoring Mode (GEMINI_API_KEY not set)'}
                  </span>
                </div>

                {/* Optional AI Assisted Drafting from Verified Source */}
                <div className="p-4 rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA] space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#0F2942] flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-[#158EE3]" />
                      <span>Optional AI-Assisted Educational Simplification (Draft Only)</span>
                    </span>
                    <span className="text-[11px] text-[#526A84]">Never auto-publishes</span>
                  </div>
                  <textarea
                    rows={2}
                    value={aiExcerpt}
                    onChange={(e) => setAiExcerpt(e.target.value)}
                    placeholder="Paste verified curriculum excerpt or reference notes to generate a child-friendly Grade 5 draft..."
                    className="w-full p-2.5 bg-white border border-[#CBE2FA] rounded-xl text-xs"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-[#526A84]">
                      {aiStatus.configured
                        ? 'Generates summary, Grade 5 explanation, and uncertainty flags from your excerpt.'
                        : 'Configure GEMINI_API_KEY on the server to enable Gemini summarization.'}
                    </span>
                    <button
                      type="button"
                      disabled={!aiStatus.configured || aiBusy || aiExcerpt.trim().length < 20}
                      onClick={handleRunAiDraft}
                      className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#158EE3] disabled:bg-[#A6C4DF] rounded-xl"
                    >
                      {aiBusy ? 'Drafting...' : 'Generate Unverified Draft'}
                    </button>
                  </div>
                </div>

                {aiWarnings.length > 0 && (
                  <div className="p-3 rounded-2xl bg-[#FFF7EB] border border-[#FAD49B] text-xs text-[#7C4D00] space-y-1">
                    <div className="font-bold">AI &amp; Source Verification Flags</div>
                    {aiWarnings.map((w, idx) => (
                      <div key={idx}>• {w}</div>
                    ))}
                  </div>
                )}

                {duplicateWarnings.length > 0 && (
                  <div className="p-3 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs text-[#9A2F09]">
                    <strong>Duplicate Topic Warning:</strong> Similar to{' '}
                    {duplicateWarnings.map((d) => `${d.id} (${d.title})`).join(', ')}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-[#476481] mb-1">Title</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onBlur={handleCheckDuplicates}
                      placeholder="e.g. Time Conversion Clock Tricks for Part II"
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-[#476481] mb-1">Subject</label>
                    <select
                      value={subjectId}
                      onChange={(e) => {
                        setSubjectId(e.target.value);
                        setTopicId('');
                        setSubtopicId('');
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
                    <label className="block font-semibold text-[#476481] mb-1">Knowledge Type</label>
                    <select
                      value={knowledgeType}
                      onChange={(e) => setKnowledgeType(e.target.value as KnowledgeType)}
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold"
                    >
                      <option value="concept_guide">Concept Guide</option>
                      <option value="curriculum_discovery">Curriculum Discovery</option>
                      <option value="exam_strategy">Exam Strategy</option>
                      <option value="science_update">Science Update</option>
                      <option value="worksheet_pack">Worksheet Pack</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-[#476481] mb-1">Topic</label>
                    <select
                      value={topicId}
                      onChange={(e) => setTopicId(e.target.value)}
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    >
                      <option value="">Default Subject Topic</option>
                      {visibleTopics.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-[#476481] mb-1">Language</label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as PublicationLanguage)}
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    >
                      <option value="bilingual">Bilingual (Sinhala &amp; English)</option>
                      <option value="si">Sinhala</option>
                      <option value="en">English</option>
                      <option value="ta">Tamil</option>
                    </select>
                  </div>

                  {visibleSubtopics.length > 0 && (
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-[#476481] mb-1">Subtopic</label>
                      <select
                        value={subtopicId}
                        onChange={(e) => setSubtopicId(e.target.value)}
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      >
                        <option value="">Default Subtopic</option>
                        {visibleSubtopics.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.nameEn}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="sm:col-span-2">
                    <div className="font-semibold text-[#476481] mb-1">Target Grade(s)</div>
                    <div className="flex flex-wrap gap-2">
                      {SUPPORTED_GRADES.map((g) => {
                        const checked = targetGrades.includes(g);
                        return (
                          <label
                            key={g}
                            className={`px-3 py-1.5 rounded-xl border cursor-pointer font-semibold ${
                              checked
                                ? 'bg-[#EBF5FF] border-[#158EE3] text-[#0F2942]'
                                : 'bg-[#F8FBFF] border-[#CBE2FA] text-[#526A84]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setTargetGrades((prev) =>
                                  e.target.checked ? [...prev, g] : prev.filter((x) => x !== g)
                                )
                              }
                              className="mr-1.5 accent-[#158EE3]"
                            />
                            {g}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-[#476481] mb-1">Short Summary</label>
                    <input
                      type="text"
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      placeholder="Concise 1-2 sentence overview for students & parents"
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-[#476481] mb-1">
                      Full Educational Explanation
                    </label>
                    <textarea
                      rows={5}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Write step-by-step student-friendly explanation..."
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-[#476481] mb-1">Source Title</label>
                    <input
                      type="text"
                      value={sourceTitle}
                      onChange={(e) => setSourceTitle(e.target.value)}
                      placeholder="e.g. NIE Grade 5 Teacher Guide"
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#476481] mb-1">
                      Source URL (Optional HTTPS)
                    </label>
                    <input
                      type="url"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://www.nie.ac.lk/"
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#476481] mb-1">
                      Source Publication Date
                    </label>
                    <input
                      type="date"
                      value={sourcePublishedAt}
                      onChange={(e) => setSourcePublishedAt(e.target.value)}
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#476481] mb-1">
                      Learning Focus / Need
                    </label>
                    <input
                      type="text"
                      value={learningNeeds}
                      onChange={(e) => setLearningNeeds(e.target.value)}
                      placeholder="e.g. Exam time management"
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-[#E5F0FA]">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="px-4 py-2 text-xs font-semibold text-[#476481] bg-[#F3F9FF] rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreatePublication(false)}
                    className="px-4 py-2 text-xs font-bold text-[#0F2942] bg-[#EBF5FF] border border-[#CBE2FA] rounded-xl"
                  >
                    Save as Draft
                  </button>
                  <button
                    type="button"
                    data-testid="submit-for-review-btn"
                    onClick={() => handleCreatePublication(true)}
                    className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
                  >
                    Submit for Review
                  </button>
                </div>
              </div>
            ) : detailPub ? (
              <div className="space-y-5" data-testid="publication-inspector">
                <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E5F0FA] pb-4">
                    <div>
                      <div className="text-xs font-mono font-bold text-[#158EE3]">
                        {detailPub.id} · {detailPub.status} · v{detailPub.currentVersion}
                      </div>
                      <h3 className="text-lg font-display font-extrabold text-[#0F2942]">
                        {detailPub.title}
                      </h3>
                      <p className="text-xs text-[#526A84] mt-0.5">
                        {subjectName(detailPub.subjectId)} · {detailPub.targetGrades.join(', ')} ·
                        Author: {detailPub.authorName}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-[#476481] leading-relaxed">{detailPub.summary}</p>
                  <div className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] text-xs text-[#0F2942] whitespace-pre-line">
                    {detailPub.body}
                  </div>

                  {/* Resource Attachments */}
                  <div className="space-y-3 pt-2 border-t border-[#E5F0FA]">
                    <div className="text-xs font-bold text-[#0F2942]">
                      Resources, Worksheets, External Links &amp; Linked Quizzes ({detailPub.resources.length})
                    </div>

                    {detailPub.resources.length > 0 && (
                      <div className="space-y-2">
                        {detailPub.resources.map((res) => (
                          <div
                            key={res.id}
                            className="p-2.5 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-3.5 h-3.5 text-[#158EE3] shrink-0" />
                              <span className="font-semibold text-[#0F2942] truncate">
                                {res.title}
                              </span>
                              <span className="text-[11px] text-[#526A84]">({res.resourceType})</span>
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                await api.removeKnowledgeResource(detailPub.id, res.id);
                                await openDetail(detailPub.id);
                              }}
                              className="p-1 text-[#C62828] hover:bg-[#FFF2ED] rounded-lg"
                              aria-label={`Remove ${res.title}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <label className="px-3 py-2 bg-[#EBF5FF] border border-[#CBE2FA] rounded-xl font-bold text-[#158EE3] cursor-pointer flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload PDF / Doc / Worksheet</span>
                        <input
                          type="file"
                          accept=".pdf,.txt,.md,.docx,.png,.jpg,.jpeg,.webp"
                          onChange={(e) => handleFileUpload(e, false)}
                          className="hidden"
                        />
                      </label>
                      <label className="px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942] cursor-pointer flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5 text-[#F5A623]" />
                        <span>Upload Cover Image</span>
                        <input
                          type="file"
                          accept=".png,.jpg,.jpeg,.webp"
                          onChange={(e) => handleFileUpload(e, true)}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <form onSubmit={handleAddExternalLink} className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                      <select
                        value={linkType}
                        onChange={(e) => setLinkType(e.target.value as 'external_link' | 'video_link')}
                        className="sm:col-span-3 px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      >
                        <option value="external_link">External Link</option>
                        <option value="video_link">Video Reference</option>
                      </select>
                      <input
                        type="text"
                        value={linkTitle}
                        onChange={(e) => setLinkTitle(e.target.value)}
                        placeholder="Reference Title"
                        className="sm:col-span-4 px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      />
                      <input
                        type="url"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        placeholder="https://..."
                        className="sm:col-span-3 px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      />
                      <button
                        type="submit"
                        className="sm:col-span-2 px-3 py-2 bg-[#0F2942] text-white font-bold rounded-xl flex items-center justify-center gap-1"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </form>

                    {availableQuizzes.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                        <select
                          multiple
                          aria-label="Select quizzes to link"
                          value={selectedQuizIds}
                          onChange={(e) =>
                            setSelectedQuizIds(
                              Array.from(e.target.selectedOptions).map((o) => o.value)
                            )
                          }
                          className="flex-1 min-w-[220px] h-20 p-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-xs"
                        >
                          {availableQuizzes.slice(0, 12).map((q) => (
                            <option key={q.id} value={q.id}>
                              {q.id} · {q.questionSi.slice(0, 48)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={handleLinkQuizzes}
                          disabled={selectedQuizIds.length === 0}
                          className="px-3.5 py-2 bg-[#4CAF50] disabled:bg-[#B7DAB8] text-white font-bold rounded-xl"
                        >
                          Link Selected Quizzes
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 8-Point Verification Checklist */}
                  <div className="space-y-3 pt-3 border-t border-[#E5F0FA]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#0F2942] flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-[#2E7D32]" />
                        <span>Editorial Verification Checklist ({isChecklistComplete(checklist) ? 'Complete' : 'Incomplete'})</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setChecklist(createEmptyChecklist(true))}
                          className="text-[11px] font-bold text-[#158EE3] hover:underline"
                        >
                          Mark All Verified
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveChecklist}
                          className="px-3 py-1 text-[11px] font-bold bg-[#F3F9FF] border border-[#CBE2FA] rounded-lg"
                        >
                          Save Checklist
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {CHECKLIST_LABELS.map((item) => (
                        <label
                          key={item.key}
                          className="flex items-center gap-2 p-2 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(checklist[item.key])}
                            onChange={(e) =>
                              setChecklist((prev) => ({
                                ...prev,
                                [item.key]: e.target.checked,
                              }))
                            }
                            className="accent-[#2E7D32]"
                          />
                          <span className="text-[#0F2942]">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Workflow Transitions */}
                  <div className="space-y-3 pt-3 border-t border-[#E5F0FA] text-xs">
                    <div className="font-bold text-[#0F2942]">Publishing Workflow Actions</div>
                    <input
                      type="text"
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="Reviewer notes or rejection feedback..."
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {detailPub.status === 'DRAFT' && (
                        <button
                          type="button"
                          onClick={() => handleTransition('PENDING_REVIEW')}
                          className="px-3.5 py-2 font-bold text-white bg-[#158EE3] rounded-xl"
                        >
                          Submit for Review
                        </button>
                      )}
                      {role === 'admin' && detailPub.status === 'PENDING_REVIEW' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleTransition('APPROVED')}
                            className="px-3.5 py-2 font-bold text-white bg-[#158EE3] rounded-xl"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTransition('REJECTED')}
                            className="px-3.5 py-2 font-bold text-white bg-[#C62828] rounded-xl"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {role === 'admin' &&
                        (detailPub.status === 'DRAFT' ||
                          detailPub.status === 'PENDING_REVIEW' ||
                          detailPub.status === 'APPROVED' ||
                          detailPub.status === 'SCHEDULED') && (
                          <button
                            type="button"
                            data-testid="publish-now-btn"
                            onClick={() => handleTransition('PUBLISHED')}
                            className="px-3.5 py-2 font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl"
                          >
                            Publish Now
                          </button>
                        )}
                      {role === 'admin' && detailPub.status === 'PUBLISHED' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleTransition('ARCHIVED')}
                            className="px-3.5 py-2 font-bold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl"
                          >
                            Archive
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTransition('WITHDRAWN')}
                            className="px-3.5 py-2 font-bold text-white bg-[#C62828] rounded-xl"
                          >
                            Withdraw Publication
                          </button>
                        </>
                      )}
                    </div>

                    {role === 'admin' &&
                      (detailPub.status === 'DRAFT' ||
                        detailPub.status === 'PENDING_REVIEW' ||
                        detailPub.status === 'APPROVED') && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <input
                            type="datetime-local"
                            value={scheduledFor}
                            onChange={(e) => setScheduledFor(e.target.value)}
                            className="px-3 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                          />
                          <button
                            type="button"
                            disabled={!scheduledFor}
                            onClick={() => handleTransition('SCHEDULED')}
                            className="px-3.5 py-2 font-bold text-white bg-[#F5A623] disabled:bg-[#E7D4B1] rounded-xl flex items-center gap-1"
                          >
                            <CalendarClock className="w-3.5 h-3.5" />
                            <span>Schedule Future Publish</span>
                          </button>
                        </div>
                      )}
                  </div>

                  {/* Multi-Channel Distribution & Correction (Admin, Published items) */}
                  {role === 'admin' && detailPub.status === 'PUBLISHED' && (
                    <div className="space-y-4 pt-3 border-t border-[#E5F0FA] text-xs">
                      <div className="font-bold text-[#0F2942]">
                        Multi-Channel Distribution (In-App + Email + WhatsApp)
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {(['in_app', 'email', 'whatsapp'] as const).map((ch) => (
                          <label key={ch} className="flex items-center gap-1.5 font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={distChannels.includes(ch)}
                              onChange={(e) =>
                                setDistChannels((prev) =>
                                  e.target.checked ? [...prev, ch] : prev.filter((x) => x !== ch)
                                )
                              }
                              className="accent-[#158EE3]"
                            />
                            <span className="uppercase">{ch.replace('_', '-')}</span>
                          </label>
                        ))}
                        <button
                          type="button"
                          data-testid="distribute-campaign-btn"
                          onClick={handleDistribute}
                          className="px-4 py-2 font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center gap-1.5"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Distribute to Eligible Students</span>
                        </button>
                      </div>

                      <form onSubmit={handleIssueCorrection} className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={correctionText}
                          onChange={(e) => setCorrectionText(e.target.value)}
                          placeholder="Issue official correction notice & notify recipients..."
                          className="flex-1 min-w-[240px] px-3 py-2 bg-[#FFF9EB] border border-[#FAD49B] rounded-xl"
                        />
                        <button
                          type="submit"
                          disabled={correctionText.trim().length < 8}
                          className="px-3.5 py-2 font-bold text-white bg-[#D97706] disabled:bg-[#E7C69C] rounded-xl"
                        >
                          Post Correction Notice
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Campaign Delivery Logs */}
                  {campaigns.length > 0 && (
                    <div className="space-y-2 pt-3 border-t border-[#E5F0FA] text-xs">
                      <div className="font-bold text-[#0F2942]">
                        Distribution Campaigns &amp; Recipient Delivery Logs ({campaigns.length})
                      </div>
                      {campaigns.map((c) => (
                        <div
                          key={c.id}
                          className="p-3 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] flex flex-wrap items-center justify-between gap-2"
                        >
                          <div>
                            <div className="font-bold text-[#0F2942]">
                              {c.id} · {c.channels.join(', ')}
                            </div>
                            <div className="text-[11px] text-[#526A84] tabular-nums">
                              Eligible: {c.totalEligible} · Delivered: {c.deliveredCount} · Skipped: {c.skippedCount} · Failed: {c.failedCount}
                            </div>
                          </div>
                          {role === 'admin' && (
                            <button
                              type="button"
                              onClick={async () => {
                                setSelectedCampaignId(c.id);
                                const dRes = await api.getCampaignDeliveries(c.id);
                                setDeliveries(dRes.deliveries);
                              }}
                              className="text-[11px] font-bold text-[#158EE3] hover:underline"
                            >
                              Inspect Deliveries
                            </button>
                          )}
                        </div>
                      ))}

                      {deliveries.length > 0 && (
                        <div className="space-y-1.5 max-h-44 overflow-y-auto pt-1">
                          {deliveries.map((d) => (
                            <div
                              key={d.id}
                              className="px-3 py-2 rounded-xl bg-white border border-[#E5F0FA] flex items-center justify-between gap-2 text-[11px]"
                            >
                              <span>
                                <strong>{d.recipientName}</strong> · {d.channel}
                              </span>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`font-bold ${
                                    d.deliveryStatus === 'delivered'
                                      ? 'text-[#2E7D32]'
                                      : 'text-[#C62828]'
                                  }`}
                                >
                                  {d.deliveryStatus}
                                </span>
                                {role === 'admin' && d.deliveryStatus !== 'delivered' && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await api.retryCampaignDelivery(d.id);
                                        if (selectedCampaignId) {
                                          const dRes = await api.getCampaignDeliveries(selectedCampaignId);
                                          setDeliveries(dRes.deliveries);
                                        }
                                      } catch (err) {
                                        setErrorMsg((err as Error).message);
                                      }
                                    }}
                                    className="font-bold text-[#F96A1B] hover:underline flex items-center gap-0.5"
                                  >
                                    <RefreshCw className="w-3 h-3" /> Retry
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Version & Review History */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-[#E5F0FA] text-xs">
                    <div>
                      <div className="font-bold text-[#0F2942] mb-2">Version History ({versions.length})</div>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {versions.map((v) => (
                          <div key={v.id} className="p-2 rounded-xl bg-[#F8FBFF] border border-[#E5F0FA]">
                            <div className="font-bold text-[#0F2942]">
                              v{v.versionNumber} · {v.changedByName}
                            </div>
                            <div className="text-[11px] text-[#526A84]">{v.changeNote}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="font-bold text-[#0F2942] mb-2">Review Audit Trail ({reviewActions.length})</div>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {reviewActions.map((a) => (
                          <div key={a.id} className="p-2 rounded-xl bg-[#F8FBFF] border border-[#E5F0FA]">
                            <div className="font-bold text-[#0F2942]">
                              {a.actionType} · {a.actorName}
                            </div>
                            <div className="text-[11px] text-[#526A84]">
                              {a.notes || `${a.fromStatus || 'NEW'} → ${a.toStatus}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-12 text-center text-sm text-[#526A84]">
                Select a publication from the left queue to inspect, verify, attach resources, or distribute, or click <strong>New Publication</strong>.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBVIEW 2: KNOWLEDGE DISCOVERY QUEUE */}
      {subView === 'discovery' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleAddDiscovery}
            className="xl:col-span-5 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3 text-xs"
          >
            <h3 className="text-base font-display font-bold text-[#0F2942]">
              Log Approved External Knowledge Lead
            </h3>
            <p className="text-[#526A84]">
              Checks duplicate titles/URLs automatically before queuing for editorial drafting.
            </p>
            <input
              type="text"
              required
              value={candTitle}
              onChange={(e) => setCandTitle(e.target.value)}
              placeholder="Educational Topic Title"
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
            />
            <textarea
              rows={3}
              required
              value={candSummary}
              onChange={(e) => setCandSummary(e.target.value)}
              placeholder="Verified summary..."
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
            />
            <select
              value={candSubjectId}
              onChange={(e) => setCandSubjectId(e.target.value)}
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameEn}
                </option>
              ))}
            </select>
            <input
              type="text"
              required
              value={candSourceTitle}
              onChange={(e) => setCandSourceTitle(e.target.value)}
              placeholder="Approved Source Name (e.g. NIE, DoE, CCF)"
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
            />
            <input
              type="url"
              required
              value={candSourceUrl}
              onChange={(e) => setCandSourceUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
            />
            <button
              type="submit"
              className="w-full py-2.5 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
            >
              Add to Discovery Queue
            </button>
          </form>

          <div className="xl:col-span-7 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3">
            <h3 className="text-base font-display font-bold text-[#0F2942]">
              Discovery Leads Pending Review ({discoveryCandidates.length})
            </h3>
            {discoveryCandidates.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#526A84]">
                No discovery leads queued yet. Add a verified curriculum source on the left.
              </div>
            ) : (
              <div className="space-y-3">
                {discoveryCandidates.map((c) => (
                  <div
                    key={c.id}
                    className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#0F2942] text-sm">{c.title}</span>
                      <span className="font-mono text-[#158EE3]">{c.status}</span>
                    </div>
                    <p className="text-[#476481]">{c.summary}</p>
                    <div className="text-[11px] text-[#526A84] flex flex-wrap items-center gap-2">
                      <span>Source: {c.sourceTitle}</span>
                      <a
                        href={c.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#158EE3] inline-flex items-center gap-0.5 hover:underline"
                      >
                        Link <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    {c.uncertaintyFlags.length > 0 && (
                      <div className="text-[11px] text-[#9A5B00] bg-[#FFF7EB] border border-[#FAD49B] rounded-lg px-2.5 py-1">
                        <AlertTriangle className="w-3 h-3 inline mr-1" />
                        {c.uncertaintyFlags.join(' · ')}
                      </div>
                    )}
                    {c.status === 'NEW' && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => convertCandidateToDraft(c)}
                          className="px-3 py-1.5 font-bold text-white bg-[#158EE3] rounded-xl"
                        >
                          Convert to Draft Publication
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await api.updateKnowledgeDiscoveryStatus(c.id, 'DISMISSED');
                            const res = await api.getKnowledgeDiscoveryQueue();
                            setDiscoveryCandidates(res.candidates);
                          }}
                          className="px-3 py-1.5 font-semibold text-[#526A84] bg-white border border-[#CBE2FA] rounded-xl"
                        >
                          Dismiss
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

      {/* SUBVIEW 3: ENGAGEMENT & DELIVERY ANALYTICS */}
      {subView === 'analytics' && analytics && (
        <div className="space-y-5" data-testid="knowledge-analytics-panel">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-white rounded-2xl border border-[#DCEBFA] p-4">
              <div className="text-[11px] font-semibold text-[#526A84]">Published Guides</div>
              <div className="text-2xl font-display font-extrabold text-[#0F2942] tabular-nums">
                {analytics.publishedCount}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#DCEBFA] p-4">
              <div className="text-[11px] font-semibold text-[#526A84]">Campaigns Delivered</div>
              <div className="text-2xl font-display font-extrabold text-[#158EE3] tabular-nums">
                {analytics.deliveryMetrics.deliveredCount}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#DCEBFA] p-4">
              <div className="text-[11px] font-semibold text-[#526A84]">In-App Views</div>
              <div className="text-2xl font-display font-extrabold text-[#2E7D32] tabular-nums">
                {analytics.engagementMetrics.totalViews}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#DCEBFA] p-4">
              <div className="text-[11px] font-semibold text-[#526A84]">Unique Student Readers</div>
              <div className="text-2xl font-display font-extrabold text-[#0F2942] tabular-nums">
                {analytics.engagementMetrics.uniqueViewers}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#DCEBFA] p-4">
              <div className="text-[11px] font-semibold text-[#526A84]">Resource Downloads</div>
              <div className="text-2xl font-display font-extrabold text-[#F96A1B] tabular-nums">
                {analytics.engagementMetrics.resourceDownloads}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#DCEBFA] p-4">
              <div className="text-[11px] font-semibold text-[#526A84]">Linked Quiz Answers</div>
              <div className="text-2xl font-display font-extrabold text-[#F5A623] tabular-nums">
                {analytics.engagementMetrics.quizCompletions}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#158EE3]" />
                <h3 className="text-base font-display font-bold text-[#0F2942]">
                  Publication Reach vs. Measurable Student Engagement
                </h3>
              </div>
              <span className="text-[11px] text-[#526A84]">
                Notification delivery is tracked separately from actual student reads &amp; quiz completions
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5F0FA] text-[#526A84]">
                    <th className="py-2 pr-3 font-semibold">Publication</th>
                    <th className="py-2 px-3 font-semibold">Subject</th>
                    <th className="py-2 px-3 font-semibold">Status</th>
                    <th className="py-2 px-3 font-semibold text-right">Delivered</th>
                    <th className="py-2 px-3 font-semibold text-right">Views</th>
                    <th className="py-2 px-3 font-semibold text-right">Readers</th>
                    <th className="py-2 px-3 font-semibold text-right">Downloads</th>
                    <th className="py-2 pl-3 font-semibold text-right">Quizzes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F6FD]">
                  {analytics.topPublications.map((row) => (
                    <tr key={row.id} className="hover:bg-[#F8FBFF]">
                      <td className="py-2.5 pr-3 font-bold text-[#0F2942]">{row.title}</td>
                      <td className="py-2.5 px-3 text-[#476481]">{row.subjectName}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">{row.status}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{row.deliveredCount}</td>
                      <td className="py-2.5 px-3 text-right font-bold tabular-nums text-[#158EE3]">
                        {row.views}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{row.uniqueViewers}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{row.downloads}</td>
                      <td className="py-2.5 pl-3 text-right tabular-nums">{row.quizCompletions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
