import { EmptyState } from "@/components/empty-state";
import { StudyDocument } from "@/components/study-document";
import { MarkdownBody } from "@/components/study-markdown";
import { BookOpenText } from "@phosphor-icons/react/dist/ssr";
import type { SerializedView } from "@/lib/serialize-view";

export { MarkdownBody } from "@/components/study-markdown";

type LockedInViewProps = {
  userId?: string;
  content: string | null;
  view?: SerializedView | null;
  reviewerId?: string;
};

export function LockedInView({ userId, content, view, reviewerId }: LockedInViewProps) {
  if (!content || !content.trim()) {
    return (
      <EmptyState
        icon={<BookOpenText weight="duotone" className="size-5" />}
        title="Locked In is empty"
        description="Generate the pack to write the full study document from your Ready sources. This mode is the source of truth for the other three."
      />
    );
  }

  if (view && reviewerId) {
    return <StudyDocument key={view.id} userId={userId} reviewerId={reviewerId} kind="locked_in" view={view} />;
  }

  return (
    <div>
      <article className="reading-surface rounded-xl px-5 py-6 shadow-[0_8px_30px_oklch(0_0_0/20%)] sm:px-8 sm:py-8">
        <MarkdownBody source={content} />
      </article>
    </div>
  );
}
