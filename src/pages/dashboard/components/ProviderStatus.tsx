import { useApp } from "@/contexts";

export const ProviderStatus = () => {
  const { selectedAIProvider, selectedSttProvider } = useApp();

  const aiModel = selectedAIProvider.variables?.MODEL || "";
  const aiReady = !!selectedAIProvider.provider && !!aiModel;
  const sttReady = !!selectedSttProvider.provider;

  const Row = ({
    label,
    value,
    ready,
  }: {
    label: string;
    value: string;
    ready: boolean;
  }) => (
    <div className="flex items-center justify-between font-mono text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={ready ? "text-ok" : "text-meta"}>
        <span
          className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
            ready ? "bg-ok" : "bg-meta"
          }`}
        />
        {value}
      </span>
    </div>
  );

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="font-mono text-[11px] text-meta">status</div>
      <Row
        label="on-device stt"
        value={selectedSttProvider.provider || "none"}
        ready={sttReady}
      />
      <Row label="model" value={aiReady ? aiModel : "not set"} ready={aiReady} />
    </div>
  );
};
