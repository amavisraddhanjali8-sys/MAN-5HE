import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileText,
  Filter,
  HelpCircle,
  PauseCircle,
  PlayCircle,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  XCircle,
} from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import { computeSessionCountdownState, formatUtcInTimeZone } from '../lib/learningScheduler';
import type {
  DifficultyTier,
  GuardianStudentLink,
  LearningActivityType,
  ParentAssessmentReport,
  QuestionHistoryFilterMode,
  QuestionType,
  ReminderPreferenceRecord,
  ReportDeliveryRecord,
  ScheduleQuestionFilters,
  ScheduledSessionRecord,
  SubjectCategory,
  SubtopicNode,
  TimetablePreset,
  TimetableRecurrenceType,
  TopicNode,
} from '../lib/types';

interface ParentLearningPlannerProps {
  user: AuthUser;
  subjects: SubjectCategory[];
  topics: TopicNode[];
  subtopics: SubtopicNode[];
  selectedStudentId: string;
  onSelectStudentId: (studentId: string) => void;
  links: GuardianStudentLink[];
  onLinksUpdated: () => void;
}

const TIMEZONES = [
  'Asia/Colombo',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'Australia/Sydney',
  'UTC',
];

const WEEKDAY_LABELS = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
];

const LEAD_TIME_OPTIONS = [
  { minutes: 1440, label: '24 hours before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 30, label: '30 min before' },
  { minutes: 15, label: '15 min before' },
  { minutes: 5, label: '5 min before' },
  { minutes: 0, label: 'At start time' },
];

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIsoDate(dateStr: string, days: number): string {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function ParentLearningPlanner({
  subjects,
  topics,
  subtopics,
  selectedStudentId,
  onSelectStudentId,
  links,
  onLinksUpdated,
}: ParentLearningPlannerProps) {
  const [subTab, setSubTab] = useState<'reports' | 'schedule' | 'presets'>('reports');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Reports State
  const [reports, setReports] = useState<ParentAssessmentReport[]>([]);
  const [deliveriesByReport, setDeliveriesByReport] = useState<
    Record<string, ReportDeliveryRecord[]>
  >({});
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [expandedGuides, setExpandedGuides] = useState<Record<string, boolean>>({});
  const [reportQuestionFilter, setReportQuestionFilter] = useState<'all' | 'incorrect' | 'correct'>(
    'all'
  );

  // Schedule State
  const [sessions, setSessions] = useState<ScheduledSessionRecord[]>([]);
  const [presets, setPresets] = useState<TimetablePreset[]>([]);
  const [preferences, setPreferences] = useState<ReminderPreferenceRecord | null>(null);
  const [scheduleViewMode, setScheduleViewMode] = useState<'list' | 'calendar'>('list');

  // Reschedule Inline State
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(todayDateInput());
  const [rescheduleTime, setRescheduleTime] = useState('17:00');
  const [rescheduleTz, setRescheduleTz] = useState('Asia/Colombo');
  const [rescheduleDuration, setRescheduleDuration] = useState(25);

  // Custom Timetable Builder State
  const [customTitle, setCustomTitle] = useState('');
  const [customActivityType, setCustomActivityType] =
    useState<LearningActivityType>('practice');
  const [customTimezone, setCustomTimezone] = useState('Asia/Colombo');
  const [customStartDate, setCustomStartDate] = useState(todayDateInput());
  const [customEndDate, setCustomEndDate] = useState(addDaysIsoDate(todayDateInput(), 14));
  const [customTimeOfDay, setCustomTimeOfDay] = useState('16:30');
  const [customDurationMinutes, setCustomDurationMinutes] = useState(25);
  const [customGraceMinutes, setCustomGraceMinutes] = useState(15);
  const [customRecurrence, setCustomRecurrence] =
    useState<TimetableRecurrenceType>('weekly');
  const [customWeekdays, setCustomWeekdays] = useState<number[]>([1, 3, 5]);
  const [customExceptionsCsv, setCustomExceptionsCsv] = useState('');

  // Question Filter Criteria
  const [filterSubjectIds, setFilterSubjectIds] = useState<string[]>([]);
  const [filterTopicIds, setFilterTopicIds] = useState<string[]>([]);
  const [filterSubtopicIds, setFilterSubtopicIds] = useState<string[]>([]);
  const [filterDifficultyTiers, setFilterDifficultyTiers] = useState<DifficultyTier[]>([]);
  const [filterQuestionTypes, setFilterQuestionTypes] = useState<QuestionType[]>([]);
  const [filterHistoryMode, setFilterHistoryMode] =
    useState<QuestionHistoryFilterMode>('all');
  const [filterLearningObjective, setFilterLearningObjective] = useState('');
  const [filterMinMarks, setFilterMinMarks] = useState<string>('');
  const [filterMaxMarks, setFilterMaxMarks] = useState<string>('');
  const [filterMinSecs, setFilterMinSecs] = useState<string>('');
  const [filterMaxSecs, setFilterMaxSecs] = useState<string>('');
  const [filterQuestionCount, setFilterQuestionCount] = useState(6);
  const [filterBalanceTopics, setFilterBalanceTopics] = useState(true);

  const [questionPoolPreview, setQuestionPoolPreview] = useState<{
    availableCount: number;
    requestedCount: number;
    insufficient: boolean;
    warnings: string[];
  } | null>(null);
  const [schedulePreview, setSchedulePreview] = useState<{
    occurrenceCount: number;
    occurrences: { localDate: string; startUtc: string; endUtc: string }[];
    conflicts: { conflictingTitle: string; reason: string }[];
    questionAvailability: {
      availableCount: number;
      requestedCount: number;
      insufficient: boolean;
      warnings: string[];
    };
  } | null>(null);

  // Preset Application State
  const [presetStartDate, setPresetStartDate] = useState(todayDateInput());
  const [presetEndDate, setPresetEndDate] = useState(addDaysIsoDate(todayDateInput(), 14));
  const [presetTimezone, setPresetTimezone] = useState('Asia/Colombo');
  const [presetSkipConflicts, setPresetSkipConflicts] = useState(true);
  const [presetPreviewById, setPresetPreviewById] = useState<
    Record<
      string,
      {
        occurrences: {
          title: string;
          localDate: string;
          timeOfDay: string;
          eligibleCount: number;
          warnings: string[];
        }[];
        conflicts: { conflictingTitle: string; reason: string }[];
      }
    >
  >({});

  // Student Permission Guardrail Drafts
  const activeLink = links.find((l) => l.studentUserId === selectedStudentId) || links[0] || null;
  const [studentCanEdit, setStudentCanEdit] = useState(false);
  const [studentMaxDailyMin, setStudentMaxDailyMin] = useState(45);
  const [studentWindowHours, setStudentWindowHours] = useState(6);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (subjects.length > 0 && filterSubjectIds.length === 0) {
      setFilterSubjectIds([subjects[0].id]);
    }
  }, [subjects]);

  useEffect(() => {
    if (activeLink) {
      setStudentCanEdit(activeLink.studentCanEditSchedule);
      setStudentMaxDailyMin(activeLink.studentDailyMaxMinutes);
      setStudentWindowHours(activeLink.studentRescheduleWindowHours);
    }
  }, [activeLink?.id, activeLink?.studentCanEditSchedule]);

  const loadStudentPlannerData = async (studentId: string) => {
    if (!studentId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [repRes, schedRes] = await Promise.all([
        api.getParentStudentReports(studentId),
        api.getStudentScheduleDashboard(studentId),
      ]);
      setReports(repRes.reports);
      setDeliveriesByReport(repRes.deliveriesByReport);
      if (repRes.reports.length > 0) {
        setSelectedReportId((prev) =>
          prev && repRes.reports.some((r) => r.id === prev) ? prev : repRes.reports[0].id
        );
      } else {
        setSelectedReportId(null);
      }
      setSessions(schedRes.sessions);
      setPresets(schedRes.presets);
      setPreferences(schedRes.preferences);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedStudentId) {
      loadStudentPlannerData(selectedStudentId);
    }
  }, [selectedStudentId]);

  const activeReport = reports.find((r) => r.id === selectedReportId) || reports[0] || null;

  const buildFilterCriteria = (): ScheduleQuestionFilters => ({
    grade: activeLink?.studentGrade || 'Grade 5',
    subjectIds: filterSubjectIds,
    topicIds: filterTopicIds,
    subtopicIds: filterSubtopicIds,
    difficultyTiers: filterDifficultyTiers.length > 0 ? filterDifficultyTiers : undefined,
    questionTypes: filterQuestionTypes.length > 0 ? filterQuestionTypes : undefined,
    historyMode: filterHistoryMode,
    learningObjectiveQuery: filterLearningObjective.trim() || undefined,
    minMarks: filterMinMarks ? Number(filterMinMarks) : undefined,
    maxMarks: filterMaxMarks ? Number(filterMaxMarks) : undefined,
    minEstimatedSeconds: filterMinSecs ? Number(filterMinSecs) : undefined,
    maxEstimatedSeconds: filterMaxSecs ? Number(filterMaxSecs) : undefined,
    questionCount: filterQuestionCount,
    balanceByTopic: filterBalanceTopics,
  });

  const handlePreviewQuestionPool = async () => {
    setErrorMsg(null);
    try {
      const res = await api.previewScheduleQuestions({
        studentId: selectedStudentId,
        filters: buildFilterCriteria(),
      });
      setQuestionPoolPreview(res);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handlePreviewCustomSchedule = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const exceptions = customExceptionsCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.previewCustomTimetable({
        studentId: selectedStudentId,
        title: customTitle.trim() || 'Guided Practice Block',
        activityType: customActivityType,
        timezone: customTimezone,
        startDate: customStartDate,
        endDate: customRecurrence === 'one_time' ? customStartDate : customEndDate || null,
        timeOfDay: customTimeOfDay,
        durationMinutes: customDurationMinutes,
        recurrenceType: customRecurrence,
        weekdays: customWeekdays,
        exceptionDates: exceptions,
        filterCriteria: buildFilterCriteria(),
      });
      setSchedulePreview(res);
      setQuestionPoolPreview(res.questionAvailability);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleCreateCustomTimetable = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!customTitle.trim()) {
      setErrorMsg('Please enter a timetable session title.');
      return;
    }
    setBusy(true);
    try {
      const exceptions = customExceptionsCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.createCustomTimetable({
        studentId: selectedStudentId,
        title: customTitle.trim(),
        activityType: customActivityType,
        timezone: customTimezone,
        startDate: customStartDate,
        endDate: customRecurrence === 'one_time' ? customStartDate : customEndDate || null,
        timeOfDay: customTimeOfDay,
        durationMinutes: customDurationMinutes,
        gracePeriodMinutes: customGraceMinutes,
        recurrenceType: customRecurrence,
        weekdays: customWeekdays,
        exceptionDates: exceptions,
        filterCriteria: buildFilterCriteria(),
      });
      setStatusMsg(
        `Created "${res.timetable.title}" with ${res.sessions.length} scheduled session(s) and reminder jobs.`
      );
      setCustomTitle('');
      setSchedulePreview(null);
      await loadStudentPlannerData(selectedStudentId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDispatchReport = async (
    reportId: string,
    channels: ('in_app' | 'email' | 'whatsapp')[]
  ) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.dispatchParentReport(reportId, channels);
      setDeliveriesByReport((prev) => ({ ...prev, [reportId]: res.deliveries }));
      setStatusMsg('Report notification delivery triggered across selected enabled channels.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleDownloadReport = async (reportId: string, format: 'html' | 'pdf') => {
    setErrorMsg(null);
    try {
      await api.downloadAuthorizedReportFile(reportId, format);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleRescheduleSubmit = async (sessionId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await api.rescheduleScheduledSession(sessionId, {
        newDate: rescheduleDate,
        newTimeOfDay: rescheduleTime,
        timezone: rescheduleTz,
        durationMinutes: rescheduleDuration,
      });
      setRescheduleId(null);
      setStatusMsg('Session rescheduled cleanly and pending reminders updated.');
      await loadStudentPlannerData(selectedStudentId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleSessionStatusAction = async (
    sessionId: string,
    action: 'pause' | 'resume' | 'cancel'
  ) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await api.updateScheduledSessionStatus(sessionId, action);
      setStatusMsg(`Session ${action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'cancelled'}.`);
      await loadStudentPlannerData(selectedStudentId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handlePreviewPreset = async (presetId: string) => {
    setErrorMsg(null);
    try {
      const res = await api.previewPresetApplication(presetId, {
        studentId: selectedStudentId,
        startDate: presetStartDate,
        endDate: presetEndDate || undefined,
        timezone: presetTimezone,
      });
      setPresetPreviewById((prev) => ({ ...prev, [presetId]: res }));
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleApplyPreset = async (presetId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const res = await api.applyTimetablePreset(presetId, {
        studentId: selectedStudentId,
        startDate: presetStartDate,
        endDate: presetEndDate || undefined,
        timezone: presetTimezone,
        skipConflicts: presetSkipConflicts,
      });
      setStatusMsg(
        `Applied "${res.timetable.title}" (${res.sessions.length} sessions scheduled${
          res.skippedConflicts > 0 ? `, ${res.skippedConflicts} conflicting slot(s) skipped` : ''
        }).`
      );
      await loadStudentPlannerData(selectedStudentId);
      setSubTab('schedule');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveReminderPreferences = async (patch: Partial<ReminderPreferenceRecord>) => {
    if (!preferences) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.updateReminderPreferences(selectedStudentId, {
        leadTimesMinutes: patch.leadTimesMinutes ?? preferences.leadTimesMinutes,
        channels: patch.channels ?? preferences.channels,
        dailyDigestEnabled: patch.dailyDigestEnabled ?? preferences.dailyDigestEnabled,
      });
      setPreferences(res.preferences);
      setStatusMsg('Reminder preferences saved.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleSaveGuardianPermissions = async () => {
    if (!activeLink) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await api.updateGuardianLinkPermissions(activeLink.id, {
        studentCanEditSchedule: studentCanEdit,
        studentDailyMaxMinutes: studentMaxDailyMin,
        studentRescheduleWindowHours: studentWindowHours,
      });
      setStatusMsg('Student schedule permissions & daily limits updated.');
      onLinksUpdated();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const visibleTopics = topics.filter(
    (t) => filterSubjectIds.length === 0 || filterSubjectIds.includes(t.subjectId)
  );
  const visibleSubtopics = subtopics.filter(
    (st) =>
      (filterTopicIds.length === 0 || filterTopicIds.includes(st.topicId)) &&
      (filterSubjectIds.length === 0 || filterSubjectIds.includes(st.subjectId))
  );

  // Calendar grouping for schedule calendar view
  const calendarGroups: Record<string, ScheduledSessionRecord[]> = {};
  for (const s of sessions) {
    const dayKey = formatUtcInTimeZone(s.scheduledStartUtc, s.timezone).dateStr || 'Unscheduled';
    if (!calendarGroups[dayKey]) calendarGroups[dayKey] = [];
    calendarGroups[dayKey].push(s);
  }
  const sortedCalendarDays = Object.keys(calendarGroups).sort();

  return (
    <div className="space-y-6" data-testid="parent-learning-planner">
      {/* Header + Multi-Child Switcher + Section Switcher */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-[#158EE3]">
              Parent Learning Intelligence &amp; Smart Scheduling Hub
            </div>
            <h1 className="text-xl sm:text-2xl font-display font-extrabold text-[#0F2942]">
              {activeLink?.studentName || 'Linked Student'} · Teaching Guides &amp; Study Timetable
            </h1>
            <p className="text-xs text-[#526A84] mt-0.5">
              Understand every question, teach concepts calmly at home, and organize balanced practice sessions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
            {(
              [
                { id: 'reports', label: 'Reports & Teaching Guides' },
                { id: 'schedule', label: 'Smart Timetable Builder' },
                { id: 'presets', label: 'Presets & Reminder Settings' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={`parent-tab-${tab.id}`}
                onClick={() => setSubTab(tab.id)}
                className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  subTab === tab.id
                    ? 'bg-[#158EE3] text-white'
                    : 'text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Verified Linked Children Selector (supports 1 guardian -> multiple children) */}
        {links.length > 0 && (
          <div className="pt-3 border-t border-[#E5F0FA] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-[#476481] flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#158EE3]" /> Linked Students:
              </span>
              {links.map((lk) => {
                const active = lk.studentUserId === selectedStudentId;
                return (
                  <button
                    key={lk.id}
                    type="button"
                    data-testid={`select-child-${lk.studentUserId}`}
                    onClick={() => onSelectStudentId(lk.studentUserId)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-[#EBF5FF] border-[#158EE3] text-[#0F2942]'
                        : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#526A84] hover:text-[#0F2942]'
                    }`}
                  >
                    {lk.studentName || lk.studentUserId}{' '}
                    <span className="text-[11px] font-mono text-[#158EE3]">
                      ({lk.relationshipLabel})
                    </span>
                  </button>
                );
              })}
            </div>

            {activeLink && (
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#526A84]">
                <span className="font-semibold text-[#2E7D32]">
                  {activeLink.verified && activeLink.consentGiven
                    ? 'Verified Guardian Link & Consent Active'
                    : 'Verification / Consent Pending'}
                </span>
                <span>· Max Child Limit: {activeLink.studentDailyMaxMinutes}m/day</span>
              </div>
            )}
          </div>
        )}
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

      {/* TAB 1: REPORTS & PARENT TEACHING GUIDES */}
      {subTab === 'reports' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left column: Reports List */}
          <div className="xl:col-span-4 bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#E5F0FA]">
              <h2 className="text-sm font-display font-bold text-[#0F2942]">
                Assessment &amp; Practice Reports ({reports.length})
              </h2>
              <FileText className="w-4 h-4 text-[#158EE3]" />
            </div>

            {loading ? (
              <div className="py-8 text-center text-xs text-[#526A84]">
                Loading child assessment reports...
              </div>
            ) : reports.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#526A84]">
                No completed assessments or practice rounds recorded for this child yet.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
                {reports.map((r) => {
                  const selected = activeReport?.id === r.id;
                  const pending = r.finalizationStatus === 'pending_manual_marking';
                  return (
                    <button
                      key={r.id}
                      type="button"
                      data-testid={`report-card-${r.id}`}
                      onClick={() => setSelectedReportId(r.id)}
                      className={`w-full text-left p-3.5 rounded-2xl border transition-colors space-y-1.5 ${
                        selected
                          ? 'bg-[#EBF5FF] border-[#158EE3]'
                          : 'bg-[#F8FBFF] border-[#DCEBFA] hover:bg-[#F3F9FF]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#0F2942] truncate">
                          {r.assessmentTitle}
                        </span>
                        <span
                          className={`text-xs font-extrabold tabular-nums shrink-0 ${
                            pending
                              ? 'text-[#D97706]'
                              : (r.scorePercent ?? 0) >= 75
                              ? 'text-[#2E7D32]'
                              : 'text-[#158EE3]'
                          }`}
                        >
                          {pending ? 'Pending' : `${r.scorePercent ?? 0}%`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-[#526A84] tabular-nums">
                        <span>
                          {r.correctCount} correct · {r.incorrectCount} review · {r.totalQuestions} Qs
                        </span>
                        <span>{new Date(r.generatedAt).toLocaleDateString()}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right column: Full Question-by-Question Teaching Report */}
          <div className="xl:col-span-8 space-y-5">
            {!activeReport ? (
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-10 text-center text-sm text-[#526A84]">
                Select an assessment report to inspect question-by-question guidance and teaching methods.
              </div>
            ) : (
              <>
                <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#E5F0FA]">
                    <div className="space-y-1 max-w-xl">
                      <div className="text-xs font-bold text-[#158EE3]">
                        {activeReport.assessmentKind === 'mock_exam'
                          ? 'Mock Examination Report'
                          : 'Practice Session Report'}{' '}
                        · {activeReport.studentName}
                      </div>
                      <h2 className="text-xl font-display font-extrabold text-[#0F2942]">
                        {activeReport.assessmentTitle}
                      </h2>
                      <p className="text-xs text-[#476481] leading-relaxed">
                        {activeReport.parentSummary}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        data-testid="download-report-html"
                        onClick={() => handleDownloadReport(activeReport.id, 'html')}
                        className="px-3 py-2 text-xs font-bold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5 text-[#158EE3]" />
                        <span>Download HTML</span>
                      </button>
                      <button
                        type="button"
                        data-testid="download-report-pdf"
                        onClick={() => handleDownloadReport(activeReport.id, 'pdf')}
                        className="px-3 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleDispatchReport(activeReport.id, ['in_app', 'email', 'whatsapp'])
                        }
                        className="px-3 py-2 text-xs font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Resend to Family</span>
                      </button>
                    </div>
                  </div>

                  {/* Summary Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
                    <div className="p-3.5 rounded-2xl bg-[#F3F9FF] border border-[#DCEBFA]">
                      <div className="text-[11px] text-[#526A84]">Final Score</div>
                      <div className="text-2xl font-display font-extrabold text-[#158EE3]">
                        {activeReport.finalizationStatus === 'pending_manual_marking'
                          ? 'Pending'
                          : `${activeReport.scorePercent ?? 0}%`}
                      </div>
                    </div>
                    <div className="p-3.5 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4]">
                      <div className="text-[11px] text-[#526A84]">Correct / Marks</div>
                      <div className="text-lg font-display font-extrabold text-[#2E7D32]">
                        {activeReport.correctCount}/{activeReport.totalQuestions} ·{' '}
                        {activeReport.awardedMarks}/{activeReport.maxMarks} mks
                      </div>
                    </div>
                    <div className="p-3.5 rounded-2xl bg-[#FFF7EB] border border-[#FDE1B2]">
                      <div className="text-[11px] text-[#526A84]">Needs Review</div>
                      <div className="text-lg font-display font-extrabold text-[#D97706]">
                        {activeReport.incorrectCount + activeReport.partialCount} Qs (
                        {activeReport.unansweredCount} skipped)
                      </div>
                    </div>
                    <div className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA]">
                      <div className="text-[11px] text-[#526A84]">Time Spent</div>
                      <div className="text-lg font-display font-extrabold text-[#0F2942]">
                        {Math.max(1, Math.round(activeReport.timeSpentSeconds / 60))} min
                      </div>
                    </div>
                  </div>

                  {/* Warm Non-Diagnostic Parent Note */}
                  <div className="p-4 rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA] text-xs text-[#0E4F80] flex items-start gap-2.5">
                    <Sparkles className="w-4 h-4 text-[#158EE3] shrink-0 mt-0.5" />
                    <div>
                      <strong>Supportive Home Tip:</strong> {activeReport.encouragementNote}
                    </div>
                  </div>

                  {/* Main Improvement Areas & Recommended Knowledge Guides */}
                  {activeReport.mainImprovementAreas.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="p-3.5 rounded-2xl bg-[#FFF8F2] border border-[#FDE1B2] space-y-1.5">
                        <div className="font-bold text-[#9A5B00]">
                          Priority Topics to Practise Gently
                        </div>
                        {activeReport.mainImprovementAreas.map((area, i) => (
                          <div key={i} className="text-[#476481]">
                            • <strong>{area.topicName}</strong> ({area.subjectName}) —{' '}
                            {area.accuracyPercent}% accuracy · {area.recommendedAction}
                          </div>
                        ))}
                      </div>

                      {activeReport.recommendedResources.length > 0 && (
                        <div className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-1.5">
                          <div className="font-bold text-[#0F2942] flex items-center gap-1.5">
                            <BookOpen className="w-3.5 h-3.5 text-[#158EE3]" />
                            <span>Recommended Parent &amp; Child Guides</span>
                          </div>
                          {activeReport.recommendedResources.map((res) => (
                            <div key={res.id} className="text-[#476481]">
                              • <strong>{res.title}</strong> ({res.subjectName})
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Delivery Log */}
                  {(deliveriesByReport[activeReport.id] || []).length > 0 && (
                    <div className="pt-2 border-t border-[#E5F0FA]">
                      <div className="text-[11px] font-bold text-[#526A84] mb-1.5">
                        Notification &amp; Report Delivery History
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        {(deliveriesByReport[activeReport.id] || []).slice(0, 8).map((del) => (
                          <div
                            key={del.id}
                            className="px-2.5 py-1 rounded-lg bg-[#F8FBFF] border border-[#DCEBFA] text-[#476481]"
                          >
                            <strong className="uppercase">{del.channel}</strong> ({del.deliveryStage}):{' '}
                            <span
                              className={
                                del.deliveryStatus === 'delivered'
                                  ? 'text-[#2E7D32] font-bold'
                                  : 'text-[#D97706] font-semibold'
                              }
                            >
                              {del.deliveryStatus}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Question-by-Question Filter Bar */}
                <div className="bg-white rounded-2xl border border-[#DCEBFA] px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-display font-bold text-[#0F2942]">
                    Question-by-Question Parent Teaching Review ({activeReport.items.length})
                  </div>
                  <div className="flex items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
                    {(
                      [
                        { id: 'all', label: 'All Questions' },
                        { id: 'incorrect', label: 'Needs Review Only' },
                        { id: 'correct', label: 'Answered Correctly' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setReportQuestionFilter(f.id)}
                        className={`px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
                          reportQuestionFilter === f.id
                            ? 'bg-[#0F2942] text-white'
                            : 'text-[#526A84] hover:text-[#0F2942]'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Individual Question Cards */}
                <div className="space-y-4">
                  {activeReport.items
                    .filter((item) => {
                      if (reportQuestionFilter === 'incorrect') {
                        return item.correctnessStatus !== 'correct';
                      }
                      if (reportQuestionFilter === 'correct') {
                        return item.correctnessStatus === 'correct';
                      }
                      return true;
                    })
                    .map((item, idx) => {
                      const isCorrect = item.correctnessStatus === 'correct';
                      const isExpanded =
                        expandedGuides[item.snapshotId] ?? !isCorrect;

                      return (
                        <article
                          key={item.snapshotId || `${item.questionId}-${idx}`}
                          data-testid={`report-question-${item.questionId}`}
                          className="bg-white rounded-3xl border border-[#DCEBFA] p-5 sm:p-6 space-y-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[#E5F0FA]">
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold text-[#158EE3]">
                                {item.questionId} v{item.questionVersion} · {item.subjectName} →{' '}
                                {item.topicName} · {item.difficulty}
                              </div>
                              <h3 className="text-base font-display font-bold text-[#0F2942]">
                                {idx + 1}. {item.questionSi}
                              </h3>
                              {item.questionEn && item.questionEn !== item.questionSi && (
                                <p className="text-xs text-[#526A84]">{item.questionEn}</p>
                              )}
                            </div>

                            <div className="text-right shrink-0">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold ${
                                  isCorrect
                                    ? 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                                    : item.correctnessStatus === 'pending_manual'
                                    ? 'bg-[#FFF8EB] border-[#F3D19C] text-[#9A5B00]'
                                    : 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                                }`}
                              >
                                {isCorrect ? (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5" />
                                )}
                                <span className="capitalize">
                                  {item.correctnessStatus.replace(/_/g, ' ')}
                                </span>
                              </span>
                              <div className="text-[11px] font-bold text-[#526A84] mt-1 tabular-nums">
                                {item.awardedMarks}/{item.maxMarks} Marks
                              </div>
                            </div>
                          </div>

                          {item.imageUrl && (
                            <div className="rounded-2xl border border-[#DCEBFA] bg-[#F8FBFF] p-3">
                              <img
                                src={item.imageUrl}
                                alt="Question visual diagram"
                                referrerPolicy="no-referrer"
                                className="max-h-48 mx-auto rounded-xl object-contain"
                              />
                            </div>
                          )}

                          {/* Student Answer vs Correct Answer */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            <div
                              className={`p-3 rounded-2xl border ${
                                isCorrect
                                  ? 'bg-[#EEF9EF] border-[#C1E8C4]'
                                  : 'bg-[#FFF5F2] border-[#FAC5B2]'
                              }`}
                            >
                              <div className="text-[11px] font-bold text-[#526A84]">
                                Your Child&apos;s Answer
                              </div>
                              <div className="text-sm font-bold text-[#0F2942] mt-0.5">
                                {item.studentAnswerDisplay}
                              </div>
                            </div>

                            <div className="p-3 rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA]">
                              <div className="text-[11px] font-bold text-[#526A84]">
                                Correct Answer &amp; Marking Rule
                              </div>
                              <div className="text-sm font-bold text-[#0E4F80] mt-0.5">
                                {item.correctAnswerDisplay}
                              </div>
                              {item.markingCriteria && (
                                <div className="text-[11px] text-[#526A84] mt-0.5">
                                  {item.markingCriteria}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Explanation & Memory Trick */}
                          <div className="text-xs text-[#476481] space-y-2">
                            <div>
                              <strong className="text-[#0F2942]">Explanation:</strong>{' '}
                              {item.stepByStepExplanation}
                            </div>
                            {item.memoryTrickBody && (
                              <div className="p-3 rounded-xl bg-[#FFF9EE] border border-[#FDE1B2] text-[#613C00]">
                                <strong>{item.memoryTrickTitle}:</strong> {item.memoryTrickBody}
                              </div>
                            )}
                            {item.graderComment && (
                              <div className="p-3 rounded-xl bg-[#EBF5FF] border border-[#99CAFA] text-[#0E4F80]">
                                <strong>Teacher Comment:</strong> {item.graderComment}
                              </div>
                            )}
                          </div>

                          {/* Toggle Full 9-Point Parent Teaching Guide */}
                          <div className="pt-2 border-t border-[#E5F0FA]">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedGuides((prev) => ({
                                  ...prev,
                                  [item.snapshotId]: !isExpanded,
                                }))
                              }
                              className="w-full flex items-center justify-between text-xs font-bold text-[#158EE3] py-1"
                            >
                              <span className="flex items-center gap-1.5">
                                <HelpCircle className="w-4 h-4" />
                                {isCorrect
                                  ? 'Correct Answer Note & Optional Parent Teaching Guide'
                                  : 'Open Step-by-Step Parent Teaching Guide (How to Teach This)'}
                              </span>
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>

                            {isCorrect && !isExpanded && (
                              <p className="text-xs text-[#2E7D32] mt-1">
                                {item.teachingGuidance.shortCorrectNote}
                              </p>
                            )}

                            {isExpanded && (
                              <div
                                data-testid={`teaching-guide-${item.questionId}`}
                                className="mt-3 p-4 rounded-2xl bg-[#F8FBFF] border border-[#CBE2FA] space-y-3 text-xs text-[#0F2942]"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#526A84]">
                                  <span>
                                    Source: <strong>{item.teachingGuidance.approvedByName}</strong> (
                                    {item.teachingGuidance.sourceType.replace(/_/g, ' ')})
                                  </span>
                                  <span>Objective: {item.teachingGuidance.learningObjective}</span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] space-y-1">
                                    <div className="font-bold text-[#158EE3]">
                                      1. What This Question Tests
                                    </div>
                                    <p className="text-[#476481]">{item.teachingGuidance.whatItTests}</p>
                                  </div>

                                  <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] space-y-1">
                                    <div className="font-bold text-[#158EE3]">
                                      2. How to Explain Step by Step
                                    </div>
                                    <p className="text-[#476481]">
                                      {item.teachingGuidance.teachingMethod}
                                    </p>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] space-y-1">
                                    <div className="font-bold text-[#0F2942]">
                                      3. Correct Solution Steps
                                    </div>
                                    <ul className="space-y-1 text-[#476481] list-disc pl-4">
                                      {item.teachingGuidance.correctSolutionSteps.map((s, si) => (
                                        <li key={si}>{s}</li>
                                      ))}
                                    </ul>
                                  </div>

                                  <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] space-y-1">
                                    <div className="font-bold text-[#9A5B00]">
                                      4. Possible Reasons Your Child Missed This
                                    </div>
                                    <ul className="space-y-1 text-[#476481] list-disc pl-4">
                                      {item.teachingGuidance.plausibleErrorReasons.map((r, ri) => (
                                        <li key={ri}>{r}</li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] space-y-1">
                                    <div className="font-bold text-[#2E7D32]">
                                      5. Everyday Practical Examples
                                    </div>
                                    <ul className="space-y-1 text-[#476481] list-disc pl-4">
                                      {item.teachingGuidance.practicalExamples.map((ex, ei) => (
                                        <li key={ei}>{ex}</li>
                                      ))}
                                    </ul>
                                  </div>

                                  <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] space-y-1">
                                    <div className="font-bold text-[#158EE3]">
                                      6. Helpful Questions to Ask Your Child
                                    </div>
                                    <ul className="space-y-1 text-[#476481] list-disc pl-4">
                                      {item.teachingGuidance.questionsToAskChild.map((qAsk, qi) => (
                                        <li key={qi}>{qAsk}</li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] space-y-1">
                                    <div className="font-bold text-[#C62828]">
                                      7. Common Pitfalls to Avoid
                                    </div>
                                    <ul className="space-y-1 text-[#476481] list-disc pl-4">
                                      {item.teachingGuidance.commonMistakesToAvoid.map((m, mi) => (
                                        <li key={mi}>{m}</li>
                                      ))}
                                    </ul>
                                  </div>

                                  <div className="p-3 rounded-xl bg-white border border-[#DCEBFA] space-y-1">
                                    <div className="font-bold text-[#0F2942]">
                                      8. Follow-Up Practice &amp; Teacher Support
                                    </div>
                                    <p className="text-[#476481]">
                                      {item.teachingGuidance.followupPracticeSuggestion}
                                    </p>
                                    {item.teachingGuidance.teacherHelpIndicators.map((ind, ii) => (
                                      <p key={ii} className="text-[11px] text-[#526A84]">
                                        • {ind}
                                      </p>
                                    ))}
                                  </div>
                                </div>

                                {item.relatedResources.length > 0 && (
                                  <div className="text-[11px] text-[#0E4F80] pt-1">
                                    <strong>Related Published Guides:</strong>{' '}
                                    {item.relatedResources.map((rr) => rr.title).join(' · ')}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SMART TIMETABLE BUILDER & CALENDAR */}
      {subTab === 'schedule' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Custom Smart Timetable Builder */}
          <form
            onSubmit={handleCreateCustomTimetable}
            className="xl:col-span-5 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4"
          >
            <div className="flex items-center gap-2 pb-3 border-b border-[#E5F0FA]">
              <Filter className="w-4 h-4 text-[#158EE3]" />
              <h2 className="text-base font-display font-bold text-[#0F2942]">
                Create Personalized Smart Schedule
              </h2>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="cs-title" className="block font-semibold text-[#476481] mb-1">
                  Session / Routine Title
                </label>
                <input
                  id="cs-title"
                  type="text"
                  required
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g. Evening Fractions Retry Practice"
                  className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="cs-type" className="block font-semibold text-[#476481] mb-1">
                    Activity Type
                  </label>
                  <select
                    id="cs-type"
                    value={customActivityType}
                    onChange={(e) =>
                      setCustomActivityType(e.target.value as LearningActivityType)
                    }
                    className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                  >
                    <option value="practice">Practice Session</option>
                    <option value="timed_practice">Timed Practice</option>
                    <option value="mock_exam">Mock Exam</option>
                    <option value="topic_revision">Topic Revision</option>
                    <option value="followup_activity">Follow-Up Activity</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="cs-tz" className="block font-semibold text-[#476481] mb-1">
                    Family Timezone
                  </label>
                  <select
                    id="cs-tz"
                    value={customTimezone}
                    onChange={(e) => setCustomTimezone(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="cs-start" className="block font-semibold text-[#476481] mb-1">
                    Start Date
                  </label>
                  <input
                    id="cs-start"
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="cs-time" className="block font-semibold text-[#476481] mb-1">
                    Time of Day
                  </label>
                  <input
                    id="cs-time"
                    type="time"
                    value={customTimeOfDay}
                    onChange={(e) => setCustomTimeOfDay(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="cs-rec" className="block font-semibold text-[#476481] mb-1">
                    Recurrence
                  </label>
                  <select
                    id="cs-rec"
                    value={customRecurrence}
                    onChange={(e) =>
                      setCustomRecurrence(e.target.value as TimetableRecurrenceType)
                    }
                    className="w-full px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                  >
                    <option value="one_time">One-time</option>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="weekly">Weekly</option>
                    <option value="custom">Custom Days</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cs-dur" className="block font-semibold text-[#476481] mb-1">
                    Duration (min)
                  </label>
                  <input
                    id="cs-dur"
                    type="number"
                    min={10}
                    max={120}
                    value={customDurationMinutes}
                    onChange={(e) => setCustomDurationMinutes(Number(e.target.value))}
                    className="w-full px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="cs-grace" className="block font-semibold text-[#476481] mb-1">
                    Grace (min)
                  </label>
                  <input
                    id="cs-grace"
                    type="number"
                    min={5}
                    max={120}
                    value={customGraceMinutes}
                    onChange={(e) => setCustomGraceMinutes(Number(e.target.value))}
                    className="w-full px-2.5 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                  />
                </div>
              </div>

              {customRecurrence !== 'one_time' && (
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="cs-end" className="block font-semibold text-[#476481] mb-1">
                      End Date
                    </label>
                    <input
                      id="cs-end"
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="cs-exc" className="block font-semibold text-[#476481] mb-1">
                      Skip Dates (CSV)
                    </label>
                    <input
                      id="cs-exc"
                      type="text"
                      value={customExceptionsCsv}
                      onChange={(e) => setCustomExceptionsCsv(e.target.value)}
                      placeholder="YYYY-MM-DD, ..."
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                    />
                  </div>
                </div>
              )}

              {(customRecurrence === 'weekly' || customRecurrence === 'custom') && (
                <div>
                  <div className="font-semibold text-[#476481] mb-1">Days of Week</div>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_LABELS.map((wd) => {
                      const active = customWeekdays.includes(wd.id);
                      return (
                        <button
                          key={wd.id}
                          type="button"
                          onClick={() =>
                            setCustomWeekdays((prev) =>
                              prev.includes(wd.id)
                                ? prev.length > 1
                                  ? prev.filter((d) => d !== wd.id)
                                  : prev
                                : [...prev, wd.id]
                            )
                          }
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                            active
                              ? 'bg-[#158EE3] border-[#158EE3] text-white'
                              : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#526A84]'
                          }`}
                        >
                          {wd.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Question Selection Filter Panel */}
              <div className="pt-2 border-t border-[#E5F0FA] space-y-2.5">
                <div className="font-bold text-[#0F2942]">
                  Question Pool &amp; History Filters
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {subjects.map((s) => {
                    const checked = filterSubjectIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`px-2.5 py-1 rounded-lg border cursor-pointer flex items-center gap-1 text-[11px] ${
                          checked
                            ? 'bg-[#EBF5FF] border-[#99CAFA] text-[#0E4F80] font-semibold'
                            : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#526A84]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setFilterSubjectIds((prev) =>
                              prev.includes(s.id)
                                ? prev.filter((id) => id !== s.id)
                                : [...prev, s.id]
                            )
                          }
                          className="accent-[#158EE3]"
                        />
                        <span>{s.nameEn}</span>
                      </label>
                    );
                  })}
                </div>

                {visibleTopics.length > 0 && (
                  <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1 p-2 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                    {visibleTopics.map((t) => (
                      <label
                        key={t.id}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#DCEBFA] text-[11px] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={filterTopicIds.includes(t.id)}
                          onChange={() =>
                            setFilterTopicIds((prev) =>
                              prev.includes(t.id)
                                ? prev.filter((id) => id !== t.id)
                                : [...prev, t.id]
                            )
                          }
                          className="accent-[#158EE3]"
                        />
                        <span>{t.nameEn}</span>
                      </label>
                    ))}
                  </div>
                )}

                {visibleSubtopics.length > 0 && (
                  <div className="max-h-20 overflow-y-auto flex flex-wrap gap-1 p-2 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                    {visibleSubtopics.map((st) => (
                      <label
                        key={st.id}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#DCEBFA] text-[11px] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={filterSubtopicIds.includes(st.id)}
                          onChange={() =>
                            setFilterSubtopicIds((prev) =>
                              prev.includes(st.id)
                                ? prev.filter((id) => id !== st.id)
                                : [...prev, st.id]
                            )
                          }
                          className="accent-[#158EE3]"
                        />
                        <span>{st.nameEn}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="cs-hist" className="block font-semibold text-[#476481] mb-1">
                      Attempt History Mode
                    </label>
                    <select
                      id="cs-hist"
                      value={filterHistoryMode}
                      onChange={(e) =>
                        setFilterHistoryMode(e.target.value as QuestionHistoryFilterMode)
                      }
                      className="w-full px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    >
                      <option value="all">All Approved Questions</option>
                      <option value="unattempted">Not Yet Attempted</option>
                      <option value="previously_attempted">Previously Attempted</option>
                      <option value="previously_incorrect">Previously Incorrect</option>
                      <option value="repeated_error">Repeated Error Areas</option>
                      <option value="weak_areas">Child&apos;s Weak Topics</option>
                      <option value="revision_due">Revision Due</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="cs-qcount" className="block font-semibold text-[#476481] mb-1">
                      Questions Per Session
                    </label>
                    <input
                      id="cs-qcount"
                      type="number"
                      min={1}
                      max={40}
                      value={filterQuestionCount}
                      onChange={(e) => setFilterQuestionCount(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                    />
                  </div>
                </div>

                {/* Difficulty & Question Types */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="font-semibold text-[#476481] mb-1">Difficulty Tiers</div>
                    <div className="flex flex-wrap gap-1">
                      {(
                        ['Simple', 'Moderate', 'Challenging', 'Scholarship Master'] as DifficultyTier[]
                      ).map((tier) => (
                        <button
                          key={tier}
                          type="button"
                          onClick={() =>
                            setFilterDifficultyTiers((prev) =>
                              prev.includes(tier)
                                ? prev.filter((d) => d !== tier)
                                : [...prev, tier]
                            )
                          }
                          className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${
                            filterDifficultyTiers.includes(tier)
                              ? 'bg-[#0F2942] border-[#0F2942] text-white'
                              : 'bg-white border-[#DCEBFA] text-[#526A84]'
                          }`}
                        >
                          {tier}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-[#476481] mb-1">Question Types</div>
                    <div className="flex flex-wrap gap-1">
                      {(['mcq', 'true_false', 'numerical', 'short_answer'] as QuestionType[]).map(
                        (qt) => (
                          <button
                            key={qt}
                            type="button"
                            onClick={() =>
                              setFilterQuestionTypes((prev) =>
                                prev.includes(qt)
                                  ? prev.filter((x) => x !== qt)
                                  : [...prev, qt]
                              )
                            }
                            className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${
                              filterQuestionTypes.includes(qt)
                                ? 'bg-[#158EE3] border-[#158EE3] text-white'
                                : 'bg-white border-[#DCEBFA] text-[#526A84]'
                            }`}
                          >
                            {qt.replace('_', ' ')}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <input
                    type="number"
                    placeholder="Min marks"
                    value={filterMinMarks}
                    onChange={(e) => setFilterMinMarks(e.target.value)}
                    className="px-2 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-lg text-[11px]"
                  />
                  <input
                    type="number"
                    placeholder="Max marks"
                    value={filterMaxMarks}
                    onChange={(e) => setFilterMaxMarks(e.target.value)}
                    className="px-2 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-lg text-[11px]"
                  />
                  <input
                    type="number"
                    placeholder="Min sec"
                    value={filterMinSecs}
                    onChange={(e) => setFilterMinSecs(e.target.value)}
                    className="px-2 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-lg text-[11px]"
                  />
                  <input
                    type="number"
                    placeholder="Max sec"
                    value={filterMaxSecs}
                    onChange={(e) => setFilterMaxSecs(e.target.value)}
                    className="px-2 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-lg text-[11px]"
                  />
                </div>

                <input
                  type="text"
                  value={filterLearningObjective}
                  onChange={(e) => setFilterLearningObjective(e.target.value)}
                  placeholder="Learning objective keyword (optional)"
                  className="w-full px-3 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-[11px]"
                />

                <label className="flex items-center gap-2 cursor-pointer text-[11px] text-[#0F2942]">
                  <input
                    type="checkbox"
                    checked={filterBalanceTopics}
                    onChange={(e) => setFilterBalanceTopics(e.target.checked)}
                    className="accent-[#158EE3]"
                  />
                  <span>Balance selected questions evenly across chosen topics</span>
                </label>
              </div>
            </div>

            {questionPoolPreview && (
              <div
                data-testid="question-pool-preview"
                className={`p-3 rounded-2xl border text-xs ${
                  questionPoolPreview.insufficient
                    ? 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                    : 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                }`}
              >
                <div className="font-bold tabular-nums">
                  Matching Questions Available: {questionPoolPreview.availableCount} /{' '}
                  {questionPoolPreview.requestedCount} requested
                </div>
                {questionPoolPreview.warnings.map((w, i) => (
                  <div key={i} className="mt-0.5 text-[11px]">
                    • {w}
                  </div>
                ))}
              </div>
            )}

            {schedulePreview && (
              <div className="p-3 rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA] text-xs space-y-1.5">
                <div className="font-bold text-[#0F2942] tabular-nums">
                  Schedule Preview: {schedulePreview.occurrenceCount} session(s) ·{' '}
                  {schedulePreview.conflicts.length} conflict(s)
                </div>
                {schedulePreview.conflicts.map((c, idx) => (
                  <div key={idx} className="text-[11px] text-[#C62828]">
                    Conflict: {c.reason}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="check-matching-questions-btn"
                onClick={handlePreviewQuestionPool}
                className="flex-1 py-2 px-3 text-xs font-bold text-[#158EE3] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl whitespace-nowrap shrink-0"
              >
                Check Matching Questions
              </button>
              <button
                type="button"
                data-testid="preview-custom-schedule-btn"
                onClick={handlePreviewCustomSchedule}
                className="flex-1 py-2 px-3 text-xs font-bold text-[#0F2942] bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl whitespace-nowrap shrink-0"
              >
                Preview Dates &amp; Conflicts
              </button>
            </div>

            <button
              type="submit"
              disabled={busy || Boolean(questionPoolPreview?.insufficient)}
              data-testid="create-custom-schedule-btn"
              className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] disabled:opacity-50 rounded-xl"
            >
              {busy ? 'Scheduling...' : 'Save & Activate Smart Schedule'}
            </button>
          </form>

          {/* Upcoming Sessions List & Calendar View */}
          <div className="xl:col-span-7 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5F0FA]">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#F96A1B]" />
                <h2 className="text-base font-display font-bold text-[#0F2942]">
                  Child Study Timetable &amp; Live Countdowns ({sessions.length})
                </h2>
              </div>
              <div className="flex items-center gap-1 p-1 bg-[#F3F9FF] rounded-xl border border-[#DCEBFA]">
                <button
                  type="button"
                  onClick={() => setScheduleViewMode('list')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg ${
                    scheduleViewMode === 'list'
                      ? 'bg-[#158EE3] text-white'
                      : 'text-[#526A84]'
                  }`}
                >
                  Chronological List
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleViewMode('calendar')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg ${
                    scheduleViewMode === 'calendar'
                      ? 'bg-[#158EE3] text-white'
                      : 'text-[#526A84]'
                  }`}
                >
                  Day Calendar
                </button>
              </div>
            </div>

            {sessions.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#526A84]">
                No scheduled learning activities yet. Create a custom smart schedule or apply a teacher/admin preset!
              </div>
            ) : scheduleViewMode === 'calendar' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[680px] overflow-y-auto">
                {sortedCalendarDays.map((day) => (
                  <div
                    key={day}
                    className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2"
                  >
                    <div className="text-xs font-bold text-[#158EE3] tabular-nums">{day}</div>
                    {calendarGroups[day].map((s) => {
                      const localFmt = formatUtcInTimeZone(s.scheduledStartUtc, s.timezone);
                      return (
                        <div
                          key={s.id}
                          className="p-2.5 rounded-xl bg-white border border-[#E5F0FA] text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[#0F2942] truncate">{s.title}</span>
                            <span className="text-[11px] font-semibold text-[#526A84]">
                              {s.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#526A84] tabular-nums">
                            {localFmt.timeStr} ({s.timezone}) · {s.durationMinutes}m
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3 max-h-[700px] overflow-y-auto pr-1">
                {sessions.map((s) => {
                  const countdown = computeSessionCountdownState(s, nowMs);
                  const fmt = formatUtcInTimeZone(s.scheduledStartUtc, s.timezone);
                  const isEditingThis = rescheduleId === s.id;
                  const canModify = s.status !== 'COMPLETED' && s.status !== 'CANCELLED';

                  return (
                    <div
                      key={s.id}
                      data-testid={`scheduled-session-${s.id}`}
                      className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-bold text-[#0F2942]">{s.title}</div>
                          <div className="text-[11px] text-[#526A84] tabular-nums">
                            {fmt.readable} ({s.timezone}) · {s.durationMinutes} min ·{' '}
                            {s.activityType.replace(/_/g, ' ')}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-bold ${
                              s.status === 'COMPLETED'
                                ? 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                                : s.status === 'MISSED' || s.status === 'CANCELLED'
                                ? 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                                : s.status === 'PAUSED'
                                ? 'bg-[#FFF8EB] border-[#F3D19C] text-[#9A5B00]'
                                : 'bg-[#EBF5FF] border-[#99CAFA] text-[#0E4F80]'
                            }`}
                          >
                            {s.status}
                          </span>
                          <div className="text-[11px] font-bold text-[#158EE3] mt-0.5 tabular-nums">
                            {countdown.countdownLabel}
                          </div>
                        </div>
                      </div>

                      {canModify && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setRescheduleId(isEditingThis ? null : s.id);
                              setRescheduleDate(fmt.dateStr || todayDateInput());
                              setRescheduleTime(fmt.timeStr || '17:00');
                              setRescheduleTz(s.timezone || 'Asia/Colombo');
                              setRescheduleDuration(s.durationMinutes || 25);
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold text-[#0F2942] bg-white border border-[#CBE2FA] rounded-lg"
                          >
                            Reschedule
                          </button>
                          {s.status === 'PAUSED' ? (
                            <button
                              type="button"
                              onClick={() => handleSessionStatusAction(s.id, 'resume')}
                              className="px-2.5 py-1 text-[11px] font-semibold text-[#2E7D32] bg-[#EEF9EF] border border-[#B7E1BA] rounded-lg flex items-center gap-1"
                            >
                              <PlayCircle className="w-3 h-3" /> Resume
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSessionStatusAction(s.id, 'pause')}
                              className="px-2.5 py-1 text-[11px] font-semibold text-[#9A5B00] bg-[#FFF8EB] border border-[#F3D19C] rounded-lg flex items-center gap-1"
                            >
                              <PauseCircle className="w-3 h-3" /> Pause
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleSessionStatusAction(s.id, 'cancel')}
                            className="px-2.5 py-1 text-[11px] font-semibold text-[#C62828] bg-[#FFF2ED] border border-[#FAC5B2] rounded-lg"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {isEditingThis && (
                        <div className="p-3 rounded-xl bg-white border border-[#99CAFA] grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                          <div>
                            <label className="block text-[10px] font-semibold text-[#526A84]">
                              Date
                            </label>
                            <input
                              type="date"
                              value={rescheduleDate}
                              onChange={(e) => setRescheduleDate(e.target.value)}
                              className="w-full px-2 py-1 border border-[#CBE2FA] rounded-lg text-[11px]"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-[#526A84]">
                              Time
                            </label>
                            <input
                              type="time"
                              value={rescheduleTime}
                              onChange={(e) => setRescheduleTime(e.target.value)}
                              className="w-full px-2 py-1 border border-[#CBE2FA] rounded-lg text-[11px]"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-[#526A84]">
                              Timezone
                            </label>
                            <select
                              value={rescheduleTz}
                              onChange={(e) => setRescheduleTz(e.target.value)}
                              className="w-full px-2 py-1 border border-[#CBE2FA] rounded-lg text-[11px]"
                            >
                              {TIMEZONES.map((tz) => (
                                <option key={tz} value={tz}>
                                  {tz}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-[#526A84]">
                              Duration (m)
                            </label>
                            <input
                              type="number"
                              min={10}
                              max={120}
                              value={rescheduleDuration}
                              onChange={(e) => setRescheduleDuration(Number(e.target.value))}
                              className="w-full px-2 py-1 border border-[#CBE2FA] rounded-lg text-[11px]"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRescheduleSubmit(s.id)}
                            className="px-3 py-1.5 text-[11px] font-bold text-white bg-[#158EE3] rounded-lg"
                          >
                            Confirm Move
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PRESETS LIBRARY & REMINDER / STUDENT PERMISSIONS */}
      {subTab === 'presets' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Teacher & Admin Curated Presets */}
          <div className="xl:col-span-7 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
              <div>
                <h2 className="text-base font-display font-bold text-[#0F2942]">
                  Approved Teacher &amp; Admin Timetable Presets ({presets.length})
                </h2>
                <p className="text-xs text-[#526A84]">
                  Preview in your child&apos;s timezone first. Applying creates an independent personal copy you can edit freely.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3.5 rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA] text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-[#476481] mb-1">
                  Start From Date
                </label>
                <input
                  type="date"
                  value={presetStartDate}
                  onChange={(e) => setPresetStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#476481] mb-1">
                  Apply Until
                </label>
                <input
                  type="date"
                  value={presetEndDate}
                  onChange={(e) => setPresetEndDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#476481] mb-1">
                  Target Timezone
                </label>
                <select
                  value={presetTimezone}
                  onChange={(e) => setPresetTimezone(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
              <label className="sm:col-span-3 flex items-center gap-2 text-[11px] text-[#0F2942] cursor-pointer">
                <input
                  type="checkbox"
                  checked={presetSkipConflicts}
                  onChange={(e) => setPresetSkipConflicts(e.target.checked)}
                  className="accent-[#158EE3]"
                />
                <span>Skip any occurrences that conflict with already scheduled study sessions</span>
              </label>
            </div>

            <div className="space-y-3">
              {presets.map((p) => {
                const preview = presetPreviewById[p.id];
                return (
                  <div
                    key={p.id}
                    data-testid={`preset-card-${p.id}`}
                    className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-3 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-[#0F2942]">{p.title}</div>
                        <div className="text-[11px] text-[#526A84]">
                          By {p.creatorName} · {p.recommendedFrequency} · {p.activities.length}{' '}
                          Activities
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-[#2E7D32]">v{p.currentVersion}</span>
                    </div>
                    <p className="text-[#476481]">{p.description}</p>

                    <div className="flex flex-wrap gap-2">
                      {p.activities.map((a) => (
                        <span
                          key={a.id}
                          className="px-2.5 py-1 rounded-lg bg-white border border-[#E5F0FA] text-[11px] text-[#0F2942]"
                        >
                          {a.title} · {a.timeOfDay} ({a.durationMinutes}m)
                        </span>
                      ))}
                    </div>

                    {preview && (
                      <div className="p-3 rounded-xl bg-white border border-[#99CAFA] space-y-1 text-[11px]">
                        <div className="font-bold text-[#0E4F80]">
                          Preview ({presetTimezone}): {preview.occurrences.length} occurrence(s) ·{' '}
                          {preview.conflicts.length} conflict(s)
                        </div>
                        {preview.occurrences.slice(0, 4).map((o, i) => (
                          <div key={i} className="text-[#476481] tabular-nums">
                            • {o.localDate} {o.timeOfDay} — {o.title} ({o.eligibleCount} eligible Qs)
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handlePreviewPreset(p.id)}
                        className="px-3 py-1.5 text-xs font-semibold text-[#158EE3] bg-white border border-[#CBE2FA] rounded-xl"
                      >
                        Preview Dates
                      </button>
                      <button
                        type="button"
                        data-testid={`apply-preset-${p.id}`}
                        disabled={busy}
                        onClick={() => handleApplyPreset(p.id)}
                        className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
                      >
                        Apply Preset to Timetable
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Reminders & Student Self-Edit Permissions */}
          <div className="xl:col-span-5 space-y-5">
            {preferences && (
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-[#E5F0FA]">
                  <Bell className="w-4 h-4 text-[#F96A1B]" />
                  <h2 className="text-base font-display font-bold text-[#0F2942]">
                    Reminder Lead Times &amp; Channels
                  </h2>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <div className="font-semibold text-[#476481] mb-1.5">
                      Remind Child &amp; Family Before Session Starts
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {LEAD_TIME_OPTIONS.map((opt) => {
                        const checked = preferences.leadTimesMinutes.includes(opt.minutes);
                        return (
                          <label
                            key={opt.minutes}
                            className="flex items-center gap-2 p-2 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? preferences.leadTimesMinutes.filter((m) => m !== opt.minutes)
                                  : [...preferences.leadTimesMinutes, opt.minutes];
                                handleSaveReminderPreferences({ leadTimesMinutes: next });
                              }}
                              className="accent-[#158EE3]"
                            />
                            <span>{opt.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="font-semibold text-[#476481] mb-1.5">
                      Active Delivery Channels
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { key: 'inApp', label: 'In-App Alerts' },
                          { key: 'email', label: 'Verified Email' },
                          { key: 'whatsapp', label: 'WhatsApp Business' },
                        ] as const
                      ).map((ch) => (
                        <label
                          key={ch.key}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={preferences.channels[ch.key]}
                            onChange={() =>
                              handleSaveReminderPreferences({
                                channels: {
                                  ...preferences.channels,
                                  [ch.key]: !preferences.channels[ch.key],
                                },
                              })
                            }
                            className="accent-[#158EE3]"
                          />
                          <span>{ch.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Guardian Controls for Student Self-Management Limits */}
            {activeLink && (
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-[#E5F0FA]">
                  <ShieldCheck className="w-4 h-4 text-[#2E7D32]" />
                  <h2 className="text-base font-display font-bold text-[#0F2942]">
                    Student Self-Scheduling Guardrails
                  </h2>
                </div>

                <div className="space-y-3 text-xs">
                  <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={studentCanEdit}
                      onChange={(e) => setStudentCanEdit(e.target.checked)}
                      className="accent-[#158EE3] mt-0.5"
                    />
                    <span>
                      <strong className="text-[#0F2942]">
                        Allow {activeLink.studentName || 'student'} to reschedule or pause own sessions
                      </strong>
                      <span className="block text-[11px] text-[#526A84]">
                        Students can only move sessions within your approved daily limit &amp; shift window.
                      </span>
                    </span>
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-[#476481] mb-1">
                        Daily Study Limit (min)
                      </label>
                      <input
                        type="number"
                        min={15}
                        max={120}
                        value={studentMaxDailyMin}
                        onChange={(e) => setStudentMaxDailyMin(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-[#476481] mb-1">
                        Max Reschedule Shift (hrs)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={48}
                        value={studentWindowHours}
                        onChange={(e) => setStudentWindowHours(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveGuardianPermissions}
                    className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Save Child Schedule Limits</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
