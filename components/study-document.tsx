"use client";

import { useEffect, useMemo, useRef } from "react";
import { SealCheck } from "@phosphor-icons/react";

import { ModeActions, ModeRail, useModeMenuItems, useRailActive, type ModeMenuItem } from "@/components/mode-toolbar";
import { MarkdownBody } from "@/components/study-markdown";
import { SOURCE_LIST_UNAVAILABLE, useSourceViewer } from "@/components/source-modal";
import { StudyRail } from "@/components/study-rail";
import { StudySidePanel } from "@/components/study-side-panel";
import { UnsourcedActionsProvider } from "@/components/unsourced-tag";
import { countClaims, parseCitations, readStudyDocumentMeta } from "@/lib/citations";
import type { SerializedView } from "@/lib/serialize-view";
import { readReadingPosition, readingPositionKey, writeReadingPosition } from "@/lib/reading-position";
import { getLocalStorage } from "@/lib/safe-storage";
import { markWideInlineMath } from "@/lib/wide-math";

type StudyDocumentProps = {
  userId?: string;
  reviewerId: string;
  kind: "locked_in" | "summary";
  view: SerializedView;
};

/** A read-only Locked In or Summary document: claim count, Contents, rail, citations and unsourced tags. */
export function StudyDocument({ userId, reviewerId, kind, view }: StudyDocumentProps) {
  const articleRef = useRef<HTMLElement>(null);
  const { openSource, available: sourcesAvailable } = useSourceViewer();
  const claims = useMemo(() => countClaims(view.content), [view.content]);
  const firstCitation = useMemo(() => parseCitations(view.content)[0] ?? null, [view.content]);
  // Only a grounded document can say how many claims came from the sources:
  // every claim without an unsourced tag passed the lexical or model check.
  const grounding = useMemo(() => readStudyDocumentMeta(view.contentJson)?.grounding ?? null, [view.contentJson]);
  const showClaimCount = Boolean(grounding) && claims.total > 0;
  // Claims the verifier could not reach are neither confirmed nor tagged.
  const unchecked = Math.min(grounding?.unchecked ?? 0, Math.max(0, claims.total - claims.unsourced));
  // Where the rail shows (wide pack layout, Ask closed) it carries Contents instead of the strip.
  const railActive = useRailActive();

  useEffect(() => {
    if (!userId || !articleRef.current) return;
    const key = readingPositionKey(userId, reviewerId, kind, view.contentRevision);
    const storage = getLocalStorage();
    const saved = readReadingPosition(storage, key);
    const restore = () => {
      if (!saved) return;
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({ top: max * saved.offset, behavior: "auto" });
    };
    const restoreFrame = window.requestAnimationFrame(restore);
    let timer: number | undefined;
    const currentHeadingId = () => {
      const headings = articleRef.current?.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]");
      if (!headings) return null;
      let visible: string | null = null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 128) visible = heading.id;
        else break;
      }
      return visible;
    };
    const remember = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        writeReadingPosition(storage, key, { headingId: currentHeadingId(), offset: Math.min(1, Math.max(0, window.scrollY / max)) });
      }, 200);
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => { window.cancelAnimationFrame(restoreFrame); window.removeEventListener("scroll", remember); if (timer) window.clearTimeout(timer); };
  }, [kind, reviewerId, userId, view.contentRevision]);

  useEffect(() => {
    // Inline formulas wider than the column scroll inside it; re-measure when the column resizes.
    const article = articleRef.current;
    if (!article) return;
    const mark = () => markWideInlineMath(article);
    mark();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
    observer?.observe(article);
    // Math fonts can arrive after the first measure and change formula widths.
    let live = true;
    void document.fonts?.ready.then(() => { if (live) mark(); });
    return () => { live = false; observer?.disconnect(); };
  }, [view.content]);

  const unsourcedInfo = useMemo(
    () => ({
      checkIncomplete: Boolean(grounding?.verifierFailed || grounding?.truncated),
      // Each tag's reason line looks up its claim in the recorded term-guard reasons.
      termFlags: grounding ? grounding.termFlags ?? {} : undefined,
      content: view.content,
    }),
    [grounding, view.content],
  );

  const sourcedClaims = claims.total - claims.unsourced - unchecked;
  const claimsSentence = `${sourcedClaims} of ${claims.total} claims from the source sections`;
  const uncheckedNote = unchecked > 0 ? `${unchecked} ${unchecked === 1 ? "claim" : "claims"} could not be checked` : null;
  const claimsLabel = uncheckedNote ? `${claimsSentence}. ${uncheckedNote}.` : claimsSentence;
  const sourceUnavailable = !sourcesAvailable ? SOURCE_LIST_UNAVAILABLE : !firstCitation ? "This version has no source citations." : null;

  // Rare document actions live in the strip's More menu.
  const menuItems: ModeMenuItem[] = [
    {
      id: "open-source",
      label: "Open source",
      hint: sourceUnavailable ?? undefined,
      disabled: Boolean(sourceUnavailable),
      onSelect: () => {
        if (!sourcesAvailable || !firstCitation) return;
        openSource({ source: firstCitation.source, page: firstCitation.pageStart });
      },
    },
  ];
  useModeMenuItems(`doc:${kind}`, menuItems);

  return (
    <div className="space-y-3">
      <ModeActions>
        {showClaimCount ? (
          <p
            className="inline-flex min-h-11 items-center gap-1.5 px-2 text-xs font-medium text-foreground"
            title={claimsLabel}
          >
            <SealCheck weight="bold" className="size-3.5 text-primary" aria-hidden />
            <span aria-hidden>{sourcedClaims}/{claims.total} sourced</span>
            <span className="sr-only">{claimsLabel}</span>
          </p>
        ) : null}
        <StudySidePanel
          markdown={view.content}
          className={railActive ? "@min-[64rem]/pack:hidden" : undefined}
        />
      </ModeActions>
      <ModeRail>
        <StudyRail markdown={view.content} articleRef={articleRef} />
      </ModeRail>
      <article
        ref={articleRef}
        tabIndex={-1}
        className="print-document reading-surface rounded-xl px-5 py-6 shadow-[0_8px_30px_oklch(0_0_0/20%)] sm:px-8 sm:py-8"
      >
        <UnsourcedActionsProvider value={unsourcedInfo}>
          <MarkdownBody source={view.content} hideModePrefix />
        </UnsourcedActionsProvider>
      </article>
    </div>
  );
}
