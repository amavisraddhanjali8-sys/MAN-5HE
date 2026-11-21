import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Layers,
  Music,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import {
  GRADE5_MNEMONIC_FLASHCARDS,
  MNEMONIC_STRATEGIES,
  STRATEGY_SCIENCE_NOTES,
  evaluateFlashcardDeckProgress,
  filterFlashcards,
  shuffleFlashcards,
  type FlashcardConfidence,
  type MnemonicStrategy,
} from '../lib/flashcards';

interface MnemonicFlashcardLabProps {
  selectedDomain: string;
  studentFirstName: string;
  externalShuffleCounter: number;
}

const STRATEGY_META: Record<
  MnemonicStrategy,
  {
    icon: React.ComponentType<{ className?: string }>;
    badgeClass: string;
    panelClass: string;
    accentColor: string;
  }
> = {
  Rhyming: {
    icon: Music,
    badgeClass: 'bg-[#FFF5E0] text-[#8F5300] border-[#FAD58A]',
    panelClass: 'bg-[#FFF9EE] border-[#FDE1B2]',
    accentColor: '#D97706',
  },
  Visualization: {
    icon: Eye,
    badgeClass: 'bg-[#EBF5FF] text-[#0E64A8] border-[#B9DCF9]',
    panelClass: 'bg-[#F3F9FF] border-[#CBE2FA]',
    accentColor: '#158EE3',
  },
  'Story Hook': {
    icon: BookOpen,
    badgeClass: 'bg-[#EEF9EF] text-[#1F6A24] border-[#BBE5BF]',
    panelClass: 'bg-[#F2FBF3] border-[#C1E8C4]',
    accentColor: '#2E7D32',
  },
  'Chunking & Pegs': {
    icon: Layers,
    badgeClass: 'bg-[#FFF2ED] text-[#A93909] border-[#FAC5B2]',
    panelClass: 'bg-[#FFF6F2] border-[#FACBB8]',
    accentColor: '#F96A1B',
  },
};

export function MnemonicFlashcardLab({
  selectedDomain,
  studentFirstName,
  externalShuffleCounter,
}: MnemonicFlashcardLabProps) {
  const [strategyFilter, setStrategyFilter] = useState<MnemonicStrategy | 'All'>('All');
  const [reviewQueueOnly, setReviewQueueOnly] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(105);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [confidenceMap, setConfidenceMap] = useState<Record<string, FlashcardConfidence>>({});

  useEffect(() => {
    if (externalShuffleCounter > 0) {
      setShuffleSeed((s) => s + 37);
      setCurrentIndex(0);
      setIsFlipped(false);
    }
  }, [externalShuffleCounter]);

  const baseFiltered = useMemo(
    () =>
      filterFlashcards(GRADE5_MNEMONIC_FLASHCARDS, {
        domain: selectedDomain,
        strategy: strategyFilter,
      }),
    [selectedDomain, strategyFilter]
  );

  const deck = useMemo(() => {
    const ordered = shuffleFlashcards(baseFiltered, shuffleSeed);
    if (!reviewQueueOnly) return ordered;
    const onlyReview = ordered.filter((card) => confidenceMap[card.id] === 'review');
    return onlyReview.length > 0 ? onlyReview : ordered;
  }, [baseFiltered, shuffleSeed, reviewQueueOnly, confidenceMap]);

  useEffect(() => {
    setCurrentIndex(0);
    setIsFlipped(false);
  }, [selectedDomain, strategyFilter, reviewQueueOnly]);

  const progress = useMemo(
    () => evaluateFlashcardDeckProgress(baseFiltered, confidenceMap),
    [baseFiltered, confidenceMap]
  );

  useEffect(() => {
    if (reviewQueueOnly && progress.reviewCount === 0) {
      setReviewQueueOnly(false);
    }
  }, [reviewQueueOnly, progress.reviewCount]);

  const safeIndex = Math.min(currentIndex, Math.max(0, deck.length - 1));
  const activeCard = deck[safeIndex];

  const handleToggleFlip = () => {
    setIsFlipped((prev) => !prev);
  };

  const handleMarkConfidence = (status: FlashcardConfidence) => {
    if (!activeCard) return;
    setConfidenceMap((prev) => ({
      ...prev,
      [activeCard.id]: status,
    }));
    if (safeIndex < deck.length - 1) {
      setCurrentIndex(safeIndex + 1);
      setIsFlipped(false);
    }
  };

  const handlePrev = () => {
    if (safeIndex > 0) {
      setCurrentIndex(safeIndex - 1);
      setIsFlipped(false);
    }
  };

  const handleNext = () => {
    if (safeIndex < deck.length - 1) {
      setCurrentIndex(safeIndex + 1);
      setIsFlipped(false);
    }
  };

  if (!activeCard) {
    return (
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-10 text-center space-y-3">
        <p className="text-base font-display font-bold text-[#0F2942]">
          No flashcards match this filter combination.
        </p>
        <button
          type="button"
          onClick={() => setStrategyFilter('All')}
          className="px-4 py-2 text-xs font-bold text-white bg-[#158EE3] rounded-xl"
        >
          Show All Mnemonic Strategies
        </button>
      </div>
    );
  }

  const meta = STRATEGY_META[activeCard.strategy];
  const StrategyIcon = meta.icon;
  const scienceNote = STRATEGY_SCIENCE_NOTES[activeCard.strategy];
  const cardStatus = confidenceMap[activeCard.id];

  return (
    <div className="space-y-5" data-testid="mnemonic-flashcard-lab">
      {/* Mnemonic Strategy Selector Bar */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-4 flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Mnemonic Strategy Filter"
          data-testid="flashcard-strategy-filters"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            aria-pressed={strategyFilter === 'All'}
            onClick={() => setStrategyFilter('All')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl border transition-colors ${
              strategyFilter === 'All'
                ? 'bg-[#0F2942] border-[#0F2942] text-white'
                : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#526A84] hover:text-[#0F2942]'
            }`}
          >
            All Strategies ({GRADE5_MNEMONIC_FLASHCARDS.length})
          </button>
          {MNEMONIC_STRATEGIES.map((strategy) => {
            const Icon = STRATEGY_META[strategy].icon;
            const active = strategyFilter === strategy;
            return (
              <button
                key={strategy}
                type="button"
                aria-pressed={active}
                onClick={() => setStrategyFilter(strategy)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl border flex items-center gap-1.5 transition-colors ${
                  active
                    ? 'bg-[#158EE3] border-[#1176BE] text-white'
                    : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#526A84] hover:text-[#0F2942]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{strategy}</span>
              </button>
            );
          })}
        </div>

        <span className="text-xs font-semibold text-[#526A84] tabular-nums">
          {deck.length} {deck.length === 1 ? 'Card' : 'Cards'} in Active Deck
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Interactive Flashcard Stage */}
        <div className="lg:col-span-7 space-y-4">
          <div
            data-testid="mnemonic-flashcard"
            data-flipped={isFlipped ? 'true' : 'false'}
            data-card-id={activeCard.id}
            className="bg-white rounded-3xl border border-[#DCEBFA] p-6 sm:p-8 space-y-5 shadow-xs"
          >
            {/* Card Header Metadata */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-[#158EE3] tabular-nums">
                  Card {safeIndex + 1} of {deck.length}
                </span>
                <span className="text-[#8CA3BA]">·</span>
                <span className="font-semibold text-[#526A84]">{activeCard.domain}</span>
              </div>

              <div className="flex items-center gap-2">
                <span
                  data-testid="flashcard-strategy-label"
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border flex items-center gap-1.5 ${meta.badgeClass}`}
                >
                  <StrategyIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>{activeCard.strategy}</span>
                </span>
                {cardStatus && (
                  <span
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${
                      cardStatus === 'mastered'
                        ? 'bg-[#EEF9EF] text-[#2E7D32] border-[#BBE5BF]'
                        : 'bg-[#FFF5E0] text-[#8F5300] border-[#FAD58A]'
                    }`}
                  >
                    {cardStatus === 'mastered' ? 'Locked In' : 'Needs Review'}
                  </span>
                )}
              </div>
            </div>

            {/* Clickable Card Body (Concept Recall Front vs Mnemonic Strategy Back) */}
            <button
              type="button"
              onClick={handleToggleFlip}
              aria-pressed={isFlipped}
              data-testid="flashcard-flip-surface"
              className={`w-full text-left rounded-2xl border-2 p-6 focus:outline-none focus:ring-2 focus:ring-[#158EE3] ${
                isFlipped
                  ? `${meta.panelClass}`
                  : 'bg-[#F8FBFF] border-[#DCEBFA] hover:border-[#99CAFA]'
              }`}
            >
              {!isFlipped ? (
                <div className="space-y-4 min-h-[240px] flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="text-xs font-bold uppercase tracking-wide text-[#158EE3]">
                      Concept Front · {activeCard.difficulty}
                    </div>
                    <h2 className="text-xl sm:text-2xl font-display font-extrabold text-[#0F2942] leading-snug">
                      {activeCard.conceptSi}
                    </h2>
                    <p className="text-sm font-semibold text-[#4B647D]">
                      {activeCard.conceptEn}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-white border border-[#DCEBFA] space-y-1.5">
                    <div className="text-xs font-bold text-[#0F2942]">
                      Active Recall Challenge ({studentFirstName}):
                    </div>
                    <p className="text-sm text-[#314A63] leading-relaxed">
                      {activeCard.promptQuestion}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-xs font-semibold text-[#158EE3] pt-1">
                    <span>Think for 3 seconds, then tap to flip</span>
                    <span className="flex items-center gap-1 font-bold">
                      <RotateCw className="w-3.5 h-3.5" />
                      Reveal {activeCard.strategy} Trick
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 min-h-[240px]" data-testid="flashcard-back-face">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="text-xs font-bold uppercase tracking-wide"
                      style={{ color: meta.accentColor }}
                    >
                      Mnemonic Strategy Back · {activeCard.mnemonicTitle}
                    </div>
                    <span className="text-xs font-bold text-[#526A84] flex items-center gap-1">
                      <RotateCw className="w-3.5 h-3.5" />
                      Tap to flip front
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white border border-[#DCEBFA]">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-[#526A84]">
                      Core Scholarship Rule
                    </div>
                    <div className="text-sm font-display font-extrabold text-[#0F2942] mt-0.5">
                      {activeCard.coreRule}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-white border border-[#DCEBFA] space-y-1.5">
                    <div
                      className="text-xs font-bold flex items-center gap-1.5"
                      style={{ color: meta.accentColor }}
                    >
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      <span>{activeCard.strategy} Hook</span>
                    </div>
                    <p className="text-sm font-medium text-[#0F2942] leading-relaxed">
                      {activeCard.mnemonicHook}
                    </p>
                  </div>

                  <ol className="space-y-1.5 text-xs text-[#314A63]">
                    {activeCard.visualCueSteps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-white border border-[#CBE2FA] text-[#158EE3] font-bold flex items-center justify-center shrink-0 tabular-nums">
                          {i + 1}
                        </span>
                        <span className="pt-0.5 leading-snug">{step}</span>
                      </li>
                    ))}
                  </ol>

                  <div className="text-xs font-semibold text-[#526A84] pt-1 border-t border-black/10">
                    {activeCard.recallCheckPrompt}
                  </div>
                </div>
              )}
            </button>

            {/* Card Footer: Flip, Self-Rating & Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={safeIndex === 0}
                  className="px-3 py-2 text-xs font-semibold text-[#0F2942] bg-[#F3F9FF] border border-[#DCEBFA] rounded-xl disabled:opacity-40 flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={handleToggleFlip}
                  data-testid="flashcard-flip-button"
                  className="px-3.5 py-2 text-xs font-bold text-[#158EE3] bg-[#EBF5FF] hover:bg-[#DCEEFF] border border-[#B9DCF9] rounded-xl flex items-center gap-1.5"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>{isFlipped ? 'Show Front' : 'Flip Card'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={safeIndex >= deck.length - 1}
                  className="px-3 py-2 text-xs font-semibold text-[#0F2942] bg-[#F3F9FF] border border-[#DCEBFA] rounded-xl disabled:opacity-40 flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleMarkConfidence('review')}
                  data-testid="flashcard-mark-review"
                  className="px-3.5 py-2 text-xs font-bold text-[#8F5300] bg-[#FFF5E0] hover:bg-[#FDEBC2] border border-[#FAD58A] rounded-xl transition-colors"
                >
                  Need More Practice
                </button>
                <button
                  type="button"
                  onClick={() => handleMarkConfidence('mastered')}
                  data-testid="flashcard-mark-mastered"
                  className="px-4 py-2 text-xs font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Got It Locked!</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Deck Mastery, Card Map & Memory Science */}
        <aside className="lg:col-span-5 bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-display font-bold text-[#0F2942]">
                Mnemonic Deck Mastery
              </h3>
              <span
                data-testid="flashcard-mastery-summary"
                className="text-xs font-bold text-[#158EE3] tabular-nums"
              >
                {progress.masteredCount}/{progress.totalCount} Locked ({progress.masteryPercent}%)
              </span>
            </div>

            <div className="mt-2.5 h-3 bg-[#EBF5FF] rounded-full overflow-hidden">
              <div
                role="progressbar"
                aria-label="Mnemonic flashcard deck mastery"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.masteryPercent}
                className="h-full bg-[#4CAF50] transition-all duration-300"
                style={{ width: `${Math.max(4, progress.masteryPercent)}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-[#526A84] mt-2 tabular-nums">
              <span>{progress.reviewCount} flagged for review</span>
              <span>{progress.unseenCount} remaining</span>
            </div>
          </div>

          {progress.reviewCount > 0 && (
            <button
              type="button"
              onClick={() => setReviewQueueOnly((r) => !r)}
              data-testid="flashcard-review-queue-toggle"
              className={`w-full py-2 px-3.5 text-xs font-bold rounded-xl border transition-colors ${
                reviewQueueOnly
                  ? 'bg-[#F96A1B] border-[#DE580E] text-white'
                  : 'bg-[#FFF5E0] border-[#FAD58A] text-[#8F5300] hover:bg-[#FDEBC2]'
              }`}
            >
              {reviewQueueOnly
                ? `Showing Flagged Cards Only (${progress.reviewCount}) · Click for Full Deck`
                : `Practice Flagged Cards (${progress.reviewCount})`}
            </button>
          )}

          <div>
            <div className="text-xs font-bold text-[#0F2942] mb-2">Card Navigator</div>
            <div className="grid grid-cols-6 gap-2">
              {deck.map((card, idx) => {
                const status = confidenceMap[card.id];
                const isCurrent = idx === safeIndex;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => {
                      setCurrentIndex(idx);
                      setIsFlipped(false);
                    }}
                    className={`py-2 rounded-xl text-xs font-bold tabular-nums border ${
                      isCurrent
                        ? 'bg-[#158EE3] border-[#1176BE] text-white'
                        : status === 'mastered'
                        ? 'bg-[#4CAF50] border-[#3E9642] text-white'
                        : status === 'review'
                        ? 'bg-[#FFF5E0] border-[#FAD58A] text-[#8F5300]'
                        : 'bg-[#F8FBFF] border-[#DCEBFA] text-[#526A84] hover:border-[#99CAFA]'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`p-4 rounded-2xl border space-y-1.5 ${meta.panelClass}`}>
            <div className="text-xs font-bold text-[#0F2942]">
              Why {activeCard.strategy} Works · {scienceNote.tagline}
            </div>
            <p className="text-xs text-[#314A63] leading-relaxed">
              {scienceNote.childTip}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
