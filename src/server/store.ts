import fs from 'node:fs';
import path from 'node:path';
import {
  calculatePaperQualityAndDifficulty,
  generateVirtualQuizFromPool,
} from '../lib/psychometrics.ts';
import {
  buildInvoiceEmailHtml,
  buildProgressEmailHtml,
  buildWhatsAppProgressMessage,
} from '../lib/notifications.ts';
import { hashPassword } from '../lib/security.ts';
import type {
  AttemptRecord,
  EmailLog,
  ExamPaper,
  InvoiceRecord,
  PaymentPlan,
  QuizItem,
  UserAccount,
  WhatsAppLog,
} from '../lib/types.ts';

export interface DatabaseState {
  users: UserAccount[];
  curatedQuizzes: QuizItem[];
  papers: ExamPaper[];
  attempts: AttemptRecord[];
  paymentPlans: PaymentPlan[];
  invoices: InvoiceRecord[];
  emailLogs: EmailLog[];
  whatsappLogs: WhatsAppLog[];
  activeExamSessions: Record<
    string,
    { userId: string; paperId: string; startedAtMs: number; timeLimitSeconds: number }
  >;
}

const DATA_PATH = path.resolve(process.cwd(), process.env.DATA_STORE_PATH || 'data/db.json');

function createSeedCuratedQuizzes(): QuizItem[] {
  const curated: QuizItem[] = [
    {
      id: 'CUR-001',
      source: 'curated',
      questionSi: 'පහත දැක්වෙන රටාවේ ඊළඟ අංකය කුමක්ද? 5 - 2, 4, 5, 2, ...',
      questionEn: 'What is the next pair/number in the rhythmic pattern? 5 - 2, 4, 5, 2, ...',
      options: ['4', '5', '3', '6'],
      correctIndex: 0,
      memoryTrickTitle: 'Musical Beat Echo (සංගීත තාල මතකය)',
      memoryTrickBody:
        'Clap the numbers like a drumbeat: "5-2-4, 5-2-4"! Whenever you see repeating 3-number groups, say them out loud like a song chorus to spot the missing beat.',
      explanation: 'The 3-element cycle [5, 2, 4] repeats: 5, 2, 4, 5, 2, so the next number is 4.',
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
      questionSi: 'බස් රථයක මගීන් 42 ක් සිටිති. පළමු නැවතුමේදී 15 ක් බැස 8 ක් නැග්ගේ නම් දැන් බස් රථයේ සිටින මගීන් ගණන කීයද?',
      questionEn: 'A bus has 42 passengers. At the first stop, 15 get off and 8 get on. How many passengers are on the bus now?',
      options: ['35', '33', '49', '29'],
      correctIndex: 0,
      memoryTrickTitle: 'Doorway Counter Trick (බස් දොර ගණන් ක්‍රමය)',
      memoryTrickBody:
        'First find the net change at the door! 15 left and 8 entered means 7 fewer people overall (15 − 8 = 7). Then just take 42 − 7 = 35 in one tiny mental step!',
      explanation: '42 − 15 = 27, then 27 + 8 = 35 (or net −7: 42 − 7 = 35).',
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
      questionSi: 'රූපයේ ඇති සමචතුරස්‍රයක එක් පැත්තක දිග 9 cm නම් එහි වටප්‍රමාණය (පරිමිතිය) කොපමණද?',
      questionEn: 'If one side of a square is 9 cm, what is its perimeter?',
      options: ['18 cm', '27 cm', '36 cm', '81 cm'],
      correctIndex: 2,
      memoryTrickTitle: '4-Wall Fence Chant (හතර පැත්තේ වැට)',
      memoryTrickBody:
        'A square has 4 twin walls! Touch 4 fingers while saying "9, 18, 27, 36!" Never mix up Perimeter (4 walls added) with Area (floor tiles multiplied).',
      explanation: 'Perimeter of a square = 4 × side = 4 × 9 = 36 cm.',
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
      questionSi: 'පැය 2 ක් සහ මිනිත්තු 45 ක් යනු මුළු මිනිත්තු කීයක්ද?',
      questionEn: 'How many total minutes are in 2 hours and 45 minutes?',
      options: ['125 min', '145 min', '165 min', '185 min'],
      correctIndex: 2,
      memoryTrickTitle: 'Clock Pizza Slice Trick (ඔරලෝසු පීසා ක්‍රමය)',
      memoryTrickBody:
        'Each full hour is a 60-minute pizza! 2 pizzas = 60 + 60 = 120 minutes. Now add the extra 45 slices: 120 + 45 = 165!',
      explanation: '2 × 60 + 45 = 120 + 45 = 165 minutes.',
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
      questionSi: 'පෝලිමක ඉදිරියෙන් 7 වන ස්ථානයේත්, පිටුපසින් 9 වන ස්ථානයේත් සිටින කවිඳු සිටින පෝලිමේ මුළු ළමුන් ගණන කීයද?',
      questionEn: 'Kavindu is 7th from the front and 9th from the back in a queue. How many children are in the queue?',
      options: ['16', '15', '17', '14'],
      correctIndex: 1,
      memoryTrickTitle: 'Double-Count Minus One (දෙපාරක් ගණන් කළා -1)',
      memoryTrickBody:
        'Imagine Kavindu raising BOTH hands! You counted him once from the front AND once from the back. Always add (7 + 9 = 16) and subtract 1 so you don’t clone Kavindu!',
      explanation: 'Total = Front position + Back position − 1 = 7 + 9 − 1 = 15.',
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
  return curated;
}

function buildInitialState(): DatabaseState {
  const curatedQuizzes = createSeedCuratedQuizzes();

  const resolveQuiz = (id: string): QuizItem => {
    const found = curatedQuizzes.find((q) => q.id === id);
    if (found) return found;
    const match = id.match(/^POOL-(\d+)$/);
    if (match) return generateVirtualQuizFromPool(Number(match[1]));
    return generateVirtualQuizFromPool(1);
  };

  const paper1Ids = ['CUR-003', 'CUR-004', 'CUR-008', 'POOL-000001', 'POOL-000005', 'POOL-000009', 'POOL-000013', 'POOL-000017'];
  const paper2Ids = ['CUR-001', 'CUR-002', 'CUR-005', 'POOL-000002', 'POOL-000006', 'POOL-000010', 'POOL-000014', 'POOL-000018', 'POOL-000022', 'POOL-000026'];
  const paper3Ids = ['CUR-005', 'CUR-006', 'POOL-000003', 'POOL-000007', 'POOL-000011', 'POOL-000015', 'POOL-000019', 'POOL-000023', 'POOL-000027', 'POOL-000031'];
  const paper4Ids = ['CUR-006', 'CUR-007', 'POOL-000004', 'POOL-000008', 'POOL-000012', 'POOL-000016', 'POOL-000020', 'POOL-000024', 'POOL-000028', 'POOL-000032', 'POOL-000036', 'POOL-000040'];

  const papers: ExamPaper[] = [
    {
      id: 'PAPER-001',
      title: 'Foundation Starter · Mock Paper 01',
      titleSi: 'මූලික පෙරහුරු ප්‍රශ්න පත්‍රය 01',
      description: 'Confidence-building starter paper covering core arithmetic, simple patterns, and English basics.',
      durationMinutes: 10,
      quizIds: paper1Ids,
      qualitySummary: calculatePaperQualityAndDifficulty(paper1Ids.map(resolveQuiz)),
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
      quizIds: paper2Ids,
      qualitySummary: calculatePaperQualityAndDifficulty(paper2Ids.map(resolveQuiz)),
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
      quizIds: paper3Ids,
      qualitySummary: calculatePaperQualityAndDifficulty(paper3Ids.map(resolveQuiz)),
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
      quizIds: paper4Ids,
      qualitySummary: calculatePaperQualityAndDifficulty(paper4Ids.map(resolveQuiz)),
      createdBy: 'admin@man5he.lk',
      createdAt: '2026-01-18T09:00:00.000Z',
      published: true,
    },
  ];

  const users: UserAccount[] = [
    {
      id: 'usr-student-1',
      userIdCode: 'M5-2026-001',
      name: 'Sayuri Perera',
      email: 'sayuri@man5he.lk',
      whatsappNumber: '+94771234567',
      role: 'student',
      passwordHash: hashPassword('Sayuri@2026'),
      totpSecret: 'JBSWY3DPEHPK3PXP',
      emailVerified: true,
      totpEnabled: true,
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
      id: 'usr-admin-1',
      userIdCode: 'M5-ADMIN-01',
      name: 'Kavinda Wickramasinghe',
      email: 'admin@man5he.lk',
      whatsappNumber: '+94719876543',
      role: 'admin',
      passwordHash: hashPassword('Admin@2026'),
      totpSecret: 'KRSXG5CTMVRXEZLU',
      emailVerified: true,
      totpEnabled: true,
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

  const attempts: AttemptRecord[] = [
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
    {
      id: 'ATT-1003',
      userId: 'usr-student-1',
      paperId: 'PRACTICE-500K',
      paperTitle: 'Shuffled 500K Practice · Patterns & Memory',
      mode: 'practice',
      paperCategory: 'Balanced Standard',
      totalQuestions: 10,
      correctCount: 7,
      scorePercent: 70,
      timeLimitSeconds: 0,
      timeSpentSeconds: 540,
      starsEarned: 20,
      domainBreakdown: {
        'Logical & Number Patterns': { correct: 4, total: 5 },
        'Sinhala Language & Proverbs': { correct: 3, total: 5 },
      },
      submittedAt: '2026-11-11T10:30:00.000Z',
    },
  ];

  const paymentPlans: PaymentPlan[] = [
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
        'Google Authenticator + Email OTP family account security',
      ],
    },
  ];

  const seedInvoice: InvoiceRecord = {
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
  };

  const sampleTrajectory = {
    currentLevel: 'Balanced Standard' as const,
    recommendedNextLevel: 'Advanced Challenging' as const,
    scholarshipReadinessPercent: 81,
    improvementDeltaPercent: 10.5,
    totalStars: 145,
    studyMinutesWeek: 125,
    badgesCount: 7,
    weakDomains: [
      { domain: 'Sinhala Language & Proverbs', accuracyPercent: 57 },
      { domain: 'English & Comprehension', accuracyPercent: 67 },
    ],
    dailyStudySeries: [],
    recommendationNote:
      'Excellent mastery (84% recent average). Ready to advance to Advanced Challenging papers.',
  };

  const emailLogs: EmailLog[] = [
    {
      id: 'EML-SEED-1',
      toEmail: 'sayuri@man5he.lk',
      subject: 'Official Receipt & Invoice INV-M5-202601 · මං 5හේ',
      category: 'invoice',
      htmlBody: buildInvoiceEmailHtml(seedInvoice),
      sentAt: '2026-11-01T09:15:05.000Z',
    },
    {
      id: 'EML-SEED-2',
      toEmail: 'sayuri@man5he.lk',
      subject: 'Progress Report: Balanced Standard · Mock Paper 02 (80%)',
      category: 'progress_report',
      htmlBody: buildProgressEmailHtml({
        studentName: 'Sayuri Perera',
        attempt: attempts[0],
        trajectory: sampleTrajectory,
      }),
      sentAt: '2026-11-15T14:21:00.000Z',
    },
  ];

  const whatsappLogs: WhatsAppLog[] = [
    {
      id: 'WA-SEED-1',
      toNumber: '+94771234567',
      category: 'exam_report',
      messageText: buildWhatsAppProgressMessage({
        studentName: 'Sayuri Perera',
        attempt: attempts[0],
        trajectory: sampleTrajectory,
      }),
      deliveryStatus: 'delivered',
      sentAt: '2026-11-15T14:21:05.000Z',
    },
  ];

  return {
    users,
    curatedQuizzes,
    papers,
    attempts,
    paymentPlans,
    invoices: [seedInvoice],
    emailLogs,
    whatsappLogs,
    activeExamSessions: {},
  };
}

export class PersistentStore {
  private state: DatabaseState;

  constructor() {
    this.state = this.load();
  }

  private load(): DatabaseState {
    try {
      if (fs.existsSync(DATA_PATH)) {
        const raw = fs.readFileSync(DATA_PATH, 'utf8');
        const parsed = JSON.parse(raw) as DatabaseState;
        if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.papers)) {
          return parsed;
        }
      }
    } catch {
      // Fallback to fresh seed if corrupted
    }
    const seed = buildInitialState();
    this.save(seed);
    return seed;
  }

  public get(): DatabaseState {
    return this.state;
  }

  public save(nextState?: DatabaseState): void {
    if (nextState) {
      this.state = nextState;
    }
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${DATA_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_PATH);
  }
}
