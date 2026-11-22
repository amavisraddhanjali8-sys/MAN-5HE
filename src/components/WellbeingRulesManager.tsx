import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, ShieldCheck, Sliders } from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import type {
  SubjectCategory,
  TimedAssessmentBreakPolicy,
  WellbeingRuleSet,
  WellbeingRuleVersion,
} from '../lib/types';

interface WellbeingRulesManagerProps {
  role: 'admin' | 'teacher';
  user: AuthUser;
  subjects: SubjectCategory[];
}

export function WellbeingRulesManager({
  role,
  user,
  subjects,
}: WellbeingRulesManagerProps) {
  const [ruleSets, setRuleSets] = useState<WellbeingRuleSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const delegatedSubjects = user.delegatedPublishSubjects || [];

  // Draft form
  const [targetSubjectId, setTargetSubjectId] = useState<string>(
    role === 'teacher' && delegatedSubjects.length > 0 ? delegatedSubjects[0] : ''
  );
  const [title, setTitle] = useState('Grade 5 Healthy Study Pacing Guidelines');
  const [educationalStandardNote, setEducationalStandardNote] = useState(
    'Age-appropriate educational guidelines for Grade 5 students (ages 9–11). Configured thresholds are advisory pacing aids, not clinical or medical standards.'
  );
  const [dailyWarningMinutes, setDailyWarningMinutes] = useState(75);
  const [dailyMaxMinutes, setDailyMaxMinutes] = useState(90);
  const [weeklyWarningMinutes, setWeeklyWarningMinutes] = useState(360);
  const [weeklyMaxMinutes, setWeeklyMaxMinutes] = useState(450);
  const [continuousSessionWarningMinutes, setContinuousSessionWarningMinutes] = useState(35);
  const [recommendedBreakMinutes, setRecommendedBreakMinutes] = useState(10);
  const [breakIntervalMinutes, setBreakIntervalMinutes] = useState(35);
  const [inactivityThresholdSeconds, setInactivityThresholdSeconds] = useState(120);
  const [reminderFrequencyMinutes, setReminderFrequencyMinutes] = useState(15);
  const [timedPolicy, setTimedPolicy] = useState<TimedAssessmentBreakPolicy>(
    'warn_non_blocking_unless_paused'
  );
  const [staffReviewDailyExceedCount, setStaffReviewDailyExceedCount] = useState(2);
  const [staffReviewConsecutiveDays, setStaffReviewConsecutiveDays] = useState(2);
  const [escalationContinuousDays, setEscalationContinuousDays] = useState(4);
  const [changeNote, setChangeNote] = useState('');

  const loadRules = async () => {
    setLoading(true);
    try {
      const res = await api.getWellbeingRuleSets();
      setRuleSets(res.ruleSets);
      const primary = res.ruleSets.find((rs) => rs.isPlatformWide) || res.ruleSets[0];
      const activeVer =
        primary?.versions.find((v) => v.id === primary.currentActiveVersionId) ||
        primary?.versions[0];
      if (activeVer) {
        setDailyWarningMinutes(activeVer.dailyWarningMinutes);
        setDailyMaxMinutes(activeVer.dailyMaxMinutes);
        setWeeklyWarningMinutes(activeVer.weeklyWarningMinutes);
        setWeeklyMaxMinutes(activeVer.weeklyMaxMinutes);
        setContinuousSessionWarningMinutes(activeVer.continuousSessionWarningMinutes);
        setRecommendedBreakMinutes(activeVer.recommendedBreakMinutes);
        setBreakIntervalMinutes(activeVer.breakIntervalMinutes);
        setInactivityThresholdSeconds(activeVer.inactivityThresholdSeconds);
        setReminderFrequencyMinutes(activeVer.reminderFrequencyMinutes);
        setTimedPolicy(activeVer.timedAssessmentBreakPolicy);
        setStaffReviewDailyExceedCount(activeVer.staffReviewDailyExceedCount);
        setStaffReviewConsecutiveDays(activeVer.staffReviewConsecutiveDays);
        setEscalationContinuousDays(activeVer.escalationContinuousDays);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const canTeacherActivateSelected =
    role === 'teacher' && Boolean(targetSubjectId) && delegatedSubjects.includes(targetSubjectId);

  const handleSaveOrPropose = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const matchingSet = ruleSets.find((rs) =>
        targetSubjectId ? rs.subjectId === targetSubjectId : rs.isPlatformWide
      );
      const res = await api.saveOrProposeWellbeingRule({
        ruleSetId: matchingSet?.id,
        title: title.trim() || 'Grade 5 Study Wellbeing Guideline',
        grade: 'Grade 5',
        subjectId: targetSubjectId || null,
        educationalStandardNote,
        dailyWarningMinutes,
        dailyMaxMinutes,
        weeklyWarningMinutes,
        weeklyMaxMinutes,
        continuousSessionWarningMinutes,
        recommendedBreakMinutes,
        breakIntervalMinutes,
        inactivityThresholdSeconds,
        reminderFrequencyMinutes,
        timedAssessmentBreakPolicy: timedPolicy,
        staffReviewDailyExceedCount,
        staffReviewConsecutiveDays,
        escalationContinuousDays,
        changeNote: changeNote.trim() || 'Updated wellbeing pacing rule',
        activateImmediately: role === 'admin' || canTeacherActivateSelected,
      });
      setStatusMsg(
        res.version.approvalStatus === 'ACTIVE'
          ? `Rule version v${res.version.versionNumber} saved and activated.`
          : `Recommendation v${res.version.versionNumber} submitted for Administrator review (PENDING_REVIEW).`
      );
      setChangeNote('');
      await loadRules();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleApproveVersion = async (versionId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const res = await api.approveWellbeingRuleVersion(versionId);
      setStatusMsg(`Approved & activated wellbeing rule v${res.version.versionNumber}.`);
      await loadRules();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="wellbeing-rules-manager"
      className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[#E5F0FA]">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#158EE3]" />
            <h2 className="text-base font-display font-bold text-[#0F2942]">
              Child Learning Wellbeing Rules &amp; Pacing Thresholds
            </h2>
          </div>
          <p className="text-xs text-[#526A84] mt-0.5">
            {role === 'admin'
              ? 'Manage platform-wide Grade 5 limits, review teacher proposals, and preserve versioned rule history.'
              : 'Propose platform-wide adjustments for admin approval or configure rules for your delegated subjects.'}
          </p>
        </div>
        <div className="text-[11px] font-semibold text-[#0E4F80] bg-[#F3F9FF] border border-[#CBE2FA] px-3 py-1.5 rounded-xl">
          Educational Guidelines · Non-Diagnostic
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-xs text-[#9A2F09]">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="p-3.5 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] text-xs font-medium text-[#1E6323]">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSaveOrPropose}
          className="xl:col-span-6 p-5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-3 text-xs"
        >
          <div className="font-bold text-sm text-[#0F2942]">
            {role === 'admin' ? 'Publish New Rule Version' : 'Propose or Update Guideline Version'}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Rule Scope</label>
              <select
                value={targetSubjectId}
                onChange={(e) => setTargetSubjectId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
              >
                <option value="">
                  Platform-Wide Grade 5 {role === 'teacher' ? '(Requires Admin Approval)' : ''}
                </option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    Subject: {s.nameEn}
                    {role === 'teacher' && delegatedSubjects.includes(s.id)
                      ? ' (Delegated)'
                      : role === 'teacher'
                      ? ' (Propose)'
                      : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Rule Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Daily Advisory (m)</label>
              <input
                type="number"
                min={20}
                max={240}
                value={dailyWarningMinutes}
                onChange={(e) => setDailyWarningMinutes(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Daily Max (m)</label>
              <input
                type="number"
                min={30}
                max={300}
                value={dailyMaxMinutes}
                onChange={(e) => setDailyMaxMinutes(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Weekly Advisory (m)</label>
              <input
                type="number"
                min={60}
                max={1200}
                value={weeklyWarningMinutes}
                onChange={(e) => setWeeklyWarningMinutes(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Weekly Max (m)</label>
              <input
                type="number"
                min={90}
                max={1500}
                value={weeklyMaxMinutes}
                onChange={(e) => setWeeklyMaxMinutes(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Continuous Cap (m)</label>
              <input
                type="number"
                min={15}
                max={120}
                value={continuousSessionWarningMinutes}
                onChange={(e) => setContinuousSessionWarningMinutes(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Break Length (m)</label>
              <input
                type="number"
                min={5}
                max={45}
                value={recommendedBreakMinutes}
                onChange={(e) => setRecommendedBreakMinutes(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Break Every (m)</label>
              <input
                type="number"
                min={15}
                max={90}
                value={breakIntervalMinutes}
                onChange={(e) => setBreakIntervalMinutes(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">Idle Cutoff (sec)</label>
              <input
                type="number"
                min={30}
                max={600}
                value={inactivityThresholdSeconds}
                onChange={(e) => setInactivityThresholdSeconds(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block font-semibold text-[#476481] mb-1">
                Timed Assessment Break Policy
              </label>
              <select
                value={timedPolicy}
                onChange={(e) => setTimedPolicy(e.target.value as TimedAssessmentBreakPolicy)}
                className="w-full px-2.5 py-2 bg-white border border-[#CBE2FA] rounded-xl"
              >
                <option value="warn_non_blocking_unless_paused">
                  Non-blocking supportive break reminder
                </option>
                <option value="suggest_pause_after_section">
                  Suggest pause between paper sections
                </option>
                <option value="strict_no_interrupt_until_submit">
                  Quiet until exam submission
                </option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-[#476481] mb-1">
                Staff Review Trigger (Excess Days)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={staffReviewDailyExceedCount}
                  onChange={(e) => setStaffReviewDailyExceedCount(Number(e.target.value))}
                  title="Excesses before staff review"
                  className="px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
                />
                <input
                  type="number"
                  min={2}
                  max={14}
                  value={escalationContinuousDays}
                  onChange={(e) => setEscalationContinuousDays(Number(e.target.value))}
                  title="Days before escalation priority"
                  className="px-2.5 py-1.5 bg-white border border-[#CBE2FA] rounded-xl tabular-nums"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-[#476481] mb-1">
              Educational Standard Framing Note
            </label>
            <textarea
              rows={2}
              value={educationalStandardNote}
              onChange={(e) => setEducationalStandardNote(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#476481] mb-1">Change / Rationale Note</label>
            <input
              type="text"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="e.g. Adjusted evening break cadence before Term 2 scholarship revision"
              className="w-full px-3 py-2 bg-white border border-[#CBE2FA] rounded-xl"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            data-testid="save-wellbeing-rule-btn"
            className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#158EE3] hover:bg-[#1176BE] disabled:opacity-50 rounded-xl whitespace-nowrap shrink-0"
          >
            {busy
              ? 'Saving...'
              : role === 'admin' || canTeacherActivateSelected
              ? 'Save & Activate Rule Version'
              : 'Submit Guideline Proposal for Admin Approval'}
          </button>
        </form>

        {/* Version History & Pending Proposals */}
        <div className="xl:col-span-6 space-y-3 text-xs">
          <div className="font-bold text-sm text-[#0F2942]">
            Configured Rule Sets &amp; Version History ({ruleSets.length})
          </div>

          {loading ? (
            <div className="py-8 text-center text-[#526A84]">Loading wellbeing guidelines...</div>
          ) : (
            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              {ruleSets.map((rs) => (
                <div
                  key={rs.id}
                  className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-[#0F2942]">{rs.title}</div>
                      <div className="text-[11px] text-[#526A84]">
                        {rs.grade} · {rs.isPlatformWide ? 'Platform-Wide Policy' : `Subject ${rs.subjectId}`}
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-[#158EE3]">{rs.id}</span>
                  </div>

                  <div className="space-y-2">
                    {rs.versions.map((ver: WellbeingRuleVersion) => (
                      <div
                        key={ver.id}
                        data-testid={`rule-version-${ver.id}`}
                        className={`p-3 rounded-xl border bg-white space-y-1.5 ${
                          ver.approvalStatus === 'ACTIVE'
                            ? 'border-[#B7E1BA]'
                            : ver.approvalStatus === 'PENDING_REVIEW'
                            ? 'border-[#FAD49B]'
                            : 'border-[#E5F0FA]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-bold text-[#0F2942] tabular-nums">
                            v{ver.versionNumber} · {ver.approvalStatus}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-[#526A84]">
                            <span>By {ver.createdByName}</span>
                            {role === 'admin' && ver.approvalStatus === 'PENDING_REVIEW' && (
                              <button
                                type="button"
                                data-testid={`approve-rule-${ver.id}`}
                                onClick={() => handleApproveVersion(ver.id)}
                                className="px-2.5 py-1 text-[11px] font-bold text-white bg-[#2E7D32] hover:bg-[#236227] rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Approve &amp; Activate
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="text-[11px] text-[#476481] tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>Daily: {ver.dailyWarningMinutes}m / {ver.dailyMaxMinutes}m max</span>
                          <span>Weekly: {ver.weeklyWarningMinutes}m / {ver.weeklyMaxMinutes}m max</span>
                          <span>
                            Focus cap: {ver.continuousSessionWarningMinutes}m → {ver.recommendedBreakMinutes}m break
                          </span>
                          <span>Idle cutoff: {ver.inactivityThresholdSeconds}s</span>
                        </div>

                        <div className="text-[11px] text-[#526A84]">
                          {ver.changeNote} · {ver.educationalStandardNote}
                        </div>
                      </div>
                    ))}
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
