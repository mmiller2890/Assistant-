/**
 * Heuristic gate deciding whether a captured utterance deserves an automatic
 * AI answer. In a real meeting most utterances are not questions (small talk,
 * acknowledgments, thinking out loud); answering all of them is noisy, burns
 * tokens, and lets "okay, so…" abort a good in-flight answer.
 *
 * Anything the gate skips still lands in the transcript, and the
 * answer-last-utterance shortcut can answer it on demand — so false negatives
 * cost one keypress, while false positives cost an unwanted AI response.
 */

const TRAILING_QUESTION_MARK = /\?\s*$/;

// Utterances that OPEN with an interrogative or a classic interviewer prompt
// ("Explain…", "Walk me through…", "Tell me about…").
const LEADING_PATTERN =
  /^(?:so[,\s]+|and[,\s]+|now[,\s]+|okay[,\s]+|ok[,\s]+|well[,\s]+)*(?:what|why|how|when|where|who|whom|whose|which|can|could|would|will|should|shall|do|does|did|is|are|was|were|am|have|has|had|may|might|must|tell me|explain|describe|walk me through|talk me through|talk about|give me|define|compare|name|list|share|elaborate)\b/i;

// Question phrasings embedded mid-sentence ("…so can you describe…").
const EMBEDDED_PATTERN =
  /\b(?:can you|could you|would you|will you|do you|did you|have you|are you|tell me|explain|describe|walk me through|what is|what are|what's|what was|what were|how do|how does|how did|how would|how was|why is|why do|why did|why would|when do|when did|where do|where did|give me an example|give an example)\b/i;

export function isLikelyQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (TRAILING_QUESTION_MARK.test(trimmed)) {
    return true;
  }
  if (LEADING_PATTERN.test(trimmed)) {
    return true;
  }
  return EMBEDDED_PATTERN.test(trimmed);
}
