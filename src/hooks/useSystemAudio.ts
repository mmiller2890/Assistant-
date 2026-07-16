import { useApp } from "@/contexts";
import { useCaptureEngine } from "./system-audio/useCaptureEngine";
import { useVadConfig, type VadConfig } from "./system-audio/useVadConfig";
import { useQuickActions } from "./system-audio/useQuickActions";
import { useContextSettings } from "./system-audio/useContextSettings";
import { useCaptureKeyboardShortcuts } from "./system-audio/useCaptureKeyboardShortcuts";

export type { VadConfig };

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

export function useSystemAudio() {
  const { systemPrompt } = useApp();

  const { vadConfig, updateVadConfiguration } = useVadConfig();
  const {
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
  } = useQuickActions();
  const {
    useSystemPrompt,
    setUseSystemPrompt,
    contextContent,
    setContextContent,
    getEffectiveSystemPrompt,
    resetUseSystemPrompt,
  } = useContextSettings(systemPrompt);

  const engine = useCaptureEngine({
    vadConfig,
    getEffectiveSystemPrompt,
    resetUseSystemPrompt,
  });

  const { scrollAreaRef } = useCaptureKeyboardShortcuts({
    isPopoverOpen: engine.isPopoverOpen,
    isContinuousMode: engine.isContinuousMode,
    isRecordingInContinuousMode: engine.isRecordingInContinuousMode,
    isProcessing: engine.isProcessing,
    isAIProcessing: engine.isAIProcessing,
    startContinuousRecording: engine.startContinuousRecording,
    manualStopAndSend: engine.manualStopAndSend,
    ignoreContinuousRecording: engine.ignoreContinuousRecording,
  });

  return {
    capturing: engine.capturing,
    isProcessing: engine.isProcessing,
    isAIProcessing: engine.isAIProcessing,
    lastTranscription: engine.lastTranscription,
    lastAIResponse: engine.lastAIResponse,
    partialTranscription: engine.partialTranscription,
    isStreaming: engine.isStreaming,
    error: engine.error,
    setupRequired: engine.setupRequired,
    isSttInitializing: engine.isSttInitializing,
    startCapture: engine.startCapture,
    stopCapture: engine.stopCapture,
    handleSetup: engine.handleSetup,
    isPopoverOpen: engine.isPopoverOpen,
    setIsPopoverOpen: engine.setIsPopoverOpen,
    conversation: engine.conversation,
    setConversation: engine.setConversation,
    processWithAI: engine.processWithAI,
    useSystemPrompt,
    setUseSystemPrompt,
    contextContent,
    setContextContent,
    startNewConversation: engine.startNewConversation,
    resizeWindow: engine.resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick: engine.handleQuickActionClick,
    vadConfig,
    updateVadConfiguration,
    isContinuousMode: engine.isContinuousMode,
    isRecordingInContinuousMode: engine.isRecordingInContinuousMode,
    recordingProgress: engine.recordingProgress,
    manualStopAndSend: engine.manualStopAndSend,
    startContinuousRecording: engine.startContinuousRecording,
    ignoreContinuousRecording: engine.ignoreContinuousRecording,
    scrollAreaRef,
  };
}
