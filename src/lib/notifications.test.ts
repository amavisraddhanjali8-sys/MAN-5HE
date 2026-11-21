import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPasswordRecoveryEmailHtml,
  buildProgressEmailHtml,
  buildSecurityAlertEmailHtml,
  buildWhatsAppProgressMessage,
  buildWhatsAppRecoveryTemplatePayload,
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

  it('builds responsive recovery emails with escaping and redacted WhatsApp recovery logs', () => {
    const recHtml = buildPasswordRecoveryEmailHtml({
      recipientName: 'Sayuri <script>alert(1)</script>',
      purposeTitle: 'Password Recovery Verification',
      otpCode: '739104',
      expiresInMinutes: 5,
      userIdCode: 'M5-2026-001',
      supportEmail: 'support@man5he.lk',
    });
    assert.equal(recHtml.includes('<script>'), false);
    assert.ok(recHtml.includes('739104'));
    assert.ok(recHtml.includes('5 minutes'));
    assert.ok(recHtml.includes('support@man5he.lk'));

    const alertHtml = buildSecurityAlertEmailHtml({
      recipientName: 'Sayuri Perera',
      headline: 'Password Changed',
      summary: 'All other active sessions were signed out.',
      actionTimeIso: '2026-11-21T03:00:00.000Z',
    });
    assert.ok(alertHtml.includes('Password Changed'));

    const waPayload = buildWhatsAppRecoveryTemplatePayload({
      otpCode: '739104',
      expiresInMinutes: 5,
      maskedDestination: '+94******67',
    });
    assert.equal(waPayload.templateName, 'man5he_auth_otp_v1');
    assert.equal(waPayload.components[0]?.parameters[0]?.text, '739104');
    assert.equal(waPayload.redactedAuditSummary.includes('739104'), false);
  });
});
