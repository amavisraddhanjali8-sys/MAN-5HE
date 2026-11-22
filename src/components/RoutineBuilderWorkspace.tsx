import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Layers,
  Lock,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import { EDUCATIONAL_SKILL_DEFINITIONS, EDUCATIONAL_SKILL_DISCLAIMER } from '../lib/routineEngine';
import type {
  AcademicRoutineConfigInput,
  AcademicRoutineDetail,
  AcademicRoutineRecord,
  EducationalSkillCategory,
  RoutineDifficultyDistribution,
  RoutineExposurePreference,
  RoutineMixingMethod,
  RoutinePerformanceSummary,
  RoutineScheduleMode,
  RoutineSkillWeight,
  RoutineSubjectWeight,
  RoutineValidationReport,
  SubjectCategory,
  TimetableRecurrenceType,
  TopicNode,
} from '../lib/types';

interface RoutineBuilderWorkspaceProps {
  user: AuthUser;
  studentId: string;
  studentName: string;
  subjects: SubjectCategory[];
  topics: TopicNode[];
  onRoutineActivated?: () => void;
}

const WEEKDAY_LABELS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
];

const TIMEZONES = [
  'Asia/Colombo',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'UTC',
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildDefaultSubjectWeights(subjects: SubjectCategory[]): RoutineSubjectWeight[] {
  const firstTwo = subjects.slice(0, 2);
  return subjects.map((s, idx) => ({
    subjectId: s.id,
    enabled: idx < 2,
    weightPercent: firstTwo.length === 2 ? (idx === 0 ? 60 : idx === 1 ? 40 : 0) : idx === 0 ? 100 : 0,
    topicIds: [],
    subtopicIds: [],
  }));
}

function buildDefaultSkillWeights(): RoutineSkillWeight[] {
  const defaults: Record<EducationalSkillCategory, number> = {
    recall: 10,
    numerical_ability: 25,
    logical_reasoning: 15,
    reading_comprehension: 15,
    problem_solving: 15,
    spatial_reasoning: 10,
    attention_to_detail: 5,
    time_management: 0,
    critical_thinking: 5,
  };
  return EDUCATIONAL_SKILL_DEFINITIONS.map((sk) => ({
    skillKey: sk.key,
    enabled: defaults[sk.key] > 0,
    weightPercent: defaults[sk.key],
    isEducationalCategory: true as const,
  }));
}

export function RoutineBuilderWorkspace({
  studentId,
  studentName,
  subjects,
  topics,
  onRoutineActivated,
}: RoutineBuilderWorkspaceProps) {
  const [routines, setRoutines] = useState<AcademicRoutineRecord[]>([]);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AcademicRoutineDetail | null>(null);
  const [validation, setValidation] = useState<RoutineValidationReport | null>(null);
  const [performance, setPerformance] = useState<RoutinePerformanceSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Builder form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [grade, setGrade] = useState('Grade 5');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(addDays(todayIso(), 14));
  const [startTimeOfDay, setStartTimeOfDay] = useState('16:30');
  const [timezone, setTimezone] = useState('Asia/Colombo');
  const [recurrenceType, setRecurrenceType] = useState<TimetableRecurrenceType>('weekdays');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [mixingMethod, setMixingMethod] = useState<RoutineMixingMethod>('mixed_session');
  const [subjectWeights, setSubjectWeights] = useState<RoutineSubjectWeight[]>([]);
  const [skillWeights, setSkillWeights] = useState<RoutineSkillWeight[]>(buildDefaultSkillWeights);
  const [diffDist, setDiffDist] = useState<RoutineDifficultyDistribution>({
    simple: 30,
    moderate: 50,
    difficult: 20,
    useEmpiricalCalibration: true,
  });
  const [questionCount, setQuestionCount] = useState(6);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(25);
  const [practiceRatioPercent, setPracticeRatioPercent] = useState(80);
  const [mockFrequencyDays, setMockFrequencyDays] = useState(5);
  const [exposurePreference, setExposurePreference] =
    useState<RoutineExposurePreference>('weak_areas');
  const [scheduleMode, setScheduleMode] = useState<RoutineScheduleMode>('fixed');
  const [breakIntervalMinutes, setBreakIntervalMinutes] = useState(25);
  const [breakDurationMinutes, setBreakDurationMinutes] = useState(10);
  const [maxWeightShiftPercent, setMaxWeightShiftPercent] = useState(10);
  const [maxDifficultyShiftPercent, setMaxDifficultyShiftPercent] = useState(10);
  const [changeNote, setChangeNote] = useState('');

  useEffect(() => {
    if (subjects.length > 0 && subjectWeights.length === 0) {
      setSubjectWeights(buildDefaultSubjectWeights(subjects));
    }
  }, [subjects]);

  const loadRoutines = async (keepSelection = true) => {
    try {
      const res = await api.listRoutines(studentId);
      setRoutines(res.routines);
      const nextId =
        keepSelection && selectedRoutineId && res.routines.some((r) => r.id === selectedRoutineId)
          ? selectedRoutineId
          : res.routines[0]?.id || null;
      setSelectedRoutineId(nextId);
      if (nextId) {
        const det = await api.getRoutineDetail(nextId);
        applyDetailToView(det.detail);
      } else {
        setSelectedDetail(null);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const applyDetailToView = (det: AcademicRoutineDetail) => {
    setSelectedDetail(det);
    const v = det.currentVersion;
    setTitle(v.title);
    setDescription(v.description);
    setGrade(v.grade);
    setStartDate(v.startDate);
    setEndDate(v.endDate || addDays(v.startDate, 14));
    setStartTimeOfDay(v.startTimeOfDay);
    setTimezone(v.timezone);
    setRecurrenceType(v.recurrenceType);
    setWeekdays(v.weekdays.length ? v.weekdays : [1, 3, 5]);
    setMixingMethod(v.mixingMethod);
    setSubjectWeights(
      subjects.map((s) => {
        const found = v.subjectWeights.find((w) => w.subjectId === s.id);
        return (
          found || {
            subjectId: s.id,
            enabled: false,
            weightPercent: 0,
            topicIds: [],
            subtopicIds: [],
          }
        );
      })
    );
    setSkillWeights(
      EDUCATIONAL_SKILL_DEFINITIONS.map((sk) => {
        const found = v.skillWeights.find((w) => w.skillKey === sk.key);
        return (
          found || {
            skillKey: sk.key,
            enabled: false,
            weightPercent: 0,
            isEducationalCategory: true as const,
          }
        );
      })
    );
    setDiffDist(v.difficultyDistribution);
    setQuestionCount(v.questionCountPerSession);
    setSessionDurationMinutes(v.sessionDurationMinutes);
    setPracticeRatioPercent(v.practiceRatioPercent);
    setMockFrequencyDays(v.mockFrequencyDays);
    setExposurePreference(v.exposurePreference);
    setScheduleMode(v.scheduleMode);
    setBreakIntervalMinutes(v.breakIntervalMinutes);
    setBreakDurationMinutes(v.breakDurationMinutes);
    setMaxWeightShiftPercent(v.adaptiveBounds.maxSubjectWeightShiftPercent);
    setMaxDifficultyShiftPercent(v.adaptiveBounds.maxDifficultyShiftPercent);
    setPerformance(det.latestPerformanceSummary || null);
  };

  useEffect(() => {
    if (studentId) loadRoutines(false);
  }, [studentId]);

  const startNewRoutineDraft = () => {
    setSelectedRoutineId(null);
    setSelectedDetail(null);
    setValidation(null);
    setPerformance(null);
    setTitle('');
    setDescription('');
    setSubjectWeights(buildDefaultSubjectWeights(subjects));
    setSkillWeights(buildDefaultSkillWeights());
    setDiffDist({ simple: 30, moderate: 50, difficult: 20, useEmpiricalCalibration: true });
    setScheduleMode('fixed');
    setChangeNote('');
    setStatusMsg('Ready to configure a new academic routine.');
    setErrorMsg(null);
  };

  const buildPayload = (): AcademicRoutineConfigInput => ({
    studentId,
    title: title.trim() || `${studentName} Balanced Study Routine`,
    description: description.trim(),
    grade,
    startDate,
    startTimeOfDay,
    timezone,
    recurrenceType,
    weekdays,
    endDate: endDate || null,
    mixingMethod,
    subjectWeights,
    skillWeights,
    difficultyDistribution: diffDist,
    questionCountPerSession: questionCount,
    sessionDurationMinutes,
    practiceRatioPercent,
    mockFrequencyDays,
    exposurePreference,
    scheduleMode,
    breakIntervalMinutes,
    breakDurationMinutes,
    adaptiveBounds: {
      maxDailyShiftMinutes: 15,
      maxSubjectWeightShiftPercent: maxWeightShiftPercent,
      maxDifficultyShiftPercent: maxDifficultyShiftPercent,
      allowQuestionSubstitution: true,
      requireApprovalOutsideBounds: true,
      notifyParentOnAdjustment: true,
    },
    changeNote: changeNote.trim() || undefined,
  });

  const enabledSubjectSum = subjectWeights
    .filter((s) => s.enabled)
    .reduce((acc, s) => acc + Number(s.weightPercent || 0), 0);
  const enabledSkillSum = skillWeights
    .filter((s) => s.enabled)
    .reduce((acc, s) => acc + Number(s.weightPercent || 0), 0);
  const difficultySum =
    Number(diffDist.simple || 0) +
    Number(diffDist.moderate || 0) +
    Number(diffDist.difficult || 0);

  const normalizeWeightsTo100 = <T extends { enabled: boolean; weightPercent: number }>(items: T[]): T[] => {
    const active = items.filter((i) => i.enabled);
    if (active.length === 0) return items;
    const sum = active.reduce((a, i) => a + Number(i.weightPercent || 0), 0);
    if (sum <= 0) {
      const equal = Math.floor(100 / active.length);
      let rem = 100 - equal * active.length;
      return items.map((i) => {
        if (!i.enabled) return { ...i, weightPercent: 0 };
        const add = rem > 0 ? 1 : 0;
        if (rem > 0) rem--;
        return { ...i, weightPercent: equal + add };
      });
    }
    let allocated = 0;
    const scaled = items.map((i) => {
      if (!i.enabled) return { ...i, weightPercent: 0 };
      const val = Math.floor((Number(i.weightPercent || 0) / sum) * 100);
      allocated += val;
      return { ...i, weightPercent: val };
    });
    const firstIdx = scaled.findIndex((i) => i.enabled);
    if (firstIdx >= 0) {
      scaled[firstIdx] = { ...scaled[firstIdx], weightPercent: scaled[firstIdx].weightPercent + (100 - allocated) };
    }
    return scaled;
  };

  const handleValidatePreview = async () => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.previewRoutineValidation(buildPayload());
      setValidation(res.validation);
      setStatusMsg(
        res.validation.valid
          ? `Configuration valid (${res.validation.plannedSlots.length} planned slots, ${res.validation.questionPreview.selectedCount} preview Qs).`
          : `Check ${res.validation.errors.length} validation issue(s).`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRoutine = async () => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payload = buildPayload();
      const res = selectedRoutineId
        ? await api.updateRoutine(selectedRoutineId, payload)
        : await api.createRoutine(payload);
      setSelectedRoutineId(res.detail.routine.id);
      applyDetailToView(res.detail);
      setStatusMsg(
        `Saved "${res.detail.routine.title}" (v${res.detail.routine.currentVersionNumber} · ${res.detail.routine.workflowStatus}).`
      );
      await loadRoutines(true);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (!selectedRoutineId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.submitRoutineForReview(selectedRoutineId);
      applyDetailToView(res.detail);
      setStatusMsg('Routine submitted to assigned subject teachers & administrator for evaluation.');
      await loadRoutines(true);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleActivateRoutine = async (overrideAck = false) => {
    if (!selectedRoutineId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.activateRoutine(selectedRoutineId, {
        wellbeingDecision: overrideAck ? 'proceeded_with_acknowledgement' : undefined,
        skipConflicts: true,
      });
      applyDetailToView(res.detail);
      setStatusMsg(
        `Activated routine! Created ${res.sessionsCreated.length} scheduled study sessions & synced reminders.${
          res.shortages.length > 0 ? ` (${res.shortages.length} question pool shortage notice(s))` : ''
        }`
      );
      await loadRoutines(true);
      onRoutineActivated?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLifecycle = async (action: 'pause' | 'resume' | 'complete' | 'archive') => {
    if (!selectedRoutineId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.transitionRoutineLifecycle(selectedRoutineId, action);
      applyDetailToView(res.detail);
      setStatusMsg(`Routine status updated to ${res.detail.routine.workflowStatus}.`);
      await loadRoutines(true);
      onRoutineActivated?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleEvaluateAdaptive = async () => {
    if (!selectedRoutineId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.evaluateRoutineAdaptiveAdjustments(selectedRoutineId);
      setStatusMsg(res.explanation);
      const det = await api.getRoutineDetail(selectedRoutineId);
      applyDetailToView(det.detail);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshPerformance = async () => {
    if (!selectedRoutineId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.getRoutinePerformanceSummary(selectedRoutineId);
      setPerformance(res.performance);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="routine-builder-workspace">
      {/* Top Routine Selector & Status Strip */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-[#158EE3]">
              Weighted Academic Routine &amp; Skill Allocation Builder · {studentName}
            </div>
            <h2 className="text-lg font-display font-extrabold text-[#0F2942]">
              Multi-Subject Study Routines, Teacher Review &amp; Adherence Analytics
            </h2>
          </div>
          <button
            type="button"
            onClick={startNewRoutineDraft}
            className="px-3.5 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Weighted Routine</span>
          </button>
        </div>

        {routines.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {routines.map((r) => {
              const active = r.id === selectedRoutineId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={async () => {
                    setSelectedRoutineId(r.id);
                    const det = await api.getRoutineDetail(r.id);
                    applyDetailToView(det.detail);
                    setValidation(null);
                  }}
                  className={`px-3.5 py-2 rounded-2xl border text-left text-xs transition-colors ${
                    active
                      ? 'bg-[#EBF5FF] border-[#158EE3] text-[#0F2942]'
                      : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#476481] hover:border-[#99CAFA]'
                  }`}
                >
                  <div className="font-bold text-[#0F2942]">{r.title}</div>
                  <div className="text-[11px] tabular-nums">
                    v{r.currentVersionNumber} · {r.workflowStatus} · {r.scheduleMode.toUpperCase()}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {(errorMsg || statusMsg) && (
          <div
            className={`p-3 rounded-2xl text-xs font-medium border ${
              errorMsg
                ? 'bg-[#FFF2ED] border-[#FAC5B2] text-[#9A2F09]'
                : 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
            }`}
          >
            {errorMsg || statusMsg}
          </div>
        )}
      </div>

      {/* Main Configuration Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-[#476481] mb-1">Routine Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Balanced Grade 5 Math, Logic & Sinhala Weekdays"
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm text-[#0F2942]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-[#476481] mb-1">Parent Learning Goal / Notes</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Calm daily skill balance leading toward Term 2 mock readiness"
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-xs text-[#0F2942]"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">Start Time</label>
              <input
                type="time"
                value={startTimeOfDay}
                onChange={(e) => setStartTimeOfDay(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">Recurrence Pattern</label>
              <select
                value={recurrenceType}
                onChange={(e) => setRecurrenceType(e.target.value as TimetableRecurrenceType)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="weekdays">Weekdays (Mon–Fri)</option>
                <option value="daily">Daily</option>
                <option value="weekly">Custom Weekdays</option>
                <option value="once">One-Time Session</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#476481] mb-1">Subject Mixing Method</label>
              <select
                value={mixingMethod}
                onChange={(e) => setMixingMethod(e.target.value as RoutineMixingMethod)}
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              >
                <option value="mixed_session">Mixed-Subject Weighted Sessions</option>
                <option value="single_subject">Single-Subject Focus</option>
                <option value="alternating">Alternating Subjects by Day</option>
                <option value="separate_sessions">Weighted Subject Rotation</option>
                <option value="daily_custom">Daily Custom Split</option>
              </select>
            </div>
          </div>

          {(recurrenceType === 'weekly' || recurrenceType === 'daily') && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {WEEKDAY_LABELS.map((wd) => {
                const active = weekdays.includes(wd.id);
                return (
                  <button
                    key={wd.id}
                    type="button"
                    onClick={() =>
                      setWeekdays((prev) =>
                        prev.includes(wd.id) ? prev.filter((x) => x !== wd.id) : [...prev, wd.id]
                      )
                    }
                    className={`px-2.5 py-1 rounded-lg border font-semibold ${
                      active
                        ? 'bg-[#158EE3] border-[#158EE3] text-white'
                        : 'bg-[#F8FBFF] border-[#CBE2FA] text-[#526A84]'
                    }`}
                  >
                    {wd.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Subject Allocation Weights (Total = 100%) */}
          <div className="pt-3 border-t border-[#E5F0FA] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-[#0F2942] flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-[#158EE3]" />
                <span>Subject Allocation Weights</span>
              </div>
              <div className="flex items-center gap-2 text-xs tabular-nums">
                <span className={enabledSubjectSum === 100 ? 'font-bold text-[#1E6323]' : 'font-bold text-[#9A2F09]'}>
                  Total: {enabledSubjectSum}% / 100%
                </span>
                <button
                  type="button"
                  onClick={() => setSubjectWeights((prev) => normalizeWeightsTo100(prev))}
                  className="px-2.5 py-1 rounded-lg bg-[#F3F9FF] border border-[#CBE2FA] text-[#158EE3] font-semibold"
                >
                  Auto-Balance 100%
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              {subjectWeights.map((sw) => {
                const subj = subjects.find((s) => s.id === sw.subjectId);
                if (!subj) return null;
                const subjTopics = topics.filter((t) => t.subjectId === subj.id);
                return (
                  <div
                    key={sw.subjectId}
                    className="p-3 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="flex items-center gap-2 font-bold text-[#0F2942] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sw.enabled}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSubjectWeights((prev) =>
                              prev.map((item) =>
                                item.subjectId === sw.subjectId
                                  ? { ...item, enabled: checked, weightPercent: checked ? Math.max(10, item.weightPercent) : 0 }
                                  : item
                              )
                            );
                          }}
                          className="accent-[#158EE3]"
                        />
                        <span>{subj.nameEn}</span>
                      </label>

                      {sw.enabled && (
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={sw.weightPercent}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setSubjectWeights((prev) =>
                                prev.map((item) =>
                                  item.subjectId === sw.subjectId ? { ...item, weightPercent: val } : item
                                )
                              );
                            }}
                            className="w-28 accent-[#158EE3]"
                          />
                          <span className="w-10 text-right font-bold tabular-nums text-[#0F2942]">
                            {sw.weightPercent}%
                          </span>
                        </div>
                      )}
                    </div>

                    {sw.enabled && subjTopics.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {subjTopics.map((tp) => {
                          const picked = sw.topicIds.includes(tp.id);
                          return (
                            <button
                              key={tp.id}
                              type="button"
                              onClick={() =>
                                setSubjectWeights((prev) =>
                                  prev.map((item) =>
                                    item.subjectId === sw.subjectId
                                      ? {
                                          ...item,
                                          topicIds: picked
                                            ? item.topicIds.filter((id) => id !== tp.id)
                                            : [...item.topicIds, tp.id],
                                        }
                                      : item
                                  )
                                )
                              }
                              className={`px-2 py-0.5 rounded-md border text-[11px] ${
                                picked
                                  ? 'bg-[#E5F2FF] border-[#158EE3] text-[#0F2942] font-semibold'
                                  : 'bg-white border-[#DCEBFA] text-[#526A84]'
                              }`}
                            >
                              {tp.nameEn}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 9 Educational Skill Development Priorities (Total = 100%) */}
          <div className="pt-3 border-t border-[#E5F0FA] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-[#0F2942] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#F96A1B]" />
                <span>Educational Skill Priorities (Grade 5 Learning Domains)</span>
              </div>
              <div className="flex items-center gap-2 text-xs tabular-nums">
                <span className={enabledSkillSum === 100 ? 'font-bold text-[#1E6323]' : 'font-bold text-[#9A2F09]'}>
                  Total: {enabledSkillSum}% / 100%
                </span>
                <button
                  type="button"
                  onClick={() => setSkillWeights((prev) => normalizeWeightsTo100(prev))}
                  className="px-2.5 py-1 rounded-lg bg-[#F3F9FF] border border-[#CBE2FA] text-[#158EE3] font-semibold"
                >
                  Auto-Balance 100%
                </button>
              </div>
            </div>
            <p className="text-[11px] text-[#526A84]">{EDUCATIONAL_SKILL_DISCLAIMER}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {skillWeights.map((sk) => {
                const def = EDUCATIONAL_SKILL_DEFINITIONS.find((d) => d.key === sk.skillKey)!;
                return (
                  <div
                    key={sk.skillKey}
                    className="p-2.5 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-center justify-between gap-2"
                  >
                    <label className="flex items-center gap-2 cursor-pointer min-w-0">
                      <input
                        type="checkbox"
                        checked={sk.enabled}
                        onChange={(e) => {
                          const ch = e.target.checked;
                          setSkillWeights((prev) =>
                            prev.map((item) =>
                              item.skillKey === sk.skillKey
                                ? { ...item, enabled: ch, weightPercent: ch ? Math.max(5, item.weightPercent) : 0 }
                                : item
                            )
                          );
                        }}
                        className="accent-[#158EE3]"
                      />
                      <span className="truncate font-semibold text-[#0F2942]" title={def.description}>
                        {def.label}
                      </span>
                    </label>
                    {sk.enabled && (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={sk.weightPercent}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(100, Number(e.target.value)));
                          setSkillWeights((prev) =>
                            prev.map((item) =>
                              item.skillKey === sk.skillKey ? { ...item, weightPercent: val } : item
                            )
                          );
                        }}
                        className="w-14 px-2 py-1 bg-white border border-[#CBE2FA] rounded-lg text-right font-bold tabular-nums"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Difficulty, Pacing & Fixed vs Bounded Adaptive Control */}
          <div className="pt-3 border-t border-[#E5F0FA] space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#0F2942] flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-[#158EE3]" />
                <span>Difficulty Mix &amp; Session Rules</span>
              </span>
              <span className={difficultySum === 100 ? 'font-bold text-[#1E6323]' : 'font-bold text-[#9A2F09]'}>
                Difficulty Sum: {difficultySum}%
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Simple %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={diffDist.simple}
                  onChange={(e) => setDiffDist({ ...diffDist, simple: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Moderate %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={diffDist.moderate}
                  onChange={(e) => setDiffDist({ ...diffDist, moderate: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Difficult %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={diffDist.difficult}
                  onChange={(e) => setDiffDist({ ...diffDist, difficult: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={diffDist.useEmpiricalCalibration}
                onChange={(e) => setDiffDist({ ...diffDist, useEmpiricalCalibration: e.target.checked })}
                className="accent-[#158EE3]"
              />
              <span className="text-[#0F2942]">
                Use empirical student attempt calibration when reliable sample size (&ge;10 valid attempts) exists
              </span>
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Questions / Session</label>
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Duration (min)</label>
                <input
                  type="number"
                  min={10}
                  max={60}
                  value={sessionDurationMinutes}
                  onChange={(e) => setSessionDurationMinutes(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Practice Ratio %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={practiceRatioPercent}
                  onChange={(e) => setPracticeRatioPercent(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Exposure Mode</label>
                <select
                  value={exposurePreference}
                  onChange={(e) => setExposurePreference(e.target.value as RoutineExposurePreference)}
                  className="w-full px-2 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                >
                  <option value="weak_areas">Weak Areas</option>
                  <option value="unattempted">New Questions First</option>
                  <option value="previously_incorrect">Previously Incorrect</option>
                  <option value="repeated_error">Repeated Error Focus</option>
                  <option value="revision_due">Revision Due</option>
                  <option value="all">Balanced All</option>
                </select>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[#0F2942] flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-[#158EE3]" />
                  <span>Schedule Control Mode</span>
                </span>
                <div className="flex gap-1.5">
                  {(['fixed', 'adaptive'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setScheduleMode(m)}
                      className={`px-3 py-1 rounded-lg font-bold capitalize border ${
                        scheduleMode === m
                          ? 'bg-[#158EE3] border-[#158EE3] text-white'
                          : 'bg-white border-[#CBE2FA] text-[#526A84]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              {scheduleMode === 'fixed' ? (
                <p className="text-[11px] text-[#526A84]">
                  Fixed mode locks approved subject weights, difficulty mix, and question selection against automatic shifts.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="block text-[11px] text-[#476481]">Max Subject Shift Bound (%)</label>
                    <input
                      type="number"
                      min={5}
                      max={25}
                      value={maxWeightShiftPercent}
                      onChange={(e) => setMaxWeightShiftPercent(Number(e.target.value))}
                      className="w-full px-2.5 py-1 bg-white border border-[#CBE2FA] rounded-lg tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#476481]">Max Difficulty Shift Bound (%)</label>
                    <input
                      type="number"
                      min={5}
                      max={25}
                      value={maxDifficultyShiftPercent}
                      onChange={(e) => setMaxDifficultyShiftPercent(Number(e.target.value))}
                      className="w-full px-2.5 py-1 bg-white border border-[#CBE2FA] rounded-lg tabular-nums"
                    />
                  </div>
                </div>
              )}
            </div>

            {selectedDetail && (
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Version Change Note (for audit)</label>
                <input
                  type="text"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="Describe why weights, timing, or topics were adjusted"
                  className="w-full px-3 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                />
              </div>
            )}
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-[#E5F0FA]">
            <button
              type="button"
              disabled={busy}
              onClick={handleValidatePreview}
              className="px-4 py-2 text-xs font-bold text-[#158EE3] bg-[#F3F9FF] border border-[#CBE2FA] hover:bg-[#E5F2FF] rounded-xl"
            >
              Validate &amp; Preview Questions
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleSaveRoutine}
              className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
            >
              {selectedRoutineId ? 'Save Routine Changes' : 'Save Routine Draft'}
            </button>
            {selectedDetail &&
              (selectedDetail.routine.workflowStatus === 'DRAFT' ||
                selectedDetail.routine.workflowStatus === 'CHANGES_REQUESTED' ||
                selectedDetail.routine.requiresReReview) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSubmitForReview}
                  className="px-4 py-2 text-xs font-bold text-white bg-[#F96A1B] hover:bg-[#DE580E] rounded-xl flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Submit for Teacher/Admin Review</span>
                </button>
              )}
          </div>
        </div>

        {/* Right Column: Validation, Workflow State, Staff Feedback, Activation & Analytics */}
        <div className="xl:col-span-5 space-y-5">
          {validation && (
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-[#E5F0FA]">
                <span className="font-display font-bold text-sm text-[#0F2942] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#2E7D32]" />
                  <span>Validation &amp; Question Pool Preview</span>
                </span>
                <span className="font-bold text-[#158EE3] tabular-nums">
                  {validation.questionPreview.selectedCount} / {validation.questionPreview.requestedCount} Qs matched
                </span>
              </div>

              {validation.errors.map((e, i) => (
                <div key={i} className="p-2.5 rounded-xl bg-[#FFF2ED] border border-[#FAC5B2] text-[#9A2F09]">
                  {e}
                </div>
              ))}
              {validation.warnings.map((w, i) => (
                <div key={i} className="p-2.5 rounded-xl bg-[#FFF8EB] border border-[#F3D19C] text-[#7B4B00]">
                  {w}
                </div>
              ))}
              {validation.questionPreview.shortages.map((sh, i) => (
                <div key={i} className="p-2.5 rounded-xl bg-[#FFF8EB] border border-[#F3D19C] text-[#7B4B00]">
                  <strong>Shortage ({sh.label}):</strong> {sh.explanation}
                </div>
              ))}
              {validation.wellbeingCheck && (
                <div className="p-2.5 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] text-[#0F2942]">
                  <ShieldCheck className="w-3.5 h-3.5 inline mr-1 text-[#2E7D32]" />
                  <strong>Wellbeing Status:</strong> {validation.wellbeingCheck.severity.toUpperCase()} —{' '}
                  {validation.wellbeingCheck.severity !== 'nominal'
                    ? validation.wellbeingCheck.supportiveMessage
                    : 'Healthy study intervals & breaks respected.'}
                </div>
              )}
            </div>
          )}

          {selectedDetail && (
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E5F0FA]">
                <div>
                  <div className="text-[11px] font-bold text-[#158EE3]">
                    Workflow · v{selectedDetail.routine.currentVersionNumber}
                  </div>
                  <div className="text-sm font-display font-bold text-[#0F2942]">
                    Status: {selectedDetail.routine.workflowStatus}
                  </div>
                </div>
                {selectedDetail.routine.requiresReReview && (
                  <span className="px-2.5 py-1 rounded-lg bg-[#FFF8EB] border border-[#F3D19C] text-[#7B4B00] font-bold">
                    Re-Review Required After Material Edit
                  </span>
                )}
              </div>

              {/* Activation & Lifecycle Controls */}
              <div className="flex flex-wrap gap-2">
                {selectedDetail.routine.workflowStatus === 'APPROVED' &&
                  !selectedDetail.routine.requiresReReview && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleActivateRoutine(true)}
                      className="px-3.5 py-2 font-bold text-white bg-[#2E7D32] hover:bg-[#1E6323] rounded-xl flex items-center gap-1.5"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Activate into Child Timetable</span>
                    </button>
                  )}

                {selectedDetail.routine.workflowStatus === 'ACTIVE' && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleLifecycle('pause')}
                      className="px-3 py-1.5 font-bold text-[#7B4B00] bg-[#FFF8EB] border border-[#F3D19C] rounded-xl flex items-center gap-1"
                    >
                      <PauseCircle className="w-3.5 h-3.5" />
                      <span>Pause</span>
                    </button>
                    {selectedDetail.routine.scheduleMode === 'adaptive' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleEvaluateAdaptive}
                        className="px-3 py-1.5 font-bold text-[#158EE3] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl flex items-center gap-1"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Check Adaptive Boost</span>
                      </button>
                    )}
                  </>
                )}

                {selectedDetail.routine.workflowStatus === 'PAUSED' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleLifecycle('resume')}
                    className="px-3 py-1.5 font-bold text-white bg-[#158EE3] rounded-xl flex items-center gap-1"
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                    <span>Resume Routine</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRefreshPerformance}
                  className="px-3 py-1.5 font-bold text-[#0F2942] bg-[#F8FBFF] border border-[#DCEBFA] rounded-xl flex items-center gap-1"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Planned vs Actual Report</span>
                </button>
              </div>

              {/* Assigned Teachers & Evaluations */}
              <div className="space-y-2">
                <div className="font-bold text-[#0F2942]">Staff Review Status</div>
                {selectedDetail.reviewAssignments.length === 0 ? (
                  <div className="text-[#526A84]">Not submitted for staff review yet.</div>
                ) : (
                  <div className="space-y-1.5">
                    {selectedDetail.reviewAssignments.map((ra) => (
                      <div
                        key={ra.id}
                        className="p-2.5 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-bold text-[#0F2942]">{ra.reviewerName}</span>{' '}
                          <span className="text-[#526A84]">({ra.reviewerRole})</span>
                        </div>
                        <span className="font-bold text-[#158EE3]">{ra.status}</span>
                      </div>
                    ))}
                  </div>
                )}

                {selectedDetail.teacherEvaluations.map((ev) => (
                  <div key={ev.id} className="p-3 rounded-xl bg-[#EEF9EF] border border-[#B7E1BA] space-y-1">
                    <div className="font-bold text-[#1E6323]">
                      {ev.teacherName} ({ev.decision.replace('_', ' ')})
                    </div>
                    <div className="text-[#0F2942]">{ev.generalComment}</div>
                  </div>
                ))}

                {selectedDetail.adminEvaluations.map((ev) => (
                  <div key={ev.id} className="p-3 rounded-xl bg-[#EBF5FF] border border-[#99CAFA] space-y-1">
                    <div className="font-bold text-[#0E4F80]">
                      Admin ({ev.adminName}): {ev.decision.toUpperCase()}
                    </div>
                    <div className="text-[#0F2942]">
                      {ev.overallBalanceNote || ev.wellbeingReviewNote}
                    </div>
                  </div>
                ))}

                {selectedDetail.changeRequests.filter((cr) => cr.status === 'OPEN').length > 0 && (
                  <div className="space-y-1.5">
                    <div className="font-bold text-[#9A2F09] flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Requested Changes</span>
                    </div>
                    {selectedDetail.changeRequests
                      .filter((cr) => cr.status === 'OPEN')
                      .map((cr) => (
                        <div key={cr.id} className="p-2.5 rounded-xl bg-[#FFF2ED] border border-[#FAC5B2] text-[#9A2F09]">
                          <strong>{cr.requestedByName}:</strong> {cr.summary}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {performance && (
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-[#E5F0FA]">
                <span className="font-display font-bold text-sm text-[#0F2942]">
                  Planned vs Actual Learning Adherence
                </span>
                <span className="font-bold text-[#2E7D32] tabular-nums">
                  {performance.adherenceSummary.completionRatePercent}% Completed
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
                <div className="p-2 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                  <div className="text-[11px] text-[#526A84]">Planned</div>
                  <div className="font-bold text-[#0F2942]">{performance.adherenceSummary.plannedSessionsCount}</div>
                </div>
                <div className="p-2 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                  <div className="text-[11px] text-[#526A84]">Completed</div>
                  <div className="font-bold text-[#1E6323]">{performance.adherenceSummary.completedSessionsCount}</div>
                </div>
                <div className="p-2 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                  <div className="text-[11px] text-[#526A84]">Active Min</div>
                  <div className="font-bold text-[#158EE3]">
                    {performance.adherenceSummary.observedActiveMinutesTotal}m
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                {performance.subjectComparison.map((sc) => (
                  <div
                    key={sc.subjectId}
                    className="p-2 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-center justify-between tabular-nums"
                  >
                    <span className="font-semibold text-[#0F2942]">{sc.subjectName}</span>
                    <span className="text-[#476481]">
                      Plan {sc.plannedWeightPercent}% · Actual {sc.actualDeliveredPercent}% · Acc{' '}
                      {sc.accuracyPercent === null ? 'N/A' : `${sc.accuracyPercent}%`}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-[#526A84] flex items-start gap-1.5">
                <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#158EE3]" />
                <span>{performance.wellbeingComplianceNote}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
