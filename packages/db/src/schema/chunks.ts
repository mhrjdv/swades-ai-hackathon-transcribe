import { pgTable, uuid, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { chunkStatusEnum } from "./enums";
import { sessions } from "./sessions";

export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  bucketKey: text("bucket_key").notNull(),
  durationMs: integer("duration_ms").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  checksum: text("checksum").notNull(),
  status: chunkStatusEnum("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("chunks_session_index_unique").on(table.sessionId, table.index),
  index("chunks_session_status_idx").on(table.sessionId, table.status),
]);
