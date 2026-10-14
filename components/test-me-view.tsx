"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  CheckCircle,
  Clock,
  ListChecks,
  XCircle,
} from "@phosphor-icons/react";

import { EmptyState } from "@/components/empty-state";
import { SittingRecap } from "@/components/sitting-recap";
import { MarkdownBody } from "@/components/study-markdown";
import {
  isCorrect,
  loadSession,
  mergeAttemptStats,
  OpenCitedPage,
  TimedTestMe,
  useSessionSaver,
  type AttemptStats,
} from "@/components/timed-test-me";
import { Button } from "@/components/ui/button";
import { demoApi } from "@/lib/demo/api";
import type { PackId } from "@/lib/demo/contract";
import { parseTestMeItems } from "@/lib/learning";
import { MASTERY_WEAK_THRESHOLD } from "@/lib/mastery";
import { formatSittingDuration, recapFocusSection, sectionBreakdown } from "@/lib/sitting-recap";
import { isStudyKeyTarget } from "@/lib/study-keys";
import {
  canRetryMissed,
  missedItemIds,
  sittingItemsForIds,
  sittingProgress,
  snapshotTestItemIds,
  type PracticeAnswer,
} from "@/lib/practice-session";
import type { TestMeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type TestMeViewProps = {
  contentJson: unknown | null;
  content: string | null;
  /** The pack's ID (named as in the source). */
  reviewerId: PackId;
  viewRevision: number;
  attemptStats: AttemptStats[];
  onAttemptStatsChange: (stats: AttemptStats[]) => void;
  lockedIn?: string | null;
};

const KEY_HINT_STYLE = `.study-key-hint{display:none}@media (pointer: fine){.study-key-hint{display:block}}`;

/** A saved answer keeps enough text for the recap; the stored sitting stays small. */
const STORED_ANSWER_CHARS = 500;

/** The untimed sitting as stored in the visitor's progress. */
type StoredSitting = {
  sessionId: string;
  viewRevision: number;
  status: "active" | "completed";
  itemIds: string[];
  originSessionId: string | null;
  answers: PracticeAnswer[];
};

type UntimedSittingPayload = StoredSitting & {
  nextItemId: string | null;
  nextIndex: number;
  complete: boolean;
  correctCount: number;
  canRetryMissed: boolean;
};

type UntimedSittingLoadResult = UntimedSittingPayload | { error: string };

type UntimedSittingLoad = { key: string; promise: Promise<UntimedSittingLoadResult> };

function sittingPayload(stored: StoredSitting): UntimedSittingPayload {
  const progress = sittingProgress(stored.itemIds, stored.answers);
  const status = progress.complete ? "completed" : stored.status;
  return {
    ...stored,
    status,
    nextItemId: progress.nextItemId,
    nextIndex: progress.nextIndex,
    complete: progress.complete,
    correctCount: progress.correctCount,
    canRetryMissed: canRetryMissed({
      status,
      viewRevision: stored.viewRevision,
      expectedRevision: stored.viewRevision,
      itemIds: stored.itemIds,
      answers: stored.answers,
    }),
  };
}

function storedSitting(payload: UntimedSittingPayload): StoredSitting {
  return {
    sessionId: payload.sessionId,
    viewRevision: payload.viewRevision,
    status: payload.status === "completed" ? "completed" : "active",
    itemIds: payload.itemIds,
    originSessionId: payload.originSessionId,
    answers: payload.answers.map((answer) => ({
      itemId: answer.itemId,
      selectedAnswer: answer.selectedAnswer.slice(0, STORED_ANSWER_CHARS),
      correct: answer.correct,
    })),
  };
}

function newSitting(itemIds: string[], viewRevision: number, originSessionId: string | null): UntimedSittingPayload {
  return sittingPayload({
    sessionId: crypto.randomUUID(),
    viewRevision,
    status: "active",
    itemIds,
    originSessionId,
    answers: [],
  });
}

/** A stored sitting for this revision whose items all still exist, or null. */
function readStoredSitting(value: unknown, viewRevision: number, items: TestMeItem[]): StoredSitting | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<StoredSitting>;
  if (
    typeof data.sessionId !== "string" ||
    data.viewRevision !== viewRevision ||
    (data.status !== "active" && data.status !== "completed") ||
    !Array.isArray(data.itemIds) ||
    !Array.isArray(data.answers)
  ) {
    return null;
  }
  const known = new Set(items.map((item) => item.id));
  const itemIds = data.itemIds.filter((itemId): itemId is string => typeof itemId === "string");
  if (itemIds.length === 0 || itemIds.length !== data.itemIds.length || !itemIds.every((itemId) => known.has(itemId))) return null;
  const answers = data.answers.flatMap((answer: unknown) => {
    if (!answer || typeof answer !== "object") return [];
    const entry = answer as Partial<PracticeAnswer>;
    return typeof entry.itemId === "string" && typeof entry.selectedAnswer === "string" && typeof entry.correct === "boolean"
      ? [{ itemId: entry.itemId, selectedAnswer: entry.selectedAnswer, correct: entry.correct }]
      : [];
  });
  return {
    sessionId: data.sessionId,
    viewRevision,
    status: data.status,
    itemIds,
    originSessionId: typeof data.originSessionId === "string" ? data.originSessionId : null,
    answers,
  };
}

/** Resumes the saved sitting for this revision, or opens a new one over every item. */
async function loadUntimedSitting(
  packId: PackId,
  viewRevision: number,
  items: TestMeItem[],
): Promise<UntimedSittingLoadResult> {
  try {
    const stored = readStoredSitting(await loadSession(packId, "practice"), viewRevision, items);
    return stored ? sittingPayload(stored) : newSitting(snapshotTestItemIds(items), viewRevision, null);
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : "Could not open this sitting." };
  }
}

function controlId(itemId: string, suffix: string): string {
  const trimmed = itemId.trim();
  const readable = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "item";
  const encoded = Array.from(trimmed)
    .map((character) => (character.codePointAt(0) ?? 0).toString(16))
    .join("-");
  return `test-me-${readable}-${encoded || "item"}-${suffix}`;
}

/** The text whose citations place an item in a Locked In section. */
function citedText(item: TestMeItem): string {
  return [item.explanation, item.answer].filter(Boolean).join("\n");
}

export function TestMeView({
  contentJson,
  content,
  reviewerId: packId,
  viewRevision,
  attemptStats,
  onAttemptStatsChange,
  lockedIn = null,
}: TestMeViewProps) {
  const items = useMemo(
    () => parseTestMeItems(contentJson, content ?? ""),
    [contentJson, content],
  );
  const [timed, setTimed] = useState(false);
  const [sittingLoad, setSittingLoad] = useState<UntimedSittingLoad | null>(null);
  const loadKey = `${packId}:${viewRevision}`;
  if (items.length > 0 && !timed && sittingLoad?.key !== loadKey) {
    setSittingLoad({ key: loadKey, promise: loadUntimedSitting(packId, viewRevision, items) });
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks weight="duotone" className="size-5" />}
        title="Test Me is empty"
        description="Generate new multiple-choice questions from Locked In. Legacy open-ended questions remain answerable. Save your answers to revisit misses."
      />
    );
  }

  if (timed) {
    return (
      <TimedTestMe
        key={viewRevision}
        items={items}
        reviewerId={packId}
        viewRevision={viewRevision}
        attemptStats={attemptStats}
        onAttemptStatsChange={onAttemptStatsChange}
        lockedIn={lockedIn}
        onExit={() => setTimed(false)}
      />
    );
  }

  if (!sittingLoad || sittingLoad.key !== loadKey) {
    return <SittingFallback />;
  }

  return (
    <Suspense fallback={<SittingFallback />}>
      <UntimedSitting
        key={sittingLoad.key}
        load={sittingLoad.promise}
        items={items}
        packId={packId}
        viewRevision={viewRevision}
        attemptStats={attemptStats}
        onAttemptStatsChange={onAttemptStatsChange}
        lockedIn={lockedIn}
        onStartTimed={() => {
          // The sitting reloads from saved progress when the timed run ends.
          setSittingLoad(null);
          setTimed(true);
        }}
      />
    </Suspense>
  );
}

function SittingFallback() {
  return (
    <section className="space-y-4" aria-labelledby="test-me-sitting-title">
      <h2 id="test-me-sitting-title" className="sr-only">
        Test Me
      </h2>
      <p className="text-sm text-muted-foreground">Opening the sitting.</p>
    </section>
  );
}

function sittingView(payload: UntimedSittingPayload, items: TestMeItem[]) {
  const next = sittingProgress(payload.itemIds, payload.answers);
  const complete = next.complete || payload.status === "completed";
  const viewIndex = complete ? Math.max(0, payload.itemIds.length - 1) : next.nextIndex;
  const nextItem = sittingItemsForIds(items, payload.itemIds)[viewIndex];
  return {
    viewIndex,
    finished: complete,
    selected: nextItem ? next.answersByItemId[nextItem.id]?.selectedAnswer ?? "" : "",
  };
}

function UntimedSitting({
  load,
  items,
  packId,
  viewRevision,
  attemptStats,
  onAttemptStatsChange,
  lockedIn,
  onStartTimed,
}: {
  load: Promise<UntimedSittingLoadResult>;
  items: TestMeItem[];
  packId: PackId;
  viewRevision: number;
  attemptStats: AttemptStats[];
  onAttemptStatsChange: (stats: AttemptStats[]) => void;
  lockedIn: string | null;
  onStartTimed: () => void;
}) {
  const loaded = use(load);
  const initialSession = "sessionId" in loaded ? loaded : null;
  const initialView = initialSession
    ? sittingView(initialSession, items)
    : { viewIndex: 0, finished: false, selected: "" };
  const [session, setSession] = useState<UntimedSittingPayload | null>(initialSession);
  const [viewIndex, setViewIndex] = useState(initialView.viewIndex);
  const [selected, setSelected] = useState(initialView.selected);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState("error" in loaded ? loaded.error : null);
  const [finished, setFinished] = useState(initialView.finished);
  // Null when the sitting was already complete on load: its study time is unknown.
  const [openedAt, setOpenedAt] = useState<number | null>(() => (initialView.finished ? null : Date.now()));
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const { save: saveSession, error: sessionSaveError } = useSessionSaver(packId, "practice");
  const shownSaveMessage = saveMessage ?? sessionSaveError;

  const sittingItems = useMemo(
    () => session ? sittingItemsForIds(items, session.itemIds) : items,
    [items, session],
  );
  const progress = useMemo(
    () => sittingProgress(session?.itemIds ?? sittingItems.map((item) => item.id), session?.answers ?? []),
    [session, sittingItems],
  );
  const item = sittingItems[Math.min(viewIndex, Math.max(0, sittingItems.length - 1))];
  const submitted = Boolean(item && progress.answersByItemId[item.id]);
  const complete = Boolean(
    finished
    || (session && (session.complete || progress.complete || session.status === "completed") && viewIndex >= sittingItems.length - 1 && submitted),
  );
  const score = progress.correctCount;
  const missedItems = sittingItems.filter((candidate) => progress.answersByItemId[candidate.id]?.correct === false);
  const retryAvailable = session
    ? canRetryMissed({
      status: complete ? "completed" : session.status,
      viewRevision: session.viewRevision,
      expectedRevision: viewRevision,
      itemIds: session.itemIds,
      answers: session.answers,
    })
    : false;
  const savedMisses = attemptStats.reduce((sum, stats) => sum + stats.misses, 0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isStudyKeyTarget(event) || !item || complete) return;
      if (event.key === "Enter") {
        // The sitting's own buttons already activate on Enter; let that click run once.
        // Choice radios and buttons outside the sitting (tabs, header) do not block Enter.
        if (event.target instanceof Element && event.target.closest("button:not([role='radio'])")?.closest("[data-test-me-sitting]")) return;
        if (!submitted && selected.trim() && !saveBusy) {
          event.preventDefault();
          void submitAnswer();
        } else if (submitted) {
          event.preventDefault();
          nextQuestion();
        }
        return;
      }
      if (submitted) return;
      const choice = item.choices?.[Number(event.key) - 1];
      if (/^[1-4]$/.test(event.key) && choice && !saveBusy) {
        setSelected(choice);
        setSaveMessage(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // submitAnswer and nextQuestion are recreated each render; the listener only needs the latest closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, item, saveBusy, selected, session, submitted, viewIndex]);

  function markFinished() {
    setFinishedAt((current) => current ?? Date.now());
  }

  function applySession(payload: UntimedSittingPayload) {
    const next = sittingView(payload, items);
    const now = Date.now();
    setSession(payload);
    setViewIndex(next.viewIndex);
    setFinished(next.finished);
    setOpenedAt(next.finished ? null : now);
    setFinishedAt(null);
    setSelected(next.selected);
    setSaveMessage(null);
  }

  function mutateSession(intent: "start_again" | "retry_missed") {
    if (saveBusy) return;
    const next = intent === "retry_missed" && session
      ? newSitting(missedItemIds(session.itemIds, session.answers), viewRevision, session.sessionId)
      : newSitting(snapshotTestItemIds(items), viewRevision, null);
    applySession(next);
    saveSession(storedSitting(next));
  }

  async function submitAnswer() {
    if (!session || !item || submitted || saveBusy || inFlight.current) return;
    const answer = selected.trim();
    if (!answer) {
      setSaveMessage("Choose or enter an answer before continuing.");
      return;
    }
    inFlight.current = true;
    setSaveBusy(true);
    setSaveMessage(null);
    try {
      const accepted: PracticeAnswer = {
        itemId: item.id,
        selectedAnswer: answer,
        correct: isCorrect(answer, item.answer),
      };
      const saved = await demoApi.recordAttempts(packId, [{ itemId: accepted.itemId, correct: accepted.correct }]);
      onAttemptStatsChange(mergeAttemptStats(attemptStats, saved));
      const answers = session.answers.some((entry) => entry.itemId === accepted.itemId)
        ? session.answers.map((entry) => entry.itemId === accepted.itemId ? accepted : entry)
        : [...session.answers, accepted];
      const next = sittingPayload({ ...storedSitting(session), answers });
      if (next.complete) markFinished();
      setSession(next);
      saveSession(storedSitting(next));
    } catch (caught) {
      setSaveMessage(caught instanceof Error ? caught.message : "Could not save this answer.");
    } finally {
      inFlight.current = false;
      setSaveBusy(false);
    }
  }

  function nextQuestion() {
    if (!submitted || !session) return;
    const next = sittingProgress(session.itemIds, session.answers);
    if (next.complete || viewIndex >= sittingItems.length - 1) {
      setFinished(true);
      markFinished();
      return;
    }
    setViewIndex(next.nextIndex);
    setSelected("");
    setSaveMessage(null);
  }

  const timedRunButton = (
    <Button type="button" variant="outline" size="sm" onClick={onStartTimed}>
      <Clock weight="bold" />
      Timed run
    </Button>
  );

  if (!session) {
    return (
      <section className="space-y-4" aria-labelledby="test-me-sitting-title">
        <h2 id="test-me-sitting-title" className="sr-only">
          Test Me
        </h2>
        {shownSaveMessage ? (
          <p role="alert" className="text-sm text-destructive">{shownSaveMessage}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Opening the sitting.</p>
        )}
      </section>
    );
  }

  if (complete || !item) {
    const focusSection = recapFocusSection({
      lockedIn,
      missedTexts: missedItems.map(citedText),
    })?.title ?? null;
    const breakdown = sectionBreakdown({
      lockedIn,
      items: sittingItems.flatMap((answered) => {
        const entry = progress.answersByItemId[answered.id];
        return entry ? [{ text: citedText(answered), correct: entry.correct }] : [];
      }),
    });
    return (
      <div className="space-y-4">
        <div className="flex justify-end">{timedRunButton}</div>
        <SittingRecap
          title="Sitting complete"
          score={{ correct: score, total: sittingItems.length }}
          lines={[
            ...(openedAt !== null && finishedAt !== null
              ? [`Studied for ${formatSittingDuration(finishedAt - openedAt)}`]
              : []),
          ]}
          focusSection={focusSection}
        >
          <p className="text-sm text-muted-foreground">
            Attempts and misses are saved.
            {savedMisses > 0
              ? ` ${savedMisses} saved miss${savedMisses === 1 ? "" : "es"} to revisit.`
              : ""}
          </p>

          {breakdown.length > 0 ? (
            <div className="mt-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">By section</h3>
              <ul className="space-y-1.5">
                {breakdown.map((row) => (
                  <li key={row.id} className="flex min-w-0 items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 break-words text-foreground">{row.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {row.correct} of {row.total}
                    </span>
                    <span aria-hidden className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          row.correct / row.total < MASTERY_WEAK_THRESHOLD ? "bg-warning" : "bg-primary",
                        )}
                        style={{ width: `${Math.round((row.correct / row.total) * 100)}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Misses</h3>
            {missedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No misses this sitting.</p>
            ) : (
              <ol className="space-y-2">
                {missedItems.map((missed) => {
                  const yourAnswer = progress.answersByItemId[missed.id]?.selectedAnswer.trim() ?? "";
                  return (
                    <li
                      key={missed.id}
                      className="rounded-lg border border-border/60 bg-muted/40 px-3 py-3 text-sm"
                    >
                      <div className="font-medium text-foreground">
                        <MarkdownBody source={missed.question} />
                      </div>
                      <div className="mt-1 flex items-start gap-1.5 text-muted-foreground">
                        <XCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                        <span className="min-w-0 break-words">
                          Your answer: {yourAnswer ? <MarkdownBody source={yourAnswer} inline /> : "No answer"}
                        </span>
                      </div>
                      <div className="mt-1 flex items-start gap-1.5 text-foreground">
                        <CheckCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                        <span className="min-w-0 break-words">
                          Correct: <MarkdownBody source={missed.answer} inline />
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {retryAvailable ? (
              <Button type="button" variant="outline" onClick={() => mutateSession("retry_missed")} disabled={saveBusy}>
                Retry missed
              </Button>
            ) : null}
            <Button type="button" onClick={() => mutateSession("start_again")} disabled={saveBusy}>
              <ArrowCounterClockwise weight="bold" />
              Start again
            </Button>
          </div>
          {shownSaveMessage ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {shownSaveMessage}
            </p>
          ) : null}
        </SittingRecap>
      </div>
    );
  }

  const questionId = controlId(item.id, "question");
  const correct = item ? progress.answersByItemId[item.id]?.correct : undefined;

  return (
    <section className="space-y-4" aria-labelledby="test-me-sitting-title" data-test-me-sitting>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="test-me-sitting-title" className="sr-only">
            Test Me
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Question {viewIndex + 1} of {sittingItems.length}
          </p>
        </div>
        {timedRunButton}
      </div>

      <SittingItem
        item={item}
        questionId={questionId}
        selected={selected}
        submitted={submitted}
        saveBusy={saveBusy}
        correct={correct}
        onSelect={(value) => {
          setSelected(value);
          setSaveMessage(null);
        }}
        onEnter={() => {
          if (selected.trim()) void submitAnswer();
        }}
      />
      <style>{KEY_HINT_STYLE}</style>
      <p className="study-key-hint text-xs text-muted-foreground">
        {submitted ? "Enter next · F focus" : item.choices ? "1-4 choose · Enter submit · F focus" : "Enter submit · F focus"}
      </p>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {submitted ? (
          <Button type="button" onClick={nextQuestion}>
            <ArrowRight weight="bold" />
            {viewIndex >= sittingItems.length - 1 ? "Finish" : "Next question"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => void submitAnswer()}
            disabled={saveBusy || !selected.trim()}
          >
            {saveBusy ? "Saving" : "Submit answer"}
          </Button>
        )}
      </div>
      {shownSaveMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {shownSaveMessage}
        </p>
      ) : null}
    </section>
  );
}

function SittingItem({
  item,
  questionId,
  selected,
  submitted,
  saveBusy,
  correct,
  onSelect,
  onEnter,
}: {
  item: TestMeItem;
  questionId: string;
  selected: string;
  submitted: boolean;
  saveBusy: boolean;
  correct: boolean | undefined;
  onSelect: (value: string) => void;
  onEnter: () => void;
}) {
  const locked = submitted || saveBusy;

  return (
    <article className="rounded-xl border border-border/80 bg-surface/50 p-4 sm:p-6">
      <div id={questionId} className="mb-4 text-sm font-medium leading-relaxed text-foreground">
        <MarkdownBody source={item.question} />
      </div>

      {item.choices ? (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby={questionId}>
          {item.choices.map((choice, choiceIndex) => {
            const choiceId = controlId(item.id, `choice-${choiceIndex + 1}`);
            const active = selected === choice;
            return (
              <button
                key={choiceId}
                id={choiceId}
                name={controlId(item.id, "choices")}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={locked}
                className={cn(
                  "flex min-h-11 min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                  active
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border/80 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground",
                )}
                onClick={() => onSelect(choice)}
              >
                <span
                  aria-hidden
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums text-foreground"
                >
                  {choiceIndex + 1}
                </span>
                <span className="min-w-0 flex-1 break-words">
                  <MarkdownBody source={choice} inline />
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <label
          htmlFor={controlId(item.id, "answer")}
          className="grid gap-1 text-xs text-muted-foreground"
        >
          <span id={controlId(item.id, "answer-label")}>Open response</span>
          <input
            id={controlId(item.id, "answer")}
            name={controlId(item.id, "answer")}
            value={selected}
            disabled={locked}
            onChange={(event) => onSelect(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              onEnter();
            }}
            className="min-h-11 rounded-lg border border-border/80 bg-background/40 px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            aria-labelledby={`${questionId} ${controlId(item.id, "answer-label")}`}
          />
        </label>
      )}

      {submitted ? (
        <div className="mt-4 space-y-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-3" role="status">
          <p
            className={cn(
              "inline-flex items-center gap-1 text-sm font-medium",
              correct ? "text-success" : "text-destructive",
            )}
          >
            {correct ? <CheckCircle weight="fill" /> : <XCircle weight="fill" />}
            {correct ? "Correct" : "Incorrect. The main point:"}
          </p>
          <div className="text-sm text-muted-foreground">
            <strong className="text-foreground">Answer:</strong>{" "}
            <MarkdownBody source={item.answer} inline />
          </div>
          {item.explanation ? <MarkdownBody source={item.explanation} /> : null}
          <div className="flex flex-wrap gap-2 empty:-mt-2">
            {correct ? null : <OpenCitedPage texts={[item.explanation, item.answer]} />}
          </div>
        </div>
      ) : null}
    </article>
  );
}
