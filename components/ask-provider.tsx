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

import type { ChatMessageDto } from "@/components/ask-message";
import { AskPanel, type AskChip } from "@/components/ask-panel";
import { readStudyDocumentMeta, type CitationSourceRef } from "@/lib/citations";
import { demoApi } from "@/lib/demo/api";
import type { PackId } from "@/lib/demo/contract";
import { cn } from "@/lib/utils";

export type SavedAnswer = { answer: ChatMessageDto; question: ChatMessageDto | null };

export type SavedStatus = "idle" | "loading" | "ready" | "error";

type AskApi = {
  /** The pack's ID; named as in the source so shared readers keep working. */
  reviewerId: string;
  isOpen: boolean;
  pending: boolean;
  open: () => void;
  close: () => void;
  /** Opens the panel and plays back one recorded question. Resolves true when it played. */
  ask: (askId: string) => Promise<boolean>;
  /** The demo saves no answers to Notes, so this stays empty. */
  saved: SavedAnswer[];
  savedStatus: SavedStatus;
  savedCount: number;
  /** Nothing to load: the demo has no saved answers. */
  ensureLoaded: () => void;
  removeSaved: (messageId: string) => Promise<void>;
};

const AskContext = createContext<AskApi | null>(null);

export function useAsk(): AskApi {
  const value = useContext(AskContext);
  if (!value) throw new Error("useAsk needs an AskProvider");
  return value;
}

/** Null outside a pack, so shared components can hide their Ask actions there. */
export function useOptionalAsk(): AskApi | null {
  return useContext(AskContext);
}

/** The A key opens Ask unless the user is typing or a dialog is open. */
function shouldOpenOnKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (event.key.toLowerCase() !== "a") return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const target = event.target;
  if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [data-ask-panel]")) {
    return false;
  }
  if (document.querySelector("[role='dialog']:not([hidden]), [role='alertdialog']:not([hidden]), dialog[open]")) return false;
  return true;
}

type RecordedQuestions = {
  chips: AskChip[];
  /** The pack's citation sources, so answer chips open the cited page. */
  citationSources: CitationSourceRef[] | null;
};

type AskProviderProps = {
  /** The pack's ID (named as in the source). */
  reviewerId: PackId;
  children: ReactNode;
};

const NO_SAVED: SavedAnswer[] = [];
const noop = () => undefined;
const resolved = () => Promise.resolve();

/** One provider and one panel per pack, so the thread survives mode changes. */
export function AskProvider(props: AskProviderProps) {
  return <AskProviderInner key={props.reviewerId} {...props} />;
}

function AskProviderInner({ reviewerId: packId, children }: AskProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [recorded, setRecorded] = useState<RecordedQuestions | null>(null);
  const [pending, setPending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const loadRef = useRef<Promise<RecordedQuestions | null> | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const runRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback((): Promise<RecordedQuestions | null> => {
    if (loadRef.current) return loadRef.current;
    const run = (async () => {
      setError(null);
      try {
        const pack = await demoApi.loadPack(packId);
        const next: RecordedQuestions = {
          chips: pack.asks.map((entry) => ({ id: entry.id, question: entry.question })),
          citationSources: readStudyDocumentMeta(pack.views.locked_in?.contentJson ?? null)?.citationSources ?? null,
        };
        if (mountedRef.current) setRecorded(next);
        return next;
      } catch (caught) {
        // A failed load can be retried the next time the panel opens.
        loadRef.current = null;
        if (mountedRef.current) setError(caught instanceof Error ? caught.message : "Could not load this pack's questions.");
        return null;
      }
    })();
    loadRef.current = run;
    return run;
  }, [packId]);

  const open = useCallback(() => {
    setIsOpen(true);
    void load();
  }, [load]);

  const close = useCallback(() => setIsOpen(false), []);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) open();
      else close();
    },
    [close, open],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!shouldOpenOnKey(event)) return;
      event.preventDefault();
      open();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const ask = useCallback(
    async (askId: string): Promise<boolean> => {
      setIsOpen(true);
      if (pendingRef.current) return false;
      pendingRef.current = true;
      const run = ++runRef.current;
      setPending(true);
      setError(null);
      try {
        const questions = await load();
        if (!questions) throw new Error("Could not load this pack's questions. Close Ask and open it again.");
        const chip = questions.chips.find((entry) => entry.id === askId);
        if (!chip) throw new Error("That question is not in this pack.");
        const answerId = `${askId}-answer-${run}`;
        setMessages((current) => [
          ...current,
          { id: `${askId}-question-${run}`, role: "user", content: chip.question, refused: false, citationSources: null },
        ]);
        let started = false;
        for await (const chunk of demoApi.replayAsk(packId, askId)) {
          if (!mountedRef.current || run !== runRef.current) return false;
          if (!started) {
            started = true;
            setStreamingMessageId(answerId);
            setMessages((current) => [
              ...current,
              { id: answerId, role: "assistant", content: chunk, refused: false, citationSources: questions.citationSources },
            ]);
          } else {
            setMessages((current) => current.map((message) => (
              message.id === answerId ? { ...message, content: message.content + chunk } : message
            )));
          }
        }
        return true;
      } catch (caught) {
        if (mountedRef.current && run === runRef.current) {
          setError(caught instanceof Error ? caught.message : "The recorded answer did not play. Try again.");
        }
        return false;
      } finally {
        if (run === runRef.current) {
          pendingRef.current = false;
          if (mountedRef.current) {
            setPending(false);
            setStreamingMessageId(null);
          }
        }
      }
    },
    [load, packId],
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  // Each recorded question is offered until it has been played in this thread.
  const chips = useMemo(() => {
    const asked = new Set(messages.filter((message) => message.role === "user").map((message) => message.content));
    return (recorded?.chips ?? []).filter((chip) => !asked.has(chip.question));
  }, [messages, recorded]);

  const api = useMemo<AskApi>(
    () => ({
      reviewerId: packId,
      isOpen,
      pending,
      open,
      close,
      ask,
      saved: NO_SAVED,
      savedStatus: "ready",
      savedCount: 0,
      ensureLoaded: noop,
      removeSaved: resolved,
    }),
    [ask, close, isOpen, open, packId, pending],
  );

  return (
    <AskContext.Provider value={api}>
      {/* Desktop: keep the study column clear of the side panel while it is open. */}
      <div
        data-ask-open={isOpen ? "true" : "false"}
        className={cn(
          "min-[641px]:data-[ask-open=true]:pr-[min(420px,40vw)]",
          // Leave room to scroll past the phone pill.
          "max-[640px]:pb-16",
        )}
      >
        {children}
      </div>
      <AskPanel
        open={isOpen}
        onOpenChange={onOpenChange}
        messages={messages}
        pending={pending}
        loading={isOpen && !recorded && !error}
        streamingMessageId={streamingMessageId}
        error={error}
        onAsk={(askId) => void ask(askId)}
        onClear={clearChat}
        chips={chips}
        pillRef={pillRef}
      />
    </AskContext.Provider>
  );
}
