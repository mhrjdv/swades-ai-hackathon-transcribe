"use client";

import { useState, useCallback, useRef } from "react";
import { computeChecksum } from "../lib/checksum";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChunkUploadState = "pending" | "uploading" | "success" | "error";

export interface ChunkUploadStatus {
  index: number;
  status: ChunkUploadState;
  retries: number;
  error?: string;
}

export interface ChunkUploadResult {
  success: boolean;
  chunkId?: string;
  bucketKey?: string;
  error?: string;
}

export interface FileUploadResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number,
  baseDelayMs: number,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await delay(baseDelayMs * Math.pow(2, attempt - 1));
    }

    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      // Treat 4xx (except 429) as non-retryable.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const body = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChunkUploader(serverUrl: string) {
  const [statuses, setStatuses] = useState<Map<number, ChunkUploadStatus>>(
    new Map(),
  );
  const [isUploading, setIsUploading] = useState(false);
  const activeUploadsRef = useRef(0);

  const setChunkStatus = useCallback(
    (index: number, patch: Partial<ChunkUploadStatus>) => {
      setStatuses((prev) => {
        const existing = prev.get(index) ?? {
          index,
          status: "pending" as ChunkUploadState,
          retries: 0,
        };
        return new Map(prev).set(index, { ...existing, ...patch });
      });
    },
    [],
  );

  /**
   * Uploads a single audio chunk blob to the server.
   *
   * Steps:
   *  1. Compute SHA-256 checksum of the blob bytes.
   *  2. POST to {serverUrl}/upload/chunk with multipart form data.
   *  3. Retry up to MAX_RETRIES times with exponential back-off on failure.
   *  4. Track per-chunk status throughout.
   */
  const uploadChunk = useCallback(
    async (
      sessionId: string,
      chunkIndex: number,
      blob: Blob,
    ): Promise<ChunkUploadResult> => {
      setChunkStatus(chunkIndex, { status: "uploading", retries: 0 });
      activeUploadsRef.current += 1;
      setIsUploading(true);

      let retries = 0;

      try {
        const buffer = await blob.arrayBuffer();
        const checksum = await computeChecksum(buffer);

        const form = new FormData();
        form.append("sessionId", sessionId);
        form.append("chunkIndex", String(chunkIndex));
        form.append("checksum", checksum);
        form.append("file", blob, `${chunkIndex}.wav`);

        const attemptUpload = async (): Promise<ChunkUploadResult> => {
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (attempt > 0) {
              retries = attempt;
              setChunkStatus(chunkIndex, { retries });
              await delay(RETRY_BASE_MS * Math.pow(2, attempt - 1));
            }

            try {
              const response = await fetch(`${serverUrl}/upload/chunk`, {
                method: "POST",
                body: form,
              });

              if (response.ok) {
                const json = (await response.json()) as {
                  chunkId?: string;
                  bucketKey?: string;
                };
                return {
                  success: true,
                  chunkId: json.chunkId,
                  bucketKey: json.bucketKey,
                };
              }

              // Non-retryable client error (except 429 Too Many Requests)
              if (
                response.status >= 400 &&
                response.status < 500 &&
                response.status !== 429
              ) {
                const body = await response.text().catch(() => "");
                return {
                  success: false,
                  error: `HTTP ${response.status}: ${body}`,
                };
              }

              // Will retry on 5xx / 429
            } catch (err) {
              if (attempt === MAX_RETRIES) {
                return {
                  success: false,
                  error: err instanceof Error ? err.message : String(err),
                };
              }
            }
          }

          return { success: false, error: "Max retries exceeded" };
        };

        const result = await attemptUpload();

        setChunkStatus(chunkIndex, {
          status: result.success ? "success" : "error",
          retries,
          error: result.error,
        });

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setChunkStatus(chunkIndex, { status: "error", error: errorMsg });
        return { success: false, error: errorMsg };
      } finally {
        activeUploadsRef.current -= 1;
        if (activeUploadsRef.current === 0) {
          setIsUploading(false);
        }
      }
    },
    [serverUrl, setChunkStatus],
  );

  /**
   * Uploads a complete audio file (non-chunked).
   *
   * Steps:
   *  1. POST to {serverUrl}/upload/file with multipart form data.
   *  2. Returns the sessionId from the server response.
   */
  const uploadFile = useCallback(
    async (file: File): Promise<FileUploadResult> => {
      setIsUploading(true);
      activeUploadsRef.current += 1;

      try {
        const form = new FormData();
        form.append("file", file);
        form.append("fileName", file.name);

        const response = await fetchWithRetry(
          `${serverUrl}/upload/file`,
          { method: "POST", body: form },
          MAX_RETRIES,
          RETRY_BASE_MS,
        );

        const json = (await response.json()) as { sessionId?: string };
        return { success: true, sessionId: json.sessionId };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMsg };
      } finally {
        activeUploadsRef.current -= 1;
        if (activeUploadsRef.current === 0) {
          setIsUploading(false);
        }
      }
    },
    [serverUrl],
  );

  /**
   * Resets all chunk upload statuses and the uploading flag.
   */
  const reset = useCallback(() => {
    setStatuses(new Map());
    setIsUploading(false);
    activeUploadsRef.current = 0;
  }, []);

  return {
    uploadChunk,
    uploadFile,
    statuses,
    isUploading,
    reset,
  };
}
