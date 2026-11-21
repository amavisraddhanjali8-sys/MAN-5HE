import React, { useEffect, useState } from 'react';
import {
  Archive,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Layers,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import type {
  LearningActivityType,
  QuestionHistoryFilterMode,
  SubjectCategory,
  TimetablePreset,
  TimetableRecurrenceType,
  TopicNode,
} from '../lib/types';

interface TimetablePresetManagerProps {
  role: 'teacher' | 'admin';
  user: AuthUser;
  subjects: SubjectCategory[];
  topics: TopicNode[];
}

interface DraftActivityRow {
  title: string;
  activityType: LearningActivityType;
  dayOffset: number;
  timeOfDay: string;
  durationMinutes: number;
  recurrenceRule: TimetableRecurrenceType;
  subjectIds: string[];
  topicIds: string[];
  questionCount: number;
  historyMode: QuestionHistoryFilterMode;
}

const ACTIVITY_TYPES: { id: LearningActivityType; label: string }[] = [
  { id: 'practice', label: 'Practice Session' },
  { id: 'timed_practice', label: 'Timed Practice' },
  { id: 'mock_exam', label: 'Mock Exam' },
  { id: 'topic_revision', label: 'Topic Revision' },
  { id: 'followup_activity', label: 'Follow-Up Activity' },
];

export function TimetablePresetManager({
  role,
  subjects,
  topics,
}: TimetablePresetManagerProps) {
  const [presets, setPresets] = useState<TimetablePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const defaultSubjectId = subjects[0]?.id || 'subj-math';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetGrade, setTargetGrade] = useState('Grade 5');
  const [recommendedFrequency, setRecommendedFrequency] = useState('3 sessions per week');
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(
    defaultSubjectId ? [defaultSubjectId] : []
  );
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [publishImmediately, setPublishImmediately] = useState(role === 'admin');
  const [activities, setActivities] = useState<DraftActivityRow[]>([
    {
      title: 'Calm Concept Practice',
      activityType: 'practice',
      dayOffset: 0,
      timeOfDay: '16:30',
      durationMinutes: 25,
      recurrenceRule: 'weekly',
      subjectIds: defaultSubjectId ? [defaultSubjectId] : [],
      topicIds: [],
      questionCount: 6,
      historyMode: 'all',
    },
  ]);

  const loadPresets = async () => {
    setLoading(true);
    try {
      const res = await api.getTimetablePresets();
      setPresets(res.presets);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPresets();
  }, []);

  useEffect(() => {
    if (subjects.length > 0 && selectedSubjectIds.length === 0) {
      const firstId = subjects[0].id;
      setSelectedSubjectIds([firstId]);
      setActivities((prev) =>
        prev.map((a) => (a.subjectIds.length === 0 ? { ...a, subjectIds: [firstId] } : a))
      );
    }
  }, [subjects]);

  const togglePresetSubject = (subjId: string) => {
    setSelectedSubjectIds((prev) => {
      const next = prev.includes(subjId) ? prev.filter((id) => id !== subjId) : [...prev, subjId];
      return next.length > 0 ? next : prev;
    });
  };

  const addActivityRow = () => {
    setActivities((prev) => [
      ...prev,
      {
        title: `Study Block ${prev.length + 1}`,
        activityType: 'topic_revision',
        dayOffset: prev.length * 2,
        timeOfDay: '17:00',
        durationMinutes: 25,
        recurrenceRule: 'weekly',
        subjectIds: [...selectedSubjectIds],
        topicIds: [],
        questionCount: 6,
        historyMode: 'previously_incorrect',
      },
    ]);
  };

  const updateActivityRow = (idx: number, patch: Partial<DraftActivityRow>) => {
    setActivities((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeActivityRow = (idx: number) => {
    if (activities.length <= 1) return;
    setActivities((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCreatePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!title.trim()) {
      setErrorMsg('Please enter a preset title.');
      return;
    }
    if (selectedSubjectIds.length === 0) {
      setErrorMsg('Select at least one authorized subject.');
      return;
    }

    setBusy(true);
    try {
      const res = await api.createTimetablePreset({
        title: title.trim(),
        description: description.trim() || 'Balanced weekly learning timetable preset.',
        targetGrade,
        subjectIds: selectedSubjectIds,
        topicIds: selectedTopicIds,
        recommendedFrequency: recommendedFrequency.trim() || 'Weekly',
        status:
          role === 'admin' && publishImmediately
            ? 'PUBLISHED'
            : role === 'teacher'
            ? 'PENDING_REVIEW'
            : 'DRAFT',
        activities: activities.map((act) => ({
          title: act.title.trim() || 'Practice Session',
          activityType: act.activityType,
          dayOffset: Number(act.dayOffset) || 0,
          timeOfDay: act.timeOfDay || '16:30',
          durationMinutes: Number(act.durationMinutes) || 25,
          recurrenceRule: act.recurrenceRule,
          subjectIds: act.subjectIds.length > 0 ? act.subjectIds : selectedSubjectIds,
          topicIds: act.topicIds,
          filterCriteria: {
            subjectIds: act.subjectIds.length > 0 ? act.subjectIds : selectedSubjectIds,
            topicIds: act.topicIds,
            questionCount: Number(act.questionCount) || 6,
            historyMode: act.historyMode,
            balanceByTopic: true,
          },
        })),
      });
      setStatusMsg(
        `Preset "${res.preset.title}" saved (${res.preset.status}). Parents receive an isolated copy when applying it.`
      );
      setTitle('');
      setDescription('');
      await loadPresets();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleTransition = async (
    presetId: string,
    action: 'submit_review' | 'publish' | 'archive'
  ) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.transitionTimetablePreset(presetId, action);
      setStatusMsg(`Preset "${res.preset.title}" is now ${res.preset.status}.`);
      await loadPresets();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const visibleTopics = topics.filter((t) => selectedSubjectIds.includes(t.subjectId));

  return (
    <div className="space-y-6" data-testid="timetable-preset-manager">
      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs font-medium text-[#9A2F09]">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="p-3.5 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] text-xs font-medium text-[#1E6323]">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Create Preset Form */}
        <form
          onSubmit={handleCreatePreset}
          className="xl:col-span-6 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
            <div className="flex items-center gap-2">
              <CalendarPlus className="w-4 h-4 text-[#158EE3]" />
              <h2 className="text-base font-display font-bold text-[#0F2942]">
                {role === 'admin'
                  ? 'Create Cross-Subject Timetable Preset'
                  : 'Author Subject-Scoped Timetable Preset'}
              </h2>
            </div>
            <span className="text-[11px] font-semibold text-[#526A84]">
              {role === 'admin' ? 'All Subjects' : `${subjects.length} Authorized Subject(s)`}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label htmlFor="preset-title" className="block font-semibold text-[#476481] mb-1">
                Preset Title
              </label>
              <input
                id="preset-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Grade 5 Arithmetic & Word Problem Confidence Plan"
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-sm"
              />
            </div>

            <div>
              <label htmlFor="preset-desc" className="block font-semibold text-[#476481] mb-1">
                Parent Guidance &amp; Recommended Routine Summary
              </label>
              <textarea
                id="preset-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Calm, age-appropriate study sequence parents can adjust to family timezones."
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="preset-grade" className="block font-semibold text-[#476481] mb-1">
                  Target Grade
                </label>
                <input
                  id="preset-grade"
                  type="text"
                  value={targetGrade}
                  onChange={(e) => setTargetGrade(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-xs"
                />
              </div>
              <div>
                <label htmlFor="preset-freq" className="block font-semibold text-[#476481] mb-1">
                  Recommended Pace
                </label>
                <input
                  id="preset-freq"
                  type="text"
                  value={recommendedFrequency}
                  onChange={(e) => setRecommendedFrequency(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-xs"
                />
              </div>
            </div>

            <div>
              <div className="font-semibold text-[#476481] mb-1.5">
                Authorized Subjects Covered
              </div>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => {
                  const checked = selectedSubjectIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`px-3 py-1.5 rounded-xl border cursor-pointer flex items-center gap-1.5 ${
                        checked
                          ? 'bg-[#EBF5FF] border-[#99CAFA] text-[#0E4F80] font-semibold'
                          : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#526A84]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePresetSubject(s.id)}
                        className="accent-[#158EE3]"
                      />
                      <span>{s.nameEn}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {visibleTopics.length > 0 && (
              <div>
                <div className="font-semibold text-[#476481] mb-1">
                  Focus Topics (Optional)
                </div>
                <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1.5 p-2 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                  {visibleTopics.map((t) => {
                    const checked = selectedTopicIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-[#DCEBFA] cursor-pointer text-[11px]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedTopicIds((prev) =>
                              prev.includes(t.id)
                                ? prev.filter((id) => id !== t.id)
                                : [...prev, t.id]
                            )
                          }
                          className="accent-[#158EE3]"
                        />
                        <span>{t.nameEn}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Activities List */}
            <div className="space-y-2.5 pt-2 border-t border-[#E5F0FA]">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#0F2942]">
                  Scheduled Learning Activities ({activities.length})
                </span>
                <button
                  type="button"
                  onClick={addActivityRow}
                  className="px-2.5 py-1 text-[11px] font-bold text-[#158EE3] bg-[#EBF5FF] border border-[#99CAFA] rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3 h-3" /> Add Activity Slot
                </button>
              </div>

              {activities.map((act, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      value={act.title}
                      onChange={(e) => updateActivityRow(idx, { title: e.target.value })}
                      placeholder="Activity title"
                      className="flex-1 px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-lg text-xs font-semibold text-[#0F2942]"
                    />
                    {activities.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeActivityRow(idx)}
                        aria-label="Remove activity"
                        className="p-1.5 text-[#C62828] hover:bg-[#FFF2ED] rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <select
                      aria-label="Activity type"
                      value={act.activityType}
                      onChange={(e) =>
                        updateActivityRow(idx, {
                          activityType: e.target.value as LearningActivityType,
                        })
                      }
                      className="px-2 py-1.5 bg-white border border-[#CBE2FA] rounded-lg text-[11px]"
                    >
                      {ACTIVITY_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-1 bg-white border border-[#CBE2FA] rounded-lg px-2 py-1">
                      <span className="text-[10px] text-[#526A84]">Day+</span>
                      <input
                        type="number"
                        min={0}
                        max={28}
                        value={act.dayOffset}
                        onChange={(e) =>
                          updateActivityRow(idx, { dayOffset: Number(e.target.value) })
                        }
                        className="w-full text-[11px] font-bold tabular-nums outline-none"
                      />
                    </div>

                    <input
                      type="time"
                      aria-label="Time of day"
                      value={act.timeOfDay}
                      onChange={(e) => updateActivityRow(idx, { timeOfDay: e.target.value })}
                      className="px-2 py-1.5 bg-white border border-[#CBE2FA] rounded-lg text-[11px] tabular-nums"
                    />

                    <div className="flex items-center gap-1 bg-white border border-[#CBE2FA] rounded-lg px-2 py-1">
                      <input
                        type="number"
                        min={10}
                        max={90}
                        value={act.durationMinutes}
                        onChange={(e) =>
                          updateActivityRow(idx, { durationMinutes: Number(e.target.value) })
                        }
                        className="w-full text-[11px] font-bold tabular-nums outline-none"
                      />
                      <span className="text-[10px] text-[#526A84]">min</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <select
                      aria-label="Recurrence"
                      value={act.recurrenceRule}
                      onChange={(e) =>
                        updateActivityRow(idx, {
                          recurrenceRule: e.target.value as TimetableRecurrenceType,
                        })
                      }
                      className="px-2 py-1.5 bg-white border border-[#CBE2FA] rounded-lg text-[11px]"
                    >
                      <option value="one_time">One-time</option>
                      <option value="weekly">Weekly</option>
                      <option value="weekdays">Weekdays</option>
                      <option value="daily">Daily</option>
                    </select>

                    <select
                      aria-label="Question history mode"
                      value={act.historyMode}
                      onChange={(e) =>
                        updateActivityRow(idx, {
                          historyMode: e.target.value as QuestionHistoryFilterMode,
                        })
                      }
                      className="px-2 py-1.5 bg-white border border-[#CBE2FA] rounded-lg text-[11px]"
                    >
                      <option value="all">All Eligible Qs</option>
                      <option value="unattempted">Unattempted Only</option>
                      <option value="previously_incorrect">Previously Missed</option>
                      <option value="repeated_error">Repeated Errors</option>
                      <option value="weak_areas">Weak Areas</option>
                      <option value="revision_due">Revision Due</option>
                    </select>

                    <div className="flex items-center gap-1 bg-white border border-[#CBE2FA] rounded-lg px-2 py-1">
                      <span className="text-[10px] text-[#526A84]">Qs:</span>
                      <input
                        type="number"
                        min={2}
                        max={40}
                        value={act.questionCount}
                        onChange={(e) =>
                          updateActivityRow(idx, { questionCount: Number(e.target.value) })
                        }
                        className="w-full text-[11px] font-bold tabular-nums outline-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {role === 'admin' && (
              <label className="flex items-center gap-2 pt-1 cursor-pointer text-xs text-[#0F2942]">
                <input
                  type="checkbox"
                  checked={publishImmediately}
                  onChange={(e) => setPublishImmediately(e.target.checked)}
                  className="accent-[#158EE3]"
                />
                <span>Publish immediately to Guardian Preset Library</span>
              </label>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center justify-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {busy
                ? 'Saving Preset...'
                : role === 'teacher'
                ? 'Submit Subject Preset for Admin Approval'
                : publishImmediately
                ? 'Create & Publish Timetable Preset'
                : 'Save Timetable Preset Draft'}
            </span>
          </button>
        </form>

        {/* Presets Library List */}
        <div className="xl:col-span-6 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#F96A1B]" />
              <h2 className="text-base font-display font-bold text-[#0F2942]">
                Timetable Presets ({presets.length})
              </h2>
            </div>
            <span className="text-[11px] text-[#526A84]">
              Versioned templates · Safe guardian copying
            </span>
          </div>

          {loading ? (
            <div className="py-8 text-center text-xs text-[#526A84]">
              Loading timetable presets...
            </div>
          ) : presets.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#526A84]">
              No timetable presets created yet.
            </div>
          ) : (
            <div className="space-y-3 max-h-[680px] overflow-y-auto pr-1">
              {presets.map((p) => (
                <div
                  key={p.id}
                  className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2.5 text-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-[#0F2942]">{p.title}</div>
                      <div className="text-[11px] text-[#526A84]">
                        By {p.creatorName} ({p.creatorRole}) · v{p.currentVersion} · {p.targetGrade} ·{' '}
                        {p.recommendedFrequency}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-bold shrink-0 ${
                        p.status === 'PUBLISHED'
                          ? 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]'
                          : p.status === 'PENDING_REVIEW'
                          ? 'bg-[#FFF8EB] border-[#F3D19C] text-[#9A5B00]'
                          : 'bg-[#F3F9FF] border-[#CBE2FA] text-[#476481]'
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>

                  <p className="text-[#476481]">{p.description}</p>

                  <div className="space-y-1.5 pt-1">
                    {p.activities.map((act) => (
                      <div
                        key={act.id}
                        className="px-2.5 py-1.5 rounded-xl bg-white border border-[#E5F0FA] flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="font-semibold text-[#0F2942] truncate">
                          Day +{act.dayOffset} · {act.title} ({act.activityType.replace(/_/g, ' ')})
                        </span>
                        <span className="text-[#526A84] flex items-center gap-1 shrink-0 tabular-nums">
                          <Clock className="w-3 h-3 text-[#158EE3]" />
                          {act.timeOfDay} · {act.durationMinutes}m · {act.recurrenceRule}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    {role === 'teacher' && p.status === 'DRAFT' && (
                      <button
                        type="button"
                        onClick={() => handleTransition(p.id, 'submit_review')}
                        className="px-3 py-1.5 text-[11px] font-bold text-white bg-[#158EE3] rounded-xl"
                      >
                        Submit for Approval
                      </button>
                    )}
                    {role === 'admin' && p.status !== 'PUBLISHED' && p.status !== 'ARCHIVED' && (
                      <button
                        type="button"
                        onClick={() => handleTransition(p.id, 'publish')}
                        className="px-3 py-1.5 text-[11px] font-bold text-white bg-[#2E7D32] hover:bg-[#236127] rounded-xl flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve &amp; Publish</span>
                      </button>
                    )}
                    {role === 'admin' && p.status !== 'ARCHIVED' && (
                      <button
                        type="button"
                        onClick={() => handleTransition(p.id, 'archive')}
                        className="px-3 py-1.5 text-[11px] font-semibold text-[#526A84] bg-white border border-[#CBE2FA] rounded-xl flex items-center gap-1"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>Archive</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
