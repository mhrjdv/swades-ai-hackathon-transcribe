import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { chunks } from "@my-better-t-app/db/schema/chunks";
import { router, publicProcedure } from "../router";
import {
  chunkStatusQuerySchema,
  chunkAckSchema,
  batchChunkStatusSchema,
} from "../schemas/chunk";

export const chunkRouter = router({
  getStatus: publicProcedure
    .input(chunkStatusQuerySchema)
    .query(async ({ ctx, input }) => {
      const [chunk] = await ctx.db
        .select()
        .from(chunks)
        .where(
          and(
            eq(chunks.sessionId, input.sessionId),
            eq(chunks.index, input.chunkIndex),
          ),
        )
        .limit(1);

      if (!chunk) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Chunk ${input.chunkIndex} for session ${input.sessionId} not found`,
        });
      }

      return { ...chunk, acked: chunk.status === "acked" };
    }),

  getBatchStatus: publicProcedure
    .input(batchChunkStatusSchema)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(chunks)
        .where(eq(chunks.sessionId, input.sessionId));

      return rows.map((chunk) => ({ ...chunk, acked: chunk.status === "acked" }));
    }),

  ack: publicProcedure
    .input(chunkAckSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(chunks)
        .set({ status: "acked" })
        .where(eq(chunks.id, input.chunkId))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Chunk ${input.chunkId} not found`,
        });
      }

      return updated;
    }),
});
