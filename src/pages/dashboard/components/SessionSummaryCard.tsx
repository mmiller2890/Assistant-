import { Loader2, XIcon } from "lucide-react";
import { Markdown } from "@/components";
import {
  LiveSessionCommandAction,
  LiveSessionSnapshot,
} from "@/lib/live-session";

/** Post-session summary streamed from the engine; dismissable. */
export const SessionSummaryCard = ({
  snapshot,
  sendCommand,
}: {
  snapshot: LiveSessionSnapshot;
  sendCommand: (action: LiveSessionCommandAction) => void;
}) => {
  if (!snapshot.sessionSummary && !snapshot.isSummarizing) {
    return null;
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-meta">summary</span>
        <div className="flex items-center gap-2">
          {snapshot.isSummarizing && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              summarizing
            </span>
          )}
          <button
            onClick={() => sendCommand("dismiss-summary")}
            title="Dismiss summary"
            className="rounded p-0.5 text-meta transition-colors hover:bg-secondary hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      </div>
      {snapshot.sessionSummary && (
        <div className="prose prose-sm max-w-none text-[13px] leading-relaxed text-muted-foreground dark:prose-invert">
          <Markdown>{snapshot.sessionSummary}</Markdown>
        </div>
      )}
    </div>
  );
};
