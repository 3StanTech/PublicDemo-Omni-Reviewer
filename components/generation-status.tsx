"use client";

import { X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import type { RecordedStep } from "@/lib/demo/contract";

/** One playback of the pack's recorded generation run. */
export type GenerationState = {
  status: "idle" | "running" | "succeeded" | "failed";
  /** The recorded step being played back. */
  step: RecordedStep["step"] | null;
  /** Steps finished so far, out of `total`. */
  completed: number;
  total: number;
  busy: boolean;
  dismissed: boolean;
  error: string | null;
};

export const IDLE_GENERATION: GenerationState = {
  status: "idle",
  step: null,
  completed: 0,
  total: 0,
  busy: false,
  dismissed: false,
  error: null,
};

export const STEP_LABELS: Record<RecordedStep["step"], string> = {
  locked_in: "Locked In",
  summary: "Summary",
  test_me: "Test Me",
  carded: "Carded",
};

/** The honest label shown beside every generation control and status. */
export function RecordedRunLabel() {
  return (
    <span className="inline-flex items-center rounded-[5px] border border-border bg-muted/60 px-1.5 py-0.5 text-[0.7rem] font-semibold text-muted-foreground">
      Recorded run
    </span>
  );
}

export function GenerationStatus({
  state,
  onDismiss,
}: {
  state: GenerationState;
  onDismiss: () => void;
}) {
  if (state.status === "idle" || state.dismissed) return null;
  const percentage = state.status === "succeeded"
    ? 100
    : state.total > 0
      ? Math.round((state.completed / state.total) * 100)
      : 0;
  const terminal = state.status === "succeeded" || state.status === "failed";
  const title = state.status === "succeeded"
    ? "Finished"
    : state.status === "failed"
      ? "Playback stopped"
      : "Generating";
  return (
    <section
      className="rounded-lg border border-border bg-surface/50 p-3 text-sm"
      aria-labelledby="generation-status-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="generation-status-heading" className="font-medium text-foreground">
              {title}
            </h3>
            <RecordedRunLabel />
          </div>
          <div
            className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            aria-label="Generation progress"
          >
            <div className="h-full bg-primary transition-[width]" style={{ width: `${percentage}%` }} />
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {percentage}%{state.step && !terminal ? ` · ${STEP_LABELS[state.step]}` : ""}
            {state.total > 0 ? ` · ${terminal && state.status === "succeeded" ? state.total : state.completed}/${state.total} steps` : ""}
          </p>
          {state.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
        </div>
        {terminal ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Dismiss generation status">
              <X weight="bold" />
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
