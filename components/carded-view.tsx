"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaretLeft,
  CaretRight,
  Cards,
  Eye,
  EyeSlash,
  Presentation,
} from "@phosphor-icons/react";

import { EmptyState } from "@/components/empty-state";
import { useSourceViewer } from "@/components/source-modal";
import { SittingRecap } from "@/components/sitting-recap";
import { MarkdownBody } from "@/components/study-markdown";
import { firstPageCitation } from "@/components/timed-test-me";
import { Button } from "@/components/ui/button";
import { stripCitations } from "@/lib/citations";
import { demoApi } from "@/lib/demo/api";
import type { CardSchedule, PackId } from "@/lib/demo/contract";
import { fsrsPreview, type FsrsCardState } from "@/lib/fsrs";
import { parseCardedItems } from "@/lib/learning";
import { isClozeCardFront, renderClozeText } from "@/lib/learning";
import { formatSittingDuration, nextReturnCopy, recapFocusSection } from "@/lib/sitting-recap";
import {
  captureDueQueue,
  type CapturedCard,
  practiceQueue,
  reconcileDueSession,
} from "@/lib/practice-session";
import { dueLabel, selectTodayCards } from "@/lib/pacing";
import { isStudyKeyTarget } from "@/lib/study-keys";
import { dueSplitCopy } from "@/lib/today-plan";
import type { CardedItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DurableCardView = CardedItem & {
  sourceKey: string;
  revision: number;
  isEdited: boolean;
  isPinned: boolean;
  dueAt: string;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  lastReviewedAt: string | null;
  createdAt: string;
  firstReviewedAt: string | null;
  isNew: boolean;
  /** Stored FSRS state; null until the first review. Feeds the Again/Good previews. */
  fsrs: FsrsCardState | null;
  nextIntervals: { again: { days: number }; good: { days: number } };
};

type CardedViewProps = {
  contentJson: unknown | null;
  content: string | null;
  /** The pack's ID (named as in the source). */
  reviewerId: PackId;
  durableCards: DurableCardView[];
  examDate?: string | null;
  onCardsChange: (cards: DurableCardView[]) => void;
  /** Locked In markdown; names the most-missed section in the recap. */
  lockedIn?: string | null;
};

/**
 * The pack's cards with this visitor's schedules, in the shape Carded shows.
 * A card without a saved schedule is new and due now, at revision 0. Pack order
 * is kept as creation order, so new cards come up in pack order.
 */
export function toDurableCardViews(
  cards: CardedItem[],
  schedules: Record<string, CardSchedule>,
  examDate: string | null,
  now = new Date(),
): DurableCardView[] {
  return cards.map((card, index) => {
    const createdAt = new Date(index * 1000);
    const schedule: CardSchedule = schedules[card.id] ?? {
      dueAt: createdAt,
      intervalDays: 0,
      repetitions: 0,
      easeFactor: 0,
      lastReviewedAt: null,
      revision: 0,
      fsrs: null,
    };
    const preview = fsrsPreview(schedule.fsrs, now, examDate);
    return {
      ...card,
      sourceKey: card.id,
      revision: schedule.revision,
      isEdited: false,
      isPinned: false,
      dueAt: schedule.dueAt.toISOString(),
      intervalDays: schedule.intervalDays,
      repetitions: schedule.repetitions,
      easeFactor: schedule.easeFactor,
      lastReviewedAt: schedule.lastReviewedAt?.toISOString() ?? null,
      createdAt: createdAt.toISOString(),
      // The demo stores only the last review; it stands in for the first one in pacing.
      firstReviewedAt: schedule.lastReviewedAt?.toISOString() ?? null,
      isNew: schedule.repetitions <= 0,
      fsrs: schedule.fsrs,
      nextIntervals: {
        again: { days: preview.again.days },
        good: { days: preview.good.days },
      },
    };
  });
}

function parseCards(
  contentJson: unknown | null,
  content: string | null,
): CardedItem[] {
  return parseCardedItems(contentJson, content ?? "");
}

function isDurableCard(value: CardedItem | DurableCardView | null | undefined): value is DurableCardView {
  return value != null && "revision" in value && typeof value.revision === "number";
}

/** Chips inside a face act on their own; they must never flip the card. */
function isInteractiveInsideFace(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest("button, a, [data-cite-source]"));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's paced queue: the same `selectTodayCards` the pack row counts with. */
function todayCards(cards: DurableCardView[], examDate: string | null, nowMs: number) {
  const now = new Date(nowMs);
  const introducedLast24h = cards.filter((card) => {
    const first = card.firstReviewedAt ? new Date(card.firstReviewedAt).getTime() : NaN;
    return Number.isFinite(first) && first > nowMs - DAY_MS;
  }).length;
  return selectTodayCards(
    cards.map((card) => ({
      id: card.id,
      dueAt: new Date(card.dueAt),
      createdAt: new Date(card.createdAt),
      isNew: card.isNew,
      card,
    })),
    { examDate, introducedLast24h, now },
  ).map((entry) => entry.card);
}

function gradePreview(card: DurableCardView, rating: "again" | "good"): string {
  return intervalCopy(card.nextIntervals[rating].days);
}

function intervalCopy(days: number) {
  if (days <= 0) return "today";
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

export function CardedView({
  contentJson,
  content,
  reviewerId: packId,
  durableCards,
  examDate = null,
  onCardsChange,
  lockedIn = null,
}: CardedViewProps) {
  const generatedCards = useMemo(
    () => parseCards(contentJson, content),
    [contentJson, content],
  );
  const cards = durableCards.length > 0 ? durableCards : generatedCards;
  // Remaining due is the paced selection at dueAt <= now, so the cutoff has to be wall clock.
  /* eslint-disable react-hooks/purity -- dueAt <= now needs Date.now */
  const remaining = useMemo(() => {
    const due = todayCards(durableCards, examDate, Date.now());
    const fresh = due.filter((item) => item.isNew).length;
    return { review: due.length - fresh, fresh };
  }, [durableCards, examDate]);
  /* eslint-enable react-hooks/purity */
  // Practice replays this session's cards without saving ratings or changing schedules.
  const [mode, setMode] = useState<"due" | "browse" | "practice">("due");
  const [queue, setQueue] = useState<CapturedCard[]>(() => {
    const now = Date.now();
    return captureDueQueue(todayCards(durableCards, examDate, now), now);
  });
  const [ratedIds, setRatedIds] = useState<string[]>([]);
  const [tally, setTally] = useState({ again: 0, good: 0 });
  const [againIds, setAgainIds] = useState<string[]>([]);
  const [sessionStartedAt, setSessionStartedAt] = useState(() => Date.now());
  // Set when a rating saves, so the recap duration stops at the last rating.
  const [lastRatedAt, setLastRatedAt] = useState<number | null>(null);
  const [practiceCaptured, setPracticeCaptured] = useState<CapturedCard[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceTally, setPracticeTally] = useState({ again: 0, good: 0 });
  const [practiceAgainIds, setPracticeAgainIds] = useState<string[]>([]);
  const [browseIndex, setBrowseIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [clozeRevealed, setClozeRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleHint, setScheduleHint] = useState<string | null>(null);
  const sourceViewer = useSourceViewer();
  const advanceTimer = useRef<number | null>(null);
  const reviewEpoch = useRef(0);

  useEffect(() => {
    return () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    };
  }, []);

  function captureQueue() {
    const now = Date.now();
    setQueue(captureDueQueue(todayCards(durableCards, examDate, now), now));
    setRatedIds([]);
    setTally({ again: 0, good: 0 });
    setAgainIds([]);
    setSessionStartedAt(now);
    setLastRatedAt(null);
    setFlipped(false);
    setClozeRevealed(false);
    setScheduleHint(null);
    setError(null);
  }

  const ratedSet = useMemo(() => new Set(ratedIds), [ratedIds]);
  const dueSession = useMemo(
    () => reconcileDueSession({
      queue,
      cards: durableCards,
      ratedIds: ratedSet,
    }),
    [durableCards, queue, ratedSet],
  );

  const browsing = mode === "browse";
  const practicing = mode === "practice";
  const cardById = useMemo(() => new Map(durableCards.map((item) => [item.id, item])), [durableCards]);
  // Practice shows each card's latest content; a card deleted meanwhile drops out.
  const practiceCards = useMemo(
    () => practiceCaptured.flatMap((entry) => cardById.get(entry.id) ?? []),
    [cardById, practiceCaptured],
  );
  const practiceDone = practicing && practiceIndex >= practiceCards.length;
  const browseCards = durableCards.length > 0 ? durableCards : generatedCards;
  const safeBrowseIndex = Math.min(browseIndex, Math.max(0, browseCards.length - 1));
  const currentDue = dueSession.current?.card ?? null;
  const card = browsing
    ? browseCards[safeBrowseIndex] ?? null
    : practicing
      ? practiceCards[practiceIndex] ?? null
      : currentDue;
  const dueStale = mode === "due" && Boolean(dueSession.current?.stale);
  const isCloze = Boolean(card && (card.kind === "cloze" || isClozeCardFront(card.front)));

  const packEmpty = cards.length === 0;

  function enterBrowse() {
    setMode("browse");
    setBrowseIndex(0);
    setFlipped(false);
    setClozeRevealed(false);
    setScheduleHint(null);
    setError(null);
  }

  function enterDue() {
    setMode("due");
    captureQueue();
  }

  function enterPractice(cardsToPractice: CapturedCard[]) {
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
    setMode("practice");
    setPracticeCaptured(cardsToPractice);
    setPracticeIndex(0);
    setPracticeTally({ again: 0, good: 0 });
    setPracticeAgainIds([]);
    setFlipped(false);
    setClozeRevealed(false);
    setScheduleHint(null);
    setError(null);
  }

  /** Practice rating: counts locally and moves on. Never saved, so schedules stay as they are. */
  function practiceRate(rating: "again" | "good") {
    if (!practicing || !card) return;
    setPracticeTally((current) => ({ ...current, [rating]: current[rating] + 1 }));
    if (rating === "again") {
      setPracticeAgainIds((current) => current.includes(card.id) ? current : [...current, card.id]);
    }
    setPracticeIndex((index) => index + 1);
    setFlipped(false);
    setClozeRevealed(false);
  }

  function go(delta: number) {
    if (!browsing) return;
    setFlipped(false);
    setClozeRevealed(false);
    setScheduleHint(null);
    setBrowseIndex((prev) => {
      const next = prev + delta;
      if (next < 0) return 0;
      if (next >= browseCards.length) return browseCards.length - 1;
      return next;
    });
  }

  function toggleFlip() {
    if (busy || scheduleHint || dueStale) return;
    setFlipped((open) => !open);
  }

  async function review(rating: "again" | "good") {
    // Practice never saves a rating.
    if (practicing) return;
    if (browsing || !card || !isDurableCard(card) || busy || dueStale) return;
    const expectedRevision = dueSession.current?.stale
      ? dueSession.current.capturedRevision
      : card.revision;
    if (dueSession.current && card.revision !== dueSession.current.capturedRevision) {
      setError("This card changed. Start a new due session before rating it.");
      return;
    }
    const epoch = ++reviewEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const reviewed = await demoApi.reviewCard(packId, card.id, rating, expectedRevision);
      if (epoch !== reviewEpoch.current) return;
      const [updated] = toDurableCardViews([card], { [card.id]: reviewed }, examDate);
      const data = {
        card: {
          ...updated,
          createdAt: card.createdAt,
          firstReviewedAt: card.firstReviewedAt ?? reviewed.lastReviewedAt?.toISOString() ?? new Date().toISOString(),
        },
      };
      onCardsChange(durableCards.map((item) => item.id === data.card.id ? data.card : item));
      setRatedIds((current) => current.includes(card.id) ? current : [...current, card.id]);
      setTally((current) => ({ ...current, [rating]: current[rating] + 1 }));
      if (rating === "again") setAgainIds((current) => current.includes(card.id) ? current : [...current, card.id]);
      setLastRatedAt(Date.now());
      setScheduleHint(`Next review ${intervalCopy(data.card.intervalDays)}`);
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
      advanceTimer.current = window.setTimeout(() => {
        if (epoch !== reviewEpoch.current) return;
        setScheduleHint(null);
        setFlipped(false);
        setClozeRevealed(false);
        advanceTimer.current = null;
      }, 700);
    } catch (caught) {
      if (epoch !== reviewEpoch.current) return;
      setError(caught instanceof Error ? caught.message : "Could not save review.");
    } finally {
      if (epoch === reviewEpoch.current) setBusy(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isStudyKeyTarget(event)) return;
      if (!card || busy || dueStale) return;
      // A focused control inside Carded owns Space (Tab to Good, then Space grades); arrows still step.
      // Controls outside (the tab trigger, header, Focus toggle) must not block the flip.
      const control = event.target instanceof Element
        ? event.target.closest("button, a, [role='button'], summary")
        : null;
      if (event.key === " " && control?.closest("[data-carded-root]")) return;
      // A focused tab list already moves between modes on the arrows.
      if (event.target instanceof Element && event.target.closest("[role='tab']") && event.key !== " ") return;
      if (event.key === " ") {
        event.preventDefault();
        toggleFlip();
        return;
      }
      if (browsing) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(-1);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          go(1);
        }
        return;
      }
      // Grading needs a saved card; generated cards only flip.
      if (!flipped || !isDurableCard(card)) return;
      if (practicing) {
        if (event.key === "1") practiceRate("again");
        if (event.key === "2") practiceRate("good");
        return;
      }
      if (event.key === "1") void review("again");
      if (event.key === "2") void review("good");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // review, practiceRate, go and toggleFlip are recreated each render; the listener only needs the latest closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing, practicing, browseCards.length, busy, card, dueStale, flipped, scheduleHint]);

  // Citations belong to the answer side only.
  const frontSource = stripCitations(
    card && isCloze && !clozeRevealed ? renderClozeText(card.front) : card?.front ?? "",
  );
  const backCitation = card && flipped ? firstPageCitation([card.back]) : null;
  const backPage = backCitation?.pageStart ?? null;

  const recapEndedAt = lastRatedAt ?? sessionStartedAt;
  const recapFocus = dueSession.finished
    ? recapFocusSection({
        lockedIn,
        missedTexts: againIds.flatMap((id) => cardById.get(id)?.back ?? []),
      })?.title ?? null
    : null;
  const recapReturns = dueSession.finished
    ? nextReturnCopy(ratedIds.flatMap((id) => cardById.get(id)?.dueAt ?? []), new Date(recapEndedAt))
    : null;

  const remainingCopy = dueSplitCopy(remaining.review, remaining.fresh) || "none";

  /** Practice missed (hidden when none) and Practice all for a finished round; after practice, Back to due too. */
  function practiceButtons(captured: CapturedCard[], missedIds: string[], afterPractice = false) {
    const missed = practiceQueue({ queue: captured, againIds: missedIds, which: "missed" })
      .filter((entry) => cardById.has(entry.id));
    const all = practiceQueue({ queue: captured, againIds: missedIds, which: "all" })
      .filter((entry) => cardById.has(entry.id));
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {missed.length > 0 ? (
          <Button type="button" variant="outline" onClick={() => enterPractice(missed)}>
            Practice missed ({missed.length})
          </Button>
        ) : null}
        {all.length > 0 ? (
          <Button type="button" variant="outline" onClick={() => enterPractice(all)}>
            Practice all ({all.length})
          </Button>
        ) : null}
        {afterPractice ? (
          <Button type="button" variant="ghost" onClick={enterDue}>
            Back to due
          </Button>
        ) : null}
      </div>
    );
  }

  if (packEmpty) {
    return (
      <EmptyState
        icon={<Cards weight="duotone" className="size-5" />}
        title="Carded is empty"
        description="Generate the pack to build flashcards from the Summary. Flip a card, then step previous or next."
      />
    );
  }

  const sessionLabel = browsing
    ? `Browsing ${browseCards.length === 0 ? 0 : safeBrowseIndex + 1} of ${browseCards.length}`
    : practicing
      ? `Practice ${Math.min(practiceIndex + 1, practiceCards.length)} of ${practiceCards.length}`
      : dueSession.empty
      ? "0 of 0 due"
      : `${dueSession.completed} of ${dueSession.total}`;

  return (
    <div data-carded-root className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <div className="flex items-start justify-between gap-2 text-sm text-muted-foreground">
        <div className="space-y-1">
          <p>{sessionLabel}</p>
          {practicing ? (
            <p className="text-foreground">Practice, not scheduled</p>
          ) : (
            <p>Remaining: {remainingCopy}</p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {browsing || practicing ? (
            <Button type="button" variant="ghost" size="sm" onClick={enterDue}>
              Study due
            </Button>
          ) : null}
          {!browsing ? (
            <Button type="button" variant="ghost" size="sm" onClick={enterBrowse}>
              <Eye weight="bold" />
              Browse all
            </Button>
          ) : null}
        </div>
      </div>
      {mode === "due" && dueSession.empty ? (
        <EmptyState
          icon={<Cards weight="duotone" className="size-5" />}
          title="No cards due"
          description="Nothing is due in this session. Browse all to inspect cards without scheduling, or start again later."
        />
      ) : null}
      {mode === "due" && dueSession.finished ? (
        <SittingRecap
          title="Session complete"
          lines={[
            `${dueSession.completed} cards · ${tally.good} Good · ${tally.again} Again`,
            `Studied for ${formatSittingDuration(recapEndedAt - sessionStartedAt)}`,
          ]}
          focusSection={recapFocus}
          returns={recapReturns}
        >
          <p className="text-sm text-muted-foreground">Newly due cards wait for the next session.</p>
          {practiceButtons(queue, againIds)}
        </SittingRecap>
      ) : null}
      {practiceDone ? (
        <SittingRecap
          title="Practice done"
          lines={[
            `${practiceCards.length} cards · ${practiceTally.good} Good · ${practiceTally.again} Again`,
            "Practice ratings are not saved. Schedules did not change.",
          ]}
        >
          {practiceButtons(practiceCaptured, practiceAgainIds, true)}
        </SittingRecap>
      ) : null}

      {card ? (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {isDurableCard(card) ? <span>{dueLabel(new Date(card.dueAt), new Date(sessionStartedAt))}</span> : null}
        {isDurableCard(card) && (card.isEdited || card.isPinned) ? <span className="text-warning">Protected from silent overwrite</span> : null}
        {dueStale ? <span className="text-warning">This card changed. Start a new due session before rating it.</span> : null}
        {backCitation && backPage !== null && sourceViewer.available ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => sourceViewer.openSource({
              source: backCitation.source,
              page: backPage,
              pageEnd: backCitation.pageEnd,
              claim: stripCitations(card.back).trim() || null,
            })}
          >
            <Presentation weight="bold" />
            Slide {backPage}
          </Button>
        ) : null}
      </div>
      ) : null}

      {card && isCloze ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setClozeRevealed((open) => !open)}
            aria-pressed={clozeRevealed}
          >
            {clozeRevealed ? <EyeSlash weight="bold" /> : <Eye weight="bold" />}
            {clozeRevealed ? "Hide blanks" : "Reveal blanks"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Fill the blanks before revealing the answers.
          </span>
        </div>
      ) : null}

      {card ? (
      <div className="carded-scene">
        <div
          role="button"
          tabIndex={0}
          onClick={toggleFlip}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleFlip();
            }
          }}
          className={cn(
            "carded-flipper group outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
            flipped && "is-flipped",
          )}
          aria-label="Flip"
          aria-pressed={flipped}
        >
          <div className="carded-face carded-front">
            <span className="mb-3 text-[0.65rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Front
            </span>
            <MarkdownBody source={frontSource} />
            <span className="mt-6 text-xs text-muted-foreground">Flip</span>
          </div>
          <div
            className="carded-face carded-back"
            inert={!flipped}
            onClick={(event) => {
              if (isInteractiveInsideFace(event.target)) event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (isInteractiveInsideFace(event.target)) event.stopPropagation();
            }}
          >
            <span className="mb-3 text-[0.65rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Back
            </span>
            <MarkdownBody source={card.back} />
            <span className="mt-6 text-xs text-muted-foreground">Flip</span>
          </div>
        </div>
      </div>
      ) : null}

      {card ? (
        <p className="carded-key-hint text-xs text-muted-foreground">
          {browsing ? "← → move · Space flip · F focus" : "Space flip · 1 Again · 2 Good · F focus"}
        </p>
      ) : null}

      {browsing ? (
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => go(-1)}
          disabled={safeBrowseIndex === 0}
        >
          <CaretLeft weight="bold" />
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => go(1)}
          disabled={safeBrowseIndex >= browseCards.length - 1}
        >
          Next
          <CaretRight weight="bold" />
        </Button>
      </div>
      ) : null}

      {!browsing && isDurableCard(card) && !flipped && !dueStale ? (
        <div className="carded-thumb-bar sm:hidden">
          <Button type="button" variant="outline" className="w-full" onClick={toggleFlip} disabled={busy}>
            Show answer
          </Button>
        </div>
      ) : null}
      {!browsing && isDurableCard(card) && flipped && !dueStale ? (
        <div className="carded-thumb-bar flex flex-wrap gap-2 rounded-xl border border-border/80 bg-surface/50 p-4">
          {practicing ? (
            <>
              <Button type="button" variant="outline" onClick={() => practiceRate("again")}>
                Again
              </Button>
              <Button type="button" variant="secondary" onClick={() => practiceRate("good")}>
                Good
              </Button>
            </>
          ) : scheduleHint ? (
            <p className="w-full text-sm text-foreground">{scheduleHint}</p>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => void review("again")} disabled={busy}>
                Again, {gradePreview(card, "again")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void review("good")} disabled={busy}>
                Good, {gradePreview(card, "good")}
              </Button>
            </>
          )}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <style>{`
        .carded-key-hint {
          display: none;
        }
        @media (pointer: fine) {
          .carded-key-hint {
            display: block;
          }
        }
        @media (max-width: 639px) {
          .carded-thumb-bar {
            position: sticky;
            bottom: 0;
            z-index: 10;
            padding-bottom: max(1rem, env(safe-area-inset-bottom));
            background: var(--background);
          }
          .carded-thumb-bar button {
            min-height: 3rem;
            flex: 1 1 0;
          }
        }
        .carded-scene {
          perspective: 1400px;
        }
        .carded-flipper {
          position: relative;
          min-height: 220px;
          width: 100%;
          cursor: pointer;
          transform-style: preserve-3d;
          transition: transform 700ms ease;
        }
        @media (min-width: 640px) {
          .carded-flipper {
            min-height: 260px;
          }
        }
        .carded-flipper.is-flipped {
          transform: rotateX(180deg);
        }
        .carded-face {
          display: flex;
          min-height: 220px;
          width: 100%;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border-radius: 1rem;
          border: 1px solid color-mix(in oklch, var(--border) 80%, transparent);
          background: color-mix(in oklch, var(--surface) 70%, transparent);
          padding: 2.5rem 1.5rem;
          text-align: center;
          box-shadow: 0 10px 30px oklch(0 0 0 / 25%);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        @media (min-width: 640px) {
          .carded-face {
            min-height: 260px;
          }
        }
        .carded-front {
          position: relative;
        }
        .carded-back {
          position: absolute;
          inset: 0;
          background: color-mix(in oklch, var(--primary) 10%, var(--surface));
          border-color: color-mix(in oklch, var(--primary) 30%, var(--border));
          transform: rotateX(180deg);
        }
      `}</style>
    </div>
  );
}
