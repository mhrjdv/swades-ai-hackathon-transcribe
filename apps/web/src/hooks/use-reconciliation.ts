"use client";

import { useState, useCallback } from "react";
import { useOPFS } from "./use-opfs";
import { useChunkUploader } from "./use-chunk-uploader";
import { trpc } from "../lib/trpc";
import { env } from "@my-better-t-app/env/web";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  sessionId: string;
  totalChunks: number;
  alreadyAcked: number;
  reUploaded: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useReconciliation
 *
 * On-demand client-side reconciliation:
 *   For each session in OPFS → for each un-acked chunk:
 *     • Query server: chunk.getStatus({ sessionId, chunkIndex })
 *     • Server says "acked"     → mark acked locally, skip re-upload
 *     • Server says "not found" → re-upload from OPFS
 *   Once all chunks are acked → wipe the session from OPFS entirely.
 */
export function useReconciliation() {
  const [isReconciling, setIsReconciling] = useState(false);
  const [results, setResults] = useState<ReconciliationResult[]>([]);

  const {
    readManifest,
    readChunk,
    markChunkAcked,
    clearSession,
  } = useOPFS();

  const { uploadChunk } = useChunkUploader(env.NEXT_PUBLIC_SERVER_URL);

  // We need to call the tRPC query imperatively. Use utils for that.
  const trpcUtils = trpc.useUtils();

  /**
   * Reconciles all un-acked chunks for a single session.
   */
  const reconcile = useCallback(
    async (sessionId: string): Promise<ReconciliationResult> => {
      const result: ReconciliationResult = {
        sessionId,
        totalChunks: 0,
        alreadyAcked: 0,
        reUploaded: 0,
        failed: 0,
      };

      const manifest = await readManifest(sessionId);
      if (!manifest) return result;

      result.totalChunks = manifest.chunks.length;

      for (const chunk of manifest.chunks) {
        // Already marked acked locally — nothing to do.
        if (chunk.acked) {
          result.alreadyAcked += 1;
          continue;
        }

        let serverAcked = false;

        try {
          // Ask the server for the current status of this chunk.
          const serverStatus = await trpcUtils.chunk.getStatus.fetch({
            sessionId,
            chunkIndex: chunk.index,
          });

          // The server returns whatever shape it implements; treat any truthy
          // "acked" field as confirmation.
          if (
            serverStatus &&
            typeof serverStatus === "object" &&
            "acked" in serverStatus &&
            serverStatus.acked
          ) {
            serverAcked = true;
          }
        } catch {
          // NOT_IMPLEMENTED or network error — fall through to re-upload.
        }

        if (serverAcked) {
          await markChunkAcked(sessionId, chunk.index);
          result.alreadyAcked += 1;
          continue;
        }

        // Server does not have this chunk → re-upload from OPFS.
        const blob = await readChunk(sessionId, chunk.index);
        if (!blob) {
          result.failed += 1;
          continue;
        }

        const uploadResult = await uploadChunk(sessionId, chunk.index, blob);
        if (uploadResult.success) {
          await markChunkAcked(sessionId, chunk.index);
          result.reUploaded += 1;
        } else {
          result.failed += 1;
        }
      }

      // Re-read the manifest after mutations and check if everything is acked.
      const updatedManifest = await readManifest(sessionId);
      if (
        updatedManifest &&
        updatedManifest.chunks.length > 0 &&
        updatedManifest.chunks.every((c) => c.acked)
      ) {
        await clearSession(sessionId);
      }

      return result;
    },
    [
      readManifest,
      readChunk,
      markChunkAcked,
      clearSession,
      uploadChunk,
      trpcUtils,
    ],
  );

  /**
   * Reconciles ALL sessions currently in OPFS.
   */
  const reconcileAll = useCallback(async (): Promise<ReconciliationResult[]> => {
    setIsReconciling(true);

    try {
      // We can't call hooks inside a callback, so we replicate the
      // listSessions logic inline using the OPFS API directly.
      const opfsResults: ReconciliationResult[] = [];

      if (
        typeof navigator === "undefined" ||
        !navigator.storage ||
        typeof navigator.storage.getDirectory !== "function"
      ) {
        return opfsResults;
      }

      const root = await navigator.storage.getDirectory();
      const sessionIds: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iter = (root as any).entries() as AsyncIterableIterator<[string, FileSystemHandle]>;
      let entry = await iter.next();
      while (!entry.done) {
        const [name, handle] = entry.value;
        if (handle.kind === "directory") {
          sessionIds.push(name);
        }
        entry = await iter.next();
      }

      for (const sessionId of sessionIds) {
        const result = await reconcile(sessionId);
        opfsResults.push(result);
      }

      setResults(opfsResults);
      return opfsResults;
    } finally {
      setIsReconciling(false);
    }
  }, [reconcile]);

  return {
    reconcile,
    reconcileAll,
    isReconciling,
    results,
  };
}
