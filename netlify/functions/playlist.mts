import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

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

  const store = getStore({ name: 'class-playlists', consistency: 'strong' })

  if (req.method === 'GET') {
    const data = await store.get(className, { type: 'json' })
    return Response.json(Array.isArray(data) ? data : [])
  }

  if (req.method === 'PUT') {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }
    const cleaned = clean(body)
    await store.setJSON(className, cleaned)
    return Response.json(cleaned)
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/playlist/:class',
  method: ['GET', 'PUT'],
}
