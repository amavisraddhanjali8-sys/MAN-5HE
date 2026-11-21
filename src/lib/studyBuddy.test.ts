import test from 'node:test';
import assert from 'node:assert/strict';
import { generateVirtualQuizFromPool } from './psychometrics.ts';
import { buildStudyBuddyCoaching } from './studyBuddy.ts';

test('buildStudyBuddyCoaching produces encouraging simplified memory steps on wrong answer', () => {
  const quiz = generateVirtualQuizFromPool(1, 'Moderate');
  const wrongIdx = (quiz.correctIndex + 1) % 4;

  const wrongCoaching = buildStudyBuddyCoaching({
    quiz,
    selectedOption: wrongIdx,
    consecutiveWrongCount: 1,
    studentFirstName: 'Sayuri',
  });

  assert.equal(wrongCoaching.mood, 'wrong');
  assert.ok(wrongCoaching.headline.includes('Sayuri'));
  assert.ok(wrongCoaching.encouragement.length > 20);
  assert.ok(wrongCoaching.simpleSteps.length >= 2);
  assert.ok(wrongCoaching.correctAnswerLabel !== null);
  assert.ok(wrongCoaching.psychologyPrinciple.length > 5);
});

test('buildStudyBuddyCoaching celebrates correct answers and guides waiting state', () => {
  const quiz = generateVirtualQuizFromPool(2, 'Simple');

  const waiting = buildStudyBuddyCoaching({
    quiz,
    selectedOption: null,
    consecutiveWrongCount: 0,
    studentFirstName: 'Sayuri',
  });
  assert.equal(waiting.mood, 'waiting');
  assert.equal(waiting.correctAnswerLabel, null);

  const correct = buildStudyBuddyCoaching({
    quiz,
    selectedOption: quiz.correctIndex,
    consecutiveWrongCount: 0,
    studentFirstName: 'Sayuri',
  });
  assert.equal(correct.mood, 'correct');
  assert.ok(correct.headline.includes('Sayuri'));
  assert.ok(correct.correctAnswerLabel !== null);
});
