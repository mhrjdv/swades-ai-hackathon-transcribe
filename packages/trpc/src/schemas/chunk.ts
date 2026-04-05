import { z } from "zod";

export const chunkStatusQuerySchema = z.object({
  sessionId: z.string().uuid(),
  chunkIndex: z.number().int().min(0),
});

export const chunkAckSchema = z.object({
  chunkId: z.string().uuid(),
});

export const batchChunkStatusSchema = z.object({
  sessionId: z.string().uuid(),
});

export type ChunkStatusQueryInput = z.infer<typeof chunkStatusQuerySchema>;
export type ChunkAckInput = z.infer<typeof chunkAckSchema>;
export type BatchChunkStatusInput = z.infer<typeof batchChunkStatusSchema>;
