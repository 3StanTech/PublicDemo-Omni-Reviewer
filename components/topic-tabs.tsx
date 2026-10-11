"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

export type TopicListItem = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};

/** The demo's one topic: every sample pack is OpenStax Microbiology. */
export const DEMO_TOPIC: TopicListItem = {
  id: "microbiology",
  name: "Microbiology",
  sortOrder: 0,
  createdAt: "2026-10-11T00:00:00.000Z",
};

type TopicTabsProps = {
  topics: TopicListItem[];
  selectedId: string | null;
  onOptimisticSelect?: (id: string) => void;
};

/** Phone topic strip. The demo's topics are fixed, so there are no create, rename or delete actions. */
export function TopicTabs({
  topics,
  selectedId,
  onOptimisticSelect,
}: TopicTabsProps) {
  function selectTopic(id: string) {
    if (id === selectedId) return;
    onOptimisticSelect?.(id);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Topics
      </p>

      {topics.length === 0 ? (
        <p className="text-sm text-muted-foreground">No topics in this demo.</p>
      ) : (
        <div
          role="tablist"
          aria-label="Topics"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {topics.map((topic) => {
            const selected = topic.id === selectedId;
            return (
              <div
                key={topic.id}
                className={cn(
                  "group flex shrink-0 items-center rounded-xl border transition-colors",
                  selected
                    ? "border-primary/40 bg-primary/12 text-foreground"
                    : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Link
                  href="/"
                  scroll={false}
                  role="tab"
                  aria-selected={selected}
                  className="min-h-11 rounded-xl px-3.5 py-2 text-sm font-medium text-inherit no-underline outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  onClick={() => selectTopic(topic.id)}
                >
                  {topic.name}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
