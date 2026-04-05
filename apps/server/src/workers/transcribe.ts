import type { Job } from "bullmq";
import { db } from "@my-better-t-app/db";
import { sessions } from "@my-better-t-app/db/schema/sessions";
import { transcripts } from "@my-better-t-app/db/schema/transcripts";
import { eq } from "drizzle-orm";
import {
  createMinioClient,
  listChunks,
  getChunk,
  ensureBucket,
} from "../services/minio";
import {
  transcribeWithGroq,
  diarizeAudio,
  alignTranscriptionWithSpeakers,
  type GroqTranscriptionResult,
  type GroqWord,
} from "../services/transcription";
import {
  createTranscriptionWorker,
  type TranscriptionJobData,
} from "../services/queue";
import { env } from "@my-better-t-app/env/server";

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const GROQ_MAX_BYTES = 25 * 1024 * 1024;       // 25 MB
const SEGMENT_OVERLAP_SECONDS = 5;              // overlap between splits

// --------------------------------------------------------------------------
// WAV helpers
// --------------------------------------------------------------------------

/**
 * Concatenates multiple WAV buffers by keeping the header of the first file
 * and appending the raw PCM data from all subsequent files.
 */
function concatenateWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) {
    throw new Error("No buffers provided to concatenate");
  }
  if (buffers.length === 1) {
    return buffers[0] as Buffer;
  }

  // WAV header is 44 bytes; data starts after that.
  const HEADER_SIZE = 44;
  const firstBuffer = buffers[0] as Buffer;
  const header = firstBuffer.subarray(0, HEADER_SIZE);

  const pcmChunks: Buffer[] = buffers.map((buf) =>
    buf.subarray(HEADER_SIZE)
  );
  const totalPcmSize = pcmChunks.reduce((sum, b) => sum + b.length, 0);

  // Update the RIFF chunk size and data chunk size in the header copy
  const newHeader = Buffer.from(header);
  const totalSize = HEADER_SIZE + totalPcmSize;
  newHeader.writeUInt32LE(totalSize - 8, 4);          // ChunkSize
  newHeader.writeUInt32LE(totalPcmSize, 40);          // Subchunk2Size

  return Buffer.concat([newHeader, ...pcmChunks]);
}

/**
 * Reads WAV metadata to compute duration in samples/seconds.
 * Returns sample rate and bits per sample from the header.
 */
function readWavMetadata(buffer: Buffer): {
  sampleRate: number;
  bitsPerSample: number;
  numChannels: number;
  bytesPerSample: number;
} {
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const numChannels = buffer.readUInt16LE(22);
  const bytesPerSample = (bitsPerSample / 8) * numChannels;
  return { sampleRate, bitsPerSample, numChannels, bytesPerSample };
}

/**
 * Splits a WAV buffer into segments of at most maxBytes, with overlapSeconds
 * of overlap between adjacent segments.
 */
function splitWavBuffer(
  buffer: Buffer,
  maxBytes: number,
  overlapSeconds: number
): { segment: Buffer; offsetSeconds: number }[] {
  const HEADER_SIZE = 44;
  const { sampleRate, bytesPerSample } = readWavMetadata(buffer);

  const pcmData = buffer.subarray(HEADER_SIZE);
  const bytesPerSecond = sampleRate * bytesPerSample;
  const overlapBytes = Math.floor(overlapSeconds * bytesPerSecond);

  // Usable PCM bytes per segment (leaving room for header)
  const maxPcmPerSegment = maxBytes - HEADER_SIZE;
  const stepBytes = maxPcmPerSegment - overlapBytes;

  if (stepBytes <= 0) {
    throw new Error("maxBytes too small to accommodate WAV header + overlap");
  }

  const header = buffer.subarray(0, HEADER_SIZE);
  const segments: { segment: Buffer; offsetSeconds: number }[] = [];
  let offset = 0;

  while (offset < pcmData.length) {
    const end = Math.min(offset + maxPcmPerSegment, pcmData.length);
    const pcmSlice = pcmData.subarray(offset, end);

    const segHeader = Buffer.from(header);
    segHeader.writeUInt32LE(HEADER_SIZE + pcmSlice.length - 8, 4);
    segHeader.writeUInt32LE(pcmSlice.length, 40);

    const segment = Buffer.concat([segHeader, pcmSlice]);
    const offsetSeconds = offset / bytesPerSecond;
    segments.push({ segment, offsetSeconds });

    offset += stepBytes;
    if (end === pcmData.length) break;
  }

  return segments;
}

// --------------------------------------------------------------------------
// Segment merging (deduplicate overlapping words)
// --------------------------------------------------------------------------

/**
 * Merge transcription results from multiple overlapping segments.
 * Deduplicates words that fall in the overlap zone by taking the earlier
 * instance and discarding any word from a later segment whose start time
 * is within the final word of the previous segment's end time.
 */
function mergeTranscriptionSegments(
  results: { result: GroqTranscriptionResult; offsetSeconds: number }[]
): GroqTranscriptionResult {
  const allWords: GroqWord[] = [];
  let lastWordEnd = -Infinity;

  for (const { result, offsetSeconds } of results) {
    const adjusted = result.words.map((w) => ({
      word: w.word,
      start: w.start + offsetSeconds,
      end: w.end + offsetSeconds,
    }));

    for (const word of adjusted) {
      // Skip words that start before the last accepted word ends (overlap zone)
      if (word.start < lastWordEnd) continue;
      allWords.push(word);
      lastWordEnd = word.end;
    }
  }

  const mergedText = allWords.map((w) => w.word).join(" ").trim();
  return { text: mergedText, segments: [], words: allWords };
}

// --------------------------------------------------------------------------
// Helper: download a MinIO object as Buffer
// --------------------------------------------------------------------------

async function downloadAsBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks);
}

// --------------------------------------------------------------------------
// Worker processor
// --------------------------------------------------------------------------

async function processTranscriptionJob(
  job: Job<TranscriptionJobData>
): Promise<void> {
  const { sessionId } = job.data;

  if (!sessionId) {
    throw new Error("Job data missing sessionId");
  }

  // 1. Fetch session and verify status
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const session = sessionRows[0];
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const validStatuses: string[] = ["idle", "recording", "uploading", "completed", "error"];
  if (!validStatuses.includes(session.status)) {
    throw new Error(
      `Session ${sessionId} has unexpected status "${session.status}". Expected one of: ${validStatuses.join(", ")}`
    );
  }

  // 2. Update session status → "transcribing"
  await db
    .update(sessions)
    .set({ status: "transcribing" })
    .where(eq(sessions.id, sessionId));

  try {
    const client = createMinioClient();
    const bucket = env.MINIO_BUCKET;
    await ensureBucket(client, bucket);

    // 3. List and download files from MinIO
    const chunkKeys = await listChunks(client, bucket, sessionId);
    if (chunkKeys.length === 0) {
      throw new Error(`No files found in MinIO for session ${sessionId}`);
    }

    let fullAudio: Buffer;
    let audioFileName: string;
    const isFileUpload = session.sourceType === "upload";

    if (isFileUpload) {
      // File upload: single file like {sessionId}/original.mp3
      const fileKey = chunkKeys[0] as string;
      const ext = fileKey.split(".").pop() ?? "mp3";
      audioFileName = `session_${sessionId}.${ext}`;
      const stream = await getChunk(client, bucket, fileKey);
      fullAudio = await downloadAsBuffer(stream);
    } else {
      // Mic recording: multiple WAV chunks like {sessionId}/0.wav, {sessionId}/1.wav
      const wavBuffers: Buffer[] = [];
      for (const key of chunkKeys) {
        const stream = await getChunk(client, bucket, key);
        const buffer = await downloadAsBuffer(stream);
        wavBuffers.push(buffer);
      }
      fullAudio = concatenateWavBuffers(wavBuffers);
      audioFileName = `session_${sessionId}.wav`;
    }

    // 4. Transcribe with Groq — split if > 25 MB (only for WAV mic recordings)
    let transcriptionResult: GroqTranscriptionResult;

    if (!isFileUpload && fullAudio.length > GROQ_MAX_BYTES) {
      const segments = splitWavBuffer(fullAudio, GROQ_MAX_BYTES, SEGMENT_OVERLAP_SECONDS);

      const segmentResults: { result: GroqTranscriptionResult; offsetSeconds: number }[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg) continue;
        const result = await transcribeWithGroq(seg.segment, `segment_${i}.wav`);
        segmentResults.push({ result, offsetSeconds: seg.offsetSeconds });
      }

      transcriptionResult = mergeTranscriptionSegments(segmentResults);
    } else {
      // Single call — works for both small WAV and direct file uploads (mp3, etc.)
      transcriptionResult = await transcribeWithGroq(fullAudio, audioFileName);
    }

    // 5. Diarize full audio (skip if sidecar not available — use single speaker)
    const diarizationResult = await diarizeAudio(fullAudio);

    // 6. Align transcription with speaker diarization
    const alignedSegments = alignTranscriptionWithSpeakers(
      transcriptionResult,
      diarizationResult
    );

    // 10. Store transcript segments in Postgres
    if (alignedSegments.length > 0) {
      await db.insert(transcripts).values(
        alignedSegments.map((seg) => ({
          sessionId,
          speakerId: seg.speakerId,
          startTime: seg.startTime,
          endTime: seg.endTime,
          content: seg.content,
          confidence: seg.confidence ?? null,
        }))
      );
    }

    // 11. Update session status → "completed"
    await db
      .update(sessions)
      .set({ status: "completed" })
      .where(eq(sessions.id, sessionId));
  } catch (error) {
    // On error: update session status → "error" with errorMessage
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    await db
      .update(sessions)
      .set({
        status: "error",
        errorMessage,
      })
      .where(eq(sessions.id, sessionId));

    throw error; // Re-throw so BullMQ records the failure and retries
  }
}

// --------------------------------------------------------------------------
// Worker export
// --------------------------------------------------------------------------

export const transcriptionWorker = createTranscriptionWorker(
  processTranscriptionJob
);
