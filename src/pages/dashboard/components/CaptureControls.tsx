import {
  CirclePlayIcon,
  CircleStopIcon,
  CircleSlashIcon,
  CornerDownLeftIcon,
  PlusIcon,
} from "lucide-react";
import {
  LiveSessionCommandAction,
  LiveSessionSnapshot,
} from "@/lib/live-session";

const ControlButton = ({
  label,
  icon,
  onClick,
  disabled,
  accent,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 font-mono text-[11px] transition-colors disabled:opacity-40 disabled:pointer-events-none hover:border-input ${
      accent
        ? "text-primary hover:text-primary"
        : "text-muted-foreground hover:text-foreground"
    }`}
  >
    {icon}
    {label}
  </button>
);

/**
 * Dashboard session controls — the pop-out's full control set, so sessions run
 * from the dashboard alone. Mirror-only: every state here comes from the
 * snapshot; clicks just emit commands.
 */
export const CaptureControls = ({
  snapshot,
  sendCommand,
}: {
  snapshot: LiveSessionSnapshot;
  sendCommand: (action: LiveSessionCommandAction) => void;
}) => {
  const busy = snapshot.isProcessing || snapshot.isAIProcessing;

  return (
    <div className="flex items-center gap-2 border-b border-border bg-sidebar/50 px-4 py-2">
      <span className="font-mono text-[10px] text-meta">session</span>
      {snapshot.isContinuousMode &&
        (snapshot.isRecordingInContinuousMode ? (
          <>
            <ControlButton
              label="stop & send"
              icon={<CornerDownLeftIcon className="size-3" />}
              onClick={() => sendCommand("stop-and-send")}
              disabled={busy}
              accent
            />
            <ControlButton
              label="ignore"
              icon={<CircleSlashIcon className="size-3" />}
              onClick={() => sendCommand("ignore-recording")}
              disabled={busy}
            />
          </>
        ) : (
          <ControlButton
            label="record"
            icon={<CirclePlayIcon className="size-3" />}
            onClick={() => sendCommand("start-recording")}
            disabled={busy}
            accent
          />
        ))}
      <ControlButton
        label="answer last"
        icon={<CornerDownLeftIcon className="size-3" />}
        onClick={() => sendCommand("answer-last")}
        disabled={busy}
      />
      <ControlButton
        label="new session"
        icon={<PlusIcon className="size-3" />}
        onClick={() => sendCommand("new-conversation")}
      />
      <span className="ml-auto font-mono text-[10px] text-meta">
        ⌘⇧M capture · ⌘⇧⏎ answer last
      </span>
      {snapshot.noAudioDetected && (
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-warn">
          <CircleStopIcon className="size-3" />
          no audio detected
        </span>
      )}
    </div>
  );
};
