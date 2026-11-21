import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  Info,
  X,
} from 'lucide-react';
import { api, type QuestionDetailIntelligenceResponse } from '../lib/api';

interface QuestionReviewDrawerProps {
  questionId: string | null;
  onClose: () => void;
  onOpenCase?: (caseId: string) => void;
}

export function QuestionReviewDrawer({
  questionId,
  onClose,
  onOpenCase,
}: QuestionReviewDrawerProps) {
  const [detail, setDetail] = useState<QuestionDetailIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!questionId) return;
    setLoading(true);
    setErrorMsg(null);
    api
      .getQuestionDetailIntelligence(questionId)
      .then((res) => setDetail(res))
      .catch((err) => setErrorMsg((err as Error).message))
      .finally(() => setLoading(false));
  }, [questionId]);

  if (!questionId) return null;

  const letters = ['A', 'B', 'C', 'D'];

  return (
    <div
      role="dialog"
      aria-label={`Question Review ${questionId}`}
      data-testid="question-review-drawer"
      className="fixed inset-0 z-50 bg-[#0F2942]/45 backdrop-blur-xs flex items-center justify-end p-2 sm:p-4"
    >
      <div className="bg-white w-full max-w-3xl h-full max-h-[94vh] rounded-3xl border border-[#CBE2FA] shadow-2xl flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-[#F7FBFF] border-b border-[#E5F0FA] flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-mono font-bold text-[#158EE3]">
              Question Review Detail · {questionId}
            </div>
            <h2 className="text-lg font-display font-extrabold text-[#0F2942]">
              {detail?.question.subjectName || 'Curriculum Question Intelligence'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close question review"
            onClick={onClose}
            className="p-2 rounded-xl bg-white border border-[#CBE2FA] text-[#526A84] hover:text-[#0F2942]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-sm text-[#526A84]">
              Loading authorized question performance & attempt history...
            </div>
          ) : errorMsg ? (
            <div className="p-4 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-sm text-[#9A2F09]">
              {errorMsg}
            </div>
          ) : detail ? (
            <>
              {/* Question & Answer Key */}
              <div className="p-5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#526A84]">
                  <span>
                    {detail.question.topicName} → {detail.question.subtopicName}
                  </span>
                  <span className="font-semibold text-[#158EE3]">
                    v{detail.question.version || 1} · {detail.question.attributes.difficultyTier}
                  </span>
                </div>
                <div className="text-lg font-display font-bold text-[#0F2942]">
                  {detail.question.questionSi}
                </div>
                {detail.question.questionEn && detail.question.questionEn !== detail.question.questionSi && (
                  <p className="text-xs text-[#526A84]">{detail.question.questionEn}</p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                  {detail.question.options.map((opt, idx) => {
                    const isRight = idx === detail.question.correctIndex;
                    return (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 ${
                          isRight
                            ? 'bg-[#EEF9EF] border-[#81C784] text-[#1E6323] font-bold'
                            : 'bg-white border-[#DCEBFA] text-[#476481]'
                        }`}
                      >
                        <span className="font-mono font-bold">{letters[idx]}.</span>
                        <span className="flex-1">{opt}</span>
                        {isRight && <CheckCircle2 className="w-4 h-4 shrink-0 text-[#2E7D32]" />}
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] text-xs text-[#0F2942]">
                  <strong>Explanation:</strong> {detail.question.explanation}
                </div>
                <div className="p-3 rounded-xl bg-[#FFF9EE] border border-[#FDE1B2] text-xs text-[#613C00]">
                  <strong>{detail.question.memoryTrickTitle}:</strong> {detail.question.memoryTrickBody}
                </div>
              </div>

              {/* Sample-Size Reliability Notice */}
              <div
                className={`p-3.5 rounded-2xl border text-xs flex items-start gap-2.5 ${
                  detail.metrics.sampleSizeStatus === 'insufficient'
                    ? 'bg-[#FFF9EE] border-[#FAD49B] text-[#7A4400]'
                    : detail.metrics.sampleSizeStatus === 'preliminary'
                    ? 'bg-[#F3F9FF] border-[#B9DCF9] text-[#0E4F80]'
                    : 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                }`}
              >
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <strong>
                    Sample-Size Status: {detail.metrics.sampleSizeStatus.toUpperCase()} (
                    {detail.metrics.validAttemptCount} valid attempts across{' '}
                    {detail.metrics.uniqueStudents} students)
                  </strong>{' '}
                  —{' '}
                  {detail.metrics.sampleSizeStatus === 'insufficient'
                    ? 'Fewer than 3 valid attempts; treat percentages as early signal only.'
                    : detail.metrics.sampleSizeStatus === 'preliminary'
                    ? '3–9 valid attempts; useful preliminary diagnostic trend.'
                    : '10+ valid attempts; statistically meaningful question difficulty trend.'}
                </div>
              </div>

              {/* Performance Metrics Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3.5 rounded-2xl bg-[#F3F9FF] border border-[#DCEBFA]">
                  <div className="text-[#526A84]">Correct / Incorrect Rate</div>
                  <div className="text-lg font-display font-extrabold text-[#158EE3] tabular-nums mt-0.5">
                    {detail.metrics.correctAttemptRate}% / {detail.metrics.incorrectAttemptRate}%
                  </div>
                  <div className="text-[11px] text-[#526A84] tabular-nums">
                    {detail.metrics.correctAttemptCount} right · {detail.metrics.incorrectAttemptCount} wrong
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4]">
                  <div className="text-[#526A84]">First vs Repeat Accuracy</div>
                  <div className="text-lg font-display font-extrabold text-[#2E7D32] tabular-nums mt-0.5">
                    {detail.metrics.firstAttemptAccuracy ?? '—'}% /{' '}
                    {detail.metrics.repeatAttemptAccuracy ?? '—'}%
                  </div>
                  <div className="text-[11px] text-[#526A84] tabular-nums">
                    {detail.metrics.firstAttemptTotal} first · {detail.metrics.repeatAttemptTotal} repeat
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl bg-[#FFF7EB] border border-[#FDE1B2]">
                  <div className="text-[#526A84]">Unassisted vs Hint-Used</div>
                  <div className="text-lg font-display font-extrabold text-[#B26A00] tabular-nums mt-0.5">
                    {detail.metrics.unassistedAccuracy ?? '—'}% /{' '}
                    {detail.metrics.hintAssistedAccuracy ?? '—'}%
                  </div>
                  <div className="text-[11px] text-[#526A84] tabular-nums">
                    {detail.metrics.unassistedTotal} solo · {detail.metrics.hintAssistedTotal} hinted
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2]">
                  <div className="text-[#526A84]">Repeated-Error Students</div>
                  <div className="text-lg font-display font-extrabold text-[#C62828] tabular-nums mt-0.5">
                    {detail.metrics.repeatedErrorStudentCount}
                  </div>
                  <div className="text-[11px] text-[#526A84] tabular-nums">
                    Skipped: {detail.metrics.skippedOrUnansweredCount} · Timed out:{' '}
                    {detail.metrics.timedOutCount}
                  </div>
                </div>
              </div>

              {/* Response-Time Distribution with Ethical Framing */}
              <div className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2 font-bold text-[#0F2942]">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-[#158EE3]" />
                    <span>Response-Time Pacing Distribution</span>
                  </span>
                  <span className="tabular-nums text-[#526A84]">
                    Median: {(detail.metrics.responseTimeStats.medianMs / 1000).toFixed(1)}s · P90:{' '}
                    {(detail.metrics.responseTimeStats.p90Ms / 1000).toFixed(1)}s · Mean:{' '}
                    {(detail.metrics.responseTimeStats.meanMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <p className="text-[11px] text-[#526A84]">{detail.ethicalFramingNote}</p>
              </div>

              {/* Authorized Student Error Histories */}
              <div className="space-y-2.5">
                <h3 className="text-sm font-display font-bold text-[#0F2942]">
                  Authorized Student Error & Attempt Breakdown ({detail.studentHistories.length})
                </h3>
                {detail.studentHistories.length === 0 ? (
                  <div className="text-xs text-[#526A84] p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA]">
                    No attempts recorded yet for this question.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-[#DCEBFA] rounded-2xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-[#F7FBFF] border-b border-[#E5F0FA] text-[#526A84]">
                        <tr>
                          <th className="py-2.5 px-3 font-semibold">Student</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Valid</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Correct</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Wrong</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Skipped</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Last Attempt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F0F6FD]">
                        {detail.studentHistories.map((sh) => (
                          <tr key={sh.studentId}>
                            <td className="py-2.5 px-3 font-semibold text-[#0F2942]">
                              {sh.studentName}{' '}
                              <span className="font-mono text-[10px] text-[#526A84]">
                                ({sh.userIdCode})
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{sh.validAttempts}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-[#2E7D32] font-bold">
                              {sh.correctCount}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-[#C62828] font-bold">
                              {sh.incorrectCount}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-[#526A84]">
                              {sh.skippedCount}
                            </td>
                            <td className="py-2.5 px-3 text-right text-[#526A84]">
                              {new Date(sh.lastAttemptAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Linked Intervention Cases */}
              {detail.relatedCases.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-sm font-display font-bold text-[#0F2942]">
                    Related Intervention Cases ({detail.relatedCases.length})
                  </h3>
                  <div className="space-y-2">
                    {detail.relatedCases.map((c) => (
                      <div
                        key={c.id}
                        className="p-3.5 rounded-2xl bg-[#FFF6EB] border border-[#FAD49B] flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-bold text-[#0F2942] flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 text-[#F96A1B]" />
                            <span>
                              {c.id} · Status: {c.status} · Errors: {c.incorrectCount}
                            </span>
                          </div>
                          <div className="text-[#613C00] mt-0.5">{c.suggestedSupportNote}</div>
                        </div>
                        {onOpenCase && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenCase(c.id);
                            }}
                            className="px-3 py-1.5 bg-[#F96A1B] hover:bg-[#DE580E] text-white font-bold rounded-xl flex items-center gap-1 whitespace-nowrap shrink-0"
                          >
                            <span>Manage Case</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Version History */}
              {detail.versions.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-[#526A84] flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    <span>Question Revision History ({detail.versions.length})</span>
                  </h3>
                  <div className="space-y-1.5">
                    {detail.versions.map((v) => (
                      <div
                        key={v.id}
                        className="p-2.5 rounded-xl bg-[#F8FBFF] border border-[#E5F0FA] text-[11px] flex items-center justify-between gap-2 text-[#476481]"
                      >
                        <span>
                          <strong>v{v.version}</strong> · {v.changeNote} (by {v.changedBy})
                        </span>
                        <span>{new Date(v.createdAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
