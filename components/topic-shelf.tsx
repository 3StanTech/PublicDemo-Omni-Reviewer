"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { CalendarBlank, SidebarSimple } from "@phosphor-icons/react";
import { readLocalStorage, writeLocalStorage } from "@/lib/safe-storage";
import { useIsClient } from "@/lib/use-is-client";

import type { TopicListItem } from "@/components/topic-tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const TOPIC_SHELF_ID = "topic-shelf";
export const TOPIC_SHELF_STORAGE_KEY = "omni-topic-shelf";

type TopicNavValue = {
  optimisticId: string | null;
  setOptimisticId: (id: string | null) => void;
  shelfOpen: boolean;
  setShelfOpen: (open: boolean) => void;
};

const TopicNavContext = createContext<TopicNavValue | null>(null);
const TOPIC_SHELF_TOGGLE_ID = "topic-shelf-toggle";
const shelfListeners = new Set<() => void>();
// Below 768px the shelf is a drawer that starts closed on every load; the
// stored preference belongs to the desktop shelf only.
let drawerOpen = false;

/** The shelf total sums both kinds of due card. */
const DUE_TODAY_DESCRIPTION = "Cards to review plus new cards for today";
// The shelf renders once per page.
const DUE_TODAY_DESCRIPTION_ID = "topic-shelf-due-today-description";

function isDesktopShelf(): boolean {
  return window.matchMedia("(min-width: 768px)").matches;
}

function readShelfOpen(): boolean {
  if (!isDesktopShelf()) return drawerOpen;
  const stored = readLocalStorage(TOPIC_SHELF_STORAGE_KEY);
  if (stored === "closed") return false;
  return true;
}

function subscribeShelf(listener: () => void) {
  shelfListeners.add(listener);
  return () => shelfListeners.delete(listener);
}

function emitShelf() {
  for (const listener of shelfListeners) listener();
}

function focusShelfToggle() {
  document.getElementById(TOPIC_SHELF_TOGGLE_ID)?.focus();
}

export function TopicNavProvider({ children }: { children: ReactNode }) {
  const [optimisticId, setOptimisticId] = useState<string | null>(null);
  const shelfOpen = useSyncExternalStore(
    subscribeShelf,
    readShelfOpen,
    () => true,
  );
  const setShelfOpen = useCallback((open: boolean) => {
    if (isDesktopShelf()) {
      writeLocalStorage(TOPIC_SHELF_STORAGE_KEY, open ? "open" : "closed");
    } else {
      drawerOpen = open;
    }
    emitShelf();
  }, []);

  const value = useMemo(
    () => ({ optimisticId, setOptimisticId, shelfOpen, setShelfOpen }),
    [optimisticId, shelfOpen, setShelfOpen],
  );
  return (
    <TopicNavContext.Provider value={value}>{children}</TopicNavContext.Provider>
  );
}

export function TopicShelfToggle() {
  const topicNav = useTopicNav();
  if (!topicNav) return null;
  return (
    <Button
      id={TOPIC_SHELF_TOGGLE_ID}
      type="button"
      variant="ghost"
      size="icon-lg"
      className="min-h-11 min-w-11"
      aria-label="Topics"
      aria-expanded={topicNav.shelfOpen}
      aria-controls={TOPIC_SHELF_ID}
      onClick={() => topicNav.setShelfOpen(!topicNav.shelfOpen)}
    >
      <SidebarSimple weight="bold" />
    </Button>
  );
}

export function useTopicNav(): TopicNavValue | null {
  return useContext(TopicNavContext);
}

type TopicShelfProps = {
  topics: TopicListItem[];
  selectedId: string | null;
  dueByTopic?: Record<string, number>;
  /** null while progress loads. */
  dueTodayTotal: number | null;
};

/** The topic shelf. The demo's topics are fixed, so there are no create, rename or delete actions. */
export function TopicShelf({
  topics,
  selectedId,
  dueByTopic,
  dueTodayTotal,
}: TopicShelfProps) {
  const topicNav = useTopicNav();
  // The server snapshot reads the shelf as open (desktop); until hydration the
  // phone drawer and its backdrop stay out of the render.
  const isClient = useIsClient();
  const shelfOpen = topicNav?.shelfOpen ?? true;

  function selectTopic(id: string) {
    if (id === selectedId) return;
    topicNav?.setOptimisticId(id);
  }

  useEffect(() => {
    if (!shelfOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!window.matchMedia("(max-width: 767px)").matches) return;
      topicNav?.setShelfOpen(false);
      focusShelfToggle();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shelfOpen, topicNav]);

  if (!shelfOpen) return null;

  return (
    <>
    {isClient ? (
    <button
      type="button"
      className="fixed inset-0 z-40 bg-black/40 md:hidden"
      aria-label="Close topics"
      onClick={() => {
        topicNav?.setShelfOpen(false);
        focusShelfToggle();
      }}
    />
    ) : null}
    <aside
      id={TOPIC_SHELF_ID}
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex h-svh w-[min(228px,86vw)] shrink-0 flex-col overflow-y-auto border-r border-border bg-chrome md:sticky md:z-auto md:w-[228px]",
        !isClient && "max-md:hidden",
      )}
      aria-label="Topic shelf"
    >
      <div className="flex flex-col gap-1 p-3">
        <div
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground"
          title={DUE_TODAY_DESCRIPTION}
        >
          <CalendarBlank className="size-4 shrink-0" />
          <span>Due today</span>
          <span className="ml-auto tabular-nums text-foreground" aria-describedby={DUE_TODAY_DESCRIPTION_ID}>
            {dueTodayTotal === null ? (
              <>
                <span aria-hidden>–</span>
                <span className="sr-only">loading</span>
              </>
            ) : (
              dueTodayTotal
            )}
          </span>
          <span id={DUE_TODAY_DESCRIPTION_ID} hidden>
            {DUE_TODAY_DESCRIPTION}
          </span>
        </div>

        <p className="mt-3 mb-1 px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Topics
        </p>

        {topics.length === 0 ? (
          <p className="px-2.5 text-sm text-muted-foreground">
            No topics in this demo.
          </p>
        ) : (
          <nav aria-label="Topics" className="flex flex-col gap-0.5">
            {topics.map((topic) => {
              const selected = topic.id === selectedId;
              const due = dueByTopic?.[topic.id] ?? 0;
              return (
                <div
                  key={topic.id}
                  className={cn(
                    "group flex items-center rounded-lg transition-colors duration-150",
                    selected
                      ? "bg-primary/12 text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Link
                    href="/"
                    scroll={false}
                    aria-current={selected ? "page" : undefined}
                    className="min-h-11 min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-sm font-medium text-inherit no-underline outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    onClick={() => selectTopic(topic.id)}
                  >
                    {topic.name}
                  </Link>
                  {due > 0 ? (
                    <span
                      className="ml-auto pr-2.5 pl-1 tabular-nums text-xs text-muted-foreground"
                      aria-label={`${due} due today`}
                    >
                      {due}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </nav>
        )}
      </div>
    </aside>
    </>
  );
}
