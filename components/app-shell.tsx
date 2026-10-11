"use client";

import Link from "next/link";
import { ArrowCounterClockwise, BookOpen, CircleNotch } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { MoodControl } from "@/components/mood-control";
import { clearSessionSaves } from "@/components/timed-test-me";
import {
  TopicNavProvider,
  TopicShelf,
  TopicShelfToggle,
} from "@/components/topic-shelf";
import type { TopicListItem } from "@/components/topic-tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { demoApi } from "@/lib/demo/api";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  className?: string;
  topics?: TopicListItem[];
  selectedTopicId?: string | null;
  dueByTopic?: Record<string, number>;
  /** null while the visitor's progress is still loading (the shelf shows a placeholder, not 0). */
  dueTodayTotal?: number | null;
  showTopicShelf?: boolean;
  /** The pack page uses the desktop width (90rem) for its document and rail; other pages stay at 64rem. */
  wide?: boolean;
};

/** The honest label: this is a demo with sample packs, not the full product. */
function DemoChip() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[0.7rem] font-semibold whitespace-nowrap text-primary">
      Demo · sample packs
    </span>
  );
}

/** "Reset my progress": deletes this visitor's stored progress after a confirm, then reloads fresh. */
function ResetProgress() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      clearSessionSaves();
      await demoApi.resetProgress();
      window.location.reload();
    } catch {
      setError("Could not reset your progress. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground max-sm:size-11 max-sm:px-0"
        aria-haspopup="dialog"
        aria-label="Reset my progress"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <ArrowCounterClockwise weight="bold" aria-hidden className="sm:hidden" />
        <span className="max-sm:sr-only">Reset my progress</span>
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset my progress?</DialogTitle>
            <DialogDescription>
              This deletes your card schedule, test answers, saved sittings and exam dates in all three
              sample packs. The packs themselves stay.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void reset()} disabled={busy}>
              {busy ? (
                <>
                  <CircleNotch className="animate-spin" />
                  Resetting
                </>
              ) : (
                "Reset my progress"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AppShell({
  children,
  title,
  subtitle,
  breadcrumb,
  actions,
  className,
  topics,
  selectedTopicId = null,
  dueByTopic,
  dueTodayTotal = 0,
  showTopicShelf = true,
  wide = false,
}: AppShellProps) {
  return (
    <TopicNavProvider>
      <div className="flex min-h-full flex-1">
        {topics && showTopicShelf ? (
          <div data-focus-hide className="contents">
            <TopicShelf
              topics={topics}
              selectedId={selectedTopicId}
              dueByTopic={dueByTopic}
              dueTodayTotal={dueTodayTotal}
            />
          </div>
        ) : null}
        <div className="flex min-h-full min-w-0 flex-1 flex-col">
          <header data-focus-hide className="sticky top-0 z-40 border-b border-border/70 bg-chrome/90 backdrop-blur-md">
            <div className={cn("mx-auto flex h-14 w-full items-center justify-between gap-2 px-4 sm:gap-3 sm:px-6", wide ? "max-w-[90rem]" : "max-w-5xl")}>
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                {topics && showTopicShelf ? <TopicShelfToggle /> : null}
                <Link
                  href="/"
                  aria-label="Omni-Reviewer home"
                  className="flex shrink-0 items-center gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <BookOpen weight="duotone" className="size-4.5" />
                  </span>
                  <span className="text-sm font-semibold tracking-tight max-sm:sr-only">
                    Omni-Reviewer
                  </span>
                </Link>
                <DemoChip />
                {breadcrumb ? (
                  <div className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground md:flex">
                    <span className="text-border">/</span>
                    {breadcrumb}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <MoodControl />
                {actions}
                <ResetProgress />
              </div>
            </div>
          </header>

          <main
            className={cn(
              "mx-auto flex w-full flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8",
              wide ? "max-w-[90rem]" : "max-w-5xl",
              className,
            )}
          >
            {(title || subtitle) && (
              <div className="mb-6 space-y-1">
                {title ? (
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
                    {title}
                  </h1>
                ) : null}
                {subtitle ? (
                  <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            )}
            {children}
          </main>
        </div>
      </div>
    </TopicNavProvider>
  );
}
