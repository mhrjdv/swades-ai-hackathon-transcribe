import { Hono } from "hono";
import { env } from "@my-better-t-app/env/server";
import { db } from "@my-better-t-app/db";
import { chunks } from "@my-better-t-app/db/schema/chunks";
import { sessions } from "@my-better-t-app/db/schema/sessions";
import { eq, and } from "drizzle-orm";
import { createMinioClient, uploadChunk, ensureBucket } from "../services/minio";

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const CHUNK_MAX_SIZE_BYTES = 500 * 1024 * 1024;  // 500 MB
const FILE_MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) return "bin";
  return fileName.slice(lastDot + 1).toLowerCase();
}

async function computeSha256Hex(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --------------------------------------------------------------------------
// Routes
// --------------------------------------------------------------------------

const uploadRoutes = new Hono();

/**
 * POST /upload/chunk
 *
 * Multipart fields:
 *   - sessionId  (string, UUID)
 *   - chunkIndex (string, integer)
 *   - checksum   (string, hex SHA-256)
 *   - file       (File / Blob — WAV audio)
 */
uploadRoutes.post("/upload/chunk", async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ success: false, error: "Invalid multipart form data" }, 400);
  }

  const sessionId = formData.get("sessionId");
  const chunkIndexRaw = formData.get("chunkIndex");
  const checksum = formData.get("checksum");
  const file = formData.get("file");

  // Validate required fields
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    typeof chunkIndexRaw !== "string" ||
    typeof checksum !== "string" ||
    !checksum ||
    !(file && typeof (file as Blob).arrayBuffer === "function")
  ) {
    return c.json(
      { success: false, error: "Missing or invalid required fields: sessionId, chunkIndex, checksum, file" },
      400
    );
  }

  const chunkIndex = parseInt(chunkIndexRaw, 10);
  if (isNaN(chunkIndex) || chunkIndex < 0) {
    return c.json({ success: false, error: "chunkIndex must be a non-negative integer" }, 400);
  }

  const fileBlob = file as Blob;

  // Size guard
  if (fileBlob.size > CHUNK_MAX_SIZE_BYTES) {
    return c.json({ success: false, error: "Chunk exceeds maximum size of 500 MB" }, 413);
  }

  // Read file bytes
  const arrayBuffer = await fileBlob.arrayBuffer();

  // Verify SHA-256 checksum
  const computedChecksum = await computeSha256Hex(arrayBuffer);
  if (computedChecksum !== checksum) {
    return c.json(
      {
        success: false,
        error: "Checksum mismatch",
        expected: checksum,
        received: computedChecksum,
      },
      400
    );
  }

  const bucket = env.MINIO_BUCKET;
  const bucketKey = `${sessionId}/${chunkIndex}.wav`;
  const fileBuffer = Buffer.from(arrayBuffer);

  try {
    const client = createMinioClient();
    await ensureBucket(client, bucket);
    await uploadChunk(client, bucket, bucketKey, fileBuffer);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: `Storage upload failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      502
    );
  }

  // Upsert chunk record in Postgres
  let chunkRecord: { id: string };
  try {
    const existingChunks = await db
      .select({ id: chunks.id })
      .from(chunks)
      .where(
        and(
          eq(chunks.sessionId, sessionId),
          eq(chunks.index, chunkIndex)
        )
      )
      .limit(1);

    if (existingChunks.length > 0) {
      const existing = existingChunks[0];
      if (!existing) {
        throw new Error("Unexpected empty result from database query");
      }
      await db
        .update(chunks)
        .set({ status: "acked", bucketKey, checksum })
        .where(eq(chunks.id, existing.id));
      chunkRecord = { id: existing.id };
    } else {
      const inserted = await db
        .insert(chunks)
        .values({
          sessionId,
          index: chunkIndex,
          bucketKey,
          checksum,
          durationMs: 0,
          sizeBytes: fileBlob.size,
          status: "acked",
        })
        .returning({ id: chunks.id });

      const first = inserted[0];
      if (!first) {
        throw new Error("Insert returned no rows");
      }
      chunkRecord = { id: first.id };
    }
  } catch (error) {
    return c.json(
      {
        success: false,
        error: `Database error: ${error instanceof Error ? error.message : String(error)}`,
      },
      500
    );
  }

  return c.json({ success: true, chunkId: chunkRecord.id, bucketKey });
});

/**
 * POST /upload/file
 *
 * Multipart fields:
 *   - file      (File — any audio format)
 *   - fileName  (string, optional override)
 */
uploadRoutes.post("/upload/file", async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ success: false, error: "Invalid multipart form data" }, 400);
  }

  const fileField = formData.get("file");
  const fileNameOverride = formData.get("fileName");

  if (!(fileField && typeof (fileField as Blob).arrayBuffer === "function")) {
    return c.json({ success: false, error: "Missing or invalid required field: file" }, 400);
  }

  const uploadBlob = fileField as File;

  // Size guard
  if (uploadBlob.size > FILE_MAX_SIZE_BYTES) {
    return c.json({ success: false, error: "File exceeds maximum size of 5 GB" }, 413);
  }

  const resolvedFileName =
    typeof fileNameOverride === "string" && fileNameOverride
      ? fileNameOverride
      : "name" in uploadBlob
      ? (uploadBlob as File).name
      : "audio.bin";

  const ext = getFileExtension(resolvedFileName);

  // Create session record first
  let sessionId: string;
  try {
    const inserted = await db
      .insert(sessions)
      .values({
        sourceType: "upload",
        status: "uploading",
        fileName: resolvedFileName,
        fileSizeBytes: uploadBlob.size,
      })
      .returning({ id: sessions.id });

    const first = inserted[0];
    if (!first) {
      throw new Error("Session insert returned no rows");
    }
    sessionId = first.id;
  } catch (error) {
    return c.json(
      {
        success: false,
        error: `Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
      },
      500
    );
  }

  const bucket = env.MINIO_BUCKET;
  const bucketKey = `${sessionId}/original.${ext}`;

  try {
    const arrayBuffer = await uploadBlob.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const client = createMinioClient();
    await ensureBucket(client, bucket);
    await uploadChunk(client, bucket, bucketKey, fileBuffer);
  } catch (error) {
    // Mark session as error if upload fails
    try {
      await db
        .update(sessions)
        .set({
          status: "error",
          errorMessage: `Storage upload failed: ${error instanceof Error ? error.message : String(error)}`,
        })
        .where(eq(sessions.id, sessionId));
    } catch {
      // Best-effort session error update — log but don't mask the original error
    }

    return c.json(
      {
        success: false,
        error: `Storage upload failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      502
    );
  }

  // Update session with completed upload metadata
  try {
    await db
      .update(sessions)
      .set({ status: "uploading" })
      .where(eq(sessions.id, sessionId));
  } catch {
    // Non-fatal: session is created and file is stored; status update failure is acceptable
  }

  return c.json({ success: true, sessionId });
});

export { uploadRoutes };
