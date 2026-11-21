import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COGNITIVE_DOMAINS } from './psychometrics.ts';
import {
  GRADE5_MNEMONIC_FLASHCARDS,
  MNEMONIC_STRATEGIES,
  evaluateFlashcardDeckProgress,
  filterFlashcards,
  shuffleFlashcards,
} from './flashcards.ts';

describe('Grade 5 mnemonic flashcards pure logic', () => {
  it('covers all 6 cognitive domains and all 4 mnemonic strategies', () => {
    const coveredDomains = new Set(GRADE5_MNEMONIC_FLASHCARDS.map((c) => c.domain));
    const coveredStrategies = new Set(GRADE5_MNEMONIC_FLASHCARDS.map((c) => c.strategy));

    for (const domain of COGNITIVE_DOMAINS) {
      assert.equal(coveredDomains.has(domain), true, `Missing domain: ${domain}`);
    }
    for (const strategy of MNEMONIC_STRATEGIES) {
      assert.equal(coveredStrategies.has(strategy), true, `Missing strategy: ${strategy}`);
    }
  });

  it('filters cards cleanly by cognitive domain and mnemonic strategy', () => {
    const rhymingCards = filterFlashcards(GRADE5_MNEMONIC_FLASHCARDS, {
      domain: 'All',
      strategy: 'Rhyming',
    });
    assert.ok(rhymingCards.length >= 2);
    assert.ok(rhymingCards.every((c) => c.strategy === 'Rhyming'));

    const envVisual = filterFlashcards(GRADE5_MNEMONIC_FLASHCARDS, {
      domain: 'Environmental Studies (පරිසරය)',
      strategy: 'Visualization',
    });
    assert.equal(envVisual.length, 1);
    assert.equal(envVisual[0].id, 'FC-09');
  });

  it('shuffles flashcards deterministically without dropping or duplicating items', () => {
    const shuffledA = shuffleFlashcards(GRADE5_MNEMONIC_FLASHCARDS, 4242);
    const shuffledB = shuffleFlashcards(GRADE5_MNEMONIC_FLASHCARDS, 4242);
    assert.equal(shuffledA.length, GRADE5_MNEMONIC_FLASHCARDS.length);
    assert.deepEqual(
      shuffledA.map((c) => c.id),
      shuffledB.map((c) => c.id)
    );
    assert.deepEqual(
      new Set(shuffledA.map((c) => c.id)),
      new Set(GRADE5_MNEMONIC_FLASHCARDS.map((c) => c.id))
    );
  });

  it('evaluates mastery progress and builds the due-review queue accurately', () => {
    const sample = GRADE5_MNEMONIC_FLASHCARDS.slice(0, 4);
    const progress = evaluateFlashcardDeckProgress(sample, {
      [sample[0].id]: 'mastered',
      [sample[1].id]: 'review',
      [sample[2].id]: 'mastered',
    });

    assert.equal(progress.totalCount, 4);
    assert.equal(progress.masteredCount, 2);
    assert.equal(progress.reviewCount, 1);
    assert.equal(progress.unseenCount, 1);
    assert.equal(progress.masteryPercent, 50);
    assert.deepEqual(progress.dueReviewIds, [sample[1].id]);
  });
});
