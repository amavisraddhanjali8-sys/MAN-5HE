import { GoogleGenAI, Type } from '@google/genai';
import { HttpError } from './academicService.ts';
import type { SubjectCategory } from '../lib/types.ts';

export const GEMINI_KNOWLEDGE_MODEL = 'gemini-4-hydrogen';

export function isGeminiConfigured(): boolean {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return false;
  if (key === 'MY_GEMINI_API_KEY' || key === 'REPLACE_WITH_GEMINI_API_KEY') return false;
  return key.length >= 12;
}

export interface AiKnowledgeDraftResult {
  aiGenerated: true;
  reviewRequired: true;
  title: string;
  summary: string;
  simplifiedExplanation: string;
  suggestedSubjectId: string;
  suggestedGrades: string[];
  memoryTip: string;
  draftQuestions: {
    question: string;
    options: [string, string, string, string];
    correctIndex: number;
  }[];
  uncertaintyWarnings: string[];
}

export async function generateEducationalKnowledgeDraft(params: {
  sourceTitle: string;
  sourceUrl?: string;
  sourceExcerpt: string;
  targetGrade: string;
  language: string;
  subjects: SubjectCategory[];
}): Promise<AiKnowledgeDraftResult> {
  if (!isGeminiConfigured()) {
    throw new HttpError(
      503,
      'GEMINI_API_KEY is not configured on the server. AI drafting is unavailable; manual authoring and source verification remain active.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!.trim(),
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const subjectGuide = params.subjects
    .map((s) => `${s.id} (${s.nameEn})`)
    .join(', ');

  const prompt = [
    'You are an educational curriculum assistant for Sri Lanka Grade 5 Scholarship students (ages 9-11).',
    'STRICT SAFETY & FACTUALITY RULES:',
    '- Rely ONLY on the verified source excerpt provided below.',
    '- NEVER invent new scientific discoveries, statistics, dates, or external references.',
    '- If any detail in the source excerpt is incomplete, uncertain, or requires teacher verification, explicitly list it in uncertaintyWarnings.',
    '- Keep tone warm, clear, child-appropriate, and aligned to Sri Lankan primary school curriculum.',
    '',
    `Available Subject IDs: ${subjectGuide}`,
    `Target Grade: ${params.targetGrade || 'Grade 5'}`,
    `Language Preference: ${params.language || 'bilingual'}`,
    `Verified Source Title: ${params.sourceTitle}`,
    params.sourceUrl ? `Verified Source URL: ${params.sourceUrl}` : '',
    '',
    'Source Excerpt:',
    params.sourceExcerpt.slice(0, 6000),
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: GEMINI_KNOWLEDGE_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          simplifiedExplanation: { type: Type.STRING },
          suggestedSubjectId: { type: Type.STRING },
          suggestedGrades: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          memoryTip: { type: Type.STRING },
          draftQuestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                correctIndex: { type: Type.INTEGER },
              },
              required: ['question', 'options', 'correctIndex'],
            },
          },
          uncertaintyWarnings: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: [
          'title',
          'summary',
          'simplifiedExplanation',
          'suggestedSubjectId',
          'suggestedGrades',
          'memoryTip',
          'draftQuestions',
          'uncertaintyWarnings',
        ],
      },
    },
  });

  const rawText = response.text || '';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new HttpError(502, 'AI assistant returned an unreadable draft structure.');
  }

  const validSubjectSet = new Set(params.subjects.map((s) => s.id));
  const rawSubj = String(parsed.suggestedSubjectId || '');
  const safeSubjectId = validSubjectSet.has(rawSubj)
    ? rawSubj
    : params.subjects[0]?.id || 'subj-math';

  const rawQuestions = Array.isArray(parsed.draftQuestions) ? parsed.draftQuestions : [];
  const draftQuestions = rawQuestions
    .slice(0, 3)
    .map((q) => {
      const obj = q as Record<string, unknown>;
      const opts = Array.isArray(obj.options) ? obj.options.map(String) : [];
      while (opts.length < 4) opts.push('Option');
      const idx = Math.max(0, Math.min(3, Number(obj.correctIndex || 0)));
      return {
        question: String(obj.question || 'Comprehension check'),
        options: [opts[0], opts[1], opts[2], opts[3]] as [string, string, string, string],
        correctIndex: idx,
      };
    });

  const warnings = Array.isArray(parsed.uncertaintyWarnings)
    ? parsed.uncertaintyWarnings.map(String)
    : [];
  warnings.unshift('AI-Assisted Draft: Human teacher/admin verification required before publishing.');

  return {
    aiGenerated: true,
    reviewRequired: true,
    title: String(parsed.title || params.sourceTitle),
    summary: String(parsed.summary || ''),
    simplifiedExplanation: String(parsed.simplifiedExplanation || ''),
    suggestedSubjectId: safeSubjectId,
    suggestedGrades:
      Array.isArray(parsed.suggestedGrades) && parsed.suggestedGrades.length > 0
        ? parsed.suggestedGrades.map(String)
        : [params.targetGrade || 'Grade 5'],
    memoryTip: String(parsed.memoryTip || ''),
    draftQuestions,
    uncertaintyWarnings: warnings,
  };
}
