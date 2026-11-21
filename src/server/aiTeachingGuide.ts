import { GoogleGenAI, Type } from '@google/genai';
import { isGeminiConfigured } from './aiKnowledge.ts';
import type { ParentTeachingGuidance, QuizItem } from '../lib/types.ts';

export const GEMINI_TEACHING_MODEL = 'gemini-4-hydrogen';

export async function adaptParentTeachingGuideWithAi(params: {
  question: QuizItem;
  subjectName: string;
  topicName: string;
  studentAnswerDisplay: string;
  baseGuide: ParentTeachingGuidance;
}): Promise<ParentTeachingGuidance> {
  if (!isGeminiConfigured()) {
    return params.baseGuide;
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!.trim(),
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const prompt = [
    'You are an educational psychologist and Sri Lankan Grade 5 Scholarship parent coach.',
    'Adapt the approved curriculum explanation below into warm, practical instructions for a parent helping their 9-11 year old child at home.',
    'STRICT CHILD-SAFETY RULES:',
    '- NEVER infer psychological diagnoses, learning disorders, or neurological conditions.',
    '- NEVER use punitive, shaming, or high-pressure wording.',
    '- Label any possible reasons for the child\'s mistake clearly as possibilities, not certainties.',
    '- Rely ONLY on the verified question and explanation below.',
    '',
    `Subject: ${params.subjectName} | Topic: ${params.topicName}`,
    `Question (EN): ${params.question.questionEn}`,
    `Question (SI): ${params.question.questionSi}`,
    `Correct Answer: ${params.question.options[params.question.correctIndex]}`,
    `Student Answer: ${params.studentAnswerDisplay}`,
    `Verified Explanation: ${params.question.explanation}`,
    `Memory Trick: ${params.question.memoryTrickTitle} — ${params.question.memoryTrickBody}`,
  ].join('\n');

  const response = await ai.models.generateContent({
    model: GEMINI_TEACHING_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          whatItTests: { type: Type.STRING },
          plausibleErrorReasons: { type: Type.ARRAY, items: { type: Type.STRING } },
          teachingMethod: { type: Type.STRING },
          practicalExamples: { type: Type.ARRAY, items: { type: Type.STRING } },
          questionsToAskChild: { type: Type.ARRAY, items: { type: Type.STRING } },
          commonMistakesToAvoid: { type: Type.ARRAY, items: { type: Type.STRING } },
          followupPracticeSuggestion: { type: Type.STRING },
          teacherHelpIndicators: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'whatItTests',
          'plausibleErrorReasons',
          'teachingMethod',
          'practicalExamples',
          'questionsToAskChild',
          'commonMistakesToAvoid',
          'followupPracticeSuggestion',
          'teacherHelpIndicators',
        ],
      },
    },
  });

  const parsed = JSON.parse(response.text || '{}') as Record<string, unknown>;
  return {
    ...params.baseGuide,
    whatItTests: String(parsed.whatItTests || params.baseGuide.whatItTests),
    plausibleErrorReasons: Array.isArray(parsed.plausibleErrorReasons)
      ? parsed.plausibleErrorReasons.map(String).slice(0, 4)
      : params.baseGuide.plausibleErrorReasons,
    teachingMethod: String(parsed.teachingMethod || params.baseGuide.teachingMethod),
    practicalExamples: Array.isArray(parsed.practicalExamples)
      ? parsed.practicalExamples.map(String).slice(0, 4)
      : params.baseGuide.practicalExamples,
    questionsToAskChild: Array.isArray(parsed.questionsToAskChild)
      ? parsed.questionsToAskChild.map(String).slice(0, 4)
      : params.baseGuide.questionsToAskChild,
    commonMistakesToAvoid: Array.isArray(parsed.commonMistakesToAvoid)
      ? parsed.commonMistakesToAvoid.map(String).slice(0, 4)
      : params.baseGuide.commonMistakesToAvoid,
    followupPracticeSuggestion: String(
      parsed.followupPracticeSuggestion || params.baseGuide.followupPracticeSuggestion
    ),
    teacherHelpIndicators: Array.isArray(parsed.teacherHelpIndicators)
      ? parsed.teacherHelpIndicators.map(String).slice(0, 3)
      : params.baseGuide.teacherHelpIndicators,
    sourceType: 'ai_adapted',
  };
}
