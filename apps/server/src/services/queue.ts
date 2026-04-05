import { Queue, Worker, type Job } from "bullmq";
import type { ConnectionOptions, Processor } from "bullmq";
import { env } from "@my-better-t-app/env/server";

export interface TranscriptionJobData {
  sessionId: string;
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 2000,
  },
} as const;

function parseRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const connection: ConnectionOptions = {
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : 6379,
  };

  if (url.password) {
    (connection as Record<string, unknown>).password = url.password;
  }

  if (url.username && url.username !== "default") {
    (connection as Record<string, unknown>).username = url.username;
  }

  if (url.protocol === "rediss:") {
    (connection as Record<string, unknown>).tls = {};
  }

  return connection;
}

const connection = parseRedisConnection(env.REDIS_URL);

export const transcriptionQueue = new Queue<TranscriptionJobData>(
  "transcription",
  { connection }
);

export function createTranscriptionWorker(
  processor: Processor<TranscriptionJobData>
): Worker<TranscriptionJobData> {
  return new Worker<TranscriptionJobData>("transcription", processor, {
    connection,
  });
}

export async function enqueueTranscription(
  sessionId: string
): Promise<Job<TranscriptionJobData>> {
  if (!sessionId) {
    throw new Error("sessionId is required to enqueue transcription job");
  }

  return transcriptionQueue.add(
    `transcribe-${sessionId}`,
    { sessionId },
    DEFAULT_JOB_OPTIONS
  );
}
