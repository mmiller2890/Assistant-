import { useEffect, useState, useCallback, useRef } from "react";
import { useWindowResize, useGlobalShortcuts } from ".";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/contexts";
import {
  fetchSTT,
  fetchAIResponse,
  isLikelyQuestion,
  buildAIHistory,
} from "@/lib/functions";
import { useSttStatus } from "./useSttStatus";
import {
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_SYSTEM_PROMPT,
  STORAGE_KEYS,
} from "@/config";
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
import { ChatConversation, Message } from "@/types/completion";
import { useSpeakerLabels } from "./system-audio/useSpeakerLabels";
import { useSttStreamSocket } from "./system-audio/useSttStreamSocket";

export interface VadConfig {
  enabled: boolean;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
  emit_chunks?: boolean;
  chunk_interval_ms?: number;
}

const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.006,
  peak_threshold: 0.020,
  silence_chunks: 60,
  min_speech_chunks: 12,
  pre_speech_chunks: 12,
  noise_gate_threshold: 0.0015,
  max_recording_duration_secs: 180,
  emit_chunks: false,
  chunk_interval_ms: 1000,
};

// Conversation/message shapes are the shared app types; re-exported here for
// existing importers of this module.
export type { ChatConversation };

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
  const [error, setError] = useState<string>("");
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const [isManagingQuickActions, setIsManagingQuickActions] =
    useState<boolean>(false);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(true);
  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);
  const [recordingProgress, setRecordingProgress] = useState<number>(0);
  // Live input level (0..1, raw peak) and a "no audio detected" flag, both
  // driven by backend events during VAD capture — they surface the silent-tap
  // failure that otherwise looks identical to normal listening.
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [noAudioDetected, setNoAudioDetected] = useState<boolean>(false);
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

  const {
    speakerSegments,
    setSpeakerSegments,
    isLabelingSpeakers,
    setIsLabelingSpeakers,
    currentSpeaker,
    setCurrentSpeaker,
    getSpeakerForUtterance,
    labelMessagesWithSpeakers,
  } = useSpeakerLabels(setConversation);

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
  // Monotonic id for AI requests; processWithAI uses it to detect when a
  // newer utterance has superseded an in-flight stream.
  const aiRequestSeqRef = useRef(0);
  // Most recent captured utterance, answered or not — the target of the
  // answer-last-utterance shortcut.
  const lastUtteranceRef = useRef<{ text: string; messageId: string } | null>(
    null
  );
  // Read by the once-registered shortcut listener; assigned below after
  // answerLastUtterance is defined (same stale-closure guard as
  // processWithAIRef).
  const answerLastRef = useRef<() => void>(() => {});
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const capturedSampleRateRef = useRef<number>(16000);
  const utteranceTimestampsRef = useRef<Array<{ start: number; end: number }>>([]);

  const capturingRef = useRef(capturing);
  const selectedSttProviderRef = useRef(selectedSttProvider);
  const allSttProvidersRef = useRef(allSttProviders);
  const useSystemPromptRef = useRef(useSystemPrompt);
  const systemPromptRef = useRef(systemPrompt);
  const contextContentRef = useRef(contextContent);
  const conversationMessagesRef = useRef(conversation.messages);
  const vadConfigRef = useRef(vadConfig);
  // `processWithAI` is invoked from the `speech-detected` listener and the
  // streaming socket, both registered once with empty/stable deps. They capture
  // their closure on the first render — when `selectedAIProvider` is still the
  // initial empty value (the context hydrates it from localStorage afterwards),
  // which made system-audio capture fail with "No AI provider selected" even
  // after a provider was chosen. Mirror the latest callback into a ref, like
  // the other listener-visible values above, so those call sites always read
  // the current provider. Assigned after `processWithAI` is defined below.
  const processWithAIRef = useRef<
    (
      transcription: string,
      prompt: string,
      previousMessages: Message[],
      existingUserMessageId?: string
    ) => Promise<void>
  >(async () => {});
  capturingRef.current = capturing;
  selectedSttProviderRef.current = selectedSttProvider;
  allSttProvidersRef.current = allSttProviders;
  useSystemPromptRef.current = useSystemPrompt;
  systemPromptRef.current = systemPrompt;
  contextContentRef.current = contextContent;
  conversationMessagesRef.current = conversation.messages;
  vadConfigRef.current = vadConfig;

  // Handles a streaming provider's final transcript. Ref-backed because the
  // socket handlers are created once per socket; assigned below once the
  // transcript/answer helpers are defined.
  const onFinalTranscriptRef = useRef<(text: string) => void>(() => {});
  const {
    isStreaming,
    partialTranscription,
    openStreamingSocket,
    closeStreamingSocket,
    sendAudioChunk,
    streamingFinalizedRef,
    batchProcessedForCurrentUtteranceRef,
  } = useSttStreamSocket({
    selectedSttProviderRef,
    allSttProvidersRef,
    capturedSampleRateRef,
    onFinalTranscriptRef,
  });

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

    const savedVadConfig = safeLocalStorage.getItem("vad_config");
    if (savedVadConfig) {
      try {
        const parsed = JSON.parse(savedVadConfig);
        setVadConfig(parsed);
      } catch (error) {
        console.error("Failed to load VAD config:", error);
      }
    }
  }, []);

  useEffect(() => {
    const savedActions = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS
    );
    if (savedActions) {
      try {
        const parsed = JSON.parse(savedActions);
        setQuickActions(parsed);
      } catch (error) {
        console.error("Failed to load quick actions:", error);
        setQuickActions(DEFAULT_QUICK_ACTIONS);
      }
    } else {
      setQuickActions(DEFAULT_QUICK_ACTIONS);
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
          sendAudioChunk(event.payload as string);
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

            const payload = event.payload as {
              audio: string;
              start_time: number;
              end_time: number;
            };

            const base64Audio = payload.audio;
            if (!base64Audio || base64Audio.length < 100) {
              return;
            }

            if (payload.start_time !== 0 || payload.end_time !== 0) {
              utteranceTimestampsRef.current.push({
                start: payload.start_time,
                end: payload.end_time,
              });
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

                // Every utterance lands in the transcript; only likely
                // questions earn an automatic answer. The rest can be
                // answered on demand via the answer-last shortcut.
                const messageId = appendUtteranceMessage(transcription);
                lastUtteranceRef.current = { text: transcription, messageId };

                if (isLikelyQuestion(transcription)) {
                  const effectiveSystemPrompt = useSystemPromptRef.current
                    ? systemPromptRef.current || DEFAULT_SYSTEM_PROMPT
                    : contextContentRef.current || DEFAULT_SYSTEM_PROMPT;

                  const previousMessages = buildAIHistory(
                    conversationMessagesRef.current,
                    messageId
                  );

                  await processWithAIRef.current(
                    transcription,
                    effectiveSystemPrompt,
                    previousMessages,
                    messageId
                  );
                }
              } else {
                // Non-speech segments (music, ambience) legitimately transcribe
                // to nothing — skip them quietly instead of surfacing an error.
                console.warn("Skipping empty transcription for non-speech segment");
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

  const saveQuickActions = useCallback((actions: string[]) => {
    try {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
        JSON.stringify(actions)
      );
    } catch (error) {
      console.error("Failed to save quick actions:", error);
    }
  }, []);

  const addQuickAction = useCallback(
    (action: string) => {
      if (action && !quickActions.includes(action)) {
        const newActions = [...quickActions, action];
        setQuickActions(newActions);
        saveQuickActions(newActions);
      }
    },
    [quickActions, saveQuickActions]
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      const newActions = quickActions.filter((a) => a !== action);
      setQuickActions(newActions);
      saveQuickActions(newActions);
    },
    [quickActions, saveQuickActions]
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

    const previousMessages = buildAIHistory(updatedMessages);

    await processWithAI(action, effectiveSystemPrompt, previousMessages);
  };

  const startContinuousRecording = useCallback(async () => {
    try {
      setRecordingProgress(0);
      setError("");

      // Manual record supersedes any active session. Only one capture task
      // can exist on the Rust side, so a running VAD session must be stopped
      // first — otherwise the start below is rejected with "Capture already
      // running" and the VAD session keeps picking up audio.
      if (capturingRef.current) {
        await invoke("stop_system_audio_capture");
      }

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      const providerConfig = allSttProviders.find(
        (p) => p.id === selectedSttProvider.provider
      );

      // The record button always means a manual take, regardless of which
      // mode the current session was started in.
      await invoke<string>("start_system_audio_capture", {
        vadConfig: { ...vadConfig, enabled: false },
        deviceId: deviceId,
        streaming: providerConfig?.streaming === true,
      });
      setIsContinuousMode(true);
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


  // Record a captured utterance in the transcript immediately, whether or not
  // it earns an automatic answer. Returns the message id so the answer path
  // can attach the assistant reply without duplicating the user entry.
  const appendUtteranceMessage = useCallback(
    (transcription: string): string => {
      const timestamp = Date.now();
      const id = generateMessageId("user", timestamp);
      setConversation((prev) => ({
        ...prev,
        messages: [
          { id, role: "user" as const, content: transcription, timestamp },
          ...prev.messages,
        ],
        updatedAt: timestamp,
        title: prev.title || generateConversationTitle(transcription),
      }));
      return id;
    },
    []
  );

  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      previousMessages: Message[],
      existingUserMessageId?: string
    ) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      // Latest-question-wins: each call supersedes any in-flight one. The
      // signal cancels the fetch, and the request id stops a superseded
      // stream from appending chunks that were already in flight — without
      // both, concurrent utterances interleave into the same response text.
      const requestId = ++aiRequestSeqRef.current;
      const isCurrent = () => requestId === aiRequestSeqRef.current;

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
            signal,
          })) {
            if (!isCurrent()) return;
            fullResponse += chunk;
            setLastAIResponse((prev) => prev + chunk);
          }
        } catch (aiError: any) {
          if (!isCurrent() || signal.aborted) return;
          setError(aiError.message || "Failed to get AI response");
        }

        if (fullResponse && isCurrent()) {
          const timestamp = Date.now();
          const latestUtterance =
            utteranceTimestampsRef.current[
              utteranceTimestampsRef.current.length - 1
            ];
          const speaker = latestUtterance
            ? getSpeakerForUtterance(
                latestUtterance.start,
                latestUtterance.end,
                speakerSegments
              )
            : null;
          setConversation((prev) => {
            const assistantMessage = {
              id: generateMessageId("assistant", timestamp + 1),
              role: "assistant" as const,
              content: fullResponse,
              timestamp: timestamp + 1,
            };
            // Utterances recorded by appendUtteranceMessage are already in
            // the transcript — attach only the reply to avoid duplicates.
            const hasExistingUserMessage =
              existingUserMessageId !== undefined &&
              prev.messages.some((m) => m.id === existingUserMessageId);
            const messages = hasExistingUserMessage
              ? [assistantMessage, ...prev.messages]
              : [
                  {
                    id: generateMessageId("user", timestamp),
                    role: "user" as const,
                    content: transcription,
                    timestamp,
                    speaker: speaker || undefined,
                  },
                  assistantMessage,
                  ...prev.messages,
                ];
            return {
              ...prev,
              messages,
              updatedAt: timestamp,
              title: prev.title || generateConversationTitle(transcription),
            };
          });
          if (speaker) {
            setCurrentSpeaker(speaker);
          }
        }
      } catch (err) {
        if (isCurrent() && !signal.aborted) {
          setError("Failed to get AI response");
        }
      } finally {
        // A superseded call must not clear the spinner for the active one.
        if (isCurrent()) {
          setIsAIProcessing(false);
        }
      }
    },
    [
      selectedAIProvider,
      allAiProviders,
      conversation.messages,
      speakerSegments,
      getSpeakerForUtterance,
    ]
  );

  // Keep the ref pointing at the freshest `processWithAI` so the once-registered
  // listener/socket call sites never run against a stale `selectedAIProvider`.
  processWithAIRef.current = processWithAI;

  // Streaming provider produced a final transcript for the current utterance.
  // Mirrors the batch path: record it, then answer if it looks like a question
  // (unless the batch path already handled this utterance).
  onFinalTranscriptRef.current = (text: string) => {
    setLastTranscription(text);
    if (!batchProcessedForCurrentUtteranceRef.current && text.trim()) {
      const messageId = appendUtteranceMessage(text);
      lastUtteranceRef.current = { text, messageId };

      if (isLikelyQuestion(text)) {
        const effectiveSystemPrompt = useSystemPromptRef.current
          ? systemPromptRef.current || DEFAULT_SYSTEM_PROMPT
          : contextContentRef.current || DEFAULT_SYSTEM_PROMPT;
        const previousMessages = buildAIHistory(
          conversationMessagesRef.current,
          messageId
        );
        processWithAIRef.current(
          text,
          effectiveSystemPrompt,
          previousMessages,
          messageId
        );
      }
    }
  };

  // Answer the most recent captured utterance on demand (global shortcut),
  // regardless of whether the question gate skipped it. Reads everything
  // through refs, so the once-registered listener below stays fresh.
  const answerLastUtterance = useCallback(async () => {
    const last = lastUtteranceRef.current;
    if (!last) {
      return;
    }
    const effectiveSystemPrompt = useSystemPromptRef.current
      ? systemPromptRef.current || DEFAULT_SYSTEM_PROMPT
      : contextContentRef.current || DEFAULT_SYSTEM_PROMPT;
    const previousMessages = buildAIHistory(
      conversationMessagesRef.current,
      last.messageId
    );
    await processWithAIRef.current(
      last.text,
      effectiveSystemPrompt,
      previousMessages,
      last.messageId
    );
  }, []);
  answerLastRef.current = answerLastUtterance;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen("custom-shortcut-triggered", (event) => {
          const action = (event.payload as { action?: string })?.action;
          if (action === "answer_last") {
            answerLastRef.current();
          }
        });
      } catch (err) {
        console.warn("Failed to listen for answer-last shortcut:", err);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  // Input-level meter + no-audio detection from the VAD capture loop.
  // Registered once.
  useEffect(() => {
    let unlistenLevel: (() => void) | undefined;
    let unlistenSilent: (() => void) | undefined;
    (async () => {
      try {
        unlistenLevel = await listen("audio-level", (event) => {
          setAudioLevel((event.payload as number) ?? 0);
        });
        unlistenSilent = await listen("audio-silent", () => {
          setNoAudioDetected(true);
        });
      } catch (err) {
        console.warn("Failed to listen for audio level events:", err);
      }
    })();
    return () => {
      unlistenLevel?.();
      unlistenSilent?.();
    };
  }, []);

  // The Rust VAD capture emits `audio-device-changed` when the default output
  // device switches mid-session (e.g. AirPods plugged in) — the tap would
  // otherwise keep capturing silence. Transparently restart on the new device.
  // Registered once; reads everything through refs.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen("audio-device-changed", async () => {
          if (!capturingRef.current) return;
          setError("Audio device changed — reconnecting…");
          try {
            await invoke("stop_system_audio_capture");
            const providerConfig = allSttProvidersRef.current.find(
              (p) => p.id === selectedSttProviderRef.current.provider
            );
            await invoke<string>("start_system_audio_capture", {
              vadConfig: vadConfigRef.current,
              deviceId: null, // follow the new default device
              streaming: providerConfig?.streaming === true,
            });
            setError("");
          } catch (err) {
            console.error("Failed to reconnect after device change:", err);
            setError(`Audio device changed and reconnecting failed: ${err}`);
          }
        });
      } catch (err) {
        console.warn("Failed to listen for audio-device-changed:", err);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

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

        const statusAfter = await invoke<{
          asr_ready: boolean;
          vad_ready: boolean;
          diarization_ready: boolean;
        }>("stt_get_status");
        if (!statusAfter.asr_ready) {
          setError("Failed to initialize local speech model. Please try again.");
          return;
        }

        if (!statusAfter.vad_ready) {
          try {
            // 0.5 matches the mic path's positiveSpeechThreshold. The capture
            // loop applies its own 0.5/0.35 hysteresis on the raw probability;
            // this threshold only shapes VadFrame.is_voice_active.
            await invoke("stt_init_vad", { threshold: 0.5 });
          } catch (err) {
            console.warn(
              "Silero VAD init failed, falling back to threshold VAD:",
              err
            );
          }
        }

        if (!statusAfter.diarization_ready) {
          try {
            await invoke("stt_init_diarization", { threshold: 0.6 });
          } catch (err) {
            console.warn("Diarization init failed:", err);
          }
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
      setAudioLevel(0);
      setNoAudioDetected(false);
      utteranceTimestampsRef.current = [];
      setSpeakerSegments([]);
      setIsLabelingSpeakers(false);
      setCurrentSpeaker(null);

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

      const sessionPath = await invoke<string | null>(
        "stop_system_audio_capture"
      );

      if (selectedSttProvider.provider === "local-fluidaudio" && sessionPath) {
        try {
          setIsLabelingSpeakers(true);
          const segments = await invoke<
            Array<{
              speaker_id: string;
              start_time: number;
              end_time: number;
            }>
          >("stt_diarize_file", { path: sessionPath });
          setSpeakerSegments(segments);
          labelMessagesWithSpeakers(segments, utteranceTimestampsRef.current);
        } catch (err) {
          console.warn("Diarization failed:", err);
        } finally {
          setIsLabelingSpeakers(false);
        }
      }

      setCapturing(false);
      setIsProcessing(false);
      setIsAIProcessing(false);
      setIsContinuousMode(false);
      setIsRecordingInContinuousMode(false);
      setRecordingProgress(0);
      setAudioLevel(0);
      setNoAudioDetected(false);
      setLastTranscription("");
      setLastAIResponse("");
      closeStreamingSocket();
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

  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (error) {
      console.error("Failed to update VAD config:", error);
    }
  }, []);

  // Apply a mode change (VAD <-> manual) to the RUNNING session. The Rust
  // capture task snapshots its config at start, so without a restart the
  // toggle only changed a setting: switching to manual left the VAD session
  // listening, and switching to VAD left the session armed-but-idle while
  // the UI claimed to be listening.
  const prevVadEnabledRef = useRef(vadConfig.enabled);
  useEffect(() => {
    const modeChanged = prevVadEnabledRef.current !== vadConfig.enabled;
    prevVadEnabledRef.current = vadConfig.enabled;

    if (!capturing) {
      return;
    }

    setIsContinuousMode(!vadConfig.enabled);
    if (!vadConfig.enabled) {
      setIsRecordingInContinuousMode(false);
    }

    if (!modeChanged) {
      return;
    }

    (async () => {
      try {
        // Stop whatever session is running (no-op if manual mode was armed
        // with no active task).
        await invoke("stop_system_audio_capture");

        if (vadConfig.enabled) {
          // Switching to VAD: start listening immediately.
          const deviceId =
            selectedAudioDevices.output.id !== "default"
              ? selectedAudioDevices.output.id
              : null;
          const providerConfig = allSttProvidersRef.current.find(
            (p) => p.id === selectedSttProviderRef.current.provider
          );
          await invoke<string>("start_system_audio_capture", {
            vadConfig: vadConfig,
            deviceId: deviceId,
            streaming: providerConfig?.streaming === true,
          });
        }
        // Switching to manual: stay armed; the Record button starts a take.
      } catch (err) {
        console.error("Failed to apply capture mode change:", err);
        setError(`Failed to switch capture mode: ${err}`);
      }
    })();
  }, [vadConfig, capturing, selectedAudioDevices.output.id]);

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
    answerLastUtterance,
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
    audioLevel,
    noAudioDetected,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    scrollAreaRef,
    speakerSegments,
    isLabelingSpeakers,
    currentSpeaker,
  };
}
