import { describe, it, expect } from "vitest";
import { buildAIHistory, MAX_AI_HISTORY_MESSAGES } from "./ai-history.function";
import { ChatMessage } from "@/types/completion";

// Conversation state is newest-first, so index 0 is the most recent message.
function msg(
  id: string,
  role: ChatMessage["role"],
  content: string,
  timestamp: number
): ChatMessage {
  return { id, role, content, timestamp };
}

describe("buildAIHistory", () => {
  it("returns messages in chronological (oldest-first) order", () => {
    // Stored newest-first (how the conversation state holds them).
    const stored = [
      msg("m3", "assistant", "third", 300),
      msg("m2", "user", "second", 200),
      msg("m1", "user", "first", 100),
    ];
    const result = buildAIHistory(stored);
    expect(result.map((m) => m.content)).toEqual(["first", "second", "third"]);
  });

  it("caps the window at MAX_AI_HISTORY_MESSAGES most-recent messages", () => {
    // 20 messages, newest (highest ts) first.
    const stored = Array.from({ length: 20 }, (_, i) =>
      msg(`m${i}`, "user", `msg-${20 - i}`, (20 - i) * 100)
    );
    const result = buildAIHistory(stored);
    expect(result).toHaveLength(MAX_AI_HISTORY_MESSAGES);
    // Should be the 12 most recent, chronological: msg-9 .. msg-20.
    expect(result[0].content).toBe("msg-9");
    expect(result[result.length - 1].content).toBe("msg-20");
  });

  it("excludes the message being answered so it isn't duplicated", () => {
    const stored = [
      msg("live", "user", "the current question", 300),
      msg("m2", "assistant", "earlier answer", 200),
      msg("m1", "user", "earlier question", 100),
    ];
    const result = buildAIHistory(stored, "live");
    expect(result.map((m) => m.content)).toEqual([
      "earlier question",
      "earlier answer",
    ]);
    expect(result.some((m) => m.content === "the current question")).toBe(false);
  });

  it("strips id/timestamp/speaker down to role + content", () => {
    const stored = [msg("m1", "user", "hi", 100)];
    expect(buildAIHistory(stored)).toEqual([{ role: "user", content: "hi" }]);
  });

  it("handles an empty conversation", () => {
    expect(buildAIHistory([])).toEqual([]);
  });
});
