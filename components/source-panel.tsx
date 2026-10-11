"use client";

import { Eye, File } from "@phosphor-icons/react";

import { EmptyState } from "@/components/empty-state";
import { SourceViewerProvider, sourceHasPages, useSourceViewer } from "@/components/source-modal";
import { Button } from "@/components/ui/button";
import type { PackSource } from "@/lib/demo/contract";

type SourcePanelProps = {
  /** The loaded pack's pasted sections, in citation order (`S1`, `S2`, …). */
  sources: PackSource[];
  /** When false, hide the list. Parent owns the Sources control. */
  expanded?: boolean;
};

function pageCountLabel(source: PackSource): string | null {
  if (!sourceHasPages(source)) return null;
  const count = source.pages.filter((page) => page.n > 0).length;
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

function SourceRow({ source }: { source: PackSource }) {
  const { openSourceById } = useSourceViewer();
  const pages = pageCountLabel(source);
  return (
    <li className="flex items-start gap-3 px-3 py-3 sm:items-center sm:px-4">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary sm:mt-0">
        <File className="size-4.5" weight="duotone" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium text-foreground">{source.label}</p>
        <p className="text-xs text-muted-foreground">
          Pasted text{pages ? ` · ${pages}` : null}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 shrink-0 sm:min-h-8"
        aria-label={`View ${source.label}`}
        onClick={() => openSourceById({ sourceId: source.id, page: null })}
      >
        <Eye />
        View
      </Button>
    </li>
  );
}

/** Read-only list of the pack's pasted sections; View opens each one's text in the source viewer. */
export function SourcePanel({ sources, expanded = true }: SourcePanelProps) {
  return (
    <section
      id="sources-panel"
      className="space-y-3"
      aria-labelledby="sources-heading"
      hidden={!expanded}
    >
      <div>
        <h2
          id="sources-heading"
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          Sources
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The pasted text sections this pack was generated from.
        </p>
      </div>

      {sources.length === 0 ? (
        <EmptyState
          icon={<File weight="duotone" className="size-5" />}
          title="No sources in this pack"
          description="This sample pack has no source text to show."
        />
      ) : (
        <SourceViewerProvider citationSources={null} packSources={sources}>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-surface/40">
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </ul>
        </SourceViewerProvider>
      )}
    </section>
  );
}
