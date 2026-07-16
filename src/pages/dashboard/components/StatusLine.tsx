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
    <div className="flex items-center justify-between border-b border-border bg-sidebar px-4 py-2.5">
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
