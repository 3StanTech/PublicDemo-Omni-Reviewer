"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CaretLeft, CaretRight, FileText } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CitationSourceRef } from "@/lib/citations";
import type { PackSource } from "@/lib/demo/contract";
import { locatePassage } from "@/lib/passage-locate";
import { PASSAGE_TINT_CLASS, bestScoredPage, rangeTintPages } from "@/lib/passage-tint";

export const SOURCE_LIST_UNAVAILABLE = "Source list unavailable for this version.";

/** `claim` is the cited sentence; when set, the viewer tints the passage that best supports it. */
type OpenSourceArgs = { source: number; page: number | null; pageEnd?: number | null; claim?: string | null };

/** A pasted section of this pack with its page text, as the loaded pack carries it. */
export type PackSourceRef = PackSource;

type SourceViewerValue = {
  openSource: (args: OpenSourceArgs) => void;
  /**
   * Open a page of one of the pack's sections by id, independent of any view's
   * citation list. Returns false when the pack has no such section.
   */
  openSourceById: (args: { sourceId: string; page: number | null }) => boolean;
  /** True when the view stores which section each citation points to. */
  available: boolean;
};

const SourceViewerContext = createContext<SourceViewerValue>({
  openSource: () => undefined,
  openSourceById: () => false,
  available: false,
});

export function useSourceViewer(): SourceViewerValue {
  return useContext(SourceViewerContext);
}

const PackSourcesContext = createContext<PackSource[] | undefined>(undefined);

/**
 * Supplies the loaded pack's sections to every source viewer below it, so a
 * viewer that is not handed `packSources` (an Ask answer, the Sources list)
 * still reads page text from the pack in memory.
 */
export function PackSourcesProvider({ sources, children }: { sources: PackSource[]; children?: ReactNode }) {
  return <PackSourcesContext.Provider value={sources}>{children}</PackSourcesContext.Provider>;
}

/** True when the section was split into numbered pages (page 0 is any text before the first marker). */
export function sourceHasPages(source: PackSource): boolean {
  return source.pages.some((page) => page.n > 0);
}

/** The text of one page, or of the whole section when `page` is null. */
function sourcePageText(source: PackSource, page: number | null): string | null {
  if (page === null) return source.pages.map((entry) => entry.text).join("\n\n");
  return source.pages.find((entry) => entry.n === page)?.text ?? null;
}

function sourcePageCount(source: PackSource): number | null {
  const last = Math.max(0, ...source.pages.map((entry) => entry.n));
  return last > 0 ? last : null;
}

type ViewerTarget = {
  source: number | null;
  sourceId: string | null;
  page: number | null;
  pageEnd: number | null;
  claim: string | null;
};

function scrollTintIntoView(element: HTMLElement) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
}

export function SourceViewerProvider({
  citationSources,
  packSources,
  children,
}: {
  citationSources: CitationSourceRef[] | null;
  /** The pack's sections. Defaults to the nearest `PackSourcesProvider`; citation chips still resolve through `citationSources`. */
  packSources?: PackSourceRef[];
  children?: ReactNode;
}) {
  const inherited = useContext(PackSourcesContext);
  const sources = packSources ?? inherited;
  const [target, setTarget] = useState<ViewerTarget | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const available = Boolean(citationSources && citationSources.length > 0);

  const openSource = useCallback((args: OpenSourceArgs) => {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    setTarget({
      source: args.source,
      sourceId: null,
      page: args.page && args.page > 0 ? args.page : null,
      pageEnd: args.pageEnd ?? null,
      claim: args.claim?.trim() || null,
    });
  }, []);

  const openSourceById = useCallback(
    (args: { sourceId: string; page: number | null }) => {
      if (!sources?.some((entry) => entry.id === args.sourceId)) return false;
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement ? active : null;
      setTarget({
        source: null,
        sourceId: args.sourceId,
        page: args.page && args.page > 0 ? args.page : null,
        pageEnd: null,
        claim: null,
      });
      return true;
    },
    [sources],
  );

  const value = useMemo(
    () => ({ openSource, openSourceById, available }),
    [available, openSource, openSourceById],
  );
  let ref: CitationSourceRef | null = null;
  if (target?.sourceId) {
    const entry = sources?.find((candidate) => candidate.id === target.sourceId);
    if (entry) ref = { index: 0, sourceId: entry.id, filename: entry.label, hasPages: sourceHasPages(entry) };
  } else if (target) {
    ref = citationSources?.find((entry) => entry.index === target.source) ?? null;
  }
  const refSourceId = ref?.sourceId ?? null;
  const packSource = refSourceId ? sources?.find((entry) => entry.id === refSourceId) ?? null : null;

  return (
    <PackSourcesContext.Provider value={sources}>
    <SourceViewerContext.Provider value={value}>
      {children}
      <Dialog open={target !== null} onOpenChange={(open) => { if (!open) setTarget(null); }}>
        <DialogContent
          finalFocus={openerRef}
          className="max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-3xl"
        >
          {target && ref ? (
            <SourceBody
              key={`${ref.sourceId}:${target.page ?? 0}:${target.pageEnd ?? 0}:${target.claim ?? ""}`}
              refEntry={ref}
              source={packSource}
              initialPage={target.page}
              pageEnd={target.pageEnd}
              claim={target.claim}
            />
          ) : (
            <DialogHeader>
              <DialogTitle>Source</DialogTitle>
              <DialogDescription>{SOURCE_LIST_UNAVAILABLE}</DialogDescription>
            </DialogHeader>
          )}
        </DialogContent>
      </Dialog>
    </SourceViewerContext.Provider>
    </PackSourcesContext.Provider>
  );
}

/** A range citation opens the page in it that best supports the claim. */
function bestRangePage(source: PackSource | null, hasPages: boolean, initialPage: number | null, pageEnd: number | null, claim: string | null): number | null {
  if (!source || !claim || initialPage === null || !hasPages || pageEnd === null || pageEnd <= initialPage) return initialPage;
  const scores = rangeTintPages(initialPage, pageEnd).map((candidate) => {
    const text = sourcePageText(source, candidate);
    return { page: candidate, score: text ? locatePassage(claim, text)?.score ?? null : null };
  });
  return bestScoredPage(scores) ?? initialPage;
}

function SourceBody({
  refEntry,
  source,
  initialPage,
  pageEnd,
  claim,
}: {
  refEntry: CitationSourceRef;
  source: PackSource | null;
  initialPage: number | null;
  pageEnd: number | null;
  claim: string | null;
}) {
  const [page, setPage] = useState(() => bestRangePage(source, refEntry.hasPages, initialPage, pageEnd, claim));
  // The claim applies to the opened page only; paging clears it.
  const [tintClaim, setTintClaim] = useState(claim);
  const pageTotal = source ? sourcePageCount(source) : null;
  const text = source ? sourcePageText(source, page) : null;
  const span = useMemo(() => (tintClaim && text ? locatePassage(tintClaim, text) : null), [tintClaim, text]);

  const changePage = (next: (current: number | null) => number | null) => {
    setTintClaim(null);
    setPage(next);
  };
  // Paging works for page-marked text.
  const navPage = refEntry.hasPages ? page : null;
  const pageLabel = page === null
    ? "Cited as the whole source"
    : pageTotal
      ? `Page ${page} of ${pageTotal}`
      : `Page ${page}`;

  return (
    <>
      <DialogHeader className="pr-10">
        <DialogTitle className="flex min-w-0 items-center gap-2">
          <FileText className="size-5 shrink-0 text-primary" />
          <span className="truncate">{refEntry.filename}</span>
        </DialogTitle>
        <DialogDescription>
          {pageLabel}
          {span ? <span className="sr-only"> Supporting passage highlighted</span> : null}
        </DialogDescription>
      </DialogHeader>
      <SourceText text={text} found={source !== null} page={page} span={span} />
      {navPage !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            disabled={navPage <= 1}
            onClick={() => changePage((current) => (current && current > 1 ? current - 1 : current))}
          >
            <CaretLeft />
            {navPage > 1 ? `Page ${navPage - 1}` : "Previous"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            disabled={pageTotal === null || navPage >= pageTotal}
            onClick={() => changePage((current) => (current && pageTotal && current < pageTotal ? current + 1 : current))}
          >
            {pageTotal !== null && navPage < pageTotal ? `Page ${navPage + 1}` : "Next"}
            <CaretRight />
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** The cited page's text from the loaded pack, with the supporting passage tinted. */
function SourceText({
  text,
  found,
  page,
  span,
}: {
  text: string | null;
  found: boolean;
  page: number | null;
  span: { start: number; end: number } | null;
}) {
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (span && markRef.current) scrollTintIntoView(markRef.current);
  }, [span]);

  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/30 px-4 py-4 text-sm leading-relaxed">
      {text ? (
        <p className="max-h-[60dvh] overflow-y-auto whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
          {span ? (
            <>
              {text.slice(0, span.start)}
              <mark ref={markRef} className={PASSAGE_TINT_CLASS.textMark}>{text.slice(span.start, span.end)}</mark>
              {text.slice(span.end)}
            </>
          ) : (
            text
          )}
        </p>
      ) : (
        <p role="alert" className="text-muted-foreground">
          {found ? `Page ${page} has no text in this source.` : "Could not load the text of this source."}
        </p>
      )}
    </div>
  );
}
