import { router } from "./router";
import { sessionRouter } from "./router/session";
import { chunkRouter } from "./router/chunk";
import { transcriptRouter } from "./router/transcript";
import { reconciliationRouter } from "./router/reconciliation";

export const appRouter = router({
  session: sessionRouter,
  chunk: chunkRouter,
  transcript: transcriptRouter,
  reconciliation: reconciliationRouter,
});

export type AppRouter = typeof appRouter;
