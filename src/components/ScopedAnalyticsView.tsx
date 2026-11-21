import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  Info,
  RotateCcw,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, AuthUser, type ScopedAnalyticsResponse } from '../lib/api';
import type { SampleSizeStatus, SubjectCategory, SubtopicNode, TopicNode } from '../lib/types';

interface ScopedAnalyticsViewProps {
  role: 'admin' | 'teacher';
  subjects: SubjectCategory[];
  topics: TopicNode[];
  subtopics: SubtopicNode[];
  students?: { id: string; name: string; userIdCode: string }[];
  onInspectQuestion: (questionId: string) => void;
  onOpenInterventions?: () => void;
}

function sampleSizeBadge(status: SampleSizeStatus) {
  if (status === 'reliable') {
    return {
      label: 'Reliable (10+)',
      classes: 'bg-[#EEF9EF] border-[#B7E1BA] text-[#1E6323]',
    };
  }
  if (status === 'preliminary') {
    return {
      label: 'Preliminary (3–9)',
      classes: 'bg-[#FFF9EE] border-[#FAD49B] text-[#7A4400]',
    };
  }
  return {
    label: 'Insufficient (<3)',
    classes: 'bg-[#F1F5F9] border-[#CBD5E1] text-[#475569]',
  };
}

export function ScopedAnalyticsView({
  role,
  subjects,
  topics,
  subtopics,
  students: providedStudents,
  onInspectQuestion,
  onOpenInterventions,
}: ScopedAnalyticsViewProps) {
  const [subjectId, setSubjectId] = useState('All');
  const [topicId, setTopicId] = useState('All');
  const [subtopicId, setSubtopicId] = useState('All');
  const [difficulty, setDifficulty] = useState('All');
  const [studentId, setStudentId] = useState('All');
  const [interventionStatus, setInterventionStatus] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [studentOptions, setStudentOptions] = useState<
    { id: string; name: string; userIdCode: string }[]
  >(providedStudents || []);
  const [data, setData] = useState<ScopedAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (providedStudents) {
      setStudentOptions(providedStudents);
      return;
    }
    api
      .getScopedStudents()
      .then((res) =>
        setStudentOptions(
          res.students.map((s: AuthUser) => ({
            id: s.id,
            name: s.name,
            userIdCode: s.userIdCode,
          }))
        )
      )
      .catch(() => {
        // fallback cleanly
      });
  }, [providedStudents]);

  const loadAnalytics = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getScopedAnalytics({
        subjectId,
        topicId,
        subtopicId,
        difficulty,
        studentId,
        interventionStatus,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setData(res);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [subjectId, topicId, subtopicId, difficulty, studentId, interventionStatus, dateFrom, dateTo]);

  const visibleTopics =
    subjectId === 'All' ? topics : topics.filter((t) => t.subjectId === subjectId);
  const visibleSubtopics =
    topicId === 'All'
      ? subjectId === 'All'
        ? subtopics
        : subtopics.filter((st) => st.subjectId === subjectId)
      : subtopics.filter((st) => st.topicId === topicId);

  const handleResetFilters = () => {
    setSubjectId('All');
    setTopicId('All');
    setSubtopicId('All');
    setDifficulty('All');
    setStudentId('All');
    setInterventionStatus('All');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-6" data-testid="scoped-analytics-view">
      {/* Filter Bar */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#158EE3]" />
            <h2 className="text-base font-display font-bold text-[#0F2942]">
              {role === 'admin'
                ? 'Platform Question Intelligence & Intervention Overview'
                : 'Assigned Subject Question Intelligence & Student Progress'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleResetFilters}
            className="px-3 py-1.5 text-xs font-semibold text-[#526A84] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl hover:text-[#0F2942] flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Filters</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label htmlFor="sa-subject" className="block font-semibold text-[#476481] mb-1">
              Subject Category
            </label>
            <select
              id="sa-subject"
              aria-label="Filter analytics by subject"
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setTopicId('All');
                setSubtopicId('All');
              }}
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-medium text-[#0F2942]"
            >
              <option value="All">All Authorized Subjects ({subjects.length})</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameEn}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sa-topic" className="block font-semibold text-[#476481] mb-1">
              Topic
            </label>
            <select
              id="sa-topic"
              aria-label="Filter analytics by topic"
              value={topicId}
              onChange={(e) => {
                setTopicId(e.target.value);
                setSubtopicId('All');
              }}
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-medium text-[#0F2942]"
            >
              <option value="All">All Topics</option>
              {visibleTopics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameEn}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sa-subtopic" className="block font-semibold text-[#476481] mb-1">
              Subtopic
            </label>
            <select
              id="sa-subtopic"
              aria-label="Filter analytics by subtopic"
              value={subtopicId}
              onChange={(e) => setSubtopicId(e.target.value)}
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-medium text-[#0F2942]"
            >
              <option value="All">All Subtopics</option>
              {visibleSubtopics.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.nameEn}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sa-difficulty" className="block font-semibold text-[#476481] mb-1">
              Difficulty Tier
            </label>
            <select
              id="sa-difficulty"
              aria-label="Filter analytics by difficulty"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-medium text-[#0F2942]"
            >
              <option value="All">All Difficulty Levels</option>
              <option value="Simple">Simple</option>
              <option value="Moderate">Moderate</option>
              <option value="Challenging">Challenging</option>
              <option value="Master">Master</option>
            </select>
          </div>

          <div>
            <label htmlFor="sa-student" className="block font-semibold text-[#476481] mb-1">
              Student
            </label>
            <select
              id="sa-student"
              aria-label="Filter analytics by student"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-medium text-[#0F2942]"
            >
              <option value="All">All Students</option>
              {studentOptions.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.userIdCode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sa-int-status" className="block font-semibold text-[#476481] mb-1">
              Intervention Status
            </label>
            <select
              id="sa-int-status"
              aria-label="Filter analytics by intervention status"
              value={interventionStatus}
              onChange={(e) => setInterventionStatus(e.target.value)}
              className="w-full px-3 py-2 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl font-medium text-[#0F2942]"
            >
              <option value="All">All Intervention Cases</option>
              <option value="OPEN">OPEN</option>
              <option value="UNDER_REVIEW">UNDER REVIEW</option>
              <option value="INTERVENTION_ASSIGNED">INTERVENTION ASSIGNED</option>
              <option value="MONITORING">MONITORING</option>
              <option value="RESOLVED">RESOLVED</option>
              <option value="DISMISSED">DISMISSED</option>
            </select>
          </div>

          <div>
            <label htmlFor="sa-date-from" className="block font-semibold text-[#476481] mb-1">
              Date From
            </label>
            <input
              id="sa-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-[#0F2942]"
            />
          </div>

          <div>
            <label htmlFor="sa-date-to" className="block font-semibold text-[#476481] mb-1">
              Date To
            </label>
            <input
              id="sa-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#F8FBFF] border border-[#CBE2FA] rounded-xl text-[#0F2942]"
            />
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-[#FFF2ED] border border-[#FAC5B2] text-sm text-[#9A2F09]">
          {errorMsg}
        </div>
      )}

      {loading && !data ? (
        <div className="bg-white rounded-3xl border border-[#DCEBFA] p-10 text-center text-sm text-[#526A84]">
          Loading scoped question performance and student improvement analytics...
        </div>
      ) : data ? (
        <>
          {/* KPI Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-[#DCEBFA] p-5">
              <div className="flex items-center justify-between text-xs text-[#526A84]">
                <span>Valid Submitted Attempts</span>
                <BarChart3 className="w-4 h-4 text-[#158EE3]" />
              </div>
              <div className="text-2xl font-display font-extrabold text-[#0F2942] tabular-nums mt-1">
                {data.kpis.validAttemptCount}
              </div>
              <div className="text-[11px] text-[#526A84] mt-1 tabular-nums">
                {data.kpis.uniqueStudents} unique students · {Math.round(data.kpis.avgResponseMs / 1000)}s avg solve pace
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#DCEBFA] p-5">
              <div className="flex items-center justify-between text-xs text-[#526A84]">
                <span>Accuracy vs Error Rate</span>
                <CheckCircle2 className="w-4 h-4 text-[#4CAF50]" />
              </div>
              <div className="text-2xl font-display font-extrabold text-[#2E7D32] tabular-nums mt-1">
                {data.kpis.overallCorrectRate}% Correct
              </div>
              <div className="text-[11px] text-[#9A2F09] font-semibold mt-1 tabular-nums">
                {data.kpis.overallIncorrectRate}% Incorrect ({data.kpis.incorrectAttemptCount} wrong answers)
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#DCEBFA] p-5">
              <div className="flex items-center justify-between text-xs text-[#526A84]">
                <span>Active Interventions</span>
                <AlertTriangle className="w-4 h-4 text-[#F96A1B]" />
              </div>
              <div className="text-2xl font-display font-extrabold text-[#F96A1B] tabular-nums mt-1">
                {data.kpis.activeInterventionsCount}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-[#158EE3] font-semibold tabular-nums">
                  {data.interventionCounts.readyForTeacherReview} ready for review · {data.kpis.resolvedInterventionsCount} resolved
                </span>
                {onOpenInterventions && (
                  <button
                    type="button"
                    onClick={onOpenInterventions}
                    className="text-[11px] font-bold text-[#158EE3] hover:underline"
                  >
                    Open Queue
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#DCEBFA] p-5">
              <div className="flex items-center justify-between text-xs text-[#526A84]">
                <span>Skipped / Timed-Out Events</span>
                <Clock className="w-4 h-4 text-[#64748B]" />
              </div>
              <div className="text-2xl font-display font-extrabold text-[#475569] tabular-nums mt-1">
                {data.kpis.skippedCount + data.kpis.timedOutCount}
              </div>
              <div className="text-[11px] text-[#526A84] mt-1 tabular-nums">
                {data.kpis.skippedCount} skipped · {data.kpis.timedOutCount} timed-out (kept separate from wrong)
              </div>
            </div>
          </div>

          {/* Ethical Non-Diagnostic Response Time Framing */}
          <div className="p-3.5 rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA] text-xs text-[#335170] flex items-start gap-2.5">
            <Info className="w-4 h-4 text-[#158EE3] shrink-0 mt-0.5" />
            <span>
              <strong>Pacing & Support Note:</strong> {data.ethicalFramingNote}
            </span>
          </div>

          {/* Trend Chart + Difficult Topics */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-7 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-display font-bold text-[#0F2942]">
                    Daily Attempt Volume & Accuracy Trend
                  </h3>
                  <p className="text-xs text-[#526A84]">
                    Valid answered attempts grouped by date (correct vs incorrect)
                  </p>
                </div>
                <Activity className="w-5 h-5 text-[#158EE3]" />
              </div>

              {data.attemptTrendSeries.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#526A84]">
                  No attempt trend points match the selected filters yet.
                </div>
              ) : (
                <div className="h-64 w-full" data-testid="attempt-trend-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.attemptTrendSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5F0FA" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#526A84' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#526A84' }} allowDecimals={false} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar
                        dataKey="correct"
                        name="Correct"
                        stackId="a"
                        fill="#4CAF50"
                        radius={[0, 0, 0, 0]}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="incorrect"
                        name="Incorrect"
                        stackId="a"
                        fill="#F96A1B"
                        radius={[6, 6, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Difficult Topics */}
            <div className="xl:col-span-5 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
              <div>
                <h3 className="text-base font-display font-bold text-[#0F2942]">
                  Difficult Topics Needing Focus
                </h3>
                <p className="text-xs text-[#526A84]">
                  Ranked by incorrect answer rate across authorized curriculum
                </p>
              </div>

              {data.difficultTopics.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#526A84]">
                  No topic attempt records for these filters.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                  {data.difficultTopics.map((t) => (
                    <div
                      key={t.topicId}
                      className="p-3 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#0F2942] truncate">
                          {t.topicName}
                        </div>
                        <div className="text-[11px] text-[#526A84] truncate">
                          {t.subjectName} · {t.valid} valid attempts
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-xs font-extrabold text-[#9A2F09]">
                          {t.incorrectRate}% Wrong
                        </div>
                        <div className="text-[11px] text-[#2E7D32] font-semibold">
                          {t.correctRate}% Right
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Most Incorrect & Most Attempted Questions with Drill-down */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Most Incorrect Questions */}
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
              <div>
                <h3 className="text-base font-display font-bold text-[#0F2942]">
                  Most Incorrect Questions
                </h3>
                <p className="text-xs text-[#526A84]">
                  Click Review Question to inspect repeated errors, pacing, and version history
                </p>
              </div>
              {data.mostIncorrectQuestions.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#526A84]">
                  No question attempts found.
                </div>
              ) : (
                <div className="space-y-3">
                  {data.mostIncorrectQuestions.map((q) => {
                    const badge = sampleSizeBadge(q.sampleSizeStatus);
                    return (
                      <div
                        key={q.questionId}
                        className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-mono font-bold text-[#158EE3]">
                              {q.questionId}
                            </span>
                            <span className="text-[11px] font-semibold text-[#526A84]">
                              {q.subjectName} · {q.difficultyTier}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${badge.classes}`}
                            >
                              {badge.label}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-[#0F2942] line-clamp-2">
                            {q.questionSi}
                          </div>
                          <div className="text-[11px] text-[#526A84] tabular-nums flex flex-wrap gap-3">
                            <span className="font-bold text-[#9A2F09]">
                              {q.incorrectAttemptRate}% Wrong ({q.incorrectAttemptCount}/{q.validAttemptCount})
                            </span>
                            <span>1st Try Acc: {q.firstAttemptAccuracy ?? '—'}%</span>
                            <span>Repeat-Error Students: {q.repeatedErrorStudentCount}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onInspectQuestion(q.questionId)}
                          className="px-3 py-1.5 text-xs font-bold text-[#158EE3] bg-white border border-[#CBE2FA] rounded-xl hover:bg-[#EBF5FF] flex items-center gap-1 shrink-0 whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Review</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Most Attempted Questions */}
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
              <div>
                <h3 className="text-base font-display font-bold text-[#0F2942]">
                  Most Attempted Questions
                </h3>
                <p className="text-xs text-[#526A84]">
                  Compares first-attempt accuracy, repeat-attempt accuracy, and hint impact
                </p>
              </div>
              {data.mostAttemptedQuestions.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#526A84]">
                  No question attempts found.
                </div>
              ) : (
                <div className="space-y-3">
                  {data.mostAttemptedQuestions.map((q) => {
                    const badge = sampleSizeBadge(q.sampleSizeStatus);
                    return (
                      <div
                        key={q.questionId}
                        className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-mono font-bold text-[#158EE3]">
                              {q.questionId}
                            </span>
                            <span className="text-[11px] font-semibold text-[#526A84]">
                              {q.subjectName} · {q.validAttemptCount} attempts ({q.uniqueStudents} students)
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${badge.classes}`}
                            >
                              {badge.label}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-[#0F2942] line-clamp-2">
                            {q.questionSi}
                          </div>
                          <div className="text-[11px] text-[#526A84] tabular-nums flex flex-wrap gap-3">
                            <span className="font-bold text-[#2E7D32]">
                              {q.correctAttemptRate}% Correct
                            </span>
                            <span>Unassisted: {q.unassistedAccuracy ?? '—'}%</span>
                            <span>Hinted: {q.hintAssistedAccuracy ?? '—'}%</span>
                            <span>Median: {Math.round(q.responseTimeStats.medianMs / 1000)}s</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onInspectQuestion(q.questionId)}
                          className="px-3 py-1.5 text-xs font-bold text-[#158EE3] bg-white border border-[#CBE2FA] rounded-xl hover:bg-[#EBF5FF] flex items-center gap-1 shrink-0 whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Review</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Student Performance & Baseline-vs-Follow-Up Table */}
          <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-display font-bold text-[#0F2942]">
                  Scoped Student Performance & Baseline vs Follow-Up Improvement
                </h3>
                <p className="text-xs text-[#526A84]">
                  Calculated exclusively from authorized subject attempts
                </p>
              </div>
              <Users className="w-5 h-5 text-[#158EE3]" />
            </div>

            {data.studentPerformance.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#526A84]">
                No student attempts recorded in this subject scope yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#E5F0FA] text-xs text-[#526A84]">
                      <th className="py-2.5 pr-4 font-semibold">Student</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Valid Attempts</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Accuracy</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Active Cases</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Baseline → Follow-Up</th>
                      <th className="py-2.5 pl-3 font-semibold text-right">Improvement Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F6FD]">
                    {data.studentPerformance.map((sp) => (
                      <tr key={sp.studentId} className="hover:bg-[#F8FBFF]">
                        <td className="py-3 pr-4">
                          <div className="font-semibold text-[#0F2942]">{sp.studentName}</div>
                          <div className="text-[11px] font-mono text-[#526A84]">{sp.userIdCode}</div>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-[#0F2942]">
                          {sp.validAttempts}
                        </td>
                        <td className="py-3 px-3 text-right font-bold tabular-nums text-[#158EE3]">
                          {sp.accuracyPercent}%
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums font-semibold text-[#F96A1B]">
                          {sp.openInterventionsCount}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-xs text-[#526A84]">
                          {sp.improvement.baselineAccuracyPercent ?? '—'}% →{' '}
                          {sp.improvement.followUpAccuracyPercent ?? '—'}%
                        </td>
                        <td className="py-3 pl-3 text-right font-bold tabular-nums">
                          {sp.improvement.improvementDeltaPercent !== null ? (
                            <span
                              className={
                                sp.improvement.improvementDeltaPercent >= 0
                                  ? 'text-[#2E7D32]'
                                  : 'text-[#C62828]'
                              }
                            >
                              {sp.improvement.improvementDeltaPercent >= 0 ? '+' : ''}
                              {sp.improvement.improvementDeltaPercent}%
                            </span>
                          ) : (
                            <span className="text-xs text-[#64748B]">Needs follow-up</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Admin Only: Teacher Activity & Effectiveness Table */}
          {role === 'admin' && data.teacherActivity.length > 0 && (
            <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
              <div>
                <h3 className="text-base font-display font-bold text-[#0F2942]">
                  Teacher Oversight & Intervention Effectiveness
                </h3>
                <p className="text-xs text-[#526A84]">
                  Tracks assigned subjects, active case queues, resolved outcomes, and logged interventions
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#E5F0FA] text-xs text-[#526A84]">
                      <th className="py-2.5 pr-4 font-semibold">Teacher</th>
                      <th className="py-2.5 px-3 font-semibold">Assigned Subjects</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Active Cases</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Resolved Cases</th>
                      <th className="py-2.5 pl-3 font-semibold text-right">Actions Logged</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F6FD]">
                    {data.teacherActivity.map((t) => (
                      <tr key={t.id}>
                        <td className="py-3 pr-4">
                          <div className="font-semibold text-[#0F2942]">{t.name}</div>
                          <div className="text-[11px] font-mono text-[#526A84]">
                            {t.userIdCode} · {t.email}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-[#476481]">
                          {(t.assignedSubjectIds || []).length === 0
                            ? 'None assigned'
                            : (t.assignedSubjectIds || [])
                                .map((sid) => subjects.find((s) => s.id === sid)?.nameEn || sid)
                                .join(', ')}
                        </td>
                        <td className="py-3 px-3 text-right font-bold tabular-nums text-[#F96A1B]">
                          {t.activeCaseCount}
                        </td>
                        <td className="py-3 px-3 text-right font-bold tabular-nums text-[#2E7D32]">
                          {t.resolvedCaseCount}
                        </td>
                        <td className="py-3 pl-3 text-right font-bold tabular-nums text-[#158EE3]">
                          {t.actionsTakenCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
