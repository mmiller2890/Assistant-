import { useEffect, useState, useCallback } from "react";
import { getAllConversations } from "@/lib";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ChatConversation } from "@/types/completion";
import { useLiveSession } from "@/hooks/useLiveSession";
import { StatusLine } from "./components/StatusLine";
import { CaptureControls } from "./components/CaptureControls";
import { TranscriptFeed } from "./components/TranscriptFeed";
import { SessionMetrics } from "./components/SessionMetrics";
import { RecentSessions } from "./components/RecentSessions";
import { SessionSummaryCard } from "./components/SessionSummaryCard";
import { ProviderStatus } from "./components/ProviderStatus";

const Dashboard = () => {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const { snapshot, sendCommand } = useLiveSession();

  const load = useCallback(async () => {
    try {
      const all = await getAllConversations();
      setConversations(all);
    } catch (error) {
      console.error("Failed to load conversations for dashboard:", error);
      setConversations([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // DB refresh on focus stays as the idle fallback (deep history and sessions
  // recorded before this window existed); live sessions arrive via events.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const win = getCurrentWebviewWindow();
        unlisten = await win.onFocusChanged(({ payload: focused }) => {
          if (focused) load();
        });
      } catch (error) {
        console.error("Failed to set up dashboard focus listener:", error);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [load]);

  // Mirror-only: prefer the live conversation whenever the engine has one.
  const liveConversation =
    snapshot && snapshot.conversation.messages.length > 0
      ? snapshot.conversation
      : null;
  const isLive = Boolean(snapshot?.capturing || liveConversation);
  const displayed = liveConversation ?? conversations[0] ?? null;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <StatusLine snapshot={snapshot} sendCommand={sendCommand} />
      {snapshot?.capturing && (
        <CaptureControls snapshot={snapshot} sendCommand={sendCommand} />
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r border-border">
          <TranscriptFeed
            conversation={displayed}
            live={isLive}
            partialTranscription={snapshot?.partialTranscription ?? ""}
            isAIProcessing={snapshot?.isAIProcessing ?? false}
          />
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          <SessionMetrics
            conversation={displayed}
            liveStartedAt={
              snapshot?.capturing ? snapshot.sessionStartedAt : null
            }
          />
          {snapshot && (
            <SessionSummaryCard snapshot={snapshot} sendCommand={sendCommand} />
          )}
          <RecentSessions conversations={conversations} />
          <ProviderStatus />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
