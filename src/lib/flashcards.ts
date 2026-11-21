import { seededShuffle } from './psychometrics.ts';
import type { CognitiveDomain } from './types.ts';

export type MnemonicStrategy =
  | 'Rhyming'
  | 'Visualization'
  | 'Story Hook'
  | 'Chunking & Pegs';

export type FlashcardDifficulty =
  | 'Core Concept'
  | 'Exam Tricky'
  | 'Island Rank Booster';

export type FlashcardConfidence = 'mastered' | 'review';

export interface MnemonicFlashcard {
  id: string;
  domain: CognitiveDomain;
  strategy: MnemonicStrategy;
  difficulty: FlashcardDifficulty;
  conceptSi: string;
  conceptEn: string;
  promptQuestion: string;
  coreRule: string;
  mnemonicTitle: string;
  mnemonicHook: string;
  visualCueSteps: [string, string, string];
  recallCheckPrompt: string;
}

export interface FlashcardDeckProgress {
  totalCount: number;
  masteredCount: number;
  reviewCount: number;
  unseenCount: number;
  masteryPercent: number;
  dueReviewIds: string[];
}

export const MNEMONIC_STRATEGIES: MnemonicStrategy[] = [
  'Rhyming',
  'Visualization',
  'Story Hook',
  'Chunking & Pegs',
];

export const STRATEGY_SCIENCE_NOTES: Record<
  MnemonicStrategy,
  { tagline: string; childTip: string }
> = {
  Rhyming: {
    tagline: 'Auditory Rhythm & Echo Lock',
    childTip:
      'Say the rhyme out loud twice in a bouncy beat — musical rhythm sticks in Grade 5 memory 3x longer.',
  },
  Visualization: {
    tagline: 'Mental Picture Snapshot',
    childTip:
      'Close your eyes for 3 seconds and paint the cartoon picture in bright colors so your brain finds it fast.',
  },
  'Story Hook': {
    tagline: 'Episodic Mini-Story Linking',
    childTip:
      'Connect dry rules to people, animals, or funny surprises — brains remember stories much better than plain formulas.',
  },
  'Chunking & Pegs': {
    tagline: 'Pattern Grouping & Anchor Pegs',
    childTip:
      'Group big messy steps into 2–3 tiny chunks or simple peg words so you never drop a step under exam pressure.',
  },
};

export const GRADE5_MNEMONIC_FLASHCARDS: MnemonicFlashcard[] = [
  {
    id: 'FC-01',
    domain: 'Spatial & Geometric IQ',
    strategy: 'Rhyming',
    difficulty: 'Core Concept',
    conceptSi: 'පරිමිතිය සහ වර්ගඵලය වෙනස',
    conceptEn: 'Perimeter vs. Area (Rectangles & Squares)',
    promptQuestion:
      'How do you remember which formula walks the outer border and which fills the inside?',
    coreRule: 'Perimeter = 2 × (Length + Width) · Area = Length × Width',
    mnemonicTitle: 'Fence Rhyme Chant',
    mnemonicHook:
      '"Walk the fence, add all four sides tight; Area paints the grass inside — multiply Length by Width right!"',
    visualCueSteps: [
      'Trace the outside fence with your finger: Long + Short, then double it.',
      'For squares, 4 equal fence walls = Side × 4.',
      'Remember Area fills tiles INSIDE = Length × Width (sq cm).',
    ],
    recallCheckPrompt:
      'Quick check: A 6 cm × 4 cm garden needs a fence. Which formula gives the fence length?',
  },
  {
    id: 'FC-02',
    domain: 'Spatial & Geometric IQ',
    strategy: 'Visualization',
    difficulty: 'Exam Tricky',
    conceptSi: 'දර්පණ ඔරලෝසු කාලය (Mirror Clock)',
    conceptEn: 'Reading a Clock in a Vertical Mirror',
    promptQuestion:
      'A clock shows 3:20. What visual trick immediately reveals the mirror image time?',
    coreRule: 'Subtract the clock time from 11:60 (which equals 12:00).',
    mnemonicTitle: '12-O’Clock Mirror Laser',
    mnemonicHook:
      'Picture a glowing laser line straight through 12 and 6 splitting the clock into twin halves. Whatever leans right flips left — subtract from 11:60!',
    visualCueSteps: [
      'Write 11 : 60 on top (never 12 : 00 when minutes exist!).',
      'Subtract hours from 11 (11 − 3 = 8) and minutes from 60 (60 − 20 = 40).',
      'Spot-check visually: 3 leans right, so its mirror twin 8 leans left (8:40).',
    ],
    recallCheckPrompt: 'Quick check: What does 9:15 look like in a vertical mirror?',
  },
  {
    id: 'FC-03',
    domain: 'Mathematics & Word Problems',
    strategy: 'Story Hook',
    difficulty: 'Exam Tricky',
    conceptSi: 'ගස් හා පරතර ගැටළු (Trees & Gaps)',
    conceptEn: 'Poles Along a Straight Road vs. Closed Ring',
    promptQuestion:
      'Why does a straight row of 10 lamp posts have 9 gaps, while a round pond has 10 gaps?',
    coreRule:
      'Open Straight Line: Posts = Gaps + 1 · Closed Circle: Posts = Gaps',
    mnemonicTitle: 'Hands-Joined Circle Story',
    mnemonicHook:
      'Imagine 5 friends standing in a straight line holding hands: there are only 4 handshakes between them. When the end friends curve around to shake hands in a circle, the 5th gap locks shut!',
    visualCueSteps: [
      'Straight road = Open ends → count gaps first, then +1 for end post.',
      'Round pond or square fence = Closed loop → Gaps equal Posts exactly.',
      'Always ask yourself first: "Is this a road or a ring?"',
    ],
    recallCheckPrompt:
      'Quick check: Trees planted every 5 m along a 30 m straight road need how many trees?',
  },
  {
    id: 'FC-04',
    domain: 'Mathematics & Word Problems',
    strategy: 'Chunking & Pegs',
    difficulty: 'Core Concept',
    conceptSi: 'දිග මැනීමේ ඒකක පරිවර්තනය',
    conceptEn: 'Metric Length Ladder (km → m → cm → mm)',
    promptQuestion:
      'How can you remember the exact zeros (1000, 100, 10) between km, m, cm, and mm?',
    coreRule: '1 km = 1,000 m · 1 m = 100 cm · 1 cm = 10 mm',
    mnemonicTitle: '3-2-1 Zero Stairs',
    mnemonicHook:
      'Picture stepping down giant stairs labeled "3 zeros, 2 zeros, 1 zero": km drops 1000 (3 zeros) to m, drops 100 (2 zeros) to cm, drops 10 (1 zero) to mm!',
    visualCueSteps: [
      'Big unit → Small unit: Multiply (add 3, 2, or 1 zeros).',
      'Small unit → Big unit: Divide (remove 1, 2, or 3 zeros).',
      'Check the 3-2-1 countdown: 1000 → 100 → 10.',
    ],
    recallCheckPrompt: 'Quick check: How many centimeters make 4.5 meters?',
  },
  {
    id: 'FC-05',
    domain: 'Logical & Number Patterns',
    strategy: 'Chunking & Pegs',
    difficulty: 'Island Rank Booster',
    conceptSi: 'දෙපැති අංක රටා (Alternating Series)',
    conceptEn: 'Hidden Two-Train Alternating Number Patterns',
    promptQuestion:
      'When numbers jump up and down (like 5, 2, 7, 4, 9, 6...), what grouping trick solves it?',
    coreRule:
      'Split alternating sequences into Odd Seats (1st, 3rd, 5th) and Even Seats (2nd, 4th, 6th).',
    mnemonicTitle: 'Two-Train Rainbow Bridge',
    mnemonicHook:
      'Draw rainbow arcs over the top connecting 1st → 3rd → 5th, and boat waves underneath connecting 2nd → 4th → 6th. Two calm trains replace one confusing jumble!',
    visualCueSteps: [
      'Spot the up-and-down wobble: a sign two patterns are braided together.',
      'Link odd positions on top (5 → 7 → 9: +2).',
      'Link even positions below (2 → 4 → 6: +2) to check which seat "?" sits in.',
    ],
    recallCheckPrompt:
      'Quick check: In 3, 10, 6, 12, 9, 14, ?, which train decides the "?" seat?',
  },
  {
    id: 'FC-06',
    domain: 'Logical & Number Patterns',
    strategy: 'Visualization',
    difficulty: 'Exam Tricky',
    conceptSi: 'සමචතුරස්‍ර සහ ත්‍රිකෝණ සංඛ්‍යා',
    conceptEn: 'Square Numbers vs. Triangular Numbers',
    promptQuestion:
      'How do you tell Square Numbers (1, 4, 9, 16) apart from Triangular Numbers (1, 3, 6, 10)?',
    coreRule:
      'Squares = n × n (1, 4, 9, 16, 25) · Triangles = +2, +3, +4, +5 (1, 3, 6, 10, 15)',
    mnemonicTitle: 'Chessboard Tiles vs. Bowling Pins',
    mnemonicHook:
      'Picture neat square floor tiles (2×2=4, 3×3=9, 4×4=16) vs. a bowling pin pyramid adding one wider bottom row each time (1 → +2=3 → +3=6 → +4=10)!',
    visualCueSteps: [
      'For Squares: multiply position by itself (5th square = 5 × 5 = 25).',
      'For Triangles: stack rows 1 + 2 + 3 + 4 + 5 = 15.',
      'Fun bonus check: two neighbor triangles always glue into a square (6 + 10 = 16)!',
    ],
    recallCheckPrompt: 'Quick check: What is the 5th Triangular number?',
  },
  {
    id: 'FC-07',
    domain: 'Sinhala Language & Proverbs',
    strategy: 'Visualization',
    difficulty: 'Exam Tricky',
    conceptSi: 'නිවැරදි අක්ෂර වින්‍යාසය — "ශිෂ්‍යත්වය"',
    conceptEn: 'Sinhala Spelling Trap: Taluya "ශ" vs. Murdhaja "ෂ"',
    promptQuestion:
      'Why does "ශිෂ්‍යත්වය" begin with "ශ" and use "ෂ" in the middle?',
    coreRule: 'ශි + ෂ්‍ය + ත් + ව + ය (Soft Taluya ශ first, Murdhaja ෂ second)',
    mnemonicTitle: 'Quiet Door, Strong Crown',
    mnemonicHook:
      'Picture tiptoeing quietly ("ශ්..." = smooth curved ශි) into the exam hall, then putting on a sturdy scholarship crown ("ෂ්‍ය" with its firm corner) on your head!',
    visualCueSteps: [
      'First letter: smooth soft curve "ශි" (Taluya sha).',
      'Second syllable: boxy firm "ෂ්‍ය" (Murdhaja sha + yansaya).',
      'Say it slowly in rhythm: ශි — ෂ්‍ය — ත් — ව — ය.',
    ],
    recallCheckPrompt: 'Quick check: Spell "ශිෂ්‍යත්වය" in the air without peeking!',
  },
  {
    id: 'FC-08',
    domain: 'Sinhala Language & Proverbs',
    strategy: 'Story Hook',
    difficulty: 'Core Concept',
    conceptSi: 'ප්‍රස්තාව පිරුළ — අත්තෙන් අත්තට පනින කුරුල්ලා',
    conceptEn: 'Sinhala Proverb Meaning & Exact Ending Word',
    promptQuestion:
      'In "අත්තෙන් අත්තට පනින කුරුල්ලා තෙමෙන්නේ...", does the bird get wet by rain or dew?',
    coreRule: 'තෙමෙන්නේ "පින්නටය" (morning dew), meaning restless people invite small troubles.',
    mnemonicTitle: 'Dawn Dew Robin Cartoon',
    mnemonicHook:
      'Imagine a hyper little robin waking at sunrise before any rain starts — hopping branch to branch shakes sparkling silver DEW drops ("පින්නටය") onto its feathers!',
    visualCueSteps: [
      'Time of day in the cartoon: Early dawn, NO rain clouds!',
      'Each branch bounce shakes cold morning dew ("පින්න") down.',
      'Lesson: jumping impulsively without settling gets you soaked in trouble.',
    ],
    recallCheckPrompt:
      'Quick check: Complete the proverb aloud with the exact final word!',
  },
  {
    id: 'FC-09',
    domain: 'Environmental Studies (පරිසරය)',
    strategy: 'Visualization',
    difficulty: 'Core Concept',
    conceptSi: 'ප්‍රභාසංශ්ලේෂණය (Photosynthesis)',
    conceptEn: 'How Green Leaves Cook Food & Swap Gases',
    promptQuestion:
      'Which gas goes IN to a leaf during daytime cooking, and which gas comes OUT?',
    coreRule:
      'Inputs: Sunlight + Water + Carbon Dioxide (CO₂) → Outputs: Glucose + Oxygen (O₂)',
    mnemonicTitle: 'Leaf Kitchen Sun-Chef',
    mnemonicHook:
      'Picture a tiny green chef inside a leaf pot: Sunlight is the stove, roots pipe Water, the leaf breathes IN smoky CO₂, and serves fresh blue OXYGEN bubbles for us!',
    visualCueSteps: [
      'Kitchen energy: Sunlight caught by green Chlorophyll.',
      'Ingredients sucked IN: Water + Carbon Dioxide.',
      'Fresh gift breathed OUT: Oxygen for humans and animals.',
    ],
    recallCheckPrompt:
      'Quick check: What 3 ingredients does the leaf chef need to start cooking?',
  },
  {
    id: 'FC-10',
    domain: 'Environmental Studies (පරිසරය)',
    strategy: 'Rhyming',
    difficulty: 'Core Concept',
    conceptSi: 'ශ්‍රී ලංකාවේ ජාතික සංකේත සහ මහවැලි ගඟ',
    conceptEn: 'Sri Lanka National Symbols & Longest River',
    promptQuestion:
      'Students often confuse Lotus with Blue Water Lily. Which rhyme locks all national symbols?',
    coreRule:
      'Flower: Blue Water Lily (නිල් මානෙල්) · Bird: Jungle Fowl · Tree: Ironwood (නා) · River: Mahaweli (335 km)',
    mnemonicTitle: 'Island Pride 4-Line Rhyme',
    mnemonicHook:
      '"Blue Lily floats on water bright, Jungle Fowl greets morning light; Ironwood stands strong and tall, Mighty Mahaweli outruns them all!"',
    visualCueSteps: [
      'Remember BLUE (නිල් මානෙල්), NOT pink lotus!',
      'Jungle Fowl (වලි කුකුළා) = National Bird · Na Tree = National Tree.',
      '"Maha" = Great/Longest → Mahaweli River (335 km).',
    ],
    recallCheckPrompt:
      'Quick check: Name Sri Lanka’s National Flower and National Tree from the rhyme.',
  },
  {
    id: 'FC-11',
    domain: 'English & Comprehension',
    strategy: 'Rhyming',
    difficulty: 'Core Concept',
    conceptSi: 'ඉංග්‍රීසි අක්‍රමවත් බහුවචන (Irregular Plurals)',
    conceptEn: 'No-"S" Irregular Plurals (Child, Mouse, Tooth, Foot)',
    promptQuestion:
      'Why are "childs" and "mouses" always wrong in Grade 5 English grammar?',
    coreRule: 'child → children · mouse → mice · tooth → teeth · foot → feet · goose → geese',
    mnemonicTitle: 'Twin-Sound & No-S Rap',
    mnemonicHook:
      '"Ten chil-DREN chased three MICE, brushed their TEETH and washed FEET twice — never slap an S on these!"',
    visualCueSteps: [
      'Group 1 (-ren / -en): child → children, ox → oxen.',
      'Group 2 (oo → ee swap): tooth → teeth, foot → feet, goose → geese.',
      'Group 3 (ou → ice): mouse → mice, louse → lice.',
    ],
    recallCheckPrompt: 'Quick check: Turn "one tooth, one mouse, one child" into plurals.',
  },
  {
    id: 'FC-12',
    domain: 'English & Comprehension',
    strategy: 'Story Hook',
    difficulty: 'Exam Tricky',
    conceptSi: 'කාල නිපාත පද — AT, ON, IN',
    conceptEn: 'Prepositions of Time Pyramid (AT · ON · IN)',
    promptQuestion:
      'When do you write "at", "on", or "in" before times, days, and months?',
    coreRule: 'AT = Exact clock time · ON = Single day or date · IN = Month, year, season',
    mnemonicTitle: 'Tiny Dot → Flat Page → Big Box',
    mnemonicHook:
      'Think of size! AT taps a tiny clock dot ("at 7:30"), ON lands flat on one calendar page ("on Monday / on May 4th"), and IN climbs inside a huge month or year box ("in August / in 2026")!',
    visualCueSteps: [
      'Small dot (hours/noon/night) → AT.',
      'Medium calendar sheet (weekdays/dates) → ON.',
      'Big storage box (months/seasons/years) → IN.',
    ],
    recallCheckPrompt:
      'Quick check: Fill in "The scholarship exam is ___ Sunday ___ August ___ 9:30 a.m."',
  },
];

export function filterFlashcards(
  cards: MnemonicFlashcard[],
  options: {
    domain?: string;
    strategy?: MnemonicStrategy | 'All';
  }
): MnemonicFlashcard[] {
  return cards.filter((card) => {
    const domainMatch =
      !options.domain || options.domain === 'All' || card.domain === options.domain;
    const strategyMatch =
      !options.strategy ||
      options.strategy === 'All' ||
      card.strategy === options.strategy;
    return domainMatch && strategyMatch;
  });
}

export function shuffleFlashcards(
  cards: MnemonicFlashcard[],
  seed: number
): MnemonicFlashcard[] {
  return seededShuffle(cards, seed);
}

export function evaluateFlashcardDeckProgress(
  cards: MnemonicFlashcard[],
  confidenceMap: Record<string, FlashcardConfidence>
): FlashcardDeckProgress {
  let masteredCount = 0;
  let reviewCount = 0;
  const dueReviewIds: string[] = [];

  for (const card of cards) {
    const status = confidenceMap[card.id];
    if (status === 'mastered') {
      masteredCount += 1;
    } else if (status === 'review') {
      reviewCount += 1;
      dueReviewIds.push(card.id);
    }
  }

  const totalCount = cards.length;
  const unseenCount = Math.max(0, totalCount - masteredCount - reviewCount);
  const masteryPercent =
    totalCount > 0 ? Math.round((masteredCount / totalCount) * 100) : 0;

  return {
    totalCount,
    masteredCount,
    reviewCount,
    unseenCount,
    masteryPercent,
    dueReviewIds,
  };
}
