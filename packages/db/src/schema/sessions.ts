import { pgTable, uuid, integer, bigint, text, timestamp } from "drizzle-orm/pg-core";
import { sessionStatusEnum, sourceTypeEnum } from "./enums";

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: sessionStatusEnum("status").notNull().default("idle"),
  sourceType: sourceTypeEnum("source_type").notNull().default("mic"),
  totalChunks: integer("total_chunks"),
  totalDurationMs: bigint("total_duration_ms", { mode: "number" }),
  fileName: text("file_name"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
});
