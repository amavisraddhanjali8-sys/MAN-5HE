import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Compass,
  Plus,
  Send,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import type {
  GameRoadmapDetail,
  RoadmapMissionType,
  RoadmapProgressReport,
  SubjectCategory,
  TopicNode,
} from '../lib/types';

interface RoadmapBuilderConsoleProps {
  role: 'teacher' | 'admin';
  user: AuthUser;
  subjects: SubjectCategory[];
  topics: TopicNode[];
}

export function RoadmapBuilderConsole({
  role,
  user,
  subjects,
  topics,
}: RoadmapBuilderConsoleProps) {
  const [roadmaps, setRoadmaps] = useState<GameRoadmapDetail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Create Roadmap Form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newSubjects, setNewSubjects] = useState<string[]>(() =>
    subjects.length ? [subjects[0].id] : []
  );
  const [baseCount, setBaseCount] = useState(3);
  const [incrementPerLevel, setIncrementPerLevel] = useState(2);
  const [maxSessionMin, setMaxSessionMin] = useState(25);

  // Add Stage & Add Level Forms
  const [stageTitle, setStageTitle] = useState('');
  const [levelTitle, setLevelTitle] = useState('');
  const [levelStageId, setLevelStageId] = useState('');
  const [levelSeq, setLevelSeq] = useState(1);
  const [levelPrereqId, setLevelPrereqId] = useState('');
  const [levelHasCheckpoint, setLevelHasCheckpoint] = useState(true);

  const loadRoadmaps = async (keepId?: string | null) => {
    try {
      const res = await api.listRoadmaps();
      setRoadmaps(res.roadmaps);
      const nextId =
        keepId && res.roadmaps.some((r) => r.roadmap.id === keepId)
          ? keepId
          : res.roadmaps[0]?.roadmap.id || null;
      setSelectedId(nextId);
      const det = res.roadmaps.find((r) => r.roadmap.id === nextId);
      if (det?.stages[0]) setLevelStageId(det.stages[0].id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  useEffect(() => {
    loadRoadmaps();
  }, [user.id]);

  const selectedDetail = roadmaps.find((r) => r.roadmap.id === selectedId) || null;

  const handleCreateRoadmap = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.createRoadmap({
        name: newName,
        description: newDesc,
        subjectIds: newSubjects,
        growthFormula: {
          baseQuestionCount: baseCount,
          incrementPerLevel,
          maxQuestionCount: 20,
          maxQuestionsPerMission: 6,
          maxSessionDurationMinutes: maxSessionMin,
        },
        wellbeingMaxSessionMinutes: maxSessionMin,
      });
      setNewName('');
      setNewDesc('');
      setStatusMsg(`Created draft roadmap "${res.detail.roadmap.name}".`);
      await loadRoadmaps(res.detail.roadmap.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddStage = async () => {
    if (!selectedDetail || !stageTitle.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await api.createRoadmapStage(selectedDetail.roadmap.id, { title: stageTitle.trim() });
      setStageTitle('');
      await loadRoadmaps(selectedDetail.roadmap.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddLevel = async () => {
    if (!selectedDetail || !levelTitle.trim() || !levelStageId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await api.upsertRoadmapLevel(selectedDetail.roadmap.id, {
        stageId: levelStageId,
        sequenceOrder: levelSeq,
        title: levelTitle.trim(),
        subjectIds: selectedDetail.roadmap.subjectIds,
        prerequisiteLevelIds: levelPrereqId ? [levelPrereqId] : [],
        hasCheckpoint: levelHasCheckpoint,
        autoGenerateMissions: true,
      });
      setLevelTitle('');
      setLevelSeq((s) => s + 1);
      setStatusMsg('Added progressive level with auto-split missions.');
      await loadRoadmaps(selectedDetail.roadmap.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleTransition = async (toStatus: 'PENDING_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'DRAFT') => {
    if (!selectedDetail) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.transitionRoadmapStatus(selectedDetail.roadmap.id, { toStatus });
      setStatusMsg(`Roadmap status updated to ${res.detail.roadmap.status}.`);
      await loadRoadmaps(selectedDetail.roadmap.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="roadmap-builder-console">
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

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Create Roadmap + List */}
        <div className="xl:col-span-5 space-y-5">
          <form
            onSubmit={handleCreateRoadmap}
            className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-3 text-xs"
          >
            <div className="flex items-center gap-2 font-display font-bold text-sm text-[#0F2942] pb-2 border-b border-[#E5F0FA]">
              <Compass className="w-4 h-4 text-[#158EE3]" />
              <span>Create Progressive Learning Roadmap</span>
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Roadmap Title</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Grade 5 Fractions & Reasoning Quest"
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Calm progressive challenges aligned with Scholarship outcomes"
                className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
              />
            </div>
            <div>
              <div className="font-semibold text-[#476481] mb-1">Authorized Subjects</div>
              <div className="flex flex-wrap gap-1.5">
                {subjects.map((s) => {
                  const picked = newSubjects.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setNewSubjects((prev) =>
                          prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                        )
                      }
                      className={`px-2.5 py-1 rounded-lg border font-semibold ${
                        picked
                          ? 'bg-[#158EE3] border-[#158EE3] text-white'
                          : 'bg-[#F8FBFF] border-[#CBE2FA] text-[#526A84]'
                      }`}
                    >
                      {s.nameEn}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 tabular-nums">
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Base Qs</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={baseCount}
                  onChange={(e) => setBaseCount(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#476481] mb-1">+Qs / Level</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={incrementPerLevel}
                  onChange={(e) => setIncrementPerLevel(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#476481] mb-1">Max Min</label>
                <input
                  type="number"
                  min={10}
                  max={45}
                  value={maxSessionMin}
                  onChange={(e) => setMaxSessionMin(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busy || newSubjects.length === 0}
              className="w-full py-2.5 font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Draft Roadmap</span>
            </button>
          </form>

          <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-2.5">
            <div className="text-xs font-bold text-[#0F2942]">Roadmaps Directory ({roadmaps.length})</div>
            {roadmaps.map((rm) => {
              const active = rm.roadmap.id === selectedId;
              return (
                <button
                  key={rm.roadmap.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(rm.roadmap.id);
                    if (rm.stages[0]) setLevelStageId(rm.stages[0].id);
                  }}
                  className={`w-full text-left p-3 rounded-2xl border text-xs ${
                    active
                      ? 'bg-[#EBF5FF] border-[#158EE3]'
                      : 'bg-[#F8FBFF] border-[#DCEBFA] hover:border-[#99CAFA]'
                  }`}
                >
                  <div className="font-bold text-[#0F2942]">{rm.roadmap.name}</div>
                  <div className="text-[11px] text-[#526A84]">
                    {rm.roadmap.status} · {rm.levels.length} Levels · {rm.missions.length} Missions
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Roadmap Structure, Availability Warnings & Publishing */}
        {selectedDetail && (
          <div className="xl:col-span-7 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5F0FA]">
              <div>
                <div className="text-[11px] font-bold text-[#158EE3]">
                  {selectedDetail.roadmap.status} · Wellbeing Cap: {selectedDetail.roadmap.wellbeingMaxSessionMinutes}m
                </div>
                <h3 className="text-lg font-display font-extrabold text-[#0F2942]">
                  {selectedDetail.roadmap.name}
                </h3>
              </div>

              <div className="flex flex-wrap gap-2">
                {role === 'teacher' && selectedDetail.roadmap.status === 'DRAFT' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleTransition('PENDING_REVIEW')}
                    className="px-3.5 py-2 font-bold text-white bg-[#F96A1B] rounded-xl flex items-center gap-1"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Submit for Admin Approval</span>
                  </button>
                )}
                {role === 'admin' && selectedDetail.roadmap.status !== 'PUBLISHED' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleTransition('PUBLISHED')}
                    className="px-3.5 py-2 font-bold text-white bg-[#2E7D32] rounded-xl flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve &amp; Publish</span>
                  </button>
                )}
              </div>
            </div>

            {selectedDetail.availabilityIssues.length > 0 && (
              <div className="p-3 rounded-2xl bg-[#FFF8EB] border border-[#F3D19C] text-[#7B4B00] space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Question Bank Availability Audit ({selectedDetail.availabilityIssues.length})</span>
                </div>
                {selectedDetail.availabilityIssues.map((iss, idx) => (
                  <div key={idx} className="text-[11px]">
                    • {iss.message}
                  </div>
                ))}
              </div>
            )}

            {/* Add Stage & Progressive Level Quick Builders */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA]">
              <div className="space-y-2">
                <div className="font-bold text-[#0F2942]">Add Stage</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={stageTitle}
                    onChange={(e) => setStageTitle(e.target.value)}
                    placeholder="Stage title..."
                    className="flex-1 px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={handleAddStage}
                    className="px-3 py-1.5 font-bold text-white bg-[#158EE3] rounded-lg"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-bold text-[#0F2942]">Add Progressive Level</div>
                <input
                  type="text"
                  value={levelTitle}
                  onChange={(e) => setLevelTitle(e.target.value)}
                  placeholder="Level title..."
                  className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-lg"
                />
                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    value={levelStageId}
                    onChange={(e) => setLevelStageId(e.target.value)}
                    className="flex-1 px-2 py-1.5 bg-white border border-[#CBE2FA] rounded-lg"
                  >
                    {selectedDetail.stages.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.title}
                      </option>
                    ))}
                  </select>
                  <select
                    value={levelPrereqId}
                    onChange={(e) => setLevelPrereqId(e.target.value)}
                    className="flex-1 px-2 py-1.5 bg-white border border-[#CBE2FA] rounded-lg"
                  >
                    <option value="">No Prerequisite</option>
                    {selectedDetail.levels.map((lv) => (
                      <option key={lv.id} value={lv.id}>
                        Requires: {lv.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddLevel}
                    className="px-3 py-1.5 font-bold text-white bg-[#2E7D32] rounded-lg"
                  >
                    + Level
                  </button>
                </div>
              </div>
            </div>

            {/* Stage -> Level -> Mission Hierarchy */}
            <div className="space-y-3">
              {selectedDetail.levels.map((lvl) => {
                const lvlMissions = selectedDetail.missions.filter((m) => m.levelId === lvl.id);
                return (
                  <div key={lvl.id} className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-[#0F2942]">
                        #{lvl.sequenceOrder} {lvl.title}
                      </div>
                      <span className="text-[11px] font-bold text-[#158EE3] tabular-nums">
                        {lvl.targetQuestionCount} Qs · Mastery {lvl.minMasteryAccuracyPercent}%
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {lvlMissions.map((m) => (
                        <span
                          key={m.id}
                          className="px-2.5 py-1 rounded-lg bg-white border border-[#DCEBFA] text-[11px] text-[#0F2942]"
                        >
                          {m.title} ({m.questionCount} Qs · {m.missionType})
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Reusable Parent & Guardian Roadmap Progress + Mission Timetable Scheduler
 */
export function RoadmapProgressReportPanel({
  studentId,
  studentName,
  onScheduled,
}: {
  studentId: string;
  studentName: string;
  onScheduled?: () => void;
}) {
  const [reports, setReports] = useState<RoadmapProgressReport[]>([]);
  const [roadmaps, setRoadmaps] = useState<GameRoadmapDetail[]>([]);
  const [missionId, setMissionId] = useState('');
  const [schedDate, setSchedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [schedTime, setSchedTime] = useState('17:00');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) return;
    Promise.all([
      api.getRoadmapProgressReports(studentId),
      api.listRoadmaps(),
    ])
      .then(([rep, rms]) => {
        setReports(rep.reports);
        setRoadmaps(rms.roadmaps);
        const firstMission = rms.roadmaps[0]?.missions[0]?.id || '';
        setMissionId(firstMission);
      })
      .catch(() => {});
  }, [studentId]);

  const handleScheduleMission = async () => {
    if (!missionId) return;
    setMsg(null);
    try {
      const res = await api.scheduleRoadmapMission({
        studentId,
        missionId,
        startDate: schedDate,
        timeOfDay: schedTime,
      });
      setMsg(
        `Quest mission scheduled into ${studentName}'s timetable.${
          res.warningMessages.length ? ` (${res.warningMessages[0]})` : ''
        }`
      );
      onScheduled?.();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#158EE3]" />
          <h3 className="text-base font-display font-bold text-[#0F2942]">
            Gamified Roadmap Progress &amp; Mission Scheduling · {studentName}
          </h3>
        </div>
      </div>

      {reports.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {reports.map((rep) => (
            <div key={rep.roadmapId} className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm text-[#0F2942]">{rep.roadmapName}</span>
                <span className="font-bold text-[#158EE3] tabular-nums">
                  {rep.completedLevelsCount}/{rep.totalLevelsCount} Levels
                </span>
              </div>
              <div className="text-[#476481] tabular-nums">
                Accuracy: {rep.overallAccuracyPercent === null ? 'Not started' : `${rep.overallAccuracyPercent}%`} ·{' '}
                Active Time: {rep.observedActiveMinutes} min · Attempts: {rep.totalMissionAttempts}
              </div>
              {rep.repeatedErrorTopics.length > 0 && (
                <div className="text-[#9A2F09]">
                  Focus topics: {rep.repeatedErrorTopics.map((t) => `${t.topicName} (${t.errorCount})`).join(', ')}
                </div>
              )}
              {rep.suggestedNextActivities.length > 0 && (
                <div className="text-[11px] text-[#1E6323]">
                  Next: {rep.suggestedNextActivities[0]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Schedule a Mission into Timetable */}
      {roadmaps.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA] space-y-2">
          <div className="font-bold text-[#0F2942] flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#158EE3]" />
            <span>Schedule a Quest Mission into Child&rsquo;s Smart Timetable</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <select
              value={missionId}
              onChange={(e) => setMissionId(e.target.value)}
              className="sm:col-span-2 px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
            >
              {roadmaps.flatMap((rm) =>
                rm.missions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {rm.roadmap.name}: {m.title} ({m.questionCount} Qs)
                  </option>
                ))
              )}
            </select>
            <input
              type="date"
              value={schedDate}
              onChange={(e) => setSchedDate(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
            />
            <div className="flex gap-1.5">
              <input
                type="time"
                value={schedTime}
                onChange={(e) => setSchedTime(e.target.value)}
                className="flex-1 px-2 py-1.5 bg-white border border-[#CBE2FA] rounded-xl"
              />
              <button
                type="button"
                onClick={handleScheduleMission}
                className="px-3 py-1.5 font-bold text-white bg-[#158EE3] rounded-xl shrink-0"
              >
                Schedule
              </button>
            </div>
          </div>
          {msg && <div className="text-[11px] font-semibold text-[#1E6323]">{msg}</div>}
        </div>
      )}
    </div>
  );
}
