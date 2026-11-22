import React, { useEffect, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Clock,
  Compass,
  HelpCircle,
  Lock,
  PauseCircle,
  Play,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
} from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import type {
  GameRoadmapDetail,
  GameRoadmapRecord,
  RoadmapLevel,
  RoadmapMission,
  RoadmapMissionCompletionResult,
  StudentGamificationDashboard,
  StudentQuizView,
} from '../lib/types';

interface StudentRoadmapQuestViewProps {
  user: AuthUser;
  onUserStarsUpdated?: () => void;
}

const COSMETIC_IMAGE_BY_CODE: Record<string, string> = {
  lotus_crest: '/assets/aistudio/avatar_lotus_crest.jpg',
  wisdom_owl: '/assets/aistudio/avatar_wisdom_owl.jpg',
};

export function StudentRoadmapQuestView({
  user,
  onUserStarsUpdated,
}: StudentRoadmapQuestViewProps) {
  const [dashboard, setDashboard] = useState<StudentGamificationDashboard | null>(null);
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState<boolean>(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
  const [wellbeingPaused, setWellbeingPaused] = useState(false);

  // Active Mission Gameplay State
  const [activeSession, setActiveSession] = useState<{
    missionAttemptId: string;
    mission: RoadmapMission;
    level: RoadmapLevel;
    roadmap: GameRoadmapRecord;
    questions: StudentQuizView[];
    shortageWarning: string | null;
    wellbeingNotice: string | null;
  } | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const [hintsUsed, setHintsUsed] = useState<Record<string, boolean>>({});
  const [showHintForCurrent, setShowHintForCurrent] = useState(false);
  const [sessionStartMs, setSessionStartMs] = useState<number>(Date.now());
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completionResult, setCompletionResult] =
    useState<RoadmapMissionCompletionResult | null>(null);

  const loadDashboard = async (keepRoadmap = true) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getGamificationDashboard();
      setDashboard(res.dashboard);
      if (
        !keepRoadmap ||
        !selectedRoadmapId ||
        !res.dashboard.roadmaps.some((r) => r.roadmap.id === selectedRoadmapId)
      ) {
        setSelectedRoadmapId(res.dashboard.roadmaps[0]?.roadmap.id || null);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard(false);
  }, [user.id]);

  // Mission Timer countdown (only if mission has explicit calm timeLimitSeconds)
  useEffect(() => {
    if (!activeSession || remainingSeconds === null || completionResult) return;
    if (remainingSeconds <= 0) return;
    const t = window.setInterval(() => {
      setRemainingSeconds((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(t);
  }, [activeSession?.missionAttemptId, remainingSeconds !== null, completionResult]);

  const handleStartMission = async (mission: RoadmapMission) => {
    setErrorMsg(null);
    setCompletionResult(null);
    try {
      const res = await api.startRoadmapMission(mission.id);
      setActiveSession({
        missionAttemptId: res.missionAttemptId,
        mission: res.mission,
        level: res.level,
        roadmap: res.roadmap,
        questions: res.questions,
        shortageWarning: res.shortageWarning,
        wellbeingNotice: res.wellbeingNotice,
      });
      setQIndex(0);
      setAnswers({});
      setHintsUsed({});
      setShowHintForCurrent(false);
      setSessionStartMs(Date.now());
      setRemainingSeconds(res.mission.timeLimitSeconds || null);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleCompleteMission = async () => {
    if (!activeSession || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const elapsedSec = Math.max(1, Math.round((Date.now() - sessionStartMs) / 1000));
      const res = await api.completeRoadmapMission(activeSession.mission.id, {
        missionAttemptId: activeSession.missionAttemptId,
        idempotencyKey: `idem-${activeSession.missionAttemptId}`,
        answers: activeSession.questions.map((q) => ({
          questionId: q.id,
          selectedIndex: answers[q.id] ?? null,
          hintUsed: Boolean(hintsUsed[q.id]),
          responseDurationMs: Math.round((elapsedSec * 1000) / Math.max(1, activeSession.questions.length)),
        })),
        durationSeconds: elapsedSec,
        observedActiveSeconds: elapsedSec,
      });
      setCompletionResult(res.result);
      await loadDashboard(true);
      onUserStarsUpdated?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEquipReward = async (rewardDefId: string) => {
    try {
      await api.equipRoadmapReward(rewardDefId);
      await loadDashboard(true);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  if (loading && !dashboard) {
    return (
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-10 text-center text-sm text-[#526A84]">
        Loading your Grade 5 Quest Roadmap...
      </div>
    );
  }

  const activeRoadmap: GameRoadmapDetail | null =
    dashboard?.roadmaps.find((r) => r.roadmap.id === selectedRoadmapId) ||
    dashboard?.roadmaps[0] ||
    null;

  // =========================================================================
  // ACTIVE MISSION RUNNER VIEW (Calm, high-clarity educational focus)
  // =========================================================================
  if (activeSession) {
    const q = activeSession.questions[qIndex];
    const total = activeSession.questions.length;
    const isLast = qIndex >= total - 1;

    if (completionResult) {
      return (
        <div className="max-w-3xl mx-auto space-y-5" data-testid="mission-completion-summary">
          <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E5F0FA]">
              <div className="space-y-1">
                <div className="text-xs font-bold text-[#158EE3]">
                  {activeSession.level.title} · {activeSession.mission.title}
                </div>
                <h2 className="text-2xl font-display font-extrabold text-[#0F2942]">
                  {completionResult.attempt.masteryPassed
                    ? 'Quest Mission Mastered!'
                    : 'Steady Learning Practice Logged'}
                </h2>
                <p className="text-xs text-[#476481]">
                  {completionResult.levelEvaluation.encouragementMessage}
                </p>
              </div>

              <div className="px-4 py-3 rounded-2xl bg-[#EBF5FF] border border-[#99CAFA] text-center tabular-nums">
                <div className="text-2xl font-display font-extrabold text-[#158EE3]">
                  {Math.round(completionResult.attempt.accuracyPercent ?? 0)}%
                </div>
                <div className="text-[11px] font-bold text-[#0F2942]">
                  {completionResult.attempt.correctCount} / {completionResult.attempt.totalQuestions} Correct
                </div>
              </div>
            </div>

            {/* Transparent Rewards Earned */}
            {completionResult.rewardsGranted.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                {completionResult.rewardsGranted.map((rw) => (
                  <div
                    key={rw.id}
                    className="p-3 rounded-2xl bg-[#FFF8EB] border border-[#F3D19C] space-y-0.5 tabular-nums"
                  >
                    <div className="font-bold text-[#7B4B00] uppercase">
                      +{rw.amount} {rw.rewardType.replace('_', ' ')}
                    </div>
                    <div className="text-[11px] text-[#526A84]">{rw.reason}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Unlocked Next Levels Notice */}
            {completionResult.levelEvaluation.unlockedNextLevels.length > 0 && (
              <div className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] text-xs text-[#1E6323] font-semibold flex items-center gap-2">
                <Trophy className="w-5 h-5 shrink-0" />
                <span>
                  New Level Unlocked:{' '}
                  {completionResult.levelEvaluation.unlockedNextLevels.map((u) => u.title).join(', ')}!
                </span>
              </div>
            )}

            {/* Adaptive Remediation Suggestion */}
            {completionResult.remediationSuggestion?.triggered && (
              <div className="p-4 rounded-2xl bg-[#F3F9FF] border border-[#99CAFA] text-xs text-[#0E4F80] space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#158EE3]" />
                  <span>Helpful Practice Boost Ready</span>
                </div>
                <p>{completionResult.remediationSuggestion.explanation}</p>
              </div>
            )}

            {/* Question Explanations & Memory Tricks */}
            <div className="space-y-3">
              <div className="text-xs font-bold text-[#0F2942]">Concept Review &amp; Memory Tricks</div>
              {completionResult.questionOutcomes.map((out, idx) => (
                <div
                  key={out.questionId}
                  className={`p-4 rounded-2xl border text-xs space-y-1 ${
                    out.isCorrect
                      ? 'bg-[#EEF9EF] border-[#B7E1BA]'
                      : 'bg-[#FFF8EB] border-[#F3D19C]'
                  }`}
                >
                  <div className="font-bold text-[#0F2942]">
                    Q{idx + 1}: {out.isCorrect ? 'Correct' : 'Review Concept'}
                  </div>
                  <p className="text-[#476481]">{out.explanation}</p>
                  {out.memoryTrickTitle && (
                    <div className="text-[11px] font-semibold text-[#158EE3]">
                      Memory Trick — {out.memoryTrickTitle}: {out.memoryTrickBody}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setActiveSession(null);
                  setCompletionResult(null);
                }}
                className="px-5 py-2.5 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
              >
                Return to Learning Roadmap
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-3xl mx-auto space-y-4" data-testid="active-mission-runner">
        <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-[#158EE3]">
              {activeSession.level.title} · {activeSession.mission.title}
            </div>
            <div className="text-sm font-display font-bold text-[#0F2942] tabular-nums">
              Question {qIndex + 1} of {total}
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {remainingSeconds !== null && (
              <span className="px-3 py-1.5 rounded-xl bg-[#F3F9FF] border border-[#CBE2FA] font-bold text-[#0F2942] tabular-nums">
                <Clock className="w-3.5 h-3.5 inline mr-1 text-[#158EE3]" />
                {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}
              </span>
            )}
            <button
              type="button"
              onClick={() => setActiveSession(null)}
              className="px-3 py-1.5 rounded-xl border border-[#DCEBFA] text-[#526A84] font-semibold hover:text-[#0F2942]"
            >
              Pause &amp; Exit
            </button>
          </div>
        </div>

        {(activeSession.wellbeingNotice || activeSession.shortageWarning) && (
          <div className="p-3 rounded-2xl bg-[#FFF8EB] border border-[#F3D19C] text-xs text-[#7B4B00]">
            {activeSession.wellbeingNotice || activeSession.shortageWarning}
          </div>
        )}

        {q && (
          <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-7 space-y-5">
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-[#526A84]">
                {q.attributes.cognitiveDomain} · {q.attributes.difficultyTier}
              </div>
              <h3 className="text-lg font-display font-bold text-[#0F2942] leading-snug">
                {q.questionEn || q.questionSi}
              </h3>
              {q.questionSi && q.questionEn && q.questionSi !== q.questionEn && (
                <p className="text-sm text-[#476481]">{q.questionSi}</p>
              )}
              {q.imageUrl && (
                <img
                  src={q.imageUrl}
                  alt="Question diagram"
                  className="max-h-56 rounded-2xl border border-[#DCEBFA] object-contain"
                />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {q.options.map((opt, idx) => {
                const selected = answers[q.id] === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: idx }))}
                    className={`p-4 rounded-2xl border text-left text-sm font-semibold transition-colors ${
                      selected
                        ? 'bg-[#EBF5FF] border-[#158EE3] text-[#0F2942]'
                        : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#476481] hover:border-[#99CAFA]'
                    }`}
                  >
                    <span className="font-mono text-xs mr-2 text-[#158EE3]">
                      {String.fromCharCode(65 + idx)}.
                    </span>
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>

            {(q.hint || activeSession.mission.puzzleHintMode) && (
              <div className="pt-1">
                {!showHintForCurrent ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowHintForCurrent(true);
                      setHintsUsed((prev) => ({ ...prev, [q.id]: true }));
                    }}
                    className="text-xs font-bold text-[#158EE3] flex items-center gap-1.5"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Show Gentle Concept Hint</span>
                  </button>
                ) : (
                  <div className="p-3 rounded-xl bg-[#F3F9FF] border border-[#CBE2FA] text-xs text-[#0E4F80]">
                    <strong>Hint:</strong> {q.hint || 'Read the quantities step by step and check units carefully.'}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-[#E5F0FA]">
              <button
                type="button"
                disabled={qIndex === 0}
                onClick={() => {
                  setQIndex((i) => Math.max(0, i - 1));
                  setShowHintForCurrent(false);
                }}
                className="px-4 py-2 text-xs font-bold text-[#476481] border border-[#DCEBFA] rounded-xl disabled:opacity-40"
              >
                Previous
              </button>

              {!isLast ? (
                <button
                  type="button"
                  onClick={() => {
                    setQIndex((i) => i + 1);
                    setShowHintForCurrent(false);
                  }}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
                >
                  Next Question
                </button>
              ) : (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleCompleteMission}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-[#2E7D32] hover:bg-[#1E6323] rounded-xl"
                >
                  {submitting ? 'Submitting...' : 'Finish & Claim Quest Progress'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // MAIN VISUAL QUEST ROADMAP JOURNEY
  // =========================================================================
  return (
    <div className="space-y-6" data-testid="student-roadmap-quest-view">
      {/* Hero Banner with Explorer Rank, XP, Coins & Wellbeing Break Control */}
      <div className="relative overflow-hidden rounded-3xl border border-[#CBE2FA] bg-white">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-7 p-6 sm:p-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#158EE3] flex items-center gap-1.5">
                <Compass className="w-4 h-4" />
                <span>MAN 5HE Progressive Learning Journey</span>
              </span>
              <button
                type="button"
                onClick={() => setReducedMotion((v) => !v)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#F3F9FF] border border-[#DCEBFA] text-[#476481]"
              >
                {reducedMotion ? 'Motion: Reduced' : 'Motion: Gentle'}
              </button>
            </div>

            <div>
              <h1 className="text-2xl font-display font-extrabold text-[#0F2942]">
                {dashboard?.studentName}&rsquo;s Scholarship Explorer Map
              </h1>
              <p className="text-xs text-[#526A84] mt-1">
                Complete calm bite-sized academic missions to unlock new stages, badges, and explorer companions.
              </p>
            </div>

            {dashboard && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tabular-nums">
                <div className="p-3 rounded-2xl bg-[#F3F9FF] border border-[#DCEBFA]">
                  <div className="text-[11px] text-[#526A84]">Explorer Rank</div>
                  <div className="text-lg font-display font-extrabold text-[#158EE3]">
                    Rank {dashboard.explorerRank}
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA]">
                  <div className="text-[11px] text-[#526A84]">Total XP</div>
                  <div className="text-lg font-display font-extrabold text-[#0F2942]">
                    {dashboard.totalXp} XP
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-[#FFF8EB] border border-[#F3D19C]">
                  <div className="text-[11px] text-[#7B4B00]">Stars Earned</div>
                  <div className="text-lg font-display font-extrabold text-[#7B4B00]">
                    {dashboard.totalStars} ★
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA]">
                  <div className="text-[11px] text-[#1E6323]">Explorer Coins</div>
                  <div className="text-lg font-display font-extrabold text-[#1E6323]">
                    {dashboard.totalCoins}
                  </div>
                </div>
              </div>
            )}

            {/* Wellbeing Study Balance Strip */}
            {dashboard && (
              <div className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-start gap-2 max-w-md">
                  <ShieldCheck className="w-4 h-4 text-[#2E7D32] shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-[#0F2942] tabular-nums">
                      Healthy Study Balance: {dashboard.wellbeingStatus.dailyObservedActiveMinutes} /{' '}
                      {dashboard.wellbeingStatus.dailyMaxMinutes} min today
                    </div>
                    <div className="text-[11px] text-[#526A84]">
                      {dashboard.wellbeingStatus.supportiveMessage}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setWellbeingPaused((p) => !p)}
                  className="px-3 py-1.5 rounded-xl border border-[#CBE2FA] bg-white text-[#0F2942] font-bold flex items-center gap-1.5 shrink-0"
                >
                  <PauseCircle className="w-3.5 h-3.5 text-[#158EE3]" />
                  <span>{wellbeingPaused ? 'Resume Questing' : 'Take a Break'}</span>
                </button>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 relative min-h-[210px] bg-gradient-to-br from-[#DDF0FF] to-[#EEF9EF]">
            <img
              src="/assets/aistudio/roadmap_island_banner.jpg"
              alt="Grade 5 Scholarship Learning Island Trail"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        </div>
      </div>

      {wellbeingPaused && (
        <div className="p-5 rounded-3xl bg-[#EEF9EF] border border-[#B7E1BA] text-xs text-[#1E6323] flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong>Break Mode Active:</strong> Great job listening to your energy! Stretch, drink water, and resume whenever you feel refreshed.
          </div>
          <button
            type="button"
            onClick={() => setWellbeingPaused(false)}
            className="px-3.5 py-1.5 rounded-xl bg-[#2E7D32] text-white font-bold"
          >
            I&rsquo;m Ready to Continue
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs font-medium text-[#9A2F09]">
          {errorMsg}
        </div>
      )}

      {/* Published Roadmaps Selector */}
      {dashboard && dashboard.roadmaps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dashboard.roadmaps.map((rm) => {
            const active = rm.roadmap.id === activeRoadmap?.roadmap.id;
            const doneCount =
              rm.studentProgress?.levelProgress.filter((lp) => lp.status === 'COMPLETED').length || 0;
            return (
              <button
                key={rm.roadmap.id}
                type="button"
                onClick={() => setSelectedRoadmapId(rm.roadmap.id)}
                className={`px-4 py-2.5 rounded-2xl border text-left text-xs transition-colors ${
                  active
                    ? 'bg-[#158EE3] border-[#158EE3] text-white'
                    : 'bg-white border-[#DCEBFA] text-[#0F2942] hover:border-[#99CAFA]'
                }`}
              >
                <div className="font-bold">{rm.roadmap.name}</div>
                <div className={`text-[11px] tabular-nums ${active ? 'text-[#DCEEFF]' : 'text-[#526A84]'}`}>
                  {doneCount} / {rm.levels.length} Levels Mastered
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Visual Stage & Progressive Level Path */}
      {activeRoadmap && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-8 space-y-6">
            {activeRoadmap.stages.map((stage) => {
              const stageLevels = activeRoadmap.levels.filter((l) => l.stageId === stage.id);
              return (
                <div
                  key={stage.id}
                  className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
                    <div>
                      <div className="text-xs font-bold" style={{ color: stage.themeColor }}>
                        Stage {stage.sortOrder}
                      </div>
                      <h2 className="text-lg font-display font-extrabold text-[#0F2942]">
                        {stage.title}
                      </h2>
                      <p className="text-xs text-[#526A84]">{stage.description}</p>
                    </div>
                  </div>

                  {/* Interactive Level Nodes */}
                  <div className="space-y-4">
                    {stageLevels.map((lvl) => {
                      const prog = activeRoadmap.studentProgress?.levelProgress.find(
                        (p) => p.levelId === lvl.id
                      );
                      const status = prog?.status || 'LOCKED';
                      const isLocked = status === 'LOCKED';
                      const lvlMissions = activeRoadmap.missions.filter((m) => m.levelId === lvl.id);
                      const adaptiveNotice = activeRoadmap.studentProgress?.adaptiveRecommendations.find(
                        (r) => r.levelId === lvl.id
                      );

                      return (
                        <div
                          key={lvl.id}
                          data-testid={`roadmap-level-${lvl.id}`}
                          className={`rounded-2xl border p-4 space-y-3 ${
                            status === 'COMPLETED'
                              ? 'bg-[#EEF9EF] border-[#B7E1BA]'
                              : status === 'AVAILABLE' || status === 'ACTIVE'
                              ? 'bg-[#F8FBFF] border-[#99CAFA]'
                              : 'bg-slate-50 border-slate-200 opacity-80'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center font-display font-extrabold text-sm shrink-0 ${
                                  status === 'COMPLETED'
                                    ? 'bg-[#2E7D32] text-white'
                                    : isLocked
                                    ? 'bg-slate-300 text-slate-600'
                                    : 'bg-[#158EE3] text-white'
                                }`}
                              >
                                {status === 'COMPLETED' ? (
                                  <CheckCircle2 className="w-5 h-5" />
                                ) : isLocked ? (
                                  <Lock className="w-4 h-4" />
                                ) : (
                                  lvl.sequenceOrder
                                )}
                              </div>
                              <div>
                                <div className="text-sm font-display font-bold text-[#0F2942]">
                                  {lvl.title}
                                </div>
                                <div className="text-xs text-[#476481]">{lvl.description}</div>
                                <div className="text-[11px] text-[#526A84] mt-1 tabular-nums">
                                  Target: {lvl.targetQuestionCount} Qs · Mastery: {lvl.minMasteryAccuracyPercent}% · Best:{' '}
                                  {Math.round(prog?.bestAccuracyPercent || 0)}% · Status: <strong>{status}</strong>
                                </div>
                              </div>
                            </div>

                            <div className="text-right text-[11px] font-bold text-[#7B4B00] tabular-nums">
                              +{lvl.xpReward} XP · +{lvl.starsReward} ★
                            </div>
                          </div>

                          {adaptiveNotice && (
                            <div className="p-3 rounded-xl bg-white border border-[#99CAFA] text-xs text-[#0E4F80]">
                              <strong>Concept Support:</strong> {adaptiveNotice.explanation}
                            </div>
                          )}

                          {/* Missions Inside Level */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {lvlMissions.map((m) => (
                              <div
                                key={m.id}
                                className="p-3 rounded-xl bg-white border border-[#DCEBFA] flex items-center justify-between gap-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <div className="font-bold text-[#0F2942] truncate">
                                    {m.isRemedial ? 'Concept Boost: ' : ''}
                                    {m.title}
                                  </div>
                                  <div className="text-[11px] text-[#526A84] tabular-nums">
                                    {m.questionCount} Qs · {m.missionType.replace('_', ' ')} · +{m.xpReward} XP
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={isLocked || wellbeingPaused}
                                  data-testid={`start-mission-${m.id}`}
                                  onClick={() => handleStartMission(m)}
                                  className="px-3 py-1.5 rounded-lg font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] disabled:bg-slate-300 shrink-0 flex items-center gap-1"
                                >
                                  <Play className="w-3 h-3" />
                                  <span>{isLocked ? 'Locked' : 'Play'}</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Sidebar: Rewards Collection & Avatar Cosmetics */}
          <div className="xl:col-span-4 space-y-5">
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-[#E5F0FA]">
                <Award className="w-4 h-4 text-[#F96A1B]" />
                <h3 className="text-base font-display font-bold text-[#0F2942]">
                  Unlocked Badges &amp; Companions
                </h3>
              </div>

              <div className="space-y-2.5 text-xs">
                {dashboard?.allRewardDefinitions.map((def) => {
                  const unlocked = dashboard.unlockedRewards.find((u) => u.rewardDefId === def.id);
                  const imgSrc = COSMETIC_IMAGE_BY_CODE[def.code];
                  return (
                    <div
                      key={def.id}
                      className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${
                        unlocked
                          ? 'bg-[#F8FBFF] border-[#99CAFA]'
                          : 'bg-slate-50 border-slate-200 opacity-65'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {imgSrc ? (
                          <img
                            src={imgSrc}
                            alt={def.title}
                            className="w-11 h-11 rounded-xl object-cover border border-[#DCEBFA] shrink-0"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-xl bg-[#FFF8EB] border border-[#F3D19C] flex items-center justify-center shrink-0">
                            <Star className="w-5 h-5 text-[#F5A623]" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-bold text-[#0F2942] truncate">{def.title}</div>
                          <div className="text-[11px] text-[#526A84] truncate">{def.milestoneRuleText}</div>
                        </div>
                      </div>

                      {unlocked ? (
                        <button
                          type="button"
                          onClick={() => handleEquipReward(def.id)}
                          className={`px-2.5 py-1 rounded-lg font-bold shrink-0 ${
                            unlocked.equipped
                              ? 'bg-[#2E7D32] text-white'
                              : 'bg-white border border-[#CBE2FA] text-[#158EE3]'
                          }`}
                        >
                          {unlocked.equipped ? 'Equipped' : 'Equip'}
                        </button>
                      ) : (
                        <span className="text-[11px] font-semibold text-slate-500 shrink-0">Locked</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
