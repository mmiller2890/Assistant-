import { ChatMessage, Message } from "@/types/completion";

/**
 * Cap on how many prior messages are sent as AI context. Without a window, an
 * hour-long session grows the prompt without bound (cost, latency, and
 * eventually context-window overflow).
 */
export const MAX_AI_HISTORY_MESSAGES = 12;

/**
 * Build the AI context window from conversation state.
 *
 * Conversation state stores messages **newest-first**, but the model needs
 * them **oldest-first** (chronological). This takes the most recent
 * `MAX_AI_HISTORY_MESSAGES`, drops the message currently being answered (so it
 * isn't duplicated as both history and the live user turn), and returns them
 * sorted by timestamp.
 *
 * Regression guard: an earlier version sent the full history newest-first, so
 * the model saw the entire conversation reversed.
 */
export function buildAIHistory(
  messages: ChatMessage[],
  excludeMessageId?: string
): Message[] {
  return messages
    .filter((m) => m.id !== excludeMessageId)
    .slice(0, MAX_AI_HISTORY_MESSAGES)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((m) => ({ role: m.role, content: m.content }));
}
