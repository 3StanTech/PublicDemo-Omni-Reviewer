"use client";

import Link, { useLinkStatus } from "next/link";
import { useId } from "react";
import {
  CaretRight,
  Cards,
  CircleNotch,
  Exam,
  Notebook,
  WarningCircle,
} from "@phosphor-icons/react";

import { EmptyState } from "@/components/empty-state";
import { MasteryBar } from "@/components/mastery-bar";
import { Button } from "@/components/ui/button";
import { dueSplitCopy, WEAK_SECTION_DEFINITION } from "@/lib/today-plan";

export type ReviewerListItem = {
  id: string;
  topicId: string;
  name: string;
  createdAt: string;
  /** OpenStax sections the sample pack covers, e.g. ["2.3", "2.4"]. */
  sections: string[];
  cardCount: number;
  testItemCount: number;
  examDate: string | null;
  /** Due today: `reviewDueCount + newTodayCount`; shows the Review button. */
  dueTodayCount: number;
  reviewDueCount: number;
  newTodayCount: number;
  hasActiveSitting?: boolean;
  /** Pack mastery, and the weakest section's title when that section is weak. */
  mastery?: { score: number | null; weakTitle: string | null } | null;
};

/** The pack row's mastery bar and weak-section chip; nothing until the pack has a score. */
export function PackMastery({ mastery }: { mastery: ReviewerListItem["mastery"] }) {
  const weakDefinitionId = useId();
  if (!mastery) return null;
  return (
    <>
      {mastery.score !== null ? (
        <span className="inline-flex shrink-0 items-center gap-1.5">
          Mastery
          <MasteryBar score={mastery.score} label />
        </span>
      ) : null}
      {mastery.weakTitle ? (
        <span
          className="flex min-w-0 basis-full items-start gap-1"
          title={WEAK_SECTION_DEFINITION}
          aria-describedby={weakDefinitionId}
        >
          <WarningCircle weight="bold" aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
          <span className="line-clamp-1 min-w-0 break-words">Weak: {mastery.weakTitle}</span>
          <span id={weakDefinitionId} hidden>
            {WEAK_SECTION_DEFINITION}
          </span>
        </span>
      ) : null}
    </>
  );
}

type ReviewerListProps = {
  topicName: string | null;
  reviewers: ReviewerListItem[];
};

/** Hidden on phones, where the row's right side holds the actions. */
function PackRowChevron() {
  const { pending } = useLinkStatus();
  if (pending) {
    return (
      <>
        <CircleNotch
          className="mt-2 size-4 shrink-0 animate-spin text-muted-foreground max-sm:hidden"
          weight="bold"
          aria-hidden
        />
        <span className="sr-only">Opening</span>
      </>
    );
  }
  return (
    <CaretRight
      className="mt-2 size-4 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100 max-sm:hidden"
      weight="bold"
    />
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "Sections 2.3, 2.4 · 12 cards · 10 questions": what the sample pack holds. */
function packContents(reviewer: ReviewerListItem): string {
  const sections = `${reviewer.sections.length === 1 ? "Section" : "Sections"} ${reviewer.sections.join(", ")}`;
  return `${sections} · ${plural(reviewer.cardCount, "card", "cards")} · ${plural(reviewer.testItemCount, "question", "questions")}`;
}

/** The pack's study route; `mode` opens a study mode directly. */
export function packHref(packId: string, mode?: string): string {
  return `/packs/${packId}/${mode ? `?mode=${mode}` : ""}`;
}

/** The sample packs. Packs are fixed in the demo, so there are no create, rename, delete or upload actions. */
export function ReviewerList({
  topicName,
  reviewers,
}: ReviewerListProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Study packs
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {topicName ? `In ${topicName}` : "Sample packs"}
        </p>
      </div>

      {reviewers.length === 0 ? (
        <EmptyState
          icon={<Notebook weight="duotone" className="size-5" />}
          title="No sample packs loaded"
          description="The sample packs did not load. Check your connection and reload the page."
        />
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-surface/40">
          {reviewers.map((reviewer) => (
            <li key={reviewer.id} className="group flex items-center gap-2 pr-2">
              <Link
                href={packHref(reviewer.id)}
                prefetch
                className="flex min-h-14 min-w-0 flex-1 items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                  <Notebook weight="duotone" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-medium break-words text-foreground">
                    {reviewer.name}
                  </span>
                  <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{packContents(reviewer)}</span>
                    {reviewer.dueTodayCount > 0 ? (
                      <span>{dueSplitCopy(reviewer.reviewDueCount, reviewer.newTodayCount)}</span>
                    ) : null}
                    {reviewer.examDate ? <span>{reviewer.examDate}</span> : null}
                    <PackMastery mastery={reviewer.mastery} />
                  </span>
                </span>
                <PackRowChevron />
              </Link>
              {reviewer.dueTodayCount > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="max-sm:size-11 max-sm:px-0"
                  nativeButton={false}
                  aria-label={`Review due cards in ${reviewer.name}`}
                  render={<Link href={packHref(reviewer.id, "carded")} />}
                >
                  <Cards aria-hidden weight="bold" className="sm:hidden" />
                  <span className="max-sm:sr-only">Review</span>
                </Button>
              ) : reviewer.hasActiveSitting ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="max-sm:size-11 max-sm:px-0"
                  nativeButton={false}
                  aria-label={`Resume Test Me in ${reviewer.name}`}
                  render={<Link href={packHref(reviewer.id, "test_me")} />}
                >
                  <Exam aria-hidden weight="bold" className="sm:hidden" />
                  <span className="max-sm:sr-only">Resume</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
