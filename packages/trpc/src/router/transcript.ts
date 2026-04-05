import { eq, asc } from "drizzle-orm";
import { transcripts } from "@my-better-t-app/db/schema/transcripts";
import { router, publicProcedure } from "../router";
import {
  getTranscriptSchema,
  triggerTranscriptionSchema,
} from "../schemas/transcript";

export const transcriptRouter = router({
  get: publicProcedure
    .input(getTranscriptSchema)
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(transcripts)
        .where(eq(transcripts.sessionId, input.sessionId))
        .orderBy(asc(transcripts.startTime));
    }),

  trigger: publicProcedure
    .input(triggerTranscriptionSchema)
    .mutation(async ({ ctx, input }) => {
      // Enqueue BullMQ job if the server provides the enqueue function
      if (ctx.enqueueTranscription) {
        await ctx.enqueueTranscription(input.sessionId);
      }
      return { success: true, sessionId: input.sessionId };
    }),
});
