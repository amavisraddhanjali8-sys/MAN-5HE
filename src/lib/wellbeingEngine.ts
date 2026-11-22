import type {
  PreScheduleWellbeingValidationResult,
  ScheduledSessionRecord,
  SessionActivitySummary,
  StudyActivityContextMode,
  StudyActivityEventRecord,
  WellbeingRuleVersion,
  WellbeingSuggestedChange,
  WellbeingWarningSeverity,
} from './types.ts';

export const PROHIBITED_SURVEILLANCE_KEYS = new Set([
  'keystrokes',
  'keystrokeContent',
  'rawKeystrokes',
  'camera',
  'cameraStream',
  'microphone',
  'audio',
  'video',
  'webcam',
  'screenshot',
  'screenCapture',
  'gps',
  'latitude',
  'longitude',
  'geolocation',
  'coordinates',
  'biometric',
  'faceTracking',
]);

export function detectProhibitedSurveillancePayload(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const found: string[] = [];
  const visit = (node: unknown, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const normalized = k.trim();
      const lower = normalized.toLowerCase();
      if (
        PROHIBITED_SURVEILLANCE_KEYS.has(normalized) ||
        lower.includes('keystroke') ||
        lower.includes('webcam') ||
        lower.includes('camera') ||
        lower.includes('microphone') ||
        lower.includes('screenshot') ||
        lower === 'latitude' ||
        lower === 'longitude' ||
        lower === 'gps' ||
        lower === 'geolocation'
      ) {
        if (v !== undefined && v !== null && v !== false && v !== '') {
          found.push(normalized);
        }
      }
      if (v && typeof v === 'object') {
        visit(v, depth + 1);
      }
    }
  };
  visit(raw);
  return Array.from(new Set(found));
}

export interface TimeInterval {
  startMs: number;
  endMs: number;
}

export function mergeOverlappingIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const valid = intervals
    .filter((i) => Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (valid.length === 0) return [];
  const merged: TimeInterval[] = [{ ...valid[0] }];
  for (let i = 1; i < valid.length; i++) {
    const cur = valid[i];
    const last = merged[merged.length - 1];
    if (cur.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, cur.endMs);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

export function sumMergedSeconds(intervals: TimeInterval[]): number {
  const merged = mergeOverlappingIntervals(intervals);
  const totalMs = merged.reduce((sum, item) => sum + (item.endMs - item.startMs), 0);
  return Math.max(0, Math.round(totalMs / 1000));
}

const INTERACTION_SIGNAL_TYPES = new Set<StudyActivityEventRecord['eventType']>([
  'session_open',
  'interaction_heartbeat',
  'question_viewed',
  'answer_selected',
  'hint_opened',
  'tab_resumed',
  'network_reconnected',
  'break_ended',
  'resumed',
]);

export interface TimelineSlice {
  openIntervals: TimeInterval[];
  activeIntervals: TimeInterval[];
  backgroundIntervals: TimeInterval[];
  breakIntervals: TimeInterval[];
  idleIntervals: TimeInterval[];
  continuousPeakSeconds: number;
  breakCount: number;
  interruptionCount: number;
}

/**
 * Computes conservative, overlap-safe study-time metrics from chronological
 * study events inside a single session, handling backgrounding, network gaps,
 * pauses, breaks, idle browser windows, and concurrent tabs on the same session.
 */
export function computeSessionTimelineSlices(
  events: StudyActivityEventRecord[],
  inactivityThresholdSeconds = 120
): TimelineSlice {
  if (events.length === 0) {
    return {
      openIntervals: [],
      activeIntervals: [],
      backgroundIntervals: [],
      breakIntervals: [],
      idleIntervals: [],
      continuousPeakSeconds: 0,
      breakCount: 0,
      interruptionCount: 0,
    };
  }

  const thresholdMs = Math.max(30, inactivityThresholdSeconds) * 1000;
  // Group per tabId so concurrent tabs in the same session do not falsely terminate each other's state,
  // then union all intervals via mergeOverlappingIntervals so multi-tab open/active time never double-counts!
  const byTab = new Map<string, StudyActivityEventRecord[]>();
  for (const ev of events) {
    const key = `${ev.deviceId}::${ev.tabId}`;
    const list = byTab.get(key) || [];
    list.push(ev);
    byTab.set(key, list);
  }

  const openIntervals: TimeInterval[] = [];
  const activeIntervals: TimeInterval[] = [];
  const backgroundIntervals: TimeInterval[] = [];
  const breakIntervals: TimeInterval[] = [];
  const idleIntervals: TimeInterval[] = [];
  let interruptionCount = 0;
  let breakCount = 0;

  for (const tabEvents of byTab.values()) {
    const sorted = [...tabEvents].sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
    );
    const firstMs = Date.parse(sorted[0].occurredAt);
    const lastMs = Date.parse(sorted[sorted.length - 1].occurredAt);
    // Single-point event still represents a minimal bounded check-in unless closed later
    const closedMs = sorted[sorted.length - 1].eventType === 'session_closed'
      ? lastMs
      : lastMs;
    if (closedMs > firstMs) {
      openIntervals.push({ startMs: firstMs, endMs: closedMs });
    } else if (sorted.length === 1) {
      openIntervals.push({ startMs: firstMs, endMs: firstMs + 1000 });
    }

    let state: 'active' | 'background' | 'offline' | 'break' | 'paused' | 'closed' = 'active';
    let lastInteractionMs = firstMs;
    let lastStateChangedMs = firstMs;

    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i];
      const ts = Date.parse(ev.occurredAt);

      // Fill segment before this event according to prior state
      if (ts > lastStateChangedMs) {
        if (state === 'background') {
          backgroundIntervals.push({ startMs: lastStateChangedMs, endMs: ts });
        } else if (state === 'break' || state === 'paused') {
          breakIntervals.push({ startMs: lastStateChangedMs, endMs: ts });
        } else if (state === 'offline') {
          idleIntervals.push({ startMs: lastStateChangedMs, endMs: ts });
        } else if (state === 'active') {
          const activeUntil = Math.min(ts, lastInteractionMs + thresholdMs);
          if (activeUntil > lastStateChangedMs) {
            activeIntervals.push({ startMs: lastStateChangedMs, endMs: activeUntil });
          }
          if (ts > activeUntil) {
            idleIntervals.push({ startMs: activeUntil, endMs: ts });
          }
        }
      }

      if (ev.eventType === 'tab_backgrounded') {
        state = 'background';
        interruptionCount++;
      } else if (ev.eventType === 'network_disconnected') {
        state = 'offline';
        interruptionCount++;
      } else if (ev.eventType === 'break_started') {
        if (state !== 'break') breakCount++;
        state = 'break';
      } else if (ev.eventType === 'paused') {
        if (state !== 'paused') breakCount++;
        state = 'paused';
      } else if (ev.eventType === 'session_closed') {
        state = 'closed';
      } else if (INTERACTION_SIGNAL_TYPES.has(ev.eventType)) {
        state = 'active';
        lastInteractionMs = ts;
      }

      lastStateChangedMs = ts;
    }
  }

  const mergedActive = mergeOverlappingIntervals(activeIntervals);
  const mergedBreak = mergeOverlappingIntervals(breakIntervals);
  // Calculate continuous active stretch broken by >= 180s break or >= 180s non-active gap
  const breakResetGapMs = 180_000;
  let continuousPeakMs = 0;
  let curStretchMs = 0;
  for (let i = 0; i < mergedActive.length; i++) {
    const seg = mergedActive[i];
    if (i === 0) {
      curStretchMs = seg.endMs - seg.startMs;
    } else {
      const prev = mergedActive[i - 1];
      const gapMs = seg.startMs - prev.endMs;
      const hasExplicitBreakBetween = mergedBreak.some(
        (b) => b.endMs > prev.endMs && b.startMs < seg.startMs && (b.endMs - b.startMs) >= 60_000
      );
      if (gapMs >= breakResetGapMs || hasExplicitBreakBetween) {
        curStretchMs = seg.endMs - seg.startMs;
      } else {
        curStretchMs += seg.endMs - seg.startMs;
      }
    }
    if (curStretchMs > continuousPeakMs) {
      continuousPeakMs = curStretchMs;
    }
  }

  return {
    openIntervals: mergeOverlappingIntervals(openIntervals),
    activeIntervals: mergedActive,
    backgroundIntervals: mergeOverlappingIntervals(backgroundIntervals),
    breakIntervals: mergedBreak,
    idleIntervals: mergeOverlappingIntervals(idleIntervals),
    continuousPeakSeconds: Math.max(0, Math.round(continuousPeakMs / 1000)),
    breakCount,
    interruptionCount,
  };
}

export function summarizeSingleSession(params: {
  sessionKey: string;
  studentId: string;
  events: StudyActivityEventRecord[];
  scheduledDurationSeconds?: number;
  inactivityThresholdSeconds?: number;
}): SessionActivitySummary {
  const thresholdSec = Math.max(30, params.inactivityThresholdSeconds ?? 120);
  const sorted = [...params.events].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const slice = computeSessionTimelineSlices(sorted, thresholdSec);

  const openSec = sumMergedSeconds(slice.openIntervals);
  const activeSec = sumMergedSeconds(slice.activeIntervals);
  const bgSec = sumMergedSeconds(slice.backgroundIntervals);
  const breakSec = sumMergedSeconds(slice.breakIntervals);
  const idleRawSec = sumMergedSeconds(slice.idleIntervals);
  // Avoid over-reporting idle when openSec == activeSec
  const idleSec = Math.max(0, Math.min(openSec, idleRawSec));

  const devices = new Set(sorted.map((e) => e.deviceId));
  const tabs = new Set(sorted.map((e) => e.tabId));

  const notes: string[] = [
    `Observed active time requires foreground interaction within ${thresholdSec}s and excludes background/paused windows.`,
  ];
  if (idleSec >= 60) {
    notes.push(
      `Includes ${Math.round(idleSec / 60)} min of unverified open/idle time where no click or study action occurred (child may have been reading offline or away).`
    );
  }
  if (bgSec >= 60) {
    notes.push(
      `Excludes ${Math.round(bgSec / 60)} min spent with the tab backgrounded or minimized.`
    );
  }
  if (tabs.size > 1 || devices.size > 1) {
    notes.push(
      `Deduplicated overlapping activity across ${tabs.size} tab(s) / ${devices.size} device(s).`
    );
  }

  return {
    sessionKey: params.sessionKey,
    studentId: params.studentId,
    contextMode: (first?.contextMode || 'practice') as StudyActivityContextMode,
    assessmentId: sorted.find((e) => e.assessmentId)?.assessmentId || null,
    scheduledSessionId: sorted.find((e) => e.scheduledSessionId)?.scheduledSessionId || null,
    paperId: sorted.find((e) => e.paperId)?.paperId || null,
    subjectId: sorted.find((e) => e.subjectId)?.subjectId || null,
    startedAt: first?.occurredAt || new Date().toISOString(),
    endedAt: last?.occurredAt || new Date().toISOString(),
    scheduledDurationSeconds: Math.max(0, Math.round(params.scheduledDurationSeconds ?? 0)),
    openDurationSeconds: openSec,
    activeDurationSeconds: activeSec,
    idleDurationSeconds: idleSec,
    backgroundDurationSeconds: bgSec,
    breakTotalSeconds: breakSec,
    breakCount: slice.breakCount,
    continuousPeakSeconds: slice.continuousPeakSeconds,
    interruptionCount: slice.interruptionCount,
    deviceCount: devices.size,
    tabCount: tabs.size,
    inactivityThresholdSeconds: thresholdSec,
    uncertaintyNote: notes.join(' '),
    updatedAt: new Date().toISOString(),
  };
}

export interface ProposedSessionSlot {
  localDate: string; // YYYY-MM-DD
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
  title?: string;
}

function getIsoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setUTCDate(diff));
  return monday.toISOString().slice(0, 10);
}

/**
 * Validates proposed schedule slots combined with existing scheduled sessions
 * against the active wellbeing rule version. Produces supportive, non-accusatory
 * parent guidance and balanced timetable alternatives.
 */
export function validateScheduleWellbeing(params: {
  studentId: string;
  existingSessions: ScheduledSessionRecord[];
  proposedSlots: ProposedSessionSlot[];
  rule: WellbeingRuleVersion;
  recentExcessDaysCount?: number;
}): PreScheduleWellbeingValidationResult {
  const { studentId, existingSessions, proposedSlots, rule } = params;

  const existingByDate = new Map<string, { minutes: number; intervals: TimeInterval[] }>();
  for (const s of existingSessions) {
    if (s.status === 'CANCELLED') continue;
    const startMs = Date.parse(s.scheduledStartUtc);
    const endMs = Date.parse(s.scheduledEndUtc);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const localDate = s.scheduledStartUtc.slice(0, 10);
    const entry = existingByDate.get(localDate) || { minutes: 0, intervals: [] };
    entry.minutes += Math.max(0, s.durationMinutes);
    entry.intervals.push({ startMs, endMs });
    existingByDate.set(localDate, entry);
  }

  const proposedByDate = new Map<string, { minutes: number; intervals: TimeInterval[] }>();
  let peakContinuousMinutes = 0;
  let proposedMinutesTotal = 0;

  for (const slot of proposedSlots) {
    proposedMinutesTotal += Math.max(0, slot.durationMinutes);
    if (slot.durationMinutes > peakContinuousMinutes) {
      peakContinuousMinutes = slot.durationMinutes;
    }
    const startMs = Date.parse(slot.startUtc);
    const endMs = Date.parse(slot.endUtc);
    const entry = proposedByDate.get(slot.localDate) || { minutes: 0, intervals: [] };
    entry.minutes += Math.max(0, slot.durationMinutes);
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      entry.intervals.push({ startMs, endMs });
    }
    proposedByDate.set(slot.localDate, entry);
  }

  // Also check contiguous back-to-back sessions on the same date (< recommendedBreakMinutes gap)
  let insufficientPlannedBreaks = false;
  const allDates = Array.from(new Set([...existingByDate.keys(), ...proposedByDate.keys()])).sort();
  const touchedDates = Array.from(proposedByDate.keys()).sort();

  const dailyProjections: PreScheduleWellbeingValidationResult['dailyProjections'] = [];
  const weeklyTotals = new Map<string, number>();

  let peakDailyCombinedMinutes = 0;
  let daysOverWarning = 0;
  let daysOverMax = 0;

  for (const d of allDates) {
    const ex = existingByDate.get(d) || { minutes: 0, intervals: [] };
    const pr = proposedByDate.get(d) || { minutes: 0, intervals: [] };
    const combinedMinutes = ex.minutes + pr.minutes;

    const weekKey = getIsoWeekKey(d);
    weeklyTotals.set(weekKey, (weeklyTotals.get(weekKey) || 0) + combinedMinutes);

    if (pr.minutes > 0) {
      dailyProjections.push({
        date: d,
        existingMinutes: ex.minutes,
        proposedMinutes: pr.minutes,
        combinedMinutes,
      });
      if (combinedMinutes > peakDailyCombinedMinutes) {
        peakDailyCombinedMinutes = combinedMinutes;
      }
      if (combinedMinutes > rule.dailyWarningMinutes) daysOverWarning++;
      if (combinedMinutes > rule.dailyMaxMinutes) daysOverMax++;

      // Check break gap between adjacent intervals on this date
      const dayIntervals = [...ex.intervals, ...pr.intervals].sort((a, b) => a.startMs - b.startMs);
      for (let i = 0; i < dayIntervals.length; i++) {
        const curDurMin = Math.round((dayIntervals[i].endMs - dayIntervals[i].startMs) / 60_000);
        if (curDurMin > rule.continuousSessionWarningMinutes) {
          peakContinuousMinutes = Math.max(peakContinuousMinutes, curDurMin);
        }
        if (i > 0) {
          const gapMinutes = Math.round(
            (dayIntervals[i].startMs - dayIntervals[i - 1].endMs) / 60_000
          );
          const mergedBlockMin =
            Math.round((dayIntervals[i].endMs - dayIntervals[i].startMs) / 60_000) +
            Math.round((dayIntervals[i - 1].endMs - dayIntervals[i - 1].startMs) / 60_000);
          if (gapMinutes >= 0 && gapMinutes < rule.recommendedBreakMinutes && mergedBlockMin > rule.continuousSessionWarningMinutes) {
            insufficientPlannedBreaks = true;
            peakContinuousMinutes = Math.max(peakContinuousMinutes, mergedBlockMin);
          }
        }
      }
    }
  }

  let peakWeeklyCombinedMinutes = 0;
  for (const d of touchedDates) {
    const wk = getIsoWeekKey(d);
    peakWeeklyCombinedMinutes = Math.max(peakWeeklyCombinedMinutes, weeklyTotals.get(wk) || 0);
  }

  const exceedsDailyWarning = peakDailyCombinedMinutes > rule.dailyWarningMinutes;
  const exceedsDailyMax = peakDailyCombinedMinutes > rule.dailyMaxMinutes;
  const exceedsWeeklyWarning = peakWeeklyCombinedMinutes > rule.weeklyWarningMinutes;
  const exceedsWeeklyMax = peakWeeklyCombinedMinutes > rule.weeklyMaxMinutes;
  const exceedsContinuousThreshold = peakContinuousMinutes > rule.continuousSessionWarningMinutes;

  const exceededRules: string[] = [];
  if (exceedsDailyMax) {
    exceededRules.push(
      `Combined daily study time reaches ${peakDailyCombinedMinutes} min (above Grade 5 recommended daily guideline of ${rule.dailyMaxMinutes} min).`
    );
  } else if (exceedsDailyWarning) {
    exceededRules.push(
      `Combined daily study time reaches ${peakDailyCombinedMinutes} min (near the ${rule.dailyMaxMinutes} min daily guideline ceiling; advisory starts at ${rule.dailyWarningMinutes} min).`
    );
  }
  if (exceedsWeeklyMax) {
    exceededRules.push(
      `Combined weekly study workload reaches ${peakWeeklyCombinedMinutes} min (above the ${rule.weeklyMaxMinutes} min weekly educational guideline).`
    );
  } else if (exceedsWeeklyWarning) {
    exceededRules.push(
      `Weekly scheduled workload reaches ${peakWeeklyCombinedMinutes} min (approaching the ${rule.weeklyMaxMinutes} min weekly limit).`
    );
  }
  if (exceedsContinuousThreshold) {
    exceededRules.push(
      `Single uninterrupted study block is ${peakContinuousMinutes} min (above recommended ${rule.continuousSessionWarningMinutes} min continuous focus guideline).`
    );
  }
  if (insufficientPlannedBreaks) {
    exceededRules.push(
      `Back-to-back sessions leave less than the recommended ${rule.recommendedBreakMinutes}-minute rest break between study blocks.`
    );
  }

  const recentExcess = params.recentExcessDaysCount ?? 0;
  const requiresStaffReview =
    (exceedsDailyMax && daysOverMax >= rule.staffReviewDailyExceedCount) ||
    recentExcess + daysOverMax >= rule.staffReviewConsecutiveDays ||
    peakDailyCombinedMinutes >= Math.round(rule.dailyMaxMinutes * 1.5);

  let severity: WellbeingWarningSeverity = 'nominal';
  if (requiresStaffReview) {
    severity = 'staff_review_trigger';
  } else if (exceedsDailyMax || exceedsWeeklyMax || exceedsContinuousThreshold) {
    severity = 'supportive_warning';
  } else if (exceedsDailyWarning || exceedsWeeklyWarning || insufficientPlannedBreaks) {
    severity = 'advisory';
  }

  const balancedSuggestions: WellbeingSuggestedChange[] = [];
  for (const proj of dailyProjections) {
    if (
      proj.combinedMinutes > rule.dailyWarningMinutes ||
      peakContinuousMinutes > rule.continuousSessionWarningMinutes
    ) {
      const trimBy = Math.max(0, proj.combinedMinutes - rule.dailyMaxMinutes);
      balancedSuggestions.push({
        date: proj.date,
        currentScheduledMinutes: proj.combinedMinutes,
        recommendedMaxMinutes: rule.dailyMaxMinutes,
        suggestionText:
          trimBy > 0
            ? `Consider moving ${trimBy} minutes on ${proj.date} to a lighter day so Grade 5 study stays within ${rule.dailyMaxMinutes} minutes.`
            : `Keep ${proj.date} at ${proj.combinedMinutes} minutes or split into shorter ${Math.min(30, rule.continuousSessionWarningMinutes)}-minute blocks.`,
        recommendedBreakPlan: `Include a ${rule.recommendedBreakMinutes}-minute hydration/stretch break after every ${rule.breakIntervalMinutes} minutes of practice.`,
      });
    }
  }

  const supportiveTitle =
    severity === 'nominal'
      ? 'Schedule Fits Recommended Grade 5 Study Balance'
      : severity === 'advisory'
        ? 'Friendly Study Pacing Tip for Your Child'
        : 'Supportive Study-Load Notice: Consider Adding Rest Breaks';

  const supportiveMessage =
    severity === 'nominal'
      ? `This timetable stays comfortably within the Grade 5 guideline (${rule.dailyMaxMinutes} min/day, ${rule.continuousSessionWarningMinutes} min continuous focus) with balanced rest time.`
      : `Grade 5 learners retain concepts best with short, focused blocks and regular rest. ${exceededRules.join(
          ' '
        )} Consider keeping sessions light, adding a ${rule.recommendedBreakMinutes}-minute break between activities, or reaching out to your child's teacher for tailored pacing tips.`;

  return {
    studentId,
    ruleVersionId: rule.id,
    ruleTitle: rule.title,
    severity,
    exceedsDailyWarning,
    exceedsDailyMax,
    exceedsWeeklyWarning,
    exceedsWeeklyMax,
    exceedsContinuousThreshold,
    insufficientPlannedBreaks,
    requiresStaffReview,
    proposedMinutesTotal,
    peakDailyCombinedMinutes,
    peakWeeklyCombinedMinutes,
    peakContinuousMinutes,
    supportiveTitle,
    supportiveMessage,
    educationalGuidelineNotice: rule.educationalStandardNote,
    exceededRules,
    balancedSuggestions: balancedSuggestions.slice(0, 7),
    dailyProjections,
  };
}
