import { z } from "zod";

export const createSessionSchema = z.object({
  sourceType: z.enum(["mic", "upload"]),
  fileName: z.string().optional(),
  fileSizeBytes: z.number().optional(),
});

export const sessionIdSchema = z.object({
  sessionId: z.string().uuid(),
});

export const updateSessionSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.enum([
    "idle",
    "recording",
    "uploading",
    "transcribing",
    "completed",
    "error",
  ]),
  totalChunks: z.number().optional(),
  errorMessage: z.string().optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type SessionIdInput = z.infer<typeof sessionIdSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
