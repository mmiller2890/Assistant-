import { AlertCircleIcon, LoaderIcon } from "lucide-react";

type Props = {
  setupRequired: boolean;
  error: string;
  isProcessing: boolean;
  isAIProcessing: boolean;
  capturing: boolean;
};

export const StatusIndicator = ({
  setupRequired,
  error,
  isProcessing,
  isAIProcessing,
  capturing,
}: Props) => {
  // Don't show anything if not capturing and no error
  if (!capturing && !error && !isProcessing && !isAIProcessing) {
    return null;
  }

  return (
    <div className="flex flex-1 items-center gap-2 px-3 py-2 justify-end">
      {/* Priority: Error > AI Processing > Transcribing > Listening */}
      {error && !setupRequired ? (
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircleIcon className="w-4 h-4" />
          <span className="font-mono text-xs">{error}</span>
        </div>
      ) : isAIProcessing ? (
        <div className="flex items-center gap-2 text-primary">
          <LoaderIcon className="w-3.5 h-3.5 animate-spin" />
          <span className="font-mono text-xs">answering</span>
        </div>
      ) : isProcessing ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <LoaderIcon className="w-3.5 h-3.5 animate-spin" />
          <span className="font-mono text-xs">transcribing</span>
        </div>
      ) : capturing ? (
        <div className="flex items-center gap-2 text-primary">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="font-mono text-xs">listening</span>
        </div>
      ) : null}
    </div>
  );
};
