import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { createDb } from "@my-better-t-app/db";

// Context type - provided by the server adapter
export type Context = {
  db: ReturnType<typeof createDb>;
  enqueueTranscription?: (sessionId: string) => Promise<unknown>;
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
