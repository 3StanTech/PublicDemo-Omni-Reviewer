"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { CaretDown, CaretRight, ChatCircleDots, CircleNotch } from "@phosphor-icons/react";

import { AskMessage, type ChatMessageDto } from "@/components/ask-message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const ASK_DEMO_NOTE = "In this demo, Ask plays back recorded answers.";

/** A recorded question the visitor can play back. */
export type AskChip = { id: string; question: string };

/** The composer is read-only in the demo, so focus lands on the first recorded question. */
function focusFirstControl(chips: HTMLElement | null, fallback: HTMLElement | null) {
  const chip = chips?.querySelector<HTMLButtonElement>("button:not(:disabled)");
  (chip ?? fallback)?.focus();
}

type AskPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: ChatMessageDto[];
  pending: boolean;
  /** True until the pack's recorded questions have loaded. */
  loading?: boolean;
  /** The recorded answer currently playing back, if any. */
  streamingMessageId?: string | null;
  error: string | null;
  onAsk: (askId: string) => void;
  onClear: () => void;
  /** Recorded questions not yet played in this thread. */
  chips: AskChip[];
  /** The provider's handle on the pill, so the A key and focus return can reach it. */
  pillRef?: RefObject<HTMLButtonElement | null>;
};

export function AskPanel({
  open,
  onOpenChange,
  messages,
  pending,
  loading = false,
  streamingMessageId = null,
  error,
  onAsk,
  onClear,
  chips,
  pillRef,
}: AskPanelProps) {
  const localPillRef = useRef<HTMLButtonElement | null>(null);
  const pill = pillRef ?? localPillRef;
  const panelRef = useRef<HTMLElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const wasPending = useRef(false);
  const titleId = useId();
  const noteId = useId();
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Focus moves into the panel on open and back to the pill on close.
  useEffect(() => {
    if (open) {
      focusFirstControl(chipsRef.current, closeRef.current);
    } else if (wasOpen.current) {
      pill.current?.focus();
    }
    wasOpen.current = open;
  }, [open, pill]);

  // Chips are disabled while an answer plays, which drops focus; take it back when it lands.
  useEffect(() => {
    if (open && wasPending.current && !pending) focusFirstControl(chipsRef.current, closeRef.current);
    wasPending.current = pending;
  }, [open, pending]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const panel = panelRef.current;
      const target = event.target;
      // A nested popover (the unsourced tag) or a dialog opened from a citation chip closes first.
      if (panel?.querySelector("[role='dialog']:not([hidden])")) return;
      if (target instanceof Element && target.closest("[role='dialog']") && !panel?.contains(target)) return;
      event.preventDefault();
      onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // New answers, and each streamed chunk, keep the end of the thread in view.
  const lastContentLength = messages[messages.length - 1]?.content.length ?? 0;
  useEffect(() => {
    if (!open) return;
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [open, messages.length, lastContentLength, pending, loading]);

  if (!open) {
    return (
      <button
        ref={pill}
        type="button"
        data-ask-pill=""
        aria-label="Ask this pack"
        aria-expanded={false}
        className={cn(
          "print-hide [html[data-study-sheet-open]_&]:hidden fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 text-[0.8125rem] font-semibold text-foreground opacity-55 shadow-[0_6px_18px_oklch(0_0_0/25%)] transition-[opacity,background-color] duration-150 outline-none hover:bg-muted hover:opacity-100 focus-visible:bg-muted focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50",
          // On a phone: an icon-only circle at the edge, above Carded's grade buttons, which are left aligned.
          "max-[640px]:right-3 max-[640px]:bottom-[max(6rem,calc(env(safe-area-inset-bottom)_+_5rem))] max-[640px]:w-11 max-[640px]:px-0",
        )}
        onClick={() => onOpenChange(true)}
      >
        <ChatCircleDots weight="bold" className="size-[1.125rem]" aria-hidden />
        <span className="max-[640px]:sr-only">Ask</span>
      </button>
    );
  }

  const empty = messages.length === 0;
  const waitingForFirstChunk = pending && !streamingMessageId;

  return (
    <section
      ref={panelRef}
      data-ask-panel=""
      aria-labelledby={titleId}
      className={cn(
        "print-hide fixed z-40 flex flex-col overflow-hidden border-border bg-card text-card-foreground shadow-[0_12px_40px_oklch(0_0_0/45%)]",
        // Desktop: a right-hand panel that starts below the sticky app header (h-14 plus its 1px border).
        // Phone: a bottom sheet, like the study side panel.
        "top-[calc(3.5rem+1px)] right-0 bottom-0 w-[min(420px,40vw)] border-l",
        "max-[640px]:inset-x-0 max-[640px]:top-auto max-[640px]:bottom-0 max-[640px]:h-[min(80dvh,640px)] max-[640px]:w-full max-[640px]:rounded-t-2xl max-[640px]:border-t max-[640px]:border-l-0 max-[640px]:pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <ChatCircleDots weight="bold" className="size-[1.125rem] text-primary" aria-hidden />
        <h2 id={titleId} className="min-w-0 flex-1 text-sm font-semibold">Ask this pack</h2>
        {!empty ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            aria-expanded={confirmingClear}
            disabled={pending}
            onClick={() => setConfirmingClear((value) => !value)}
          >
            Clear chat
          </Button>
        ) : null}
        <Button
          ref={closeRef}
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Close Ask"
          onClick={() => onOpenChange(false)}
        >
          <CaretRight weight="bold" className="max-[640px]:hidden" aria-hidden />
          <CaretDown weight="bold" className="hidden max-[640px]:block" aria-hidden />
        </Button>
      </header>

      {confirmingClear && !empty ? (
        <div role="group" aria-label="Confirm clear chat" className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1">Clear this chat?</span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              setConfirmingClear(false);
              onClear();
            }}
          >
            Clear
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingClear(false)}>
            Keep chat
          </Button>
        </div>
      ) : null}

      <div
        ref={threadRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-4 py-3"
        aria-live="polite"
        aria-relevant="additions"
      >
        {loading ? (
          <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <CircleNotch weight="bold" className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Loading this pack&apos;s questions
          </p>
        ) : null}
        {empty && !loading && !pending ? (
          <p className="text-sm text-muted-foreground">
            Pick a question about this lecture. Answers come only from this pack&apos;s sources and cite the page.
          </p>
        ) : null}
        {messages.map((message) => (
          <AskMessage
            key={message.id}
            message={message}
            streaming={message.id === streamingMessageId}
          />
        ))}
        {waitingForFirstChunk ? (
          <div role="status" className="flex justify-start">
            <p className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-card px-3.5 py-2 text-sm text-muted-foreground">
              <CircleNotch weight="bold" className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Reading your slides
            </p>
          </div>
        ) : null}
        {!loading && chips.length > 0 ? (
          <div ref={chipsRef} className="flex flex-wrap gap-2" role="group" aria-label="Recorded questions">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                disabled={pending}
                className="min-h-9 pointer-coarse:min-h-11 rounded-full border border-border bg-surface/40 px-3.5 py-1.5 text-left text-[0.8125rem] transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                onClick={() => onAsk(chip.id)}
              >
                {chip.question}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border px-4 py-3">
        {error ? (
          <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>
        ) : null}
        <Textarea
          value=""
          rows={1}
          disabled
          readOnly
          aria-label="Ask about this lecture"
          aria-describedby={noteId}
          placeholder="Ask about this lecture"
          className="max-h-32 min-h-11 resize-none"
        />
        <p id={noteId} className="mt-1.5 text-xs text-muted-foreground">
          {ASK_DEMO_NOTE}
        </p>
      </div>
    </section>
  );
}
