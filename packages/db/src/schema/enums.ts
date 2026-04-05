import { pgEnum } from "drizzle-orm/pg-core";

export const sessionStatusEnum = pgEnum("session_status", [
  "idle", "recording", "uploading", "transcribing", "completed", "error"
]);

export const sourceTypeEnum = pgEnum("source_type", ["mic", "upload"]);

export const chunkStatusEnum = pgEnum("chunk_status", [
  "pending", "uploaded", "acked", "error"
]);
