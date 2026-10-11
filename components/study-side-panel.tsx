"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ListBullets } from "@phosphor-icons/react";

import { MasteryBar } from "@/components/mastery-bar";
import { buttonVariants } from "@/components/ui/button";
import type { SectionMastery } from "@/lib/mastery";
import { outlineHeadingHref, studyOutline, type StudyHeading } from "@/lib/study-outline";
import { cn } from "@/lib/utils";

const SectionMasteryContext = createContext<SectionMastery[] | null>(null);

/** Supplies the pack's section mastery (computed from this visitor's progress) to Contents. */
export function SectionMasteryProvider({ sections, children }: { sections: SectionMastery[] | null; children: ReactNode }) {
  return <SectionMasteryContext.Provider value={sections}>{children}</SectionMasteryContext.Provider>;
}

/** The pack's section mastery, or null outside the pack page. */
export function useSectionMastery(): SectionMastery[] | null {
  return useContext(SectionMasteryContext);
}

/**
 * The Contents list: a mastery bar beside each section heading, or a muted note when it has no score yet.
 * `currentId` marks the section being read (the rail tracks it while scrolling).
 */
export function ContentsList({ headings, sections, onNavigate, currentId }: { headings: StudyHeading[]; sections: SectionMastery[] | null; onNavigate?: () => void; currentId?: string | null }) {
  const byId = new Map((sections ?? []).map((section) => [section.id, section]));
  return (
    <ol className="space-y-1">
      {headings.length ? headings.map((heading) => {
        const section = byId.get(heading.id);
        const current = currentId === heading.id;
        return (
          <li key={heading.id} className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5", current && "-ml-2.5 border-l-2 border-primary")} style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 0.75 + (current ? 0.5 : 0)}rem` }}>
            <a className={cn("min-w-0 break-words text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40", current && "font-semibold")} href={outlineHeadingHref(heading.id)} aria-current={current ? "location" : undefined} onClick={onNavigate}>{heading.text}</a>
            {section ? (section.score === null ? <span className="text-xs text-muted-foreground">Not enough answers yet</span> : <MasteryBar score={section.score} label />) : null}
          </li>
        );
      }) : <li className="text-muted-foreground">No headings yet.</li>}
    </ol>
  );
}

type StudySidePanelProps = {
  markdown: string;
  /** Classes for the Contents trigger (the rail hides it where it shows the same list). */
  className?: string;
};

const TRIGGER_CLASS = cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 max-sm:w-11 max-sm:px-0");

export function StudySidePanel({ markdown, className }: StudySidePanelProps) {
  const [open, setOpen] = useState(false);
  const headings = useMemo(() => studyOutline(markdown), [markdown]);
  const sectionMastery = useContext(SectionMasteryContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelHeadingId = useId();
  const [compactSheet, setCompactSheet] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const sync = () => setCompactSheet(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  // The phone sheet sits inside the strip's stacking context, so the floating
  // stack and the Ask pill hide while it is open (they key off this attribute).
  const sheetOpen = open && compactSheet;
  useEffect(() => {
    if (!sheetOpen) return;
    const root = document.documentElement;
    root.dataset.studySheetOpen = "true";
    return () => {
      delete root.dataset.studySheetOpen;
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
      return;
    }
    const trigger = triggerRef.current;
    triggerRef.current = null;
    trigger?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      // Another open dialog (Sources, Exam date) owns Escape and Tab while it is open.
      const panel = panelRef.current;
      const otherDialogOpen = [...document.querySelectorAll("[role='dialog']:not([hidden])")].some(
        (dialog) => dialog !== panel && !panel?.contains(dialog),
      );
      if (otherDialogOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === "Tab") {
        if (!panel) return;
        const focusable = [...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        )];
        if (focusable.length === 0) {
          event.preventDefault();
          panel.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!panel.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      // A menu opened from the strip is not an outside click.
      if (target instanceof Element && target.closest("[role='dialog'], [role='menu']")) return;
      // Leave focus where the reader clicked.
      triggerRef.current = null;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    if (open) {
      setOpen(false);
      return;
    }
    triggerRef.current = event.currentTarget;
    setOpen(true);
  }

  return (
    <div ref={rootRef} className="study-side-panel relative flex items-center gap-1" aria-label="Study navigation">
      <div className={cn("flex items-center gap-1", className)}>
      <button type="button" className={TRIGGER_CLASS} aria-expanded={open} aria-controls={`${panelHeadingId}-panel`} onClick={toggle}>
        <ListBullets weight="bold" aria-hidden />
        <span className="max-sm:sr-only">Contents</span>
      </button>
      </div>
      {open ? (
        <>
        <button
          type="button"
          className="study-side-panel-backdrop"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setOpen(false)}
        />
        <div
          ref={panelRef}
          id={`${panelHeadingId}-panel`}
          className="study-side-panel-drawer rounded-lg border border-border/70 bg-popover p-3 text-sm text-popover-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          role="dialog"
          aria-modal={compactSheet}
          aria-labelledby={panelHeadingId}
          tabIndex={-1}
        >
          <div className="flex items-center justify-between gap-3">
            <h3 id={panelHeadingId} className="font-semibold">Contents</h3>
            <button type="button" className="min-h-11 min-w-11 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40" onClick={() => setOpen(false)}>Close</button>
          </div>
          <nav className="mt-3" aria-label="Document contents"><ContentsList headings={headings} sections={sectionMastery} onNavigate={() => setOpen(false)} /></nav>
        </div>
        </>
      ) : null}
    </div>
  );
}
