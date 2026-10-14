"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  BookOpen,
  CheckCircle,
  Clock,
  Play,
  XCircle,
} from "@phosphor-icons/react";

import { SittingRecap } from "@/components/sitting-recap";
import { useSourceViewer } from "@/components/source-modal";
import { MarkdownBody } from "@/components/study-markdown";
import { Button } from "@/components/ui/button";
import { parseCitations, stripCitations, type Citation } from "@/lib/citations";
import { demoApi } from "@/lib/demo/api";
import type { PackId } from "@/lib/demo/contract";
import { formatSittingDuration, recapFocusSection } from "@/lib/sitting-recap";
import { isStudyKeyTarget } from "@/lib/study-keys";
import { DEFAULT_TIMED_TEST_SECONDS } from "@/lib/test-timing-constants";
import type { TestAttemptStats, TestMeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AttemptStats = {
  itemId: string;
  attempts: number;
  misses: number;
  lastAttemptedAt: string | null;
};

/** Saved stats merged into the current list: updated items replaced, new ones added. */
export function mergeAttemptStats(current: AttemptStats[], saved: TestAttemptStats[]): AttemptStats[] {
  const next = new Map(current.map((stats) => [stats.itemId, stats]));
  for (const stats of saved) {
    next.set(stats.itemId, {
      itemId: stats.itemId,
      attempts: stats.attempts,
      misses: stats.misses,
      lastAttemptedAt: stats.lastAttemptedAt ? new Date(stats.lastAttemptedAt).toISOString() : null,
    });
  }
  return [...next.values()];
}

export function isCorrect(selected: string, answer: string): boolean {
  return selected.trim().toLowerCase() === answer.trim().toLowerCase();
}

/** Firestore refuses a second write to one document within a second; this leaves a margin. */
const SESSION_SAVE_GAP_MS = 1100;
/** Longest wait between retries of a failed save. */
const SESSION_SAVE_MAX_BACKOFF_MS = 30_000;

type SessionKindName = "practice" | "timed";

/** One pack and kind's save queue. Lives at module level so it outlasts the component. */
type SessionSaveQueue = {
  /** Bumped by every save; a write may only re-queue while it is still the newest. */
  generation: number;
  pending: { state: unknown; generation: number } | null;
  timer: number | null;
  /** The state being written, until its write settles. */
  writing: { state: unknown; generation: number } | null;
  lastWriteAt: number;
  failures: number;
  error: string | null;
  /** Set by clearSessionSaves; a cleared queue's writes settle without effect. */
  cleared: boolean;
};

const sessionSaveQueues = new Map<string, SessionSaveQueue>();
const sessionSaveListeners = new Map<string, Set<() => void>>();

function sessionSaveKey(packId: PackId, kind: SessionKindName): string {
  return `${packId}:${kind}`;
}

function notifySessionSave(key: string) {
  for (const listener of sessionSaveListeners.get(key) ?? []) listener();
}

function sessionSaveQueue(key: string): SessionSaveQueue {
  let queue = sessionSaveQueues.get(key);
  if (!queue) {
    queue = {
      generation: 0, pending: null, timer: null, writing: null,
      lastWriteAt: 0, failures: 0, error: null, cleared: false,
    };
    sessionSaveQueues.set(key, queue);
  }
  return queue;
}

function setSessionSaveError(key: string, queue: SessionSaveQueue, error: string | null) {
  if (queue.error === error) return;
  queue.error = error;
  notifySessionSave(key);
}

function flushSessionSave(key: string, packId: PackId, kind: SessionKindName) {
  const queue = sessionSaveQueue(key);
  if (queue.timer !== null || queue.writing || !queue.pending) return;
  const gap = queue.failures > 0
    ? Math.min(SESSION_SAVE_GAP_MS * 2 ** queue.failures, SESSION_SAVE_MAX_BACKOFF_MS)
    : SESSION_SAVE_GAP_MS;
  const wait = Math.max(0, queue.lastWriteAt + gap - Date.now());
  queue.timer = window.setTimeout(() => {
    queue.timer = null;
    const next = queue.pending;
    if (!next || queue.cleared) return;
    queue.pending = null;
    queue.writing = next;
    void demoApi.saveSession(packId, kind, next.state)
      .then(() => {
        if (queue.cleared) return;
        queue.failures = 0;
        // A newer state may still be pending; its own failure would set a new error.
        setSessionSaveError(key, queue, null);
      }, (caught: unknown) => {
        if (queue.cleared) return;
        queue.failures += 1;
        // Re-queue only while no newer state has been saved or queued since.
        if (queue.generation === next.generation && !queue.pending) queue.pending = next;
        setSessionSaveError(key, queue, caught instanceof Error ? caught.message : "Could not save this sitting.");
      })
      .finally(() => {
        queue.writing = null;
        queue.lastWriteAt = Date.now();
        if (!queue.cleared) flushSessionSave(key, packId, kind);
      });
  }, wait);
}

/**
 * Drops every queued or retrying sitting save and its error, so a progress
 * reset is not undone by a later retry. A write already in flight is not
 * cancelled, but it runs ahead of the reset (demo writes are serialized) and
 * its outcome is ignored.
 */
export function clearSessionSaves() {
  for (const [key, queue] of sessionSaveQueues) {
    queue.cleared = true;
    queue.pending = null;
    if (queue.timer !== null) window.clearTimeout(queue.timer);
    queue.timer = null;
    sessionSaveQueues.delete(key);
    notifySessionSave(key);
  }
}

/**
 * The newest state of a pack and kind's sitting: a queued or in-flight save
 * wins over Firestore, which lags it by the save gap. A Firestore read that a
 * newer save or a reset overtook is discarded and the lookup runs again.
 */
export async function loadSession(packId: PackId, kind: SessionKindName): Promise<unknown> {
  const key = sessionSaveKey(packId, kind);
  for (;;) {
    const queue = sessionSaveQueues.get(key);
    const local = queue ? queue.pending ?? queue.writing : null;
    if (local) return local.state;
    const generation = queue?.generation ?? 0;
    const stored = await demoApi.getSession(packId, kind);
    const current = sessionSaveQueues.get(key);
    if (current === queue && (current?.generation ?? 0) === generation) return stored;
  }
}

/**
 * Saves a sitting's state without blocking the sitting: one write at a time
 * per pack and kind, at least SESSION_SAVE_GAP_MS after the previous one
 * finished, latest state wins. A failed save keeps its state (unless a newer
 * one arrived) and retries with a doubling backoff; `error` holds the failure
 * until a save succeeds. The queue outlives the component, so a remount sees
 * the same error and a pending save is never cancelled. Attempts are saved apart.
 */
export function useSessionSaver(packId: PackId, kind: SessionKindName) {
  const key = sessionSaveKey(packId, kind);

  const subscribe = useCallback((listener: () => void) => {
    let listeners = sessionSaveListeners.get(key);
    if (!listeners) {
      listeners = new Set();
      sessionSaveListeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) sessionSaveListeners.delete(key);
    };
  }, [key]);
  const error = useSyncExternalStore(
    subscribe,
    () => sessionSaveQueues.get(key)?.error ?? null,
    () => null,
  );

  const save = useCallback((state: unknown) => {
    const queue = sessionSaveQueue(key);
    queue.generation += 1;
    queue.pending = { state, generation: queue.generation };
    flushSessionSave(key, packId, kind);
  }, [key, packId, kind]);

  return { save, error };
}

type TimedSessionResponse = {
  sessionId: string;
  viewRevision: number;
  startedAt: string;
  expiresAt: string;
  durationSeconds: number;
  answeredItemIds: string[];
  /** Correctness per answered item. Runs saved before this field have none. */
  results: Record<string, boolean>;
};

/** A stored timed run, or null when it is missing, malformed or for another revision. */
function readTimedSession(value: unknown, viewRevision: number): TimedSessionResponse | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<TimedSessionResponse>;
  if (
    typeof data.sessionId !== "string" ||
    data.viewRevision !== viewRevision ||
    typeof data.startedAt !== "string" ||
    typeof data.expiresAt !== "string" ||
    typeof data.durationSeconds !== "number" ||
    !Array.isArray(data.answeredItemIds)
  ) {
    return null;
  }
  return {
    sessionId: data.sessionId,
    viewRevision,
    startedAt: data.startedAt,
    expiresAt: data.expiresAt,
    durationSeconds: data.durationSeconds,
    answeredItemIds: data.answeredItemIds.filter((itemId): itemId is string => typeof itemId === "string"),
    results: Object.fromEntries(
      Object.entries(data.results && typeof data.results === "object" ? data.results : {})
        .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    ),
  };
}

type TimedTestMeProps = {
  items: TestMeItem[];
  /** The pack's ID (named as in the source). */
  reviewerId: PackId;
  viewRevision: number;
  /** The current stats, so a saved answer updates them in place. */
  attemptStats: AttemptStats[];
  onAttemptStatsChange: (stats: AttemptStats[]) => void;
  lockedIn?: string | null;
  onExit: () => void;
};

const KEY_HINT_STYLE = `.study-key-hint{display:none}@media (pointer: fine){.study-key-hint{display:block}}`;

type TimedSession = TimedSessionResponse & {
  expiresAtMs: number;
};

function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function TimedTestMe({
  items,
  reviewerId: packId,
  viewRevision,
  attemptStats,
  onAttemptStatsChange,
  lockedIn = null,
  onExit,
}: TimedTestMeProps) {
  const [session, setSession] = useState<TimedSession | null>(null);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const itemsRef = useRef(items);
  const { save: saveSession, error: sessionSaveError } = useSessionSaver(packId, "timed");
  const shownMessage = message ?? sessionSaveError;
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const applySession = useCallback((data: TimedSessionResponse): boolean => {
    const expiresAtMs = Date.parse(data.expiresAt);
    const startedAtMs = Date.parse(data.startedAt);
    if (
      !data.sessionId ||
      !Number.isFinite(expiresAtMs) ||
      !Number.isFinite(startedAtMs) ||
      expiresAtMs <= startedAtMs
    ) {
      return false;
    }
    const currentItems = itemsRef.current;
    const nextIndex = currentItems.findIndex((candidate) => !data.answeredItemIds.includes(candidate.id));
    setSession({ ...data, expiresAtMs });
    setStarted(true);
    setComplete(nextIndex === -1);
    // A run already complete on load has no known end time.
    setFinishedAt(null);
    setIndex(nextIndex === -1 ? Math.max(0, currentItems.length - 1) : nextIndex);
    setSelected("");
    setSubmitted(false);
    setResults(data.results);
    setSecondsRemaining(Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)));
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function resumeActiveSession() {
      try {
        const stored = readTimedSession(await loadSession(packId, "timed"), viewRevision);
        if (cancelled || !stored) return;
        // Only a run still on the clock resumes, as an expired run has nothing left to answer.
        if (Date.parse(stored.expiresAt) <= Date.now()) return;
        if (!applySession(stored)) setMessage("Timed test returned an invalid session.");
      } catch (caught) {
        if (!cancelled) {
          setMessage(caught instanceof Error ? caught.message : "Could not resume timed run.");
        }
      } finally {
        if (!cancelled) setLoadingSession(false);
      }
    }
    void resumeActiveSession();
    return () => { cancelled = true; };
  }, [applySession, packId, viewRevision]);

  const item = items[index];
  const score = useMemo(
    () => Object.values(results).filter(Boolean).length,
    [results],
  );

  useEffect(() => {
    if (!session) return;
    const activeSession = session;
    function tick() {
      const next = Math.max(0, Math.ceil((activeSession.expiresAtMs - Date.now()) / 1000));
      setSecondsRemaining(next);
      if (next <= 0) {
        setMessage("Time is up. Start a new timed run to try again.");
      }
    }
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [session]);

  function startRun() {
    setMessage(null);
    const now = Date.now();
    const data: TimedSessionResponse = {
      sessionId: crypto.randomUUID(),
      viewRevision,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + DEFAULT_TIMED_TEST_SECONDS * 1000).toISOString(),
      durationSeconds: DEFAULT_TIMED_TEST_SECONDS,
      answeredItemIds: [],
      results: {},
    };
    if (!applySession(data)) {
      setMessage("Could not start timed run.");
      return;
    }
    saveSession(data);
  }

  async function submitAnswer() {
    if (!session || !item || submitted || secondsRemaining <= 0 || inFlight.current) return;
    const answer = selected.trim();
    if (!answer) {
      setMessage("Choose or enter an answer before continuing.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const correct = isCorrect(answer, item.answer);
      const saved = await demoApi.recordAttempts(packId, [{ itemId: item.id, correct }]);
      onAttemptStatsChange(mergeAttemptStats(attemptStats, saved));
      const nextResults = { ...results, [item.id]: correct };
      setResults(nextResults);
      const answeredItemIds = session.answeredItemIds.includes(item.id)
        ? session.answeredItemIds
        : [...session.answeredItemIds, item.id];
      setSession({ ...session, answeredItemIds });
      saveSession({
        sessionId: session.sessionId,
        viewRevision: session.viewRevision,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        durationSeconds: session.durationSeconds,
        answeredItemIds,
        results: nextResults,
      } satisfies TimedSessionResponse);
      setSubmitted(true);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not save this answer.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function nextQuestion() {
    if (!submitted) return;
    const answered = session?.answeredItemIds ?? [];
    const nextIndex = items.findIndex(
      (candidate, candidateIndex) => candidateIndex > index && !answered.includes(candidate.id),
    );
    if (nextIndex === -1) {
      setComplete(true);
      setFinishedAt((current) => current ?? Date.now());
      return;
    }
    setIndex(nextIndex);
    setSelected("");
    setSubmitted(false);
    setMessage(null);
  }

  function reset() {
    setSession(null);
    setStarted(false);
    setComplete(false);
    setIndex(0);
    setSelected("");
    setSubmitted(false);
    setResults({});
    setMessage(null);
    setLoadingSession(false);
    setFinishedAt(null);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isStudyKeyTarget(event) || !started || !session || complete || !item) return;
      if (event.key === "Enter") {
        // The sitting's own buttons already activate on Enter; let that click run once.
        // Choice radios and buttons outside the sitting (tabs, header) do not block Enter.
        if (event.target instanceof Element && event.target.closest("button:not([role='radio'])")?.closest("[data-test-me-sitting]")) return;
        if (submitted) {
          event.preventDefault();
          nextQuestion();
        } else if (!busy && secondsRemaining > 0 && selected.trim()) {
          event.preventDefault();
          void submitAnswer();
        }
        return;
      }
      if (submitted || busy || secondsRemaining <= 0) return;
      const choice = item.choices?.[Number(event.key) - 1];
      if (/^[1-4]$/.test(event.key) && choice) {
        setSelected(choice);
        setMessage(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // submitAnswer and nextQuestion are recreated each render; the listener only needs the latest closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, complete, item, secondsRemaining, selected, session, started, submitted]);

  if (!started || !session) {
    return (
      <section className="space-y-4 rounded-xl border border-border/80 bg-surface/50 p-4 sm:p-6" aria-labelledby="timed-test-title">
        <div className="flex items-start gap-3">
          <Clock weight="duotone" className="mt-0.5 size-6 shrink-0 text-primary" />
          <div>
            <h2 id="timed-test-title" className="text-base font-semibold text-foreground">Timed Test Me</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              One question at a time for {Math.floor(DEFAULT_TIMED_TEST_SECONDS / 60)} minutes. Each answer is saved to your progress before you continue.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={startRun} disabled={busy || loadingSession}>
            <Play weight="bold" />
            {loadingSession ? "Checking" : "Start timed run"}
          </Button>
          <Button type="button" variant="ghost" onClick={onExit} disabled={busy}>Back to study list</Button>
        </div>
        {shownMessage ? <p role="alert" className="text-sm text-destructive">{shownMessage}</p> : null}
      </section>
    );
  }

  if (complete || !item) {
    const missedTexts = items
      .filter((candidate) => results[candidate.id] === false)
      .map((missed) => [missed.explanation, missed.answer].filter(Boolean).join("\n"));
    const startedAtMs = Date.parse(session.startedAt);
    // A run saved before results were stored cannot be scored.
    const scoreKnown = session.answeredItemIds.every((itemId) => typeof results[itemId] === "boolean");
    return (
      <SittingRecap
        title="Timed run complete"
        lines={[
          ...(scoreKnown ? [`${score} of ${items.length} correct`] : []),
          ...(finishedAt !== null
            ? [`Studied for ${formatSittingDuration(Math.max(0, finishedAt - startedAtMs))}`]
            : []),
        ]}
        focusSection={recapFocusSection({ lockedIn, missedTexts })?.title ?? null}
      >
        <p className="text-sm text-muted-foreground">Your attempts and misses are saved.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={reset}><ArrowCounterClockwise weight="bold" />Start again</Button>
          <Button type="button" variant="ghost" onClick={onExit}>Back to study list</Button>
        </div>
      </SittingRecap>
    );
  }

  const questionId = `timed-test-question-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const choiceId = (choiceIndex: number) => `${questionId}-choice-${choiceIndex + 1}`;
  const expired = secondsRemaining <= 0;

  return (
    <section className="space-y-4" aria-labelledby={questionId} data-test-me-sitting>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface/50 px-4 py-3">
        <span className="text-sm text-muted-foreground">Question {index + 1} of {items.length}</span>
        <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums", secondsRemaining <= 30 && "text-destructive")} role="timer" aria-live="polite">
          <Clock weight="bold" />
          {formatRemaining(secondsRemaining)}
        </span>
      </div>

      <article className="rounded-xl border border-border/80 bg-surface/50 p-4 sm:p-6">
        <div id={questionId} className="mb-4 text-sm font-medium leading-relaxed text-foreground">
          <MarkdownBody source={item.question} />
        </div>
        {item.choices ? (
          <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby={questionId}>
            {item.choices.map((choice, choiceIndex) => {
              const active = selected === choice;
              return (
                <button
                  key={choiceId(choiceIndex)}
                  id={choiceId(choiceIndex)}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={submitted || expired || busy}
                  className={cn(
                    "min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                    active ? "border-primary/50 bg-primary/10 text-foreground" : "border-border/80 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                  onClick={() => { setSelected(choice); setMessage(null); }}
                >
                  <MarkdownBody source={choice} inline />
                </button>
              );
            })}
          </div>
        ) : (
          <label className="grid gap-1 text-xs text-muted-foreground" htmlFor={`${questionId}-answer`}>
            <span>Open response</span>
            <input
              id={`${questionId}-answer`}
              value={selected}
              disabled={submitted || expired || busy}
              onChange={(event) => { setSelected(event.target.value); setMessage(null); }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (selected.trim()) void submitAnswer();
              }}
              className="min-h-11 rounded-lg border border-border/80 bg-background/40 px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          </label>
        )}

        {submitted ? (
          <div className="mt-4 space-y-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-3" role="status">
            <p className={cn("inline-flex items-center gap-1 text-sm font-medium", results[item.id] ? "text-success" : "text-destructive")}>
              {results[item.id] ? <CheckCircle weight="fill" /> : <XCircle weight="fill" />}
              {results[item.id] ? "Correct" : "Incorrect"}
            </p>
            <div className="text-sm text-muted-foreground"><strong className="text-foreground">Answer:</strong> <MarkdownBody source={item.answer} inline /></div>
            {item.explanation ? <MarkdownBody source={item.explanation} /> : null}
            <div className="flex flex-wrap gap-2 empty:-mt-2">
              {results[item.id] ? null : <OpenCitedPage texts={[item.explanation, item.answer]} />}
            </div>
          </div>
        ) : null}
      </article>
      <style>{KEY_HINT_STYLE}</style>
      <p className="study-key-hint text-xs text-muted-foreground">
        {submitted ? "Enter next · F focus" : item.choices ? "1-4 choose · Enter submit · F focus" : "Enter submit · F focus"}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onExit} disabled={busy}>Exit run</Button>
        <div className="flex gap-2">
          {submitted ? (
            <Button type="button" onClick={nextQuestion}><ArrowRight weight="bold" />{index >= items.length - 1 ? "Finish" : "Next question"}</Button>
          ) : (
            <Button type="button" onClick={() => void submitAnswer()} disabled={busy || expired || !selected.trim()}>{busy ? "Saving" : "Submit answer"}</Button>
          )}
        </div>
      </div>
      {shownMessage ? <p role="alert" className="text-sm text-destructive">{shownMessage}</p> : null}
      {expired && !shownMessage ? <p role="status" className="text-sm text-destructive">Time is up. Your next answer cannot be saved.</p> : null}
    </section>
  );
}

/** First citation with a page number across the given texts, in order. */
export function firstPageCitation(texts: ReadonlyArray<string | null | undefined>): Citation | null {
  for (const text of texts) {
    if (!text) continue;
    const cited = parseCitations(text).find((citation) => citation.pageStart !== null);
    if (cited) return cited;
  }
  return null;
}

/**
 * "Open page N" after a wrong answer, for the first page cited by the
 * explanation or answer. Renders nothing when no viewer or page is available.
 */
export function OpenCitedPage({ texts }: { texts: ReadonlyArray<string | null | undefined> }) {
  const { openSource, available } = useSourceViewer();
  const citation = firstPageCitation(texts);
  if (!available || !citation || citation.pageStart === null) return null;
  const page = citation.pageStart;
  const claim = texts.map((text) => (text ? stripCitations(text).trim() : "")).find(Boolean) ?? null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => openSource({ source: citation.source, page, pageEnd: citation.pageEnd, claim })}
    >
      <BookOpen weight="bold" />
      Open page {page}
    </Button>
  );
}
