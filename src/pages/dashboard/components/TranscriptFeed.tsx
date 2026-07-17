import { useEffect, useRef } from "react";
import { ChatConversation } from "@/types/completion";
import { Markdown } from "@/components";

const formatClock = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export const TranscriptFeed = ({
  conversation,
  live = false,
  partialTranscription = "",
  isAIProcessing = false,
}: {
  conversation: ChatConversation | null;
  live?: boolean;
  partialTranscription?: string;
  isAIProcessing?: boolean;
}) => {
  // Live conversation state is newest-first; DB reads are chronological.
  // Sort by timestamp so both render oldest → newest.
  const turns = [...(conversation?.messages ?? [])]
    .filter((m) => m.role !== "system")
    .sort((a, b) => a.timestamp - b.timestamp);

  const bottomRef = useRef<HTMLDivElement>(null);
  const lastContent = turns[turns.length - 1]?.content;
  useEffect(() => {
    if (live) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [live, turns.length, lastContent, partialTranscription]);

  if (turns.length === 0 && !partialTranscription) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <span className="font-mono text-xs text-meta">
          {live
            ? "listening · say something"
            : "no session yet · press start capture"}
        </span>
      </div>
    );
  }

  const lastAssistantId = [...turns]
    .reverse()
    .find((m) => m.role === "assistant")?.id;

  return (
    <div className="flex flex-col gap-4 p-4">
      {turns.map((m) => (
        <div key={m.id} className="flex gap-3">
          <span className="min-w-[40px] pt-0.5 font-mono text-[11px] text-meta">
            {formatClock(m.timestamp)}
          </span>
          {m.role === "assistant" ? (
            <div className="min-w-0 flex-1 border-l-2 border-primary pl-3">
              <div className="mb-1 font-mono text-[11px] text-primary">
                answer
              </div>
              <div className="prose prose-sm max-w-none text-sm dark:prose-invert">
                <Markdown>{m.content}</Markdown>
                {live && isAIProcessing && m.id === lastAssistantId && (
                  <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-primary align-middle" />
                )}
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="mb-1 font-mono text-[11px] text-muted-foreground">
                {(m.speaker || "heard").toLowerCase()}
              </div>
              <div className="text-sm leading-relaxed">{m.content}</div>
            </div>
          )}
        </div>
      ))}
      {live && partialTranscription && (
        <div className="flex gap-3">
          <span className="min-w-[40px] pt-0.5 font-mono text-[11px] text-meta">
            …
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-1 font-mono text-[11px] text-meta">hearing</div>
            <div className="text-sm italic leading-relaxed text-muted-foreground">
              {partialTranscription}
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
};
