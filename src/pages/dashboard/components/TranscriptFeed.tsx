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
}: {
  conversation: ChatConversation | null;
}) => {
  const turns = conversation?.messages.filter((m) => m.role !== "system") ?? [];

  if (turns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <span className="font-mono text-xs text-meta">
          no session yet · start capture from the overlay
        </span>
      </div>
    );
  }

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
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="mb-1 font-mono text-[11px] text-muted-foreground">
                heard
              </div>
              <div className="text-sm leading-relaxed">{m.content}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
