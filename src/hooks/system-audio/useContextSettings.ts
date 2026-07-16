import { useState, useEffect, useRef, useCallback } from "react";
import { safeLocalStorage } from "@/lib";
import { DEFAULT_SYSTEM_PROMPT, STORAGE_KEYS } from "@/config";

export function useContextSettings(systemPrompt: string) {
  const [useSystemPrompt, setUseSystemPrompt] = useState<boolean>(true);
  const [contextContent, setContextContent] = useState<string>("");

  useEffect(() => {
    const savedContext = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT
    );
    if (savedContext) {
      try {
        const parsed = JSON.parse(savedContext);
        setUseSystemPrompt(parsed.useSystemPrompt ?? true);
        setContextContent(parsed.contextContent ?? "");
      } catch (error) {
        console.error("Failed to load system audio context:", error);
      }
    }
  }, []);

  const saveContextSettings = useCallback(
    (usePrompt: boolean, content: string) => {
      try {
        const contextSettings = {
          useSystemPrompt: usePrompt,
          contextContent: content,
        };
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
          JSON.stringify(contextSettings)
        );
      } catch (error) {
        console.error("Failed to save context settings:", error);
      }
    },
    []
  );

  const updateUseSystemPrompt = useCallback(
    (value: boolean) => {
      setUseSystemPrompt(value);
      saveContextSettings(value, contextContent);
    },
    [contextContent, saveContextSettings]
  );

  const updateContextContent = useCallback(
    (content: string) => {
      setContextContent(content);
      saveContextSettings(useSystemPrompt, content);
    },
    [useSystemPrompt, saveContextSettings]
  );

  // Ref-backed so the returned getter is stable ([] deps) yet always reads
  // current values — matches the ref pattern the engine's listeners rely on.
  const useSystemPromptRef = useRef(useSystemPrompt);
  const systemPromptRef = useRef(systemPrompt);
  const contextContentRef = useRef(contextContent);
  useSystemPromptRef.current = useSystemPrompt;
  systemPromptRef.current = systemPrompt;
  contextContentRef.current = contextContent;

  const getEffectiveSystemPrompt = useCallback(() => {
    return useSystemPromptRef.current
      ? systemPromptRef.current || DEFAULT_SYSTEM_PROMPT
      : contextContentRef.current || DEFAULT_SYSTEM_PROMPT;
  }, []);

  // Raw, NON-persisting reset used by startNewConversation — mirrors the
  // original hook, which reset the toggle without writing to localStorage.
  const resetUseSystemPrompt = useCallback(() => {
    setUseSystemPrompt(true);
  }, []);

  return {
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    getEffectiveSystemPrompt,
    resetUseSystemPrompt,
  };
}
