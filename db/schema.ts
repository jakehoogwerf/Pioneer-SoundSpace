import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const songPlays = pgTable("song_plays", {
  id: serial().primaryKey(),
  className: text("class_name").notNull(),
  songId: text("song_id").notNull(),
  songTitle: text("song_title").notNull().default("YouTube Video"),
  playCount: integer("play_count").notNull().default(0),
  lastPlayedAt: timestamp("last_played_at").defaultNow(),
}, (table) => [
  uniqueIndex("song_plays_class_song_idx").on(table.className, table.songId),
]);
