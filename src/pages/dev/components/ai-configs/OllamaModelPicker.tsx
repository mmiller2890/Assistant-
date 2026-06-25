import { Selection } from "@/components";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components";

interface OllamaModel {
  name: string;
}

interface OllamaTagsResponse {
  models?: OllamaModel[];
}

export const OllamaModelPicker = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (model: string) => void;
}) => {
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchModels = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:11434/api/tags", {
        method: "GET",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: OllamaTagsResponse = await res.json();
      const names = (data.models || []).map((m) => m.name);
      setModels(names);
      // If the user has no model selected yet, auto-select the first available.
      if (!value && names.length > 0) {
        onChange(names[0]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setModels([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive">
          Couldn't reach Ollama at <code>localhost:11434</code>. Make sure
          <code> ollama serve</code> is running, then refresh.
        </p>
        <p className="text-[10px] text-muted-foreground">Error: {error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchModels}
          disabled={isLoading}
          className="h-9"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Selection
        selected={value}
        onChange={(m: string) => onChange(m)}
        options={models.map((m) => ({ label: m, value: m }))}
        placeholder="Select an installed Ollama model"
        isLoading={isLoading}
        disabled={models.length === 0 && !isLoading}
      />
      {models.length === 0 && !isLoading && !error && (
        <p className="text-xs text-muted-foreground">
          No models installed. Run <code>ollama pull &lt;model&gt;</code> to add one.
        </p>
      )}
    </div>
  );
};