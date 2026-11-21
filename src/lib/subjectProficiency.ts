import type { AttemptRecord, CognitiveDomain } from './types.ts';

export interface SubjectAxisConfig {
  domain: CognitiveDomain;
  subject: string;
  subjectSi: string;
  targetBenchmark: number;
  remediationTip: string;
}

export type SubjectStatus = 'Strong' | 'Developing' | 'Fallback Area' | 'Untested';

export interface SubjectRadarDatum {
  domain: CognitiveDomain;
  subject: string;
  subjectSi: string;
  proficiency: number;
  targetBenchmark: number;
  correctCount: number;
  totalCount: number;
  deltaPercent: number;
  status: SubjectStatus;
  remediationTip: string;
}

export interface FallbackAreaItem {
  domain: CognitiveDomain;
  subject: string;
  subjectSi: string;
  proficiency: number;
  gapToTarget: number;
  deltaPercent: number;
  remediationTip: string;
}

export interface SubjectProficiencyProfile {
  radarData: SubjectRadarDatum[];
  fallbackAreas: FallbackAreaItem[];
  overallProficiencyPercent: number;
  strongestSubject: SubjectRadarDatum | null;
  subjectsOnTargetCount: number;
  testedSubjectsCount: number;
}

export const CORE_SUBJECT_AXES: SubjectAxisConfig[] = [
  {
    domain: 'Sinhala Language & Proverbs',
    subject: 'Sinhala',
    subjectSi: 'සිංහල',
    targetBenchmark: 75,
    remediationTip:
      'Review Sinhala proverb picture-stories and Taluya/Murdhaja spelling flashcards.',
  },
  {
    domain: 'Mathematics & Word Problems',
    subject: 'Mathematics',
    subjectSi: 'ගණිතය',
    targetBenchmark: 75,
    remediationTip:
      'Break word problems into Step 1 total and Step 2 comparison using story visualization.',
  },
  {
    domain: 'English & Comprehension',
    subject: 'Tamil / English',
    subjectSi: 'දෙමළ / ඉංග්‍රීසි',
    targetBenchmark: 75,
    remediationTip:
      'Practice irregular plural rhymes, AT/ON/IN time pyramids, and bilingual reading cues.',
  },
  {
    domain: 'Environmental Studies (පරිසරය)',
    subject: 'Environment',
    subjectSi: 'පරිසරය',
    targetBenchmark: 75,
    remediationTip:
      'Use sensory color pegs to lock Sri Lankan national symbols, rivers, and plant facts.',
  },
  {
    domain: 'Logical & Number Patterns',
    subject: 'Logical IQ',
    subjectSi: 'තර්ක බුද්ධිය',
    targetBenchmark: 75,
    remediationTip:
      'Draw frog-hop differences and rainbow bridges on alternating number sequences.',
  },
  {
    domain: 'Spatial & Geometric IQ',
    subject: 'Spatial IQ',
    subjectSi: 'රූපමය බුද්ධිය',
    targetBenchmark: 75,
    remediationTip:
      'Trace rectangle perimeters and use the 11:60 mirror-clock visual reflection trick.',
  },
];

export const FALLBACK_THRESHOLD_PERCENT = 70;

export function evaluateSubjectProficiencyProfile(
  attempts: AttemptRecord[],
  weakDomainsFallback?: { domain: string; accuracyPercent: number }[]
): SubjectProficiencyProfile {
  const domainHistory = new Map<
    string,
    { correct: number; total: number; chronologicalAccuracies: number[] }
  >();

  // Sort oldest -> newest so chronologicalAccuracies measures progress accurately
  const chronological = [...attempts].sort((a, b) =>
    (a.submittedAt || '').localeCompare(b.submittedAt || '')
  );

  for (const att of chronological) {
    for (const [dom, stats] of Object.entries(att.domainBreakdown || {})) {
      if (!stats || stats.total <= 0) continue;
      if (!domainHistory.has(dom)) {
        domainHistory.set(dom, { correct: 0, total: 0, chronologicalAccuracies: [] });
      }
      const entry = domainHistory.get(dom)!;
      entry.correct += stats.correct;
      entry.total += stats.total;
      entry.chronologicalAccuracies.push(
        Math.round((stats.correct / stats.total) * 100)
      );
    }
  }

  const weakMap = new Map<string, number>();
  for (const item of weakDomainsFallback || []) {
    weakMap.set(item.domain, item.accuracyPercent);
  }

  const radarData: SubjectRadarDatum[] = CORE_SUBJECT_AXES.map((axis) => {
    const hist = domainHistory.get(axis.domain);
    const hasStats = Boolean(hist && hist.total > 0);
    const fallbackAccuracy = weakMap.get(axis.domain);

    let proficiency = 0;
    let deltaPercent = 0;

    if (hasStats && hist) {
      proficiency = Math.round((hist.correct / hist.total) * 100);
      if (hist.chronologicalAccuracies.length >= 2) {
        const latest =
          hist.chronologicalAccuracies[hist.chronologicalAccuracies.length - 1];
        const previous = hist.chronologicalAccuracies[0];
        deltaPercent = latest - previous;
      }
    } else if (typeof fallbackAccuracy === 'number') {
      proficiency = Math.round(fallbackAccuracy);
    }

    const tested = hasStats || typeof fallbackAccuracy === 'number';
    let status: SubjectStatus = 'Untested';
    if (tested) {
      if (proficiency < FALLBACK_THRESHOLD_PERCENT) {
        status = 'Fallback Area';
      } else if (proficiency < axis.targetBenchmark) {
        status = 'Developing';
      } else {
        status = 'Strong';
      }
    }

    return {
      domain: axis.domain,
      subject: axis.subject,
      subjectSi: axis.subjectSi,
      proficiency,
      targetBenchmark: axis.targetBenchmark,
      correctCount: hist?.correct ?? 0,
      totalCount: hist?.total ?? 0,
      deltaPercent,
      status,
      remediationTip: axis.remediationTip,
    };
  });

  const tested = radarData.filter((d) => d.status !== 'Untested');
  const overallProficiencyPercent =
    tested.length > 0
      ? Math.round(
          tested.reduce((sum, item) => sum + item.proficiency, 0) / tested.length
        )
      : 0;

  const strongestSubject =
    tested.length > 0
      ? [...tested].sort((a, b) => b.proficiency - a.proficiency)[0]
      : null;

  const subjectsOnTargetCount = tested.filter(
    (d) => d.proficiency >= d.targetBenchmark
  ).length;

  const fallbackAreas: FallbackAreaItem[] = tested
    .filter(
      (d) => d.proficiency < FALLBACK_THRESHOLD_PERCENT || d.deltaPercent < -5
    )
    .sort((a, b) => a.proficiency - b.proficiency)
    .map((d) => ({
      domain: d.domain,
      subject: d.subject,
      subjectSi: d.subjectSi,
      proficiency: d.proficiency,
      gapToTarget: Math.max(0, d.targetBenchmark - d.proficiency),
      deltaPercent: d.deltaPercent,
      remediationTip: d.remediationTip,
    }));

  return {
    radarData,
    fallbackAreas,
    overallProficiencyPercent,
    strongestSubject,
    subjectsOnTargetCount,
    testedSubjectsCount: tested.length,
  };
}
