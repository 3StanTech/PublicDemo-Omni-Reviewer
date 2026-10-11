"use client";

import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import {
  packHref,
  ReviewerList,
  type ReviewerListItem,
} from "@/components/reviewer-list";
import { toDurableCardViews, type DurableCardView } from "@/components/carded-view";
import type { AttemptStats } from "@/components/timed-test-me";
import { TodayCard } from "@/components/today-card";
import { TodayModal, type TodayHrefs } from "@/components/today-modal";
import { DEMO_TOPIC, TopicTabs, type TopicListItem } from "@/components/topic-tabs";
import { useTopicNav } from "@/components/topic-shelf";
import { Skeleton } from "@/components/ui/skeleton";
import { demoApi } from "@/lib/demo/api";
import type { CardSchedule, DemoPack, PackSummary } from "@/lib/demo/contract";
import {
  computeMastery,
  MASTERY_WEAK_THRESHOLD,
  sectionsFromLockedIn,
  type MasteryInput,
  type MasteryResult,
} from "@/lib/mastery";
import { selectTodayCards } from "@/lib/pacing";
import { outlineHeadingHref } from "@/lib/study-outline";
import { buildTodayPlan, type TodayPack, type TodayPlan } from "@/lib/today-plan";
import type { TestAttemptStats } from "@/lib/types";

export type StudyHomeToday = {
  plan: TodayPlan;
  /** Topic id per pack id, for pack links. */
  packTopicIds: Record<string, string>;
};

/**
 * Today links into a pack: due cards open Carded, a re-test opens Test Me
 * (where Retry missed lives), a re-read opens Locked In at the section heading.
 */
export function todayHrefs(): TodayHrefs {
  return {
    review: (packId) => packHref(packId, "carded"),
    retest: (packId) => packHref(packId, "test_me"),
    reread: (packId, sectionId) => `${packHref(packId, "locked_in")}${outlineHeadingHref(sectionId)}`,
  };
}

/* ------------------------------------------------------------------------- */
/* Progress to UI shapes. The server assembled these in the full product; the */
/* demo derives them in the browser from the static pack and the visitor's     */
/* stored schedule and attempt counts.                                          */
/* ------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

export type DemoProgress = {
  cards: Record<string, CardSchedule>;
  attempts: TestAttemptStats[];
  examDate: string | null;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Attempt counts with ISO dates, the shape Test Me reads. */
export function serializeDemoAttempts(stats: TestAttemptStats[]): AttemptStats[] {
  return stats.map((item) => ({
    itemId: item.itemId,
    attempts: item.attempts,
    misses: item.misses,
    lastAttemptedAt: toDate(item.lastAttemptedAt)?.toISOString() ?? null,
  }));
}

/**
 * Mastery evidence from stored counts: one answer per attempted item (right
 * when most of its answers were right) and one rating per reviewed card
 * (Again when its interval is a day or less).
 */
function masteryInput(pack: DemoPack, progress: DemoProgress, now: Date, onlyMissed = false): MasteryInput {
  const attempts = progress.attempts
    .filter((item) => item.attempts > 0)
    .map((item) => ({
      itemId: item.itemId,
      correct: item.misses * 2 < item.attempts,
      attemptedAt: toDate(item.lastAttemptedAt) ?? now,
    }))
    .filter((attempt) => !onlyMissed || !attempt.correct);
  const cardReviews = onlyMissed
    ? []
    : Object.entries(progress.cards).flatMap(([cardId, schedule]) => {
        const reviewedAt = toDate(schedule.lastReviewedAt);
        return reviewedAt
          ? [{ cardId, rating: schedule.intervalDays <= 1 ? ("again" as const) : ("good" as const), reviewedAt }]
          : [];
      });
  return {
    lockedIn: pack.views.locked_in?.content ?? null,
    testItems: pack.testItems.map((item) => ({ id: item.id, explanation: item.explanation })),
    attempts,
    cards: onlyMissed ? [] : pack.cards.map((card) => ({ id: card.id, back: card.back, archivedAt: null })),
    cardReviews,
  };
}

/** Section mastery for one pack from this visitor's progress. */
export function demoPackMastery(pack: DemoPack, progress: DemoProgress, now = new Date()): MasteryResult {
  return computeMastery(masteryInput(pack, progress, now));
}

type PacedCounts = Pick<TodayPack, "dueToday" | "reviewDue" | "newToday" | "newRemaining" | "introducedLast24h">;

/** Today's paced counts, from the same `selectTodayCards` Carded queues with. */
function pacedCounts(cards: DurableCardView[], examDate: string | null, now: Date): PacedCounts {
  const introducedLast24h = cards.filter((card) => {
    const first = card.firstReviewedAt ? Date.parse(card.firstReviewedAt) : NaN;
    return Number.isFinite(first) && first > now.getTime() - DAY_MS;
  }).length;
  const today = selectTodayCards(
    cards.map((card) => ({ id: card.id, dueAt: new Date(card.dueAt), createdAt: new Date(card.createdAt), isNew: card.isNew })),
    { examDate, introducedLast24h, now },
  );
  const reviewDue = today.filter((card) => !card.isNew).length;
  const newToday = today.length - reviewDue;
  return {
    dueToday: today.length,
    reviewDue,
    newToday,
    newRemaining: cards.filter((card) => card.isNew).length,
    introducedLast24h,
  };
}

type DeskPack = { summary: PackSummary; pack: DemoPack; progress: DemoProgress; hasActiveSitting: boolean };

function deskData(packs: DeskPack[], now: Date): { reviewers: ReviewerListItem[]; today: StudyHomeToday; dueTodayTotal: number } {
  const todayPacks: TodayPack[] = [];
  const reviewers = packs.map(({ summary, pack, progress, hasActiveSitting }) => {
    const cards = toDurableCardViews(pack.cards, progress.cards, progress.examDate, now);
    const counts = pacedCounts(cards, progress.examDate, now);
    const mastery = demoPackMastery(pack, progress, now);
    const hasWeak = mastery.sections.some((section) => section.weak);
    todayPacks.push({
      id: summary.id,
      topicId: DEMO_TOPIC.id,
      topicName: DEMO_TOPIC.name,
      name: summary.name,
      examDate: progress.examDate,
      ...counts,
      mastery,
      ...(hasWeak
        ? {
            sectionWords: Object.fromEntries(
              sectionsFromLockedIn(pack.views.locked_in?.content ?? "").map((section) => [section.id, section.words]),
            ),
            missedBySection: Object.fromEntries(
              computeMastery(masteryInput(pack, progress, now, true)).sections.map((section) => [section.id, section.items]),
            ),
          }
        : {}),
    });
    const weakTitle =
      mastery.weakest && mastery.weakest.score < MASTERY_WEAK_THRESHOLD ? mastery.weakest.title : null;
    const item: ReviewerListItem = {
      id: summary.id,
      topicId: DEMO_TOPIC.id,
      name: summary.name,
      createdAt: DEMO_TOPIC.createdAt,
      sections: summary.sections,
      cardCount: summary.cardCount,
      testItemCount: summary.testItemCount,
      examDate: progress.examDate,
      dueTodayCount: counts.dueToday,
      reviewDueCount: counts.reviewDue,
      newTodayCount: counts.newToday,
      hasActiveSitting,
      mastery: { score: mastery.pack.score, weakTitle },
    };
    return item;
  });
  return {
    reviewers,
    today: {
      plan: buildTodayPlan({ packs: todayPacks, now }),
      packTopicIds: Object.fromEntries(packs.map(({ summary }) => [summary.id, DEMO_TOPIC.id])),
    },
    dueTodayTotal: todayPacks.reduce((sum, pack) => sum + Math.max(0, pack.dueToday), 0),
  };
}

/** Every pack's progress for the desk; reads each pack file (cached) and its progress once. */
async function loadDeskPacks(summaries: PackSummary[], withSittings = true): Promise<DeskPack[]> {
  return Promise.all(
    summaries.map(async (summary): Promise<DeskPack> => {
      const [pack, progress, session] = await Promise.all([
        demoApi.loadPack(summary.id),
        demoApi.getProgress(summary.id),
        withSittings ? demoApi.getSession(summary.id, "practice") : null,
      ]);
      return { summary, pack, progress, hasActiveSitting: session !== null };
    }),
  );
}

/** Cards due today across every pack: the topic shelf's total. Call after `demoApi.ready()`. */
export async function loadDueTodayTotal(now = new Date()): Promise<number> {
  const packs = await loadDeskPacks(await demoApi.listPacks(), false);
  return deskData(packs, now).dueTodayTotal;
}

type DeskState =
  | { status: "loading" }
  | { status: "ready"; reviewers: ReviewerListItem[]; today: StudyHomeToday | null; dueTodayTotal: number; error: string | null };

const PROGRESS_ERROR = "Your progress could not load. Reload the page to try again.";

/** The home page: loads the sample packs and this visitor's progress, then renders the desk. */
export function StudyDesk() {
  const [desk, setDesk] = useState<DeskState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let summaries: PackSummary[] = [];
      try {
        summaries = await demoApi.listPacks();
        await demoApi.ready();
        const packs = await loadDeskPacks(summaries);
        if (!cancelled) setDesk({ status: "ready", ...deskData(packs, new Date()), error: null });
      } catch {
        if (cancelled) return;
        // The packs are static files; without progress they still list, with nothing due.
        const reviewers: ReviewerListItem[] = summaries.map((summary) => ({
          id: summary.id,
          topicId: DEMO_TOPIC.id,
          name: summary.name,
          createdAt: DEMO_TOPIC.createdAt,
          sections: summary.sections,
          cardCount: summary.cardCount,
          testItemCount: summary.testItemCount,
          examDate: null,
          dueTodayCount: 0,
          reviewDueCount: 0,
          newTodayCount: 0,
          mastery: null,
        }));
        // With no packs at all, the list's empty state explains it.
        setDesk({ status: "ready", reviewers, today: null, dueTodayTotal: 0, error: reviewers.length > 0 ? PROGRESS_ERROR : null });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const topics = [DEMO_TOPIC];
  const ready = desk.status === "ready" ? desk : null;

  return (
    <AppShell
      title="Study desk"
      subtitle="Three sample packs from OpenStax Microbiology, each with all four study modes. Your progress is saved under an anonymous ID in this browser."
      topics={topics}
      selectedTopicId={DEMO_TOPIC.id}
      dueByTopic={{ [DEMO_TOPIC.id]: ready?.dueTodayTotal ?? 0 }}
      dueTodayTotal={ready?.dueTodayTotal ?? 0}
    >
      {ready?.error ? (
        <p role="alert" className="mb-6 text-sm text-destructive">
          {ready.error}
        </p>
      ) : null}
      <StudyHome
        topics={topics}
        selectedId={DEMO_TOPIC.id}
        topicName={DEMO_TOPIC.name}
        reviewers={ready?.reviewers ?? []}
        today={ready?.today ?? null}
        loading={!ready}
      />
    </AppShell>
  );
}

type StudyHomeProps = {
  topics: TopicListItem[];
  selectedId: string | null;
  topicName: string | null;
  reviewers: ReviewerListItem[];
  /** Null while the visitor's progress is unavailable; the Today card is then hidden. */
  today: StudyHomeToday | null;
  /** True while the packs and progress load; the pack list shows a skeleton. */
  loading?: boolean;
};

function ReviewerListSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading study packs</span>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border/80">
        <Skeleton className="h-16 w-full rounded-none" />
        <Skeleton className="h-16 w-full rounded-none" />
        <Skeleton className="h-16 w-full rounded-none" />
      </div>
    </div>
  );
}

export function StudyHome({
  topics,
  selectedId,
  topicName,
  reviewers,
  today,
  loading = false,
}: StudyHomeProps) {
  const topicNav = useTopicNav();
  const [todayOpen, setTodayOpen] = useState(false);
  const hrefs = useMemo(() => todayHrefs(), []);
  const shelfOpen = topicNav?.shelfOpen ?? true;
  const [localOptimisticId, setLocalOptimisticId] = useState<string | null>(
    null,
  );
  const optimisticId = topicNav?.optimisticId ?? localOptimisticId;
  const setOptimisticId = topicNav?.setOptimisticId ?? setLocalOptimisticId;

  useEffect(() => {
    if (optimisticId !== null && optimisticId === selectedId) {
      setOptimisticId(null);
    }
  }, [optimisticId, selectedId, setOptimisticId]);

  const topicPending =
    optimisticId !== null && optimisticId !== selectedId;
  const effectiveSelected = topicPending ? optimisticId : selectedId;

  return (
    <div className="flex flex-col gap-8">
      {today ? (
        <>
          <TodayCard plan={today.plan} hrefs={hrefs} onOpenPlan={() => setTodayOpen(true)} />
          <TodayModal
            plan={today.plan}
            open={todayOpen}
            onOpenChange={setTodayOpen}
            hrefs={hrefs}
          />
        </>
      ) : null}
      <div className={shelfOpen ? "md:hidden" : undefined}>
        <TopicTabs
          topics={topics}
          selectedId={effectiveSelected}
          onOptimisticSelect={setOptimisticId}
        />
      </div>
      {topicPending || loading ? (
        <ReviewerListSkeleton />
      ) : (
        <ReviewerList
          topicName={topicName}
          reviewers={reviewers}
        />
      )}
    </div>
  );
}
