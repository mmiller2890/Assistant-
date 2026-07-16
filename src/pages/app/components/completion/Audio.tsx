import { InfoIcon, MicIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, Button } from "@/components";
import { AutoSpeechVAD } from "./AutoSpeechVad";
import { UseCompletionReturn } from "@/types";
import { useApp } from "@/contexts";

export const Audio = ({
  micOpen,
  setMicOpen,
  enableVAD,
  setEnableVAD,
  submit,
  setState,
}: UseCompletionReturn) => {
  const { selectedSttProvider, localApiEnabled, selectedAudioDevices } =
    useApp();

  const speechProviderStatus = selectedSttProvider.provider;
  const configured = Boolean(localApiEnabled || speechProviderStatus);

  return (
    // The popover exists only to explain missing provider config. When
    // configured, keep it shut: letting the trigger set micOpen expanded the
    // window 600px tall with the content `hidden` — an invisible pane that ate
    // clicks and hijacked the cursor (window is transparent + global cursor
    // override). Mic click must do exactly one thing: toggle voice detection.
    <Popover
      open={micOpen && !configured}
      onOpenChange={(open) => {
        if (!configured) {
          setMicOpen(open);
        }
      }}
    >
      <PopoverTrigger asChild>
        {(localApiEnabled || speechProviderStatus) && enableVAD ? (
          <AutoSpeechVAD
            key={selectedAudioDevices.input.id}
            submit={submit}
            setState={setState}
            setEnableVAD={setEnableVAD}
            microphoneDeviceId={selectedAudioDevices.input.id}
          />
        ) : (
          <Button
            size="icon"
            onClick={() => {
              setEnableVAD(!enableVAD);
            }}
            className="cursor-pointer"
            title="Toggle voice input"
          >
            <MicIcon className="h-4 w-4" />
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" side="bottom" className="w-80 p-3" sideOffset={8}>
        <div className="text-sm select-none">
          <div className="font-medium text-warn mb-1">
            Speech Provider Configuration Required
          </div>
          <p className="text-muted-foreground">
            {!speechProviderStatus ? (
              <>
                <div className="mt-2 flex flex-row gap-1 items-center text-warn">
                  <InfoIcon size={16} />
                  {selectedSttProvider.provider ? null : (
                    <p>PROVIDER IS MISSING</p>
                  )}
                </div>

                <span className="block mt-2">
                  Please go to settings and configure your speech provider to
                  enable voice input.
                </span>
              </>
            ) : null}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
};
