import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Lock,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import { EDUCATIONAL_SKILL_DISCLAIMER, SKILL_LABEL_MAP } from '../lib/routineEngine';
import type {
  AcademicRoutineDetail,
  AcademicRoutineRecord,
  RoutineChangeRequest,
  SubjectCategory,
} from '../lib/types';

interface RoutineReviewConsoleProps {
  role: 'teacher' | 'admin';
  user: AuthUser;
  subjects: SubjectCategory[];
}

export function RoutineReviewConsole({ role, user, subjects }: RoutineReviewConsoleProps) {
  const [routines, setRoutines] = useState<AcademicRoutineRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AcademicRoutineDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Teacher evaluation state
  const [subjectDecisions, setSubjectDecisions] = useState<
    Record<string, 'approved' | 'changes_requested' | 'comment_only'>
  >({});
  const [teacherDecision, setTeacherDecision] = useState<
    'approved_components' | 'recommend_changes' | 'comment_only'
  >('approved_components');
  const [topicNote, setTopicNote] = useState('');
  const [difficultyNote, setDifficultyNote] = useState('');
  const [skillNote, setSkillNote] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [generalComment, setGeneralComment] = useState('');
  const [changeReqSummary, setChangeReqSummary] = useState('');
  const [changeReqCategory, setChangeReqCategory] =
    useState<RoutineChangeRequest['category']>('difficulty_balance');

  // Admin evaluation state
  const [adminDecision, setAdminDecision] = useState<
    'approved' | 'changes_requested' | 'rejected' | 'comment_only'
  >('approved');
  const [overallBalanceNote, setOverallBalanceNote] = useState('');
  const [wellbeingReviewNote, setWellbeingReviewNote] = useState('');
  const [adminChangeSummary, setAdminChangeSummary] = useState('');

  const assignedSubjectIds = user.assignedSubjectIds || [];
  const subjectNameMap = new Map(subjects.map((s) => [s.id, s.nameEn]));

  const loadList = async (keepId?: string | null) => {
    try {
      const res = await api.listRoutines();
      setRoutines(res.routines);
      const nextId =
        keepId && res.routines.some((r) => r.id === keepId)
          ? keepId
          : res.routines[0]?.id || null;
      setSelectedId(nextId);
      if (nextId) {
        const det = await api.getRoutineDetail(nextId);
        hydrateDetail(det.detail);
      } else {
        setDetail(null);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const hydrateDetail = (det: AcademicRoutineDetail) => {
    setDetail(det);
    const enabled = det.currentVersion.subjectWeights.filter((s) => s.enabled);
    const initialMap: Record<string, 'approved' | 'changes_requested' | 'comment_only'> = {};
    for (const sw of enabled) {
      if (role === 'teacher' && assignedSubjectIds.includes(sw.subjectId)) {
        initialMap[sw.subjectId] = 'approved';
      }
    }
    setSubjectDecisions(initialMap);
  };

  useEffect(() => {
    loadList();
  }, [user.id]);

  const handleTeacherSubmit = async () => {
    if (!detail) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const firstScopedSubject = Object.keys(subjectDecisions)[0];
      const res = await api.submitTeacherRoutineEvaluation(detail.routine.id, {
        subjectComponentDecisions: subjectDecisions,
        decision: teacherDecision,
        topicSuitabilityNote: topicNote,
        difficultySuitabilityNote: difficultyNote,
        skillBalanceNote: skillNote,
        evidenceComparisonNote: evidenceNote,
        generalComment: generalComment || 'Reviewed assigned subject components.',
        changeRequests:
          teacherDecision === 'recommend_changes' && changeReqSummary.trim()
            ? [
                {
                  subjectId: firstScopedSubject,
                  category: changeReqCategory,
                  summary: changeReqSummary.trim(),
                },
              ]
            : [],
      });
      hydrateDetail(res.detail);
      setStatusMsg('Subject-scoped teacher evaluation saved and parent notified.');
      setChangeReqSummary('');
      await loadList(detail.routine.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAdminSubmit = async () => {
    if (!detail) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.submitAdminRoutineEvaluation(detail.routine.id, {
        decision: adminDecision,
        overallBalanceNote: overallBalanceNote || 'Cross-subject weightings and academic pacing reviewed.',
        wellbeingReviewNote: wellbeingReviewNote || 'Meets Grade 5 study duration & break guidelines.',
        changeRequestSummary: adminChangeSummary.trim() || undefined,
      });
      hydrateDetail(res.detail);
      setStatusMsg(`Admin evaluation submitted (${res.detail.routine.workflowStatus}).`);
      setAdminChangeSummary('');
      await loadList(detail.routine.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="routine-review-console">
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-[#158EE3]">
            {role === 'teacher'
              ? 'Teacher Subject-Scoped Routine Review'
              : 'Administrator Cross-Subject & Wellbeing Routine Evaluation'}
          </div>
          <h2 className="text-lg font-display font-extrabold text-[#0F2942]">
            Parent Academic Routines Pending &amp; Active Evaluation ({routines.length})
          </h2>
          <p className="text-[11px] text-[#526A84]">{EDUCATIONAL_SKILL_DISCLAIMER}</p>
        </div>

        <button
          type="button"
          onClick={() => loadList(selectedId)}
          className="px-3.5 py-2 text-xs font-bold text-[#158EE3] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl"
        >
          Refresh Queue
        </button>
      </div>

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

      {routines.length === 0 ? (
        <div className="bg-white rounded-3xl border border-[#DCEBFA] p-8 text-center text-sm text-[#526A84]">
          No parent academic routines currently fall within your review scope.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left Queue */}
          <div className="xl:col-span-4 space-y-2.5">
            {routines.map((r) => {
              const active = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={async () => {
                    setSelectedId(r.id);
                    const det = await api.getRoutineDetail(r.id);
                    hydrateDetail(det.detail);
                  }}
                  className={`w-full text-left p-4 rounded-2xl border transition-colors ${
                    active
                      ? 'bg-[#EBF5FF] border-[#158EE3]'
                      : 'bg-white border-[#DCEBFA] hover:border-[#99CAFA]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                    <span className="text-[#158EE3]">{r.studentName}</span>
                    <span className="text-[#0F2942]">{r.workflowStatus}</span>
                  </div>
                  <div className="text-sm font-display font-bold text-[#0F2942] mt-1">{r.title}</div>
                  <div className="text-[11px] text-[#526A84] mt-0.5">
                    Parent: {r.guardianName} · v{r.currentVersionNumber} · {r.scheduleMode.toUpperCase()}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Inspection & Evaluation Form */}
          {detail && (
            <div className="xl:col-span-8 space-y-5">
              {/* Student Context Evidence + Allocation Summary */}
              <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5F0FA]">
                  <div>
                    <h3 className="text-base font-display font-bold text-[#0F2942]">
                      {detail.currentVersion.title}
                    </h3>
                    <div className="text-[#526A84]">
                      Student: <strong>{detail.routine.studentName}</strong> ({detail.routine.studentGrade}) ·{' '}
                      {detail.currentVersion.questionCountPerSession} Qs / {detail.currentVersion.sessionDurationMinutes}m ·{' '}
                      {detail.currentVersion.recurrenceType} ({detail.currentVersion.timezone})
                    </div>
                  </div>
                  <span className="font-bold text-[#158EE3] px-3 py-1 rounded-xl bg-[#F3F9FF] border border-[#CBE2FA]">
                    {detail.routine.workflowStatus}
                  </span>
                </div>

                {/* Subject Weights + Empirical Student Evidence */}
                <div className="space-y-2">
                  <div className="font-bold text-[#0F2942]">Subject Weights vs Student Accuracy Evidence</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {detail.currentVersion.subjectWeights
                      .filter((sw) => sw.enabled)
                      .map((sw) => {
                        const subjName = subjectNameMap.get(sw.subjectId) || sw.subjectId;
                        const metric = detail.studentContext.subjectMetrics.find(
                          (m) => m.subjectId === sw.subjectId
                        );
                        const inTeacherScope =
                          role === 'admin' || assignedSubjectIds.includes(sw.subjectId);
                        return (
                          <div
                            key={sw.subjectId}
                            className={`p-3 rounded-2xl border space-y-1.5 ${
                              inTeacherScope
                                ? 'bg-[#F8FBFF] border-[#DCEBFA]'
                                : 'bg-slate-50 border-slate-200 opacity-75'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-[#0F2942]">{subjName}</span>
                              <span className="font-bold text-[#158EE3] tabular-nums">{sw.weightPercent}%</span>
                            </div>
                            <div className="text-[11px] text-[#526A84] tabular-nums">
                              Accuracy:{' '}
                              {metric?.accuracyPercent === null || metric?.accuracyPercent === undefined
                                ? 'No attempts yet'
                                : `${metric.accuracyPercent}%`}{' '}
                              · Repeated errors: {metric?.repeatedErrorCount || 0}
                            </div>
                            {role === 'teacher' && (
                              <div className="pt-1">
                                {inTeacherScope ? (
                                  <select
                                    value={subjectDecisions[sw.subjectId] || 'approved'}
                                    onChange={(e) =>
                                      setSubjectDecisions((prev) => ({
                                        ...prev,
                                        [sw.subjectId]: e.target.value as
                                          | 'approved'
                                          | 'changes_requested'
                                          | 'comment_only',
                                      }))
                                    }
                                    className="w-full px-2.5 py-1 bg-white border border-[#CBE2FA] rounded-lg font-semibold"
                                  >
                                    <option value="approved">Approve Component</option>
                                    <option value="changes_requested">Recommend Changes</option>
                                    <option value="comment_only">Comment Only</option>
                                  </select>
                                ) : (
                                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                                    <Lock className="w-3 h-3" />
                                    <span>Outside your assigned subject permissions</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Skill & Difficulty Mix */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#E5F0FA]">
                  <div>
                    <div className="font-bold text-[#0F2942] mb-1">Educational Skill Targets</div>
                    <div className="space-y-1 text-[11px] text-[#476481]">
                      {detail.currentVersion.skillWeights
                        .filter((sk) => sk.enabled)
                        .map((sk) => (
                          <div key={sk.skillKey} className="flex justify-between tabular-nums">
                            <span>{SKILL_LABEL_MAP.get(sk.skillKey) || sk.skillKey}</span>
                            <span className="font-bold">{sk.weightPercent}%</span>
                          </div>
                        ))}
                    </div>
                  </div>
                  <div>
                    <div className="font-bold text-[#0F2942] mb-1">Difficulty Distribution</div>
                    <div className="space-y-1 text-[11px] text-[#476481] tabular-nums">
                      <div>Simple: {detail.currentVersion.difficultyDistribution.simple}%</div>
                      <div>Moderate: {detail.currentVersion.difficultyDistribution.moderate}%</div>
                      <div>Difficult: {detail.currentVersion.difficultyDistribution.difficult}%</div>
                      <div>
                        Empirical Calibration:{' '}
                        {detail.currentVersion.difficultyDistribution.useEmpiricalCalibration ? 'Enabled' : 'Author only'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Role-Specific Evaluation Action Panel */}
              {role === 'teacher' ? (
                <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3 text-xs">
                  <div className="flex items-center gap-2 font-display font-bold text-sm text-[#0F2942] pb-2 border-b border-[#E5F0FA]">
                    <ClipboardCheck className="w-4 h-4 text-[#158EE3]" />
                    <span>Submit Subject-Scoped Teacher Evaluation</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-[#476481] mb-1">Overall Component Decision</label>
                      <select
                        value={teacherDecision}
                        onChange={(e) =>
                          setTeacherDecision(
                            e.target.value as 'approved_components' | 'recommend_changes' | 'comment_only'
                          )
                        }
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold"
                      >
                        <option value="approved_components">Approve My Subject Components</option>
                        <option value="recommend_changes">Recommend Parent Routine Changes</option>
                        <option value="comment_only">Leave Advisory Comment Only</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-[#476481] mb-1">Difficulty Suitability Note</label>
                      <input
                        type="text"
                        value={difficultyNote}
                        onChange={(e) => setDifficultyNote(e.target.value)}
                        placeholder="e.g. Increase foundational practice before difficult items"
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-[#476481] mb-1">Topic Suitability Note</label>
                      <input
                        type="text"
                        value={topicNote}
                        onChange={(e) => setTopicNote(e.target.value)}
                        placeholder="Alignment with current Grade 5 syllabus sequence"
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-[#476481] mb-1">Skill &amp; Evidence Note</label>
                      <input
                        type="text"
                        value={evidenceNote}
                        onChange={(e) => setEvidenceNote(e.target.value)}
                        placeholder="Matches recent accuracy & error trend"
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-[#476481] mb-1">Teacher Guidance to Parent</label>
                    <textarea
                      rows={2}
                      value={generalComment}
                      onChange={(e) => setGeneralComment(e.target.value)}
                      placeholder="Clear educational advice on pacing, topics, and home support..."
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                  </div>

                  {teacherDecision === 'recommend_changes' && (
                    <div className="p-3 rounded-2xl bg-[#FFF8EB] border border-[#F3D19C] grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block font-semibold text-[#7B4B00] mb-1">Change Category</label>
                        <select
                          value={changeReqCategory}
                          onChange={(e) => setChangeReqCategory(e.target.value as RoutineChangeRequest['category'])}
                          className="w-full px-2.5 py-1.5 bg-white border border-[#F3D19C] rounded-xl"
                        >
                          <option value="difficulty_balance">Difficulty Balance</option>
                          <option value="subject_weight">Subject Weighting</option>
                          <option value="topic_selection">Topic Selection</option>
                          <option value="skill_focus">Skill Balance</option>
                          <option value="study_load_wellbeing">Study Load &amp; Rest</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block font-semibold text-[#7B4B00] mb-1">Specific Change Request</label>
                        <input
                          type="text"
                          value={changeReqSummary}
                          onChange={(e) => setChangeReqSummary(e.target.value)}
                          placeholder="e.g. Reduce difficult % from 40% to 20% until fractions improve"
                          className="w-full px-3 py-1.5 bg-white border border-[#F3D19C] rounded-xl"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleTeacherSubmit}
                    className="px-4 py-2.5 font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] rounded-xl"
                  >
                    Submit Teacher Evaluation
                  </button>
                </div>
              ) : (
                <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-3 text-xs">
                  <div className="flex items-center gap-2 font-display font-bold text-sm text-[#0F2942] pb-2 border-b border-[#E5F0FA]">
                    <ShieldCheck className="w-4 h-4 text-[#2E7D32]" />
                    <span>Administrator Final Coordination &amp; Wellbeing Approval</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-[#476481] mb-1">Final Routine Decision</label>
                      <select
                        value={adminDecision}
                        onChange={(e) =>
                          setAdminDecision(
                            e.target.value as 'approved' | 'changes_requested' | 'rejected' | 'comment_only'
                          )
                        }
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-semibold"
                      >
                        <option value="approved">Approve Routine for Parent Activation</option>
                        <option value="changes_requested">Request Revisions from Parent</option>
                        <option value="rejected">Reject Unbalanced Routine</option>
                        <option value="comment_only">Add Coordination Note Only</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-[#476481] mb-1">Wellbeing Load Review</label>
                      <input
                        type="text"
                        value={wellbeingReviewNote}
                        onChange={(e) => setWellbeingReviewNote(e.target.value)}
                        placeholder="Daily limits, breaks, and rest windows verified"
                        className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-[#476481] mb-1">
                      Cross-Subject Balance Summary
                    </label>
                    <textarea
                      rows={2}
                      value={overallBalanceNote}
                      onChange={(e) => setOverallBalanceNote(e.target.value)}
                      placeholder="Coordinated Math, Logic, and Language teacher feedback..."
                      className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl"
                    />
                  </div>

                  {adminDecision === 'changes_requested' && (
                    <div>
                      <label className="block font-semibold text-[#9A2F09] mb-1">
                        Revision Summary for Parent
                      </label>
                      <input
                        type="text"
                        value={adminChangeSummary}
                        onChange={(e) => setAdminChangeSummary(e.target.value)}
                        placeholder="Specify required adjustment before activation"
                        className="w-full px-3 py-2 bg-[#FFF2ED] border border-[#FAC5B2] rounded-xl"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleAdminSubmit}
                    className="px-4 py-2.5 font-bold text-white bg-[#2E7D32] hover:bg-[#1E6323] rounded-xl flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Record Final Admin Decision</span>
                  </button>
                </div>
              )}

              {/* Prior Teacher & Admin Comments */}
              {(detail.teacherEvaluations.length > 0 || detail.adminEvaluations.length > 0) && (
                <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-2.5 text-xs">
                  <div className="font-bold text-[#0F2942] flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-[#158EE3]" />
                    <span>Evaluation History ({detail.teacherEvaluations.length + detail.adminEvaluations.length})</span>
                  </div>
                  {detail.teacherEvaluations.map((ev) => (
                    <div key={ev.id} className="p-3 rounded-xl bg-[#F8FBFF] border border-[#DCEBFA]">
                      <div className="font-bold text-[#0F2942]">
                        {ev.teacherName} · {ev.decision}
                      </div>
                      <div className="text-[#476481] mt-0.5">{ev.generalComment}</div>
                    </div>
                  ))}
                  {detail.adminEvaluations.map((ev) => (
                    <div key={ev.id} className="p-3 rounded-xl bg-[#EEF9EF] border border-[#B7E1BA]">
                      <div className="font-bold text-[#1E6323]">
                        {ev.adminName} · {ev.decision.toUpperCase()}
                      </div>
                      <div className="text-[#0F2942] mt-0.5">{ev.overallBalanceNote}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
