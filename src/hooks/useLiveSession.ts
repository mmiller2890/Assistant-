import { useCallback, useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import {
  LIVE_SESSION_COMMAND,
  LIVE_SESSION_REQUEST,
  LIVE_SESSION_STATE,
  LiveSessionCommandAction,
  LiveSessionSnapshot,
} from "@/lib/live-session";

/**
 * Dashboard-side mirror of the overlay engine. Renders ONLY what the snapshot
 * says (mirror-only discipline): buttons emit commands and the UI updates when
 * the authoritative state arrives back. `null` snapshot = no live data yet;
 * consumers fall back to their idle (DB) behavior.
 */
export function useLiveSession() {
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot | null>(null);

  useEffect(() => {
    const unlisten = listen<LiveSessionSnapshot>(LIVE_SESSION_STATE, (event) => {
      if (event.payload && typeof event.payload.capturing === "boolean") {
        setSnapshot(event.payload);
      }
    });
    emit(LIVE_SESSION_REQUEST, {}).catch(() => {
      // Overlay webview not ready yet; the next state change will arrive.
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const sendCommand = useCallback((action: LiveSessionCommandAction) => {
    emit(LIVE_SESSION_COMMAND, { action }).catch((e) =>
      console.error("Failed to send live-session command:", e)
    );
  }, []);

  return { snapshot, sendCommand };
}
