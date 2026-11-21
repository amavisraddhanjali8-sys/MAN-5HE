import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRingGeometry,
  evaluateExamTimerState,
  formatExamClock,
  getUrgentThresholdSeconds,
} from './examTimer.ts';

describe('examTimer pure logic', () => {
  it('formats countdown clocks cleanly with zero-padded MM:SS', () => {
    assert.equal(formatExamClock(600), '10:00');
    assert.equal(formatExamClock(65), '01:05');
    assert.equal(formatExamClock(0), '00:00');
    assert.equal(formatExamClock(-12), '00:00');
  });

  it('classifies normal, warning, and urgent states accurately for a 10-minute paper', () => {
    const normal = evaluateExamTimerState({
      secondsLeft: 540,
      timeLimitSeconds: 600,
      answeredCount: 2,
      totalQuestions: 10,
    });
    assert.equal(normal.urgencyLevel, 'normal');
    assert.equal(normal.isUrgent, false);
    assert.equal(normal.progressPercent, 90);
    assert.equal(normal.statusLabel, 'Time Left');
    assert.equal(normal.remainingQuestions, 8);
    assert.equal(normal.secondsPerRemainingQuestion, 68);

    const warning = evaluateExamTimerState({
      secondsLeft: 180,
      timeLimitSeconds: 600,
      answeredCount: 6,
      totalQuestions: 10,
    });
    assert.equal(warning.urgencyLevel, 'warning');
    assert.equal(warning.isUrgent, false);
    assert.equal(warning.progressPercent, 30);
    assert.equal(warning.statusLabel, 'Final Stretch · Pace Up');
    assert.equal(warning.secondsPerRemainingQuestion, 45);

    const urgent = evaluateExamTimerState({
      secondsLeft: 45,
      timeLimitSeconds: 600,
      answeredCount: 8,
      totalQuestions: 10,
    });
    assert.equal(urgent.urgencyLevel, 'urgent');
    assert.equal(urgent.isUrgent, true);
    assert.equal(urgent.progressPercent, 8);
    assert.equal(urgent.statusLabel, 'Urgent · Time Left');
    assert.equal(urgent.paceGuidance, '2 left · ~23s/question pace');
  });

  it('reports completion pacing when all questions are answered', () => {
    const done = evaluateExamTimerState({
      secondsLeft: 95,
      timeLimitSeconds: 600,
      answeredCount: 10,
      totalQuestions: 10,
    });
    assert.equal(done.remainingQuestions, 0);
    assert.equal(done.secondsPerRemainingQuestion, null);
    assert.equal(done.paceGuidance, 'All questions answered · Review or submit');
  });

  it('adapts urgent threshold safely for short practice sessions', () => {
    assert.equal(getUrgentThresholdSeconds(600), 60);
    assert.equal(getUrgentThresholdSeconds(80), 20);
  });

  it('calculates SVG circular ring circumference and dashoffset from remaining ratio', () => {
    const full = calculateRingGeometry(24, 1);
    assert.equal(full.circumference, 150.8);
    assert.equal(full.strokeDashoffset, 0);

    const half = calculateRingGeometry(24, 0.5);
    assert.equal(half.strokeDashoffset, 75.4);

    const empty = calculateRingGeometry(24, 0);
    assert.equal(empty.strokeDashoffset, 150.8);
  });
});
