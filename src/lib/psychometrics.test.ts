import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOTAL_VIRTUAL_POOL_SIZE,
  calculatePaperQualityAndDifficulty,
  calculateQuizDifficultyScore,
  evaluateStudentTrajectory,
  generateVirtualQuizFromPool,
  seededShuffle,
} from './psychometrics.ts';
import type { AttemptRecord, QuizItem } from './types.ts';

test('500,000+ quiz pool generates valid deterministic bilingual Grade 5 items', () => {
  assert.equal(TOTAL_VIRTUAL_POOL_SIZE, 500_000);
  const q1 = generateVirtualQuizFromPool(1);
  const q500k = generateVirtualQuizFromPool(500_000);
  assert.equal(q1.id, 'POOL-000001');
  assert.equal(q500k.id, 'POOL-500000');
  assert.equal(q1.options.length, 4);
  assert.ok(q1.memoryTrickBody.length > 15);
  assert.ok(q500k.attributes.correctProbability + q500k.attributes.wrongProbability <= 1.01);
});

test('seededShuffle produces deterministic permutation without dropping elements', () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const s1 = seededShuffle(arr, 42);
  const s2 = seededShuffle(arr, 42);
  assert.deepEqual(s1, s2);
  assert.deepEqual([...s1].sort((a, b) => a - b), arr);
});

test('calculatePaperQualityAndDifficulty distinguishes Simple vs Master papers', () => {
  const simpleQuizzes: QuizItem[] = [1, 2, 3, 4, 5, 6].map((i) =>
    generateVirtualQuizFromPool(i, 'Simple')
  );
  const masterQuizzes: QuizItem[] = [1, 2, 3, 4, 5, 6].map((i) =>
    generateVirtualQuizFromPool(i + 100, 'Master')
  );

  const simpleSummary = calculatePaperQualityAndDifficulty(simpleQuizzes);
  const masterSummary = calculatePaperQualityAndDifficulty(masterQuizzes);

  assert.ok(simpleSummary.averageDifficulty < masterSummary.averageDifficulty);
  assert.equal(simpleSummary.categoryLevel, 'Foundation Simple');
  assert.equal(masterSummary.categoryLevel, 'Scholarship Master');
  assert.ok(masterSummary.qualityIndex >= 50 && masterSummary.qualityIndex <= 99);
});

test('calculateQuizDifficultyScore increases when wrongProbability & intelligenceMeasure rise', () => {
  const easy = calculateQuizDifficultyScore({
    intelligenceMeasure: 25,
    correctProbability: 0.85,
    wrongProbability: 0.15,
    examPriority: 4,
    quizStrength: 45,
    difficultyTier: 'Simple',
    cognitiveDomain: 'Logical & Number Patterns',
    estimatedSeconds: 30,
  });
  const hard = calculateQuizDifficultyScore({
    intelligenceMeasure: 90,
    correctProbability: 0.2,
    wrongProbability: 0.8,
    examPriority: 9,
    quizStrength: 92,
    difficultyTier: 'Master',
    cognitiveDomain: 'Logical & Number Patterns',
    estimatedSeconds: 90,
  });
  assert.ok(hard > easy + 30);
});

test('evaluateStudentTrajectory recommends advancing when recent average >= 80%', () => {
  const attempts: AttemptRecord[] = [
    {
      id: 'a1',
      userId: 'u1',
      paperId: 'p1',
      paperTitle: 'Paper 1',
      mode: 'timed_exam',
      paperCategory: 'Balanced Standard',
      totalQuestions: 10,
      correctCount: 9,
      scorePercent: 90,
      timeLimitSeconds: 900,
      timeSpentSeconds: 700,
      starsEarned: 25,
      domainBreakdown: {
        'Logical & Number Patterns': { correct: 5, total: 5 },
        'Mathematics & Word Problems': { correct: 4, total: 5 },
      },
      submittedAt: '2026-11-16T10:00:00Z',
    },
    {
      id: 'a2',
      userId: 'u1',
      paperId: 'p2',
      paperTitle: 'Paper 2',
      mode: 'timed_exam',
      paperCategory: 'Balanced Standard',
      totalQuestions: 10,
      correctCount: 8,
      scorePercent: 80,
      timeLimitSeconds: 900,
      timeSpentSeconds: 750,
      starsEarned: 20,
      domainBreakdown: {
        'Logical & Number Patterns': { correct: 4, total: 5 },
        'Mathematics & Word Problems': { correct: 4, total: 5 },
      },
      submittedAt: '2026-11-15T10:00:00Z',
    },
  ];

  const traj = evaluateStudentTrajectory(attempts, 'Balanced Standard');
  assert.equal(traj.recommendedNextLevel, 'Advanced Challenging');
  assert.ok(traj.scholarshipReadinessPercent >= 70);
  assert.equal(traj.totalStars, 45);
});
