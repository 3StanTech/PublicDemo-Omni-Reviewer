"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { DotsThreeVertical } from "@phosphor-icons/react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { CardedView } from "@/components/carded-view";
import { FocusToggle, useFocusMode } from "@/components/focus-mode";
import { LockedInView } from "@/components/locked-in-view";
import { MODE_KIT_ITEMS } from "@/components/mode-kit";
import {
  ModeToolbarProvider,
  useModeMenuItemsValue,
  useModeToolbarRailRef,
  useModeToolbarSlotRef,
  useRailActive,
  type ModeMenuItem,
} from "@/components/mode-toolbar";
import { SectionMasteryList } from "@/components/section-mastery-list";
import { SourceViewerProvider, type PackSourceRef } from "@/components/source-modal";
import { useSectionMastery } from "@/components/study-side-panel";
import { citationSourcesForMode } from "@/lib/citations";
import { studyOutline } from "@/lib/study-outline";
import { SummaryView } from "@/components/summary-view";
import { TestMeView } from "@/components/test-me-view";
import { cn } from "@/lib/utils";
import type { ViewsPayload } from "@/lib/serialize-view";
import type { PackId } from "@/lib/demo/contract";
import type { ViewKind } from "@/lib/types";
import type { SerializedAttemptStats, SerializedCard } from "@/components/reviewer-workspace";

type ViewTabsProps = {
  userId: string;
  views: ViewsPayload;
  viewsLoading?: boolean;
  reviewerId: PackId;
  /** The pack's sections, so the source viewer reads page text from the pack. */
  packSources?: PackSourceRef[];
  cards: SerializedCard[];
  testAttemptStats: SerializedAttemptStats[];
  onCardsChange: (cards: SerializedCard[]) => void;
  onTestAttemptStatsChange: (stats: SerializedAttemptStats[]) => void;
  compact?: boolean;
  examDate?: string | null;
  value?: ViewKind;
  onValueChange?: (kind: ViewKind) => void;
  /** Pack-level More items from the workspace (Sources, Exam date). */
  packMenuItems?: ModeMenuItem[];
  /** The rail's Pack section from the workspace (Sources, Exam date). */
  railPack?: ReactNode;
};

const MODE_JOB_LINES = Object.fromEntries(
  MODE_KIT_ITEMS.map((item) => [item.kind, item.job]),
) as Record<ViewKind, string>;

const MODE_COPY: Record<ViewKind, { label: string; jobLine: string }> = {
  locked_in: { label: "Locked In", jobLine: MODE_JOB_LINES.locked_in },
  summary: { label: "Summary", jobLine: MODE_JOB_LINES.summary },
  test_me: { label: "Test Me", jobLine: MODE_JOB_LINES.test_me },
  carded: { label: "Carded", jobLine: MODE_JOB_LINES.carded },
};

function modeHasContent(kind: ViewKind, views: ViewsPayload): boolean {
  const view = views[kind];
  if (!view) return false;
  if (kind === "test_me" || kind === "carded") {
    if (Array.isArray(view.contentJson) && view.contentJson.length > 0) {
      return true;
    }
  }
  return Boolean(view.content?.trim());
}

export function ViewTabs({
  views,
  userId,
  viewsLoading = false,
  reviewerId,
  packSources,
  cards,
  testAttemptStats,
  onCardsChange,
  onTestAttemptStatsChange,
  compact = false,
  examDate = null,
  value,
  onValueChange,
  packMenuItems = [],
  railPack = null,
}: ViewTabsProps) {
  const [uncontrolledTab, setUncontrolledTab] = useState<ViewKind>("locked_in");
  const tab = value ?? uncontrolledTab;
  const { active: focusActive, setAllowed: setFocusAllowed } = useFocusMode();
  // The rail shows only with Ask closed and outside Focus mode; container width decides the rest in CSS.
  const railActive = useRailActive() && !focusActive;
  const sectionMastery = useSectionMastery();
  const lockedInContent = views.locked_in?.content ?? "";
  const lockedInHeadings = useMemo(() => studyOutline(lockedInContent), [lockedInContent]);

  // Focus mode only applies to the one-item-at-a-time modes.
  useEffect(() => {
    setFocusAllowed(tab === "carded" || tab === "test_me");
  }, [setFocusAllowed, tab]);
  useEffect(() => () => setFocusAllowed(false), [setFocusAllowed]);

  function selectTab(next: ViewKind) {
    if (value === undefined) setUncontrolledTab(next);
    onValueChange?.(next);
  }

  // Each mode resolves chips against the source list of its own generation.
  const citationSources = useMemo(() => citationSourcesForMode(views, tab), [tab, views]);

  const copy = MODE_COPY[tab];

  return (
    <SourceViewerProvider citationSources={citationSources} packSources={packSources}>
    <ModeToolbarProvider>
    <Tabs
      value={tab}
      onValueChange={(next) => selectTab(next as ViewKind)}
      className="w-full gap-4"
    >
      {/* The pack container: its width (not the viewport's) decides whether the rail fits, so the topic
          shelf and the Ask padding count. Mode tools hide strip duplicates with the same breakpoint. */}
      <div className="@container/pack flex flex-col gap-4">
      {/* One sticky strip: tabs left; the active mode's tools (portaled into the slot), Focus and More right.
          No overflow here: it would clip the menus and the Contents popover. The tab list scrolls instead. */}
      {/* The wrapper stays in Focus mode so the Focus toggle (the way out, and where focus lands) stays visible;
          tabs, mode tools and More hide individually. */}
      <div className="print-hide sticky top-14 z-20 -mx-1 flex flex-wrap items-end gap-x-2 gap-y-1 border-b border-border bg-background px-1 pt-2 in-data-[focus=on]:border-b-0">
        <TabsList
          data-focus-hide
          variant="line"
          className={cn(
            "min-w-0 flex-1 overflow-x-auto border-b-0",
            compact && "min-h-11 gap-0 p-0",
          )}
          aria-label="Study modes"
        >
          {MODE_KIT_ITEMS.map((item) => (
            <TabsTrigger
              key={item.kind}
              value={item.kind}
              title={item.job}
              className={cn(
                "min-w-[6.5rem]",
                compact && "min-h-11 min-w-0 flex-1 px-2 py-1.5 text-sm",
              )}
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex shrink-0 items-center gap-1 pb-1 max-sm:w-full max-sm:justify-end">
          <ModeToolsSlot />
          <FocusToggle />
          <MoreMenu packItems={packMenuItems} />
        </div>
      </div>
      {compact ? null : (
        <p data-focus-hide className="print-hide text-xs text-muted-foreground">{copy.jobLine}</p>
      )}

      <div className={cn("grid gap-8", railActive && "@min-[64rem]/pack:grid-cols-[minmax(0,1fr)_17.5rem]")}>
      <div className="flex min-w-0 flex-col gap-4">
      <TabsContent value={tab} className="outline-none">
        {viewsLoading && !modeHasContent(tab, views) ? (
          <div className="space-y-3" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading {copy.label}</span>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : tab === "locked_in" ? (
          <LockedInView
            userId={userId}
            content={views.locked_in?.content ?? null}
            view={views.locked_in}
            reviewerId={reviewerId}
          />
        ) : tab === "summary" ? (
          <SummaryView
            userId={userId}
            content={views.summary?.content ?? null}
            view={views.summary}
            reviewerId={reviewerId}
          />
        ) : tab === "test_me" ? (
          <TestMeView
            contentJson={views.test_me?.contentJson ?? null}
            content={views.test_me?.content ?? null}
            reviewerId={reviewerId}
            viewRevision={views.test_me?.revision ?? 1}
            attemptStats={testAttemptStats}
            onAttemptStatsChange={onTestAttemptStatsChange}
            lockedIn={views.locked_in?.content ?? null}
          />
        ) : (
          <CardedView
            contentJson={views.carded?.contentJson ?? null}
            content={views.carded?.content ?? null}
            reviewerId={reviewerId}
            durableCards={cards}
            examDate={examDate}
            onCardsChange={onCardsChange}
            lockedIn={views.locked_in?.content ?? null}
          />
        )}
      </TabsContent>
      {/* Scroll jump's "Jump to end" target: the end of the study content, above the sources footer. */}
      <div data-study-end aria-hidden className="h-px" />
      </div>
      <aside aria-label="Study rail" className={cn("print-hide hidden", railActive && "@min-[64rem]/pack:block")}>
        <div className="sticky top-[7.5rem] flex max-h-[calc(100vh-8.5rem)] flex-col gap-4 overflow-y-auto pb-4">
          <ModeRailSlot />
          {tab === "test_me" || tab === "carded" ? (
            <SectionMasteryList headings={lockedInHeadings} sections={sectionMastery} />
          ) : null}
          {railPack}
        </div>
      </aside>
      </div>
      </div>

    </Tabs>
    </ModeToolbarProvider>
    </SourceViewerProvider>
  );
}

/** The strip element the active mode's tools render into (relative: the Contents popover positions against it). */
function ModeToolsSlot() {
  const slotRef = useModeToolbarSlotRef();
  return <div ref={slotRef} data-focus-hide className="relative flex items-center gap-1 empty:hidden" />;
}

/** The rail element the active mode's rail section renders into (Contents and Notes for the documents). */
function ModeRailSlot() {
  const railRef = useModeToolbarRailRef();
  return <div ref={railRef} className="flex flex-col gap-4 empty:hidden" />;
}

const MENU_ITEM_CLASS = "items-start pointer-coarse:min-h-11";

function MenuItemText({ label, hint }: { label: ReactNode; hint?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span>{label}</span>
      {hint ? <span className="text-xs leading-snug text-muted-foreground">{hint}</span> : null}
    </span>
  );
}

/**
 * The strip's one More menu: the active mode's registered items, then the
 * pack's items. Groups are separated only when present.
 */
function MoreMenu({ packItems }: { packItems: ModeMenuItem[] }) {
  const modeItems = useModeMenuItemsValue();
  if (modeItems.length === 0 && packItems.length === 0) return null;
  const groups: ReactNode[] = [];
  if (modeItems.length > 0) {
    groups.push(
      modeItems.map((item) => (
        <DropdownMenuItem key={item.id} className={MENU_ITEM_CLASS} disabled={item.disabled} onClick={item.onSelect}>
          <MenuItemText label={item.label} hint={item.hint} />
        </DropdownMenuItem>
      )),
    );
  }
  if (packItems.length > 0) {
    groups.push(
      packItems.map((item) => (
        <DropdownMenuItem key={item.id} className={MENU_ITEM_CLASS} disabled={item.disabled} onClick={item.onSelect}>
          <MenuItemText label={item.label} hint={item.hint} />
        </DropdownMenuItem>
      )),
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-focus-hide
            className="pointer-coarse:size-11"
            aria-label="More actions"
          />
        }
      >
        <DotsThreeVertical weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64 max-w-80">
        {groups.map((group, index) => (
          <Fragment key={index}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            {group}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
