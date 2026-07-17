import { LoaderCircleIcon, MicIcon, MicOffIcon } from "lucide-react";
import { Button } from "@/components";
import { UseCompletionReturn } from "@/types";
import { useMicDictation } from "@/hooks/useMicDictation";

export const MicDictationButton = ({
  submit,
  setState,
}: Pick<UseCompletionReturn, "submit" | "setState">) => {
  const { status, error, start, stop, reset } = useMicDictation({
    submit,
    setState,
  });

  const title = error
    ? `Voice input failed: ${error}. Click to reset.`
    : status === "starting"
      ? "Starting microphone…"
      : status === "listening"
        ? "Stop voice input"
        : status === "transcribing"
          ? "Transcribing…"
          : "Start voice input";

  return (
    <Button
      size="icon"
      title={title}
      className="cursor-pointer"
      onClick={() => {
        if (error) {
          reset();
        } else if (status === "idle") {
          start();
        } else if (status === "listening" || status === "transcribing") {
          stop();
        }
      }}
    >
      {error ? (
        <MicIcon className="h-4 w-4 text-destructive" />
      ) : status === "starting" ? (
        <LoaderCircleIcon className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : status === "transcribing" ? (
        <LoaderCircleIcon className="h-4 w-4 animate-spin text-primary" />
      ) : status === "listening" ? (
        <MicOffIcon className="h-4 w-4 animate-pulse text-primary" />
      ) : (
        <MicIcon className="h-4 w-4" />
      )}
    </Button>
  );
};
