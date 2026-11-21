import type {
  ParentTeachingGuidance,
  QuizItem,
  ScheduledSessionRecord,
  TimetableRecurrenceType,
} from './types.ts';

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getTimeZoneOffsetMs(dateUtc: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(dateUtc);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - dateUtc.getTime();
}

export function convertLocalDateTimeToUtcIso(
  dateStr: string,
  timeStr: string,
  timeZone = 'Asia/Colombo'
): string {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'Asia/Colombo';
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeStr || '').trim());
  if (!dateMatch || !timeMatch) {
    throw new Error('Invalid date (YYYY-MM-DD) or time (HH:MM) format.');
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] || '0');
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error('Date or time components are out of valid range.');
  }

  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = getTimeZoneOffsetMs(new Date(naiveUtcMs), safeTz);
  const candidate = naiveUtcMs - offset1;
  const offset2 = getTimeZoneOffsetMs(new Date(candidate), safeTz);
  const resolvedMs = naiveUtcMs - offset2;
  return new Date(resolvedMs).toISOString();
}

export function formatUtcInTimeZone(
  utcIso: string,
  timeZone = 'Asia/Colombo'
): { dateStr: string; timeStr: string; readable: string; timeZone: string } {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'Asia/Colombo';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) {
    return { dateStr: '', timeStr: '', readable: 'Invalid date', timeZone: safeTz };
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value;
  }
  const hour = m.hour === '24' ? '00' : m.hour;
  const dateStr = `${m.year}-${m.month}-${m.day}`;
  const timeStr = `${hour}:${m.minute}`;
  const readable = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return { dateStr, timeStr, readable, timeZone: safeTz };
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) throw new Error('Invalid date format YYYY-MM-DD.');
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function expandRecurrenceDates(params: {
  startDate: string;
  endDate?: string | null;
  recurrenceType: TimetableRecurrenceType;
  weekdays?: number[]; // 0 = Sun .. 6 = Sat
  exceptionDates?: string[];
  maxOccurrences?: number;
}): string[] {
  const maxOccurrences = Math.min(90, Math.max(1, params.maxOccurrences ?? 30));
  const exceptionSet = new Set((params.exceptionDates || []).map((d) => d.trim()));
  const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.startDate);
  if (!startMatch) throw new Error('Valid start date (YYYY-MM-DD) is required.');

  const defaultEnd =
    params.recurrenceType === 'one_time'
      ? params.startDate
      : addDaysToDateString(params.startDate, 28);
  const endDate = params.endDate && /^\d{4}-\d{2}-\d{2}$/.test(params.endDate)
    ? params.endDate
    : defaultEnd;

  if (endDate < params.startDate) {
    throw new Error('Schedule end date cannot be earlier than the start date.');
  }

  const weekdaySet = new Set(
    params.weekdays && params.weekdays.length > 0
      ? params.weekdays
      : [new Date(`${params.startDate}T00:00:00Z`).getUTCDay()]
  );

  const results: string[] = [];
  let cursor = params.startDate;
  let guard = 0;

  while (cursor <= endDate && results.length < maxOccurrences && guard < 180) {
    guard++;
    const dow = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    const skip = exceptionSet.has(cursor);

    let matches = false;
    if (params.recurrenceType === 'one_time') {
      matches = cursor === params.startDate;
    } else if (params.recurrenceType === 'daily') {
      matches = true;
    } else if (params.recurrenceType === 'weekdays') {
      matches = dow >= 1 && dow <= 5;
    } else if (params.recurrenceType === 'weekly' || params.recurrenceType === 'custom') {
      matches = weekdaySet.has(dow);
    }

    if (matches && !skip) {
      results.push(cursor);
    }

    if (params.recurrenceType === 'one_time') break;
    cursor = addDaysToDateString(cursor, 1);
  }

  return results;
}

export interface ScheduleConflict {
  conflictingSessionId: string;
  conflictingTitle: string;
  conflictingStartUtc: string;
  conflictingEndUtc: string;
  candidateStartUtc: string;
  candidateEndUtc: string;
  reason: string;
}

export function detectScheduleConflicts(
  existingSessions: Pick<
    ScheduledSessionRecord,
    'id' | 'title' | 'status' | 'scheduledStartUtc' | 'scheduledEndUtc'
  >[],
  candidates: { startUtc: string; endUtc: string; title?: string; ignoreSessionId?: string }[]
): ScheduleConflict[] {
  const activeExisting = existingSessions.filter(
    (s) => s.status !== 'CANCELLED' && s.status !== 'COMPLETED'
  );
  const conflicts: ScheduleConflict[] = [];

  for (const cand of candidates) {
    const cStart = Date.parse(cand.startUtc);
    const cEnd = Date.parse(cand.endUtc);
    if (Number.isNaN(cStart) || Number.isNaN(cEnd) || cEnd <= cStart) {
      conflicts.push({
        conflictingSessionId: 'invalid-window',
        conflictingTitle: cand.title || 'Candidate session',
        conflictingStartUtc: cand.startUtc,
        conflictingEndUtc: cand.endUtc,
        candidateStartUtc: cand.startUtc,
        candidateEndUtc: cand.endUtc,
        reason: 'Candidate session has an invalid start or end time.',
      });
      continue;
    }

    for (const ex of activeExisting) {
      if (cand.ignoreSessionId && ex.id === cand.ignoreSessionId) continue;
      const eStart = Date.parse(ex.scheduledStartUtc);
      const eEnd = Date.parse(ex.scheduledEndUtc);
      if (cStart < eEnd && cEnd > eStart) {
        conflicts.push({
          conflictingSessionId: ex.id,
          conflictingTitle: ex.title,
          conflictingStartUtc: ex.scheduledStartUtc,
          conflictingEndUtc: ex.scheduledEndUtc,
          candidateStartUtc: cand.startUtc,
          candidateEndUtc: cand.endUtc,
          reason: `Overlaps existing session "${ex.title}" (${ex.scheduledStartUtc} – ${ex.scheduledEndUtc}).`,
        });
      }
    }
  }

  return conflicts;
}

export function computeSessionCountdownState(
  session: Pick<
    ScheduledSessionRecord,
    'scheduledStartUtc' | 'scheduledEndUtc' | 'gracePeriodMinutes' | 'status'
  >,
  nowMs = Date.now()
): {
  phase: 'upcoming' | 'ready_now' | 'in_grace' | 'missed' | 'completed' | 'inactive';
  secondsUntilStart: number;
  secondsRemainingInWindow: number;
  countdownLabel: string;
} {
  if (session.status === 'COMPLETED') {
    return {
      phase: 'completed',
      secondsUntilStart: 0,
      secondsRemainingInWindow: 0,
      countdownLabel: 'Completed',
    };
  }
  if (session.status === 'CANCELLED' || session.status === 'PAUSED') {
    return {
      phase: 'inactive',
      secondsUntilStart: 0,
      secondsRemainingInWindow: 0,
      countdownLabel: session.status === 'PAUSED' ? 'Paused' : 'Cancelled',
    };
  }
  if (session.status === 'MISSED') {
    return {
      phase: 'missed',
      secondsUntilStart: 0,
      secondsRemainingInWindow: 0,
      countdownLabel: 'Missed window',
    };
  }

  const startMs = Date.parse(session.scheduledStartUtc);
  const endMs = Date.parse(session.scheduledEndUtc);
  const graceEndMs = endMs + Math.max(0, session.gracePeriodMinutes || 15) * 60_000;

  if (nowMs < startMs) {
    const diffSec = Math.max(0, Math.floor((startMs - nowMs) / 1000));
    const days = Math.floor(diffSec / 86400);
    const hrs = Math.floor((diffSec % 86400) / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    const secs = diffSec % 60;
    const label =
      days > 0
        ? `${days}d ${hrs}h ${mins}m`
        : hrs > 0
        ? `${hrs}h ${mins}m ${secs}s`
        : `${mins}m ${secs}s`;
    return {
      phase: 'upcoming',
      secondsUntilStart: diffSec,
      secondsRemainingInWindow: Math.floor((graceEndMs - nowMs) / 1000),
      countdownLabel: label,
    };
  }

  if (nowMs <= endMs) {
    return {
      phase: 'ready_now',
      secondsUntilStart: 0,
      secondsRemainingInWindow: Math.max(0, Math.floor((endMs - nowMs) / 1000)),
      countdownLabel: 'Available now',
    };
  }

  if (nowMs <= graceEndMs) {
    return {
      phase: 'in_grace',
      secondsUntilStart: 0,
      secondsRemainingInWindow: Math.max(0, Math.floor((graceEndMs - nowMs) / 1000)),
      countdownLabel: 'Late-start grace window',
    };
  }

  return {
    phase: 'missed',
    secondsUntilStart: 0,
    secondsRemainingInWindow: 0,
    countdownLabel: 'Missed window',
  };
}

export function buildStructuredTeachingGuide(params: {
  question: QuizItem;
  subjectName: string;
  topicName: string;
  submittedOptionIndex?: number | null;
  storedGuide?: Partial<ParentTeachingGuidance> | null;
}): ParentTeachingGuidance {
  const { question, subjectName, topicName, submittedOptionIndex, storedGuide } = params;
  if (storedGuide && storedGuide.whatItTests && storedGuide.teachingMethod) {
    return {
      questionId: question.id,
      learningObjective:
        storedGuide.learningObjective ||
        question.learningObjectives ||
        `Build fluency in ${topicName} (${subjectName})`,
      whatItTests: storedGuide.whatItTests,
      correctSolutionSteps: storedGuide.correctSolutionSteps || [question.explanation],
      plausibleErrorReasons: storedGuide.plausibleErrorReasons || [
        'Possibly misread a key number, word clue, or sequence step under time pressure.',
      ],
      teachingMethod: storedGuide.teachingMethod,
      practicalExamples: storedGuide.practicalExamples || [
        question.memoryTrickBody || 'Work through one smaller everyday example side by side first.',
      ],
      questionsToAskChild: storedGuide.questionsToAskChild || [
        'What clue in the question helped you decide your first step?',
        'Can we check the answer again using a second method?',
      ],
      commonMistakesToAvoid: storedGuide.commonMistakesToAvoid || [
        'Avoid rushing past keywords such as total, remaining, or pattern rules.',
      ],
      followupPracticeSuggestion:
        storedGuide.followupPracticeSuggestion ||
        `Try 3 short calm ${topicName} practice questions together before attempting another timed round.`,
      teacherHelpIndicators: storedGuide.teacherHelpIndicators || [
        'If your child remains unsure after two guided everyday examples, notify their subject teacher for tailored classroom support.',
      ],
      shortCorrectNote:
        storedGuide.shortCorrectNote ||
        `Great understanding shown on ${topicName}. Ask your child to briefly explain how they got the answer to lock in the concept.`,
      sourceType: storedGuide.sourceType || 'educator_approved',
      approvedByName: storedGuide.approvedByName || 'MAN 5HE Academic Team',
    };
  }

  const matchedMisconception =
    typeof submittedOptionIndex === 'number'
      ? question.misconceptions?.find((m) => m.optionIndex === submittedOptionIndex)
      : undefined;

  const learningObj =
    question.learningObjectives ||
    `Understand ${topicName} within ${subjectName} (${question.attributes.difficultyTier} level).`;

  const plausibleReasons: string[] = [];
  if (matchedMisconception) {
    plausibleReasons.push(`Possible slip: ${matchedMisconception.misconceptionLabel}.`);
  }
  plausibleReasons.push(
    `Your child may have noticed one familiar clue in ${topicName} and picked an option quickly before checking every condition.`,
    'They may need a visual or hands-on example to connect the rule to real objects.'
  );

  return {
    questionId: question.id,
    learningObjective: learningObj,
    whatItTests: `Tests Grade 5 Scholarship ${subjectName} skills in ${topicName}: specifically whether the student can apply core reasoning carefully (${question.attributes.difficultyTier} level).`,
    correctSolutionSteps: [
      `Step 1: Read the question slowly together and highlight the key numbers or clues.`,
      `Step 2: Apply the concept explanation — ${question.explanation}`,
      `Step 3: Confirm why "${question.options[question.correctIndex]}" matches the requirement.`,
    ],
    plausibleErrorReasons: plausibleReasons,
    teachingMethod: matchedMisconception
      ? `${matchedMisconception.suggestedIntervention} Use a calm, step-by-step check without rushing.`
      : `Sit beside your child, read the prompt aloud once, and model the first step using "${question.memoryTrickTitle}". Let them complete the final step themselves.`,
    practicalExamples: [
      question.memoryTrickBody ||
        `Use everyday Sri Lankan household items (coins, pencils, fruit, or clock faces) to act out a simpler version of this ${topicName} problem.`,
      `Create a tiny warm-up example with smaller numbers first, then return to "${question.questionEn}".`,
    ],
    questionsToAskChild: [
      '"Which part of the question feels clear, and which word feels tricky?"',
      '"Can you show me how you got your answer step by step with your finger or on rough paper?"',
      '"If we plug the answer back into the question, does the story still make sense?"',
    ],
    commonMistakesToAvoid: [
      'Avoid repeating the same test immediately without discussing the concept calmly first.',
      'Remind your child to double-check units, keywords like NOT/remaining/altogether, and answer labels before tapping.',
    ],
    followupPracticeSuggestion: `Schedule a 10-minute gentle ${topicName} revision activity with 4–5 Foundation or Balanced questions later this week.`,
    teacherHelpIndicators: [
      `If your child misses 3 or more similar ${topicName} questions across separate days despite guided examples, ask the ${subjectName} teacher for a targeted mini-lesson.`,
    ],
    shortCorrectNote: `Well done! Ask your child to teach you their trick ("${question.memoryTrickTitle}") — explaining it back strengthens long-term memory.`,
    sourceType: 'structured_curriculum',
    approvedByName: 'MAN 5HE Curriculum Engine',
  };
}
