import { useEffect, useState, useCallback } from "react";
import { getAllConversations } from "@/lib";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ChatConversation } from "@/types/completion";
import { StatusLine } from "./components/StatusLine";
import { TranscriptFeed } from "./components/TranscriptFeed";
import { SessionMetrics } from "./components/SessionMetrics";
import { RecentSessions } from "./components/RecentSessions";
import { ProviderStatus } from "./components/ProviderStatus";

const Dashboard = () => {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);

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

  // The DB is the shared state bridge until sub-project ④ pushes live events:
  // reload when the dashboard window regains focus (e.g. after a session ends
  // in the overlay).
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

  const current = conversations[0] ?? null;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <StatusLine />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r border-border">
          <TranscriptFeed conversation={current} />
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          <SessionMetrics conversation={current} />
          <RecentSessions conversations={conversations} />
          <ProviderStatus />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
