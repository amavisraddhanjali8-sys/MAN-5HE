import type {
  AcademicConfig,
  InterventionCase,
  InterventionStatus,
  InterventionTemplate,
} from './types.ts';

export const DEFAULT_ACADEMIC_CONFIG: AcademicConfig = {
  repeatedErrorThreshold: 3,
  notificationCooldownMinutes: 30,
  alertGroupingWindowMinutes: 15,
  sustainedCorrectRequiredForReview: 2,
  autoNotifyAdminsOnEscalation: true,
  requireTeacherReviewBeforeClose: true,
  updatedAt: '2026-11-01T00:00:00.000Z',
  updatedBy: 'system',
};

export const INTERVENTION_TEMPLATES: InterventionTemplate[] = [
  {
    id: 'tpl-prereq-recap',
    title: 'Prerequisite Concept Recap & Visual Walk-Through',
    subjectId: 'all',
    misconceptionFocus: 'Missing foundational step or unit conversion mix-up',
    instructionTemplate:
      'Let us revisit the foundational building block gently before tackling full word problems. Read the memory trick step-by-step and solve 5 simple warm-up questions.',
    recommendedPracticeMinutes: 10,
  },
  {
    id: 'tpl-math-shopkeeper',
    title: 'Word Problem Two-Step Breakdown (Shopkeeper Method)',
    subjectId: 'subj-math',
    misconceptionFocus: 'Subtracting before computing multi-item total or inverse operation error',
    instructionTemplate:
      'Circle the quantities first, compute the total bill in Step 1, then count upward from the bill to the paid amount in Step 2.',
    recommendedPracticeMinutes: 12,
  },
  {
    id: 'tpl-pattern-froghop',
    title: 'Number Pattern Hop-Arrow Diagramming',
    subjectId: 'subj-logic',
    misconceptionFocus: 'Assuming constant difference on growing or alternating sequences',
    instructionTemplate:
      'Draw curved arrows underneath each adjacent pair (+d1, +d2, +d3) or connect 1st -> 3rd -> 5th items on top when numbers alternate.',
    recommendedPracticeMinutes: 10,
  },
  {
    id: 'tpl-sinhala-particle',
    title: 'Sinhala Grammar Particle (නිපාත පද) Bridge Practice',
    subjectId: 'subj-sinhala',
    misconceptionFocus: 'Confusing connecting particles with nouns or adjectives',
    instructionTemplate:
      'Test whether the word changes with singular/plural nouns. Indeclinable glue words like හෙයින්, නිසා, නමුත් are නිපාත පද.',
    recommendedPracticeMinutes: 10,
  },
  {
    id: 'tpl-spatial-fence',
    title: 'Perimeter vs Area Visual Fence Sketch',
    subjectId: 'subj-spatial',
    misconceptionFocus: 'Multiplying sides instead of walking around the outer boundary',
    instructionTemplate:
      'Trace the outer border of the shape with your pencil like an ant walking all 4 sides before adding lengths together.',
    recommendedPracticeMinutes: 8,
  },
];

export const ACTIVE_CASE_STATUSES: InterventionStatus[] = [
  'OPEN',
  'UNDER_REVIEW',
  'INTERVENTION_ASSIGNED',
  'MONITORING',
];

export function isActiveInterventionStatus(status: InterventionStatus): boolean {
  return ACTIVE_CASE_STATUSES.includes(status);
}

const ALLOWED_TRANSITIONS: Record<InterventionStatus, InterventionStatus[]> = {
  OPEN: ['UNDER_REVIEW', 'INTERVENTION_ASSIGNED', 'DISMISSED'],
  UNDER_REVIEW: ['INTERVENTION_ASSIGNED', 'MONITORING', 'DISMISSED', 'OPEN'],
  INTERVENTION_ASSIGNED: ['MONITORING', 'RESOLVED', 'DISMISSED', 'UNDER_REVIEW'],
  MONITORING: ['RESOLVED', 'OPEN', 'INTERVENTION_ASSIGNED', 'DISMISSED'],
  RESOLVED: ['OPEN'],
  DISMISSED: ['OPEN'],
};

export function validateCaseTransition(
  fromStatus: InterventionStatus,
  toStatus: InterventionStatus
): { ok: boolean; reason?: string } {
  if (fromStatus === toStatus) {
    return { ok: true };
  }
  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    return {
      ok: false,
      reason: `Cannot transition intervention case directly from ${fromStatus} to ${toStatus}.`,
    };
  }
  return { ok: true };
}

export interface EvaluateWrongAttemptResult {
  action: 'none' | 'create_case' | 'update_active_case' | 'reopen_case';
  existingCaseId?: string;
  shouldDispatchAlert: boolean;
  alertReason: string;
}

export function evaluateWrongAttemptForCase(params: {
  incorrectCount: number;
  existingCasesForStudentQuestion: InterventionCase[];
  config: AcademicConfig;
  nowMs: number;
}): EvaluateWrongAttemptResult {
  const { incorrectCount, existingCasesForStudentQuestion, config, nowMs } = params;
  const threshold = Math.max(1, config.repeatedErrorThreshold);

  const activeCase = existingCasesForStudentQuestion.find((c) =>
    isActiveInterventionStatus(c.status)
  );

  if (activeCase) {
    const cooldownMs = Math.max(0, config.notificationCooldownMinutes) * 60_000;
    const lastAlertMs = activeCase.lastAlertSentAt
      ? Date.parse(activeCase.lastAlertSentAt)
      : 0;
    const withinCooldown = lastAlertMs > 0 && nowMs - lastAlertMs < cooldownMs;

    return {
      action: 'update_active_case',
      existingCaseId: activeCase.id,
      shouldDispatchAlert: !withinCooldown && incorrectCount >= threshold,
      alertReason: withinCooldown
        ? 'Alert suppressed by cooldown window to avoid notification fatigue.'
        : 'Updated active repeated-error case; cooldown elapsed.',
    };
  }

  if (incorrectCount < threshold) {
    return {
      action: 'none',
      shouldDispatchAlert: false,
      alertReason: `Incorrect count (${incorrectCount}) is below configured threshold (${threshold}).`,
    };
  }

  // Check if previously resolved/dismissed case exists -> reopen rather than creating duplicate orphan
  const closedCase = existingCasesForStudentQuestion.find(
    (c) => c.status === 'RESOLVED' || c.status === 'DISMISSED'
  );
  if (closedCase) {
    return {
      action: 'reopen_case',
      existingCaseId: closedCase.id,
      shouldDispatchAlert: true,
      alertReason: 'Previously resolved/dismissed case reopened due to recurring errors.',
    };
  }

  return {
    action: 'create_case',
    shouldDispatchAlert: true,
    alertReason: `Student reached repeated-error threshold (${incorrectCount}/${threshold}).`,
  };
}

export interface EvaluateCorrectFollowUpResult {
  autoClosed: false; // Strictly never auto-closes on a single correct answer
  nextStatus: InterventionStatus;
  nextConsecutiveCorrect: number;
  readyForTeacherReview: boolean;
  actionNote: string;
}

export function evaluateCorrectFollowUpForCase(params: {
  activeCase: InterventionCase;
  config: AcademicConfig;
}): EvaluateCorrectFollowUpResult {
  const { activeCase, config } = params;
  const nextConsecutive = activeCase.consecutiveCorrectAfterCase + 1;
  const required = Math.max(2, config.sustainedCorrectRequiredForReview);
  const reachedSustained = nextConsecutive >= required;

  let nextStatus = activeCase.status;
  if (activeCase.status === 'INTERVENTION_ASSIGNED') {
    nextStatus = 'MONITORING';
  }

  return {
    autoClosed: false,
    nextStatus,
    nextConsecutiveCorrect: nextConsecutive,
    readyForTeacherReview: reachedSustained,
    actionNote: reachedSustained
      ? `Student completed ${nextConsecutive} consecutive correct follow-up attempts; flagged for teacher resolution review.`
      : `Recorded correct follow-up attempt (${nextConsecutive}/${required} toward sustained review threshold). Case remains open for monitoring.`,
  };
}
