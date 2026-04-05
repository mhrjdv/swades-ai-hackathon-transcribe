import { TRPCError } from "@trpc/server";
import { eq, desc } from "drizzle-orm";
import { sessions } from "@my-better-t-app/db/schema/sessions";
import { router, publicProcedure } from "../router";
import {
  createSessionSchema,
  sessionIdSchema,
  updateSessionSchema,
} from "../schemas/session";

export const sessionRouter = router({
  create: publicProcedure
    .input(createSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .insert(sessions)
        .values({
          sourceType: input.sourceType,
          fileName: input.fileName ?? null,
          fileSizeBytes: input.fileSizeBytes ?? null,
        })
        .returning();

      if (!session) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create session",
        });
      }

      return session;
    }),

  getById: publicProcedure
    .input(sessionIdSchema)
    .query(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Session ${input.sessionId} not found`,
        });
      }

      return session;
    }),

  getAll: publicProcedure
    .query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(sessions)
        .orderBy(desc(sessions.createdAt));
    }),

  updateStatus: publicProcedure
    .input(updateSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(sessions)
        .set({
          status: input.status,
          ...(input.totalChunks !== undefined ? { totalChunks: input.totalChunks } : {}),
          ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
        })
        .where(eq(sessions.id, input.sessionId))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Session ${input.sessionId} not found`,
        });
      }

      return updated;
    }),

  delete: publicProcedure
    .input(sessionIdSchema)
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(sessions)
        .where(eq(sessions.id, input.sessionId))
        .returning({ id: sessions.id });

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Session ${input.sessionId} not found`,
        });
      }

      return { success: true, id: deleted.id };
    }),
});
