import type { CognitiveDomain, QuizItem } from './types.ts';

export interface StudyBuddyCoaching {
  mood: 'waiting' | 'correct' | 'wrong';
  headline: string;
  headlineSi: string;
  encouragement: string;
  psychologyPrinciple: string;
  simplifiedTrickTitle: string;
  simpleSteps: string[];
  correctAnswerLabel: string | null;
}

const DOMAIN_PSYCHOLOGY_GUIDE: Record<
  CognitiveDomain,
  { principle: string; waitingTip: string; fallbackStep: string }
> = {
  'Logical & Number Patterns': {
    principle: 'Chunking & Rhythm Recognition (රටා කණ්ඩායම් කිරීම)',
    waitingTip: 'Whisper the number jumps out loud like a beat before picking an option.',
    fallbackStep: 'Write the small jump (+ or ×) between the first two numbers first.',
  },
  'Mathematics & Word Problems': {
    principle: 'Mental Story Visualization (කතා රූපකරණය)',
    waitingTip: 'Picture the real objects (books, buses, rupees) in your mind for 3 seconds.',
    fallbackStep: 'Break the story into Step 1 (find one total) and Step 2 (compare or subtract).',
  },
  'Sinhala Language & Proverbs': {
    principle: 'Picture-Story Association (චිත්‍ර කතා මතක සබැඳිය)',
    waitingTip: 'Imagine a funny cartoon scene for the Sinhala phrase to lock its meaning.',
    fallbackStep: 'Link the key Sinhala word to a vivid picture so your brain recalls it instantly.',
  },
  'Spatial & Geometric IQ': {
    principle: 'Visual Path Tracing (රූප මාර්ග අනුගමනය)',
    waitingTip: 'Trace every corner or wall with your finger in the air before calculating.',
    fallbackStep: 'Count all sides around the shape one by one so no side is missed or doubled.',
  },
  'Environmental Studies (පරිසරය)': {
    principle: 'Sensory Peg Mnemonic (සොබාදහම් සලකුණු මතකය)',
    waitingTip: 'Connect the fact to a color, place, or living thing you have seen in Sri Lanka.',
    fallbackStep: 'Pin the key word to a vivid color or landmark image in your mind.',
  },
  'English & Comprehension': {
    principle: 'Rhyme & Sound Echo (ශබ්ද රිද්ම මතකය)',
    waitingTip: 'Say the full sentence softly in your head to hear which word sounds natural.',
    fallbackStep: 'Read the sentence with the word filled in and listen for the natural rhythm.',
  },
};

function simplifyTrickSentences(memoryTrickBody: string): string[] {
  const cleaned = memoryTrickBody
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = cleaned
    .split(/(?<=[.!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4);

  if (sentences.length === 0) {
    return ['Picture the trick step by step before answering similar questions.'];
  }
  return sentences.slice(0, 2);
}

export function buildStudyBuddyCoaching(params: {
  quiz: QuizItem;
  selectedOption: number | null;
  consecutiveWrongCount: number;
  studentFirstName: string;
}): StudyBuddyCoaching {
  const { quiz, selectedOption, consecutiveWrongCount, studentFirstName } = params;
  const firstName = (studentFirstName || 'Scholar').trim() || 'Scholar';
  const guide = DOMAIN_PSYCHOLOGY_GUIDE[quiz.attributes.cognitiveDomain] || {
    principle: 'Active Memory Cueing',
    waitingTip: 'Read carefully and look for the strongest clue first.',
    fallbackStep: 'Compare each option against the key clue in the question.',
  };

  const letters = ['A', 'B', 'C', 'D'];
  const correctOpt = quiz.options[quiz.correctIndex] ?? '';
  const correctAnswerLabel = `${letters[quiz.correctIndex] ?? 'A'}) ${correctOpt}`;

  if (selectedOption === null) {
    return {
      mood: 'waiting',
      headline: `You've got this, ${firstName}!`,
      headlineSi: 'ඔබට පුළුවන්! සන්සුන්ව පිළිතුර තෝරන්න',
      encouragement: guide.waitingTip,
      psychologyPrinciple: guide.principle,
      simplifiedTrickTitle: quiz.memoryTrickTitle,
      simpleSteps: [guide.fallbackStep],
      correctAnswerLabel: null,
    };
  }

  if (selectedOption === quiz.correctIndex) {
    return {
      mood: 'correct',
      headline: `Spot on, ${firstName}!`,
      headlineSi: 'අති විශිෂ්ටයි! නිවැරදි පිළිතුරයි',
      encouragement: `Great focus! Locking in "${quiz.memoryTrickTitle}" makes this pattern effortless in the exam hall.`,
      psychologyPrinciple: guide.principle,
      simplifiedTrickTitle: quiz.memoryTrickTitle,
      simpleSteps: simplifyTrickSentences(quiz.memoryTrickBody),
      correctAnswerLabel,
    };
  }

  const encouragementPool = [
    `Good try, ${firstName}! Every mistake teaches your brain a stronger shortcut for exam day.`,
    `No worries at all, ${firstName}! Even Island Rank toppers miss practice questions while building memory hooks.`,
    `Pause and smile, ${firstName} — you just discovered a tricky Grade 5 question before the real exam!`,
  ];
  const encouragement =
    encouragementPool[Math.max(0, consecutiveWrongCount - 1) % encouragementPool.length];

  const trickSteps = simplifyTrickSentences(quiz.memoryTrickBody);
  const simpleSteps = [
    ...trickSteps,
    `Remember for next time: ${quiz.explanation}`,
  ];

  return {
    mood: 'wrong',
    headline: `Almost there, ${firstName} — let's lock this trick in!`,
    headlineSi: 'කලබල වෙන්න එපා — අපි මතක උපක්‍රමය සරලව බලමු',
    encouragement,
    psychologyPrinciple: guide.principle,
    simplifiedTrickTitle: quiz.memoryTrickTitle,
    simpleSteps,
    correctAnswerLabel,
  };
}
