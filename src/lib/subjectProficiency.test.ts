import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_SUBJECT_AXES,
  evaluateSubjectProficiencyProfile,
} from './subjectProficiency.ts';
import type { AttemptRecord } from './types.ts';

describe('subjectProficiency radar & fallback-area analysis', () => {
  it('computes 6 Grade 5 core subject axes including Sinhala, Mathematics, and Tamil / English', () => {
    const attempts: AttemptRecord[] = [
      {
        id: 'A-2',
        userId: 'u1',
        paperId: 'P2',
        paperTitle: 'Mock 2',
        mode: 'timed_exam',
        paperCategory: 'Balanced Standard',
        totalQuestions: 10,
        correctCount: 8,
        scorePercent: 80,
        timeLimitSeconds: 900,
        timeSpentSeconds: 600,
        starsEarned: 25,
        domainBreakdown: {
          'Sinhala Language & Proverbs': { correct: 1, total: 2 },
          'Mathematics & Word Problems': { correct: 3, total: 3 },
          'English & Comprehension': { correct: 1, total: 2 },
          'Environmental Studies (පරිසරය)': { correct: 2, total: 2 },
          'Logical & Number Patterns': { correct: 1, total: 1 },
        },
        submittedAt: '2026-11-15T10:00:00.000Z',
      },
      {
        id: 'A-1',
        userId: 'u1',
        paperId: 'P1',
        paperTitle: 'Mock 1',
        mode: 'practice',
        paperCategory: 'Foundation Simple',
        totalQuestions: 6,
        correctCount: 4,
        scorePercent: 67,
        timeLimitSeconds: 0,
        timeSpentSeconds: 300,
        starsEarned: 12,
        domainBreakdown: {
          'Sinhala Language & Proverbs': { correct: 1, total: 3 }, // 33% -> later 50%, +17% delta
          'Spatial & Geometric IQ': { correct: 3, total: 3 },
        },
        submittedAt: '2026-11-12T10:00:00.000Z',
      },
    ];

    const profile = evaluateSubjectProficiencyProfile(attempts);
    assert.equal(profile.radarData.length, CORE_SUBJECT_AXES.length);

    const sinhala = profile.radarData.find((d) => d.subject === 'Sinhala')!;
    const math = profile.radarData.find((d) => d.subject === 'Mathematics')!;
    const tamilEnglish = profile.radarData.find((d) => d.subject === 'Tamil / English')!;

    assert.equal(sinhala.proficiency, 40); // 2/5 = 40%
    assert.equal(sinhala.deltaPercent, 17); // 50% - 33% = +17%
    assert.equal(sinhala.status, 'Fallback Area');

    assert.equal(math.proficiency, 100);
    assert.equal(math.status, 'Strong');

    assert.equal(tamilEnglish.proficiency, 50);
    assert.equal(tamilEnglish.status, 'Fallback Area');

    // Both Sinhala (40%) and Tamil / English (50%) must appear in fallbackAreas sorted lowest first
    assert.equal(profile.fallbackAreas.length, 2);
    assert.equal(profile.fallbackAreas[0].subject, 'Sinhala');
    assert.equal(profile.fallbackAreas[0].gapToTarget, 35);
    assert.equal(profile.fallbackAreas[1].subject, 'Tamil / English');
    assert.equal(profile.testedSubjectsCount, 6);
  });

  it('flags subjects whose proficiency dropped significantly even if above 70%', () => {
    const attempts: AttemptRecord[] = [
      {
        id: 'A-OLD',
        userId: 'u1',
        paperId: 'P1',
        paperTitle: 'Practice 1',
        mode: 'practice',
        paperCategory: 'Balanced Standard',
        totalQuestions: 4,
        correctCount: 4,
        scorePercent: 100,
        timeLimitSeconds: 0,
        timeSpentSeconds: 200,
        starsEarned: 12,
        domainBreakdown: {
          'Mathematics & Word Problems': { correct: 4, total: 4 }, // 100%
        },
        submittedAt: '2026-11-10T10:00:00.000Z',
      },
      {
        id: 'A-NEW',
        userId: 'u1',
        paperId: 'P2',
        paperTitle: 'Practice 2',
        mode: 'timed_exam',
        paperCategory: 'Balanced Standard',
        totalQuestions: 4,
        correctCount: 2,
        scorePercent: 50,
        timeLimitSeconds: 600,
        timeSpentSeconds: 400,
        starsEarned: 8,
        domainBreakdown: {
          'Mathematics & Word Problems': { correct: 2, total: 4 }, // 50% -> delta -50%
        },
        submittedAt: '2026-11-16T10:00:00.000Z',
      },
    ];

    const profile = evaluateSubjectProficiencyProfile(attempts);
    const math = profile.radarData.find((d) => d.subject === 'Mathematics')!;
    assert.equal(math.proficiency, 75);
    assert.equal(math.deltaPercent, -50);
    assert.equal(profile.fallbackAreas.length, 1);
    assert.equal(profile.fallbackAreas[0].subject, 'Mathematics');
  });
});
