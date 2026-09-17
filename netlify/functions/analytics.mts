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
  const pathClass = context.params.class;

  if (req.method === "POST") {
    let body: { class?: string; songId: string; songTitle?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Prefer the class from the URL (/api/analytics/:class); fall back to
    // a class field in the body for older callers.
    const className = pathClass || body.class;
    const songId = body.songId;
    const songTitle = body.songTitle || "YouTube Video";

    if (!className ||
