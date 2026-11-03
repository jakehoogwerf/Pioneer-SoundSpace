CREATE TABLE "class_playlist_history" (
	"id" serial PRIMARY KEY,
	"class_name" text NOT NULL,
	"songs" jsonb NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_playlists" (
	"class_name" text PRIMARY KEY,
	"songs" jsonb DEFAULT '[]' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_backups" (
	"id" serial PRIMARY KEY,
	"snapshot_date" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "class_playlist_history_class_idx" ON "class_playlist_history" ("class_name","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_backups_date_idx" ON "daily_backups" ("snapshot_date");