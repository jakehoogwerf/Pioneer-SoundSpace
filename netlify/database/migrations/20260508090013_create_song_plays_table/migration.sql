CREATE TABLE "song_plays" (
	"id" serial PRIMARY KEY,
	"class_name" text NOT NULL,
	"song_id" text NOT NULL,
	"song_title" text DEFAULT 'YouTube Video' NOT NULL,
	"play_count" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "song_plays_class_song_idx" ON "song_plays" ("class_name","song_id");