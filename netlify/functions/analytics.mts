import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { songPlays } from "../../db/schema.js";
import { eq, sql, desc } from "drizzle-orm";

const ALLOWED_CLASSES = new Set([
  "kangaroos",
  "bilby",
  "swans",
  "numbats",
  "bobtails",
  "karak",
  "wombats",
  "PE",
]);

export default async (req: Request, context: Context) => {
  if (req.method === "POST") {
    let body: { class: string; songId: string; songTitle?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const className = body.class;
    const songId = body.songId;
    const songTitle = body.songTitle || "YouTube Video";

    if (!className || !ALLOWED_CLASSES.has(className)) {
      return new Response("Invalid class", { status: 400 });
    }
    if (!songId || typeof songId !== "string") {
      return new Response("Invalid songId", { status: 400 });
    }

    await db
      .insert(songPlays)
      .values({
        className,
        songId: songId.slice(0, 32),
        songTitle: songTitle.slice(0, 300),
        playCount: 1,
        lastPlayedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [songPlays.className, songPlays.songId],
        set: {
          playCount: sql`${songPlays.playCount} + 1`,
          songTitle: songTitle.slice(0, 300),
          lastPlayedAt: new Date(),
        },
      });

    return Response.json({ ok: true });
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const classFilter = url.searchParams.get("class");

    if (classFilter && !ALLOWED_CLASSES.has(classFilter)) {
      return new Response("Invalid class", { status: 400 });
    }

    if (classFilter) {
      const rows = await db
        .select()
        .from(songPlays)
        .where(eq(songPlays.className, classFilter))
        .orderBy(desc(songPlays.playCount))
        .limit(100);
      return Response.json(rows);
    }

    const rows = await db
      .select()
      .from(songPlays)
      .orderBy(desc(songPlays.playCount))
      .limit(200);
    return Response.json(rows);
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/analytics",
  method: ["GET", "POST"],
};
