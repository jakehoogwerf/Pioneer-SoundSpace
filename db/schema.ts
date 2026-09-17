import { pgTable, serial, text, integer, timestamp, uniqueIndex, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

type PlaylistSong = { id: string; title: string };

// The live playlist for each class. One row per class - the current
// PIT-in-time state that class.html reads and writes.
export const classPlaylists = pgTable("class_playlists", {
  className: text("class_name").primaryKey(),
  songs: jsonb("songs").$type<PlaylistSong[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Append-only history. Every time a playlist is saved, the PREVIOUS value
// is snapshotted here first, so nothing is ever unrecoverably overwritten -
// even an accidental blank save just becomes a new row here, and the prior
// row can be restored.
export const classPlaylistHistory = pgTable("class_playlist_history", {
  id: serial().primaryKey(),
  className: text("class_name").notNull(),
  songs: jsonb("songs").$type<PlaylistSong[]>().notNull(),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
}, (table) => [
  index("class_playlist_history_class_idx").on(table.className, table.changedAt),
]);
