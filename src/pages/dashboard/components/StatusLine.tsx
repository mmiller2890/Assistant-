import { useApp } from "@/contexts";
import { invoke } from "@tauri-apps/api/core";
import { PictureInPicture2 } from "lucide-react";

export const StatusLine = () => {
  const { selectedAIProvider, selectedSttProvider } = useApp();
  const ai = selectedAIProvider.provider || "no model";
  const stt = selectedSttProvider.provider || "no stt";

  const popOut = () => {
    invoke("show_overlay").catch((e) =>
      console.error("Failed to show overlay:", e)
    );
  };

  return (
    // The layout's invisible drag strip (z-50) covers this band; sit above it
    // and act as the drag region ourselves. Tauri only starts a drag when the
    // attributed element is the click target, so the buttons stay clickable.
    <div
      data-tauri-drag-region
      className="relative z-[60] flex items-center justify-between border-b border-border bg-sidebar px-4 py-2.5"
    >
      <div className="flex items-center gap-2">
        <div className="flex size-5 items-center justify-center rounded border border-primary">
          <span className="size-1.5 rounded-sm bg-primary" />
        </div>
        <span className="text-sm font-medium">Assistant</span>
      </div>
      <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
        {/* Live-state seam: sub-project ④ replaces `idle` with `listening · MM:SS`. */}
        <span className="text-meta">idle</span>
        <span className="text-meta">|</span>
        <span>{ai}</span>
        <span className="text-meta">·</span>
        <span>{stt}</span>
        <button
          onClick={popOut}
          title="Pop out the overlay — on top, invisible to screen share"
          className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-input hover:text-primary"
        >
          <PictureInPicture2 className="size-3" />
          pop out
        </button>
      </div>
    </div>
  );
};
