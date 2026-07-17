import { useEffect, useState } from "react";
import { useApp } from "@/contexts";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PictureInPicture2, CircleStopIcon, AudioLinesIcon } from "lucide-react";
import {
  TOGGLE_WINDOW_VISIBILITY,
  LiveSessionCommandAction,
  LiveSessionSnapshot,
  deriveSessionStatus,
} from "@/lib/live-session";

const formatElapsed = (startedAt: number, now: number): string => {
  const totalSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const StatusLine = ({
  snapshot,
  sendCommand,
}: {
  snapshot: LiveSessionSnapshot | null;
  sendCommand: (action: LiveSessionCommandAction) => void;
}) => {
  const { selectedAIProvider, selectedSttProvider } = useApp();
  const ai = selectedAIProvider.provider || "no model";
  const stt = selectedSttProvider.provider || "no stt";

  const status = deriveSessionStatus(snapshot);
  const capturing = snapshot?.capturing ?? false;

  // Local 1s tick for the session timer — no per-second events on the bus.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!capturing) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [capturing]);

  const [overlayVisible, setOverlayVisible] = useState(false);

  useEffect(() => {
    invoke<boolean>("is_overlay_visible")
      .then(setOverlayVisible)
      .catch((e) => console.error("Failed to query overlay visibility:", e));

    // Payload semantics per live-session.ts: `true` = overlay is now hidden.
    const unlistenPromise = listen<boolean>(
      TOGGLE_WINDOW_VISIBILITY,
      (event) => {
        if (typeof event.payload === "boolean") {
          setOverlayVisible(!event.payload);
        }
      }
    );
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const togglePopOut = () => {
    invoke<boolean>("toggle_overlay")
      .then(setOverlayVisible)
      .catch((e) => console.error("Failed to toggle overlay:", e));
  };

  return (
    // The layout's invisible drag strip (z-50) covers this band; sit above it
    // and act as the drag region ourselves. Tauri only starts a drag when the
    // attributed element is the click target, so the buttons stay clickable.
    <div
      data-tauri-drag-region
      className="relative z-[60] flex items-center justify-between border-b border-border bg-sidebar px-4 py-2.5"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-5 items-center justify-center rounded border border-primary">
          <span className="size-1.5 rounded-sm bg-primary" />
        </div>
        <span className="text-sm font-medium">Assistant</span>
        <button
          onClick={() =>
            sendCommand(capturing ? "stop-capture" : "start-capture")
          }
          title={
            capturing
              ? "Stop the capture session"
              : "Start capturing system audio"
          }
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
            capturing
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              : "border-border bg-secondary text-muted-foreground hover:border-input hover:text-primary"
          }`}
        >
          {capturing ? (
            <CircleStopIcon className="size-3" />
          ) : (
            <AudioLinesIcon className="size-3" />
          )}
          {capturing ? "stop" : "start capture"}
        </button>
      </div>
      <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
        <span className={`inline-flex items-center gap-1.5 ${status.cls}`}>
          <span
            className={`size-1.5 rounded-full ${status.dot} ${
              status.word !== "idle" ? "animate-pulse" : ""
            }`}
          />
          {status.word}
          {capturing && snapshot?.sessionStartedAt ? (
            <span className="text-muted-foreground">
              · {formatElapsed(snapshot.sessionStartedAt, now)}
            </span>
          ) : null}
        </span>
        <span className="text-meta">|</span>
        <span>{ai}</span>
        <span className="text-meta">·</span>
        <span>{stt}</span>
        <button
          onClick={togglePopOut}
          title={
            overlayVisible
              ? "Pop the overlay back in"
              : "Pop out the overlay — on top, invisible to screen share"
          }
          className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-input hover:text-primary"
        >
          <PictureInPicture2 className="size-3" />
          {overlayVisible ? "pop in" : "pop out"}
        </button>
      </div>
    </div>
  );
};
