import type { Config, Context } from '@netlify/functions'
import { eq } from 'drizzle-orm'
import { classPlaylists, classPlaylistHistory } from '../../db/schema.js'
import { supabaseDb as db, supabaseInitError } from '../../db/supabase.js'

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

const NO_STORE = { 'Cache-Control': 'no-store' }

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

// jsonb normally comes back as a real array, but be forgiving: if a driver
// ever hands it back as a JSON *string* instead, recover the songs rather
// than treating the playlist as empty (which would look like a deletion).
function normalizeSongs(value: unknown): Song[] {
  let v: unknown = value
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { return [] }
  }
  return Array.isArray(v) ? (v as Song[]) : []
}

// Walks the error's cause chain (drizzle wraps the real database error).
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

// Classifies a failure into a short, safe code. Deliberately does NOT echo
// the raw error back to the browser (it can contain hostnames / queries) -
// the full detail goes to the Netlify function logs instead.
function classifyError(e: unknown): { code: string; hint: string } {
  const text = errorText(e)
  if (!process.env.SUPABASE_DB_URL)
    return { code: 'missing_env', hint: 'SUPABASE_DB_URL is not set for this function. Add it under Netlify > Site configuration > Environment variables (scope: Functions), then redeploy.' }
  if (supabaseInitError)
    return { code: 'bad_connection_string', hint: 'SUPABASE_DB_URL is not a valid connection string. If the database password contains characters like @ # / ? : they must be URL-encoded (e.g. @ becomes %40), or reset the password to letters and numbers only.' }
  if (/Tenant or user not found/i.test(text))
    return { code: 'bad_username', hint: 'The pooler did not recognise the username. Copy the Transaction pooler string exactly as Supabase shows it - the user looks like postgres.<project-ref>, not just postgres.' }
  if (/password authentication failed|authentication failed|28P01|28000/i.test(text))
    return { code: 'auth_failed', hint: 'The database rejected the password in SUPABASE_DB_URL. Reset the database password in Supabase and update the variable.' }
  if (/ENETUNREACH|EHOSTUNREACH|network is unreachable/i.test(text))
    return { code: 'network_unreachable', hint: 'Netlify cannot reach that host (typically the "Direct connection" string, which is IPv6-only). Use the Transaction pooler string instead.' }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|CONNECT_TIMEOUT|CONNECTION_CLOSED|CONNECTION_ENDED|getaddrinfo|timeout/i.test(text))
    return { code: 'connection_failed', hint: 'Could not reach the database host in SUPABASE_DB_URL. Check the host and port, and that the Supabase project is not paused.' }
  if (/does not exist|42P01/i.test(text))
    return { code: 'table_missing', hint: 'A required table has not been created in this Supabase project yet. Run supabase-setup.sql in the SQL Editor of the SAME project the connection string points to.' }
  return { code: 'unknown', hint: 'See the Netlify function logs for the full error.' }
}

export default async (req: Request, context: Context) => {
  const className = context.params.class
  if (!className || !ALLOWED_CLASSES.has(className)) {
    return new Response('Invalid class', { status: 400 })
  }
  const url = new URL(req.url)

  // ── Diagnostic mode: GET /api/playlist/<class>?diag=1 ──────────────
  // Reports whether the save/load pipeline is healthy, and if not, which
  // step is failing. Only booleans / counts / short codes - no secrets.
  if (req.method === 'GET' && url.searchParams.get('diag') === '1') {
    const report: Record<string, unknown> = {
      class: className,
      envConfigured: Boolean(process.env.SUPABASE_DB_URL),
    }
    try {
      const rows = await db
        .select()
        .from(classPlaylists)
        .where(eq(classPlaylists.className, className))
        .limit(1)
      const raw: unknown = rows[0]?.songs
      report.connected = true
      report.rowExists = rows.length > 0
      report.storedValueType = Array.isArray(raw) ? 'array' : raw == null ? 'none' : typeof raw
      report.songCount = normalizeSongs(raw).length
      report.lastUpdated = rows[0]?.updatedAt ?? null
      try {
        await db.select({ id: classPlaylistHistory.id }).from(classPlaylistHistory).limit(1)
        report.historyTableOk = true
      } catch (e) {
        report.historyTableOk = false
        console.error('playlist diag: history table check failed', e)
      }
      report.ok = true
    } catch (e) {
      console.error('playlist diag failed', e)
      report.ok = false
      Object.assign(report, classifyError(e))
    }
    return Response.json(report, { status: report.ok ? 200 : 503, headers: NO_STORE })
  }

  if (req.method === 'GET') {
    try {
      const rows = await db
        .select()
        .from(classPlaylists)
        .where(eq(classPlaylists.className, className))
        .limit(1)
      return Response.json(normalizeSongs(rows[0]?.songs), { headers: NO_STORE })
    } catch (e) {
      console.error('playlist GET failed', e)
      return Response.json({ error: classifyError(e).code }, { status: 503, headers: NO_STORE })
    }
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
    // silently wipe an existing, non-empty one. The admin "Clear Current
    // Playlist" button (and deleting the very last song) pass
    // ?confirm=true to do this deliberately.
    const confirmed = url.searchParams.get('confirm') === 'true'

    try {

      if (cleaned.length === 0 && !confirmed) {
        const existingRows = await db
          .select()
          .from(classPlaylists)
          .where(eq(classPlaylists.className, className))
          .limit(1)
        if (normalizeSongs(existingRows[0]?.songs).length > 0) {
          return new Response(
            'Refused: this would silently replace an existing playlist with an empty one.',
            { status: 409 }
          )
        }
      }

      // The live playlist is what matters most, so save it first.
      await db
        .insert(classPlaylists)
        .values({ className, songs: cleaned, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: classPlaylists.className,
          set: { songs: cleaned, updatedAt: new Date() },
        })

      // History is a best-effort undo trail. If it ever fails (for example
      // the table is missing) that must NOT stop a real save from landing.
      try {
        await db.insert(classPlaylistHistory).values({ className, songs: cleaned })
      } catch (e) {
        console.error('playlist history insert failed (save still succeeded)', e)
      }

      return Response.json(cleaned, { headers: NO_STORE })
    } catch (e) {
      console.error('playlist save failed', e)
      return Response.json({ error: classifyError(e).code }, { status: 503, headers: NO_STORE })
    }
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/playlist/:class',
  method: ['GET', 'PUT', 'POST'],
}
