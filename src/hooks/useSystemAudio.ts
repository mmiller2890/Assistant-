import { useEffect, useState, useCallback, useRef } from "react";
import { useWindowResize, useGlobalShortcuts } from ".";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/contexts";
import { fetchSTT, fetchAIResponse } from "@/lib/functions";
import { useSttStatus } from "./useSttStatus";
import { DEFAULT_SYSTEM_PROMPT, STORAGE_KEYS } from "@/config";
import {
  safeLocalStorage,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
  isMacOS,
  isWindows,
} from "@/lib";
import { deepVariableReplacer } from "@/lib/functions/common.function";
import curl2Json from "@bany/curl-to-json";
import { TYPE_PROVIDER } from "@/types";
import { Message } from "@/types/completion";
import { useVadConfig, type VadConfig } from "./system-audio/useVadConfig";
import { useQuickActions } from "./system-audio/useQuickActions";

export type { VadConfig };

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

export function useSystemAudio() {
  const { resizeWindow } = useWindowResize();
  const globalShortcuts = useGlobalShortcuts();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [lastTranscription, setLastTranscription] = useState<string>("");
  const [lastAIResponse, setLastAIResponse] = useState<string>("");
  const [partialTranscription, setPartialTranscription] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const {
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
  } = useQuickActions();
  const { vadConfig, updateVadConfiguration } = useVadConfig();
  const [recordingProgress, setRecordingProgress] = useState<number>(0);
  const [isContinuousMode, setIsContinuousMode] = useState<boolean>(false);
  const [isRecordingInContinuousMode, setIsRecordingInContinuousMode] =
    useState<boolean>(false);

  const [conversation, setConversation] = useState<ChatConversation>({
    id: "",
    title: "",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  });

  const [useSystemPrompt, setUseSystemPrompt] = useState<boolean>(true);
  const [contextContent, setContextContent] = useState<string>("");

  const {
    selectedSttProvider,
    allSttProviders,
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    selectedAudioDevices,
    onSetSelectedSttProvider,
  } = useApp();
  const { isSupported, asrReady, isInitializing: isSttInitializing, init: initStt } =
    useSttStatus();
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamingFinalizedRef = useRef<boolean>(false);
  const batchProcessedForCurrentUtteranceRef = useRef<boolean>(false);
  const capturedSampleRateRef = useRef<number>(16000);

  function buildStreamingUrl(
    provider: TYPE_PROVIDER,
    selected: { provider: string; variables: Record<string, string> }
  ): string {
    if (provider.streamingUrl) {
      return deepVariableReplacer(provider.streamingUrl, selected.variables);
    }
    const curlJson = curl2Json(provider.curl);
    const baseUrl = (curlJson.url as string) || "";
    const replaced = deepVariableReplacer(baseUrl, selected.variables);
    return replaced.replace(/^http/, "ws");
  }

  const capturingRef = useRef(capturing);
  const selectedSttProviderRef = useRef(selectedSttProvider);
  const allSttProvidersRef = useRef(allSttProviders);
  const useSystemPromptRef = useRef(useSystemPrompt);
  const systemPromptRef = useRef(systemPrompt);
  const contextContentRef = useRef(contextContent);
  const conversationMessagesRef = useRef(conversation.messages);
  capturingRef.current = capturing;
  selectedSttProviderRef.current = selectedSttProvider;
  allSttProvidersRef.current = allSttProviders;
  useSystemPromptRef.current = useSystemPrompt;
  systemPromptRef.current = systemPrompt;
  contextContentRef.current = contextContent;
  conversationMessagesRef.current = conversation.messages;

  const openStreamingSocket = useCallback(() => {
    const currentSelected = selectedSttProviderRef.current;
    if (currentSelected.provider === "local-fluidaudio") return;

    const currentProviders = allSttProvidersRef.current;
    const providerConfig = currentProviders.find(
      (p) => p.id === currentSelected.provider
    );
    if (!providerConfig?.streaming) return;

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) return;
    }

    streamingFinalizedRef.current = false;
    batchProcessedForCurrentUtteranceRef.current = false;

    try {
      const wsUrl = buildStreamingUrl(providerConfig, currentSelected);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            sample_rate: capturedSampleRateRef.current,
          })
        );
        setIsStreaming(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            console.error("[STT-Stream] Server error:", data.error);
            return;
          }
          if (data.is_final) {
            setLastTranscription(data.text || "");
            setPartialTranscription("");
            setIsStreaming(false);
            streamingFinalizedRef.current = true;

            if (!batchProcessedForCurrentUtteranceRef.current && data.text && data.text.trim()) {
              const effectiveSystemPrompt = useSystemPromptRef.current
                ? systemPromptRef.current || DEFAULT_SYSTEM_PROMPT
                : contextContentRef.current || DEFAULT_SYSTEM_PROMPT;
              const previousMessages = conversationMessagesRef.current.map((msg) => ({
                role: msg.role,
                content: msg.content,
              }));
              processWithAI(data.text, effectiveSystemPrompt, previousMessages);
            }
            ws.close();
          } else if (data.text) {
            setPartialTranscription(data.text);
          }
        } catch (e) {
          console.error("[STT-Stream] Failed to parse message:", e);
        }
      };

      ws.onerror = (e) => {
        console.error("[STT-Stream] WebSocket error:", e);
        setIsStreaming(false);
      };

      ws.onclose = () => {
        wsRef.current = null;
        setIsStreaming(false);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[STT-Stream] Failed to open WebSocket:", err);
    }
  }, []);

  const closeStreamingSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsStreaming(false);
    setPartialTranscription("");
  }, []);

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

  useEffect(() => {
    let progressUnlisten: (() => void) | undefined;
    let startUnlisten: (() => void) | undefined;
    let stopUnlisten: (() => void) | undefined;
    let errorUnlisten: (() => void) | undefined;
    let discardedUnlisten: (() => void) | undefined;
    let captureStartedUnlisten: (() => void) | undefined;

    const setupContinuousListeners = async () => {
      try {
        captureStartedUnlisten = await listen("capture-started", (event) => {
          capturedSampleRateRef.current = event.payload as number;
        });

        progressUnlisten = await listen("recording-progress", (event) => {
          const seconds = event.payload as number;
          setRecordingProgress(seconds);
        });

        startUnlisten = await listen("continuous-recording-start", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(true);
          openStreamingSocket();
        });

        stopUnlisten = await listen("continuous-recording-stopped", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(false);
          closeStreamingSocket();
        });

        errorUnlisten = await listen("audio-encoding-error", (event) => {
          const errorMsg = event.payload as string;
          console.error("Audio encoding error:", errorMsg);
          setError(`Failed to process audio: ${errorMsg}`);
          setIsProcessing(false);
          setIsAIProcessing(false);
          setIsRecordingInContinuousMode(false);
        });

        discardedUnlisten = await listen("speech-discarded", () => {});
      } catch (err) {
        console.error("Failed to setup continuous recording listeners:", err);
      }
    };

    setupContinuousListeners();

    return () => {
      if (progressUnlisten) progressUnlisten();
      if (startUnlisten) startUnlisten();
      if (stopUnlisten) stopUnlisten();
      if (errorUnlisten) errorUnlisten();
      if (discardedUnlisten) discardedUnlisten();
      if (captureStartedUnlisten) captureStartedUnlisten();
    };
  }, []);

  useEffect(() => {
    let speechUnlisten: (() => void) | undefined;
    let speechStartUnlisten: (() => void) | undefined;
    let speechChunkUnlisten: (() => void) | undefined;

    const setupEventListener = async () => {
      try {
        speechStartUnlisten = await listen("speech-start", () => {
          if (selectedSttProviderRef.current.provider === "local-fluidaudio") {
            return;
          }
          openStreamingSocket();
        });

        speechChunkUnlisten = await listen("speech-chunk", (event) => {
          const base64Audio = event.payload as string;
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            return;
          }
          const binaryString = atob(base64Audio);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          wsRef.current.send(bytes.buffer);
        });

        speechUnlisten = await listen("speech-detected", async (event) => {
          try {
            if (!capturingRef.current) return;

            if (streamingFinalizedRef.current) {
              streamingFinalizedRef.current = false;
              closeStreamingSocket();
              return;
            }

            closeStreamingSocket();
            batchProcessedForCurrentUtteranceRef.current = true;

            const base64Audio = event.payload as string;
            if (!base64Audio || base64Audio.length < 100) {
              return;
            }

            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const audioBlob = new Blob([bytes], { type: "audio/wav" });

            const currentSelected = selectedSttProviderRef.current;
            const currentProviders = allSttProvidersRef.current;

            if (!currentSelected.provider) {
              setError("No speech provider selected.");
              return;
            }

            const providerConfig = currentProviders.find(
              (p) => p.id === currentSelected.provider
            );

            if (!providerConfig) {
              setError("Speech provider config not found.");
              return;
            }

            setIsProcessing(true);

            const sttAbortController = new AbortController();
            const timeoutId = setTimeout(() => {
              sttAbortController.abort();
            }, 30000);

            try {
              const transcription = await fetchSTT({
                provider: providerConfig,
                selectedProvider: currentSelected,
                audio: audioBlob,
                signal: sttAbortController.signal,
              });

              if (transcription.trim()) {
                setLastTranscription(transcription);
                setError("");

                const effectiveSystemPrompt = useSystemPromptRef.current
                  ? systemPromptRef.current || DEFAULT_SYSTEM_PROMPT
                  : contextContentRef.current || DEFAULT_SYSTEM_PROMPT;

                const previousMessages = conversationMessagesRef.current.map(
                  (msg) => {
                    return { role: msg.role, content: msg.content };
                  }
                );

                await processWithAI(
                  transcription,
                  effectiveSystemPrompt,
                  previousMessages
                );
              } else {
                setError("Received empty transcription");
              }
            } catch (sttError: any) {
              console.error("STT Error:", sttError);
              if (sttAbortController.signal.aborted) {
                setError("Speech transcription timed out (30s)");
              } else {
                setError(sttError.message || "Failed to transcribe audio");
              }
              setIsPopoverOpen(true);
            } finally {
              clearTimeout(timeoutId);
            }
          } catch (err) {
            setError("Failed to process speech");
          } finally {
            setIsProcessing(false);
          }
        });
      } catch (err) {
        setError("Failed to setup speech listener");
      }
    };

    setupEventListener();

    return () => {
      if (speechUnlisten) speechUnlisten();
      if (speechStartUnlisten) speechStartUnlisten();
      if (speechChunkUnlisten) speechChunkUnlisten();
      closeStreamingSocket();
      streamingFinalizedRef.current = false;
      batchProcessedForCurrentUtteranceRef.current = false;
    };
  }, [openStreamingSocket, closeStreamingSocket]);

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

  const handleQuickActionClick = async (action: string) => {
    setError("");

    const effectiveSystemPrompt = useSystemPrompt
      ? systemPrompt || DEFAULT_SYSTEM_PROMPT
      : contextContent || DEFAULT_SYSTEM_PROMPT;

    let updatedMessages = [...conversation.messages];

    if (lastTranscription && lastTranscription.trim()) {
      const lastMessage = updatedMessages[updatedMessages.length - 1];
      if (!lastMessage || lastMessage.content !== lastTranscription) {
        const timestamp = Date.now();
        const userMessage = {
          id: generateMessageId("user", timestamp),
          role: "user" as const,
          content: lastTranscription,
          timestamp,
        };
        updatedMessages.push(userMessage);

        setConversation((prev) => ({
          ...prev,
          messages: [userMessage, ...prev.messages],
          updatedAt: timestamp,
          title: prev.title || generateConversationTitle(lastTranscription),
        }));
      }
    }

    const previousMessages = updatedMessages.map((msg) => {
      return { role: msg.role, content: msg.content };
    });

    await processWithAI(action, effectiveSystemPrompt, previousMessages);
  };

  const startContinuousRecording = useCallback(async () => {
    try {
      setRecordingProgress(0);
      setError("");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      const providerConfig = allSttProviders.find(
        (p) => p.id === selectedSttProvider.provider
      );

      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
        streaming: providerConfig?.streaming === true,
      });
    } catch (err) {
      console.error("Failed to start continuous recording:", err);
      setError(`Failed to start recording: ${err}`);
    }
  }, [
    vadConfig,
    selectedAudioDevices.output.id,
    allSttProviders,
    selectedSttProvider.provider,
  ]);

  const ignoreContinuousRecording = useCallback(async () => {
    try {
      if (!isContinuousMode || !isRecordingInContinuousMode) return;

      await invoke<string>("stop_system_audio_capture");

      setRecordingProgress(0);
      setIsProcessing(false);
      setIsRecordingInContinuousMode(false);
    } catch (err) {
      console.error("Failed to ignore recording:", err);
      setError(`Failed to ignore recording: ${err}`);
    }
  }, [isContinuousMode, isRecordingInContinuousMode]);

  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      previousMessages: Message[]
    ) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      try {
        setIsAIProcessing(true);
        setLastAIResponse("");
        setError("");

        let fullResponse = "";

        if (!selectedAIProvider.provider) {
          setError("No AI provider selected.");
          return;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider) {
          setError("AI provider config not found.");
          return;
        }

        try {
          for await (const chunk of fetchAIResponse({
            provider,
            selectedProvider: selectedAIProvider,
            systemPrompt: prompt,
            history: previousMessages,
            userMessage: transcription,
            imagesBase64: [],
          })) {
            fullResponse += chunk;
            setLastAIResponse((prev) => prev + chunk);
          }
        } catch (aiError: any) {
          setError(aiError.message || "Failed to get AI response");
        }

        if (fullResponse) {
          const timestamp = Date.now();
          setConversation((prev) => ({
            ...prev,
            messages: [
              {
                id: generateMessageId("user", timestamp),
                role: "user" as const,
                content: transcription,
                timestamp,
              },
              {
                id: generateMessageId("assistant", timestamp + 1),
                role: "assistant" as const,
                content: fullResponse,
                timestamp: timestamp + 1,
              },
              ...prev.messages,
            ],
            updatedAt: timestamp,
            title: prev.title || generateConversationTitle(transcription),
          }));
        }
      } catch (err) {
        setError("Failed to get AI response");
      } finally {
        setIsAIProcessing(false);
      }
    },
    [selectedAIProvider, allAiProviders, conversation.messages]
  );

  const startCapture = useCallback(async () => {
    try {
      setError("");

      if (selectedSttProvider.provider === "local-fluidaudio") {
        if (!isSupported) {
          onSetSelectedSttProvider({ provider: "groq", variables: {} });
          setError("Local STT requires macOS Apple Silicon — switched to cloud STT");
          return;
        }

        const status = await invoke<{ asr_ready: boolean }>("stt_get_status");

        if (!status.asr_ready && !isSttInitializing) {
          await initStt();
        }

        const statusAfter = await invoke<{ asr_ready: boolean }>("stt_get_status");
        if (!statusAfter.asr_ready) {
          setError("Failed to initialize local speech model. Please try again.");
          return;
        }
      }

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        return;
      }

      const isContinuous = !vadConfig.enabled;

      const conversationId = generateConversationId("sysaudio");
      setConversation({
        id: conversationId,
        title: "",
        messages: [],
        createdAt: 0,
        updatedAt: 0,
      });

      setCapturing(true);
      capturingRef.current = true;
      setIsPopoverOpen(true);
      setIsContinuousMode(isContinuous);
      setRecordingProgress(0);

      if (isContinuous) {
        setIsRecordingInContinuousMode(false);
        return;
      }

      await invoke<string>("stop_system_audio_capture");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      const providerConfig = allSttProviders.find(
        (p) => p.id === selectedSttProvider.provider
      );

      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
        streaming: providerConfig?.streaming === true,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setIsPopoverOpen(true);
    }
  }, [
    vadConfig,
    selectedAudioDevices.output.id,
    allSttProviders,
    selectedSttProvider,
    isSupported,
    asrReady,
    isSttInitializing,
    initStt,
    onSetSelectedSttProvider,
  ]);

  const stopCapture = useCallback(async () => {
    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      closeStreamingSocket();

      await invoke<string>("stop_system_audio_capture");

      setCapturing(false);
      setIsProcessing(false);
      setIsAIProcessing(false);
      setIsContinuousMode(false);
      setIsRecordingInContinuousMode(false);
      setRecordingProgress(0);
      setLastTranscription("");
      setLastAIResponse("");
      setPartialTranscription("");
      setIsStreaming(false);
      setError("");
      setIsPopoverOpen(false);
      streamingFinalizedRef.current = false;
      batchProcessedForCurrentUtteranceRef.current = false;
      capturingRef.current = false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to stop capture: ${errorMessage}`);
      console.error("Stop capture error:", err);
    }
  }, []);

  const manualStopAndSend = useCallback(async () => {
    try {
      if (!isContinuousMode) {
        console.warn("Not in continuous mode");
        return;
      }

      setIsProcessing(true);

      await invoke("manual_stop_continuous");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to manually stop: ${errorMessage}`);
      setIsProcessing(false);
      console.error("Manual stop error:", err);
    }
  }, [isContinuousMode]);

  const handleSetup = useCallback(async () => {
    try {
      if (isMacOS() || isWindows()) {
        await invoke("request_system_audio_access");
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture();
      } else {
        setSetupRequired(true);
        setError("Permission not granted. Please try the manual steps.");
      }
    } catch (err) {
      setError("Failed to request access. Please try the manual steps below.");
      setSetupRequired(true);
    }
  }, [startCapture]);

  useEffect(() => {
    const shouldOpenPopover =
      capturing ||
      setupRequired ||
      isAIProcessing ||
      !!lastAIResponse ||
      isStreaming ||
      !!error;
    setIsPopoverOpen(shouldOpenPopover);
    resizeWindow(shouldOpenPopover);
  }, [
    capturing,
    setupRequired,
    isAIProcessing,
    lastAIResponse,
    isStreaming,
    error,
    resizeWindow,
  ]);

  useEffect(() => {
    globalShortcuts.registerSystemAudioCallback(async () => {
      if (capturing) {
        await stopCapture();
      } else {
        await startCapture();
      }
    });
  }, [startCapture, stopCapture]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      invoke("stop_system_audio_capture").catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    if (
      !conversation.id ||
      conversation.updatedAt === 0 ||
      conversation.messages.length === 0
    ) {
      return;
    }

    saveTimeoutRef.current = setTimeout(async () => {
      if (isSavingRef.current) {
        return;
      }

      try {
        isSavingRef.current = true;
        await saveConversation(conversation);
      } catch (error) {
        console.error("Failed to save system audio conversation:", error);
      } finally {
        isSavingRef.current = false;
      }
    }, CONVERSATION_SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    conversation.messages.length,
    conversation.title,
    conversation.id,
    conversation.updatedAt,
  ]);

  const startNewConversation = useCallback(() => {
    setConversation({
      id: generateConversationId("sysaudio"),
      title: "",
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    });
    setLastTranscription("");
    setLastAIResponse("");
    setError("");
    setSetupRequired(false);
    setIsProcessing(false);
    setIsAIProcessing(false);
    setIsPopoverOpen(false);
    setUseSystemPrompt(true);
  }, []);

  useEffect(() => {
    if (capturing) {
      setIsContinuousMode(!vadConfig.enabled);

      if (!vadConfig.enabled) {
        setIsRecordingInContinuousMode(false);
      }
    }
  }, [vadConfig.enabled, capturing]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const scrollElement = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement;

      if (!scrollElement) return;

      const scrollAmount = 100;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

  useEffect(() => {
    const handleRecordingShortcuts = (e: KeyboardEvent) => {
      if (!isPopoverOpen || !isContinuousMode) return;
      if (isProcessing || isAIProcessing) return;

      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!isRecordingInContinuousMode) {
          startContinuousRecording();
        } else {
          manualStopAndSend();
        }
      }

      if (e.key === "Escape" && isRecordingInContinuousMode) {
        e.preventDefault();
        ignoreContinuousRecording();
      }

      if (
        e.key === " " &&
        !isRecordingInContinuousMode &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        startContinuousRecording();
      }
    };

    window.addEventListener("keydown", handleRecordingShortcuts);
    return () =>
      window.removeEventListener("keydown", handleRecordingShortcuts);
  }, [
    isPopoverOpen,
    isContinuousMode,
    isRecordingInContinuousMode,
    isProcessing,
    isAIProcessing,
    startContinuousRecording,
    manualStopAndSend,
    ignoreContinuousRecording,
  ]);

  return {
    capturing,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastAIResponse,
    partialTranscription,
    isStreaming,
    error,
    setupRequired,
    isSttInitializing,
    startCapture,
    stopCapture,
    handleSetup,
    isPopoverOpen,
    setIsPopoverOpen,
    conversation,
    setConversation,
    processWithAI,
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    startNewConversation,
    resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    vadConfig,
    updateVadConfiguration,
    isContinuousMode,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    scrollAreaRef,
  };
}
