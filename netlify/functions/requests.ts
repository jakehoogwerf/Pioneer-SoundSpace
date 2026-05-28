import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const ALLOWED_CLASSES = new Set([
  'kangaroos', 'bilby', 'swans', 'numbats',
  'bobtails', 'karak', 'wombats', 'PE',
])

type SongRequest = {
  id: number
  text: string
  ts: string
  done: boolean
}

function clean(input: unknown): SongRequest[] {
  if (!Array.isArray(input)) return []
  const out: SongRequest[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'number') continue
    if (typeof r.text !== 'string' || !r.text.trim()) continue
    out.push({
      id:   r.id,
      text: String(r.text).slice(0, 200),
      ts:   typeof r.ts === 'string' ? r.ts : new Date().toISOString(),
      done: !!r.done,
    })
    if (out.length >= 200) break
  }
  return out
}

export default async (req: Request, context: Context) => {
  const className = context.params.class
  if (!className || !ALLOWED_CLASSES.has(className)) {
    return new Response('Invalid class', { status: 400 })
  }

  const store = getStore({ name: 'class-requests', consistency: 'strong' })

  if (req.method === 'GET') {
    const data = await store.get(className, { type: 'json' })
    return Response.json(Array.isArray(data) ? data : [])
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body: unknown
    try { body = await req.json() } catch {
      return new Response('Invalid JSON', { status: 400 })
    }
    const cleaned = clean(body)
    await store.setJSON(className, cleaned)
    return Response.json(cleaned)
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/requests/:class',
  method: ['GET', 'PUT', 'POST'],
}
