import React from 'react';
import {
  Brain,
  Check,
  CheckCircle2,
  HeartHandshake,
  Lightbulb,
  Sparkles,
} from 'lucide-react';
import type { QuizItem } from '../lib/types';
import { buildStudyBuddyCoaching } from '../lib/studyBuddy';
import { MascotAvatar } from './BrandVisuals';

interface StudyBuddySidebarProps {
  quiz: QuizItem;
  selectedOption: number | null;
  consecutiveWrongCount: number;
  studentFirstName: string;
  showStudyTrick: boolean;
  masteredCueIds: string[];
  onMarkCueReviewed: (quizId: string) => void;
}

export function StudyBuddySidebar({
  quiz,
  selectedOption,
  consecutiveWrongCount,
  studentFirstName,
  showStudyTrick,
  masteredCueIds,
  onMarkCueReviewed,
}: StudyBuddySidebarProps) {
  const coaching = buildStudyBuddyCoaching({
    quiz,
    selectedOption,
    consecutiveWrongCount,
    studentFirstName,
  });

  const isCueReviewed = masteredCueIds.includes(quiz.id);

  return (
    <aside
      aria-label="Study Buddy Sidebar"
      data-testid="study-buddy-sidebar"
      className="lg:col-span-5 space-y-4"
    >
      {/* Primary Study Buddy Real-Time Coaching Card */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <MascotAvatar className="w-11 h-11 shrink-0" />
            <div>
              <h3 className="text-base font-display font-bold text-[#0F2942]">
                Study Buddy
              </h3>
              <p className="text-xs text-[#526A84]">
                අධ්‍යයන මිතුරා · Real-Time Encouragement
              </p>
            </div>
          </div>
          <div className="text-right text-xs text-[#526A84] tabular-nums">
            <div className="font-bold text-[#158EE3]">{masteredCueIds.length}</div>
            <div>Tricks Reviewed</div>
          </div>
        </div>

        {/* Coaching Mood Box */}
        {coaching.mood === 'wrong' && (
          <div
            data-testid="study-buddy-wrong-coaching"
            className="rounded-2xl bg-[#FFF6EE] border border-[#FAD49B] p-4 space-y-3"
          >
            <div className="flex items-start gap-2.5">
              <HeartHandshake className="w-5 h-5 text-[#F96A1B] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="text-sm font-display font-bold text-[#9A3A06]">
                  {coaching.headline}
                </div>
                <div className="text-xs text-[#7A4400] mt-0.5">
                  {coaching.headlineSi}
                </div>
              </div>
            </div>

            <p className="text-sm text-[#4A2B05] leading-relaxed">
              {coaching.encouragement}
            </p>

            {/* Simplified Memory Technique Explanation */}
            <div className="pt-3 border-t border-[#F7DEC0] space-y-2">
              <div className="text-xs font-semibold text-[#9A3A06]">
                Simplified Memory Technique · {coaching.psychologyPrinciple}
              </div>
              <div className="text-sm font-display font-bold text-[#0F2942] flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4 text-[#F5A623] shrink-0" aria-hidden="true" />
                <span>{coaching.simplifiedTrickTitle}</span>
              </div>
              <ul className="space-y-1.5 text-xs text-[#233B53] leading-relaxed">
                {coaching.simpleSteps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="font-mono font-bold text-[#F96A1B] shrink-0">
                      {idx + 1}.
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
              {coaching.correctAnswerLabel && (
                <div className="pt-2 text-xs font-bold text-[#1E6323] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Correct Answer: {coaching.correctAnswerLabel}</span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onMarkCueReviewed(quiz.id)}
              disabled={isCueReviewed}
              className={`w-full py-2 px-3.5 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
                isCueReviewed
                  ? 'bg-[#EEF9EF] text-[#1E6323] border border-[#C1E8C4]'
                  : 'bg-[#F96A1B] text-white hover:bg-[#DE580E]'
              }`}
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {isCueReviewed
                  ? 'Memory Trick Saved to Your Review Count'
                  : 'Got It! Lock In This Memory Trick'}
              </span>
            </button>
          </div>
        )}

        {coaching.mood === 'correct' && (
          <div
            data-testid="study-buddy-correct-coaching"
            className="rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4] p-4 space-y-2.5"
          >
            <div className="flex items-start gap-2.5">
              <Sparkles className="w-5 h-5 text-[#2E7D32] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="text-sm font-display font-bold text-[#1E6323]">
                  {coaching.headline}
                </div>
                <div className="text-xs text-[#2E7D32] mt-0.5">
                  {coaching.headlineSi}
                </div>
              </div>
            </div>
            <p className="text-sm text-[#1E4620] leading-relaxed">
              {coaching.encouragement}
            </p>
            <div className="text-xs font-medium text-[#2E7D32]">
              Technique: {coaching.psychologyPrinciple}
            </div>
          </div>
        )}

        {coaching.mood === 'waiting' && (
          <div
            data-testid="study-buddy-waiting"
            className="rounded-2xl bg-[#F3F9FF] border border-[#CBE2FA] p-4 space-y-2"
          >
            <div className="text-sm font-display font-bold text-[#0F2942]">
              {coaching.headline}
            </div>
            <p className="text-xs text-[#476481] leading-relaxed">
              {coaching.encouragement}
            </p>
            <div className="text-xs text-[#158EE3] font-semibold">
              Memory Focus: {coaching.psychologyPrinciple}
            </div>
          </div>
        )}

        {/* Full Child Psychological Memory Helper & Explanation */}
        <div className="pt-3 border-t border-[#E5F0FA] space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[#0F2942]">
            <Brain className="w-4 h-4 text-[#F5A623]" aria-hidden="true" />
            <span>Full Memory Cue · Practice Mode Only</span>
          </div>

          {showStudyTrick ? (
            <div className="space-y-2.5">
              <div className="p-3.5 rounded-2xl bg-[#FFF9EE] border border-[#FDE1B2]">
                <div className="text-xs font-display font-bold text-[#7C4D00]">
                  {quiz.memoryTrickTitle}
                </div>
                <p className="text-xs text-[#4A3200] mt-1 leading-relaxed">
                  {quiz.memoryTrickBody}
                </p>
              </div>
              {selectedOption !== null && (
                <div className="p-3.5 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA]">
                  <div className="text-xs font-bold text-[#158EE3]">Step-by-Step Solution</div>
                  <p className="text-xs text-[#0F2942] mt-1 leading-relaxed">
                    {quiz.explanation}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-[#526A84]">
              Pick an option (A–D) or click <strong>Study Memory Trick</strong> to preview the full mnemonic guide.
            </p>
          )}
        </div>

        {/* Quiz Psychometric Metadata (clean unboxed text) */}
        <div className="pt-3 border-t border-[#E5F0FA] grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[#526A84]">Intelligence Measure</div>
            <div className="font-bold text-[#0F2942] tabular-nums">
              {quiz.attributes.intelligenceMeasure}/100
            </div>
          </div>
          <div>
            <div className="text-[#526A84]">Exam Priority</div>
            <div className="font-bold text-[#0F2942] tabular-nums">
              {quiz.attributes.examPriority}/10
            </div>
          </div>
          <div>
            <div className="text-[#526A84]">Right / Wrong Prob.</div>
            <div className="font-bold text-[#0F2942] tabular-nums">
              {Math.round(quiz.attributes.correctProbability * 100)}% /{' '}
              {Math.round(quiz.attributes.wrongProbability * 100)}%
            </div>
          </div>
          <div>
            <div className="text-[#526A84]">Quiz Strength</div>
            <div className="font-bold text-[#0F2942] tabular-nums">
              {quiz.attributes.quizStrength}/100
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
