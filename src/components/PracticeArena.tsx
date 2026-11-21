import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Clock,
  HelpCircle,
  Layers,
  Play,
  Send,
  Shuffle,
  SkipForward,
  Star,
  XCircle,
} from 'lucide-react';
import {
  api,
  AssessmentAttemptReviewItem,
  AuthUser,
  StudentAssessmentListItem,
} from '../lib/api';
import { COGNITIVE_DOMAINS } from '../lib/psychometrics';
import {
  PRACTICE_LEVEL_MODES,
  filterQuestionStreamByProficiency,
  resolvePracticeStreamConfig,
  type PracticeLevelMode,
} from '../lib/practiceAdaptive';
import type {
  AssessmentAttemptRecord,
  AssessmentRecord,
  AssessmentSection,
  QuizItem,
  StudentQuizView,
  StudentTrajectory,
  SubjectCategory,
  SubtopicNode,
  TopicNode,
} from '../lib/types';
import { MascotAvatar } from './BrandVisuals';
import { MnemonicFlashcardLab } from './MnemonicFlashcardLab';
import { StudentKnowledgeHub } from './StudentKnowledgeHub';
import { StudyBuddySidebar } from './StudyBuddySidebar';

export interface PracticeInitialFocus {
  subjectId?: string;
  topicId?: string;
  subtopicId?: string;
  questionId?: string;
  interventionCaseId?: string;
  initialMode?: 'quiz' | 'flashcards' | 'knowledge';
  publicationId?: string;
  scheduledSessionId?: string;
  scheduledSessionTitle?: string;
  preloadedQuizzes?: QuizItem[];
  fixedAssessmentId?: string;
}

interface PracticeArenaProps {
  user: AuthUser;
  trajectory?: StudentTrajectory | null;
  subjects?: SubjectCategory[];
  topics?: TopicNode[];
  subtopics?: SubtopicNode[];
  initialFocus?: PracticeInitialFocus | null;
  onConsumeInitialFocus?: () => void;
  onUserAndTrajectoryUpdate: (user: AuthUser, trajectory?: StudentTrajectory) => void;
}

export function PracticeArena({
  user,
  trajectory,
  subjects = [],
  topics = [],
  subtopics = [],
  initialFocus,
  onConsumeInitialFocus,
  onUserAndTrajectoryUpdate,
}: PracticeArenaProps) {
  const [arenaMode, setArenaMode] = useState<'quiz' | 'flashcards' | 'knowledge'>(
    initialFocus?.initialMode || 'quiz'
  );
  const [initialPublicationId, setInitialPublicationId] = useState<string | null>(
    initialFocus?.publicationId || null
  );
  const [flashcardShuffleCounter, setFlashcardShuffleCounter] = useState(0);
  const [levelMode, setLevelMode] = useState<PracticeLevelMode>('Medium');
  const [domain, setDomain] = useState<string>('All');
  const [subjectId, setSubjectId] = useState<string>(initialFocus?.subjectId || 'All');
  const [topicId, setTopicId] = useState<string>(initialFocus?.topicId || 'All');
  const [subtopicId, setSubtopicId] = useState<string>(initialFocus?.subtopicId || 'All');
  const [pinnedQuestionId, setPinnedQuestionId] = useState<string | undefined>(
    initialFocus?.questionId
  );
  const [interventionCaseId, setInterventionCaseId] = useState<string | undefined>(
    initialFocus?.interventionCaseId
  );

  // Assigned Practice Sessions (Enhancement 03)
  const [assignedSessions, setAssignedSessions] = useState<StudentAssessmentListItem[]>([]);
  const [activePracticeSession, setActivePracticeSession] = useState<{
    attempt: AssessmentAttemptRecord;
    assessment: AssessmentRecord;
    sections: AssessmentSection[];
    questions: StudentQuizView[];
    secondsRemaining: number;
  } | null>(null);
  const [spIdx, setSpIdx] = useState(0);
  const [spSecondsLeft, setSpSecondsLeft] = useState<number | null>(null);
  const [spOptionAnswers, setSpOptionAnswers] = useState<Record<string, number>>({});
  const [spTextAnswers, setSpTextAnswers] = useState<Record<string, string>>({});
  const [spHintShown, setSpHintShown] = useState<Record<string, boolean>>({});
  const [spFeedbackBySnap, setSpFeedbackBySnap] = useState<
    Record<
      string,
      {
        isCorrect: boolean | null;
        markingStatus: 'auto_graded' | 'pending_manual';
        correctDisplayOptionIndex: number | null;
        acceptedAnswers: string[];
        explanation: string;
        memoryTrickTitle: string;
        memoryTrickBody: string;
      }
    >
  >({});
  const [spReviewResult, setSpReviewResult] = useState<{
    attempt: AssessmentAttemptRecord;
    assessment: AssessmentRecord;
    resultsReleased: boolean;
    awaitingReleaseNotice: string | null;
    items: AssessmentAttemptReviewItem[];
  } | null>(null);
  const [spBusy, setSpBusy] = useState(false);

  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [totalAvailable, setTotalAvailable] = useState(500008);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showStudyTrick, setShowStudyTrick] = useState(false);
  const [hintUsedBeforeAnswer, setHintUsedBeforeAnswer] = useState(false);
  const [scoreCount, setScoreCount] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [consecutiveWrongCount, setConsecutiveWrongCount] = useState(0);
  const [masteredCueIds, setMasteredCueIds] = useState<string[]>([]);
  const [domainBreakdown, setDomainBreakdown] = useState<
    Record<string, { correct: number; total: number }>
  >({});
  const [roundAttemptItems, setRoundAttemptItems] = useState<
    {
      quizId: string;
      selectedIndex: number | null;
      isCorrect: boolean;
      hintsUsed: boolean;
    }[]
  >([]);
  const [activeScheduledSessionId, setActiveScheduledSessionId] = useState<string | undefined>(
    initialFocus?.scheduledSessionId
  );
  const [activeScheduledTitle, setActiveScheduledTitle] = useState<string | undefined>(
    initialFocus?.scheduledSessionTitle
  );
  const [startedAtMs, setStartedAtMs] = useState<number>(Date.now());
  const [questionStartedAtMs, setQuestionStartedAtMs] = useState<number>(Date.now());
  const [practiceSessionId, setPracticeSessionId] = useState<string>(
    () => `PR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  const [roundResult, setRoundResult] = useState<{
    starsEarned: number;
    scorePercent: number;
    nextLevel: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAssignedPracticeSessions = async () => {
    try {
      const res = await api.getStudentAssessments();
      setAssignedSessions(res.assessments.filter((a) => a.kind === 'practice_session'));
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    loadAssignedPracticeSessions();
  }, []);

  useEffect(() => {
    if (!initialFocus) return;
    if (initialFocus.initialMode) {
      setArenaMode(initialFocus.initialMode);
    }
    if (initialFocus.publicationId) {
      setInitialPublicationId(initialFocus.publicationId);
    }
    setSubjectId(initialFocus.subjectId || 'All');
    setTopicId(initialFocus.topicId || 'All');
    setSubtopicId(initialFocus.subtopicId || 'All');
    setPinnedQuestionId(initialFocus.questionId);
    setInterventionCaseId(initialFocus.interventionCaseId);
    setActiveScheduledSessionId(initialFocus.scheduledSessionId);
    setActiveScheduledTitle(initialFocus.scheduledSessionTitle);
    if (initialFocus.preloadedQuizzes && initialFocus.preloadedQuizzes.length > 0) {
      setQuizzes(initialFocus.preloadedQuizzes);
      setTotalAvailable(initialFocus.preloadedQuizzes.length);
      setCurrentIndex(0);
      setSelectedOption(null);
      setShowStudyTrick(false);
      setHintUsedBeforeAnswer(false);
      setScoreCount(0);
      setAnsweredCount(0);
      setConsecutiveWrongCount(0);
      setDomainBreakdown({});
      setRoundAttemptItems([]);
      const now = Date.now();
      setStartedAtMs(now);
      setQuestionStartedAtMs(now);
      setRoundResult(null);
      setLoading(false);
    } else if (initialFocus.fixedAssessmentId) {
      handleStartAssignedPractice(initialFocus.fixedAssessmentId);
    }
    onConsumeInitialFocus?.();
  }, [initialFocus]);

  const activeProficiency = trajectory?.currentLevel ?? user.currentLevel;
  const activeStreamConfig = resolvePracticeStreamConfig({
    levelMode,
    proficiencyLevel: activeProficiency,
  });

  const loadRound = async (customSeed?: number, clearPinned = false) => {
    setLoading(true);
    setErrorMsg(null);
    const activeQuestionPin = clearPinned ? undefined : pinnedQuestionId;
    if (clearPinned) {
      setPinnedQuestionId(undefined);
      setInterventionCaseId(undefined);
      setActiveScheduledSessionId(undefined);
      setActiveScheduledTitle(undefined);
    }
    try {
      const res = await api.getPracticeRound({
        levelMode,
        proficiency: activeProficiency,
        domain,
        subjectId,
        topicId,
        subtopicId,
        questionId: activeQuestionPin,
        count: 8,
        seed: customSeed || Math.floor(Math.random() * 999_999) + 1,
      });
      const { filtered } = filterQuestionStreamByProficiency(res.quizzes, {
        levelMode,
        trajectory,
        fallbackLevel: user.currentLevel,
      });
      const finalPool =
        activeQuestionPin || filtered.length === 0 ? res.quizzes : filtered;
      setQuizzes(finalPool);
      setTotalAvailable(res.totalAvailablePool);
      setCurrentIndex(0);
      setSelectedOption(null);
      setShowStudyTrick(false);
      setHintUsedBeforeAnswer(false);
      setScoreCount(0);
      setAnsweredCount(0);
      setConsecutiveWrongCount(0);
      setDomainBreakdown({});
      setRoundAttemptItems([]);
      const now = Date.now();
      setStartedAtMs(now);
      setQuestionStartedAtMs(now);
      setPracticeSessionId(`PR-${now}-${Math.random().toString(36).slice(2, 6)}`);
      setRoundResult(null);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialFocus?.preloadedQuizzes && initialFocus.preloadedQuizzes.length > 0) return;
    if (activeScheduledSessionId && quizzes.length > 0) return;
    loadRound();
  }, [levelMode, activeProficiency, domain, subjectId, topicId, subtopicId, pinnedQuestionId]);

  const handleStartAssignedPractice = async (assessmentId: string) => {
    setErrorMsg(null);
    setSpReviewResult(null);
    setSpBusy(true);
    try {
      const res = await api.startOrResumeAssessment(assessmentId);
      setActivePracticeSession({
        attempt: res.attempt,
        assessment: res.assessment,
        sections: res.sections,
        questions: res.questions,
        secondsRemaining: res.secondsRemaining,
      });
      setSpSecondsLeft(
        res.assessment.timeLimitMinutes && res.secondsRemaining > 0 ? res.secondsRemaining : null
      );
      const opts: Record<string, number> = {};
      const texts: Record<string, string> = {};
      for (const sa of res.savedAnswers) {
        if (typeof sa.submittedOptionIndex === 'number') opts[sa.snapshotId] = sa.submittedOptionIndex;
        if (sa.submittedAnswerText) texts[sa.snapshotId] = sa.submittedAnswerText;
      }
      setSpOptionAnswers(opts);
      setSpTextAnswers(texts);
      setSpHintShown({});
      setSpFeedbackBySnap({});
      setSpIdx(0);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSpBusy(false);
    }
  };

  const savePracticeDraftProgress = async (
    nextOpts = spOptionAnswers,
    nextTexts = spTextAnswers
  ) => {
    if (!activePracticeSession) return;
    try {
      await api.saveAssessmentProgress(activePracticeSession.assessment.id, {
        attemptId: activePracticeSession.attempt.id,
        answers: activePracticeSession.questions.map((q) => {
          const key = q.snapshotId || q.id;
          return {
            snapshotId: key,
            questionId: q.id,
            submittedOptionIndex: typeof nextOpts[key] === 'number' ? nextOpts[key] : null,
            submittedAnswerText: nextTexts[key] ?? null,
          };
        }),
      });
    } catch {
      // non-blocking autosave
    }
  };

  const handleCheckPracticeImmediate = async (snapKey: string, qId: string) => {
    if (!activePracticeSession) return;
    try {
      const res = await api.checkPracticeAnswer(activePracticeSession.assessment.id, {
        attemptId: activePracticeSession.attempt.id,
        snapshotId: snapKey,
        submittedOptionIndex: typeof spOptionAnswers[snapKey] === 'number' ? spOptionAnswers[snapKey] : null,
        submittedAnswerText: spTextAnswers[snapKey] ?? null,
      });
      setSpFeedbackBySnap((prev) => ({
        ...prev,
        [snapKey]: {
          isCorrect: res.isCorrect,
          markingStatus: res.markingStatus,
          correctDisplayOptionIndex: res.correctDisplayOptionIndex,
          acceptedAnswers: res.acceptedAnswers,
          explanation: res.explanation,
          memoryTrickTitle: res.memoryTrickTitle,
          memoryTrickBody: res.memoryTrickBody,
        },
      }));
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleSaveAndSubmitPracticeSession = async (timedOut = false) => {
    if (!activePracticeSession || spBusy) return;
    setSpBusy(true);
    setErrorMsg(null);
    try {
      const answersPayload = activePracticeSession.questions.map((q) => {
        const key = q.snapshotId || q.id;
        return {
          snapshotId: key,
          questionId: q.id,
          submittedOptionIndex: typeof spOptionAnswers[key] === 'number' ? spOptionAnswers[key] : null,
          submittedAnswerText: spTextAnswers[key] ?? null,
        };
      });
      const hintUsedIds = activePracticeSession.questions
        .filter((q) => spHintShown[q.snapshotId || q.id])
        .map((q) => q.id);

      const res = await api.submitAssessmentAttempt(activePracticeSession.assessment.id, {
        attemptId: activePracticeSession.attempt.id,
        idempotencyKey: `sp-${activePracticeSession.attempt.id}`,
        answers: answersPayload,
        hintUsedQuestionIds: hintUsedIds,
        timedOut,
      });
      if (activeScheduledSessionId) {
        await api
          .completeScheduledSession(activeScheduledSessionId, res.attempt.id)
          .catch(() => {});
        setActiveScheduledSessionId(undefined);
      }
      setSpReviewResult(res.review);
      setActivePracticeSession(null);
      setSpSecondsLeft(null);
      onUserAndTrajectoryUpdate(res.user, res.trajectory);
      await loadAssignedPracticeSessions();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSpBusy(false);
    }
  };

  useEffect(() => {
    if (!activePracticeSession || !activePracticeSession.assessment.timeLimitMinutes) return;
    const timer = window.setInterval(() => {
      setSpSecondsLeft((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          window.clearInterval(timer);
          handleSaveAndSubmitPracticeSession(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activePracticeSession?.attempt.id]);

  const currentQuiz = quizzes[currentIndex];

  const handleSelectOption = (idx: number) => {
    if (selectedOption !== null || !currentQuiz) return;
    setSelectedOption(idx);
    setShowStudyTrick(true);
    const isCorrect = idx === currentQuiz.correctIndex;
    if (isCorrect) {
      setScoreCount((s) => s + 1);
      setConsecutiveWrongCount(0);
    } else {
      setConsecutiveWrongCount((w) => w + 1);
    }
    setAnsweredCount((c) => c + 1);

    const dom = currentQuiz.attributes.cognitiveDomain;
    setDomainBreakdown((prev) => {
      const existing = prev[dom] || { correct: 0, total: 0 };
      return {
        ...prev,
        [dom]: {
          correct: existing.correct + (isCorrect ? 1 : 0),
          total: existing.total + 1,
        },
      };
    });
    setRoundAttemptItems((prev) => {
      const filtered = prev.filter((p) => p.quizId !== currentQuiz.id);
      return [
        ...filtered,
        {
          quizId: currentQuiz.id,
          selectedIndex: idx,
          isCorrect,
          hintsUsed: hintUsedBeforeAnswer,
        },
      ];
    });

    const durationMs = Math.max(400, Date.now() - questionStartedAtMs);
    api
      .submitQuestionAttempt({
        questionId: currentQuiz.id,
        submittedAnswerIndex: idx,
        submissionStatus: 'valid_answered',
        responseDurationMs: durationMs,
        hintUsed: hintUsedBeforeAnswer,
        contextMode: interventionCaseId ? 'targeted_intervention' : 'practice',
        sessionId: practiceSessionId,
        deliveryContext: {
          adaptiveLevelMode: levelMode,
          ...(interventionCaseId ? { interventionCaseId } : {}),
        },
        idempotencyKey: `${practiceSessionId}-${currentIndex}-${currentQuiz.id}`,
        awardPracticeXp: true,
      })
      .then((res) => {
        onUserAndTrajectoryUpdate(res.user);
      })
      .catch(() => {
        // non-blocking attempt persistence
      });
  };

  const handleSkipQuestion = async () => {
    if (selectedOption !== null || !currentQuiz) return;
    setRoundAttemptItems((prev) => {
      const filtered = prev.filter((p) => p.quizId !== currentQuiz.id);
      return [
        ...filtered,
        {
          quizId: currentQuiz.id,
          selectedIndex: null,
          isCorrect: false,
          hintsUsed: hintUsedBeforeAnswer,
        },
      ];
    });
    const durationMs = Math.max(400, Date.now() - questionStartedAtMs);
    api
      .submitQuestionAttempt({
        questionId: currentQuiz.id,
        submittedAnswerIndex: null,
        submissionStatus: 'skipped',
        responseDurationMs: durationMs,
        hintUsed: hintUsedBeforeAnswer,
        contextMode: interventionCaseId ? 'targeted_intervention' : 'practice',
        sessionId: practiceSessionId,
        deliveryContext: {
          adaptiveLevelMode: levelMode,
          ...(interventionCaseId ? { interventionCaseId } : {}),
        },
        idempotencyKey: `${practiceSessionId}-${currentIndex}-${currentQuiz.id}-skip`,
        awardPracticeXp: false,
      })
      .catch(() => {
        // non-blocking
      });
    await handleNextOrFinish();
  };

  const handleNextOrFinish = async () => {
    if (currentIndex < quizzes.length - 1) {
      setCurrentIndex((i) => i + 1);
      setSelectedOption(null);
      setShowStudyTrick(false);
      setHintUsedBeforeAnswer(false);
      setQuestionStartedAtMs(Date.now());
      return;
    }

    try {
      const elapsed = Math.max(15, Math.round((Date.now() - startedAtMs) / 1000));
      const res = await api.completePracticeRound({
        totalQuestions: quizzes.length,
        correctCount: scoreCount,
        timeSpentSeconds: elapsed,
        domainBreakdown,
        items: roundAttemptItems,
        paperTitle: activeScheduledTitle,
        scheduledSessionId: activeScheduledSessionId,
      });
      setActiveScheduledSessionId(undefined);
      setRoundResult({
        starsEarned: res.attempt.starsEarned,
        scorePercent: res.attempt.scorePercent,
        nextLevel: res.trajectory.recommendedNextLevel,
      });
      onUserAndTrajectoryUpdate(res.user, res.trajectory);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const letters = ['A', 'B', 'C', 'D'];
  const visibleTopics =
    subjectId === 'All' ? topics : topics.filter((t) => t.subjectId === subjectId);
  const visibleSubtopics =
    topicId === 'All'
      ? subjectId === 'All'
        ? subtopics
        : subtopics.filter((st) => st.subjectId === subjectId)
      : subtopics.filter((st) => st.topicId === topicId);

  return (
    <div className="space-y-6">
      {/* Practice Controls & Filters */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-extrabold text-[#0F2942]">
            500,000+ Shuffled Practice &amp; Memory Lab
          </h1>
          <p
            data-testid="practice-stream-summary"
            className="text-xs text-[#526A84] mt-0.5 tabular-nums"
          >
            Active Pool: {totalAvailable.toLocaleString()} Bilingual Quizzes · Proficiency:{' '}
            <strong className="text-[#0F2942]">{activeStreamConfig.proficiencyLevel}</strong> · Stream:{' '}
            <strong className="text-[#158EE3]">{activeStreamConfig.allowedTiers.join(' + ')}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Practice Arena Mode"
            data-testid="practice-mode-toggle"
            className="flex items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]"
          >
            <button
              type="button"
              aria-pressed={arenaMode === 'quiz'}
              onClick={() => setArenaMode('quiz')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                arenaMode === 'quiz'
                  ? 'bg-[#0F2942] text-white'
                  : 'text-[#526A84] hover:text-[#0F2942]'
              }`}
            >
              Quiz Practice
            </button>
            <button
              type="button"
              aria-pressed={arenaMode === 'flashcards'}
              data-testid="open-flashcards-mode"
              onClick={() => setArenaMode('flashcards')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                arenaMode === 'flashcards'
                  ? 'bg-[#158EE3] text-white'
                  : 'text-[#526A84] hover:text-[#0F2942]'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>Mnemonic Flashcards</span>
            </button>
            <button
              type="button"
              aria-pressed={arenaMode === 'knowledge'}
              data-testid="open-knowledge-mode"
              onClick={() => setArenaMode('knowledge')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                arenaMode === 'knowledge'
                  ? 'bg-[#2E7D32] text-white'
                  : 'text-[#526A84] hover:text-[#0F2942]'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span>Knowledge Hub</span>
            </button>
          </div>

          {arenaMode === 'quiz' && !activePracticeSession && (
            <div
              role="group"
              aria-label="Practice Difficulty Level"
              data-testid="practice-level-toggle"
              className="flex items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]"
            >
              {PRACTICE_LEVEL_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={levelMode === mode}
                  onClick={() => setLevelMode(mode)}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    levelMode === mode
                      ? mode === 'Easy'
                        ? 'bg-[#4CAF50] text-white'
                        : mode === 'Medium'
                        ? 'bg-[#158EE3] text-white'
                        : 'bg-[#F96A1B] text-white'
                      : 'text-[#526A84] hover:text-[#0F2942]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}

          {subjects.length > 0 && arenaMode === 'quiz' && !activePracticeSession && (
            <>
              <select
                aria-label="Filter practice by subject"
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setTopicId('All');
                  setSubtopicId('All');
                  setPinnedQuestionId(undefined);
                }}
                className="px-3 py-2 text-xs font-semibold text-[#0F2942] bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
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
                  aria-label="Filter practice by topic"
                  value={topicId}
                  onChange={(e) => {
                    setTopicId(e.target.value);
                    setSubtopicId('All');
                    setPinnedQuestionId(undefined);
                  }}
                  className="px-3 py-2 text-xs font-semibold text-[#0F2942] bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                >
                  <option value="All">All Topics</option>
                  {visibleTopics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameEn}
                    </option>
                  ))}
                </select>
              )}

              {visibleSubtopics.length > 0 && (
                <select
                  aria-label="Filter practice by subtopic"
                  value={subtopicId}
                  onChange={(e) => {
                    setSubtopicId(e.target.value);
                    setPinnedQuestionId(undefined);
                  }}
                  className="px-3 py-2 text-xs font-semibold text-[#0F2942] bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                >
                  <option value="All">All Subtopics</option>
                  {visibleSubtopics.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.nameEn}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          {arenaMode !== 'knowledge' && !activePracticeSession && (
            <>
              <select
                aria-label="Filter by cognitive domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="px-3 py-2 text-xs font-semibold text-[#0F2942] bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="All">All Intelligence Domains</option>
                {COGNITIVE_DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() =>
                  arenaMode === 'flashcards'
                    ? setFlashcardShuffleCounter((c) => c + 1)
                    : loadRound(undefined, true)
                }
                className="px-4 py-2 text-xs font-bold text-white bg-[#F96A1B] hover:bg-[#DE580E] rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>{arenaMode === 'flashcards' ? 'Shuffle Cards' : 'Shuffle New Round'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {interventionCaseId && arenaMode === 'quiz' && (
        <div className="p-3.5 rounded-2xl bg-[#EBF5FF] border border-[#99CAFA] text-xs text-[#0E4F80] flex items-center justify-between gap-3">
          <span>
            <strong>Assigned Teacher Practice Active:</strong> Solve carefully and use the memory trick if needed — your steady progress updates your learning plan automatically!
          </span>
          <button
            type="button"
            onClick={() => loadRound(undefined, true)}
            className="text-xs font-bold text-[#158EE3] hover:underline shrink-0"
          >
            Exit Focus
          </button>
        </div>
      )}

      {arenaMode === 'knowledge' ? (
        <StudentKnowledgeHub
          user={user}
          subjects={subjects}
          topics={topics}
          initialPublicationId={initialPublicationId}
          onConsumeInitialPublication={() => setInitialPublicationId(null)}
          onPracticeLinkedTopic={(subjId, topId, qId) => {
            setSubjectId(subjId || 'All');
            setTopicId(topId || 'All');
            setSubtopicId('All');
            setPinnedQuestionId(qId);
            setArenaMode('quiz');
          }}
        />
      ) : arenaMode === 'flashcards' ? (
        <MnemonicFlashcardLab
          selectedDomain={domain}
          studentFirstName={user.name.split(' ')[0]}
          externalShuffleCounter={flashcardShuffleCounter}
        />
      ) : spReviewResult ? (
        <div
          data-testid="practice-session-review"
          className="bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E5F0FA]">
            <div>
              <h2 className="text-xl font-display font-extrabold text-[#0F2942]">
                Practice Session Complete · {spReviewResult.assessment.title}
              </h2>
              <p className="text-xs text-[#2E7D32] font-semibold mt-0.5">
                {spReviewResult.attempt.status === 'pending_manual_marking'
                  ? 'Written short-answer responses saved for teacher marking · Objective score recorded'
                  : `Score: ${spReviewResult.attempt.scorePercent ?? 0}% (${spReviewResult.attempt.totalAwardedMarks}/${spReviewResult.attempt.maxMarks} marks)`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSpReviewResult(null)}
              className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] rounded-xl"
            >
              Back to Adaptive Practice
            </button>
          </div>
          <div className="space-y-3">
            {spReviewResult.items.map((it) => (
              <div
                key={it.snapshotId}
                className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-1.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-bold text-[#0F2942]">
                    {it.sortOrder}. {it.questionSi}
                  </div>
                  <span
                    className={`font-bold shrink-0 ${
                      it.markingStatus === 'pending_manual'
                        ? 'text-[#D97706]'
                        : it.isCorrect
                        ? 'text-[#2E7D32]'
                        : 'text-[#C62828]'
                    }`}
                  >
                    {it.markingStatus === 'pending_manual'
                      ? 'Pending Teacher Mark'
                      : `${it.awardedMarks}/${it.maxMarks} mks`}
                  </span>
                </div>
                <div className="text-[#476481]">
                  {it.explanation}
                </div>
                {it.memoryTrickBody && (
                  <div className="p-2.5 rounded-xl bg-[#FFF9EE] border border-[#FDE1B2] text-[#613C00]">
                    <strong>{it.memoryTrickTitle}:</strong> {it.memoryTrickBody}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : activePracticeSession ? (
        (() => {
          const sq = activePracticeSession.questions[spIdx];
          const key = sq.snapshotId || sq.id;
          const qType = sq.questionType || 'mcq';
          const isImmediateFeedback =
            activePracticeSession.assessment.explanationTiming === 'immediate';
          const feedback = spFeedbackBySnap[key];
          const hasAnswerForCurrent =
            typeof spOptionAnswers[key] === 'number' || Boolean(spTextAnswers[key]?.trim());
          const formattedTimer =
            spSecondsLeft !== null
              ? `${String(Math.floor(spSecondsLeft / 60)).padStart(2, '0')}:${String(
                  spSecondsLeft % 60
                ).padStart(2, '0')}`
              : null;

          return (
            <div
              data-testid="active-practice-session"
              className="bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8 space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E5F0FA]">
                <div>
                  <div className="text-xs font-bold text-[#158EE3]">
                    Assigned Practice Session · {activePracticeSession.assessment.title}
                  </div>
                  <div className="text-xs text-[#526A84] mt-0.5 tabular-nums">
                    Question {spIdx + 1} of {activePracticeSession.questions.length} ·{' '}
                    {sq.marks || 1} mark(s) · {qType.replace('_', ' ').toUpperCase()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {activePracticeSession.assessment.timeLimitMinutes && (
                    <span
                      data-testid="practice-session-timer"
                      className={`px-3 py-1.5 text-xs font-bold rounded-xl border flex items-center gap-1 tabular-nums ${
                        spSecondsLeft !== null && spSecondsLeft <= 60
                          ? 'text-[#C62828] bg-[#FFF2ED] border-[#FAC5B2]'
                          : 'text-[#0F2942] bg-[#F3F9FF] border-[#CBE2FA]'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5 text-[#158EE3]" />
                      <span>
                        {formattedTimer
                          ? `${formattedTimer} left`
                          : `${activePracticeSession.assessment.timeLimitMinutes} min guide`}
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await savePracticeDraftProgress();
                      setActivePracticeSession(null);
                      setSpSecondsLeft(null);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-[#526A84] bg-[#F8FBFF] border border-[#DCEBFA] rounded-xl"
                  >
                    Save &amp; Exit
                  </button>
                </div>
              </div>

              <div>
                <h2 className="text-xl font-display font-bold text-[#0F2942]">{sq.questionSi}</h2>
                {sq.questionEn && sq.questionEn !== sq.questionSi && (
                  <p className="text-sm text-[#526A84] mt-1">{sq.questionEn}</p>
                )}
                {sq.imageUrl && (
                  <div className="mt-3 rounded-2xl border border-[#DCEBFA] bg-[#F8FBFF] p-3">
                    <img
                      src={sq.imageUrl}
                      alt="Practice question diagram"
                      referrerPolicy="no-referrer"
                      className="max-h-52 mx-auto rounded-xl object-contain"
                    />
                  </div>
                )}
              </div>

              {(qType === 'mcq' || qType === 'true_false') && (
                <div className="space-y-2.5">
                  {sq.options
                    .map((opt, idx) => ({ opt, idx }))
                    .filter((x) => x.opt && (qType === 'mcq' || x.idx < 2))
                    .map(({ opt, idx }) => {
                      const chosen = spOptionAnswers[key] === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            const nextOpts = { ...spOptionAnswers, [key]: idx };
                            setSpOptionAnswers(nextOpts);
                            savePracticeDraftProgress(nextOpts, spTextAnswers);
                          }}
                          className={`w-full p-3.5 rounded-2xl border-2 text-left font-medium flex items-center gap-3 transition-colors ${
                            chosen
                              ? 'bg-[#158EE3] border-[#1176BE] text-white'
                              : 'bg-white border-[#DCEBFA] text-[#0F2942] hover:bg-[#F3F9FF]'
                          }`}
                        >
                          <span
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
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
                  <label htmlFor="sp-text-input" className="block text-xs font-bold text-[#0F2942]">
                    {qType === 'numerical' ? 'Enter Numerical Answer' : 'Enter Short Answer'}
                  </label>
                  <input
                    id="sp-text-input"
                    type="text"
                    value={spTextAnswers[key] || ''}
                    onChange={(e) =>
                      setSpTextAnswers((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={qType === 'numerical' ? 'e.g. 24' : 'Type your answer...'}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#CBE2FA] rounded-xl"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {activePracticeSession.assessment.showHints && sq.hint && (
                  <button
                    type="button"
                    onClick={() =>
                      setSpHintShown((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                    className="px-3 py-1.5 text-xs font-semibold text-[#7C4D00] bg-[#FFF7EB] border border-[#FDE1B2] rounded-xl inline-flex items-center gap-1.5"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>{spHintShown[key] ? 'Hide Hint' : 'Show Guided Hint'}</span>
                  </button>
                )}

                {isImmediateFeedback && hasAnswerForCurrent && (
                  <button
                    type="button"
                    data-testid="check-practice-answer-btn"
                    onClick={() => handleCheckPracticeImmediate(key, sq.id)}
                    className="px-3.5 py-1.5 text-xs font-bold text-[#0E4F80] bg-[#EBF5FF] border border-[#99CAFA] rounded-xl hover:bg-[#DCEEFF]"
                  >
                    Check Answer &amp; Explanation
                  </button>
                )}
              </div>

              {activePracticeSession.assessment.showHints && sq.hint && spHintShown[key] && (
                <div className="p-3 rounded-xl bg-[#FFF9EE] border border-[#FDE1B2] text-xs text-[#613C00]">
                  <strong>Guided Hint:</strong> {sq.hint}
                </div>
              )}

              {feedback && (
                <div
                  data-testid="practice-immediate-feedback"
                  className={`p-4 rounded-2xl border space-y-2 text-xs ${
                    feedback.markingStatus === 'pending_manual'
                      ? 'bg-[#FFF9EE] border-[#F5D399] text-[#7C4D00]'
                      : feedback.isCorrect
                      ? 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                      : 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                  }`}
                >
                  <div className="font-bold text-sm">
                    {feedback.markingStatus === 'pending_manual'
                      ? 'Saved for Teacher Marking'
                      : feedback.isCorrect
                      ? 'Correct!'
                      : 'Review Explanation'}
                  </div>
                  <div className="text-[#0F2942]">{feedback.explanation}</div>
                  {feedback.memoryTrickBody && (
                    <div className="p-2.5 rounded-xl bg-white/80 border border-[#FDE1B2] text-[#613C00]">
                      <strong>{feedback.memoryTrickTitle}:</strong> {feedback.memoryTrickBody}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#E5F0FA]">
                <button
                  type="button"
                  disabled={spIdx === 0}
                  onClick={() => {
                    savePracticeDraftProgress();
                    setSpIdx((i) => Math.max(0, i - 1));
                  }}
                  className="px-4 py-2 text-xs font-semibold text-[#0F2942] bg-[#F3F9FF] border border-[#DCEBFA] rounded-xl disabled:opacity-40"
                >
                  Previous
                </button>
                <div className="flex items-center gap-2">
                  {spIdx < activePracticeSession.questions.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        savePracticeDraftProgress();
                        setSpIdx((i) =>
                          Math.min(activePracticeSession.questions.length - 1, i + 1)
                        );
                      }}
                      className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] rounded-xl"
                    >
                      Next Question
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-testid="submit-practice-session-btn"
                    disabled={spBusy}
                    onClick={() => handleSaveAndSubmitPracticeSession(false)}
                    className="px-4 py-2 text-xs font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{spBusy ? 'Submitting...' : 'Submit Practice Session'}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      ) : (
        <>
          {/* Compact Teacher/Admin Assigned Practice Sessions Strip */}
          {assignedSessions.length > 0 && (
            <div
              data-testid="assigned-practice-sessions-strip"
              className="bg-white rounded-3xl border border-[#DCEBFA] p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold text-[#0F2942] flex items-center gap-1.5">
                  <ClipboardList className="w-4 h-4 text-[#158EE3]" />
                  <span>Assigned Teacher &amp; Custom Practice Sessions ({assignedSessions.length})</span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {assignedSessions.map((ps) => (
                  <div
                    key={ps.id}
                    className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#0F2942] truncate">{ps.title}</div>
                      <div className="text-[11px] text-[#526A84] tabular-nums">
                        {ps.questionCount} Qs · {ps.totalMarks} mks · Attempts {ps.myAttemptCount}/{ps.maxAttempts}
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid={`start-practice-${ps.id}`}
                      onClick={() => handleStartAssignedPractice(ps.id)}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center gap-1 shrink-0 whitespace-nowrap"
                    >
                      <Play className="w-3 h-3" />
                      <span>{ps.inProgressAttemptId ? 'Resume' : 'Start'}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-4 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-sm text-[#9A2F09]">
              {errorMsg}
            </div>
          )}

          {loading ? (
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-12 text-center text-sm text-[#526A84]">
              Shuffling fresh quizzes from the 500,000+ database...
            </div>
      ) : roundResult ? (
        <div className="bg-white rounded-3xl border border-[#DCEBFA] p-8 text-center max-w-2xl mx-auto space-y-5">
          <MascotAvatar className="w-24 h-24 mx-auto" />
          <h2 className="text-2xl font-display font-extrabold text-[#0F2942]">
            නියමයි! Practice Round Complete!
          </h2>
          <p className="text-sm text-[#526A84]">
            You completed {quizzes.length} shuffled scholarship questions and unlocked all child psychological memory tricks.
          </p>
          <p
            data-testid="practice-notification-confirmation"
            className="text-xs text-[#2E7D32] font-semibold"
          >
            Progress Report automatically sent to {user.email} &amp; WhatsApp {user.whatsappNumber}
          </p>
          <div className="grid grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-2xl bg-[#F3F9FF] border border-[#DCEBFA]">
              <div className="text-xs text-[#526A84]">Score</div>
              <div className="text-2xl font-display font-extrabold text-[#158EE3] tabular-nums">
                {roundResult.scorePercent}%
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#FFF7EB] border border-[#FDE1B2]">
              <div className="text-xs text-[#526A84]">Stars Earned</div>
              <div className="text-2xl font-display font-extrabold text-[#F5A623] tabular-nums">
                +{roundResult.starsEarned}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4]">
              <div className="text-xs text-[#526A84]">Next Level</div>
              <div className="text-sm font-display font-bold text-[#2E7D32] mt-1">
                {roundResult.nextLevel}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadRound()}
            className="px-6 py-3 text-sm font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl transition-colors"
          >
            Play Another Shuffled Round
          </button>
        </div>
      ) : currentQuiz ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Quiz Card matching uploaded design */}
          <div className="lg:col-span-7 bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between gap-4 text-xs text-[#526A84]">
              <span className="font-semibold text-[#158EE3]">
                Question {currentIndex + 1} of {quizzes.length} · {currentQuiz.id}
              </span>
              <span className="tabular-nums">
                {currentQuiz.attributes.cognitiveDomain} · {currentQuiz.attributes.difficultyTier}
              </span>
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-display font-bold text-[#0F2942] leading-snug">
                {currentQuiz.questionSi}
              </h2>
              {currentQuiz.questionEn && currentQuiz.questionEn !== currentQuiz.questionSi && (
                <p className="text-sm text-[#526A84] mt-1.5">{currentQuiz.questionEn}</p>
              )}
            </div>

            {currentQuiz.imageUrl && (
              <div className="rounded-2xl border border-[#DCEBFA] bg-[#F8FBFF] p-3">
                <img
                  src={currentQuiz.imageUrl}
                  alt="Quiz diagram"
                  referrerPolicy="no-referrer"
                  className="max-h-56 mx-auto rounded-xl object-contain"
                />
              </div>
            )}

            {/* Options A, B, C, D matching Green/Orange active feedback */}
            <div className="space-y-3">
              {currentQuiz.options.map((opt, idx) => {
                const isSelected = selectedOption === idx;
                const isCorrect = idx === currentQuiz.correctIndex;
                const revealed = selectedOption !== null;

                let btnStyle =
                  'bg-white border-[#DCEBFA] text-[#0F2942] hover:bg-[#F3F9FF] hover:border-[#99CAFA]';
                if (revealed) {
                  if (isCorrect) {
                    btnStyle = 'bg-[#4CAF50] border-[#3D9140] text-white';
                  } else if (isSelected && !isCorrect) {
                    btnStyle = 'bg-[#F96A1B] border-[#DE580E] text-white';
                  } else {
                    btnStyle = 'bg-[#F8FBFF] border-[#E5F0FA] text-[#6E849C]';
                  }
                }

                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={revealed}
                    onClick={() => handleSelectOption(idx)}
                    className={`w-full p-3.5 rounded-2xl border-2 text-left font-medium flex items-center justify-between gap-3 transition-colors ${btnStyle}`}
                  >
                    <div className="flex items-center gap-3.5">
                      <span
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          revealed && (isCorrect || isSelected)
                            ? 'bg-white text-[#0F2942]'
                            : 'bg-[#EBF5FF] text-[#158EE3]'
                        }`}
                      >
                        {letters[idx]}
                      </span>
                      <span className="text-base">{opt}</span>
                    </div>
                    {revealed && isCorrect && <CheckCircle2 className="w-5 h-5 shrink-0" />}
                    {revealed && isSelected && !isCorrect && (
                      <XCircle className="w-5 h-5 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Gamified Star Meter at bottom matching reference */}
            <div className="pt-4 border-t border-[#E5F0FA] flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                <Star className="w-6 h-6 text-[#F5A623] fill-[#F5A623] shrink-0" />
                <div className="flex-1 h-3 bg-[#EBF5FF] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#F5A623] transition-all"
                    style={{
                      width: `${Math.max(10, Math.round(((currentIndex + (selectedOption !== null ? 1 : 0)) / quizzes.length) * 100))}%`,
                    }}
                  />
                </div>
                <span className="text-xs font-bold text-[#0F2942] tabular-nums">
                  {scoreCount}/{answeredCount} Correct
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                {selectedOption === null && (
                  <button
                    type="button"
                    data-testid="skip-question-btn"
                    onClick={handleSkipQuestion}
                    className="px-3 py-2 text-xs font-semibold text-[#526A84] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl hover:text-[#0F2942] flex items-center gap-1"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>Skip</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (selectedOption === null) {
                      setHintUsedBeforeAnswer(true);
                    }
                    setShowStudyTrick((s) => !s);
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-[#7C4D00] bg-[#FFF7EB] border border-[#FDE1B2] rounded-xl hover:bg-[#FEEFD6]"
                >
                  {showStudyTrick ? 'Hide Memory Trick' : 'Study Memory Trick'}
                </button>
                {selectedOption !== null && (
                  <button
                    type="button"
                    onClick={handleNextOrFinish}
                    className="px-5 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl transition-colors"
                  >
                    {currentIndex < quizzes.length - 1 ? 'Next Question' : 'Finish Round'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Study Buddy Sidebar with Real-Time Encouragement & Simplified Memory Techniques */}
          <StudyBuddySidebar
            quiz={currentQuiz}
            selectedOption={selectedOption}
            consecutiveWrongCount={consecutiveWrongCount}
            studentFirstName={user.name.split(' ')[0]}
            showStudyTrick={showStudyTrick}
            masteredCueIds={masteredCueIds}
            onMarkCueReviewed={(quizId) =>
              setMasteredCueIds((prev) =>
                prev.includes(quizId) ? prev : [...prev, quizId]
              )
            }
          />
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}
