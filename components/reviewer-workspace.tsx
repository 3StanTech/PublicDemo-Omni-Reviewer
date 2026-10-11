"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import type { ViewsPayload } from "@/lib/serialize-view";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { toDurableCardViews, type DurableCardView } from "@/components/carded-view";
import { SourcePanel } from "@/components/source-panel";
import { PackSourcesProvider } from "@/components/source-modal";
import type { AttemptStats } from "@/components/timed-test-me";
import { AskProvider } from "@/components/ask-provider";
import { FocusModeProvider } from "@/components/focus-mode";
import { ScrollJump } from "@/components/scroll-jump";
import { SectionMasteryProvider } from "@/components/study-side-panel";
import {
  demoPackMastery,
  loadDueTodayTotal,
  serializeDemoAttempts,
} from "@/components/study-home";
import { DEMO_TOPIC } from "@/components/topic-tabs";
import { ViewTabs } from "@/components/view-tabs";
import { GenerationControls, useGenerationReplay } from "@/components/generation-controls";
import { GenerationStatus } from "@/components/generation-status";
import type { ModeMenuItem } from "@/components/mode-toolbar";
import { PackReadyNotice } from "@/components/pack-ready-notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { demoApi } from "@/lib/demo/api";
import type { DemoPack, PackId, PackSource } from "@/lib/demo/contract";
import type { MasteryResult } from "@/lib/mastery";
import type { ViewKind } from "@/lib/types";
import { useIsClient } from "@/lib/use-is-client";

type ReviewerWorkspaceProps = {
  /** The visitor's anonymous id. */
  userId: string;
  topicName: string;
  reviewerId: PackId;
  reviewerName: string;
  /** OpenStax sections the sample pack covers, e.g. ["3.3"]. */
  sections: string[];
  /** The pack's pasted sections, in citation order. */
  sources: PackSource[];
  initialViews: ViewsPayload;
  examDate: string | null;
  initialMode?: ViewKind;
  initialCards: SerializedCard[];
  initialTestAttemptStats: SerializedAttemptStats[];
};

/** A pack card with this visitor's schedule (named as in the source). */
export type SerializedCard = DurableCardView;

/** Test Me answer counts for one item (named as in the source). */
export type SerializedAttemptStats = AttemptStats;

const MS_PER_DAY = 86_400_000;
const VIEW_KINDS: ViewKind[] = ["locked_in", "summary", "test_me", "carded"];

function examCountdownCopy(examDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(examDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const examStart = new Date(year, month - 1, day);
  const days = Math.round((examStart.getTime() - todayStart.getTime()) / MS_PER_DAY);
  if (days > 0) return `Exam in ${days} days`;
  if (days === 0) return "Exam today";
  return "Exam date passed";
}

function sectionsCopy(sections: string[]): string {
  return `OpenStax Microbiology ${sections.length === 1 ? "section" : "sections"} ${sections.join(", ")}`;
}

export function ReviewerWorkspace({
  userId,
  topicName,
  reviewerId,
  reviewerName,
  sections,
  sources,
  initialViews,
  examDate,
  initialCards,
  initialTestAttemptStats,
  initialMode = "locked_in",
}: ReviewerWorkspaceProps) {
  const views = initialViews;
  const [cards, setCards] = useState(initialCards);
  const [testAttemptStats, setTestAttemptStats] = useState(initialTestAttemptStats);
  const [currentExamDate, setCurrentExamDate] = useState(examDate);
  const [examDateDraft, setExamDateDraft] = useState(examDate ?? "");
  const [examDateBusy, setExamDateBusy] = useState(false);
  const [examDateError, setExamDateError] = useState<string | null>(null);
  const [examDateOpen, setExamDateOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<ViewKind>(initialMode);
  const isClient = useIsClient();
  const replay = useGenerationReplay(reviewerId);

  const examCountdown = currentExamDate
    ? examCountdownCopy(currentExamDate)
    : null;

  async function saveExamDate(next: string = examDateDraft) {
    setExamDateBusy(true);
    setExamDateError(null);
    try {
      const saved = await demoApi.setExamDate(reviewerId, next || null);
      setCurrentExamDate(saved);
      setExamDateDraft(saved ?? "");
      setExamDateOpen(false);
    } catch (error) {
      setExamDateError(error instanceof Error ? error.message : "Could not save exam date.");
    } finally {
      setExamDateBusy(false);
    }
  }

  const sourcesLabel = `Sources (${sources.length})`;
  const examDateLabel = currentExamDate ? `Exam date: ${currentExamDate}` : "Set exam date";
  const packMenuItems: ModeMenuItem[] = [
    {
      id: "sources",
      label: sourcesLabel,
      onSelect: () => setSourcesOpen(true),
    },
    {
      id: "exam-date",
      label: examDateLabel,
      onSelect: () => setExamDateOpen(true),
    },
  ];

  // The rail repeats the pack items (More keeps them: the rail is not always visible).
  const railPack = (
    <section aria-labelledby="rail-pack-heading" className="space-y-1">
      <h3 id="rail-pack-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Pack
      </h3>
      <Button type="button" variant="ghost" size="sm" className="h-9 min-h-9 w-full justify-start" onClick={() => setSourcesOpen(true)}>
        {sourcesLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-9 min-h-9 w-full justify-start" onClick={() => setExamDateOpen(true)}>
        {examDateLabel}
      </Button>
    </section>
  );

  // Client only: the countdown depends on the viewer's clock and zone.
  const headerMeta = [
    isClient ? examCountdown : null,
    sectionsCopy(sections),
  ].filter((item): item is string => Boolean(item));

  const generateSection = (
    <section data-focus-hide className="print-hide space-y-3" aria-labelledby="generate-heading">
      <div>
        <h2
          id="generate-heading"
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          Study pack
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          All four study modes are saved. Generate shows how they were made.
        </p>
      </div>
      <GenerationControls
        state={replay.state}
        onGenerate={() => void replay.start()}
      />
      <GenerationStatus
        state={replay.state}
        onDismiss={replay.dismiss}
      />
    </section>
  );

  const studySection = (
    <section className="space-y-3" aria-labelledby="views-heading">
      <h2 id="views-heading" className="sr-only">
        Study modes
      </h2>
      <ViewTabs
        views={views}
        userId={userId}
        cards={cards}
        examDate={currentExamDate}
        testAttemptStats={testAttemptStats}
        reviewerId={reviewerId}
        packSources={sources}
        onCardsChange={setCards}
        onTestAttemptStatsChange={setTestAttemptStats}
        compact
        value={activeMode}
        onValueChange={setActiveMode}
        packMenuItems={packMenuItems}
        railPack={railPack}
      />
    </section>
  );

  // A finished replay shows a short "ready" line, then the section returns.
  const finishedReplay = replay.state.status === "succeeded" && !replay.state.dismissed;
  const generationNotice = finishedReplay ? (
    <PackReadyNotice label="Pack ready" onDone={replay.dismiss} />
  ) : (
    generateSection
  );

  const examDateDialog = (
    <Dialog
      open={examDateOpen}
      onOpenChange={(open) => {
        setExamDateOpen(open);
        if (open) {
          setExamDateDraft(currentExamDate ?? "");
          setExamDateError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exam date</DialogTitle>
          <DialogDescription>Cards will be scheduled no later than this date.</DialogDescription>
        </DialogHeader>
        <label htmlFor="exam-date" className="grid gap-1 text-xs text-muted-foreground">
          Exam date
          <input
            id="exam-date"
            name="examDate"
            type="date"
            value={examDateDraft}
            onChange={(event) => setExamDateDraft(event.target.value)}
            className="h-11 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          />
        </label>
        {examDateError ? <p role="alert" className="text-xs text-destructive">{examDateError}</p> : null}
        <DialogFooter>
          {currentExamDate ? (
            <Button
              type="button"
              variant="outline"
              disabled={examDateBusy}
              onClick={() => {
                setExamDateDraft("");
                void saveExamDate("");
              }}
            >
              Clear
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => void saveExamDate()}
            disabled={examDateBusy || examDateDraft === (currentExamDate ?? "")}
          >
            {examDateBusy ? "Saving" : "Save date"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const sourcesDialog = (
    <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          {/* The panel shows its own "Sources" heading; the title names the dialog for assistive tech. */}
          <DialogTitle className="sr-only">Sources</DialogTitle>
        </DialogHeader>
        <div data-focus-hide className="print-hide">
          <SourcePanel sources={sources} expanded />
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <PackSourcesProvider sources={sources}>
    <AskProvider reviewerId={reviewerId}>
    <FocusModeProvider>
    <div className="flex flex-col gap-10">
      <div data-focus-hide className="min-w-0 space-y-1">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link
            href="/"
            className="rounded outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {topicName}
          </Link>
          <span aria-hidden>/</span>
          <span className="text-foreground">{reviewerName}</span>
        </nav>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
            {reviewerName}
          </h1>
          {headerMeta.length > 0 ? (
            <p className="text-sm text-muted-foreground">{headerMeta.join(" · ")}</p>
          ) : null}
        </div>
      </div>

      {generationNotice}
      {studySection}
      {sourcesDialog}
      {examDateDialog}
    </div>
    <ScrollJump />
    </FocusModeProvider>
    </AskProvider>
    </PackSourcesProvider>
  );
}

/* ------------------------------------------------------------------------- */
/* Client loader: the static page has no server data, so the workspace is     */
/* assembled in the browser from the pack file and the visitor's progress.    */
/* ------------------------------------------------------------------------- */

type LoadedPack = {
  uid: string;
  pack: DemoPack;
  cards: SerializedCard[];
  attempts: SerializedAttemptStats[];
  examDate: string | null;
  mastery: MasteryResult;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: LoadedPack };

function isViewKind(value: string | null): value is ViewKind {
  return VIEW_KINDS.includes(value as ViewKind);
}

/** The workspace's skeleton, also the static page's first paint. */
export function PackLoading() {
  return (
    <AppShell topics={[DEMO_TOPIC]} selectedTopicId={DEMO_TOPIC.id} wide>
      <div className="space-y-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading study pack</span>
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-72 max-w-full" />
        </div>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </AppShell>
  );
}

/** Loads one sample pack and the visitor's progress, then renders the workspace. */
export function ReviewerWorkspaceLoader({ packId }: { packId: PackId }) {
  const searchParams = useSearchParams();
  const modeParam = searchParams.get("mode");
  const initialMode: ViewKind = isViewKind(modeParam) ? modeParam : "locked_in";
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [dueTodayTotal, setDueTodayTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState({ status: "loading" });
      try {
        const [{ uid }, pack] = await Promise.all([demoApi.ready(), demoApi.loadPack(packId)]);
        const progress = await demoApi.getProgress(packId);
        const now = new Date();
        const data: LoadedPack = {
          uid,
          pack,
          cards: toDurableCardViews(pack.cards, progress.cards, progress.examDate, now),
          attempts: serializeDemoAttempts(progress.attempts),
          examDate: progress.examDate,
          mastery: demoPackMastery(pack, progress, now),
        };
        if (!cancelled) setState({ status: "ready", data });
        // The shelf total covers every pack; it fills in after the workspace shows.
        const total = await loadDueTodayTotal();
        if (!cancelled) setDueTodayTotal(total);
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load this study pack.",
          });
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [packId, attempt]);

  if (state.status === "loading") return <PackLoading />;

  if (state.status === "error") {
    return (
      <AppShell topics={[DEMO_TOPIC]} selectedTopicId={DEMO_TOPIC.id} wide>
        <EmptyState
          title="This study pack did not load"
          description={state.message}
          action={
            <Button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        />
      </AppShell>
    );
  }

  const { data } = state;
  return (
    <AppShell
      topics={[DEMO_TOPIC]}
      selectedTopicId={DEMO_TOPIC.id}
      dueByTopic={{ [DEMO_TOPIC.id]: dueTodayTotal }}
      dueTodayTotal={dueTodayTotal}
      wide
    >
      <SectionMasteryProvider sections={data.mastery.sections}>
        <ReviewerWorkspace
          userId={data.uid}
          topicName={DEMO_TOPIC.name}
          reviewerId={data.pack.id}
          reviewerName={data.pack.name}
          sections={data.pack.sections}
          sources={data.pack.sources}
          initialViews={data.pack.views}
          examDate={data.examDate}
          initialMode={initialMode}
          initialCards={data.cards}
          initialTestAttemptStats={data.attempts}
        />
      </SectionMasteryProvider>
    </AppShell>
  );
}
