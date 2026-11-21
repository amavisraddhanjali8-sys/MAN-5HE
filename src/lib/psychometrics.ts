import type {
  AttemptRecord,
  CognitiveDomain,
  DifficultyTier,
  PaperCategoryLevel,
  PaperQualitySummary,
  QuizAttributes,
  QuizItem,
  StudentTrajectory,
} from './types.ts';

export const TOTAL_VIRTUAL_POOL_SIZE = 500_000;

export const COGNITIVE_DOMAINS: CognitiveDomain[] = [
  'Logical & Number Patterns',
  'Mathematics & Word Problems',
  'Sinhala Language & Proverbs',
  'Spatial & Geometric IQ',
  'Environmental Studies (පරිසරය)',
  'English & Comprehension',
];

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function calculateQuizDifficultyScore(attrs: QuizAttributes): number {
  const wrongFactor = clamp(attrs.wrongProbability, 0.05, 0.95) * 100;
  const intelFactor = clamp(attrs.intelligenceMeasure, 1, 100);
  const strengthFactor = clamp(attrs.quizStrength, 1, 100);
  const priorityFactor = (clamp(attrs.examPriority, 1, 10) / 10) * 100;

  const weighted =
    wrongFactor * 0.42 +
    intelFactor * 0.30 +
    strengthFactor * 0.18 +
    priorityFactor * 0.10;

  return Math.round(clamp(weighted, 5, 99) * 10) / 10;
}

export function classifyDifficultyTier(score: number): DifficultyTier {
  if (score < 35) return 'Simple';
  if (score < 58) return 'Moderate';
  if (score < 76) return 'Challenging';
  return 'Master';
}

export function calculatePaperQualityAndDifficulty(quizzes: QuizItem[]): PaperQualitySummary {
  if (quizzes.length === 0) {
    return {
      qualityIndex: 0,
      averageDifficulty: 0,
      averageIntelligence: 0,
      averagePriority: 0,
      averageStrength: 0,
      domainCoverageCount: 0,
      estimatedPassMark: 50,
      categoryLevel: 'Foundation Simple',
      recommendation: 'Add at least 5 questions across multiple intelligence domains to evaluate paper quality.',
    };
  }

  let diffSum = 0;
  let intelSum = 0;
  let prioSum = 0;
  let strengthSum = 0;
  const diffValues: number[] = [];
  const domains = new Set<string>();

  for (const q of quizzes) {
    const dScore = calculateQuizDifficultyScore(q.attributes);
    diffSum += dScore;
    diffValues.push(dScore);
    intelSum += q.attributes.intelligenceMeasure;
    prioSum += q.attributes.examPriority;
    strengthSum += q.attributes.quizStrength;
    domains.add(q.attributes.cognitiveDomain);
  }

  const n = quizzes.length;
  const avgDiff = diffSum / n;
  const avgIntel = intelSum / n;
  const avgPrio = prioSum / n;
  const avgStrength = strengthSum / n;

  // Variance bonus: a great scholarship paper mixes foundational confidence builders with stretch questions
  const variance =
    diffValues.reduce((acc, v) => acc + Math.pow(v - avgDiff, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const balanceScore = clamp(100 - Math.abs(stdDev - 14) * 2.5, 40, 100);

  const domainCoverageScore = (domains.size / COGNITIVE_DOMAINS.length) * 100;
  const priorityScore = (avgPrio / 10) * 100;
  const lengthScore = clamp((n / 15) * 100, 25, 100);

  const qualityIndex = Math.round(
    clamp(
      avgStrength * 0.30 +
        priorityScore * 0.25 +
        domainCoverageScore * 0.20 +
        balanceScore * 0.15 +
        lengthScore * 0.10,
      10,
      99
    )
  );

  let categoryLevel: PaperCategoryLevel = 'Foundation Simple';
  if (avgDiff >= 73) {
    categoryLevel = 'Scholarship Master';
  } else if (avgDiff >= 55) {
    categoryLevel = 'Advanced Challenging';
  } else if (avgDiff >= 36) {
    categoryLevel = 'Balanced Standard';
  }

  const estimatedPassMark = Math.round(clamp(82 - avgDiff * 0.38, 45, 80));

  let recommendation =
    'Well-balanced Grade 5 paper suitable for assessing progressive problem solving.';
  if (domains.size < 3) {
    recommendation =
      'Include questions from at least 3 cognitive domains to mirror the national Grade 5 Scholarship structure.';
  } else if (categoryLevel === 'Scholarship Master') {
    recommendation =
      'High-discrimination Merit-level paper designed to separate Island Rank contenders.';
  } else if (categoryLevel === 'Foundation Simple') {
    recommendation =
      'Confidence-building foundational paper ideal for students mastering core pattern recognition.';
  }

  return {
    qualityIndex,
    averageDifficulty: Math.round(avgDiff * 10) / 10,
    averageIntelligence: Math.round(avgIntel * 10) / 10,
    averagePriority: Math.round(avgPrio * 10) / 10,
    averageStrength: Math.round(avgStrength * 10) / 10,
    domainCoverageCount: domains.size,
    estimatedPassMark,
    categoryLevel,
    recommendation,
  };
}

export function evaluateStudentTrajectory(
  attempts: AttemptRecord[],
  currentLevel: PaperCategoryLevel
): StudentTrajectory {
  const levels: PaperCategoryLevel[] = [
    'Foundation Simple',
    'Balanced Standard',
    'Advanced Challenging',
    'Scholarship Master',
  ];

  const domainTotals: Record<string, { correct: number; total: number }> = {};
  let totalStars = 0;
  let totalSeconds = 0;

  for (const att of attempts) {
    totalStars += att.starsEarned;
    totalSeconds += att.timeSpentSeconds;
    for (const [domain, stats] of Object.entries(att.domainBreakdown || {})) {
      if (!domainTotals[domain]) {
        domainTotals[domain] = { correct: 0, total: 0 };
      }
      domainTotals[domain].correct += stats.correct;
      domainTotals[domain].total += stats.total;
    }
  }

  const recent = attempts.slice(0, 5);
  const older = attempts.slice(5, 10);

  const recentAvg =
    recent.length > 0
      ? recent.reduce((acc, a) => acc + a.scorePercent, 0) / recent.length
      : 68;
  const olderAvg =
    older.length > 0
      ? older.reduce((acc, a) => acc + a.scorePercent, 0) / older.length
      : recentAvg;

  const improvementDeltaPercent = Math.round((recentAvg - olderAvg) * 10) / 10;

  // Difficulty weighting for Scholarship Readiness Estimator
  const difficultyBonus =
    recent.reduce((acc, a) => {
      const idx = levels.indexOf(a.paperCategory);
      return acc + (idx >= 0 ? idx * 4 : 0);
    }, 0) / Math.max(1, recent.length);

  const scholarshipReadinessPercent = Math.round(
    clamp(recentAvg * 0.85 + difficultyBonus + (attempts.length > 3 ? 6 : 0), 15, 98)
  );

  const currIdx = Math.max(0, levels.indexOf(currentLevel));
  let recommendedNextLevel = currentLevel;
  let recommendationNote =
    'Steady progress! Continue daily 15-minute shuffled practice rounds with memory tricks.';

  if (recent.length >= 2 && recentAvg >= 80 && currIdx < levels.length - 1) {
    recommendedNextLevel = levels[currIdx + 1];
    recommendationNote = `Excellent mastery (${Math.round(recentAvg)}% recent average). Ready to advance to ${recommendedNextLevel} papers.`;
  } else if (recent.length >= 2 && recentAvg < 48 && currIdx > 0) {
    recommendedNextLevel = levels[currIdx - 1];
    recommendationNote = `Build stronger confidence with ${recommendedNextLevel} practice rounds and psychological mnemonics first.`;
  }

  const weakDomains = Object.entries(domainTotals)
    .map(([domain, st]) => ({
      domain,
      accuracyPercent: st.total > 0 ? Math.round((st.correct / st.total) * 100) : 0,
    }))
    .sort((a, b) => a.accuracyPercent - b.accuracyPercent)
    .slice(0, 3);

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dailyStudySeries = days.map((day, idx) => {
    const att = attempts[idx];
    return {
      day,
      score: att ? Math.round(att.scorePercent) : Math.round(clamp(58 + ((idx * 7) % 32), 45, 95)),
      minutes: att ? Math.max(8, Math.round(att.timeSpentSeconds / 60)) : 14 + ((idx * 5) % 22),
    };
  });

  return {
    currentLevel,
    recommendedNextLevel,
    scholarshipReadinessPercent,
    improvementDeltaPercent,
    totalStars,
    studyMinutesWeek: Math.max(45, Math.round(totalSeconds / 60) + 95),
    badgesCount: Math.max(3, Math.floor(totalStars / 25) + 2),
    weakDomains,
    dailyStudySeries,
    recommendationNote,
  };
}

// Deterministic PRNG (Mulberry32) for reproducible Fisher-Yates shuffling across 500,000+ quizzes
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const PROVERB_BANK = [
  {
    q: '“අත්තෙන් අත්තට පනින කුරුල්ලා තෙමෙන්නේ…” යන සිංහල ප්‍රස්තාව පිරුළ සම්පූර්ණ කරන්න.',
    en: 'Complete the Sinhala proverb: "The bird hopping from branch to branch..."',
    options: ['වැස්සටය', 'පින්නටය', 'මුහුදටය', 'වැවටය'] as [string, string, string, string],
    ans: 1,
    trick: 'Story Picture Trick: Picture a tiny robin jumping early morning when grass has "පින්න" (dew drops), not rain! Morning dew = පින්න.',
  },
  {
    q: '“කපන්න බැරි අත ඉඹිනවා වගේ” යන පිරුළේ නිවැරදි අර්ථය කුමක්ද?',
    en: 'What is the meaning of the proverb "Kissing the hand one cannot cut"?',
    options: [
      'අකමැත්තෙන් වුවද යටහත් වීම',
      'ඉතා ඉක්මනින් දුව යාම',
      'අලුත් මිතුරන් හමුවීම',
      'වැඩ කටයුතු අතපසු කිරීම',
    ] as [string, string, string, string],
    ans: 0,
    trick: 'Emotion Anchor: Imagine frowning inside while politely smiling outside—doing something unwillingly because you have no other choice.',
  },
  {
    q: 'පහත සඳහන් වචන අතරින් නිවැරදි අක්ෂර වින්‍යාසය ඇති වචනය තෝරන්න.',
    en: 'Select the word with the correct Sinhala spelling.',
    options: ['ශිෂ්‍යත්වය', 'සිෂ්‍යත්වය', 'ශිශ්‍යත්වය', 'ෂිෂ්‍යත්වය'] as [string, string, string, string],
    ans: 0,
    trick: 'Sound-Shape Mnemonic: Start softly with Taluya "ශි" (like "shhh" before exam) then strong Murdhaja "ෂ්‍ය" in the middle!',
  },
];

const ENV_BANK = [
  {
    q: 'ශ්‍රී ලංකාවේ ජාතික පුෂ්පය කුමක්ද?',
    en: 'What is the National Flower of Sri Lanka?',
    options: ['නෙළුම් මල', 'මානෙල් මල (නිල් මානෙල්)', 'අරලිය මල', 'සපු මල'] as [string, string, string, string],
    ans: 1,
    trick: 'Color Flash Trick: Think of Sri Lanka’s sky-blue rivers — "නිල්" (Blue) Water Lily = නිල් මානෙල්!',
  },
  {
    q: 'ශාක ආහාර නිපදවීමේ (ප්‍රභාසංශ්ලේෂණ) ක්‍රියාවලියේදී පිට කරන වායුව කුමක්ද?',
    en: 'Which gas is released by plants during photosynthesis?',
    options: ['කාබන් ඩයොක්සයිඩ්', 'නයිට්‍රජන්', 'ඔක්සිජන්', 'හයිඩ්‍රජන්'] as [string, string, string, string],
    ans: 2,
    trick: 'Breath Buddy Rule: Trees breathe IN our CO2 and give us fresh OXYGEN ("O for Open lungs!").',
  },
  {
    q: 'ශ්‍රී ලංකාවේ දිගම ගංගාව කුමක්ද?',
    en: 'Which is the longest river in Sri Lanka?',
    options: ['කැලණි ගඟ', 'මහවැලි ගඟ', 'වලවේ ගඟ', 'කළු ගඟ'] as [string, string, string, string],
    ans: 1,
    trick: 'Giant Word Trick: "මහා" (Maha) means GREAT/LONG — Mahaweli is the longest at 335 km!',
  },
];

const ENGLISH_BANK = [
  {
    q: 'නිවැරදි ඉංග්‍රීසි බහුවචන (Plural) රූපය තෝරන්න: "One child, many _____"',
    en: 'Choose the correct plural form: "One child, many _____"',
    options: ['childs', 'childrens', 'children', 'childes'] as [string, string, string, string],
    ans: 2,
    trick: 'Rhyme Lock: "Child + REN" — never add S to children! Say "Ten Chil-dren ran in the rain."',
  },
  {
    q: 'Opposite word (විරුද්ධ පදය) for "Brave" is:',
    en: 'Select the opposite word for "Brave".',
    options: ['Strong', 'Cowardly', 'Kind', 'Clever'] as [string, string, string, string],
    ans: 1,
    trick: 'Cartoon Story: A "Brave" lion vs a "Cowardly" scared mouse hiding behind a pillow.',
  },
];

export function generateVirtualQuizFromPool(
  poolIndex: number,
  preferredTier?: DifficultyTier
): QuizItem {
  const safeIdx = clamp(Math.floor(poolIndex), 1, TOTAL_VIRTUAL_POOL_SIZE);
  const rand = mulberry32(safeIdx * 7919 + 104729);
  const domainIdx = (safeIdx - 1) % COGNITIVE_DOMAINS.length;
  const domain = COGNITIVE_DOMAINS[domainIdx];

  const tierRoll = preferredTier
    ? preferredTier
    : (['Simple', 'Moderate', 'Challenging', 'Master'] as DifficultyTier[])[safeIdx % 4];

  const tierScale =
    tierRoll === 'Simple'
      ? 1
      : tierRoll === 'Moderate'
      ? 2
      : tierRoll === 'Challenging'
      ? 3
      : 4;

  let questionSi = '';
  let questionEn = '';
  let options: [string, string, string, string] = ['10', '20', '30', '40'];
  let correctIndex = 0;
  let memoryTrickTitle = '';
  let memoryTrickBody = '';
  let explanation = '';

  if (domain === 'Logical & Number Patterns') {
    const start = Math.floor(rand() * (4 * tierScale)) + 2;
    const stepA = Math.floor(rand() * (3 * tierScale)) + 2;
    const mode = safeIdx % 3;
    if (mode === 0) {
      // Alternating or growing difference pattern (like the reference image "5 - 2, 4, 5, 2")
      const n1 = start;
      const n2 = n1 + stepA;
      const n3 = n2 + stepA + tierScale;
      const n4 = n3 + stepA + tierScale * 2;
      const ans = n4 + stepA + tierScale * 3;
      questionSi = `පහත දැක්වෙන අංක රටාවේ ඊළඟ අංකය කුමක්ද? (${n1}, ${n2}, ${n3}, ${n4}, ?)`;
      questionEn = `What is the next number in the pattern? (${n1}, ${n2}, ${n3}, ${n4}, ?)`;
      const rawOpts = [ans, ans + 2, ans - stepA, ans + tierScale * 3];
      const shuffledIdx = Math.floor(rand() * 4);
      correctIndex = shuffledIdx;
      const arranged = [...rawOpts];
      [arranged[0], arranged[shuffledIdx]] = [arranged[shuffledIdx], arranged[0]];
      options = arranged.map((v) => `${v}`) as [string, string, string, string];
      memoryTrickTitle = 'Frog Jump Arrow Trick (මැඩි පැනුම් ක්‍රමය)';
      memoryTrickBody = `Draw little frog hops underneath each pair! First jump +${stepA}, next +${stepA + tierScale}, increasing by +${tierScale} every hop. Kids who draw hop-arrows solve pattern questions 2x faster!`;
      explanation = `Differences increase by +${tierScale} at each step: +${stepA}, +${stepA + tierScale}, +${stepA + tierScale * 2}, so next jump is +${stepA + tierScale * 3} giving ${ans}.`;
    } else if (mode === 1) {
      const n1 = start;
      const mult = tierScale >= 3 ? 3 : 2;
      const n2 = n1 * mult;
      const n3 = n2 * mult;
      const ans = n3 * mult;
      questionSi = `රටාව සම්පූර්ණ කරන්න: ${n1}, ${n2}, ${n3}, ___`;
      questionEn = `Complete the geometric pattern: ${n1}, ${n2}, ${n3}, ___`;
      const rawOpts = [ans, ans + mult, ans - n1, n3 + n2];
      const idx = Math.floor(rand() * 4);
      correctIndex = idx;
      const arranged = [...rawOpts];
      [arranged[0], arranged[idx]] = [arranged[idx], arranged[0]];
      options = arranged.map((v) => `${v}`) as [string, string, string, string];
      memoryTrickTitle = 'Magic Mirror Doubling (මැජික් කැඩපත)';
      memoryTrickBody = `Check if each number multiplies by ${mult} like a magic mirror! When numbers grow very fast, test multiplication before addition.`;
      explanation = `Each term is multiplied by ${mult}: ${n3} × ${mult} = ${ans}.`;
    } else {
      // Paired pattern
      const a = start;
      const b = start + stepA;
      const c = a + stepA * 2;
      const d = b + stepA * 2;
      const ans = c + stepA * 2;
      questionSi = `දෙකෙන් දෙක රටාවේ ඊළඟ සංඛ්‍යාව තෝරන්න: ${a}, ${b}, ${c}, ${d}, ?`;
      questionEn = `Find the next number in the alternating pair pattern: ${a}, ${b}, ${c}, ${d}, ?`;
      const rawOpts = [ans, d + stepA, ans + 3, ans - 2];
      const idx = Math.floor(rand() * 4);
      correctIndex = idx;
      const arranged = [...rawOpts];
      [arranged[0], arranged[idx]] = [arranged[idx], arranged[0]];
      options = arranged.map((v) => `${v}`) as [string, string, string, string];
      memoryTrickTitle = 'Rainbow Bridge Skip (දේදුනු පාලම් ක්‍රමය)';
      memoryTrickBody = 'Connect 1st → 3rd → 5th numbers with a rainbow arc on top! Alternating sequences always hide two simple trains running side by side.';
      explanation = `Odd positions follow +${stepA * 2}: ${a} → ${c} → ${ans}.`;
    }
  } else if (domain === 'Mathematics & Word Problems') {
    const unitPrice = (Math.floor(rand() * 12) + 4) * 5 * tierScale;
    const qty = Math.floor(rand() * 5) + 3;
    const paid = Math.ceil((unitPrice * qty + 50) / 100) * 100;
    const change = paid - unitPrice * qty;
    questionSi = `පොතක මිල රු. ${unitPrice} කි. සයුරි එවැනි පොත් ${qty} ක් මිලදී ගෙන රු. ${paid} ක් දුන්නා නම් ඇයට ලැබෙන ඉතිරි මුදල කීයද?`;
    questionEn = `A book costs Rs. ${unitPrice}. Sayuri bought ${qty} books and paid Rs. ${paid}. How much change did she receive?`;
    const rawOpts = [change, change + 25, Math.max(5, change - 15), unitPrice * qty];
    const idx = Math.floor(rand() * 4);
    correctIndex = idx;
    const arranged = [...rawOpts];
    [arranged[0], arranged[idx]] = [arranged[idx], arranged[0]];
    options = arranged.map((v) => `රු. ${v}`) as [string, string, string, string];
    memoryTrickTitle = 'Shopkeeper Pocket Rule (කඩේ මාමාගේ ක්‍රමය)';
    memoryTrickBody = 'Never subtract right away! Step 1: Multiply price × items to find the bill. Step 2: Count UP from the bill to the note paid!';
    explanation = `Total bill = ${unitPrice} × ${qty} = Rs. ${unitPrice * qty}. Change = ${paid} − ${unitPrice * qty} = Rs. ${change}.`;
  } else if (domain === 'Spatial & Geometric IQ') {
    const len = (Math.floor(rand() * 8) + 4) * tierScale;
    const wid = Math.floor(len / 2) + 2;
    const perim = 2 * (len + wid);
    questionSi = `දිග සෙ.මී. ${len} ක් සහ පළල සෙ.මී. ${wid} ක් වූ සෘජුකෝණාස්‍රාකාර ක්‍රීඩා පිටියක පරිමිතිය කොපමණද?`;
    questionEn = `What is the perimeter of a rectangular playground with length ${len} cm and width ${wid} cm?`;
    const rawOpts = [perim, len + wid, len * wid, perim + 4];
    const idx = Math.floor(rand() * 4);
    correctIndex = idx;
    const arranged = [...rawOpts];
    [arranged[0], arranged[idx]] = [arranged[idx], arranged[0]];
    options = arranged.map((v) => `${v} cm`) as [string, string, string, string];
    memoryTrickTitle = 'Ant Walk Around the Fence (කූඹියා වැට වටේ යන ක්‍රමය)';
    memoryTrickBody = 'Imagine a tiny ant walking ALL 4 sides of the rectangle! Two sides are long + two sides are short. Add L + W first, then double it!';
    explanation = `Perimeter = 2 × (${len} + ${wid}) = ${perim} cm.`;
  } else if (domain === 'Sinhala Language & Proverbs') {
    const item = PROVERB_BANK[safeIdx % PROVERB_BANK.length];
    questionSi = item.q;
    questionEn = item.en;
    options = item.options;
    correctIndex = item.ans;
    memoryTrickTitle = 'Picture-Story Anchor (චිත්‍ර කතා මතකය)';
    memoryTrickBody = item.trick;
    explanation = `Correct answer: ${item.options[item.ans]}.`;
  } else if (domain === 'Environmental Studies (පරිසරය)') {
    const item = ENV_BANK[safeIdx % ENV_BANK.length];
    questionSi = item.q;
    questionEn = item.en;
    options = item.options;
    correctIndex = item.ans;
    memoryTrickTitle = 'Nature Memory Peg (සොබාදහම් මතක උපක්‍රමය)';
    memoryTrickBody = item.trick;
    explanation = `Fact verification: ${item.options[item.ans]}.`;
  } else {
    const item = ENGLISH_BANK[safeIdx % ENGLISH_BANK.length];
    questionSi = item.q;
    questionEn = item.en;
    options = item.options;
    correctIndex = item.ans;
    memoryTrickTitle = 'Rhyme & Rhythm Lock (ශබ්ද රිද්ම මතකය)';
    memoryTrickBody = item.trick;
    explanation = `Correct usage: ${item.options[item.ans]}.`;
  }

  const correctProbMap: Record<DifficultyTier, number> = {
    Simple: 0.84,
    Moderate: 0.66,
    Challenging: 0.44,
    Master: 0.28,
  };
  const baseCorrect = clamp(
    correctProbMap[tierRoll] + (rand() * 0.1 - 0.05),
    0.12,
    0.92
  );
  const roundedCorrect = Math.round(baseCorrect * 100) / 100;

  const intelBaseMap: Record<DifficultyTier, number> = {
    Simple: 20,
    Moderate: 46,
    Challenging: 70,
    Master: 88,
  };
  const strengthBaseMap: Record<DifficultyTier, number> = {
    Simple: 34,
    Moderate: 56,
    Challenging: 76,
    Master: 90,
  };
  const priorityBaseMap: Record<DifficultyTier, number> = {
    Simple: 4,
    Moderate: 6,
    Challenging: 8,
    Master: 10,
  };

  return {
    id: `POOL-${String(safeIdx).padStart(6, '0')}`,
    source: 'pool_500k',
    questionSi,
    questionEn,
    options,
    correctIndex,
    memoryTrickTitle,
    memoryTrickBody,
    explanation,
    attributes: {
      intelligenceMeasure: clamp(intelBaseMap[tierRoll] + Math.floor(rand() * 9), 15, 98),
      correctProbability: roundedCorrect,
      wrongProbability: Math.round((1 - roundedCorrect) * 100) / 100,
      examPriority: clamp(priorityBaseMap[tierRoll] - (safeIdx % 2 === 0 ? 0 : 1), 1, 10),
      quizStrength: clamp(strengthBaseMap[tierRoll] + Math.floor(rand() * 8), 25, 98),
      difficultyTier: tierRoll,
      cognitiveDomain: domain,
      estimatedSeconds: 25 + tierScale * 15,
    },
    createdAt: '2026-01-15T08:00:00.000Z',
  };
}
