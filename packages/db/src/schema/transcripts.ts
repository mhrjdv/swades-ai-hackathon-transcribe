import { pgTable, uuid, integer, real, text, timestamp, index } from "drizzle-orm/pg-core";
import { sessions } from "./sessions";

export const transcripts = pgTable("transcripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  speakerId: integer("speaker_id").notNull(),
  startTime: real("start_time").notNull(),
  endTime: real("end_time").notNull(),
  content: text("content").notNull(),
  confidence: real("confidence"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("transcripts_session_time_idx").on(table.sessionId, table.startTime),
]);
