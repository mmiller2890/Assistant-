import { describe, it, expect } from "vitest";
import { isLikelyQuestion } from "./question-gate.function";

describe("isLikelyQuestion", () => {
  it("treats a trailing question mark as a question", () => {
    expect(isLikelyQuestion("So this is fine.")).toBe(false);
    expect(isLikelyQuestion("Is this the right approach?")).toBe(true);
    expect(isLikelyQuestion("Really?  ")).toBe(true);
  });

  it("catches interrogative openers even without punctuation", () => {
    for (const q of [
      "what is a workgroup",
      "why did you choose Rust",
      "how does the VAD work",
      "can you walk me through the pipeline",
      "could you explain closures",
      "would you deploy this on Kubernetes",
      "should we cache the result",
      "do you have experience with CoreAudio",
    ]) {
      expect(isLikelyQuestion(q), q).toBe(true);
    }
  });

  it("catches classic interviewer prompts", () => {
    for (const q of [
      "Tell me about a time you failed",
      "Walk me through your resume",
      "Describe your ideal work environment",
      "Explain the difference between a domain and a workgroup",
    ]) {
      expect(isLikelyQuestion(q), q).toBe(true);
    }
  });

  it("looks through leading filler words", () => {
    expect(isLikelyQuestion("So, what would you do differently")).toBe(true);
    expect(isLikelyQuestion("Okay and how did that go")).toBe(true);
    expect(isLikelyQuestion("Well, can you describe the tradeoffs")).toBe(true);
  });

  it("catches embedded question phrasings mid-sentence", () => {
    expect(
      isLikelyQuestion("Right, so I was hoping you could explain the design")
    ).toBe(true);
    expect(
      isLikelyQuestion("Given all that, tell me how you'd scale it")
    ).toBe(true);
  });

  it("does not fire on ordinary statements and acknowledgments", () => {
    for (const s of [
      "Yeah, that makes sense.",
      "Okay, got it.",
      "I think we should ship it.",
      "The build finished in two minutes.",
      "Let me share my screen.",
      "mmhm",
      "",
      "   ",
    ]) {
      expect(isLikelyQuestion(s), JSON.stringify(s)).toBe(false);
    }
  });
});
