import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  Textarea,
} from "@/components";
import { SparklesIcon } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/contexts";
import { fetchAIResponse } from "@/lib";

interface GenerateSystemPromptProps {
  onGenerate: (prompt: string, promptName: string) => void;
}

export const GenerateSystemPrompt = ({
  onGenerate,
}: GenerateSystemPromptProps) => {
  const { allAiProviders, selectedAIProvider } = useApp();
  const [userPrompt, setUserPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const provider = allAiProviders.find(
    (p) => p.id === selectedAIProvider.provider
  );

  const handleGenerate = async () => {
    if (!userPrompt.trim()) {
      setError("Please describe what you want");
      return;
    }

    if (!provider) {
      setError("No AI provider configured. Please select one in Dev Space.");
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);

      const systemPrompt =
        "You are an expert prompt engineer. Given a user's description, generate a well-structured system prompt for an AI assistant. " +
        "Return your response as a JSON object with two fields: \"prompt_name\" (a short, descriptive name, max 5 words) and " +
        "\"system_prompt\" (the full system prompt text). Return ONLY valid JSON, no markdown or extra text.";

      let accumulated = "";
      const generator = fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt,
        userMessage: userPrompt.trim(),
      });

      for await (const chunk of generator) {
        accumulated += chunk;
      }

      let promptName = "Generated Prompt";
      let systemPromptText = "";

      try {
        const cleaned = accumulated
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        const parsed = JSON.parse(cleaned);
        promptName = parsed.prompt_name || promptName;
        systemPromptText = parsed.system_prompt || "";
      } catch {
        systemPromptText = accumulated.trim();
      }

      if (systemPromptText) {
        onGenerate(systemPromptText, promptName);
        setIsOpen(false);
        setUserPrompt("");
      } else {
        setError("No prompt was generated. Try a more detailed description.");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to generate prompt";
      setError(errorMessage);
      console.error("Error generating system prompt:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label="Generate with AI"
          size="sm"
          variant="outline"
          className="w-fit"
        >
          <SparklesIcon className="h-4 w-4" /> Generate with AI
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-96 p-4 border shadow-lg"
      >
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium mb-1">Generate a system prompt</p>
            <p className="text-xs text-muted-foreground">
              Describe the AI behavior you want, and your configured AI provider
              will generate a prompt for you.
            </p>
          </div>

          <Textarea
            placeholder="e.g., I want an AI that helps me with code reviews and focuses on best practices..."
            className="min-h-[100px] resize-none border-1 border-input/50 focus:border-primary/50 transition-colors"
            value={userPrompt}
            onChange={(e) => {
              setUserPrompt(e.target.value);
              setError(null);
            }}
            disabled={isGenerating}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={!userPrompt.trim() || isGenerating || !provider}
          >
            {isGenerating ? (
              <>
                <SparklesIcon className="h-4 w-4 animate-pulse" />
                Generating...
              </>
            ) : (
              <>
                <SparklesIcon className="h-4 w-4" />
                Generate
              </>
            )}
          </Button>
          {!provider && (
            <p className="text-xs text-muted-foreground">
              Configure an AI provider in Dev Space to enable this feature.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};