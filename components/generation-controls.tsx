"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleNotch, Sparkle } from "@phosphor-icons/react";

import {
  IDLE_GENERATION,
  RecordedRunLabel,
  type GenerationState,
} from "@/components/generation-status";
import { Button } from "@/components/ui/button";
import { demoApi } from "@/lib/demo/api";
import type { PackId } from "@/lib/demo/contract";

const GENERATION_STEP_COUNT = 4;

/**
 * Plays back the pack's recorded generation run. Nothing is generated: the
 * stored views are already in the pack, and the replay only reports the
 * recorded steps in order.
 */
export function useGenerationReplay(packId: PackId) {
  const [state, setState] = useState<GenerationState>(IDLE_GENERATION);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = useCallback(async () => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ ...IDLE_GENERATION, status: "running", busy: true, total: GENERATION_STEP_COUNT });
    try {
      await demoApi.replayGeneration(
        packId,
        (step, index) => {
          if (controller.signal.aborted) return;
          setState((current) => ({ ...current, step: step.step, completed: index }));
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setState((current) => ({ ...current, status: "succeeded", busy: false, completed: current.total }));
    } catch (caught) {
      if (controller.signal.aborted) return;
      setState((current) => ({
        ...current,
        status: "failed",
        busy: false,
        error: caught instanceof Error ? caught.message : "The recorded run did not play.",
      }));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [packId]);

  const dismiss = useCallback(() => {
    setState((current) => ({ ...current, dismissed: true }));
  }, []);

  return { state, start, dismiss };
}

export function GenerationControls({
  state,
  busyReason = null,
  onGenerate,
}: {
  state: GenerationState;
  /** Set while something must finish first; Generate waits for it. */
  busyReason?: string | null;
  onGenerate: () => void;
}) {
  const help = "Plays back the recorded run that wrote Locked In, Summary, Test Me, and Carded.";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onGenerate}
          disabled={Boolean(busyReason) || state.busy}
          title={busyReason ?? help}
        >
          {state.busy ? <CircleNotch className="animate-spin" weight="bold" /> : <Sparkle weight="fill" />}
          {state.busy ? "Generating" : "Generate"}
        </Button>
        <RecordedRunLabel />
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      {busyReason ? (
        <p role="status" className="text-xs text-muted-foreground">
          {busyReason}
        </p>
      ) : null}
    </div>
  );
}
