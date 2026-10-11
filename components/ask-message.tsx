"use client";

import { Question } from "@phosphor-icons/react";

import { SourceViewerProvider } from "@/components/source-modal";
import { MarkdownBody } from "@/components/study-markdown";
import { UnsourcedActionsProvider } from "@/components/unsourced-tag";
import type { CitationSourceRef } from "@/lib/citations";
import { cn } from "@/lib/utils";

export const ASK_REFUSED_LABEL = "Not in the source sections";
export const ASK_REFUSED_COPY =
  "Your lecture does not cover this. I will not answer from outside knowledge here. Check your reference or ask your professor.";

/** One bubble in the Ask thread. The demo keeps the thread in memory only. */
export type ChatMessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  refused: boolean;
  citationSources: CitationSourceRef[] | null;
};

type AskMessageProps = {
  message: ChatMessageDto;
  /** True while the recorded answer is still playing back. */
  streaming?: boolean;
};

const BUBBLE_TEXT = "text-sm leading-relaxed break-words";

export function AskMessage({ message, streaming = false }: AskMessageProps) {
  if (message.role === "user") {
    return (
      <div data-message-id={message.id} className="flex justify-end">
        <p className={cn(BUBBLE_TEXT, "max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 px-3.5 py-2 whitespace-pre-wrap text-foreground")}>
          {message.content}
        </p>
      </div>
    );
  }
  return (
    <div data-message-id={message.id} className="flex justify-start" aria-busy={streaming || undefined}>
      <div className={cn(BUBBLE_TEXT, "max-w-full min-w-0 rounded-2xl rounded-bl-md border border-border bg-card px-3.5 py-2.5 text-card-foreground")}>
        {message.refused ? (
          <span className="mb-1.5 inline-flex items-center gap-1 rounded-[5px] bg-warning/18 px-1.5 py-0.5 text-[0.7rem] font-semibold text-warning">
            <Question weight="bold" className="size-3" aria-hidden />
            {ASK_REFUSED_LABEL}
          </span>
        ) : null}
        {/* Chat answers are not editable documents, so the unsourced tag stays informational. */}
        <UnsourcedActionsProvider value={null}>
          <SourceViewerProvider citationSources={message.citationSources}>
            {message.refused ? <p>{ASK_REFUSED_COPY}</p> : null}
            {message.content.trim() ? <MarkdownBody source={message.content} /> : null}
          </SourceViewerProvider>
        </UnsourcedActionsProvider>
      </div>
    </div>
  );
}
