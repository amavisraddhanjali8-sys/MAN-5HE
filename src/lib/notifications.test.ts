import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProgressEmailHtml,
  buildWhatsAppProgressMessage,
} from './notifications.ts';
import type { AttemptRecord, StudentTrajectory } from './types.ts';

const sampleTrajectory: StudentTrajectory = {
  currentLevel: 'Balanced Standard',
  recommendedNextLevel: 'Balanced Standard',
  scholarshipReadinessPercent: 78,
  improvementDeltaPercent: 5.5,
  totalStars: 165,
  studyMinutesWeek: 110,
  badgesCount: 6,
  weakDomains: [
    { domain: 'Sinhala Language & Proverbs', accuracyPercent: 55 },
  ],
  dailyStudySeries: [],
  recommendationNote: 'Focus on Sinhala proverbs to cross 80% readiness.',
};

describe('automated practice & mock paper notifications', () => {
  it('builds both branded HTML email and WhatsApp alert for practice rounds', () => {
    const practiceAttempt: AttemptRecord = {
      id: 'ATT-PRAC-1',
      userId: 'u1',
      paperId: 'PRACTICE-500K',
      paperTitle: '500K+ Shuffled Practice Round',
      mode: 'practice',
      paperCategory: 'Balanced Standard',
      totalQuestions: 8,
      correctCount: 6,
      scorePercent: 75,
      timeLimitSeconds: 0,
      timeSpentSeconds: 210,
      starsEarned: 18,
      domainBreakdown: {},
      submittedAt: '2026-11-18T10:00:00.000Z',
    };

    const emailHtml = buildProgressEmailHtml({
      studentName: 'Sayuri Perera',
      attempt: practiceAttempt,
      trajectory: sampleTrajectory,
    });
    const waText = buildWhatsAppProgressMessage({
      studentName: 'Sayuri Perera',
      attempt: practiceAttempt,
      trajectory: sampleTrajectory,
    });

    assert.ok(emailHtml.includes('500K+ Shuffled Practice Round'));
    assert.ok(emailHtml.includes('75%'));
    assert.ok(emailHtml.includes('Sinhala Language & Proverbs'));
    assert.ok(waText.includes('Practice Round'));
    assert.ok(waText.includes('6/8 (75%)'));
    assert.ok(waText.includes('Focus Area: Sinhala Language & Proverbs (55%)'));
  });

  it('builds both branded HTML email and WhatsApp alert for timed mock papers', () => {
    const mockAttempt: AttemptRecord = {
      id: 'ATT-MOCK-1',
      userId: 'u1',
      paperId: 'PAPER-001',
      paperTitle: 'Foundation Starter · Mock Paper 01',
      mode: 'timed_exam',
      paperCategory: 'Foundation Simple',
      totalQuestions: 8,
      correctCount: 7,
      scorePercent: 88,
      timeLimitSeconds: 600,
      timeSpentSeconds: 450,
      starsEarned: 38,
      domainBreakdown: {},
      submittedAt: '2026-11-18T10:15:00.000Z',
    };

    const emailHtml = buildProgressEmailHtml({
      studentName: 'Sayuri Perera',
      attempt: mockAttempt,
      trajectory: sampleTrajectory,
    });
    const waText = buildWhatsAppProgressMessage({
      studentName: 'Sayuri Perera',
      attempt: mockAttempt,
      trajectory: sampleTrajectory,
    });

    assert.ok(emailHtml.includes('Foundation Starter · Mock Paper 01'));
    assert.ok(emailHtml.includes('88%'));
    assert.ok(waText.includes('Timed Exam'));
    assert.ok(waText.includes('7/8 (88%)'));
  });
});
