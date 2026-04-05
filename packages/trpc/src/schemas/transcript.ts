import { z } from "zod";

export const getTranscriptSchema = z.object({
  sessionId: z.string().uuid(),
});

export const triggerTranscriptionSchema = z.object({
  sessionId: z.string().uuid(),
});

export const transcriptSegmentSchema = z.object({
  sessionId: z.string().uuid(),
  speakerId: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  content: z.string(),
  confidence: z.number().optional(),
});

export type GetTranscriptInput = z.infer<typeof getTranscriptSchema>;
export type TriggerTranscriptionInput = z.infer<typeof triggerTranscriptionSchema>;
export type TranscriptSegmentInput = z.infer<typeof transcriptSegmentSchema>;
