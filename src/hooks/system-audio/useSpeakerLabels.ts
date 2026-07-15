import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ChatConversation } from "@/types/completion";

export interface SpeakerSegment {
  speaker_id: string;
  start_time: number;
  end_time: number;
}

export interface UtteranceWindow {
  start: number;
  end: number;
}

/**
 * Speaker-diarization presentation state for a capture session: the segments
 * returned by diarization, which speaker is currently talking, and how
 * segments map onto transcript messages after a session ends.
 */
export function useSpeakerLabels(
  setConversation: Dispatch<SetStateAction<ChatConversation>>
) {
  const [speakerSegments, setSpeakerSegments] = useState<SpeakerSegment[]>([]);
  const [isLabelingSpeakers, setIsLabelingSpeakers] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);

  const getSpeakerForUtterance = useCallback(
    (
      startTime: number,
      endTime: number,
      segments: SpeakerSegment[]
    ): string | null => {
      let bestSpeaker: string | null = null;
      let bestOverlap = 0;
      for (const seg of segments) {
        const overlap =
          Math.min(endTime, seg.end_time) - Math.max(startTime, seg.start_time);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestSpeaker = seg.speaker_id;
        }
      }
      return bestSpeaker;
    },
    []
  );

  const labelMessagesWithSpeakers = useCallback(
    (segments: SpeakerSegment[], timestamps: UtteranceWindow[]) => {
      setConversation((prev) => {
        if (timestamps.length === 0 || segments.length === 0) {
          return prev;
        }
        const updated = [...prev.messages];
        const userMessageIndices: number[] = [];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i]?.role === "user" && !updated[i].speaker) {
            userMessageIndices.push(i);
            if (userMessageIndices.length >= timestamps.length) {
              break;
            }
          }
        }
        timestamps.forEach((ts, index) => {
          const userMsgIndex = userMessageIndices[index];
          if (userMsgIndex === undefined) {
            return;
          }
          const speaker = getSpeakerForUtterance(ts.start, ts.end, segments);
          if (speaker) {
            updated[userMsgIndex] = {
              ...updated[userMsgIndex],
              speaker,
            };
          }
        });
        return { ...prev, messages: updated };
      });
    },
    [getSpeakerForUtterance, setConversation]
  );

  return {
    speakerSegments,
    setSpeakerSegments,
    isLabelingSpeakers,
    setIsLabelingSpeakers,
    currentSpeaker,
    setCurrentSpeaker,
    getSpeakerForUtterance,
    labelMessagesWithSpeakers,
  };
}
