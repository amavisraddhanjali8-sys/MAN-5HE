import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Radar as RadarIcon,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { evaluateSubjectProficiencyProfile } from '../lib/subjectProficiency';
import type { AttemptRecord, StudentTrajectory } from '../lib/types';

interface SubjectProficiencyRadarProps {
  attempts: AttemptRecord[];
  trajectory: StudentTrajectory;
  onPracticeFallback: () => void;
}

export function SubjectProficiencyRadar({
  attempts,
  trajectory,
  onPracticeFallback,
}: SubjectProficiencyRadarProps) {
  const profile = useMemo(
    () => evaluateSubjectProficiencyProfile(attempts, trajectory.weakDomains),
    [attempts, trajectory.weakDomains]
  );

  return (
    <section
      aria-label="Grade 5 Subject Proficiency Radar"
      data-testid="subject-proficiency-radar-card"
      className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#E5F0FA]">
        <div>
          <div className="flex items-center gap-2">
            <RadarIcon className="w-5 h-5 text-[#158EE3] shrink-0" />
            <h2 className="text-lg font-display font-bold text-[#0F2942]">
              Subject Proficiency & Fall-Back Tracker
            </h2>
          </div>
          <p className="text-xs text-[#526A84] mt-0.5">
            විෂය ප්‍රවීණතා රේඩාර් සටහන · Tracks Grade 5 mastery across Sinhala, Mathematics, Tamil / English & IQ against the 75% Scholarship target
          </p>
        </div>

        <div className="flex items-center gap-5 text-xs">
          <div>
            <div className="text-[#526A84]">Subject Avg</div>
            <div
              data-testid="radar-overall-avg"
              className="text-base font-display font-extrabold text-[#158EE3] tabular-nums"
            >
              {profile.overallProficiencyPercent}%
            </div>
          </div>
          <div>
            <div className="text-[#526A84]">On Target</div>
            <div className="text-base font-display font-extrabold text-[#2E7D32] tabular-nums">
              {profile.subjectsOnTargetCount}/{profile.radarData.length}
            </div>
          </div>
          {profile.strongestSubject && (
            <div>
              <div className="text-[#526A84]">Strongest</div>
              <div className="text-sm font-display font-bold text-[#0F2942]">
                {profile.strongestSubject.subject} ({profile.strongestSubject.proficiency}%)
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Recharts Radar Visualization */}
        <div
          data-testid="recharts-radar-container"
          className="lg:col-span-7 w-full rounded-2xl bg-[#F8FBFF] border border-[#E5F0FA] p-3"
        >
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart cx="50%" cy="50%" outerRadius="72%" data={profile.radarData}>
              <PolarGrid stroke="#D4E6FA" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: '#0F2942', fontSize: 12, fontWeight: 700 }}
              />
              <PolarRadiusAxis
                angle={30}
                domain={[0, 100]}
                tick={{ fill: '#5E7892', fontSize: 10 }}
                tickCount={5}
              />
              <Radar
                name="Current Proficiency (%)"
                dataKey="proficiency"
                stroke="#158EE3"
                strokeWidth={2.5}
                fill="#158EE3"
                fillOpacity={0.28}
                isAnimationActive={false}
              />
              <Radar
                name="Scholarship Target (75%)"
                dataKey="targetBenchmark"
                stroke="#F96A1B"
                strokeWidth={2}
                strokeDasharray="5 4"
                fill="#F96A1B"
                fillOpacity={0.05}
                isAnimationActive={false}
              />
              <Tooltip
                formatter={(value) => [`${value}%`, undefined]}
                contentStyle={{
                  borderRadius: '14px',
                  borderColor: '#CBE2FA',
                  fontSize: '12px',
                  color: '#0F2942',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '4px' }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Fall-Back Area & Progress Remediation Panel */}
        <div className="lg:col-span-5 space-y-3" data-testid="fallback-areas-panel">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-display font-bold text-[#0F2942]">
              Student Fall-Back Areas
            </h3>
            <span className="text-[11px] font-semibold text-[#526A84]">
              Threshold &lt; 70% or Dropping
            </span>
          </div>

          {profile.fallbackAreas.length > 0 ? (
            <div className="space-y-2.5">
              {profile.fallbackAreas.slice(0, 3).map((area) => (
                <div
                  key={area.domain}
                  data-testid={`fallback-item-${area.subject}`}
                  className="p-3 rounded-2xl bg-[#FFF6F2] border border-[#FACBB8] space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#9A2F09] flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#F96A1B] shrink-0" />
                      <span>
                        {area.subject} · {area.subjectSi}
                      </span>
                    </span>
                    <span className="text-xs font-extrabold text-[#C62828] tabular-nums">
                      {area.proficiency}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-white rounded-full overflow-hidden border border-[#F8D8CA]">
                    <div
                      className="h-full bg-[#F96A1B]"
                      style={{ width: `${Math.max(8, area.proficiency)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#7A4400] tabular-nums">
                    <span>
                      {area.gapToTarget > 0
                        ? `${area.gapToTarget}% below 75% target`
                        : 'Recent score drop detected'}
                    </span>
                    {area.deltaPercent !== 0 && (
                      <span className="inline-flex items-center gap-0.5 font-bold">
                        {area.deltaPercent > 0 ? (
                          <TrendingUp className="w-3 h-3 text-[#2E7D32]" />
                        ) : (
                          <TrendingDown className="w-3 h-3 text-[#C62828]" />
                        )}
                        {area.deltaPercent > 0 ? '+' : ''}
                        {area.deltaPercent}% trend
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#523018] leading-snug">
                    {area.remediationTip}
                  </p>
                </div>
              ))}
              {profile.fallbackAreas.length > 3 && (
                <div className="text-[11px] font-semibold text-[#9A2F09] text-center tabular-nums">
                  +{profile.fallbackAreas.length - 3} more fall-back subject
                  {profile.fallbackAreas.length - 3 === 1 ? '' : 's'} shown in breakdown below
                </div>
              )}

              <button
                type="button"
                onClick={onPracticeFallback}
                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-[#F96A1B] hover:bg-[#DE580E] rounded-xl transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Practice Fall-Back Subjects Now</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4] space-y-2">
              <div className="text-xs font-bold text-[#1F6A24] flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>All tested subjects are tracking cleanly above 70%!</span>
              </div>
              <p className="text-xs text-[#2D5E31] leading-relaxed">
                Keep alternating between 500K+ practice rounds and timed mock papers to push every subject past the 85% Island Rank zone.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 6-Subject Progress Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-[#E5F0FA]">
        {profile.radarData.map((item) => {
          const badgeTone =
            item.status === 'Strong'
              ? 'text-[#2E7D32]'
              : item.status === 'Fallback Area'
              ? 'text-[#C62828]'
              : item.status === 'Developing'
              ? 'text-[#D97706]'
              : 'text-[#647C94]';

          return (
            <div
              key={item.domain}
              className="p-3 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] space-y-1"
            >
              <div className="text-[11px] font-bold text-[#0F2942] truncate">
                {item.subject}
              </div>
              <div className="flex items-baseline justify-between gap-1">
                <span className={`text-base font-display font-extrabold tabular-nums ${badgeTone}`}>
                  {item.status === 'Untested' ? '—' : `${item.proficiency}%`}
                </span>
                {item.deltaPercent !== 0 && (
                  <span
                    className={`text-[10px] font-bold tabular-nums ${
                      item.deltaPercent > 0 ? 'text-[#2E7D32]' : 'text-[#C62828]'
                    }`}
                  >
                    {item.deltaPercent > 0 ? '+' : ''}
                    {item.deltaPercent}%
                  </span>
                )}
              </div>
              <div className="text-[10px] font-medium text-[#526A84] truncate">
                {item.status}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
