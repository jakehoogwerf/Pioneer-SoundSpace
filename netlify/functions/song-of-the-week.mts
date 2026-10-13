import type { Config, Context } from '@netlify/functions'
import { sql } from 'drizzle-orm'
import { supabaseDb as db } from '../../db/supabase.js'

const ALLOWED_CLASSES = new Set([
  'kangaroos', 'bilby', 'swans', 'numbats',
  'bobtails', 'karak', 'wombats', 'PE',
])

// A device can add at most this many plays of the same song per week, and
// the same device can't count the same song twice within the dedupe window
// (that absorbs double-fires like a page reload restarting a song). Keeps
// one person mashing play from deciding the Song of the Week.
const MAX_PLAYS_PER_DEVICE_SONG_WEEK = 5
// Until the current week has at least this many plays in total, show last
// week's winner instead, so one accidental play isn't "Song of the Week".
const MIN_PLAYS_FOR_CURRENT_WEEK = 5

const NO_STORE = { 'Cache-Control': 'no-store' }

// Weeks run Monday-Sunday in Perth time (AWST, UTC+8, no daylight saving).
// Returns the Monday's date as YYYY-MM-DD, `offsetWeeks` weeks from now.
function perthWeekStart(offsetWeeks = 0): string {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000)
  const sinceMonday = (shifted.getUTCDay() + 6) % 7 // Sunday(0) -> 6, Monday(1) -> 0
  const monday = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - sinceMonday + offsetWeeks * 7,
  ))
  return monday.toISOString().slice(0, 10)
}

// db.execute() hands back the rows either directly or under `.rows`
// depending on the driver version - accept both.
function rowsOf(res: unknown): any[] {
  if (Array.isArray(res)) return res as any[]
  const r = (res as any)?.rows
  return Array.isArray(r) ? r : []
}

function normalizeSongs(value: unknown): { id: string; title: string }[] {
  let v: unknown = value
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
  return Array.isArray(v) ? (v as { id: string; title: string }[]) : []
}

function errorText(e: unknown): string {
  const parts: string[] = []
  let cur: any = e
  for (let i = 0; cur && i < 6; i++) {
    if (cur.message) parts.push(String(cur.message))
    if (cur.code) parts.push(String(cur.code))
    cur = cur.cause
  }
  return parts.join(' | ')
}

// Short, safe error codes - the full detail goes to the Netlify logs.
function classifyError(e: unknown): string {
  if (!process.env.SUPABASE_DB_URL) return 'missing_env'
  const text = errorText(e)
  if (/does not exist|42P01/i.test(text)) return 'table_missing'
  return 'unavailable'
}

type Top = { songId: string; title: string; plays: number; classes: number }

async function topSongs(weekStart: string, limit: number): Promise<Top[]> {
  const res = await db.execute(sql`
    select song_id,
           (array_agg(song_title order by played_at desc))[1] as title,
           count(*)::int as plays,
           count(distinct class_name)::int as classes
    from song_play_events
    where week_start = ${weekStart}
    group by song_id
    order by plays desc, max(played_at) desc
    limit ${limit}`)
  return rowsOf(res).map((r) => ({
    songId: String(r.song_id),
    title: String(r.title ?? 'YouTube Video'),
    plays: Number(r.plays),
    classes: Number(r.classes),
  }))
}

async function topClassFor(weekStart: string, songId: string): Promise<string | null> {
  const res = await db.execute(sql`
    select class_name, count(*)::int as n
    from song_play_events
    where week_start = ${weekStart} and song_id = ${songId}
    group by class_name
    order by n desc, class_name asc
    limit 1`)
  const row = rowsOf(res)[0]
  return row ? String(row.class_name) : null
}

export default async (req: Request, context: Context) => {
  const className = context.params.class
  const url = new URL(req.url)

  // ── GET /api/song-of-the-week ──────────────────────────────────────
  if (req.method === 'GET' && !className) {
    // GET /api/song-of-the-week?diag=1 - quick health check.
    if (url.searchParams.get('diag') === '1') {
      const report: Record<string, unknown> = {
        envConfigured: Boolean(process.env.SUPABASE_DB_URL),
        weekStart: perthWeekStart(0),
      }
      try {
        const res = await db.execute(sql`
          select count(*)::int as n from song_play_events where week_start = ${perthWeekStart(0)}`)
        report.tableOk = true
        report.playsRecordedThisWeek = Number(rowsOf(res)[0]?.n ?? 0)
        report.ok = true
      } catch (e) {
        console.error('song-of-the-week diag failed', e)
        report.ok = false
        report.code = classifyError(e)
      }
      return Response.json(report, { status: report.ok ? 200 : 503, headers: NO_STORE })
    }

    try {
      const currentStart = perthWeekStart(0)
      const previousStart = perthWeekStart(-1)

      let basis: 'current' | 'previous' | 'none' = 'none'
      let weekStart = currentStart
      let list = await topSongs(currentStart, 3)

      if (list.length && list[0].plays >= MIN_PLAYS_FOR_CURRENT_WEEK) {
        basis = 'current'
      } else {
        const previous = await topSongs(previousStart, 3)
        if (previous.length) { basis = 'previous'; weekStart = previousStart; list = previous }
        else if (list.length) { basis = 'current' }
      }

      if (basis === 'none' || !list.length) {
        return Response.json({ basis: 'none', winner: null, runnersUp: [] },
          { headers: { 'Cache-Control': 'public, max-age=60' } })
      }

      const topClass = await topClassFor(weekStart, list[0].songId)
      return Response.json(
        {
          basis,
          weekStart,
          winner: { ...list[0], topClass },
          runnersUp: list.slice(1).map((s) => ({ songId: s.songId, title: s.title, plays: s.plays })),
        },
        { headers: { 'Cache-Control': 'public, max-age=60' } },
      )
    } catch (e) {
      console.error('song-of-the-week GET failed', e)
      return Response.json({ error: classifyError(e) }, { status: 503, headers: NO_STORE })
    }
  }

  // ── POST /api/song-of-the-week/:class  { songId, clientId } ───────
  if (req.method === 'POST' && className) {
    if (!ALLOWED_CLASSES.has(className)) return new Response('Invalid class', { status: 400 })

    let body: any
    try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
    const songId = typeof body?.songId === 'string' ? body.songId.trim() : ''
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(songId)) return new Response('Invalid songId', { status: 400 })
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) return new Response('Invalid clientId', { status: 400 })

    try {
      // The title comes from the class's real playlist, never from the
      // request - so nobody can post made-up songs or titles to the board.
      const plRes = await db.execute(sql`
        select songs from class_playlists where class_name = ${className} limit 1`)
      const songs = normalizeSongs(rowsOf(plRes)[0]?.songs)
      const match = songs.find((s) => s && s.id === songId)
      if (!match) return Response.json({ ok: true, ignored: 'not_in_playlist' }, { headers: NO_STORE })
      const title = String(match.title || 'YouTube Video').slice(0, 300)

      const weekStart = perthWeekStart(0)

      const guard = await db.execute(sql`
        select count(*)::int as total,
               count(*) filter (where played_at > now() - interval '60 seconds')::int as recent
        from song_play_events
        where week_start = ${weekStart} and client_id = ${clientId} and song_id = ${songId}`)
      const g = rowsOf(guard)[0] ?? {}
      if (Number(g.recent) > 0) return Response.json({ ok: true, ignored: 'duplicate' }, { headers: NO_STORE })
      if (Number(g.total) >= MAX_PLAYS_PER_DEVICE_SONG_WEEK)
        return Response.json({ ok: true, ignored: 'device_limit' }, { headers: NO_STORE })

      await db.execute(sql`
        insert into song_play_events (week_start, class_name, song_id, song_title, client_id)
        values (${weekStart}, ${className}, ${songId}, ${title}, ${clientId})`)

      // Light housekeeping so the table can't grow forever: now and then,
      // drop plays older than ~4 months (far beyond what the board needs).
      if (Math.random() < 0.02) {
        try { await db.execute(sql`delete from song_play_events where played_at < now() - interval '120 days'`) }
        catch (e) { console.error('song-of-the-week cleanup failed', e) }
      }

      return Response.json({ ok: true }, { headers: NO_STORE })
    } catch (e) {
      console.error('song-of-the-week POST failed', e)
      return Response.json({ error: classifyError(e) }, { status: 503, headers: NO_STORE })
    }
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: ['/api/song-of-the-week', '/api/song-of-the-week/:class'],
  method: ['GET', 'POST'],
}
