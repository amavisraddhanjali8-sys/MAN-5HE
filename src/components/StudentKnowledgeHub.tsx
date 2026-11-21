import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Play,
  Search,
  ShieldCheck,
  Video,
  XCircle,
} from 'lucide-react';
import { api, AuthUser, getStoredToken } from '../lib/api';
import type {
  KnowledgePublication,
  PublicationResource,
  QuizItem,
  SubjectCategory,
  TopicNode,
} from '../lib/types';

interface StudentKnowledgeHubProps {
  user: AuthUser;
  subjects: SubjectCategory[];
  topics: TopicNode[];
  initialPublicationId?: string | null;
  onConsumeInitialPublication?: () => void;
  onPracticeLinkedTopic?: (subjectId: string, topicId: string, questionId?: string) => void;
}

const KNOWLEDGE_TYPE_LABELS: Record<string, string> = {
  concept_guide: 'Concept Guide',
  curriculum_discovery: 'Curriculum Discovery',
  exam_strategy: 'Exam Strategy',
  science_update: 'Science Update',
  worksheet_pack: 'Worksheet Pack',
  correction_notice: 'Correction Notice',
};

function AuthorizedImage({
  downloadUrl,
  alt,
  className,
}: {
  downloadUrl: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objUrl: string | null = null;
    const token = getStoredToken();
    fetch(downloadUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!active || !blob) return;
        objUrl = URL.createObjectURL(blob);
        setSrc(objUrl);
      })
      .catch(() => {
        // ignore preview failure
      });
    return () => {
      active = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [downloadUrl]);

  if (!src) return null;
  return <img src={src} alt={alt} className={className} />;
}

export function StudentKnowledgeHub({
  user,
  subjects,
  topics,
  initialPublicationId,
  onConsumeInitialPublication,
  onPracticeLinkedTopic,
}: StudentKnowledgeHubProps) {
  const [publications, setPublications] = useState<KnowledgePublication[]>([]);
  const [subjectId, setSubjectId] = useState('All');
  const [topicId, setTopicId] = useState('All');
  const [search, setSearch] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [activePubId, setActivePubId] = useState<string | null>(initialPublicationId || null);
  const [detailPub, setDetailPub] = useState<KnowledgePublication | null>(null);
  const [linkedQuizzes, setLinkedQuizzes] = useState<QuizItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [actionToast, setActionToast] = useState<string | null>(null);

  const loadPublications = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getKnowledgePublications({
        subjectId,
        topicId,
        search,
        bookmarkedOnly: savedOnly,
      });
      setPublications(res.publications);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPublications();
  }, [subjectId, topicId, search, savedOnly]);

  const openPublication = async (pubId: string) => {
    setActivePubId(pubId);
    setDetailLoading(true);
    setErrorMsg(null);
    setQuizAnswers({});
    setActionToast(null);
    try {
      const detail = await api.getKnowledgePublicationDetail(pubId);
      setDetailPub(detail.publication);
      setLinkedQuizzes(detail.linkedQuizzes);
      await api.recordKnowledgeEngagement(pubId, 'view').catch(() => {});
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (initialPublicationId) {
      openPublication(initialPublicationId);
      onConsumeInitialPublication?.();
    }
  }, [initialPublicationId]);

  const handleToggleBookmark = async (pubId: string) => {
    try {
      const res = await api.recordKnowledgeEngagement(pubId, 'bookmark');
      setPublications((prev) =>
        prev.map((p) => (p.id === pubId ? { ...p, bookmarked: res.bookmarked } : p))
      );
      if (detailPub && detailPub.id === pubId) {
        setDetailPub({ ...detailPub, bookmarked: res.bookmarked });
      }
      setActionToast(res.bookmarked ? 'Saved to your study shelf.' : 'Removed from saved guides.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleDownloadResource = async (res: PublicationResource) => {
    if (!res.downloadUrl) return;
    setErrorMsg(null);
    try {
      await api.downloadAuthorizedResourceBlob(
        res.downloadUrl,
        res.title.replace(/[^a-zA-Z0-9._-]/g, '_')
      );
      setActionToast(`Downloaded "${res.title}".`);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleExternalClick = (pubId: string, resourceId: string | null) => {
    api.recordKnowledgeEngagement(pubId, 'link_click', resourceId).catch(() => {});
  };

  const handleAnswerLinkedQuiz = (quiz: QuizItem, optionIdx: number) => {
    if (!detailPub || quizAnswers[quiz.id] !== undefined) return;
    setQuizAnswers((prev) => ({ ...prev, [quiz.id]: optionIdx }));
    const isCorrect = optionIdx === quiz.correctIndex;
    api
      .recordKnowledgeEngagement(detailPub.id, 'quiz_complete', null, {
        questionId: quiz.id,
        isCorrect,
      })
      .catch(() => {});
  };

  const subjectName = (sId: string) =>
    subjects.find((s) => s.id === sId)?.nameEn || sId;
  const topicName = (tId: string) => topics.find((t) => t.id === tId)?.nameEn || '';
  const visibleTopics =
    subjectId === 'All' ? topics : topics.filter((t) => t.subjectId === subjectId);

  if (activePubId && detailPub) {
    const fileResources = detailPub.resources.filter(
      (r) =>
        r.resourceType === 'pdf' ||
        r.resourceType === 'document' ||
        r.resourceType === 'worksheet' ||
        r.resourceType === 'image'
    );
    const linkResources = detailPub.resources.filter(
      (r) => r.resourceType === 'external_link' || r.resourceType === 'video_link'
    );

    return (
      <div className="space-y-5" data-testid="student-knowledge-detail">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setActivePubId(null);
              setDetailPub(null);
            }}
            className="px-3.5 py-2 text-xs font-bold text-[#0F2942] bg-white border border-[#CBE2FA] rounded-xl hover:bg-[#F3F9FF] flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Knowledge Feed</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleToggleBookmark(detailPub.id)}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl border flex items-center gap-1.5 ${
                detailPub.bookmarked
                  ? 'bg-[#FFF7EB] border-[#F5A623] text-[#8F5A00]'
                  : 'bg-white border-[#CBE2FA] text-[#0F2942] hover:bg-[#F3F9FF]'
              }`}
            >
              {detailPub.bookmarked ? (
                <BookmarkCheck className="w-3.5 h-3.5 text-[#F5A623]" />
              ) : (
                <Bookmark className="w-3.5 h-3.5 text-[#158EE3]" />
              )}
              <span>{detailPub.bookmarked ? 'Saved Guide' : 'Save for Revision'}</span>
            </button>

            {onPracticeLinkedTopic && (
              <button
                type="button"
                onClick={() =>
                  onPracticeLinkedTopic(
                    detailPub.subjectId,
                    detailPub.topicId,
                    linkedQuizzes[0]?.id
                  )
                }
                className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Practise Topic Questions</span>
              </button>
            )}
          </div>
        </div>

        {actionToast && (
          <div className="p-3 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] text-xs font-semibold text-[#1E6323]">
            {actionToast}
          </div>
        )}
        {errorMsg && (
          <div className="p-3 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs font-semibold text-[#9A2F09]">
            {errorMsg}
          </div>
        )}

        {detailLoading ? (
          <div className="bg-white rounded-3xl border border-[#DCEBFA] p-12 text-center text-sm text-[#526A84]">
            Loading verified study guide...
          </div>
        ) : (
          <article className="bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8 space-y-6">
            {detailPub.correctionNotice && (
              <div
                data-testid="knowledge-correction-banner"
                className="p-4 rounded-2xl bg-[#FFF7EB] border border-[#FAD49B] text-xs text-[#7C4D00] flex items-start gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Official Correction / Update Notice</div>
                  <p className="mt-0.5 leading-relaxed">{detailPub.correctionNotice}</p>
                </div>
              </div>
            )}

            <div className="space-y-2 border-b border-[#E5F0FA] pb-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#476481]">
                <span className="font-mono font-bold text-[#158EE3]">{detailPub.id}</span>
                <span>·</span>
                <span className="font-bold text-[#0F2942]">
                  {subjectName(detailPub.subjectId)}
                </span>
                {topicName(detailPub.topicId) && (
                  <>
                    <span>·</span>
                    <span>{topicName(detailPub.topicId)}</span>
                  </>
                )}
                <span>·</span>
                <span className="font-semibold text-[#2E7D32]">
                  {detailPub.targetGrades.join(', ')}
                </span>
                <span>·</span>
                <span>{KNOWLEDGE_TYPE_LABELS[detailPub.knowledgeType] || detailPub.knowledgeType}</span>
              </div>

              <h1 className="text-2xl font-display font-extrabold text-[#0F2942] leading-snug">
                {detailPub.title}
              </h1>
              <p className="text-sm text-[#476481] leading-relaxed">{detailPub.summary}</p>

              <div className="flex flex-wrap items-center gap-4 pt-2 text-[11px] text-[#526A84]">
                <span>
                  Prepared by <strong className="text-[#0F2942]">{detailPub.authorName}</strong>
                </span>
                {detailPub.verificationDate && (
                  <span className="flex items-center gap-1 text-[#1E6323] font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Verified {new Date(detailPub.verificationDate).toLocaleDateString()}
                  </span>
                )}
                <span className="tabular-nums">Version v{detailPub.currentVersion}</span>
              </div>
            </div>

            {detailPub.coverImageUrl && (
              <AuthorizedImage
                downloadUrl={detailPub.coverImageUrl}
                alt={detailPub.title}
                className="w-full max-h-72 object-cover rounded-2xl border border-[#DCEBFA]"
              />
            )}

            <div className="space-y-4 text-sm text-[#0F2942] leading-relaxed whitespace-pre-line">
              {detailPub.body}
            </div>

            {/* Source Attribution */}
            {(detailPub.sourceTitle || detailPub.sourceUrl) && (
              <div className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] text-xs space-y-1">
                <div className="font-bold text-[#0F2942]">Verified Educational Source</div>
                <div className="text-[#476481]">
                  {detailPub.sourceTitle}
                  {detailPub.sourcePublishedAt ? ` (${detailPub.sourcePublishedAt})` : ''}
                </div>
                {detailPub.sourceUrl && (
                  <a
                    href={detailPub.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleExternalClick(detailPub.id, null)}
                    className="inline-flex items-center gap-1 font-semibold text-[#158EE3] hover:underline pt-0.5"
                  >
                    <span>Open Original Reference</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {/* Attached Files & Links */}
            {(fileResources.length > 0 || linkResources.length > 0) && (
              <div className="space-y-3 pt-2 border-t border-[#E5F0FA]">
                <h2 className="text-sm font-display font-bold text-[#0F2942]">
                  Study Worksheets, Documents &amp; References
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {fileResources.map((res) => (
                    <div
                      key={res.id}
                      className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-[#158EE3] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#0F2942] truncate">
                            {res.title}
                          </div>
                          <div className="text-[11px] text-[#526A84] uppercase tabular-nums">
                            {res.resourceType} · {Math.max(1, Math.round(res.sizeBytes / 1024))} KB
                          </div>
                        </div>
                      </div>
                      {res.downloadUrl && (
                        <button
                          type="button"
                          onClick={() => handleDownloadResource(res)}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center gap-1 shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </button>
                      )}
                    </div>
                  ))}

                  {linkResources.map((res) => (
                    <a
                      key={res.id}
                      href={res.externalUrl || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleExternalClick(detailPub.id, res.id)}
                      className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] hover:border-[#158EE3] flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {res.resourceType === 'video_link' ? (
                          <Video className="w-4 h-4 text-[#F96A1B] shrink-0" />
                        ) : (
                          <ExternalLink className="w-4 h-4 text-[#158EE3] shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#0F2942] truncate">
                            {res.title}
                          </div>
                          <div className="text-[11px] text-[#526A84] truncate">
                            {res.externalUrl}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-[#158EE3] shrink-0">Open</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Embedded Quick Comprehension Check */}
            {linkedQuizzes.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-[#E5F0FA]">
                <div>
                  <h2 className="text-base font-display font-bold text-[#0F2942]">
                    Quick Knowledge Check ({linkedQuizzes.length})
                  </h2>
                  <p className="text-xs text-[#526A84]">
                    Try these linked Scholarship questions to test what you just read
                  </p>
                </div>

                <div className="space-y-4">
                  {linkedQuizzes.map((q) => {
                    const selected = quizAnswers[q.id];
                    const answered = selected !== undefined;
                    return (
                      <div
                        key={q.id}
                        className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-3"
                      >
                        <div className="text-sm font-bold text-[#0F2942]">{q.questionSi}</div>
                        {q.questionEn && q.questionEn !== q.questionSi && (
                          <div className="text-xs text-[#526A84]">{q.questionEn}</div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {q.options.map((opt, idx) => {
                            const isCorrectOpt = idx === q.correctIndex;
                            const isChosen = selected === idx;
                            let cls =
                              'bg-white border-[#CBE2FA] text-[#0F2942] hover:bg-[#EAF5FF]';
                            if (answered) {
                              if (isCorrectOpt) {
                                cls = 'bg-[#EEF9EF] border-[#4CAF50] text-[#1E6323] font-bold';
                              } else if (isChosen) {
                                cls = 'bg-[#FFF2ED] border-[#E65100] text-[#9A2F09]';
                              } else {
                                cls = 'bg-white border-[#E5F0FA] text-[#7C97B2]';
                              }
                            }
                            return (
                              <button
                                key={idx}
                                type="button"
                                disabled={answered}
                                onClick={() => handleAnswerLinkedQuiz(q, idx)}
                                className={`p-2.5 rounded-xl border text-left text-xs transition-colors flex items-center justify-between gap-2 ${cls}`}
                              >
                                <span>{opt}</span>
                                {answered && isCorrectOpt && (
                                  <CheckCircle2 className="w-4 h-4 text-[#2E7D32] shrink-0" />
                                )}
                                {answered && isChosen && !isCorrectOpt && (
                                  <XCircle className="w-4 h-4 text-[#C62828] shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                        {answered && (
                          <div className="p-3 rounded-xl bg-[#FFF9EB] border border-[#FDE1B2] text-xs text-[#7C4D00]">
                            <strong>{q.memoryTrickTitle}:</strong> {q.memoryTrickBody}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </article>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="student-knowledge-hub">
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold text-[#158EE3]">
            Verified Curriculum Library · {user.grade || 'Grade 5'}
          </div>
          <h2 className="text-lg font-display font-extrabold text-[#0F2942]">
            Knowledge Guides, Worksheets &amp; Study Strategies
          </h2>
          <p className="text-xs text-[#526A84]">
            Showing only verified publications curated for your grade level
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#7C97B2] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search guides or topics..."
              className="pl-8 pr-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-xs w-52"
            />
          </div>

          <select
            aria-label="Filter knowledge guides by subject"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setTopicId('All');
            }}
            className="px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942]"
          >
            <option value="All">All Subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameEn}
              </option>
            ))}
          </select>

          {visibleTopics.length > 0 && (
            <select
              aria-label="Filter knowledge guides by topic"
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              className="px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold text-[#0F2942]"
            >
              <option value="All">All Topics</option>
              {visibleTopics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameEn}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setSavedOnly((v) => !v)}
            className={`px-3 py-2 rounded-xl border font-semibold flex items-center gap-1.5 ${
              savedOnly
                ? 'bg-[#FFF7EB] border-[#F5A623] text-[#8F5A00]'
                : 'bg-[#F8FBFF] border-[#CBE2FA] text-[#476481]'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Saved ({publications.filter((p) => p.bookmarked).length})</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs font-semibold text-[#9A2F09]">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-3xl border border-[#DCEBFA] p-10 text-center text-sm text-[#526A84]">
          Loading Grade {user.grade?.replace('Grade ', '') || '5'} knowledge library...
        </div>
      ) : publications.length === 0 ? (
        <div className="bg-white rounded-3xl border border-[#DCEBFA] p-10 text-center text-sm text-[#526A84]">
          No published knowledge guides matched your filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {publications.map((pub) => (
            <div
              key={pub.id}
              data-testid={`knowledge-card-${pub.id}`}
              className="bg-white rounded-3xl border border-[#DCEBFA] p-5 flex flex-col justify-between gap-4 hover:border-[#158EE3] transition-colors"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-[#158EE3]">{subjectName(pub.subjectId)}</span>
                  <span className="font-mono text-[11px] text-[#526A84]">{pub.id}</span>
                </div>

                <h3 className="text-base font-display font-bold text-[#0F2942] leading-snug">
                  {pub.title}
                </h3>

                <p className="text-xs text-[#476481] leading-relaxed">{pub.summary}</p>

                {pub.correctionNotice && (
                  <div className="text-[11px] font-semibold text-[#9A5B00] bg-[#FFF7EB] border border-[#FAD49B] rounded-xl px-2.5 py-1.5">
                    Updated with Correction Notice
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#526A84] pt-1">
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5 text-[#158EE3]" />
                    {KNOWLEDGE_TYPE_LABELS[pub.knowledgeType] || pub.knowledgeType}
                  </span>
                  <span>·</span>
                  <span>{pub.targetGrades.join(', ')}</span>
                  {pub.resources.length > 0 && (
                    <>
                      <span>·</span>
                      <span className="tabular-nums font-semibold text-[#0F2942]">
                        {pub.resources.length} Resource{pub.resources.length === 1 ? '' : 's'}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-[#E5F0FA]">
                <button
                  type="button"
                  onClick={() => handleToggleBookmark(pub.id)}
                  className="text-xs font-semibold text-[#526A84] hover:text-[#0F2942] flex items-center gap-1"
                >
                  {pub.bookmarked ? (
                    <BookmarkCheck className="w-3.5 h-3.5 text-[#F5A623]" />
                  ) : (
                    <Bookmark className="w-3.5 h-3.5" />
                  )}
                  <span>{pub.bookmarked ? 'Saved' : 'Save'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => openPublication(pub.id)}
                  className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl transition-colors"
                >
                  Read Guide &amp; Resources
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
