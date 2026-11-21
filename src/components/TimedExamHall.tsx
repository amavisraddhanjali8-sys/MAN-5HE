import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  Play,
  Send,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import {
  api,
  AssessmentAttemptReviewItem,
  AuthUser,
  StudentAssessmentListItem,
} from '../lib/api';
import { calculateRingGeometry, evaluateExamTimerState } from '../lib/examTimer';
import type {
  AssessmentAttemptRecord,
  AssessmentRecord,
  AssessmentSection,
  AttemptRecord,
  ExamPaper,
  StudentQuizView,
  StudentTrajectory,
} from '../lib/types';

export interface ScheduledExamLaunch {
  scheduledSessionId: string;
  fixedPaperId?: string | null;
  fixedAssessmentId?: string | null;
}

interface TimedExamHallProps {
  user: AuthUser;
  scheduledLaunch?: ScheduledExamLaunch | null;
  onConsumeScheduledLaunch?: () => void;
  onAttemptComplete: (user: AuthUser, trajectory: StudentTrajectory) => void;
}

export function TimedExamHall({
  user,
  scheduledLaunch,
  onConsumeScheduledLaunch,
  onAttemptComplete,
}: TimedExamHallProps) {
  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [structuredExams, setStructuredExams] = useState<StudentAssessmentListItem[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeScheduledSessionId, setActiveScheduledSessionId] = useState<string | null>(
    scheduledLaunch?.scheduledSessionId || null
  );

  // Active timed exam state (supports both legacy ExamPaper & Enhancement 03 AssessmentRecord)
  const [activeSession, setActiveSession] = useState<{
    mode: 'legacy' | 'structured';
    sessionId: string;
    title: string;
    paperId: string;
    sections: AssessmentSection[];
    questions: StudentQuizView[];
    timeLimitSeconds: number;
  } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [perQuestionDurationsMs, setPerQuestionDurationsMs] = useState<Record<string, number>>({});
  const [questionEnteredAtMs, setQuestionEnteredAtMs] = useState<number>(Date.now());
  const [submitting, setSubmitting] = useState(false);

  // Post-exam review state (Legacy)
  const [examResult, setExamResult] = useState<{
    attempt: AttemptRecord;
    trajectory: StudentTrajectory;
    reviewItems: {
      quizId: string;
      questionSi: string;
      selectedIndex: number | null;
      correctIndex: number;
      isCorrect: boolean;
      memoryTrickTitle: string;
      memoryTrickBody: string;
      explanation: string;
    }[];
  } | null>(null);

  // Post-exam review state (Enhancement 03 Structured Mock Exam)
  const [structuredReview, setStructuredReview] = useState<{
    attempt: AssessmentAttemptRecord;
    assessment: AssessmentRecord;
    resultsReleased: boolean;
    awaitingReleaseNotice: string | null;
    items: AssessmentAttemptReviewItem[];
  } | null>(null);

  const loadAllExams = async () => {
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([api.getPapers(), api.getStudentAssessments()]);
      setPapers(pRes.papers);
      setStructuredExams(sRes.assessments.filter((a) => a.kind === 'mock_exam'));
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllExams();
  }, []);

  useEffect(() => {
    if (!scheduledLaunch) return;
    setActiveScheduledSessionId(scheduledLaunch.scheduledSessionId);
    if (scheduledLaunch.fixedAssessmentId) {
      handleStartStructuredExam(scheduledLaunch.fixedAssessmentId);
    } else if (scheduledLaunch.fixedPaperId) {
      handleStartPaper(scheduledLaunch.fixedPaperId);
    } else if (papers.length > 0) {
      handleStartPaper(papers[0].id);
    }
    onConsumeScheduledLaunch?.();
  }, [scheduledLaunch, papers.length]);

  const handleStartPaper = async (paperId: string) => {
    setErrorMsg(null);
    setExamResult(null);
    setStructuredReview(null);
    try {
      const res = await api.startPaper(paperId);
      setActiveSession({
        mode: 'legacy',
        sessionId: res.sessionId,
        title: res.paper.title,
        paperId: res.paper.id,
        sections: [],
        questions: res.questions,
        timeLimitSeconds: res.timeLimitSeconds,
      });
      setSecondsLeft(res.timeLimitSeconds);
      setCurrentIdx(0);
      setAnswers({});
      setTextAnswers({});
      setPerQuestionDurationsMs({});
      setQuestionEnteredAtMs(Date.now());
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleStartStructuredExam = async (assessmentId: string) => {
    setErrorMsg(null);
    setExamResult(null);
    setStructuredReview(null);
    try {
      const res = await api.startOrResumeAssessment(assessmentId);
      setActiveSession({
        mode: 'structured',
        sessionId: res.attempt.id,
        title: res.assessment.title,
        paperId: res.assessment.id,
        sections: res.sections,
        questions: res.questions,
        timeLimitSeconds: res.timeLimitSeconds || 1200,
      });
      const opts: Record<string, number> = {};
      const texts: Record<string, string> = {};
      for (const sa of res.savedAnswers) {
        if (typeof sa.submittedOptionIndex === 'number') opts[sa.snapshotId] = sa.submittedOptionIndex;
        if (sa.submittedAnswerText) texts[sa.snapshotId] = sa.submittedAnswerText;
      }
      setAnswers(opts);
      setTextAnswers(texts);
      setSecondsLeft(res.secondsRemaining || res.timeLimitSeconds || 1200);
      setCurrentIdx(0);
      setPerQuestionDurationsMs({});
      setQuestionEnteredAtMs(Date.now());
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleViewStructuredReview = async (attemptId: string) => {
    setErrorMsg(null);
    try {
      const review = await api.getAttemptReview(attemptId);
      setStructuredReview(review);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const saveStructuredDraftProgress = async (
    nextAnswers: Record<string, number>,
    nextTexts: Record<string, string>
  ) => {
    if (!activeSession || activeSession.mode !== 'structured') return;
    try {
      await api.saveAssessmentProgress(activeSession.paperId, {
        attemptId: activeSession.sessionId,
        answers: activeSession.questions.map((q) => {
          const key = q.snapshotId || q.id;
          return {
            snapshotId: key,
            questionId: q.id,
            submittedOptionIndex: typeof nextAnswers[key] === 'number' ? nextAnswers[key] : null,
            submittedAnswerText: nextTexts[key] ?? null,
          };
        }),
      });
    } catch {
      // non-blocking autosave
    }
  };

  const navigateToQuestion = (nextIdx: number) => {
    if (!activeSession) return;
    const currentQ = activeSession.questions[currentIdx];
    const now = Date.now();
    if (currentQ) {
      const elapsed = Math.max(0, now - questionEnteredAtMs);
      setPerQuestionDurationsMs((prev) => ({
        ...prev,
        [currentQ.id]: (prev[currentQ.id] || 0) + elapsed,
      }));
    }
    if (activeSession.mode === 'structured') {
      saveStructuredDraftProgress(answers, textAnswers);
    }
    setQuestionEnteredAtMs(now);
    setCurrentIdx(nextIdx);
  };

  const handleSubmitExam = async (timedOut = false) => {
    if (!activeSession || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    const currentQ = activeSession.questions[currentIdx];
    const now = Date.now();
    const finalDurations = { ...perQuestionDurationsMs };
    if (currentQ) {
      finalDurations[currentQ.id] =
        (finalDurations[currentQ.id] || 0) + Math.max(0, now - questionEnteredAtMs);
    }
    try {
      if (activeSession.mode === 'legacy') {
        const res = await api.submitPaper(activeSession.paperId, {
          sessionId: activeSession.sessionId,
          answers,
          perQuestionDurationsMs: finalDurations,
          timedOut,
          scheduledSessionId: activeScheduledSessionId || undefined,
        });
        setActiveScheduledSessionId(null);
        setExamResult({
          attempt: res.attempt,
          trajectory: res.trajectory,
          reviewItems: res.reviewItems,
        });
        setActiveSession(null);
        onAttemptComplete(res.user, res.trajectory);
      } else {
        const res = await api.submitAssessmentAttempt(activeSession.paperId, {
          attemptId: activeSession.sessionId,
          idempotencyKey: `asm-submit-${activeSession.sessionId}`,
          answers: activeSession.questions.map((q) => {
            const key = q.snapshotId || q.id;
            return {
              snapshotId: key,
              questionId: q.id,
              submittedOptionIndex: typeof answers[key] === 'number' ? answers[key] : null,
              submittedAnswerText: textAnswers[key] ?? null,
            };
          }),
          perQuestionDurationsMs: finalDurations,
          timedOut,
        });
        if (activeScheduledSessionId) {
          await api
            .completeScheduledSession(activeScheduledSessionId, res.attempt.id)
            .catch(() => {});
          setActiveScheduledSessionId(null);
        }
        setStructuredReview(res.review);
        setActiveSession(null);
        if (res.trajectory) onAttemptComplete(res.user, res.trajectory);
        await loadAllExams();
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Strict countdown timer during active exam
  useEffect(() => {
    if (!activeSession) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          handleSubmitExam(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeSession?.sessionId]);

  const letters = ['A', 'B', 'C', 'D'];

  // 1A. Post-Exam Evaluation (Enhancement 03 Structured Mock Exam)
  if (structuredReview) {
    return (
      <div className="space-y-6" data-testid="structured-exam-review">
        <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#E5F0FA]">
            <div>
              <h1 className="text-2xl font-display font-extrabold text-[#0F2942]">
                Mock Exam Submission · {structuredReview.assessment.title}
              </h1>
              <p className="text-xs text-[#2E7D32] font-semibold mt-1">
                {structuredReview.resultsReleased
                  ? structuredReview.attempt.status === 'pending_manual_marking'
                    ? 'Objective questions auto-graded; written short answers awaiting teacher marking.'
                    : `Progress Report automatically sent to ${user.email} & WhatsApp ${user.whatsappNumber}`
                  : structuredReview.awaitingReleaseNotice}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStructuredReview(null)}
              className="px-4 py-2 text-sm font-bold text-white bg-[#158EE3] rounded-xl hover:bg-[#1176BE]"
            >
              Back to Exam Hall
            </button>
          </div>

          {!structuredReview.resultsReleased ? (
            <div className="p-6 rounded-2xl bg-[#FFF9EE] border border-[#F5D399] text-sm text-[#7C4D00] flex items-start gap-3">
              <Lock className="w-5 h-5 shrink-0 mt-0.5 text-[#F96A1B]" />
              <div>
                <strong>Awaiting Official Results Release:</strong> {structuredReview.awaitingReleaseNotice}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl bg-[#F3F9FF] border border-[#DCEBFA]">
                  <div className="text-xs text-[#526A84]">Final Score</div>
                  <div className="text-2xl font-display font-extrabold text-[#158EE3] tabular-nums">
                    {structuredReview.attempt.scorePercent === null
                      ? 'Pending'
                      : `${structuredReview.attempt.scorePercent}%`}
                  </div>
                </div>
                <div className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4]">
                  <div className="text-xs text-[#526A84]">
                    {structuredReview.attempt.status === 'pending_manual_marking'
                      ? 'Objective Auto Marks'
                      : 'Awarded Marks'}
                  </div>
                  <div className="text-2xl font-display font-extrabold text-[#2E7D32] tabular-nums">
                    {structuredReview.attempt.totalAwardedMarks}/{structuredReview.attempt.maxMarks}
                  </div>
                </div>
                <div className="p-4 rounded-2xl bg-[#FFF7EB] border border-[#FDE1B2]">
                  <div className="text-xs text-[#526A84]">Duration Used</div>
                  <div className="text-xl font-display font-extrabold text-[#F5A623] tabular-nums">
                    {structuredReview.attempt.serverDurationSeconds}s
                  </div>
                </div>
                <div className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA]">
                  <div className="text-xs text-[#526A84]">Marking Status</div>
                  <div className="text-sm font-display font-bold text-[#0F2942] mt-1">
                    {structuredReview.attempt.status}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-base font-display font-bold text-[#0F2942]">
                  Question-by-Question Review &amp; Psychological Memory Tricks
                </h2>
                {structuredReview.items.map((item) => (
                  <div
                    key={item.snapshotId}
                    className="p-4 rounded-2xl border border-[#DCEBFA] bg-[#F8FBFF] space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold text-sm text-[#0F2942]">
                        {item.sortOrder}. {item.questionSi}
                      </div>
                      <span
                        className={`text-xs font-bold shrink-0 tabular-nums ${
                          item.markingStatus === 'pending_manual'
                            ? 'text-[#D97706]'
                            : item.isCorrect
                            ? 'text-[#2E7D32]'
                            : 'text-[#C62828]'
                        }`}
                      >
                        {item.markingStatus === 'pending_manual'
                          ? 'Pending Teacher Mark'
                          : `${item.awardedMarks}/${item.maxMarks} mks`}
                      </span>
                    </div>
                    <div className="text-xs text-[#526A84]">
                      {item.explanation}
                    </div>
                    {item.graderComment && (
                      <div className="text-xs text-[#0E4F80] bg-[#EBF5FF] border border-[#99CAFA] rounded-lg px-2.5 py-1.5">
                        <strong>Teacher Comment:</strong> {item.graderComment}
                      </div>
                    )}
                    {item.memoryTrickBody && (
                      <div className="p-3 rounded-xl bg-[#FFF9EE] border border-[#FDE1B2] text-xs text-[#613C00]">
                        <strong>{item.memoryTrickTitle}:</strong> {item.memoryTrickBody}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // 1B. Post-Exam Evaluation & Unlocked Memory Review (Legacy)
  if (examResult) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#E5F0FA]">
            <div>
              <h1 className="text-2xl font-display font-extrabold text-[#0F2942]">
                Exam Results · {examResult.attempt.paperTitle}
              </h1>
              <p className="text-xs text-[#2E7D32] font-semibold mt-1">
                Progress Report automatically sent to {user.email} &amp; WhatsApp {user.whatsappNumber}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExamResult(null)}
              className="px-4 py-2 text-sm font-bold text-white bg-[#158EE3] rounded-xl hover:bg-[#1176BE]"
            >
              Back to Exam Hall
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
            <div className="p-4 rounded-2xl bg-[#F3F9FF] border border-[#DCEBFA]">
              <div className="text-xs text-[#526A84]">Final Score</div>
              <div className="text-2xl font-display font-extrabold text-[#158EE3] tabular-nums">
                {examResult.attempt.scorePercent}%
              </div>
              <div className="text-xs text-[#526A84] tabular-nums">
                {examResult.attempt.correctCount}/{examResult.attempt.totalQuestions} Correct
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#FFF7EB] border border-[#FDE1B2]">
              <div className="text-xs text-[#526A84]">Stars Earned</div>
              <div className="text-2xl font-display font-extrabold text-[#F5A623] tabular-nums">
                +{examResult.attempt.starsEarned}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4]">
              <div className="text-xs text-[#526A84]">Scholarship Readiness</div>
              <div className="text-2xl font-display font-extrabold text-[#2E7D32] tabular-nums">
                {examResult.trajectory.scholarshipReadinessPercent}%
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA]">
              <div className="text-xs text-[#526A84]">Updated Student Level</div>
              <div className="text-sm font-display font-bold text-[#0F2942] mt-1">
                {examResult.trajectory.recommendedNextLevel}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
          <h2 className="text-lg font-display font-bold text-[#0F2942]">
            Post-Exam Question Review &amp; Psychological Memory Tricks
          </h2>
          <div className="space-y-4">
            {examResult.reviewItems.map((item, idx) => (
              <div
                key={item.quizId}
                className="p-4 rounded-2xl border border-[#DCEBFA] bg-[#F8FBFF] space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="font-semibold text-sm text-[#0F2942]">
                    {idx + 1}. {item.questionSi}
                  </div>
                  {item.isCorrect ? (
                    <span className="text-xs font-bold text-[#2E7D32] flex items-center gap-1 shrink-0">
                      <CheckCircle2 className="w-4 h-4" /> Correct
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-[#C62828] flex items-center gap-1 shrink-0">
                      <XCircle className="w-4 h-4" /> Review
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#526A84]">
                  Correct Answer: Option {letters[item.correctIndex]} · {item.explanation}
                </div>
                <div className="p-3 rounded-xl bg-[#FFF9EE] border border-[#FDE1B2] text-xs text-[#613C00]">
                  <strong>{item.memoryTrickTitle}:</strong> {item.memoryTrickBody}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 2. Active Strict Timed Exam View (NO study hints or memory tricks accessible!)
  if (activeSession) {
    const q = activeSession.questions[currentIdx];
    const qKey = activeSession.mode === 'structured' ? q.snapshotId || q.id : q.id;
    const qType = q.questionType || 'mcq';
    const currentSectionTitle =
      activeSession.sections.find((s) => s.id === q.sectionId)?.title || '';

    const isItemAnswered = (item: StudentQuizView) => {
      const k = activeSession.mode === 'structured' ? item.snapshotId || item.id : item.id;
      return typeof answers[k] === 'number' || Boolean(textAnswers[k]?.trim());
    };
    const answeredCount = activeSession.questions.filter(isItemAnswered).length;

    const timerState = evaluateExamTimerState({
      secondsLeft,
      timeLimitSeconds: activeSession.timeLimitSeconds,
      answeredCount,
      totalQuestions: activeSession.questions.length,
    });
    const ring = calculateRingGeometry(24, timerState.remainingRatio);
    const ringStrokeColor =
      timerState.urgencyLevel === 'urgent'
        ? '#E53935'
        : timerState.urgencyLevel === 'warning'
        ? '#F5A623'
        : '#158EE3';
    const ringTrackColor =
      timerState.urgencyLevel === 'urgent'
        ? '#FAD6D3'
        : timerState.urgencyLevel === 'warning'
        ? '#FCE7C2'
        : '#DCEBFA';

    return (
      <div className="space-y-5">
        <div
          className={`bg-white rounded-3xl border p-5 flex flex-wrap items-center justify-between gap-4 transition-colors ${
            timerState.isUrgent ? 'border-[#F5B5AD] bg-[#FFFDFC]' : 'border-[#DCEBFA]'
          }`}
        >
          <div>
            <div className="text-xs font-semibold text-[#F96A1B]">
              Timed Examination Mode · Study Materials Locked
            </div>
            <h1 className="text-lg font-display font-extrabold text-[#0F2942]">
              {activeSession.title}
            </h1>
            <div className="text-xs text-[#526A84] mt-1 tabular-nums" data-testid="exam-pace-guidance">
              {answeredCount}/{activeSession.questions.length} Answered · {timerState.paceGuidance}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {/* Visual Progress Ring & Time-Left Pulse Meter */}
            <div
              data-testid="exam-timer-widget"
              data-urgency={timerState.urgencyLevel}
              className={`px-3.5 py-2 rounded-2xl border flex items-center gap-3.5 transition-colors ${
                timerState.isUrgent
                  ? 'bg-[#FFF2F0] border-[#F29C94] animate-urgent-time'
                  : timerState.urgencyLevel === 'warning'
                  ? 'bg-[#FFF9EE] border-[#FAD49B]'
                  : 'bg-[#F3F9FF] border-[#C5E0FA]'
              }`}
            >
              <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                {timerState.isUrgent && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full border-2 border-[#E53935] animate-urgent-halo pointer-events-none"
                  />
                )}
                <svg
                  width="56"
                  height="56"
                  viewBox="0 0 60 60"
                  role="progressbar"
                  aria-label="Exam time remaining"
                  aria-valuemin={0}
                  aria-valuemax={activeSession.timeLimitSeconds}
                  aria-valuenow={timerState.secondsLeft}
                  data-testid="exam-progress-ring"
                  className="-rotate-90"
                >
                  <circle cx="30" cy="30" r={ring.radius} fill="none" stroke={ringTrackColor} strokeWidth="5.5" />
                  <circle
                    cx="30"
                    cy="30"
                    r={ring.radius}
                    fill="none"
                    stroke={ringStrokeColor}
                    strokeWidth="5.5"
                    strokeLinecap="round"
                    strokeDasharray={ring.circumference}
                    strokeDashoffset={ring.strokeDashoffset}
                    data-testid="exam-progress-ring-arc"
                    className="transition-[stroke-dashoffset,stroke] duration-500 ease-linear"
                  />
                </svg>
                <span
                  className={`absolute inset-0 flex items-center justify-center text-[11px] font-extrabold tabular-nums ${
                    timerState.isUrgent
                      ? 'text-[#C62828]'
                      : timerState.urgencyLevel === 'warning'
                      ? 'text-[#B26A00]'
                      : 'text-[#0F2942]'
                  }`}
                >
                  {timerState.progressPercent}%
                </span>
              </div>

              <div className="min-w-[116px]">
                <div
                  data-testid="exam-urgency-badge"
                  className={`text-[11px] font-bold flex items-center gap-1 ${
                    timerState.isUrgent
                      ? 'text-[#C62828]'
                      : timerState.urgencyLevel === 'warning'
                      ? 'text-[#B26A00]'
                      : 'text-[#158EE3]'
                  }`}
                >
                  {timerState.isUrgent ? (
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{timerState.statusLabel}</span>
                </div>
                <div
                  data-testid="exam-time-left"
                  className={`font-mono text-2xl font-extrabold leading-tight tabular-nums ${
                    timerState.isUrgent
                      ? 'text-[#C62828]'
                      : timerState.urgencyLevel === 'warning'
                      ? 'text-[#9A5B00]'
                      : 'text-[#0F2942]'
                  }`}
                >
                  {timerState.formattedTime}
                </div>
              </div>
            </div>

            <button
              type="button"
              data-testid="submit-exam-btn"
              onClick={() => handleSubmitExam(false)}
              disabled={submitting}
              className="px-4 py-2.5 text-xs font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Submitting...' : 'Submit Paper'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#526A84]">
              <span className="font-semibold text-[#158EE3]">
                Question {currentIdx + 1} of {activeSession.questions.length}
                {currentSectionTitle ? ` · ${currentSectionTitle}` : ''}
              </span>
              <span className="tabular-nums">
                {q.attributes.cognitiveDomain}
                {q.marks ? ` · ${q.marks} mk` : ''}
              </span>
            </div>

            <h2 className="text-xl font-display font-bold text-[#0F2942]">{q.questionSi}</h2>
            {q.questionEn && q.questionEn !== q.questionSi && (
              <p className="text-sm text-[#526A84] -mt-3">{q.questionEn}</p>
            )}

            {q.imageUrl && (
              <div className="rounded-2xl border border-[#DCEBFA] bg-[#F8FBFF] p-3">
                <img
                  src={q.imageUrl}
                  alt="Exam question visual"
                  referrerPolicy="no-referrer"
                  className="max-h-52 mx-auto rounded-xl object-contain"
                />
              </div>
            )}

            {(qType === 'mcq' || qType === 'true_false') && (
              <div className="space-y-3">
                {q.options
                  .map((opt, idx) => ({ opt, idx }))
                  .filter((x) => x.opt && (qType === 'mcq' || x.idx < 2))
                  .map(({ opt, idx }) => {
                    const chosen = answers[qKey] === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setAnswers((prev) => ({ ...prev, [qKey]: idx }))}
                        className={`w-full p-3.5 rounded-2xl border-2 text-left font-medium flex items-center gap-3.5 transition-colors ${
                          chosen
                            ? 'bg-[#158EE3] border-[#1176BE] text-white'
                            : 'bg-white border-[#DCEBFA] text-[#0F2942] hover:bg-[#F3F9FF]'
                        }`}
                      >
                        <span
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                            chosen ? 'bg-white text-[#158EE3]' : 'bg-[#EBF5FF] text-[#158EE3]'
                          }`}
                        >
                          {letters[idx]}
                        </span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
              </div>
            )}

            {(qType === 'numerical' || qType === 'short_answer') && (
              <div className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#CBE2FA] space-y-2">
                <label htmlFor="exam-text-answer" className="block text-xs font-bold text-[#0F2942]">
                  {qType === 'numerical'
                    ? 'Enter your numerical answer'
                    : 'Write your short answer response'}
                </label>
                {qType === 'numerical' ? (
                  <input
                    id="exam-text-answer"
                    type="text"
                    value={textAnswers[qKey] || ''}
                    onChange={(e) =>
                      setTextAnswers((prev) => ({ ...prev, [qKey]: e.target.value }))
                    }
                    placeholder="e.g. 240"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#CBE2FA] rounded-xl"
                  />
                ) : (
                  <textarea
                    id="exam-text-answer"
                    rows={3}
                    value={textAnswers[qKey] || ''}
                    onChange={(e) =>
                      setTextAnswers((prev) => ({ ...prev, [qKey]: e.target.value }))
                    }
                    placeholder="Type your clear explanation or answer..."
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#CBE2FA] rounded-xl"
                  />
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-[#E5F0FA]">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => navigateToQuestion(Math.max(0, currentIdx - 1))}
                className="px-4 py-2 text-xs font-semibold text-[#0F2942] bg-[#F3F9FF] border border-[#DCEBFA] rounded-xl disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={currentIdx === activeSession.questions.length - 1}
                onClick={() =>
                  navigateToQuestion(Math.min(activeSession.questions.length - 1, currentIdx + 1))
                }
                className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] rounded-xl disabled:opacity-40"
              >
                Next Question
              </button>
            </div>
          </div>

          <aside className="lg:col-span-4 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-display font-bold text-[#0F2942]">
                  Question Navigator
                </h3>
                <span className="text-xs font-bold text-[#158EE3] tabular-nums">
                  {answeredCount}/{activeSession.questions.length} Answered
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2 mt-3">
                {activeSession.questions.map((item, idx) => {
                  const answered = isItemAnswered(item);
                  const active = idx === currentIdx;
                  return (
                    <button
                      key={item.snapshotId || item.id}
                      type="button"
                      onClick={() => navigateToQuestion(idx)}
                      className={`py-2 rounded-xl text-xs font-bold tabular-nums border ${
                        active
                          ? 'bg-[#F96A1B] border-[#DE580E] text-white'
                          : answered
                          ? 'bg-[#4CAF50] border-[#3E9642] text-white'
                          : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#526A84]'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#F3F9FF] border border-[#DCEBFA] text-xs space-y-1">
              <div className="font-bold text-[#0F2942]">Speed Check</div>
              <div className="text-[#526A84] tabular-nums">{timerState.paceGuidance}</div>
            </div>

            <div className="p-4 rounded-2xl bg-[#FFF6EB] border border-[#FAD49B] text-xs text-[#7A4400] flex items-start gap-2.5">
              <Lock className="w-4 h-4 shrink-0 mt-0.5 text-[#F96A1B]" />
              <div>
                <strong>Exam Integrity Rule:</strong> Psychological memory tricks and answer keys are locked until you submit this timed paper.
              </div>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // 3. Exam Paper Catalog
  const levels = [
    'All',
    'Foundation Simple',
    'Balanced Standard',
    'Advanced Challenging',
    'Scholarship Master',
  ];
  const visiblePapers =
    levelFilter === 'All'
      ? papers
      : papers.filter((p) => p.qualitySummary.categoryLevel === levelFilter);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-extrabold text-[#0F2942]">
            Timed Mock Exams &amp; Past Paper Hall
          </h1>
          <p className="text-xs text-[#526A84] mt-0.5">
            Choose your readiness level from Simple to Scholarship Master · Current Recommended Level:{' '}
            <strong className="text-[#158EE3]">{user.currentLevel}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
          {levels.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevelFilter(lvl)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                levelFilter === lvl
                  ? 'bg-[#F96A1B] text-white'
                  : 'text-[#526A84] hover:text-[#0F2942]'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-sm text-[#9A2F09] flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Structured Multi-Section Mock Examinations (Enhancement 03) */}
      {structuredExams.length > 0 && (
        <div className="space-y-3" data-testid="structured-mock-exams-catalog">
          <h2 className="text-sm font-display font-bold text-[#0F2942] px-1">
            Structured Multi-Section Mock Examinations ({structuredExams.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {structuredExams.map((ex) => {
              const exhausted =
                !ex.inProgressAttemptId && ex.myAttemptCount >= ex.maxAttempts;
              const canStartOrResume =
                (ex.status === 'PUBLISHED' || ex.status === 'ACTIVE') && !exhausted;

              return (
                <div
                  key={ex.id}
                  data-testid={`structured-exam-card-${ex.id}`}
                  className="bg-white rounded-3xl border border-[#99CAFA] p-6 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-bold text-[#158EE3]">{ex.id}</span>
                      <span className="font-bold text-[#2E7D32]">
                        {ex.sections.length} Sections · {ex.status}
                      </span>
                    </div>
                    <h3 className="text-lg font-display font-bold text-[#0F2942]">{ex.title}</h3>
                    {ex.titleSi && (
                      <div className="text-xs text-[#158EE3] font-medium">{ex.titleSi}</div>
                    )}
                    <p className="text-xs text-[#526A84]">
                      {ex.description || ex.instructions || 'Multi-type Grade 5 scholarship evaluation.'}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-2 text-xs pt-3 border-t border-[#E5F0FA] tabular-nums">
                      <div>
                        <div className="text-[#526A84]">Questions</div>
                        <div className="font-bold text-[#0F2942]">{ex.questionCount}</div>
                      </div>
                      <div>
                        <div className="text-[#526A84]">Marks</div>
                        <div className="font-bold text-[#0F2942]">{ex.totalMarks}</div>
                      </div>
                      <div>
                        <div className="text-[#526A84]">Duration</div>
                        <div className="font-bold text-[#0F2942]">
                          {ex.timeLimitMinutes ? `${ex.timeLimitMinutes}m` : 'Untimed'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#526A84]">Attempts</div>
                        <div className="font-bold text-[#0F2942]">
                          {ex.myAttemptCount}/{ex.maxAttempts}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {canStartOrResume && (
                        <button
                          type="button"
                          data-testid={`start-structured-${ex.id}`}
                          onClick={() => handleStartStructuredExam(ex.id)}
                          className="flex-1 py-2.5 px-4 text-xs font-bold text-white bg-[#F96A1B] hover:bg-[#DE580E] rounded-xl flex items-center justify-center gap-1.5"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>
                            {ex.inProgressAttemptId
                              ? 'Resume In-Progress Exam'
                              : `Start Mock Exam (${ex.timeLimitMinutes || 20} min)`}
                          </span>
                        </button>
                      )}
                      {ex.latestAttemptId && (
                        <button
                          type="button"
                          onClick={() => handleViewStructuredReview(ex.latestAttemptId!)}
                          className="py-2.5 px-4 text-xs font-bold text-[#158EE3] bg-[#EBF5FF] border border-[#99CAFA] rounded-xl"
                        >
                          {ex.latestScorePercent !== null
                            ? `View Result (${ex.latestScorePercent}%)`
                            : 'Check Submission Status'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-3xl border border-[#DCEBFA] p-12 text-center text-sm text-[#526A84]">
          Loading Grade 5 Scholarship exam papers...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {visiblePapers.map((paper) => {
            const lvlColor =
              paper.qualitySummary.categoryLevel === 'Foundation Simple'
                ? 'text-[#2E7D32]'
                : paper.qualitySummary.categoryLevel === 'Balanced Standard'
                ? 'text-[#158EE3]'
                : paper.qualitySummary.categoryLevel === 'Advanced Challenging'
                ? 'text-[#D97706]'
                : 'text-[#C62828]';

            return (
              <div
                key={paper.id}
                className="bg-white rounded-3xl border border-[#DCEBFA] p-6 flex flex-col justify-between gap-5"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={`font-bold ${lvlColor}`}>
                      {paper.qualitySummary.categoryLevel}
                    </span>
                    <span className="text-[#526A84] tabular-nums">
                      Quality Index: {paper.qualitySummary.qualityIndex}/100
                    </span>
                  </div>
                  <h2 className="text-lg font-display font-bold text-[#0F2942]">{paper.title}</h2>
                  <div className="text-xs text-[#158EE3] font-medium">{paper.titleSi}</div>
                  <p className="text-xs text-[#526A84] leading-relaxed">{paper.description}</p>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 text-xs pt-3 border-t border-[#E5F0FA]">
                    <div>
                      <div className="text-[#526A84]">Questions</div>
                      <div className="font-bold text-[#0F2942] tabular-nums">
                        {paper.quizIds.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#526A84]">Time Limit</div>
                      <div className="font-bold text-[#0F2942] tabular-nums">
                        {paper.durationMinutes} min
                      </div>
                    </div>
                    <div>
                      <div className="text-[#526A84]">Pass Mark</div>
                      <div className="font-bold text-[#0F2942] tabular-nums">
                        {paper.qualitySummary.estimatedPassMark}%
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleStartPaper(paper.id)}
                    className="w-full py-2.5 px-4 text-sm font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Start Timed Paper ({paper.durationMinutes} min)</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
