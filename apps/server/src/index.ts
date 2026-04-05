import { env } from "@my-better-t-app/env/server";
import { db } from "@my-better-t-app/db";
import { appRouter } from "@my-better-t-app/trpc";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { uploadRoutes } from "./routes/upload";
import { enqueueTranscription } from "./services/queue";
// Import worker to register it on server startup
import "./workers/transcribe";

function createContext({ req }: FetchCreateContextFnOptions) {
  return { db, req, enqueueTranscription };
}

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
  })
);

app.get("/", (c) => {
  return c.text("OK");
});

// Mount upload routes (raw Hono for multipart — tRPC cannot handle multipart)
app.route("/", uploadRoutes);

// Transcription trigger — enqueues BullMQ job
app.post("/api/transcribe", async (c) => {
  try {
    const body = await c.req.json();
    const sessionId = body?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) {
      return c.json({ success: false, error: "sessionId is required" }, 400);
    }
    const job = await enqueueTranscription(sessionId);
    return c.json({ success: true, jobId: job.id, sessionId });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Mount tRPC
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext,
  })
);

export default app;
