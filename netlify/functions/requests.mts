import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const ALLOWED_CLASSES = new Set([
  'kangaroos', 'bilby', 'swans', 'numbats',
  'bobtails', 'karak', 'wombats', 'PE',
])

// A student can submit at most one new request every 25 seconds (slightly
// under the 30s client-side hint, to allow for clock/network drift), and a
// class can only have this many un-actioned requests queued at once. Both
// are enforced here, server-side - the client's own cooldown is just a
// friendly hint and was previously the *only* protection, which meant
// refreshing the page reset it.
const REQUEST_COOLDOWN_MS = 25000
const MAX_PENDING_PER_CLASS = 30

type SongRequest = {
  id: number
  text: string
  ts: string
  done: boolean
  clientId?: string
}

function clean(input: unknown): SongRequest[] {
  if (!Array.isArray(input)) return []
  const out: SongRequest[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'number') continue
    if (typeof r.text !== 'string' || !r.text.trim()) continue
    const entry: SongRequest = {
      id:   r.id,
      text: String(r.text).slice(0, 200),
      ts:   typeof r.ts === 'string' ? r.ts : new Date().toISOString(),
      done: !!r.done,
    }
    if (typeof r.clientId === 'string' && r.clientId) {
      entry.clientId = r.clientId.slice(0, 64)
    }
    out.push(entry)
    if (out.length >= 200) break
  }
  return out
}

export default async (req: Request, context: Context) => {
  const className = context.params.class
  if (!className || !ALLOWED_CLASSES.has(className)) {
    return new Response('Invalid class', { status: 400 })
  }

  const store = getStore('class-requests')

  if (req.method === 'GET') {
    const data = await store.get(className, { type: 'json' })
    return Response.json(Array.isArray(data) ? data : [])
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }
    const cleaned = clean(body)

    // Load what's currently stored so we can tell which incoming items are
    // genuinely NEW (a student submitting a request) versus the array just
    // being resaved after a teacher marked something done/dismissed it.
    const existing = await store.get(className, { type: 'json' })
    const existingArr: SongRequest[] = Array.isArray(existing) ? (existing as SongRequest[]) : []
    const existingIds = new Set(existingArr.map((r) => r.id))
    const newlyAdded = cleaned.filter((r) => !existingIds.has(r.id))

    if (newlyAdded.length > 0) {
      // Cooldown: reject if this same browser (by clientId) already has a
      // request logged within the cooldown window.
      const now = Date.now()
      for (const item of newlyAdded) {
        if (!item.clientId) continue
        const recent = existingArr.find((r) => {
          if (r.clientId !== item.clientId) return false
          const age = now - new Date(r.ts).getTime()
          return age >= 0 && age < REQUEST_COOLDOWN_MS
        })
        if (recent) {
          return new Response(
            'Please wait a bit before submitting another request.',
            { status: 429 }
          )
        }
      }

      // Queue cap: don't let pending requests pile up without limit.
      const pendingCount = cleaned.filter((r) => !r.done).length
      if (pendingCount > MAX_PENDING_PER_CLASS) {
        return new Response(
          'Too many pending requests right now - please wait for your teacher to review some first.',
          { status: 429 }
        )
      }
    }

    await store.setJSON(className, cleaned)
    return Response.json(cleaned)
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/requests/:class',
  method: ['GET', 'PUT', 'POST'],
}
