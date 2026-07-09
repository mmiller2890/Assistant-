import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface SttStatus {
  asrReady: boolean;
  streamingReady: boolean;
  isSupported: boolean;
  isInitializing: boolean;
  error: string | null;
}

export function useSttStatus() {
  const [status, setStatus] = useState<SttStatus>({
    asrReady: false,
    streamingReady: false,
    isSupported: false,
    isInitializing: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<{
        asr_ready: boolean;
        streaming_ready: boolean;
        is_supported: boolean;
      }>("stt_get_status");
      setStatus((prev) => ({
        ...prev,
        asrReady: result.asr_ready,
        streamingReady: result.streaming_ready,
        isSupported: result.is_supported,
        error: null,
      }));
      return result.is_supported;
    } catch (e) {
      setStatus((prev) => ({
        ...prev,
        isSupported: false,
        error: String(e),
      }));
      return false;
    }
  }, []);

  const init = useCallback(async () => {
    setStatus((prev) => ({ ...prev, isInitializing: true, error: null }));
    try {
      await invoke("stt_init");
      await refresh();
      setStatus((prev) => ({ ...prev, isInitializing: false }));
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus((prev) => ({
        ...prev,
        isInitializing: false,
        error: message,
        asrReady: false,
      }));
      return false;
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    let unlistenReady: (() => void) | undefined;
    let unlistenStreamingReady: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    const setup = async () => {
      unlistenReady = await listen("stt-ready", () => {
        setStatus((prev) => ({
          ...prev,
          asrReady: true,
          isInitializing: false,
          error: null,
        }));
      });
      unlistenStreamingReady = await listen("stt-streaming-ready", () => {
        setStatus((prev) => ({
          ...prev,
          streamingReady: true,
          isInitializing: false,
          error: null,
        }));
      });
      unlistenError = await listen("stt-error", (event) => {
        setStatus((prev) => ({
          ...prev,
          error: String(event.payload),
          isInitializing: false,
        }));
      });
    };

    setup();

    return () => {
      if (unlistenReady) unlistenReady();
      if (unlistenStreamingReady) unlistenStreamingReady();
      if (unlistenError) unlistenError();
    };
  }, [refresh]);

  return { ...status, refresh, init };
}
