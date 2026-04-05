import { eq, ne, and } from "drizzle-orm";
import { chunks } from "@my-better-t-app/db/schema/chunks";
import { router, publicProcedure } from "../router";
import { sessionIdSchema } from "../schemas/session";

export const reconciliationRouter = router({
  runServerSide: publicProcedure
    .input(sessionIdSchema)
    .mutation(async ({ input }) => {
      // Server-side reconciliation is coordinated by BullMQ workers.
      return {
        success: true,
        sessionId: input.sessionId,
        checked: 0,
        repaired: 0,
      };
    }),

  getClientStatus: publicProcedure
    .input(sessionIdSchema)
    .query(async ({ ctx, input }) => {
      // Returns all chunks that the client still needs to reconcile (not yet acked).
      return ctx.db
        .select()
        .from(chunks)
        .where(
          and(
            eq(chunks.sessionId, input.sessionId),
            ne(chunks.status, "acked"),
          ),
        );
    }),
});
