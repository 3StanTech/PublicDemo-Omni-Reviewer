"use client";

import { Note } from "@phosphor-icons/react/dist/ssr";

import { EmptyState } from "@/components/empty-state";
import { StudyDocument } from "@/components/study-document";
import { MarkdownBody } from "@/components/study-markdown";
import type { SerializedView } from "@/lib/serialize-view";

type SummaryViewProps = {
  userId?: string;
  content: string | null;
  view?: SerializedView | null;
  reviewerId?: string;
};

export function SummaryView({ userId, content, view, reviewerId }: SummaryViewProps) {
  if (!content || !content.trim()) {
    return (
      <EmptyState
        icon={<Note weight="duotone" className="size-5" />}
        title="Summary is empty"
        description="Generate the pack to write a detailed summary of Locked In for last-minute review."
      />
    );
  }

  if (view && reviewerId) {
    return <StudyDocument key={view.id} userId={userId} reviewerId={reviewerId} kind="summary" view={view} />;
  }
  return (
    <article className="reading-surface rounded-xl px-5 py-6 shadow-[0_8px_30px_oklch(0_0_0/20%)] sm:px-8 sm:py-8">
      <MarkdownBody source={content} />
    </article>
  );
}
