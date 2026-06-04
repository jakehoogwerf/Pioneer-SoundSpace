import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const ALLOWED_CLASSES = new Set([
  'kangaroos', 'bilby', 'swans', 'numbats',
  'bobtails', 'karak', 'wombats', 'PE',
])

function cleanIds(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (typeof item !== 'string') continue
    const id = item.trim().slice(0, 32)
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= 1000) break
  }
  return out
}

export default async (req: Request, context: Context) => {
  const className = context.params.class
  if (!className || !ALLOWED_CLASSES.has(className)) {
    return new Response('Invalid class', { status: 400 })
  }

  const store = getStore('class-banned')

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
    const cleaned = cleanIds(body)
    await store.setJSON(className, cleaned)
    return Response.json(cleaned)
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/banned/:class',
  method: ['GET', 'PUT', 'POST'],
}
