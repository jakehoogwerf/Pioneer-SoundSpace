import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const ALLOWED_CLASSES = new Set([
  'kangaroos', 'bilby', 'swans', 'numbats',
  'bobtails', 'karak', 'wombats', 'PE',
])

// A fixed, small set of reactions - deliberately not free-text, so this
// can't be used to post arbitrary messages.
const ALLOWED_EMOJIS = new Set(['fire', 'heart', 'laugh', 'sleepy'])

type ReactionState = {
  songId: string
  counts: Record<string, number>
  updatedAt: string
}

export default async (req: Request, context: Context) => {
  const className = context.params.class
  if (!className || !ALLOWED_CLASSES.has(className)) {
    return new Response('Invalid class', { status: 400 })
  }

  const store = getStore('class-reactions')

  if (req.method === 'GET') {
    const data = (await store.get(className, { type: 'json' })) as ReactionState | null
    return Response.json(data || { songId: '', counts: {}, updatedAt: new Date().toISOString() })
  }

  if (req.method === 'POST') {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }
    const b = (body || {}) as Record<string, unknown>
    const songId = typeof b.songId === 'string' ? b.songId.trim().slice(0, 32) : ''
    const emoji = typeof b.emoji === 'string' ? b.emoji : ''
    if (!songId || !ALLOWED_EMOJIS.has(emoji)) {
      return new Response('Invalid reaction', { status: 400 })
    }

    const existing = (await store.get(className, { type: 'json' })) as ReactionState | null
    // Reactions are scoped to whichever song is currently playing - the
    // moment a reaction comes in for a different song than what's stored,
    // that's a new "now playing" session, so counts start fresh at zero.
    const counts: Record<string, number> =
      existing && existing.songId === songId ? { ...existing.counts } : {}
    counts[emoji] = (counts[emoji] || 0) + 1

    const next: ReactionState = { songId, counts, updatedAt: new Date().toISOString() }
    await store.setJSON(className, next)
    return Response.json(next)
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/reactions/:class',
  method: ['GET', 'POST'],
}
