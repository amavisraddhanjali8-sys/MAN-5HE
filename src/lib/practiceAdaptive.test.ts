import test from 'node:test';
import assert from 'node:assert/strict';
import { generateVirtualQuizFromPool } from './psychometrics.ts';
import {
  filterQuestionStreamByProficiency,
  resolvePracticeStreamConfig,
} from './practiceAdaptive.ts';

test('resolvePracticeStreamConfig adapts Easy/Medium/Hard tiers to student trajectory proficiency', () => {
  const foundationEasy = resolvePracticeStreamConfig({
    levelMode: 'Easy',
    proficiencyLevel: 'Foundation Simple',
  });
  assert.deepEqual(foundationEasy.allowedTiers, ['Simple']);
  assert.equal(foundationEasy.targetTier, 'Simple');

  const foundationHard = resolvePracticeStreamConfig({
    levelMode: 'Hard',
    proficiencyLevel: 'Foundation Simple',
  });
  assert.deepEqual(foundationHard.allowedTiers, ['Moderate', 'Challenging']);

  const masterEasy = resolvePracticeStreamConfig({
    levelMode: 'Easy',
    proficiencyLevel: 'Scholarship Master',
  });
  assert.deepEqual(masterEasy.allowedTiers, ['Moderate']);

  const masterHard = resolvePracticeStreamConfig({
    levelMode: 'Hard',
    proficiencyLevel: 'Scholarship Master',
  });
  assert.deepEqual(masterHard.allowedTiers, ['Master']);
});

test('filterQuestionStreamByProficiency filters incoming mixed quizzes by trajectory level and toggle', () => {
  const mixed = [
    generateVirtualQuizFromPool(1, 'Simple'),
    generateVirtualQuizFromPool(2, 'Moderate'),
    generateVirtualQuizFromPool(3, 'Challenging'),
    generateVirtualQuizFromPool(4, 'Master'),
  ];

  const balancedMedium = filterQuestionStreamByProficiency(mixed, {
    levelMode: 'Medium',
    trajectory: { currentLevel: 'Balanced Standard' },
  });
  assert.equal(balancedMedium.filtered.length, 1);
  assert.equal(balancedMedium.filtered[0].attributes.difficultyTier, 'Moderate');

  const balancedHard = filterQuestionStreamByProficiency(mixed, {
    levelMode: 'Hard',
    trajectory: { currentLevel: 'Balanced Standard' },
  });
  assert.deepEqual(
    balancedHard.filtered.map((q) => q.attributes.difficultyTier),
    ['Challenging', 'Master']
  );

  const foundationEasy = filterQuestionStreamByProficiency(mixed, {
    levelMode: 'Easy',
    trajectory: { currentLevel: 'Foundation Simple' },
  });
  assert.deepEqual(
    foundationEasy.filtered.map((q) => q.attributes.difficultyTier),
    ['Simple']
  );
});
