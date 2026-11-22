import React, { useEffect, useState } from 'react';
import {
  Award,
  BookOpen,
  Calendar,
  Clock,
  Compass,
  Flame,
  PauseCircle,
  Play,
  PlayCircle,
  Share2,
  Star,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { api, type AuthUser, type StudentInterventionInstruction } from '../lib/api';
import { computeSessionCountdownState, formatUtcInTimeZone } from '../lib/learningScheduler';
import { evaluateHeaderStreakBadge } from '../lib/streak';
import type { AttemptRecord, ScheduledSessionRecord, StudentTrajectory } from '../lib/types';
import {
  DailyLessonIllustration,
  MascotAvatar,
  MemoryLabIllustration,
  MockExamIllustration,
  PastPaperIllustration,
  ScholarshipGauge,
  StudyRing,
} from './BrandVisuals';
import { DailyStreakTracker } from './DailyStreakTracker';
import { DailyStudyGoal } from './DailyStudyGoal';
import { SubjectProficiencyRadar } from './SubjectProficiencyRadar';

interface StudentHomeProps {
  user: AuthUser;
  trajectory: StudentTrajectory;
  attempts: AttemptRecord[];
  poolCount: number;
  interventions?: StudentInterventionInstruction[];
  onStartTargetedPractice?: (intervention: StudentInterventionInstruction) => void;
  onStartScheduledSession?: (session: ScheduledSessionRecord) => void;
  onNavigate: (view: 'practice' | 'quests' | 'exams' | 'parents' | 'billing') => void;
  onQuickShare: () => Promise<void>;
  onUpdateDailyGoal: (targetQuestions: number) => Promise<void>;
}

export function StudentHome({
  user,
  trajectory,
  attempts,
  poolCount,
  interventions = [],
  onStartTargetedPractice,
  onStartScheduledSession,
  onNavigate,
  onQuickShare,
  onUpdateDailyGoal,
}: StudentHomeProps) {
  const [trackerTab, setTrackerTab] = useState<'study' | 'weekly' | 'history'>('study');
  const [sharing, setSharing] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledSessionRecord[]>([]);
  const [canSelfEditSchedule, setCanSelfEditSchedule] = useState(false);
  const [studentMaxDailyMinutes, setStudentMaxDailyMinutes] = useState<number | null>(null);
  const [studentRescheduleWindowHours, setStudentRescheduleWindowHours] = useState<number | null>(null);
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadSchedule = async () => {
    try {
      const res = await api.getStudentScheduleDashboard(user.id);
      setScheduledSessions(res.sessions);
      const editableLink = res.links.find((l) => l.studentCanEditSchedule);
      setCanSelfEditSchedule(Boolean(editableLink));
      setStudentMaxDailyMinutes(editableLink?.studentDailyMaxMinutes ?? null);
      setStudentRescheduleWindowHours(editableLink?.studentRescheduleWindowHours ?? null);
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    loadSchedule();
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [user.id]);

  const handleStudentReschedule = async (session: ScheduledSessionRecord) => {
    setScheduleNotice(null);
    try {
      await api.rescheduleScheduledSession(session.id, {
        newDate: editDate,
        newTimeOfDay: editTime,
        timezone: session.timezone,
      });
      setEditingSessionId(null);
      setScheduleNotice('Session time adjusted cleanly.');
      await loadSchedule();
    } catch (err) {
      setScheduleNotice((err as Error).message);
    }
  };

  const handleStudentTogglePause = async (session: ScheduledSessionRecord) => {
    setScheduleNotice(null);
    try {
      await api.updateScheduledSessionStatus(
        session.id,
        session.status === 'PAUSED' ? 'resume' : 'pause'
      );
      await loadSchedule();
    } catch (err) {
      setScheduleNotice((err as Error).message);
    }
  };

  const firstName = user.name.split(' ')[0];
  const headerStreak = evaluateHeaderStreakBadge(user.streakDays);

  const handleShareClick = async () => {
    setSharing(true);
    setShareToast(null);
    try {
      await onQuickShare();
      setShareToast(`Progress sent to ${user.email} & WhatsApp!`);
    } catch (err) {
      setShareToast((err as Error).message);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Main Learning Stage (Left 8 Columns) */}
      <div className="xl:col-span-8 space-y-6">
        {/* Welcome Hero Banner matching reference image */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#DCEEFF] via-[#E7F3FF] to-[#F4F9FF] border border-[#CBE2FA] p-6 sm:p-7 flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="space-y-2 max-w-xl">
            <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-[#0F2942] leading-tight">
              ආයුබෝවන්, {firstName}!
            </h1>
            <p className="text-base font-display font-semibold text-[#158EE3]">
              Welcome, {firstName} · {poolCount.toLocaleString()} Shuffled Quizzes Ready
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-[#476481] pt-1">
              <span className="whitespace-nowrap">
                Current Level: <strong className="text-[#0F2942]">{trajectory.currentLevel}</strong>
              </span>
              <span className="whitespace-nowrap">
                Recommended Next: <strong className="text-[#F96A1B]">{trajectory.recommendedNextLevel}</strong>
              </span>
              <span className="whitespace-nowrap tabular-nums">
                Stars: <strong className="text-[#0F2942]">{user.stars}</strong>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div
              data-testid="student-home-header-streak"
              data-fire-animated={headerStreak.hasFireAnimation ? 'true' : 'false'}
              className={`px-4 py-3 rounded-2xl border flex items-center gap-3 shadow-xs ${
                headerStreak.hasFireAnimation
                  ? 'bg-white/95 border-[#FAC58E]'
                  : 'bg-white/90 border-[#CBE2FA]'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  headerStreak.hasFireAnimation ? 'bg-[#FFF3E0]' : 'bg-[#EBF5FF]'
                }`}
              >
                {headerStreak.hasFireAnimation ? (
                  <span
                    role="img"
                    aria-label="Animated fire streak"
                    data-testid="header-streak-fire"
                    className="text-2xl leading-none animate-streak-fire select-none"
                  >
                    🔥
                  </span>
                ) : (
                  <Flame
                    className={`w-5 h-5 ${
                      headerStreak.streakDays > 0 ? 'text-[#F96A1B]' : 'text-[#7C97B2]'
                    }`}
                  />
                )}
              </div>
              <div className="leading-tight">
                <div className="text-[11px] font-bold text-[#526A84]">
                  {headerStreak.label}
                </div>
                <div className="text-lg font-display font-extrabold text-[#0F2942] tabular-nums">
                  {headerStreak.dayText}
                </div>
                <div
                  className={`text-[11px] font-bold ${
                    headerStreak.hasFireAnimation ? 'text-[#D9531E]' : 'text-[#158EE3]'
                  }`}
                >
                  {headerStreak.statusCaption}
                </div>
              </div>
            </div>
            <MascotAvatar className="w-28 h-28 shrink-0" />
          </div>
        </section>

        {/* Subscription Notice for Trial Accounts */}
        {user.subscriptionStatus !== 'active' && (
          <div className="rounded-2xl bg-[#FFF6EB] border border-[#FAD49B] p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-[#7A4400]">
              <strong>Trial Mode Active:</strong> Unlock unlimited access to all 500,000+ quizzes, child memory tricks, and full timed exam papers.
            </div>
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="px-4 py-2 text-xs font-bold text-white bg-[#F96A1B] hover:bg-[#DE580E] rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              Upgrade Paid Plan
            </button>
          </div>
        )}

        {/* Gamified Learning Quest Roadmap Launcher */}
        <section className="rounded-3xl bg-gradient-to-r from-[#0F2942] via-[#133859] to-[#158EE3] text-white p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-xl">
            <div className="text-xs font-bold text-[#93D5FF] flex items-center gap-1.5">
              <Compass className="w-4 h-4" />
              <span>Interactive Quest Roadmaps · E08 Adventure</span>
            </div>
            <h2 className="text-lg sm:text-xl font-display font-extrabold">
              Explore Progressive Levels &amp; Earn Explorer Ranks
            </h2>
            <p className="text-xs text-white/85">
              Complete step-by-step study missions, unlock Scholarship Island stages, and earn educational badges at a healthy pace.
            </p>
          </div>
          <button
            type="button"
            data-testid="open-quest-roadmap-btn"
            onClick={() => onNavigate('quests')}
            className="px-4 py-2.5 text-xs font-bold text-[#0F2942] bg-white hover:bg-[#EAF5FF] rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
          >
            <Compass className="w-4 h-4 text-[#158EE3]" />
            <span>Open Quest Roadmap</span>
          </button>
        </section>

        {/* Daily Streak & Consistent Learner Gamification */}
        <DailyStreakTracker
          streakDays={user.streakDays}
          lastPracticeDate={user.lastPracticeDate}
          attempts={attempts}
          onStartPractice={() => onNavigate('practice')}
        />

        {/* Daily Study Goal Tracker */}
        <DailyStudyGoal
          dailyGoalQuestions={user.dailyGoalQuestions}
          attempts={attempts}
          onSaveGoal={onUpdateDailyGoal}
          onStartPractice={() => onNavigate('practice')}
        />

        {/* Upcoming Scheduled Activities & Live Countdowns */}
        {scheduledSessions.length > 0 && (
          <section
            data-testid="student-scheduled-sessions"
            className="bg-white rounded-3xl border border-[#CBE2FA] p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-[#158EE3]" />
                <div>
                  <h2 className="text-base font-display font-bold text-[#0F2942]">
                    My Study Timetable &amp; Upcoming Sessions
                  </h2>
                  <p className="text-xs text-[#526A84]">
                    Calm, bite-sized practice and mock exam slots organized for your week
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-[#158EE3] tabular-nums">
                {canSelfEditSchedule && studentMaxDailyMinutes && studentRescheduleWindowHours && (
                  <span className="text-[11px] font-medium text-[#526A84]">
                    Self-shift limit: ±{studentRescheduleWindowHours}h · Max {studentMaxDailyMinutes}m/day
                  </span>
                )}
                <span>
                  {scheduledSessions.filter((s) => s.status === 'SCHEDULED' || s.status === 'IN_PROGRESS').length}{' '}
                  Upcoming
                </span>
              </div>
            </div>

            {scheduleNotice && (
              <div className="p-3 rounded-xl bg-[#F3F9FF] border border-[#99CAFA] text-xs font-medium text-[#0E4F80]">
                {scheduleNotice}
              </div>
            )}

            <div className="space-y-3">
              {scheduledSessions
                .filter((s) => s.status !== 'CANCELLED')
                .slice(0, 6)
                .map((s) => {
                  const countdown = computeSessionCountdownState(s, nowMs);
                  const fmt = formatUtcInTimeZone(s.scheduledStartUtc, s.timezone);
                  const canStart =
                    s.status === 'SCHEDULED' ||
                    s.status === 'IN_PROGRESS' ||
                    countdown.phase === 'ready_now' ||
                    countdown.phase === 'in_grace';
                  const isEditing = editingSessionId === s.id;

                  return (
                    <div
                      key={s.id}
                      data-testid={`student-session-${s.id}`}
                      className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-0.5 min-w-[210px] flex-1">
                          <div className="text-xs font-bold text-[#158EE3] tabular-nums">
                            {fmt.readable} ({s.timezone}) · {s.durationMinutes} min
                          </div>
                          <div className="text-sm font-bold text-[#0F2942]">{s.title}</div>
                          <div className="text-[11px] font-semibold text-[#526A84] tabular-nums">
                            Status: {s.status} · Countdown:{' '}
                            <span className="text-[#F96A1B] font-bold">
                              {countdown.countdownLabel}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {canSelfEditSchedule &&
                            (s.status === 'SCHEDULED' || s.status === 'PAUSED') && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSessionId(isEditing ? null : s.id);
                                    setEditDate(fmt.dateStr);
                                    setEditTime(fmt.timeStr);
                                  }}
                                  className="px-2.5 py-1.5 text-[11px] font-semibold text-[#0F2942] bg-white border border-[#CBE2FA] rounded-xl"
                                >
                                  Adjust Time
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleStudentTogglePause(s)}
                                  className="px-2.5 py-1.5 text-[11px] font-semibold text-[#9A5B00] bg-[#FFF8EB] border border-[#F3D19C] rounded-xl flex items-center gap-1"
                                >
                                  {s.status === 'PAUSED' ? (
                                    <>
                                      <PlayCircle className="w-3 h-3" /> Resume
                                    </>
                                  ) : (
                                    <>
                                      <PauseCircle className="w-3 h-3" /> Pause
                                    </>
                                  )}
                                </button>
                              </>
                            )}
                          {canStart && (
                            <button
                              type="button"
                              data-testid={`launch-scheduled-${s.id}`}
                              onClick={() =>
                                onStartScheduledSession
                                  ? onStartScheduledSession(s)
                                  : onNavigate(
                                      s.activityType === 'mock_exam' ? 'exams' : 'practice'
                                    )
                              }
                              className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>{s.status === 'IN_PROGRESS' ? 'Resume Activity' : 'Start Activity'}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {isEditing && (
                        <div className="p-3 rounded-xl bg-white border border-[#99CAFA] flex flex-wrap items-end gap-2 text-xs">
                          <div>
                            <label className="block text-[10px] text-[#526A84]">Date</label>
                            <input
                              type="date"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              className="px-2 py-1 border border-[#CBE2FA] rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-[#526A84]">Time</label>
                            <input
                              type="time"
                              value={editTime}
                              onChange={(e) => setEditTime(e.target.value)}
                              className="px-2 py-1 border border-[#CBE2FA] rounded-lg"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleStudentReschedule(s)}
                            className="px-3 py-1.5 text-xs font-bold text-white bg-[#158EE3] rounded-lg"
                          >
                            Save Time
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {/* Teacher Learning Instructions & Assigned Practice */}
        {interventions.length > 0 && (
          <section
            data-testid="student-teacher-instructions"
            className="bg-white rounded-3xl border border-[#CBE2FA] p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#158EE3]" />
                <div>
                  <h2 className="text-base font-display font-bold text-[#0F2942]">
                    Teacher Learning Instructions &amp; Recommended Practice
                  </h2>
                  <p className="text-xs text-[#526A84]">
                    Personalised steps from your subject teachers to turn tricky questions into strengths
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-[#158EE3] tabular-nums">
                {interventions.length} Active Plan{interventions.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="space-y-3">
              {interventions.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="space-y-1 flex-1 min-w-[240px]">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-[#158EE3]">{item.subjectName}</span>
                      <span className="text-[#526A84]">· {item.topicName}</span>
                      <span className="text-[#476481]">· From {item.teacherName}</span>
                      {item.consecutiveCorrectAfterCase > 0 && (
                        <span className="text-[11px] font-bold text-[#2E7D32] tabular-nums">
                          · Progress: {item.consecutiveCorrectAfterCase} follow-up correct
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-bold text-[#0F2942]">
                      {item.instructionTitle || `Guided Practice: ${item.topicName}`}
                    </div>
                    <p className="text-xs text-[#476481] leading-relaxed">
                      {item.instructionBody ||
                        'Review the memory trick carefully and solve this question at your own steady pace.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onStartTargetedPractice
                        ? onStartTargetedPractice(item)
                        : onNavigate('practice')
                    }
                    className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Start Assigned Practice</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 2x2 Vibrant Module Grid matching uploaded UI design */}
        <section aria-label="Learning Modules" className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* 1. Daily Lessons (Blue #158EE3) */}
          <div className="rounded-3xl bg-[#158EE3] text-white p-6 flex items-center justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-xl font-display font-bold leading-snug">Daily Lessons</h2>
              <p className="text-sm text-white/90 font-medium">දෛනික පාඩම් · 500K Practice</p>
              <button
                type="button"
                onClick={() => onNavigate('practice')}
                className="mt-2 inline-flex items-center px-4 py-2 text-xs font-bold text-[#0F2942] bg-white rounded-xl hover:bg-[#EAF5FF] transition-colors whitespace-nowrap shrink-0"
              >
                Learn more
              </button>
            </div>
            <DailyLessonIllustration />
          </div>

          {/* 2. Mock Exams (Orange #F96A1B) */}
          <div className="rounded-3xl bg-[#F96A1B] text-white p-6 flex items-center justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-xl font-display font-bold leading-snug">Mock Exams</h2>
              <p className="text-sm text-white/90 font-medium">පෙරහුරු විභාග · Timed Mode</p>
              <button
                type="button"
                onClick={() => onNavigate('exams')}
                className="mt-2 inline-flex items-center px-4 py-2 text-xs font-bold text-[#0F2942] bg-white rounded-xl hover:bg-[#FFF3EC] transition-colors whitespace-nowrap shrink-0"
              >
                Learn more
              </button>
            </div>
            <MockExamIllustration />
          </div>

          {/* 3. Memory & Study Lab (Gold #F5A623) */}
          <div className="rounded-3xl bg-[#F5A623] text-white p-6 flex items-center justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-xl font-display font-bold leading-snug">Memory Tricks Lab</h2>
              <p className="text-sm text-white/95 font-medium">මතක ශක්ති ක්‍රම · Psychology</p>
              <button
                type="button"
                onClick={() => onNavigate('practice')}
                className="mt-2 inline-flex items-center px-4 py-2 text-xs font-bold text-[#0F2942] bg-white rounded-xl hover:bg-[#FFF9EB] transition-colors whitespace-nowrap shrink-0"
              >
                Learn more
              </button>
            </div>
            <MemoryLabIllustration />
          </div>

          {/* 4. Past Paper Bank (Green #4CAF50) */}
          <div className="rounded-3xl bg-[#4CAF50] text-white p-6 flex items-center justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-xl font-display font-bold leading-snug">Past Paper Bank</h2>
              <p className="text-sm text-white/95 font-medium">පසුගිය ප්‍රශ්න පත්‍ර · All Levels</p>
              <button
                type="button"
                onClick={() => onNavigate('exams')}
                className="mt-2 inline-flex items-center px-4 py-2 text-xs font-bold text-[#0F2942] bg-white rounded-xl hover:bg-[#EEF9EF] transition-colors whitespace-nowrap shrink-0"
              >
                Learn more
              </button>
            </div>
            <PastPaperIllustration />
          </div>
        </section>

        {/* Subject Proficiency Radar Chart & Fall-Back Area Tracker */}
        <SubjectProficiencyRadar
          attempts={attempts}
          trajectory={trajectory}
          onPracticeFallback={() => onNavigate('practice')}
        />

        {/* Trajectory & Recent Attempts Table */}
        <section className="bg-white rounded-3xl border border-[#DCEBFA] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E5F0FA]">
            <div>
              <h3 className="text-lg font-display font-bold text-[#0F2942]">
                Learning Trajectory & Attempt History
              </h3>
              <p className="text-xs text-[#526A84] mt-0.5">
                {trajectory.recommendationNote}
              </p>
            </div>
            <div className="text-xs font-semibold text-[#158EE3] tabular-nums">
              {trajectory.improvementDeltaPercent >= 0 ? '+' : ''}
              {trajectory.improvementDeltaPercent}% Recent Trend
            </div>
          </div>

          {attempts.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#526A84]">
              Complete your first shuffled practice round or timed paper to generate your trajectory!
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#E5F0FA] text-xs text-[#526A84]">
                    <th className="py-2.5 pr-4 font-semibold">Paper / Round</th>
                    <th className="py-2.5 px-3 font-semibold">Mode</th>
                    <th className="py-2.5 px-3 font-semibold">Level</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Score</th>
                    <th className="py-2.5 pl-3 font-semibold text-right">Stars</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F6FD]">
                  {attempts.slice(0, 6).map((att) => (
                    <tr key={att.id} className="hover:bg-[#F8FBFF]">
                      <td className="py-3 pr-4 font-medium text-[#0F2942]">{att.paperTitle}</td>
                      <td className="py-3 px-3 text-xs text-[#526A84]">
                        {att.mode === 'timed_exam' ? 'Timed Exam' : 'Practice Study'}
                      </td>
                      <td className="py-3 px-3 text-xs text-[#476481]">{att.paperCategory}</td>
                      <td className="py-3 px-3 text-right font-bold tabular-nums text-[#0F2942]">
                        {att.scorePercent}% ({att.correctCount}/{att.totalQuestions})
                      </td>
                      <td className="py-3 pl-3 text-right font-bold tabular-nums text-[#F5A623]">
                        +{att.starsEarned}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Right Column: Parent Tracker & Analytics matching reference image */}
      <aside className="xl:col-span-4 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-6">
        <div>
          <h2 className="text-lg font-display font-bold text-[#0F2942]">Parent Tracker</h2>
          <p className="text-xs text-[#526A84]">මව්පියන්ගේ අධීක්ෂණය</p>

          <div className="mt-3 flex items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
            {(['study', 'weekly', 'history'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTrackerTab(t)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors ${
                  trackerTab === t
                    ? 'bg-[#158EE3] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {trackerTab === 'study' && (
          <div className="flex items-center gap-4">
            <StudyRing percent={trajectory.scholarshipReadinessPercent} stars={user.stars} />
            <div className="space-y-2 text-xs flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[#526A84] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#158EE3]" /> Study Time
                </span>
                <span className="font-bold text-[#0F2942] tabular-nums">
                  {Math.floor(trajectory.studyMinutesWeek / 60)}h {trajectory.studyMinutesWeek % 60}m
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#526A84] flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-[#F5A623]" /> Total Stars
                </span>
                <span className="font-bold text-[#0F2942] tabular-nums">{user.stars}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#526A84] flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-[#4CAF50]" /> Badges Earned
                </span>
                <span className="font-bold text-[#0F2942] tabular-nums">{trajectory.badgesCount}</span>
              </div>
            </div>
          </div>
        )}

        {trackerTab === 'weekly' && (
          <div>
            <div className="text-xs font-semibold text-[#526A84] mb-3">
              7-Day Performance Bars (Mon–Sun)
            </div>
            <div className="h-32 flex items-end justify-between gap-2 pt-4">
              {trajectory.dailyStudySeries.map((d, idx) => {
                const colors = [
                  'bg-[#F96A1B]',
                  'bg-[#F5A623]',
                  'bg-[#158EE3]',
                  'bg-[#4CAF50]',
                  'bg-[#158EE3]',
                  'bg-[#F96A1B]',
                  'bg-[#4CAF50]',
                ];
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
                    <span className="text-[10px] font-bold text-[#0F2942] tabular-nums">
                      {d.score}%
                    </span>
                    <div className="w-full bg-[#F0F6FD] rounded-t-lg h-20 flex items-end overflow-hidden">
                      <div
                        className={`w-full rounded-t-lg ${colors[idx % colors.length]}`}
                        style={{ height: `${Math.max(15, d.score)}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-medium text-[#526A84]">{d.day}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {trackerTab === 'history' && (
          <div className="space-y-2.5 text-xs">
            <div className="font-semibold text-[#0F2942] flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-[#4CAF50]" />
              <span>Level Progression Engine</span>
            </div>
            <p className="text-[#526A84] leading-relaxed">{trajectory.recommendationNote}</p>
            <div className="p-3 rounded-xl bg-[#F3F9FF] border border-[#DCEBFA] flex items-center justify-between">
              <span className="text-[#526A84]">Streak</span>
              <span className="font-bold text-[#0F2942] tabular-nums">{user.streakDays} Days</span>
            </div>
          </div>
        )}

        {/* Badges Row matching reference image */}
        <div className="pt-4 border-t border-[#E5F0FA]">
          <div className="text-xs font-bold text-[#0F2942] mb-3">Badges & Milestones</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2.5 rounded-2xl bg-[#F3F9FF] border border-[#DCEBFA]">
              <Star className="w-6 h-6 text-[#158EE3] mx-auto" />
              <div className="text-[11px] font-semibold text-[#0F2942] mt-1">Pattern Pro</div>
            </div>
            <div className="p-2.5 rounded-2xl bg-[#FFF7EB] border border-[#FDE1B2]">
              <Award className="w-6 h-6 text-[#F5A623] mx-auto" />
              <div className="text-[11px] font-semibold text-[#0F2942] mt-1">Memory Whiz</div>
            </div>
            <div className="p-2.5 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4]">
              <CheckCircle2 className="w-6 h-6 text-[#4CAF50] mx-auto" />
              <div className="text-[11px] font-semibold text-[#0F2942] mt-1">Exam Ready</div>
            </div>
          </div>
        </div>

        {/* Scholarship Estimator Gauge */}
        <div className="pt-4 border-t border-[#E5F0FA] text-center">
          <div className="text-sm font-display font-bold text-[#0F2942]">
            Scholarship Estimator
          </div>
          <div className="text-xs text-[#526A84] mb-2">ශිෂ්‍යත්ව ඇස්තමේන්තුව</div>
          <ScholarshipGauge percent={trajectory.scholarshipReadinessPercent} />
        </div>

        {/* Areas to Improve */}
        <div className="pt-4 border-t border-[#E5F0FA]">
          <div className="text-sm font-display font-bold text-[#0F2942]">Areas to Improve</div>
          <div className="text-xs text-[#526A84] mb-2.5">වැඩිදියුණු විය යුතු කොටස්</div>
          <div className="space-y-2">
            {trajectory.weakDomains.length > 0 ? (
              trajectory.weakDomains.map((w) => (
                <div
                  key={w.domain}
                  className="flex items-center justify-between gap-2 text-xs p-2.5 rounded-xl bg-[#F8FBFF] border border-[#E5F0FA]"
                >
                  <span className="text-[#0F2942] font-medium flex items-center gap-1.5 truncate">
                    <AlertCircle className="w-3.5 h-3.5 text-[#F96A1B] shrink-0" />
                    <span className="truncate">{w.domain}</span>
                  </span>
                  <span className="font-bold text-[#F96A1B] tabular-nums shrink-0">
                    {w.accuracyPercent}%
                  </span>
                </div>
              ))
            ) : (
              <div className="text-xs text-[#4CAF50] font-medium">
                All domains above benchmark!
              </div>
            )}
          </div>
        </div>

        {/* Quick Share button matching reference */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleShareClick}
            disabled={sharing}
            className="w-full py-2.5 px-4 text-sm font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Share2 className="w-4 h-4" />
            <span>{sharing ? 'Sending Report...' : 'Quick share (Email & WhatsApp)'}</span>
          </button>
          {shareToast && (
            <div className="mt-2 text-xs font-medium text-[#1E6323] text-center">
              {shareToast}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
