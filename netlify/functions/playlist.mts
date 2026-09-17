import type { Config, Context } from '@netlify/functions'
import { supabaseDb } from '../../db/supabase.js'
import { classPlaylists, classPlaylistHistory } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

const ALLOWED_CLASSES = new Set([
  'kangaroos',
  'bilby',
  'swans',
  'numbats',
  'bobtails',
  'karak',
  'wombats',
  'PE',
])

type Song = { id: string; title: string }

function clean(input: unknown): Song[] {
  if (!Array.isArray(input)) return []
  const out: Song[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const rawId = (item as Record<string, unknown>).id
    if (typeof rawId !== 'string') continue
    const id = rawId.trim().slice(0, 32)
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    const rawTitle = (item as Record<string, unknown>).title
    const title =
      typeof rawTitle === 'string' && rawTitle.length > 0
        ? rawTitle.slice(0, 300)
        : 'YouTube Video'
    out.push({ id, title })
    if (out.length >= 500) break
  }
  return out
}

export default async (req: Request, context: Context) => {
  const className = context.params.class
  if (!className || !ALLOWED_CLASSES.has(className)) {
    return new Response('Invalid class', { status: 400 })
  }

  if (req.method === 'GET') {
    const rows = await supabaseDb
      .select()
      .from(classPlaylists)
      .where(eq(classPlaylists.className, className))
      .limit(1)
    const songs = rows[0]?.songs
    return Response.json(Array.isArray(songs) ? songs : [])
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }
    const cleaned = clean(body)

    // Safety net: never let a save that resolves to an empty playlist
    // silently wipe an existing, non-empty one. This is exactly how songs
    // got lost before - a stale/broken client saved an empty array over
    // real data with no warning. The admin "Clear Current Playlist" button
    // passes ?confirm=true to bypass this deliberately.
    const confirmed = new URL(req.url).searchParams.get('confirm') === 'true'
    if (cleaned.length === 0 && !confirmed) {
      const existingRows = await supabaseDb
        .select()
        .from(classPlaylists)
        .where(eq(classPlaylists.className, className))
        .limit(1)
      const existingSongs = existingRows[0]?.songs
      if (Array.isArray(existingSongs) && existingSongs.length > 0) {
        return new Response(
          'Refused: this would silently replace an existing playlist with an empty one. ' +
          'Use the admin "Clear Current Playlist" button to do this on purpose.',
          { status: 409 }
        )
      }
    }

    // Snapshot BEFORE it becomes the live value, so every save is
    // recoverable later via /api/playlist-history/:class.
    await supabaseDb.insert(classPlaylistHistory).values({
      className,
      songs: cleaned,
    })

    await supabaseDb
      .insert(classPlaylists)
      .values({ className, songs: cleaned, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: classPlaylists.className,
        set: { songs: cleaned, updatedAt: new Date() },
      })

    return Response.json(cleaned)
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/playlist/:class',
  method: ['GET', 'PUT', 'POST'],
}
