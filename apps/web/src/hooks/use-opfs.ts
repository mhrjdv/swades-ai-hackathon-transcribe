"use client";

import { useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OPFSManifestChunk {
  index: number;
  size: number;
  checksum: string;
  acked: boolean;
}

export interface OPFSManifest {
  sessionId: string;
  chunks: OPFSManifestChunk[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const MANIFEST_FILENAME = "manifest.json";

/**
 * Returns the OPFS root directory, or throws if OPFS is not available.
 */
async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== "function"
  ) {
    throw new Error(
      "Origin Private File System (OPFS) is not available in this environment.",
    );
  }
  return navigator.storage.getDirectory();
}

/**
 * Gets (and optionally creates) the directory for a session.
 */
async function getSessionDir(
  sessionId: string,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  const root = await getOPFSRoot();
  return root.getDirectoryHandle(sessionId, { create });
}

/**
 * Writes raw bytes to a file inside a directory, replacing any existing
 * content.
 */
async function writeFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
  data: ArrayBuffer | string,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  // createSyncAccessHandle is only available in dedicated workers; use the
  // async writable stream here (available in the main thread).
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

/**
 * Reads raw bytes from a file inside a directory.
 * Returns null if the file does not exist.
 */
async function readFileBytes(
  dir: FileSystemDirectoryHandle,
  filename: string,
): Promise<ArrayBuffer | null> {
  try {
    const fileHandle = await dir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return file.arrayBuffer();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOPFS() {
  /**
   * Writes a WAV chunk blob to OPFS under /{sessionId}/{chunkIndex}.wav
   * and updates the manifest entry for that chunk.
   */
  const writeChunk = useCallback(
    async (
      sessionId: string,
      chunkIndex: number,
      blob: Blob,
      checksum: string,
    ): Promise<void> => {
      const dir = await getSessionDir(sessionId);
      const buffer = await blob.arrayBuffer();
      await writeFile(dir, `${chunkIndex}.wav`, buffer);

      // Update manifest: add or update the chunk entry.
      const existing = await readManifest(sessionId);
      const prevChunks = existing?.chunks ?? [];
      const filtered = prevChunks.filter((c) => c.index !== chunkIndex);
      const newEntry: OPFSManifestChunk = {
        index: chunkIndex,
        size: buffer.byteLength,
        checksum,
        acked: false,
      };
      const newManifest: OPFSManifest = {
        sessionId,
        chunks: [...filtered, newEntry].sort((a, b) => a.index - b.index),
        createdAt: existing?.createdAt ?? Date.now(),
      };
      await writeFile(dir, MANIFEST_FILENAME, JSON.stringify(newManifest));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Reads a chunk blob from OPFS. Returns null if it does not exist.
   */
  const readChunk = useCallback(
    async (sessionId: string, chunkIndex: number): Promise<Blob | null> => {
      try {
        const dir = await getSessionDir(sessionId, false);
        const buffer = await readFileBytes(dir, `${chunkIndex}.wav`);
        if (buffer === null) return null;
        return new Blob([buffer], { type: "audio/wav" });
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Reads the session manifest. Returns null if it does not exist.
   */
  const readManifest = useCallback(
    async (sessionId: string): Promise<OPFSManifest | null> => {
      try {
        const dir = await getSessionDir(sessionId, false);
        const buffer = await readFileBytes(dir, MANIFEST_FILENAME);
        if (buffer === null) return null;
        const text = new TextDecoder().decode(buffer);
        return JSON.parse(text) as OPFSManifest;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Persists a manifest object to OPFS, overwriting the existing one.
   */
  const updateManifest = useCallback(
    async (sessionId: string, manifest: OPFSManifest): Promise<void> => {
      const dir = await getSessionDir(sessionId);
      await writeFile(dir, MANIFEST_FILENAME, JSON.stringify(manifest));
    },
    [],
  );

  /**
   * Marks a specific chunk as acknowledged in the manifest.
   */
  const markChunkAcked = useCallback(
    async (sessionId: string, chunkIndex: number): Promise<void> => {
      const manifest = await readManifest(sessionId);
      if (!manifest) return;

      const updatedChunks = manifest.chunks.map((c) =>
        c.index === chunkIndex ? { ...c, acked: true } : c,
      );
      const updatedManifest: OPFSManifest = {
        ...manifest,
        chunks: updatedChunks,
      };
      await updateManifest(sessionId, updatedManifest);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Removes ALL files (chunks + manifest) for a session and deletes the
   * session directory from OPFS.
   */
  const clearSession = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const root = await getOPFSRoot();
      await root.removeEntry(sessionId, { recursive: true });
    } catch {
      // Directory may not exist — treat as a no-op.
    }
  }, []);

  /**
   * Removes only the chunks that are marked as acked in the manifest and
   * rewrites the manifest to reflect the deletions.
   */
  const clearAckedChunks = useCallback(
    async (sessionId: string): Promise<void> => {
      const manifest = await readManifest(sessionId);
      if (!manifest) return;

      const dir = await getSessionDir(sessionId, false);
      const remainingChunks: OPFSManifestChunk[] = [];

      for (const chunk of manifest.chunks) {
        if (chunk.acked) {
          try {
            await dir.removeEntry(`${chunk.index}.wav`);
          } catch {
            // File may already be gone — ignore.
          }
        } else {
          remainingChunks.push(chunk);
        }
      }

      const updatedManifest: OPFSManifest = {
        ...manifest,
        chunks: remainingChunks,
      };
      await updateManifest(sessionId, updatedManifest);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Returns the list of session IDs (directory names) currently in OPFS.
   */
  const listSessions = useCallback(async (): Promise<string[]> => {
    try {
      const root = await getOPFSRoot();
      const sessions: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iter = (root as any).entries() as AsyncIterableIterator<[string, FileSystemHandle]>;
      let entry = await iter.next();
      while (!entry.done) {
        const [name, handle] = entry.value;
        if (handle.kind === "directory") {
          sessions.push(name);
        }
        entry = await iter.next();
      }
      return sessions;
    } catch {
      return [];
    }
  }, []);

  return {
    writeChunk,
    readChunk,
    readManifest,
    updateManifest,
    markChunkAcked,
    clearSession,
    clearAckedChunks,
    listSessions,
  };
}
