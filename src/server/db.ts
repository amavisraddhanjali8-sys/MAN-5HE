import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  DOMAIN_TO_SUBJECT_ID,
} from '../lib/authorization.ts';
import {
  calculatePaperQualityAndDifficulty,
  generateVirtualQuizFromPool,
} from '../lib/psychometrics.ts';
import { hashPassword } from '../lib/security.ts';
import {
  buildInvoiceEmailHtml,
  buildProgressEmailHtml,
  buildWhatsAppProgressMessage,
} from '../lib/notifications.ts';
import type {
  AcademicConfig,
  AttemptRecord,
  CognitiveDomain,
  EmailLog,
  ExamPaper,
  InvoiceRecord,
  PaymentPlan,
  QuestionAttempt,
  QuizItem,
  SubjectCategory,
  SubtopicNode,
  TopicNode,
  UserAccount,
  WhatsAppLog,
} from '../lib/types.ts';

const LEGACY_JSON_PATH = path.resolve(
  process.cwd(),
  process.env.DATA_STORE_PATH || 'data/db.json'
);

export function resolveSqliteDbPath(): string {
  return path.resolve(
    process.cwd(),
    process.env.SQLITE_DB_PATH || 'data/man5he.sqlite'
  );
}

export function resolveKnowledgeUploadDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.KNOWLEDGE_UPLOAD_DIR || 'data/knowledge_uploads'
  );
}

export const DEFAULT_SUBJECTS: SubjectCategory[] = [
  {
    id: 'subj-math',
    slug: 'mathematics',
    nameEn: 'Mathematics & Word Problems',
    nameSi: 'ගණිතය සහ වචන ගැටලු',
    nameTa: 'கணிதம் மற்றும் சொல் கணக்குகள்',
    cognitiveDomain: 'Mathematics & Word Problems',
    sortOrder: 1,
    active: true,
  },
  {
    id: 'subj-logic',
    slug: 'logical-patterns',
    nameEn: 'Logical & Number Patterns',
    nameSi: 'තාර්කික හා සංඛ්‍යා රටා',
    nameTa: 'தர்க்கம் மற்றும் எண் வடிவங்கள்',
    cognitiveDomain: 'Logical & Number Patterns',
    sortOrder: 2,
    active: true,
  },
  {
    id: 'subj-sinhala',
    slug: 'sinhala-language',
    nameEn: 'Sinhala Language & Proverbs',
    nameSi: 'සිංහල භාෂාව හා ප්‍රස්තාව පිරුළු',
    nameTa: 'சிங்கள மொழி',
    cognitiveDomain: 'Sinhala Language & Proverbs',
    sortOrder: 3,
    active: true,
  },
  {
    id: 'subj-spatial',
    slug: 'spatial-geometry',
    nameEn: 'Spatial & Geometric IQ',
    nameSi: 'ජ්‍යාමිතික හා අවකාශ බුද්ධිය',
    nameTa: 'வடிவியல் நுண்ணறிவு',
    cognitiveDomain: 'Spatial & Geometric IQ',
    sortOrder: 4,
    active: true,
  },
  {
    id: 'subj-env',
    slug: 'environmental-studies',
    nameEn: 'Environmental Studies (පරිසරය)',
    nameSi: 'පරිසරය ආශ්‍රිත ක්‍රියාකාරකම්',
    nameTa: 'சுற்றாடல் கல்வி',
    cognitiveDomain: 'Environmental Studies (පරිසරය)',
    sortOrder: 5,
    active: true,
  },
  {
    id: 'subj-english',
    slug: 'english-tamil',
    nameEn: 'English & Comprehension',
    nameSi: 'ඉංග්‍රීසි සහ අවබෝධය',
    nameTa: 'ஆங்கிலம் மற்றும் புரிதல்',
    cognitiveDomain: 'English & Comprehension',
    sortOrder: 6,
    active: true,
  },
];

export const DEFAULT_TOPICS: TopicNode[] = [
  { id: 'top-math-money', subjectId: 'subj-math', nameEn: 'Money, Shopping & Word Problems', nameSi: 'මුදල් හා ගනුදෙනු', prerequisiteTopicId: null, sortOrder: 1 },
  { id: 'top-math-time', subjectId: 'subj-math', nameEn: 'Time, Clock & Conversions', nameSi: 'කාලය සහ මිනිත්තු', prerequisiteTopicId: null, sortOrder: 2 },
  { id: 'top-logic-seq', subjectId: 'subj-logic', nameEn: 'Number Sequences & Cycles', nameSi: 'අංක රටා හා චක්‍ර', prerequisiteTopicId: null, sortOrder: 1 },
  { id: 'top-logic-rank', subjectId: 'subj-logic', nameEn: 'Queue & Position Reasoning', nameSi: 'පෝලිම් හා ස්ථාන තර්කනය', prerequisiteTopicId: 'top-logic-seq', sortOrder: 2 },
  { id: 'top-sin-grammar', subjectId: 'subj-sinhala', nameEn: 'Parts of Speech & Particles', nameSi: 'පද වර්ග හා නිපාත', prerequisiteTopicId: null, sortOrder: 1 },
  { id: 'top-sin-proverbs', subjectId: 'subj-sinhala', nameEn: 'Proverbs & Spelling Mastery', nameSi: 'ප්‍රස්තාව පිරුළු හා අක්ෂර වින්‍යාසය', prerequisiteTopicId: null, sortOrder: 2 },
  { id: 'top-spa-perim', subjectId: 'subj-spatial', nameEn: 'Perimeter & Boundary Measurement', nameSi: 'පරිමිතිය හා හැඩතල', prerequisiteTopicId: null, sortOrder: 1 },
  { id: 'top-spa-sym', subjectId: 'subj-spatial', nameEn: 'Symmetry & Mirror Grids', nameSi: 'සමමිතිය හා කැඩපත් රූප', prerequisiteTopicId: 'top-spa-perim', sortOrder: 2 },
  { id: 'top-env-srilanka', subjectId: 'subj-env', nameEn: 'Sri Lanka Heritage & Geography', nameSi: 'ශ්‍රී ලංකා උරුමය හා භූගෝලය', prerequisiteTopicId: null, sortOrder: 1 },
  { id: 'top-env-nature', subjectId: 'subj-env', nameEn: 'Plants, Ecosystems & National Symbols', nameSi: 'ශාක හා ජාතික සංකේත', prerequisiteTopicId: null, sortOrder: 2 },
  { id: 'top-eng-grammar', subjectId: 'subj-english', nameEn: 'Nouns, Plurals & Opposites', nameSi: 'බහුවචන හා විරුද්ධ පද', prerequisiteTopicId: null, sortOrder: 1 },
  { id: 'top-eng-comp', subjectId: 'subj-english', nameEn: 'Directions & Reading Comprehension', nameSi: 'දිශාවන් හා කියවීමේ අවබෝධය', prerequisiteTopicId: null, sortOrder: 2 },
];

export const DEFAULT_SUBTOPICS: SubtopicNode[] = [
  { id: 'sub-math-change', topicId: 'top-math-money', subjectId: 'subj-math', nameEn: 'Multi-item Bills & Balance Change', nameSi: 'බිල්පත් හා ඉතිරි මුදල්', sortOrder: 1 },
  { id: 'sub-math-bus', topicId: 'top-math-money', subjectId: 'subj-math', nameEn: 'Net Gain & Loss Word Stories', nameSi: 'එකතු කිරීම හා අඩු කිරීමේ ගැටලු', sortOrder: 2 },
  { id: 'sub-math-hours', topicId: 'top-math-time', subjectId: 'subj-math', nameEn: 'Hours to Minutes Conversion', nameSi: 'පැය මිනිත්තු බවට හැරවීම', sortOrder: 1 },
  { id: 'sub-logic-cycle', topicId: 'top-logic-seq', subjectId: 'subj-logic', nameEn: 'Repeating & Growing Differences', nameSi: 'පුනරාවර්තන හා වර්ධන රටා', sortOrder: 1 },
  { id: 'sub-logic-queue', topicId: 'top-logic-rank', subjectId: 'subj-logic', nameEn: 'Front-Back Overlap Subtraction', nameSi: 'දෙපසින් ස්ථාන ගණනය', sortOrder: 1 },
  { id: 'sub-sin-nipatha', topicId: 'top-sin-grammar', subjectId: 'subj-sinhala', nameEn: 'Indeclinable Connecting Particles', nameSi: 'නිපාත පද හඳුනාගැනීම', sortOrder: 1 },
  { id: 'sub-sin-pirulu', topicId: 'top-sin-proverbs', subjectId: 'subj-sinhala', nameEn: 'Classic Scholarship Proverbs', nameSi: 'ශිෂ්‍යත්ව ප්‍රස්තාව පිරුළු', sortOrder: 1 },
  { id: 'sub-spa-square', topicId: 'top-spa-perim', subjectId: 'subj-spatial', nameEn: 'Square & Rectangle Perimeter', nameSi: 'සමචතුරස්‍ර හා සෘජුකෝණාස්‍ර පරිමිතිය', sortOrder: 1 },
  { id: 'sub-spa-mirror', topicId: 'top-spa-sym', subjectId: 'subj-spatial', nameEn: 'Mirror Reflection Patterns', nameSi: 'පරාවර්තන රටා', sortOrder: 1 },
  { id: 'sub-env-districts', topicId: 'top-env-srilanka', subjectId: 'subj-env', nameEn: 'Historical Sites & Districts', nameSi: 'ඓතිහාසික ස්ථාන හා දිස්ත්‍රික්ක', sortOrder: 1 },
  { id: 'sub-env-plants', topicId: 'top-env-nature', subjectId: 'subj-env', nameEn: 'Photosynthesis & National Flora', nameSi: 'ප්‍රභාසංශ්ලේෂණය හා ජාතික පුෂ්ප', sortOrder: 1 },
  { id: 'sub-eng-plurals', topicId: 'top-eng-grammar', subjectId: 'subj-english', nameEn: 'Irregular Plurals & Antonyms', nameSi: 'අක්‍රමවත් බහුවචන', sortOrder: 1 },
  { id: 'sub-eng-compass', topicId: 'top-eng-comp', subjectId: 'subj-english', nameEn: 'Cardinal Directions', nameSi: 'ප්‍රධාන දිශා', sortOrder: 1 },
];

export function resolveDefaultHierarchyForQuestion(
  quizId: string,
  domain: CognitiveDomain
): { subjectId: string; topicId: string; subtopicId: string } {
  const subjectId = DOMAIN_TO_SUBJECT_ID[domain] || 'subj-math';
  if (quizId === 'CUR-001') return { subjectId: 'subj-logic', topicId: 'top-logic-seq', subtopicId: 'sub-logic-cycle' };
  if (quizId === 'CUR-002') return { subjectId: 'subj-math', topicId: 'top-math-money', subtopicId: 'sub-math-bus' };
  if (quizId === 'CUR-003') return { subjectId: 'subj-spatial', topicId: 'top-spa-perim', subtopicId: 'sub-spa-square' };
  if (quizId === 'CUR-004') return { subjectId: 'subj-math', topicId: 'top-math-time', subtopicId: 'sub-math-hours' };
  if (quizId === 'CUR-005') return { subjectId: 'subj-env', topicId: 'top-env-srilanka', subtopicId: 'sub-env-districts' };
  if (quizId === 'CUR-006') return { subjectId: 'subj-sinhala', topicId: 'top-sin-grammar', subtopicId: 'sub-sin-nipatha' };
  if (quizId === 'CUR-007') return { subjectId: 'subj-logic', topicId: 'top-logic-rank', subtopicId: 'sub-logic-queue' };
  if (quizId === 'CUR-008') return { subjectId: 'subj-english', topicId: 'top-eng-comp', subtopicId: 'sub-eng-compass' };

  const topic = DEFAULT_TOPICS.find((t) => t.subjectId === subjectId) || DEFAULT_TOPICS[0];
  const sub = DEFAULT_SUBTOPICS.find((s) => s.topicId === topic.id) || DEFAULT_SUBTOPICS[0];
  return { subjectId, topicId: topic.id, subtopicId: sub.id };
}

function createSeedCuratedQuizzes(): QuizItem[] {
  return [
    {
      id: 'CUR-001',
      source: 'curated',
      subjectId: 'subj-logic',
      topicId: 'top-logic-seq',
      subtopicId: 'sub-logic-cycle',
      version: 1,
      questionSi: 'පහත දැක්වෙන රටාවේ ඊළඟ අංකය කුමක්ද? 5 - 2, 4, 5, 2, ...',
      questionEn: 'What is the next pair/number in the rhythmic pattern? 5 - 2, 4, 5, 2, ...',
      options: ['4', '5', '3', '6'],
      correctIndex: 0,
      memoryTrickTitle: 'Musical Beat Echo (සංගීත තාල මතකය)',
      memoryTrickBody:
        'Clap the numbers like a drumbeat: "5-2-4, 5-2-4"! Whenever you see repeating 3-number groups, say them out loud like a song chorus to spot the missing beat.',
      explanation: 'The 3-element cycle [5, 2, 4] repeats: 5, 2, 4, 5, 2, so the next number is 4.',
      misconceptions: [
        { optionIndex: 1, misconceptionLabel: 'Restarting cycle early', suggestedIntervention: 'Mark cycle boundaries every 3 beats with brackets.' },
      ],
      attributes: {
        intelligenceMeasure: 54,
        correctProbability: 0.74,
        wrongProbability: 0.26,
        examPriority: 9,
        quizStrength: 78,
        difficultyTier: 'Moderate',
        cognitiveDomain: 'Logical & Number Patterns',
        estimatedSeconds: 35,
      },
      createdAt: '2026-01-10T08:00:00.000Z',
    },
    {
      id: 'CUR-002',
      source: 'curated',
      subjectId: 'subj-math',
      topicId: 'top-math-money',
      subtopicId: 'sub-math-bus',
      version: 1,
      questionSi: 'බස් රථයක මගීන් 42 ක් සිටිති. පළමු නැවතුමේදී 15 ක් බැස 8 ක් නැග්ගේ නම් දැන් බස් රථයේ සිටින මගීන් ගණන කීයද?',
      questionEn: 'A bus has 42 passengers. At the first stop, 15 get off and 8 get on. How many passengers are on the bus now?',
      options: ['35', '33', '49', '29'],
      correctIndex: 0,
      memoryTrickTitle: 'Doorway Counter Trick (බස් දොර ගණන් ක්‍රමය)',
      memoryTrickBody:
        'First find the net change at the door! 15 left and 8 entered means 7 fewer people overall (15 − 8 = 7). Then just take 42 − 7 = 35 in one tiny mental step!',
      explanation: '42 − 15 = 27, then 27 + 8 = 35 (or net −7: 42 − 7 = 35).',
      misconceptions: [
        { optionIndex: 1, misconceptionLabel: 'Borrowing subtraction error (27+8 vs 25+8)', suggestedIntervention: 'Practice step-by-step doorway net difference before adding.' },
        { optionIndex: 2, misconceptionLabel: 'Adding 15-8 instead of subtracting net exit', suggestedIntervention: 'Act out passengers leaving vs boarding using arrows.' },
      ],
      attributes: {
        intelligenceMeasure: 48,
        correctProbability: 0.72,
        wrongProbability: 0.28,
        examPriority: 8,
        quizStrength: 74,
        difficultyTier: 'Moderate',
        cognitiveDomain: 'Mathematics & Word Problems',
        estimatedSeconds: 40,
      },
      createdAt: '2026-01-10T08:05:00.000Z',
    },
    {
      id: 'CUR-003',
      source: 'curated',
      subjectId: 'subj-spatial',
      topicId: 'top-spa-perim',
      subtopicId: 'sub-spa-square',
      version: 1,
      questionSi: 'රූපයේ ඇති සමචතුරස්‍රයක එක් පැත්තක දිග 9 cm නම් එහි වටප්‍රමාණය (පරිමිතිය) කොපමණද?',
      questionEn: 'If one side of a square is 9 cm, what is its perimeter?',
      options: ['18 cm', '27 cm', '36 cm', '81 cm'],
      correctIndex: 2,
      memoryTrickTitle: '4-Wall Fence Chant (හතර පැත්තේ වැට)',
      memoryTrickBody:
        'A square has 4 twin walls! Touch 4 fingers while saying "9, 18, 27, 36!" Never mix up Perimeter (4 walls added) with Area (floor tiles multiplied).',
      explanation: 'Perimeter of a square = 4 × side = 4 × 9 = 36 cm.',
      misconceptions: [
        { optionIndex: 3, misconceptionLabel: 'Confusing perimeter (4×side) with area (side×side)', suggestedIntervention: 'Trace the 4 outer walls separately with a colored pen.' },
      ],
      attributes: {
        intelligenceMeasure: 30,
        correctProbability: 0.86,
        wrongProbability: 0.14,
        examPriority: 8,
        quizStrength: 62,
        difficultyTier: 'Simple',
        cognitiveDomain: 'Spatial & Geometric IQ',
        estimatedSeconds: 25,
      },
      createdAt: '2026-01-10T08:10:00.000Z',
    },
    {
      id: 'CUR-004',
      source: 'curated',
      subjectId: 'subj-math',
      topicId: 'top-math-time',
      subtopicId: 'sub-math-hours',
      version: 1,
      questionSi: 'පැය 2 ක් සහ මිනිත්තු 45 ක් යනු මුළු මිනිත්තු කීයක්ද?',
      questionEn: 'How many total minutes are in 2 hours and 45 minutes?',
      options: ['125 min', '145 min', '165 min', '185 min'],
      correctIndex: 2,
      memoryTrickTitle: 'Clock Pizza Slice Trick (ඔරලෝසු පීසා ක්‍රමය)',
      memoryTrickBody:
        'Each full hour is a 60-minute pizza! 2 pizzas = 60 + 60 = 120 minutes. Now add the extra 45 slices: 120 + 45 = 165!',
      explanation: '2 × 60 + 45 = 120 + 45 = 165 minutes.',
      misconceptions: [
        { optionIndex: 1, misconceptionLabel: 'Base-100 hour conversion error (200-55 or 100+45)', suggestedIntervention: 'Review 60 minutes per hour using clock circles.' },
      ],
      attributes: {
        intelligenceMeasure: 42,
        correctProbability: 0.78,
        wrongProbability: 0.22,
        examPriority: 9,
        quizStrength: 70,
        difficultyTier: 'Simple',
        cognitiveDomain: 'Mathematics & Word Problems',
        estimatedSeconds: 30,
      },
      createdAt: '2026-01-10T08:15:00.000Z',
    },
    {
      id: 'CUR-005',
      source: 'curated',
      subjectId: 'subj-env',
      topicId: 'top-env-srilanka',
      subtopicId: 'sub-env-districts',
      version: 1,
      questionSi: 'සීගිරිය පිහිටා ඇත්තේ ශ්‍රී ලංකාවේ කුමන දිස්ත්‍රික්කයේද?',
      questionEn: 'In which district of Sri Lanka is Sigiriya Rock Fortress located?',
      options: ['අනුරාධපුරය', 'මාතලේ', 'පොළොන්නරුව', 'මහනුවර'],
      correctIndex: 1,
      memoryTrickTitle: 'Map Story Pin (සිතියම් කතා කටුව)',
      memoryTrickBody:
        'Remember "M for Lion Mountain = Matale"! Even though Sigiriya is near Dambulla/Anuradhapura roads, its district stamp is always මාතලේ (Matale).',
      explanation: 'Sigiriya is located in the Matale District of Central Province, Sri Lanka.',
      attributes: {
        intelligenceMeasure: 58,
        correctProbability: 0.62,
        wrongProbability: 0.38,
        examPriority: 9,
        quizStrength: 81,
        difficultyTier: 'Moderate',
        cognitiveDomain: 'Environmental Studies (පරිසරය)',
        estimatedSeconds: 30,
      },
      createdAt: '2026-01-10T08:20:00.000Z',
    },
    {
      id: 'CUR-006',
      source: 'curated',
      subjectId: 'subj-sinhala',
      topicId: 'top-sin-grammar',
      subtopicId: 'sub-sin-nipatha',
      version: 1,
      questionSi: '“මහන්සියෙන් වැඩ කළ හෙයින් විභාගයෙන් සමත් විය.” මෙහි “හෙයින්” යන්න කුමන පද වර්ගයකට අයත්ද?',
      questionEn: 'In Sinhala grammar, what part of speech is "හෙයින්" (because) in the sentence?',
      options: ['නාම පදයකි', 'ක්‍රියා පදයකි', 'නිපාත පදයකි', 'විශේෂණ පදයකි'],
      correctIndex: 2,
      memoryTrickTitle: 'Bridge Glue Word Trick (පාලම් මැලියම් වචන)',
      memoryTrickBody:
        'Words like හෙයින්, නිසා, සමඟ, නමුත් never change shape—they act like bridge glue connecting two ideas. Glue words are always නිපාත පද (Particles)!',
      explanation: '"හෙයින්" is an indeclinable connecting particle (නිපාත පදය).',
      attributes: {
        intelligenceMeasure: 76,
        correctProbability: 0.44,
        wrongProbability: 0.56,
        examPriority: 10,
        quizStrength: 88,
        difficultyTier: 'Challenging',
        cognitiveDomain: 'Sinhala Language & Proverbs',
        estimatedSeconds: 45,
      },
      createdAt: '2026-01-10T08:25:00.000Z',
    },
    {
      id: 'CUR-007',
      source: 'curated',
      subjectId: 'subj-logic',
      topicId: 'top-logic-rank',
      subtopicId: 'sub-logic-queue',
      version: 1,
      questionSi: 'පෝලිමක ඉදිරියෙන් 7 වන ස්ථානයේත්, පිටුපසින් 9 වන ස්ථානයේත් සිටින කවිඳු සිටින පෝලිමේ මුළු ළමුන් ගණන කීයද?',
      questionEn: 'Kavindu is 7th from the front and 9th from the back in a queue. How many children are in the queue?',
      options: ['16', '15', '17', '14'],
      correctIndex: 1,
      memoryTrickTitle: 'Double-Count Minus One (දෙපාරක් ගණන් කළා -1)',
      memoryTrickBody:
        'Imagine Kavindu raising BOTH hands! You counted him once from the front AND once from the back. Always add (7 + 9 = 16) and subtract 1 so you don’t clone Kavindu!',
      explanation: 'Total = Front position + Back position − 1 = 7 + 9 − 1 = 15.',
      misconceptions: [
        { optionIndex: 0, misconceptionLabel: 'Forgetting to subtract double-counted pivot student (-1)', suggestedIntervention: 'Draw stick figures for small queue (3rd front, 2nd back) to see overlap visually.' },
      ],
      attributes: {
        intelligenceMeasure: 84,
        correctProbability: 0.36,
        wrongProbability: 0.64,
        examPriority: 10,
        quizStrength: 92,
        difficultyTier: 'Master',
        cognitiveDomain: 'Logical & Number Patterns',
        estimatedSeconds: 50,
      },
      createdAt: '2026-01-10T08:30:00.000Z',
    },
    {
      id: 'CUR-008',
      source: 'curated',
      subjectId: 'subj-english',
      topicId: 'top-eng-comp',
      subtopicId: 'sub-eng-compass',
      version: 1,
      questionSi: 'Read carefully: "The sun rises in the _____ and sets in the west."',
      questionEn: 'Fill in the blank with the correct compass direction.',
      options: ['North', 'South', 'East', 'Center'],
      correctIndex: 2,
      memoryTrickTitle: 'NEWS Compass Spell',
      memoryTrickBody:
        'Remember "E for Early morning = East"! The sun wakes up Early in the East.',
      explanation: 'The sun rises in the East.',
      attributes: {
        intelligenceMeasure: 24,
        correctProbability: 0.89,
        wrongProbability: 0.11,
        examPriority: 6,
        quizStrength: 54,
        difficultyTier: 'Simple',
        cognitiveDomain: 'English & Comprehension',
        estimatedSeconds: 20,
      },
      createdAt: '2026-01-10T08:35:00.000Z',
    },
  ];
}

interface LegacyDbShape {
  users?: UserAccount[];
  curatedQuizzes?: QuizItem[];
  papers?: ExamPaper[];
  attempts?: AttemptRecord[];
  paymentPlans?: PaymentPlan[];
  invoices?: InvoiceRecord[];
  emailLogs?: EmailLog[];
  whatsappLogs?: WhatsAppLog[];
}

export class Man5heDatabase {
  public readonly db: DatabaseSync;
  private readonly knowledgeUploadDir: string;

  constructor(
    dbPath: string = resolveSqliteDbPath(),
    knowledgeUploadDir: string = resolveKnowledgeUploadDir()
  ) {
    this.knowledgeUploadDir = path.resolve(knowledgeUploadDir);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.runMigrations();
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set<number>(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
        (r) => r.version
      )
    );

    if (!applied.has(1)) {
      this.applyMigration1();
      this.db
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(1, '001_initial_man5he_relational_schema', new Date().toISOString());
    }

    if (!applied.has(2)) {
      this.seedAndImportLegacyIfNeeded();
      this.db
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(2, '002_seed_subjects_teachers_and_import_legacy', new Date().toISOString());
    }

    if (!applied.has(3)) {
      this.applyMigration3KnowledgeSchemaAndSeeds();
      this.db
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(3, '003_knowledge_discovery_publishing_and_grade_delivery', new Date().toISOString());
    }

    if (!applied.has(4)) {
      this.applyMigration4AssessmentAndQuestionLifecycleSchema();
      this.db
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(4, '004_subject_question_bank_and_assessments', new Date().toISOString());
    }
  }

  private applyMigration1(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        user_id_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        whatsapp_number TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
        active INTEGER NOT NULL DEFAULT 1,
        guardian_name TEXT NOT NULL DEFAULT '',
        guardian_contact_verified INTEGER NOT NULL DEFAULT 1,
        guardian_consent_given INTEGER NOT NULL DEFAULT 1,
        notification_preferences_json TEXT NOT NULL DEFAULT '{"inApp":true,"email":true,"whatsapp":true,"groupedSummary":false}',
        password_hash TEXT NOT NULL,
        totp_secret TEXT NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 1,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        subscription_status TEXT NOT NULL DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active')),
        subscription_plan_id TEXT,
        subscription_expires_at TEXT,
        current_level TEXT NOT NULL DEFAULT 'Foundation Simple',
        stars INTEGER NOT NULL DEFAULT 0,
        streak_days INTEGER NOT NULL DEFAULT 0,
        last_practice_date TEXT,
        daily_goal_questions INTEGER NOT NULL DEFAULT 10,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subjects (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name_en TEXT NOT NULL,
        name_si TEXT NOT NULL,
        name_ta TEXT NOT NULL,
        cognitive_domain TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        name_en TEXT NOT NULL,
        name_si TEXT NOT NULL,
        prerequisite_topic_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS subtopics (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        name_en TEXT NOT NULL,
        name_si TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS teacher_subject_assignments (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        assigned_by_admin_id TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        UNIQUE(teacher_id, subject_id)
      );

      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'curated',
        subject_id TEXT NOT NULL REFERENCES subjects(id),
        topic_id TEXT NOT NULL,
        subtopic_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        question_si TEXT NOT NULL,
        question_en TEXT NOT NULL,
        options_json TEXT NOT NULL,
        correct_index INTEGER NOT NULL,
        image_url TEXT,
        memory_trick_title TEXT NOT NULL,
        memory_trick_body TEXT NOT NULL,
        explanation TEXT NOT NULL,
        misconceptions_json TEXT NOT NULL DEFAULT '[]',
        attributes_json TEXT NOT NULL,
        quality_flag TEXT NOT NULL DEFAULT 'OK',
        active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL DEFAULT 'admin@man5he.lk',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS question_versions (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        subject_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        subtopic_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        change_note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        title_si TEXT NOT NULL,
        description TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        quiz_ids_json TEXT NOT NULL,
        quality_summary_json TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS round_attempts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        paper_id TEXT NOT NULL,
        paper_title TEXT NOT NULL,
        mode TEXT NOT NULL,
        paper_category TEXT NOT NULL,
        total_questions INTEGER NOT NULL,
        correct_count INTEGER NOT NULL,
        score_percent INTEGER NOT NULL,
        time_limit_seconds INTEGER NOT NULL,
        time_spent_seconds INTEGER NOT NULL,
        stars_earned INTEGER NOT NULL,
        domain_breakdown_json TEXT NOT NULL,
        submitted_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS question_attempts (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL,
        question_version INTEGER NOT NULL DEFAULT 1,
        subject_id TEXT NOT NULL REFERENCES subjects(id),
        topic_id TEXT NOT NULL,
        subtopic_id TEXT NOT NULL,
        attempt_sequence_number INTEGER NOT NULL,
        submitted_answer_index INTEGER,
        submission_status TEXT NOT NULL CHECK (submission_status IN ('valid_answered', 'skipped', 'unanswered', 'timed_out', 'invalid')),
        is_correct INTEGER,
        response_duration_ms INTEGER NOT NULL DEFAULT 0,
        difficulty_at_attempt TEXT NOT NULL,
        hint_used INTEGER NOT NULL DEFAULT 0,
        context_mode TEXT NOT NULL CHECK (context_mode IN ('practice', 'timed_exam', 'targeted_intervention')),
        session_id TEXT NOT NULL,
        delivery_context_json TEXT NOT NULL DEFAULT '{}',
        idempotency_key TEXT NOT NULL UNIQUE,
        attempt_timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS question_stats (
        question_id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES subjects(id),
        total_events INTEGER NOT NULL DEFAULT 0,
        valid_attempts INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        timed_out_count INTEGER NOT NULL DEFAULT 0,
        unique_students INTEGER NOT NULL DEFAULT 0,
        correct_attempts INTEGER NOT NULL DEFAULT 0,
        incorrect_attempts INTEGER NOT NULL DEFAULT 0,
        correct_rate REAL NOT NULL DEFAULT 0,
        incorrect_rate REAL NOT NULL DEFAULT 0,
        first_attempt_total INTEGER NOT NULL DEFAULT 0,
        first_attempt_correct INTEGER NOT NULL DEFAULT 0,
        repeat_attempt_total INTEGER NOT NULL DEFAULT 0,
        repeat_attempt_correct INTEGER NOT NULL DEFAULT 0,
        hint_assisted_total INTEGER NOT NULL DEFAULT 0,
        hint_assisted_correct INTEGER NOT NULL DEFAULT 0,
        unassisted_total INTEGER NOT NULL DEFAULT 0,
        unassisted_correct INTEGER NOT NULL DEFAULT 0,
        repeated_error_student_count INTEGER NOT NULL DEFAULT 0,
        median_response_ms INTEGER NOT NULL DEFAULT 0,
        p90_response_ms INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS student_question_stats (
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL,
        subject_id TEXT NOT NULL REFERENCES subjects(id),
        valid_attempts INTEGER NOT NULL DEFAULT 0,
        correct_attempts INTEGER NOT NULL DEFAULT 0,
        incorrect_attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT NOT NULL,
        PRIMARY KEY (student_id, question_id)
      );

      CREATE TABLE IF NOT EXISTS intervention_cases (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL,
        subject_id TEXT NOT NULL REFERENCES subjects(id),
        topic_id TEXT NOT NULL,
        subtopic_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'INTERVENTION_ASSIGNED', 'MONITORING', 'RESOLVED', 'DISMISSED')),
        incorrect_count INTEGER NOT NULL,
        threshold_triggered_at INTEGER NOT NULL,
        latest_attempt_id TEXT NOT NULL,
        assigned_teacher_id TEXT REFERENCES users(id),
        template_id TEXT,
        instruction_title TEXT NOT NULL DEFAULT '',
        instruction_body TEXT NOT NULL DEFAULT '',
        suggested_support_note TEXT NOT NULL DEFAULT '',
        recommended_practice_topic_id TEXT,
        consecutive_correct_after_case INTEGER NOT NULL DEFAULT 0,
        ready_for_teacher_review INTEGER NOT NULL DEFAULT 0,
        reopen_count INTEGER NOT NULL DEFAULT 0,
        dismissal_reason TEXT,
        resolution_notes TEXT,
        last_alert_sent_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS intervention_actions (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES intervention_cases(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        notes TEXT NOT NULL,
        template_used TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_role TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'whatsapp')),
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        related_case_id TEXT,
        related_student_id TEXT,
        related_subject_id TEXT,
        dedupe_key TEXT NOT NULL,
        delivery_status TEXT NOT NULL CHECK (delivery_status IN ('delivered', 'queued', 'retrying', 'failed', 'skipped_unverified')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS academic_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        repeated_error_threshold INTEGER NOT NULL DEFAULT 3,
        notification_cooldown_minutes INTEGER NOT NULL DEFAULT 30,
        alert_grouping_window_minutes INTEGER NOT NULL DEFAULT 15,
        sustained_correct_required_for_review INTEGER NOT NULL DEFAULT 2,
        auto_notify_admins_on_escalation INTEGER NOT NULL DEFAULT 1,
        require_teacher_review_before_close INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_si TEXT NOT NULL,
        audience TEXT NOT NULL,
        price_lkr INTEGER NOT NULL,
        duration_days INTEGER NOT NULL,
        features_json TEXT NOT NULL,
        recommended INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id),
        user_name TEXT NOT NULL,
        user_email TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        amount_lkr INTEGER NOT NULL,
        gateway TEXT NOT NULL,
        gateway_ref TEXT NOT NULL,
        signature_verified INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        to_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        category TEXT NOT NULL,
        otp_code TEXT,
        html_body TEXT NOT NULL,
        sent_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS whatsapp_logs (
        id TEXT PRIMARY KEY,
        to_number TEXT NOT NULL,
        category TEXT NOT NULL,
        message_text TEXT NOT NULL,
        delivery_status TEXT NOT NULL,
        sent_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS active_exam_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        paper_id TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL,
        time_limit_seconds INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_teacher_subj_teacher ON teacher_subject_assignments(teacher_id, subject_id);
      CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id, topic_id, subtopic_id);
      CREATE INDEX IF NOT EXISTS idx_q_attempts_student_q_seq ON question_attempts(student_id, question_id, attempt_sequence_number);
      CREATE INDEX IF NOT EXISTS idx_q_attempts_subject_time ON question_attempts(subject_id, attempt_timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_q_attempts_question_status ON question_attempts(question_id, submission_status);
      CREATE INDEX IF NOT EXISTS idx_cases_status_subject ON intervention_cases(status, subject_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(created_at DESC);
    `);
  }

  private seedAndImportLegacyIfNeeded(): void {
    // 1. Academic Config default
    this.db
      .prepare(
        `INSERT OR IGNORE INTO academic_config (
          id, repeated_error_threshold, notification_cooldown_minutes, alert_grouping_window_minutes,
          sustained_correct_required_for_review, auto_notify_admins_on_escalation, require_teacher_review_before_close,
          updated_at, updated_by
        ) VALUES (1, 3, 30, 15, 2, 1, 1, ?, 'system')`
      )
      .run(new Date().toISOString());

    // 2. Subjects, Topics, Subtopics
    const insertSubj = this.db.prepare(
      `INSERT OR IGNORE INTO subjects (id, slug, name_en, name_si, name_ta, cognitive_domain, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of DEFAULT_SUBJECTS) {
      insertSubj.run(s.id, s.slug, s.nameEn, s.nameSi, s.nameTa, s.cognitiveDomain, s.sortOrder, s.active ? 1 : 0);
    }

    const insertTopic = this.db.prepare(
      `INSERT OR IGNORE INTO topics (id, subject_id, name_en, name_si, prerequisite_topic_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const t of DEFAULT_TOPICS) {
      insertTopic.run(t.id, t.subjectId, t.nameEn, t.nameSi, t.prerequisiteTopicId || null, t.sortOrder);
    }

    const insertSubtopic = this.db.prepare(
      `INSERT OR IGNORE INTO subtopics (id, topic_id, subject_id, name_en, name_si, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const st of DEFAULT_SUBTOPICS) {
      insertSubtopic.run(st.id, st.topicId, st.subjectId, st.nameEn, st.nameSi, st.sortOrder);
    }

    // 3. Load legacy JSON if exists to preserve historical accounts, quizzes, papers, attempts, invoices
    let legacy: LegacyDbShape = {};
    try {
      if (fs.existsSync(LEGACY_JSON_PATH)) {
        legacy = JSON.parse(fs.readFileSync(LEGACY_JSON_PATH, 'utf8')) as LegacyDbShape;
      }
    } catch {
      legacy = {};
    }

    // 4. Payment Plans
    const defaultPlans: PaymentPlan[] = legacy.paymentPlans?.length
      ? legacy.paymentPlans
      : [
          {
            id: 'plan-monthly',
            name: 'Monthly Scholar Pass',
            nameSi: 'මාසික ශිෂ්‍යත්ව පැකේජය',
            audience: 'For short-term revision & weekly timed mocks',
            priceLkr: 1500,
            durationDays: 30,
            features: [
              '500,000+ shuffled bilingual quiz practice rounds',
              'Child psychological memory tricks on every question',
              'Weekly timed mock papers & instant scoring',
              'Automated Email & WhatsApp parent progress alerts',
            ],
          },
          {
            id: 'plan-term',
            name: 'Term Champion Pack',
            nameSi: 'වාර විභාග ජයග්‍රාහී පැකේජය',
            audience: 'For full-term preparation & level progression',
            priceLkr: 3900,
            durationDays: 90,
            recommended: true,
            features: [
              'Everything in Monthly Scholar Pass for 90 days',
              'Adaptive level unlocks: Foundation to Scholarship Master',
              'Scholarship Estimator & weak-domain improvement tracker',
              'Signed LKR payment invoices & parent sharing reports',
            ],
          },
          {
            id: 'plan-annual',
            name: 'Annual Island Rank Master',
            nameSi: 'වාර්ෂික විශිෂ්ට ශිෂ්‍යත්ව පැකේජය',
            audience: 'For complete Grade 5 Scholarship year mastery',
            priceLkr: 9500,
            durationDays: 365,
            features: [
              'Full 365-day unlimited access to 500,000+ quizzes',
              'All Island Rank timed exam series & psychometric insights',
              'Priority WhatsApp & HTML email diagnostic reports',
              'Teacher-guided intervention & follow-up plans',
            ],
          },
        ];

    const insertPlan = this.db.prepare(
      `INSERT OR IGNORE INTO payment_plans (id, name, name_si, audience, price_lkr, duration_days, features_json, recommended)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of defaultPlans) {
      insertPlan.run(p.id, p.name, p.nameSi, p.audience, p.priceLkr, p.durationDays, JSON.stringify(p.features), p.recommended ? 1 : 0);
    }

    // 5. Users (Legacy + Seeded Student, Admin, and Subject-Scoped Teachers)
    const defaultUsers: UserAccount[] = [
      {
        id: 'usr-student-1',
        userIdCode: 'M5-2026-001',
        name: 'Sayuri Perera',
        email: 'sayuri@man5he.lk',
        whatsappNumber: '+94771234567',
        role: 'student',
        active: true,
        guardianName: 'Mrs. Ruwani Perera',
        guardianContactVerified: true,
        guardianConsentGiven: true,
        passwordHash: hashPassword('Sayuri@2026'),
        totpSecret: 'JBSWY3DPEHPK3PXP',
        emailVerified: true,
        totpEnabled: false,
        subscriptionStatus: 'active',
        subscriptionPlanId: 'plan-annual',
        subscriptionExpiresAt: '2027-11-16T00:00:00.000Z',
        currentLevel: 'Balanced Standard',
        stars: 145,
        streakDays: 6,
        lastPracticeDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        dailyGoalQuestions: 15,
        createdAt: '2026-01-05T08:00:00.000Z',
      },
      {
        id: 'usr-student-2',
        userIdCode: 'M5-2026-002',
        name: 'Kasun Jayasinghe',
        email: 'kasun@man5he.lk',
        whatsappNumber: '+94774567890',
        role: 'student',
        active: true,
        guardianName: 'Mr. Samantha Jayasinghe',
        guardianContactVerified: true,
        guardianConsentGiven: true,
        passwordHash: hashPassword('Kasun@2026'),
        totpSecret: 'NB2W45DFOIZA1234',
        emailVerified: true,
        totpEnabled: false,
        subscriptionStatus: 'active',
        subscriptionPlanId: 'plan-term',
        subscriptionExpiresAt: '2027-06-01T00:00:00.000Z',
        currentLevel: 'Foundation Simple',
        stars: 84,
        streakDays: 3,
        lastPracticeDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        dailyGoalQuestions: 10,
        createdAt: '2026-02-10T08:00:00.000Z',
      },
      {
        id: 'usr-teacher-1',
        userIdCode: 'M5-TCH-01',
        name: 'Ms. Nimali Fernando',
        email: 'teacher.math@man5he.lk',
        whatsappNumber: '+94715551001',
        role: 'teacher',
        active: true,
        guardianName: '',
        guardianContactVerified: true,
        guardianConsentGiven: true,
        passwordHash: hashPassword('Teacher@2026'),
        totpSecret: 'MFRGGZDFMZTWQ2LK',
        emailVerified: true,
        totpEnabled: false,
        subscriptionStatus: 'active',
        subscriptionPlanId: null,
        subscriptionExpiresAt: null,
        currentLevel: 'Scholarship Master',
        stars: 0,
        streakDays: 0,
        dailyGoalQuestions: 10,
        createdAt: '2026-01-03T08:00:00.000Z',
      },
      {
        id: 'usr-teacher-2',
        userIdCode: 'M5-TCH-02',
        name: 'Mr. Suren Kumar',
        email: 'teacher.lang@man5he.lk',
        whatsappNumber: '+94715551002',
        role: 'teacher',
        active: true,
        guardianName: '',
        guardianContactVerified: true,
        guardianConsentGiven: true,
        passwordHash: hashPassword('Teacher@2026'),
        totpSecret: 'ORSXG5A3MZTWQ2LK',
        emailVerified: true,
        totpEnabled: false,
        subscriptionStatus: 'active',
        subscriptionPlanId: null,
        subscriptionExpiresAt: null,
        currentLevel: 'Scholarship Master',
        stars: 0,
        streakDays: 0,
        dailyGoalQuestions: 10,
        createdAt: '2026-01-04T08:00:00.000Z',
      },
      {
        id: 'usr-admin-1',
        userIdCode: 'M5-ADMIN-01',
        name: 'Kavinda Wickramasinghe',
        email: 'admin@man5he.lk',
        whatsappNumber: '+94719876543',
        role: 'admin',
        active: true,
        guardianName: '',
        guardianContactVerified: true,
        guardianConsentGiven: true,
        passwordHash: hashPassword('Admin@2026'),
        totpSecret: 'KRSXG5CTMVRXEZLU',
        emailVerified: true,
        totpEnabled: false,
        subscriptionStatus: 'active',
        subscriptionPlanId: 'plan-annual',
        subscriptionExpiresAt: '2028-01-01T00:00:00.000Z',
        currentLevel: 'Scholarship Master',
        stars: 500,
        streakDays: 30,
        lastPracticeDate: new Date().toISOString().slice(0, 10),
        dailyGoalQuestions: 20,
        createdAt: '2026-01-01T08:00:00.000Z',
      },
    ];

    const mergedUsersMap = new Map<string, UserAccount>();
    for (const u of defaultUsers) mergedUsersMap.set(u.id, u);
    for (const u of legacy.users || []) {
      mergedUsersMap.set(u.id, {
        ...u,
        active: u.active ?? true,
        guardianName: u.guardianName ?? 'Parent / Guardian',
        guardianContactVerified: u.guardianContactVerified ?? true,
        guardianConsentGiven: u.guardianConsentGiven ?? true,
      });
    }

    const insertUser = this.db.prepare(
      `INSERT OR IGNORE INTO users (
        id, user_id_code, name, email, whatsapp_number, role, active, guardian_name,
        guardian_contact_verified, guardian_consent_given, notification_preferences_json,
        password_hash, totp_secret, email_verified, totp_enabled, subscription_status,
        subscription_plan_id, subscription_expires_at, current_level, stars, streak_days,
        last_practice_date, daily_goal_questions, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const u of mergedUsersMap.values()) {
      insertUser.run(
        u.id,
        u.userIdCode,
        u.name,
        u.email.toLowerCase(),
        u.whatsappNumber,
        u.role,
        u.active === false ? 0 : 1,
        u.guardianName || '',
        u.guardianContactVerified === false ? 0 : 1,
        u.guardianConsentGiven === false ? 0 : 1,
        JSON.stringify(
          u.notificationPreferences || { inApp: true, email: true, whatsapp: true, groupedSummary: false }
        ),
        u.passwordHash,
        u.totpSecret,
        u.emailVerified ? 1 : 0,
        u.totpEnabled ? 1 : 0,
        u.subscriptionStatus,
        u.subscriptionPlanId,
        u.subscriptionExpiresAt,
        u.currentLevel,
        u.stars,
        u.streakDays,
        u.lastPracticeDate || null,
        u.dailyGoalQuestions || 10,
        u.createdAt
      );
    }

    // 6. Many-to-Many Teacher Subject Assignments
    const assignStmt = this.db.prepare(
      `INSERT OR IGNORE INTO teacher_subject_assignments (id, teacher_id, subject_id, assigned_by_admin_id, assigned_at)
       VALUES (?, ?, ?, 'usr-admin-1', '2026-01-05T08:00:00.000Z')`
    );
    // Ms. Nimali Fernando manages Mathematics, Logical Patterns, Spatial Geometry
    assignStmt.run('TSA-01', 'usr-teacher-1', 'subj-math');
    assignStmt.run('TSA-02', 'usr-teacher-1', 'subj-logic');
    assignStmt.run('TSA-03', 'usr-teacher-1', 'subj-spatial');
    // Mr. Suren Kumar manages Sinhala, Environmental Studies, English (plus shared Spatial)
    assignStmt.run('TSA-04', 'usr-teacher-2', 'subj-sinhala');
    assignStmt.run('TSA-05', 'usr-teacher-2', 'subj-env');
    assignStmt.run('TSA-06', 'usr-teacher-2', 'subj-english');

    // 7. Curated Quizzes + Version Snapshots
    const quizzes = legacy.curatedQuizzes?.length
      ? legacy.curatedQuizzes
      : createSeedCuratedQuizzes();

    const insertQuiz = this.db.prepare(
      `INSERT OR IGNORE INTO questions (
        id, source, subject_id, topic_id, subtopic_id, version, question_si, question_en,
        options_json, correct_index, image_url, memory_trick_title, memory_trick_body,
        explanation, misconceptions_json, attributes_json, quality_flag, active, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'admin@man5he.lk', ?, ?)`
    );
    const insertVersion = this.db.prepare(
      `INSERT OR IGNORE INTO question_versions (
        id, question_id, version, subject_id, topic_id, subtopic_id, snapshot_json, changed_by, change_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'admin@man5he.lk', 'Initial curated curriculum seed', ?)`
    );

    for (const q of quizzes) {
      const hierarchy = resolveDefaultHierarchyForQuestion(q.id, q.attributes.cognitiveDomain);
      const subjId = q.subjectId || hierarchy.subjectId;
      const topId = q.topicId || hierarchy.topicId;
      const subId = q.subtopicId || hierarchy.subtopicId;
      const ver = q.version || 1;
      insertQuiz.run(
        q.id,
        q.source,
        subjId,
        topId,
        subId,
        ver,
        q.questionSi,
        q.questionEn,
        JSON.stringify(q.options),
        q.correctIndex,
        q.imageUrl || null,
        q.memoryTrickTitle,
        q.memoryTrickBody,
        q.explanation,
        JSON.stringify(q.misconceptions || []),
        JSON.stringify(q.attributes),
        q.qualityFlag || 'OK',
        q.createdAt,
        q.updatedAt || q.createdAt
      );
      insertVersion.run(
        `QV-${q.id}-v${ver}`,
        q.id,
        ver,
        subjId,
        topId,
        subId,
        JSON.stringify(q),
        q.createdAt
      );
    }

    // 8. Papers
    const resolveForPaper = (id: string): QuizItem => {
      const found = quizzes.find((q) => q.id === id);
      if (found) return found;
      const match = id.match(/^POOL-(\d+)$/);
      return generateVirtualQuizFromPool(match ? Number(match[1]) : 1);
    };

    const seedPapers: ExamPaper[] = legacy.papers?.length
      ? legacy.papers
      : [
          {
            id: 'PAPER-001',
            title: 'Foundation Starter · Mock Paper 01',
            titleSi: 'මූලික පෙරහුරු ප්‍රශ්න පත්‍රය 01',
            description: 'Confidence-building starter paper covering core arithmetic, simple patterns, and English basics.',
            durationMinutes: 10,
            quizIds: ['CUR-003', 'CUR-004', 'CUR-008', 'POOL-000001', 'POOL-000005', 'POOL-000009', 'POOL-000013', 'POOL-000017'],
            qualitySummary: calculatePaperQualityAndDifficulty(['CUR-003', 'CUR-004', 'CUR-008', 'POOL-000001', 'POOL-000005', 'POOL-000009', 'POOL-000013', 'POOL-000017'].map(resolveForPaper)),
            createdBy: 'admin@man5he.lk',
            createdAt: '2026-01-12T09:00:00.000Z',
            published: true,
          },
          {
            id: 'PAPER-002',
            title: 'Balanced Standard · Mock Paper 02',
            titleSi: 'සමතුලිත පෙරහුරු ප්‍රශ්න පත්‍රය 02',
            description: 'Balanced Grade 5 Scholarship mock paper mirroring standard Part I & Part II weightage.',
            durationMinutes: 15,
            quizIds: ['CUR-001', 'CUR-002', 'CUR-005', 'POOL-000002', 'POOL-000006', 'POOL-000010', 'POOL-000014', 'POOL-000018', 'POOL-000022', 'POOL-000026'],
            qualitySummary: calculatePaperQualityAndDifficulty(['CUR-001', 'CUR-002', 'CUR-005', 'POOL-000002', 'POOL-000006', 'POOL-000010', 'POOL-000014', 'POOL-000018', 'POOL-000022', 'POOL-000026'].map(resolveForPaper)),
            createdBy: 'admin@man5he.lk',
            createdAt: '2026-01-14T09:00:00.000Z',
            published: true,
          },
          {
            id: 'PAPER-003',
            title: 'Advanced Challenging · Mock Paper 03',
            titleSi: 'උසස් අභියෝගාත්මක ප්‍රශ්න පත්‍රය 03',
            description: 'Challenging reasoning, Sinhala grammar particles, and multi-step word problems.',
            durationMinutes: 18,
            quizIds: ['CUR-005', 'CUR-006', 'POOL-000003', 'POOL-000007', 'POOL-000011', 'POOL-000015', 'POOL-000019', 'POOL-000023', 'POOL-000027', 'POOL-000031'],
            qualitySummary: calculatePaperQualityAndDifficulty(['CUR-005', 'CUR-006', 'POOL-000003', 'POOL-000007', 'POOL-000011', 'POOL-000015', 'POOL-000019', 'POOL-000023', 'POOL-000027', 'POOL-000031'].map(resolveForPaper)),
            createdBy: 'admin@man5he.lk',
            createdAt: '2026-01-16T09:00:00.000Z',
            published: true,
          },
          {
            id: 'PAPER-004',
            title: 'Scholarship Master · Island Rank Paper 04',
            titleSi: 'ශිෂ්‍යත්ව විශිෂ්ට ප්‍රශ්න පත්‍රය 04',
            description: 'High-discrimination Merit-level paper calibrated for top Island Rank contenders.',
            durationMinutes: 20,
            quizIds: ['CUR-006', 'CUR-007', 'POOL-000004', 'POOL-000008', 'POOL-000012', 'POOL-000016', 'POOL-000020', 'POOL-000024', 'POOL-000028', 'POOL-000032', 'POOL-000036', 'POOL-000040'],
            qualitySummary: calculatePaperQualityAndDifficulty(['CUR-006', 'CUR-007', 'POOL-000004', 'POOL-000008', 'POOL-000012', 'POOL-000016', 'POOL-000020', 'POOL-000024', 'POOL-000028', 'POOL-000032', 'POOL-000036', 'POOL-000040'].map(resolveForPaper)),
            createdBy: 'admin@man5he.lk',
            createdAt: '2026-01-18T09:00:00.000Z',
            published: true,
          },
        ];

    const insertPaper = this.db.prepare(
      `INSERT OR IGNORE INTO papers (id, title, title_si, description, duration_minutes, quiz_ids_json, quality_summary_json, created_by, created_at, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of seedPapers) {
      insertPaper.run(
        p.id,
        p.title,
        p.titleSi,
        p.description,
        p.durationMinutes,
        JSON.stringify(p.quizIds),
        JSON.stringify(p.qualitySummary),
        p.createdBy,
        p.createdAt,
        p.published ? 1 : 0
      );
    }

    // 9. Round Attempts (Legacy + Seeded)
    const legacyAttempts: AttemptRecord[] = legacy.attempts?.length
      ? legacy.attempts
      : [
          {
            id: 'ATT-1005',
            userId: 'usr-student-1',
            paperId: 'PAPER-002',
            paperTitle: 'Balanced Standard · Mock Paper 02',
            mode: 'timed_exam',
            paperCategory: 'Balanced Standard',
            totalQuestions: 10,
            correctCount: 8,
            scorePercent: 80,
            timeLimitSeconds: 900,
            timeSpentSeconds: 710,
            starsEarned: 28,
            domainBreakdown: {
              'Logical & Number Patterns': { correct: 3, total: 3 },
              'Mathematics & Word Problems': { correct: 2, total: 3 },
              'Environmental Studies (පරිසරය)': { correct: 2, total: 2 },
              'Sinhala Language & Proverbs': { correct: 1, total: 2 },
            },
            submittedAt: '2026-11-15T14:20:00.000Z',
          },
          {
            id: 'ATT-1004',
            userId: 'usr-student-1',
            paperId: 'PAPER-001',
            paperTitle: 'Foundation Starter · Mock Paper 01',
            mode: 'timed_exam',
            paperCategory: 'Foundation Simple',
            totalQuestions: 8,
            correctCount: 7,
            scorePercent: 88,
            timeLimitSeconds: 600,
            timeSpentSeconds: 480,
            starsEarned: 24,
            domainBreakdown: {
              'Spatial & Geometric IQ': { correct: 2, total: 2 },
              'Mathematics & Word Problems': { correct: 3, total: 3 },
              'English & Comprehension': { correct: 2, total: 3 },
            },
            submittedAt: '2026-11-13T16:10:00.000Z',
          },
        ];

    const insertRoundAttempt = this.db.prepare(
      `INSERT OR IGNORE INTO round_attempts (
        id, user_id, paper_id, paper_title, mode, paper_category, total_questions,
        correct_count, score_percent, time_limit_seconds, time_spent_seconds,
        stars_earned, domain_breakdown_json, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of legacyAttempts) {
      insertRoundAttempt.run(
        a.id,
        a.userId,
        a.paperId,
        a.paperTitle,
        a.mode,
        a.paperCategory,
        a.totalQuestions,
        a.correctCount,
        a.scorePercent,
        a.timeLimitSeconds,
        a.timeSpentSeconds,
        a.starsEarned,
        JSON.stringify(a.domainBreakdown || {}),
        a.submittedAt
      );
    }

    // 10. Invoices, Emails, WhatsApp logs
    const seedInvoices: InvoiceRecord[] = legacy.invoices?.length
      ? legacy.invoices
      : [
          {
            id: 'inv-seed-1',
            invoiceNumber: 'INV-M5-202601',
            userId: 'usr-student-1',
            userName: 'Sayuri Perera',
            userEmail: 'sayuri@man5he.lk',
            planId: 'plan-annual',
            planName: 'Annual Island Rank Master',
            amountLkr: 9500,
            gateway: 'PayHere LKR',
            gatewayRef: 'PH-LK-98432101',
            signatureVerified: true,
            status: 'paid',
            createdAt: '2026-11-01T09:15:00.000Z',
          },
        ];
    const insertInv = this.db.prepare(
      `INSERT OR IGNORE INTO invoices (id, invoice_number, user_id, user_name, user_email, plan_id, plan_name, amount_lkr, gateway, gateway_ref, signature_verified, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const inv of seedInvoices) {
      insertInv.run(
        inv.id, inv.invoiceNumber, inv.userId, inv.userName, inv.userEmail, inv.planId,
        inv.planName, inv.amountLkr, inv.gateway, inv.gatewayRef, inv.signatureVerified ? 1 : 0, inv.status, inv.createdAt
      );
    }

    const insertEmail = this.db.prepare(
      `INSERT OR IGNORE INTO email_logs (id, to_email, subject, category, otp_code, html_body, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const seedEmails: EmailLog[] = legacy.emailLogs?.length
      ? legacy.emailLogs
      : [
          {
            id: 'EML-SEED-1',
            toEmail: 'sayuri@man5he.lk',
            subject: 'Official Receipt & Invoice INV-M5-202601 · මං 5හේ',
            category: 'invoice',
            htmlBody: buildInvoiceEmailHtml(seedInvoices[0]),
            sentAt: '2026-11-01T09:15:05.000Z',
          },
        ];
    for (const em of seedEmails) {
      insertEmail.run(em.id, em.toEmail, em.subject, em.category, em.otpCode || null, em.htmlBody, em.sentAt);
    }

    const insertWa = this.db.prepare(
      `INSERT OR IGNORE INTO whatsapp_logs (id, to_number, category, message_text, delivery_status, sent_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const seedWa: WhatsAppLog[] = legacy.whatsappLogs?.length
      ? legacy.whatsappLogs
      : [
          {
            id: 'WA-SEED-1',
            toNumber: '+94771234567',
            category: 'exam_report',
            messageText: buildWhatsAppProgressMessage({
              studentName: 'Sayuri Perera',
              attempt: legacyAttempts[0],
              trajectory: {
                currentLevel: 'Balanced Standard',
                recommendedNextLevel: 'Advanced Challenging',
                scholarshipReadinessPercent: 81,
                improvementDeltaPercent: 10.5,
                totalStars: 145,
                studyMinutesWeek: 125,
                badgesCount: 7,
                weakDomains: [{ domain: 'Sinhala Language & Proverbs', accuracyPercent: 57 }],
                dailyStudySeries: [],
                recommendationNote: 'Ready to advance.',
              },
            }),
            deliveryStatus: 'delivered',
            sentAt: '2026-11-15T14:21:05.000Z',
          },
        ];
    for (const wa of seedWa) {
      insertWa.run(wa.id, wa.toNumber, wa.category, wa.messageText, wa.deliveryStatus, wa.sentAt);
    }

    // 11. Seed realistic granular question_attempts + intervention_cases so dashboards work from live SQL data
    this.seedInitialQuestionAttemptsAndCases();
  }

  private seedInitialQuestionAttemptsAndCases(): void {
    const existingCount = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM question_attempts').get() as { cnt: number }
    ).cnt;
    if (existingCount > 0) return;

    const seededAttempts: QuestionAttempt[] = [
      // Sayuri on CUR-007 (Queue overlap logic): 3 wrong attempts -> triggers repeated-error case CASE-SEED-1
      {
        id: 'QA-SEED-001', studentId: 'usr-student-1', questionId: 'CUR-007', questionVersion: 1,
        subjectId: 'subj-logic', topicId: 'top-logic-rank', subtopicId: 'sub-logic-queue',
        attemptSequenceNumber: 1, submittedAnswerIndex: 0, submissionStatus: 'valid_answered', isCorrect: false,
        responseDurationMs: 38000, difficultyAtAttempt: 'Master', hintUsed: false, contextMode: 'practice',
        sessionId: 'SES-SEED-1', deliveryContext: {}, idempotencyKey: 'seed-qa-001', attemptTimestamp: '2026-11-17T09:10:00.000Z',
      },
      {
        id: 'QA-SEED-002', studentId: 'usr-student-1', questionId: 'CUR-007', questionVersion: 1,
        subjectId: 'subj-logic', topicId: 'top-logic-rank', subtopicId: 'sub-logic-queue',
        attemptSequenceNumber: 2, submittedAnswerIndex: 0, submissionStatus: 'valid_answered', isCorrect: false,
        responseDurationMs: 29000, difficultyAtAttempt: 'Master', hintUsed: true, contextMode: 'practice',
        sessionId: 'SES-SEED-2', deliveryContext: {}, idempotencyKey: 'seed-qa-002', attemptTimestamp: '2026-11-18T10:15:00.000Z',
      },
      {
        id: 'QA-SEED-003', studentId: 'usr-student-1', questionId: 'CUR-007', questionVersion: 1,
        subjectId: 'subj-logic', topicId: 'top-logic-rank', subtopicId: 'sub-logic-queue',
        attemptSequenceNumber: 3, submittedAnswerIndex: 2, submissionStatus: 'valid_answered', isCorrect: false,
        responseDurationMs: 41000, difficultyAtAttempt: 'Master', hintUsed: false, contextMode: 'timed_exam',
        sessionId: 'SES-SEED-3', deliveryContext: { paperId: 'PAPER-004' }, idempotencyKey: 'seed-qa-003', attemptTimestamp: '2026-11-19T14:20:00.000Z',
      },
      // Kasun on CUR-002 (Bus passengers word problem): 3 wrong -> assigned intervention CASE-SEED-2
      {
        id: 'QA-SEED-004', studentId: 'usr-student-2', questionId: 'CUR-002', questionVersion: 1,
        subjectId: 'subj-math', topicId: 'top-math-money', subtopicId: 'sub-math-bus',
        attemptSequenceNumber: 1, submittedAnswerIndex: 2, submissionStatus: 'valid_answered', isCorrect: false,
        responseDurationMs: 32000, difficultyAtAttempt: 'Moderate', hintUsed: false, contextMode: 'practice',
        sessionId: 'SES-SEED-4', deliveryContext: {}, idempotencyKey: 'seed-qa-004', attemptTimestamp: '2026-11-17T11:00:00.000Z',
      },
      {
        id: 'QA-SEED-005', studentId: 'usr-student-2', questionId: 'CUR-002', questionVersion: 1,
        subjectId: 'subj-math', topicId: 'top-math-money', subtopicId: 'sub-math-bus',
        attemptSequenceNumber: 2, submittedAnswerIndex: 1, submissionStatus: 'valid_answered', isCorrect: false,
        responseDurationMs: 28000, difficultyAtAttempt: 'Moderate', hintUsed: true, contextMode: 'practice',
        sessionId: 'SES-SEED-5', deliveryContext: {}, idempotencyKey: 'seed-qa-005', attemptTimestamp: '2026-11-18T11:30:00.000Z',
      },
      {
        id: 'QA-SEED-006', studentId: 'usr-student-2', questionId: 'CUR-002', questionVersion: 1,
        subjectId: 'subj-math', topicId: 'top-math-money', subtopicId: 'sub-math-bus',
        attemptSequenceNumber: 3, submittedAnswerIndex: 2, submissionStatus: 'valid_answered', isCorrect: false,
        responseDurationMs: 35000, difficultyAtAttempt: 'Moderate', hintUsed: false, contextMode: 'practice',
        sessionId: 'SES-SEED-6', deliveryContext: {}, idempotencyKey: 'seed-qa-006', attemptTimestamp: '2026-11-19T12:00:00.000Z',
      },
      // Sayuri positive attempts across other subjects
      {
        id: 'QA-SEED-007', studentId: 'usr-student-1', questionId: 'CUR-001', questionVersion: 1,
        subjectId: 'subj-logic', topicId: 'top-logic-seq', subtopicId: 'sub-logic-cycle',
        attemptSequenceNumber: 1, submittedAnswerIndex: 0, submissionStatus: 'valid_answered', isCorrect: true,
        responseDurationMs: 18000, difficultyAtAttempt: 'Moderate', hintUsed: false, contextMode: 'practice',
        sessionId: 'SES-SEED-1', deliveryContext: {}, idempotencyKey: 'seed-qa-007', attemptTimestamp: '2026-11-17T09:05:00.000Z',
      },
      {
        id: 'QA-SEED-008', studentId: 'usr-student-1', questionId: 'CUR-003', questionVersion: 1,
        subjectId: 'subj-spatial', topicId: 'top-spa-perim', subtopicId: 'sub-spa-square',
        attemptSequenceNumber: 1, submittedAnswerIndex: 2, submissionStatus: 'valid_answered', isCorrect: true,
        responseDurationMs: 14000, difficultyAtAttempt: 'Simple', hintUsed: false, contextMode: 'practice',
        sessionId: 'SES-SEED-1', deliveryContext: {}, idempotencyKey: 'seed-qa-008', attemptTimestamp: '2026-11-17T09:07:00.000Z',
      },
      {
        id: 'QA-SEED-009', studentId: 'usr-student-1', questionId: 'CUR-004', questionVersion: 1,
        subjectId: 'subj-math', topicId: 'top-math-time', subtopicId: 'sub-math-hours',
        attemptSequenceNumber: 1, submittedAnswerIndex: 2, submissionStatus: 'valid_answered', isCorrect: true,
        responseDurationMs: 21000, difficultyAtAttempt: 'Simple', hintUsed: false, contextMode: 'practice',
        sessionId: 'SES-SEED-1', deliveryContext: {}, idempotencyKey: 'seed-qa-009', attemptTimestamp: '2026-11-17T09:09:00.000Z',
      },
      {
        id: 'QA-SEED-010', studentId: 'usr-student-1', questionId: 'CUR-006', questionVersion: 1,
        subjectId: 'subj-sinhala', topicId: 'top-sin-grammar', subtopicId: 'sub-sin-nipatha',
        attemptSequenceNumber: 1, submittedAnswerIndex: 0, submissionStatus: 'valid_answered', isCorrect: false,
        responseDurationMs: 31000, difficultyAtAttempt: 'Challenging', hintUsed: false, contextMode: 'practice',
        sessionId: 'SES-SEED-7', deliveryContext: {}, idempotencyKey: 'seed-qa-010', attemptTimestamp: '2026-11-19T16:00:00.000Z',
      },
      {
        id: 'QA-SEED-011', studentId: 'usr-student-1', questionId: 'CUR-006', questionVersion: 1,
        subjectId: 'subj-sinhala', topicId: 'top-sin-grammar', subtopicId: 'sub-sin-nipatha',
        attemptSequenceNumber: 2, submittedAnswerIndex: 2, submissionStatus: 'valid_answered', isCorrect: true,
        responseDurationMs: 24000, difficultyAtAttempt: 'Challenging', hintUsed: true, contextMode: 'practice',
        sessionId: 'SES-SEED-8', deliveryContext: {}, idempotencyKey: 'seed-qa-011', attemptTimestamp: '2026-11-20T08:00:00.000Z',
      },
      {
        id: 'QA-SEED-012', studentId: 'usr-student-2', questionId: 'CUR-005', questionVersion: 1,
        subjectId: 'subj-env', topicId: 'top-env-srilanka', subtopicId: 'sub-env-districts',
        attemptSequenceNumber: 1, submittedAnswerIndex: 1, submissionStatus: 'valid_answered', isCorrect: true,
        responseDurationMs: 16000, difficultyAtAttempt: 'Moderate', hintUsed: false, contextMode: 'practice',
        sessionId: 'SES-SEED-6', deliveryContext: {}, idempotencyKey: 'seed-qa-012', attemptTimestamp: '2026-11-19T12:10:00.000Z',
      },
      {
        id: 'QA-SEED-013', studentId: 'usr-student-1', questionId: 'CUR-008', questionVersion: 1,
        subjectId: 'subj-english', topicId: 'top-eng-comp', subtopicId: 'sub-eng-compass',
        attemptSequenceNumber: 1, submittedAnswerIndex: 2, submissionStatus: 'valid_answered', isCorrect: true,
        responseDurationMs: 11000, difficultyAtAttempt: 'Simple', hintUsed: false, contextMode: 'practice',
        sessionId: 'SES-SEED-8', deliveryContext: {}, idempotencyKey: 'seed-qa-013', attemptTimestamp: '2026-11-20T08:05:00.000Z',
      },
    ];

    const insertQA = this.db.prepare(
      `INSERT INTO question_attempts (
        id, student_id, question_id, question_version, subject_id, topic_id, subtopic_id,
        attempt_sequence_number, submitted_answer_index, submission_status, is_correct,
        response_duration_ms, difficulty_at_attempt, hint_used, context_mode, session_id,
        delivery_context_json, idempotency_key, attempt_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const qa of seededAttempts) {
      insertQA.run(
        qa.id, qa.studentId, qa.questionId, qa.questionVersion, qa.subjectId, qa.topicId, qa.subtopicId,
        qa.attemptSequenceNumber, qa.submittedAnswerIndex, qa.submissionStatus,
        qa.isCorrect === null ? null : qa.isCorrect ? 1 : 0,
        qa.responseDurationMs, qa.difficultyAtAttempt, qa.hintUsed ? 1 : 0,
        qa.contextMode, qa.sessionId, JSON.stringify(qa.deliveryContext), qa.idempotencyKey, qa.attemptTimestamp
      );
    }

    // Seed two active intervention cases matching Sayuri (CUR-007, OPEN) and Kasun (CUR-002, INTERVENTION_ASSIGNED)
    this.db
      .prepare(
        `INSERT INTO intervention_cases (
          id, student_id, question_id, subject_id, topic_id, subtopic_id, status,
          incorrect_count, threshold_triggered_at, latest_attempt_id, assigned_teacher_id,
          template_id, instruction_title, instruction_body, suggested_support_note,
          recommended_practice_topic_id, consecutive_correct_after_case, ready_for_teacher_review,
          reopen_count, last_alert_sent_at, created_at, updated_at
        ) VALUES
        (
          'CASE-SEED-001', 'usr-student-1', 'CUR-007', 'subj-logic', 'top-logic-rank', 'sub-logic-queue', 'OPEN',
          3, 3, 'QA-SEED-003', 'usr-teacher-1',
          NULL, 'Queue Position Overlap Check', '',
          'Suggested Teaching Support (Teacher Review Required): Student selected 16 twice (7+9 without subtracting 1). Draw a 5-child mini-queue with stick figures so the double-count becomes visible.',
          'top-logic-rank', 0, 0,
          0, '2026-11-19T14:20:05.000Z', '2026-11-19T14:20:05.000Z', '2026-11-19T14:20:05.000Z'
        ),
        (
          'CASE-SEED-002', 'usr-student-2', 'CUR-002', 'subj-math', 'top-math-money', 'sub-math-bus', 'INTERVENTION_ASSIGNED',
          3, 3, 'QA-SEED-006', 'usr-teacher-1',
          'tpl-math-shopkeeper', 'Doorway Counter Step-by-Step Recap',
          'Kasun, practice finding the doorway difference first (15 left - 8 boarded = 7 fewer) before subtracting from 42. Try 5 warm-up rounds in Mathematics!',
          'Suggested Teaching Support (Teacher Review Required): Multiple errors suggest adding net boarding difference or carry-borrow confusion.',
          'top-math-money', 0, 0,
          0, '2026-11-19T12:00:05.000Z', '2026-11-19T12:00:05.000Z', '2026-11-19T15:00:00.000Z'
        )`
      )
      .run();

    this.db
      .prepare(
        `INSERT INTO intervention_actions (id, case_id, actor_id, actor_name, actor_role, action_type, from_status, to_status, notes, template_used, created_at)
         VALUES
         ('ACT-SEED-1', 'CASE-SEED-001', 'system', 'Repeated-Error Engine', 'system', 'CASE_OPENED', NULL, 'OPEN', 'Triggered automatically after 3 incorrect attempts on CUR-007.', NULL, '2026-11-19T14:20:05.000Z'),
         ('ACT-SEED-2', 'CASE-SEED-002', 'system', 'Repeated-Error Engine', 'system', 'CASE_OPENED', NULL, 'OPEN', 'Triggered automatically after 3 incorrect attempts on CUR-002.', NULL, '2026-11-19T12:00:05.000Z'),
         ('ACT-SEED-3', 'CASE-SEED-002', 'usr-teacher-1', 'Ms. Nimali Fernando', 'teacher', 'INSTRUCTION_ASSIGNED', 'OPEN', 'INTERVENTION_ASSIGNED', 'Assigned Doorway Counter Step-by-Step Recap and Mathematics practice.', 'tpl-math-shopkeeper', '2026-11-19T15:00:00.000Z')`
      )
      .run();

    this.db
      .prepare(
        `INSERT INTO notifications (
          id, recipient_user_id, recipient_role, channel, category, title, body,
          related_case_id, related_student_id, related_subject_id, dedupe_key, delivery_status, retry_count, created_at
        ) VALUES
        (
          'NTF-SEED-1', 'usr-teacher-1', 'teacher', 'in_app', 'repeated_error_alert',
          'Repeated Error Alert · Sayuri Perera (CUR-007)',
          'Sayuri Perera recorded 3 incorrect attempts on Queue & Position Reasoning (CUR-007). Open case CASE-SEED-001 for review.',
          'CASE-SEED-001', 'usr-student-1', 'subj-logic', 'alert-usr-student-1-CUR-007-t3', 'delivered', 0, '2026-11-19T14:20:06.000Z'
        ),
        (
          'NTF-SEED-2', 'usr-student-2', 'student', 'in_app', 'intervention_assigned',
          'New Study Tip from Ms. Nimali Fernando',
          'Kasun, practice finding the doorway difference first (15 left - 8 boarded = 7 fewer) before subtracting from 42.',
          'CASE-SEED-002', 'usr-student-2', 'subj-math', 'instr-CASE-SEED-002-1', 'delivered', 0, '2026-11-19T15:00:01.000Z'
        )`
      )
      .run();

    // Also compute aggregated question_stats and student_question_stats from question_attempts
    this.recalculateAggregatesSync();
  }

  public recalculateAggregatesSync(): void {
    const threshold = (
      this.db.prepare('SELECT repeated_error_threshold FROM academic_config WHERE id = 1').get() as
        | { repeated_error_threshold: number }
        | undefined
    )?.repeated_error_threshold || 3;

    const allAttempts = this.db
      .prepare('SELECT * FROM question_attempts ORDER BY attempt_timestamp ASC')
      .all() as Record<string, unknown>[];

    this.db.exec('DELETE FROM question_stats; DELETE FROM student_question_stats;');

    const byQuestion = new Map<string, QuestionAttempt[]>();
    const byStudentQuestion = new Map<
      string,
      {
        studentId: string;
        questionId: string;
        subjectId: string;
        validAttempts: number;
        correctAttempts: number;
        incorrectAttempts: number;
        lastAttemptAt: string;
      }
    >();

    for (const r of allAttempts) {
      const qa: QuestionAttempt = {
        id: String(r.id),
        studentId: String(r.student_id),
        questionId: String(r.question_id),
        questionVersion: Number(r.question_version),
        subjectId: String(r.subject_id),
        topicId: String(r.topic_id),
        subtopicId: String(r.subtopic_id),
        attemptSequenceNumber: Number(r.attempt_sequence_number),
        submittedAnswerIndex: r.submitted_answer_index === null ? null : Number(r.submitted_answer_index),
        submissionStatus: String(r.submission_status) as QuestionAttempt['submissionStatus'],
        isCorrect: r.is_correct === null ? null : Number(r.is_correct) === 1,
        responseDurationMs: Number(r.response_duration_ms),
        difficultyAtAttempt: String(r.difficulty_at_attempt) as QuestionAttempt['difficultyAtAttempt'],
        hintUsed: Number(r.hint_used) === 1,
        contextMode: String(r.context_mode) as QuestionAttempt['contextMode'],
        sessionId: String(r.session_id),
        deliveryContext: JSON.parse(String(r.delivery_context_json || '{}')),
        idempotencyKey: String(r.idempotency_key),
        attemptTimestamp: String(r.attempt_timestamp),
      };

      const list = byQuestion.get(qa.questionId) || [];
      list.push(qa);
      byQuestion.set(qa.questionId, list);

      if (qa.submissionStatus === 'valid_answered') {
        const key = `${qa.studentId}::${qa.questionId}`;
        const cur = byStudentQuestion.get(key) || {
          studentId: qa.studentId,
          questionId: qa.questionId,
          subjectId: qa.subjectId,
          validAttempts: 0,
          correctAttempts: 0,
          incorrectAttempts: 0,
          lastAttemptAt: qa.attemptTimestamp,
        };
        cur.validAttempts += 1;
        if (qa.isCorrect === true) cur.correctAttempts += 1;
        if (qa.isCorrect === false) cur.incorrectAttempts += 1;
        cur.lastAttemptAt = qa.attemptTimestamp;
        byStudentQuestion.set(key, cur);
      }
    }

    const insertSQ = this.db.prepare(
      `INSERT INTO student_question_stats (student_id, question_id, subject_id, valid_attempts, correct_attempts, incorrect_attempts, last_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const sq of byStudentQuestion.values()) {
      insertSQ.run(sq.studentId, sq.questionId, sq.subjectId, sq.validAttempts, sq.correctAttempts, sq.incorrectAttempts, sq.lastAttemptAt);
    }

    const insertQS = this.db.prepare(
      `INSERT INTO question_stats (
        question_id, subject_id, total_events, valid_attempts, skipped_count, timed_out_count,
        unique_students, correct_attempts, incorrect_attempts, correct_rate, incorrect_rate,
        first_attempt_total, first_attempt_correct, repeat_attempt_total, repeat_attempt_correct,
        hint_assisted_total, hint_assisted_correct, unassisted_total, unassisted_correct,
        repeated_error_student_count, median_response_ms, p90_response_ms, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const now = new Date().toISOString();
    for (const [qId, list] of byQuestion.entries()) {
      const valid = list.filter((a) => a.submissionStatus === 'valid_answered');
      const skipped = list.filter((a) => a.submissionStatus === 'skipped' || a.submissionStatus === 'unanswered');
      const timedOut = list.filter((a) => a.submissionStatus === 'timed_out');
      const uniqueStu = new Set(valid.map((a) => a.studentId));
      const correct = valid.filter((a) => a.isCorrect === true);
      const incorrect = valid.filter((a) => a.isCorrect === false);
      const first = valid.filter((a) => a.attemptSequenceNumber === 1);
      const repeat = valid.filter((a) => a.attemptSequenceNumber > 1);
      const hint = valid.filter((a) => a.hintUsed);
      const unassisted = valid.filter((a) => !a.hintUsed);

      const errByStudent = new Map<string, number>();
      for (const att of incorrect) {
        errByStudent.set(att.studentId, (errByStudent.get(att.studentId) || 0) + 1);
      }
      let repStuCount = 0;
      for (const c of errByStudent.values()) {
        if (c >= threshold) repStuCount++;
      }

      const durations = valid.map((a) => a.responseDurationMs).filter((d) => d > 0).sort((a, b) => a - b);
      const med = durations.length ? durations[Math.floor(durations.length / 2)] : 0;
      const p90 = durations.length ? durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * 0.9))] : 0;

      // Follow current question's subject if question exists in curated table, else latest attempt subject
      const qRow = this.db.prepare('SELECT subject_id FROM questions WHERE id = ?').get(qId) as
        | { subject_id: string }
        | undefined;
      const subjectId = qRow?.subject_id || list[list.length - 1].subjectId;

      insertQS.run(
        qId,
        subjectId,
        list.length,
        valid.length,
        skipped.length,
        timedOut.length,
        uniqueStu.size,
        correct.length,
        incorrect.length,
        valid.length > 0 ? Math.round((correct.length / valid.length) * 1000) / 10 : 0,
        valid.length > 0 ? Math.round((incorrect.length / valid.length) * 1000) / 10 : 0,
        first.length,
        first.filter((a) => a.isCorrect === true).length,
        repeat.length,
        repeat.filter((a) => a.isCorrect === true).length,
        hint.length,
        hint.filter((a) => a.isCorrect === true).length,
        unassisted.length,
        unassisted.filter((a) => a.isCorrect === true).length,
        repStuCount,
        med,
        p90,
        now
      );
    }
  }

  private applyMigration3KnowledgeSchemaAndSeeds(): void {
    // 1. Safe additive columns on users and notifications
    const userCols = (
      this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
    ).map((c) => c.name);
    if (!userCols.includes('grade')) {
      this.db.exec(`ALTER TABLE users ADD COLUMN grade TEXT NOT NULL DEFAULT 'Grade 5';`);
    }
    if (!userCols.includes('delegated_publish_subjects_json')) {
      this.db.exec(
        `ALTER TABLE users ADD COLUMN delegated_publish_subjects_json TEXT NOT NULL DEFAULT '[]';`
      );
    }

    const notifCols = (
      this.db.prepare('PRAGMA table_info(notifications)').all() as { name: string }[]
    ).map((c) => c.name);
    if (!notifCols.includes('related_publication_id')) {
      this.db.exec(`ALTER TABLE notifications ADD COLUMN related_publication_id TEXT;`);
    }

    // 2. Knowledge Discovery & Publishing Relational Tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_publications (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        knowledge_type TEXT NOT NULL,
        subject_id TEXT NOT NULL REFERENCES subjects(id),
        topic_id TEXT NOT NULL,
        subtopic_id TEXT NOT NULL,
        target_grades_json TEXT NOT NULL DEFAULT '["Grade 5"]',
        language TEXT NOT NULL DEFAULT 'bilingual',
        audience_group TEXT NOT NULL DEFAULT 'all_students',
        learning_needs TEXT NOT NULL DEFAULT '',
        cover_image_url TEXT,
        source_title TEXT NOT NULL DEFAULT '',
        source_url TEXT,
        source_published_at TEXT,
        verification_date TEXT,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL,
        reviewer_id TEXT,
        reviewer_name TEXT,
        status TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING_REVIEW','APPROVED','SCHEDULED','PUBLISHED','ARCHIVED','WITHDRAWN','REJECTED')),
        scheduled_for TEXT,
        published_at TEXT,
        correction_notice TEXT,
        ai_assisted INTEGER NOT NULL DEFAULT 0,
        ai_draft_warnings_json TEXT NOT NULL DEFAULT '[]',
        checklist_json TEXT NOT NULL,
        current_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS publication_versions (
        id TEXT PRIMARY KEY,
        publication_id TEXT NOT NULL REFERENCES knowledge_publications(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        change_note TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        changed_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS publication_resources (
        id TEXT PRIMARY KEY,
        publication_id TEXT NOT NULL REFERENCES knowledge_publications(id) ON DELETE CASCADE,
        resource_type TEXT NOT NULL CHECK (resource_type IN ('image','pdf','document','worksheet','external_link','video_link','linked_quiz')),
        title TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        storage_path TEXT,
        external_url TEXT,
        linked_quiz_ids_json TEXT NOT NULL DEFAULT '[]',
        is_cover INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        uploaded_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS publication_review_actions (
        id TEXT PRIMARY KEY,
        publication_id TEXT NOT NULL REFERENCES knowledge_publications(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS publication_campaigns (
        id TEXT PRIMARY KEY,
        publication_id TEXT NOT NULL REFERENCES knowledge_publications(id) ON DELETE CASCADE,
        publication_title TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        triggered_by_name TEXT NOT NULL,
        channels_json TEXT NOT NULL,
        target_grades_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        total_eligible INTEGER NOT NULL DEFAULT 0,
        delivered_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS publication_deliveries (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES publication_campaigns(id) ON DELETE CASCADE,
        publication_id TEXT NOT NULL REFERENCES knowledge_publications(id) ON DELETE CASCADE,
        recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_name TEXT NOT NULL,
        recipient_role TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('in_app','email','whatsapp')),
        delivery_status TEXT NOT NULL CHECK (delivery_status IN ('delivered','skipped_unverified','skipped_preference','failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        delivered_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(campaign_id, recipient_user_id, channel)
      );

      CREATE TABLE IF NOT EXISTS publication_engagement_events (
        id TEXT PRIMARY KEY,
        publication_id TEXT NOT NULL REFERENCES knowledge_publications(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK (event_type IN ('view','resource_download','link_click','quiz_complete','bookmark')),
        resource_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS student_saved_publications (
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        publication_id TEXT NOT NULL REFERENCES knowledge_publications(id) ON DELETE CASCADE,
        saved_at TEXT NOT NULL,
        PRIMARY KEY (student_id, publication_id)
      );

      CREATE TABLE IF NOT EXISTS knowledge_discovery_queue (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        suggested_subject_id TEXT NOT NULL,
        suggested_topic_id TEXT NOT NULL,
        suggested_grades_json TEXT NOT NULL,
        language TEXT NOT NULL,
        source_title TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_published_at TEXT NOT NULL,
        relevance_score REAL NOT NULL DEFAULT 0.85,
        duplicate_matches_json TEXT NOT NULL DEFAULT '[]',
        uncertainty_flags_json TEXT NOT NULL DEFAULT '[]',
        ai_generated INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONVERTED','DISMISSED')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_kpub_status_subj ON knowledge_publications(status, subject_id);
      CREATE INDEX IF NOT EXISTS idx_kpub_sched ON knowledge_publications(status, scheduled_for);
      CREATE INDEX IF NOT EXISTS idx_kres_pub ON publication_resources(publication_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_kdeliv_camp ON publication_deliveries(campaign_id, delivery_status);
      CREATE INDEX IF NOT EXISTS idx_keng_pub_user ON publication_engagement_events(publication_id, user_id, event_type);
    `);

    const existingPubCount = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM knowledge_publications').get() as { cnt: number }
    ).cnt;
    if (existingPubCount > 0) return;

    const uploadDir = this.knowledgeUploadDir;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const worksheetContent = [
      'MAN 5HE Grade 5 Scholarship Revision Worksheet — Multiplication & Division Fact Families',
      '=====================================================================================',
      '1. Fact Family Triangle: 12 x 8 = 96  ->  96 / 8 = 12  and  96 / 12 = 8',
      '2. Word Problem: 144 mangoes packed equally into 12 baskets = 12 mangoes per basket.',
      '3. Bus Stop Check: Always multiply quotient x divisor + remainder to double-check!',
    ].join('\n');
    const worksheetRelPath = 'seed-division-fact-families.txt';
    fs.writeFileSync(path.join(uploadDir, worksheetRelPath), worksheetContent, 'utf8');

    const checklistVerified = JSON.stringify({
      factualAccuracy: true,
      sourceReliability: true,
      gradeSuitability: true,
      curriculumRelevance: true,
      languageClarity: true,
      resourceSafety: true,
      copyrightLicensing: true,
      accessibility: true,
      notes: 'Verified by Grade 5 Scholarship Editorial Panel.',
    });

    const checklistPending = JSON.stringify({
      factualAccuracy: true,
      sourceReliability: true,
      gradeSuitability: true,
      curriculumRelevance: true,
      languageClarity: false,
      resourceSafety: true,
      copyrightLicensing: false,
      accessibility: false,
      notes: 'Awaiting editorial language & copyright sign-off.',
    });

    const insertPub = this.db.prepare(
      `INSERT OR IGNORE INTO knowledge_publications (
        id, title, summary, body, knowledge_type, subject_id, topic_id, subtopic_id,
        target_grades_json, language, audience_group, learning_needs, cover_image_url,
        source_title, source_url, source_published_at, verification_date,
        author_id, author_name, author_role, reviewer_id, reviewer_name,
        status, scheduled_for, published_at, correction_notice, ai_assisted,
        ai_draft_warnings_json, checklist_json, current_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const seedPubs = [
      {
        id: 'PUB-2026-001',
        title: 'Multiplication & Division Fact Triangles: Zero-Mistake Check',
        summary:
          'Visual triangle strategy connecting multiplication and division so Grade 5 students verify word problems in under 15 seconds.',
        body: [
          'In Sri Lanka Grade 5 Scholarship Part II mathematics, many students lose marks by misreading whether a word problem asks for sharing (division) or equal groups (multiplication).',
          'Step 1 — Draw the Fact Triangle: Put the biggest total at the top peak (for example, 96) and the two smaller factors at the bottom corners (8 and 12).',
          'Step 2 — Cover what is missing: Covering a bottom corner means divide the peak by the other corner (96 ÷ 8 = 12). Covering the peak means multiply the two bottom corners (8 × 12 = 96).',
          'Step 3 — Fast Reality Check: If you share 96 sweets among 8 friends, each friend must get FEWER than 96 sweets. Use the linked Grade 5 quizzes below to test this strategy!',
        ].join('\n\n'),
        knowledgeType: 'concept_guide',
        subjectId: 'subj-math',
        topicId: 'top-math-arith',
        subtopicId: 'sub-math-div',
        targetGrades: ['Grade 5'],
        language: 'bilingual',
        audienceGroup: 'all_students',
        learningNeeds: 'Word-problem verification & division fluency',
        sourceTitle: 'NIE Grade 5 Mathematics Teacher Instructional Manual',
        sourceUrl: 'https://www.nie.ac.lk/',
        sourcePublishedAt: '2026-01-15',
        verificationDate: '2026-11-10T09:00:00.000Z',
        authorId: 'usr-teacher-1',
        authorName: 'Ms. Nimali Fernando',
        authorRole: 'teacher',
        reviewerId: 'usr-admin-1',
        reviewerName: 'Kavinda Wickramasinghe',
        status: 'PUBLISHED',
        publishedAt: '2026-11-12T08:00:00.000Z',
        checklist: checklistVerified,
        createdAt: '2026-11-10T08:30:00.000Z',
      },
      {
        id: 'PUB-2026-002',
        title: 'Sigiriya Water Gardens & Sri Lankan Endemic Plants (පරිසරය)',
        summary:
          'How ancient Sri Lankan engineers built gravity-fed fountain gardens at Sigiriya and key island flora facts tested in Scholarship Paper I.',
        body: [
          'Grade 5 Environmental Studies (පරිසරය ආශ්‍රිත ක්‍රියාකාරකම්) connects Sri Lankan heritage with water conservation and local biodiversity.',
          '1. Hydraulic Gravity Fountains: Water from the Sigiriya moat flows through underground clay and stone conduits; pressure pushes water skyward whenever seasonal monsoon pools fill.',
          '2. Endemic Flora Memory Hook: Remember "K-N-H" — Hora, Na (Sri Lanka national tree), and Kekuna thrive across wet-zone forest belts.',
          '3. District Heritage Check: Sigiriya sits in Matale District (Central Province), bordered by Anuradhapura and Polonnaruwa heritage corridors.',
        ].join('\n\n'),
        knowledgeType: 'curriculum_discovery',
        subjectId: 'subj-env',
        topicId: 'top-env-srilanka',
        subtopicId: 'sub-env-districts',
        targetGrades: ['Grade 5', 'Grade 4'],
        language: 'bilingual',
        audienceGroup: 'all_students',
        learningNeeds: 'Environmental Studies visual recall',
        sourceTitle: 'Central Cultural Fund Heritage Primer & NIE Grade 5 Syllabus',
        sourceUrl: 'https://ccf.gov.lk/',
        sourcePublishedAt: '2026-02-04',
        verificationDate: '2026-11-14T10:00:00.000Z',
        authorId: 'usr-teacher-2',
        authorName: 'Mr. Suren Kumar',
        authorRole: 'teacher',
        reviewerId: 'usr-admin-1',
        reviewerName: 'Kavinda Wickramasinghe',
        status: 'PUBLISHED',
        publishedAt: '2026-11-14T11:00:00.000Z',
        checklist: checklistVerified,
        createdAt: '2026-11-13T09:00:00.000Z',
      },
      {
        id: 'PUB-2026-003',
        title: 'Sinhala Nipatha (නිපාත පද) & Proverb Story Bridges',
        summary:
          'Colour-coded memory bridges to tell Nipatha particles apart from nouns and verbs during rapid Paper I grammar checks.',
        body: [
          'Nipatha words (නිපාත පද) never change for singular or plural nouns—they act like sturdy railway bridges connecting parts of a sentence.',
          'Common Grade 5 Scholarship pairs: පිණිස (for the purpose of), මෙන් (like/similar to), සමඟ (together with), නිසා (because of).',
          'Quick Exam Test: Replace the subject from "ළමයා" (child) to "ළමයි" (children). If the connecting word stays identical, it is a Nipatha bridge!',
        ].join('\n\n'),
        knowledgeType: 'exam_strategy',
        subjectId: 'subj-sinhala',
        topicId: 'top-sin-grammar',
        subtopicId: 'sub-sin-nipatha',
        targetGrades: ['Grade 5'],
        language: 'si',
        audienceGroup: 'all_students',
        learningNeeds: 'Sinhala grammar accuracy',
        sourceTitle: 'Department of Examinations Past Paper Marking Scheme Review',
        sourceUrl: 'https://www.doenets.lk/',
        sourcePublishedAt: '2026-03-01',
        verificationDate: '2026-11-15T09:30:00.000Z',
        authorId: 'usr-admin-1',
        authorName: 'Kavinda Wickramasinghe',
        authorRole: 'admin',
        reviewerId: 'usr-admin-1',
        reviewerName: 'Kavinda Wickramasinghe',
        status: 'PUBLISHED',
        publishedAt: '2026-11-15T10:00:00.000Z',
        checklist: checklistVerified,
        createdAt: '2026-11-15T09:00:00.000Z',
      },
      {
        id: 'PUB-2026-004',
        title: 'Queue Overlap Visual Ladder: Avoiding Double-Count Mistakes',
        summary:
          'Teacher-authored guide using stick-figure ladders so students subtract 1 accurately in front-and-back queue ranking problems.',
        body: [
          'Whenever a student counts 7th from the front and 9th from the back, the student themselves is counted twice.',
          'Formula: Total in Queue = Front Position + Back Position - 1. Practice drawing a 5-person mini-queue first to feel why 1 must be subtracted.',
        ].join('\n\n'),
        knowledgeType: 'concept_guide',
        subjectId: 'subj-logic',
        topicId: 'top-logic-rank',
        subtopicId: 'sub-logic-queue',
        targetGrades: ['Grade 5'],
        language: 'bilingual',
        audienceGroup: 'all_students',
        learningNeeds: 'Repeated error remediation in Logical Reasoning',
        sourceTitle: 'MAN 5HE Teacher Intervention Findings (CUR-007)',
        sourceUrl: null,
        sourcePublishedAt: '2026-11-18',
        verificationDate: null,
        authorId: 'usr-teacher-1',
        authorName: 'Ms. Nimali Fernando',
        authorRole: 'teacher',
        reviewerId: null,
        reviewerName: null,
        status: 'PENDING_REVIEW',
        publishedAt: null,
        checklist: checklistPending,
        createdAt: '2026-11-18T11:00:00.000Z',
      },
      {
        id: 'PUB-2026-G6',
        title: 'Grade 6 Algebra Transition: Unknown Box Notation',
        summary:
          'Bridge lesson introducing symbolic variables (x, y) exclusively for Grade 6 learners transitioning after the Scholarship exam.',
        body: [
          'Grade 6 students transition from empty box arithmetic (□ + 5 = 12) to letter symbols (x + 5 = 12).',
        ].join('\n\n'),
        knowledgeType: 'concept_guide',
        subjectId: 'subj-math',
        topicId: 'top-math-arith',
        subtopicId: 'sub-math-div',
        targetGrades: ['Grade 6'],
        language: 'en',
        audienceGroup: 'grade_6_bridge',
        learningNeeds: 'Post-scholarship bridge',
        sourceTitle: 'NIE Grade 6 Mathematics Syllabus Preview',
        sourceUrl: 'https://www.nie.ac.lk/',
        sourcePublishedAt: '2026-04-01',
        verificationDate: '2026-11-16T08:00:00.000Z',
        authorId: 'usr-admin-1',
        authorName: 'Kavinda Wickramasinghe',
        authorRole: 'admin',
        reviewerId: 'usr-admin-1',
        reviewerName: 'Kavinda Wickramasinghe',
        status: 'PUBLISHED',
        publishedAt: '2026-11-16T09:00:00.000Z',
        checklist: checklistVerified,
        createdAt: '2026-11-16T08:00:00.000Z',
      },
    ];

    const insertVer = this.db.prepare(
      `INSERT OR IGNORE INTO publication_versions (
        id, publication_id, version_number, title, summary, body, change_note, changed_by, changed_by_name, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, 'Initial publication seed', ?, ?, ?)`
    );

    const insertRev = this.db.prepare(
      `INSERT OR IGNORE INTO publication_review_actions (
        id, publication_id, actor_id, actor_name, actor_role, action_type, from_status, to_status, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const p of seedPubs) {
      insertPub.run(
        p.id,
        p.title,
        p.summary,
        p.body,
        p.knowledgeType,
        p.subjectId,
        p.topicId,
        p.subtopicId,
        JSON.stringify(p.targetGrades),
        p.language,
        p.audienceGroup,
        p.learningNeeds,
        null,
        p.sourceTitle,
        p.sourceUrl,
        p.sourcePublishedAt,
        p.verificationDate,
        p.authorId,
        p.authorName,
        p.authorRole,
        p.reviewerId,
        p.reviewerName,
        p.status,
        null,
        p.publishedAt,
        null,
        0,
        '[]',
        p.checklist,
        1,
        p.createdAt,
        p.createdAt
      );
      insertVer.run(
        `PV-${p.id}-v1`,
        p.id,
        p.title,
        p.summary,
        p.body,
        p.authorId,
        p.authorName,
        p.createdAt
      );
      insertRev.run(
        `PRA-${p.id}-1`,
        p.id,
        p.authorId,
        p.authorName,
        p.authorRole,
        p.status === 'PUBLISHED' ? 'PUBLISHED' : 'SUBMITTED_FOR_REVIEW',
        'DRAFT',
        p.status,
        p.status === 'PUBLISHED' ? 'Verified and published for curriculum cohort.' : 'Submitted for editorial review.',
        p.createdAt
      );
    }

    // Seed Resources (1 downloadable worksheet, 2 external links, 2 linked quizzes)
    this.db
      .prepare(
        `INSERT OR IGNORE INTO publication_resources (
          id, publication_id, resource_type, title, mime_type, size_bytes, storage_path,
          external_url, linked_quiz_ids_json, is_cover, sort_order, uploaded_by, created_at
        ) VALUES
        ('RES-SEED-001', 'PUB-2026-001', 'worksheet', 'Division Fact Families Practice Sheet (TXT)', 'text/plain', ?, ?, NULL, '[]', 0, 1, 'usr-teacher-1', '2026-11-12T08:00:00.000Z'),
        ('RES-SEED-002', 'PUB-2026-001', 'linked_quiz', 'Related Math Practice Questions', 'application/json', 0, NULL, NULL, '["CUR-002","CUR-004"]', 0, 2, 'usr-teacher-1', '2026-11-12T08:00:00.000Z'),
        ('RES-SEED-003', 'PUB-2026-002', 'external_link', 'Department of Archaeology — Sigiriya Heritage Reference', 'text/html', 0, NULL, 'https://www.archaeology.gov.lk/', '[]', 0, 1, 'usr-teacher-2', '2026-11-14T11:00:00.000Z'),
        ('RES-SEED-004', 'PUB-2026-002', 'linked_quiz', 'Environmental Studies Practice Check', 'application/json', 0, NULL, NULL, '["CUR-005"]', 0, 2, 'usr-teacher-2', '2026-11-14T11:00:00.000Z'),
        ('RES-SEED-005', 'PUB-2026-003', 'linked_quiz', 'Sinhala Nipatha Grammar Challenge', 'application/json', 0, NULL, NULL, '["CUR-006"]', 0, 1, 'usr-admin-1', '2026-11-15T10:00:00.000Z')`
      )
      .run(Buffer.byteLength(worksheetContent, 'utf8'), worksheetRelPath);

    // Seed sample Campaign + Delivery + Engagement Events
    this.db
      .prepare(
        `INSERT OR IGNORE INTO publication_campaigns (
          id, publication_id, publication_title, triggered_by, triggered_by_name,
          channels_json, target_grades_json, idempotency_key,
          total_eligible, delivered_count, skipped_count, failed_count, created_at
        ) VALUES (
          'CMP-SEED-001', 'PUB-2026-001', 'Multiplication & Division Fact Triangles: Zero-Mistake Check',
          'usr-admin-1', 'Kavinda Wickramasinghe', '["in_app","email","whatsapp"]', '["Grade 5"]',
          'seed-cmp-pub-001', 2, 6, 0, 0, '2026-11-12T08:05:00.000Z'
        )`
      )
      .run();

    this.db
      .prepare(
        `INSERT OR IGNORE INTO publication_deliveries (
          id, campaign_id, publication_id, recipient_user_id, recipient_name, recipient_role,
          channel, delivery_status, retry_count, error_message, delivered_at, created_at
        ) VALUES
        ('DLV-SEED-01', 'CMP-SEED-001', 'PUB-2026-001', 'usr-student-1', 'Sayuri Perera', 'student', 'in_app', 'delivered', 0, NULL, '2026-11-12T08:05:01.000Z', '2026-11-12T08:05:01.000Z'),
        ('DLV-SEED-02', 'CMP-SEED-001', 'PUB-2026-001', 'usr-student-1', 'Sayuri Perera', 'student', 'email', 'delivered', 0, NULL, '2026-11-12T08:05:01.000Z', '2026-11-12T08:05:01.000Z'),
        ('DLV-SEED-03', 'CMP-SEED-001', 'PUB-2026-001', 'usr-student-1', 'Sayuri Perera', 'student', 'whatsapp', 'delivered', 0, NULL, '2026-11-12T08:05:01.000Z', '2026-11-12T08:05:01.000Z'),
        ('DLV-SEED-04', 'CMP-SEED-001', 'PUB-2026-001', 'usr-student-2', 'Kasun Jayasinghe', 'student', 'in_app', 'delivered', 0, NULL, '2026-11-12T08:05:02.000Z', '2026-11-12T08:05:02.000Z'),
        ('DLV-SEED-05', 'CMP-SEED-001', 'PUB-2026-001', 'usr-student-2', 'Kasun Jayasinghe', 'student', 'email', 'delivered', 0, NULL, '2026-11-12T08:05:02.000Z', '2026-11-12T08:05:02.000Z'),
        ('DLV-SEED-06', 'CMP-SEED-001', 'PUB-2026-001', 'usr-student-2', 'Kasun Jayasinghe', 'student', 'whatsapp', 'delivered', 0, NULL, '2026-11-12T08:05:02.000Z', '2026-11-12T08:05:02.000Z')`
      )
      .run();

    this.db
      .prepare(
        `INSERT OR IGNORE INTO publication_engagement_events (
          id, publication_id, user_id, event_type, resource_id, metadata_json, created_at
        ) VALUES
        ('ENG-SEED-01', 'PUB-2026-001', 'usr-student-1', 'view', NULL, '{}', '2026-11-12T10:15:00.000Z'),
        ('ENG-SEED-02', 'PUB-2026-001', 'usr-student-1', 'resource_download', 'RES-SEED-001', '{}', '2026-11-12T10:16:00.000Z'),
        ('ENG-SEED-03', 'PUB-2026-002', 'usr-student-1', 'view', NULL, '{}', '2026-11-14T15:00:00.000Z'),
        ('ENG-SEED-04', 'PUB-2026-002', 'usr-student-2', 'view', NULL, '{}', '2026-11-14T16:10:00.000Z'),
        ('ENG-SEED-05', 'PUB-2026-002', 'usr-student-2', 'link_click', 'RES-SEED-003', '{}', '2026-11-14T16:12:00.000Z')`
      )
      .run();

    this.db
      .prepare(
        `INSERT OR IGNORE INTO notifications (
          id, recipient_user_id, recipient_role, channel, category, title, body,
          related_subject_id, related_publication_id, dedupe_key, delivery_status, retry_count, created_at
        ) VALUES (
          'NTF-SEED-PUB-1', 'usr-student-1', 'student', 'in_app', 'knowledge_publication',
          'New Study Guide: Multiplication & Division Fact Triangles',
          'Ms. Nimali Fernando published a Grade 5 Mathematics concept guide with a downloadable worksheet.',
          'subj-math', 'PUB-2026-001', 'seed-ntf-pub-001-stu-1', 'delivered', 0, '2026-11-12T08:05:01.000Z'
        )`
      )
      .run();
  }

  private applyMigration4AssessmentAndQuestionLifecycleSchema(): void {
    // 1. Safe additive columns on questions table (preserving all existing CUR-* rows & attempts)
    const qCols = (
      this.db.prepare('PRAGMA table_info(questions)').all() as { name: string }[]
    ).map((c) => c.name);

    const addQuestionCol = (colName: string, ddl: string) => {
      if (!qCols.includes(colName)) {
        this.db.exec(`ALTER TABLE questions ADD COLUMN ${ddl};`);
      }
    };

    addQuestionCol('grade', `grade TEXT NOT NULL DEFAULT 'Grade 5'`);
    addQuestionCol('question_type', `question_type TEXT NOT NULL DEFAULT 'mcq'`);
    addQuestionCol('cognitive_skill', `cognitive_skill TEXT NOT NULL DEFAULT 'Application'`);
    addQuestionCol('learning_objectives', `learning_objectives TEXT NOT NULL DEFAULT ''`);
    addQuestionCol('hint', `hint TEXT NOT NULL DEFAULT ''`);
    addQuestionCol('marking_rule_json', `marking_rule_json TEXT NOT NULL DEFAULT '{}'`);
    addQuestionCol('accepted_answers_json', `accepted_answers_json TEXT NOT NULL DEFAULT '[]'`);
    addQuestionCol('default_marks', `default_marks INTEGER NOT NULL DEFAULT 1`);
    addQuestionCol('approval_status', `approval_status TEXT NOT NULL DEFAULT 'ACTIVE'`);
    addQuestionCol('author_id', `author_id TEXT NOT NULL DEFAULT 'usr-admin-1'`);
    addQuestionCol('author_name', `author_name TEXT NOT NULL DEFAULT 'Kavinda Wickramasinghe'`);
    addQuestionCol('reviewer_id', `reviewer_id TEXT`);
    addQuestionCol('reviewer_name', `reviewer_name TEXT`);
    addQuestionCol('reviewed_at', `reviewed_at TEXT`);
    addQuestionCol('rejection_reason', `rejection_reason TEXT`);
    addQuestionCol('retired_at', `retired_at TEXT`);
    addQuestionCol('replaced_by_question_id', `replaced_by_question_id TEXT`);

    // 2. Question Lifecycle Review Actions & Assessment Builder Relational Tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS question_review_actions (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assessments (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('practice_session','mock_exam')),
        title TEXT NOT NULL,
        title_si TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        grade TEXT NOT NULL DEFAULT 'Grade 5',
        subject_ids_json TEXT NOT NULL DEFAULT '[]',
        topic_ids_json TEXT NOT NULL DEFAULT '[]',
        subtopic_ids_json TEXT NOT NULL DEFAULT '[]',
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL,
        reviewer_id TEXT,
        reviewer_name TEXT,
        status TEXT NOT NULL CHECK (status IN ('DRAFT','VALIDATED','APPROVED','SCHEDULED','PUBLISHED','ACTIVE','CLOSED','RESULTS_RELEASED','ARCHIVED','CANCELLED','WITHDRAWN')),
        selection_mode TEXT NOT NULL DEFAULT 'manual' CHECK (selection_mode IN ('manual','deterministic','randomized','adaptive_gap')),
        shuffle_questions INTEGER NOT NULL DEFAULT 0,
        shuffle_options INTEGER NOT NULL DEFAULT 0,
        show_hints INTEGER NOT NULL DEFAULT 1,
        explanation_timing TEXT NOT NULL DEFAULT 'after_submit' CHECK (explanation_timing IN ('immediate','after_submit','after_release')),
        time_limit_minutes INTEGER,
        max_attempts INTEGER NOT NULL DEFAULT 1,
        total_marks INTEGER NOT NULL DEFAULT 0,
        pass_mark_percent INTEGER NOT NULL DEFAULT 50,
        available_from TEXT,
        available_until TEXT,
        scheduled_for TEXT,
        results_released_at TEXT,
        current_version INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assessment_sections (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        instructions TEXT NOT NULL DEFAULT '',
        subject_id TEXT,
        total_marks INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS assessment_question_snapshots (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL DEFAULT 1,
        section_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 1,
        question_id TEXT NOT NULL,
        question_version INTEGER NOT NULL DEFAULT 1,
        marks INTEGER NOT NULL DEFAULT 1,
        snapshot_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assessment_assignments (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('grade','cohort','student')),
        target_value TEXT NOT NULL,
        assigned_by TEXT NOT NULL,
        assigned_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assessment_attempts (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        assessment_version INTEGER NOT NULL DEFAULT 1,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL CHECK (status IN ('in_progress','submitted','pending_manual_marking','graded','timed_out')),
        started_at TEXT NOT NULL,
        expires_at TEXT,
        submitted_at TEXT,
        server_duration_seconds INTEGER NOT NULL DEFAULT 0,
        shuffled_order_json TEXT NOT NULL DEFAULT '[]',
        shuffled_options_map_json TEXT NOT NULL DEFAULT '{}',
        auto_score REAL NOT NULL DEFAULT 0,
        manual_score REAL NOT NULL DEFAULT 0,
        total_awarded_marks REAL NOT NULL DEFAULT 0,
        max_marks REAL NOT NULL DEFAULT 0,
        score_percent REAL,
        idempotency_key TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS assessment_answers (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
        snapshot_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        question_version INTEGER NOT NULL DEFAULT 1,
        submitted_answer_text TEXT,
        submitted_option_index INTEGER,
        is_correct INTEGER,
        marking_status TEXT NOT NULL DEFAULT 'auto_graded' CHECK (marking_status IN ('auto_graded','pending_manual','manually_graded')),
        awarded_marks REAL NOT NULL DEFAULT 0,
        max_marks REAL NOT NULL DEFAULT 1,
        grader_id TEXT,
        grader_comment TEXT,
        response_duration_ms INTEGER NOT NULL DEFAULT 0,
        hint_used INTEGER NOT NULL DEFAULT 0,
        answered_at TEXT NOT NULL,
        UNIQUE(attempt_id, snapshot_id)
      );

      CREATE INDEX IF NOT EXISTS idx_questions_bank_filter ON questions(subject_id, approval_status, question_type, grade, active);
      CREATE INDEX IF NOT EXISTS idx_assessments_kind_status ON assessments(kind, status, grade);
      CREATE INDEX IF NOT EXISTS idx_assessment_snapshots_asm ON assessment_question_snapshots(assessment_id, version_number, sort_order);
      CREATE INDEX IF NOT EXISTS idx_assessment_attempts_user ON assessment_attempts(assessment_id, student_id, status);
      CREATE INDEX IF NOT EXISTS idx_assessment_answers_attempt ON assessment_answers(attempt_id, marking_status);
    `);

    // 3. Seed multi-type curated questions (numerical, true_false, short_answer) so all question types work out-of-the-box
    const now = '2026-11-18T08:00:00.000Z';
    const extraQuestions: QuizItem[] = [
      {
        id: 'CUR-009',
        source: 'curated',
        subjectId: 'subj-math',
        topicId: 'top-math-arith',
        subtopicId: 'sub-math-div',
        version: 1,
        grade: 'Grade 5',
        questionType: 'numerical',
        cognitiveSkill: 'Numerical Computation',
        learningObjectives: 'Divide 3-digit totals equally and verify with multiplication.',
        hint: 'Think: 12 times what number equals 144?',
        markingRule: { numericTolerance: 0.01, requiresManualReview: false },
        acceptedAnswers: ['12'],
        defaultMarks: 2,
        approvalStatus: 'ACTIVE',
        authorId: 'usr-teacher-1',
        authorName: 'Ms. Nimali Fernando',
        questionSi: 'අඹ ගෙඩි 144ක් පෙට්ටි 12කට සමානව ඇසුරූ විට එක් පෙට්ටියක අඹ ගෙඩි කීයක් තිබේද? (සංඛ්‍යාව පමණක් ලියන්න)',
        questionEn: '144 mangoes are packed equally into 12 boxes. How many mangoes are in each box? (Enter number only)',
        options: ['12', '10', '14', '16'],
        correctIndex: 0,
        memoryTrickTitle: 'Dozen Squared Partner (12 × 12 = 144)',
        memoryTrickBody: '12 is called a Dozen. When 12 friends each bring 12 mangoes, they fill 144!',
        explanation: '144 ÷ 12 = 12 mangoes per box. Check: 12 × 12 = 144.',
        attributes: {
          intelligenceMeasure: 42,
          correctProbability: 0.72,
          wrongProbability: 0.28,
          examPriority: 9,
          quizStrength: 80,
          difficultyTier: 'Moderate',
          cognitiveDomain: 'Mathematics & Word Problems',
          estimatedSeconds: 35,
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'CUR-010',
        source: 'curated',
        subjectId: 'subj-env',
        topicId: 'top-env-srilanka',
        subtopicId: 'sub-env-districts',
        version: 1,
        grade: 'Grade 5',
        questionType: 'true_false',
        cognitiveSkill: 'Recall & Verification',
        learningObjectives: 'Identify Sri Lankan provinces and heritage locations.',
        hint: 'Sigiriya is in Matale District.',
        markingRule: { requiresManualReview: false },
        acceptedAnswers: ['True'],
        defaultMarks: 1,
        approvalStatus: 'ACTIVE',
        authorId: 'usr-teacher-2',
        authorName: 'Mr. Suren Kumar',
        questionSi: 'සීගිරිය පර්වත බලකොටුව පිහිටා ඇත්තේ මධ්‍යම පළාතේ මාතලේ දිස්ත්‍රික්කයේය. මෙය සත්‍යද අසත්‍යද?',
        questionEn: 'Sigiriya Rock Fortress is located in Matale District of the Central Province. True or False?',
        options: ['True (සත්‍යයි)', 'False (අසත්‍යයි)', '', ''],
        correctIndex: 0,
        memoryTrickTitle: 'C-M-S Heritage Chain',
        memoryTrickBody: 'Central Province -> Matale District -> Sigiriya! Remember C-M-S.',
        explanation: 'Sigiriya is in Matale District, Central Province, Sri Lanka.',
        attributes: {
          intelligenceMeasure: 30,
          correctProbability: 0.85,
          wrongProbability: 0.15,
          examPriority: 7,
          quizStrength: 68,
          difficultyTier: 'Simple',
          cognitiveDomain: 'Environmental Studies (පරිසරය)',
          estimatedSeconds: 20,
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'CUR-011',
        source: 'curated',
        subjectId: 'subj-english',
        topicId: 'top-eng-comp',
        subtopicId: 'sub-eng-compass',
        version: 1,
        grade: 'Grade 5',
        questionType: 'short_answer',
        cognitiveSkill: 'Vocabulary & Comprehension',
        learningObjectives: 'Produce exact opposite word in context.',
        hint: 'Opposite of "ancient" starts with M.',
        markingRule: { caseSensitive: false, requiresManualReview: false },
        acceptedAnswers: ['modern', 'new'],
        defaultMarks: 2,
        approvalStatus: 'ACTIVE',
        authorId: 'usr-teacher-2',
        authorName: 'Mr. Suren Kumar',
        questionSi: 'Write ONE word that is the opposite in meaning to "ancient".',
        questionEn: 'Write ONE word that is the opposite in meaning to "ancient".',
        options: ['modern', 'old', 'tall', 'quiet'],
        correctIndex: 0,
        memoryTrickTitle: 'Time Tunnel Switch',
        memoryTrickBody: 'Ancient = very old castle times; Modern = today with tablets and trains!',
        explanation: 'The antonym of "ancient" is "modern" (or "new").',
        attributes: {
          intelligenceMeasure: 48,
          correctProbability: 0.65,
          wrongProbability: 0.35,
          examPriority: 7,
          quizStrength: 74,
          difficultyTier: 'Moderate',
          cognitiveDomain: 'English & Comprehension',
          estimatedSeconds: 30,
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'CUR-012',
        source: 'curated',
        subjectId: 'subj-math',
        topicId: 'top-math-money',
        subtopicId: 'sub-math-change',
        version: 1,
        grade: 'Grade 5',
        questionType: 'short_answer',
        cognitiveSkill: 'Multi-step Reasoning',
        learningObjectives: 'Explain change calculation steps clearly.',
        hint: 'First find total spent on pens and book, then subtract from Rs. 500.',
        markingRule: { requiresManualReview: true, markingNotes: 'Award 1 mark for method (85+165=250) and 1 mark for final Rs. 250 answer.' },
        acceptedAnswers: ['250', 'Rs. 250'],
        defaultMarks: 2,
        approvalStatus: 'ACTIVE',
        authorId: 'usr-teacher-1',
        authorName: 'Ms. Nimali Fernando',
        questionSi: 'රු. 500 කින් රු. 85 ක පෑනක් හා රු. 165 ක පොතක් ගත් පසු ඉතිරි මුදල පියවර සමඟ ලියන්න.',
        questionEn: 'Show your steps to find the balance from Rs. 500 after buying a Rs. 85 pen and a Rs. 165 book.',
        options: ['Rs. 250', 'Rs. 350', 'Rs. 240', 'Rs. 150'],
        correctIndex: 0,
        memoryTrickTitle: 'Friendly Ten Pair (85 + 165)',
        memoryTrickBody: 'Combine 5 + 5 first to make a neat 10! 85 + 165 = 250, and half of 500 is 250!',
        explanation: 'Total spent = 85 + 165 = Rs. 250. Balance = 500 - 250 = Rs. 250.',
        attributes: {
          intelligenceMeasure: 62,
          correctProbability: 0.58,
          wrongProbability: 0.42,
          examPriority: 8,
          quizStrength: 82,
          difficultyTier: 'Moderate',
          cognitiveDomain: 'Mathematics & Word Problems',
          estimatedSeconds: 50,
        },
        createdAt: now,
        updatedAt: now,
      },
    ];

    const insertExtraQ = this.db.prepare(
      `INSERT OR IGNORE INTO questions (
        id, source, subject_id, topic_id, subtopic_id, version, grade, question_type,
        cognitive_skill, learning_objectives, hint, marking_rule_json, accepted_answers_json,
        default_marks, approval_status, author_id, author_name, reviewer_id, reviewer_name,
        reviewed_at, question_si, question_en, options_json, correct_index, image_url,
        memory_trick_title, memory_trick_body, explanation, misconceptions_json, attributes_json,
        quality_flag, active, created_by, created_at, updated_at
      ) VALUES (?, 'curated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usr-admin-1', 'Kavinda Wickramasinghe', ?, ?, ?, ?, ?, NULL, ?, ?, ?, '[]', ?, 'OK', 1, ?, ?, ?)`
    );
    const insertExtraVer = this.db.prepare(
      `INSERT OR IGNORE INTO question_versions (
        id, question_id, version, subject_id, topic_id, subtopic_id, snapshot_json, changed_by, change_note, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'Enhancement 03 multi-type curriculum seed', ?)`
    );

    for (const q of extraQuestions) {
      insertExtraQ.run(
        q.id,
        q.subjectId!,
        q.topicId!,
        q.subtopicId!,
        1,
        q.grade || 'Grade 5',
        q.questionType || 'mcq',
        q.cognitiveSkill || 'Application',
        q.learningObjectives || '',
        q.hint || '',
        JSON.stringify(q.markingRule || {}),
        JSON.stringify(q.acceptedAnswers || []),
        q.defaultMarks || 1,
        q.approvalStatus || 'ACTIVE',
        q.authorId || 'usr-admin-1',
        q.authorName || 'Kavinda Wickramasinghe',
        now,
        q.questionSi,
        q.questionEn,
        JSON.stringify(q.options),
        q.correctIndex,
        q.memoryTrickTitle,
        q.memoryTrickBody,
        q.explanation,
        JSON.stringify(q.attributes),
        q.authorName || 'teacher@man5he.lk',
        now,
        now
      );
      insertExtraVer.run(
        `QV-${q.id}-v1`,
        q.id,
        q.subjectId!,
        q.topicId!,
        q.subtopicId!,
        JSON.stringify(q),
        q.authorName || 'admin@man5he.lk',
        now
      );
    }

    // Backfill author_id on existing seed questions so Ms. Nimali & Mr. Suren own some domain items cleanly
    this.db.prepare(`UPDATE questions SET author_id = 'usr-teacher-1', author_name = 'Ms. Nimali Fernando' WHERE id IN ('CUR-001','CUR-002','CUR-003','CUR-004','CUR-007')`).run();
    this.db.prepare(`UPDATE questions SET author_id = 'usr-teacher-2', author_name = 'Mr. Suren Kumar' WHERE id IN ('CUR-005','CUR-006','CUR-008')`).run();

    // 4. Seed 1 Teacher-Authored Custom Practice Session (PRC-SEED-001) & 1 Structured Mock Exam (ASM-SEED-001)
    const resolveSeedSnapshot = (qId: string): QuizItem | null => {
      const row = this.db.prepare('SELECT * FROM questions WHERE id = ?').get(qId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        id: String(row.id),
        source: 'curated',
        subjectId: String(row.subject_id),
        topicId: String(row.topic_id),
        subtopicId: String(row.subtopic_id),
        version: Number(row.version ?? 1),
        grade: String(row.grade || 'Grade 5'),
        questionType: String(row.question_type || 'mcq') as QuizItem['questionType'],
        cognitiveSkill: String(row.cognitive_skill || 'Application'),
        learningObjectives: String(row.learning_objectives || ''),
        hint: String(row.hint || ''),
        markingRule: JSON.parse(String(row.marking_rule_json || '{}')),
        acceptedAnswers: JSON.parse(String(row.accepted_answers_json || '[]')),
        defaultMarks: Number(row.default_marks ?? 1),
        approvalStatus: String(row.approval_status || 'ACTIVE') as QuizItem['approvalStatus'],
        authorId: String(row.author_id || 'usr-admin-1'),
        authorName: String(row.author_name || 'Admin'),
        questionSi: String(row.question_si),
        questionEn: String(row.question_en),
        options: JSON.parse(String(row.options_json || '["","","",""]')),
        correctIndex: Number(row.correct_index ?? 0),
        imageUrl: row.image_url ? String(row.image_url) : undefined,
        memoryTrickTitle: String(row.memory_trick_title),
        memoryTrickBody: String(row.memory_trick_body),
        explanation: String(row.explanation),
        misconceptions: JSON.parse(String(row.misconceptions_json || '[]')),
        attributes: JSON.parse(String(row.attributes_json || '{}')),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    };

    const existingAsm = (this.db.prepare('SELECT COUNT(*) as cnt FROM assessments').get() as { cnt: number }).cnt;
    if (existingAsm === 0) {
      // Teacher Math Practice Session
      this.db
        .prepare(
          `INSERT INTO assessments (
            id, kind, title, title_si, description, instructions, grade, subject_ids_json, topic_ids_json, subtopic_ids_json,
            author_id, author_name, author_role, reviewer_id, reviewer_name, status, selection_mode,
            shuffle_questions, shuffle_options, show_hints, explanation_timing, time_limit_minutes, max_attempts,
            total_marks, pass_mark_percent, results_released_at, current_version, config_json, created_at, updated_at
          ) VALUES (
            'PRC-SEED-001', 'practice_session', 'Grade 5 Math Word Problems & Division Sprint',
            '5 ශ්‍රේණිය ගණිත ගැටලු පුහුණු සැසිය',
            'Teacher-guided practice combining bus-passenger subtraction, time duration, and numerical division.',
            'Take your time and check each step with a Fact Triangle. Hints and memory tricks unlock right away!',
            'Grade 5', '["subj-math"]', '["top-math-money","top-math-time","top-math-arith"]', '[]',
            'usr-teacher-1', 'Ms. Nimali Fernando', 'teacher', 'usr-admin-1', 'Kavinda Wickramasinghe',
            'PUBLISHED', 'manual', 0, 1, 1, 'immediate', 12, 5, 4, 60, ?, 1,
            '{"linkedKnowledgePublicationIds":["PUB-2026-001"],"questionTypes":["mcq","numerical"]}', ?, ?
          )`
        )
        .run(now, now, now);

      this.db
        .prepare(
          `INSERT INTO assessment_sections (id, assessment_id, version_number, sort_order, title, instructions, subject_id, total_marks)
           VALUES ('SEC-PRC-001', 'PRC-SEED-001', 1, 1, 'Core Math Practice', 'Answer all questions carefully.', 'subj-math', 4)`
        )
        .run();

      const prcQIds = ['CUR-002', 'CUR-004', 'CUR-009'];
      prcQIds.forEach((qid, idx) => {
        const snap = resolveSeedSnapshot(qid);
        if (!snap) return;
        const marks = snap.defaultMarks || 1;
        this.db
          .prepare(
            `INSERT INTO assessment_question_snapshots (id, assessment_id, version_number, section_id, sort_order, question_id, question_version, marks, snapshot_json)
             VALUES (?, 'PRC-SEED-001', 1, 'SEC-PRC-001', ?, ?, ?, ?, ?)`
          )
          .run(`SNAP-PRC-${idx + 1}`, idx + 1, qid, snap.version || 1, marks, JSON.stringify(snap));
      });

      this.db
        .prepare(
          `INSERT INTO assessment_assignments (id, assessment_id, target_type, target_value, assigned_by, assigned_at)
           VALUES ('AASN-PRC-1', 'PRC-SEED-001', 'grade', 'Grade 5', 'usr-teacher-1', ?)`
        )
        .run(now);

      // Admin Structured Multi-Section Mock Examination
      this.db
        .prepare(
          `INSERT INTO assessments (
            id, kind, title, title_si, description, instructions, grade, subject_ids_json, topic_ids_json, subtopic_ids_json,
            author_id, author_name, author_role, reviewer_id, reviewer_name, status, selection_mode,
            shuffle_questions, shuffle_options, show_hints, explanation_timing, time_limit_minutes, max_attempts,
            total_marks, pass_mark_percent, results_released_at, current_version, config_json, created_at, updated_at
          ) VALUES (
            'ASM-SEED-001', 'mock_exam', 'Scholarship Structured Mock Exam · Part I & II Sampler',
            'ශිෂ්‍යත්ව ව්‍යුහගත පෙරහුරු විභාගය 01',
            'Two-section timed mock paper blending MCQ, True/False, and Numerical response questions with strict server timing.',
            'Complete Section A (IQ & Environment) and Section B (Mathematics). Answers lock automatically when the timer ends.',
            'Grade 5', '["subj-logic","subj-env","subj-math","subj-english"]', '[]', '[]',
            'usr-admin-1', 'Kavinda Wickramasinghe', 'admin', 'usr-admin-1', 'Kavinda Wickramasinghe',
            'PUBLISHED', 'manual', 0, 1, 0, 'after_submit', 15, 3, 6, 55, NULL, 1,
            '{"linkedKnowledgePublicationIds":["PUB-2026-001","PUB-2026-002"]}', ?, ?
          )`
        )
        .run(now, now);

      this.db
        .prepare(
          `INSERT INTO assessment_sections (id, assessment_id, version_number, sort_order, title, instructions, subject_id, total_marks)
           VALUES
           ('SEC-ASM-A', 'ASM-SEED-001', 1, 1, 'Section A · Logical Reasoning & Environment', 'Read every statement carefully.', 'subj-logic', 2),
           ('SEC-ASM-B', 'ASM-SEED-001', 1, 2, 'Section B · Mathematics & Numerical Fluency', 'Enter exact numbers for numerical prompts.', 'subj-math', 4)`
        )
        .run();

      const mockItems = [
        { sec: 'SEC-ASM-A', qid: 'CUR-001', marks: 1, order: 1 },
        { sec: 'SEC-ASM-A', qid: 'CUR-010', marks: 1, order: 2 },
        { sec: 'SEC-ASM-B', qid: 'CUR-002', marks: 1, order: 3 },
        { sec: 'SEC-ASM-B', qid: 'CUR-009', marks: 2, order: 4 },
        { sec: 'SEC-ASM-B', qid: 'CUR-004', marks: 1, order: 5 },
      ];
      for (const item of mockItems) {
        const snap = resolveSeedSnapshot(item.qid);
        if (!snap) continue;
        this.db
          .prepare(
            `INSERT INTO assessment_question_snapshots (id, assessment_id, version_number, section_id, sort_order, question_id, question_version, marks, snapshot_json)
             VALUES (?, 'ASM-SEED-001', 1, ?, ?, ?, ?, ?, ?)`
          )
          .run(`SNAP-ASM-${item.order}`, item.sec, item.order, item.qid, snap.version || 1, item.marks, JSON.stringify(snap));
      }

      this.db
        .prepare(
          `INSERT INTO assessment_assignments (id, assessment_id, target_type, target_value, assigned_by, assigned_at)
           VALUES ('AASN-ASM-1', 'ASM-SEED-001', 'grade', 'Grade 5', 'usr-admin-1', ?)`
        )
        .run(now);
    }
  }

  public transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    }
  }
}
