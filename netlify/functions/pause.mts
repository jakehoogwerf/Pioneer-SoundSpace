import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const ALLOWED_CLASSES = new Set([
  'kangaroos', 'bilby', 'swans', 'numbats',
  'bobtails', 'karak', 'wombats', 'PE',
])

export default async (req: Request, context: Context) => {
  const className = context.params.class
  if (!className || !ALLOWED_CLASSES.has(className)) {
    return new Response('Invalid class', { status: 400 })
  }

  const store = getStore('class-pause-state')

  if (req.method === 'GET') {
    const data = (await store.get(className, { type: 'json' })) as Record<string, unknown> | null
    return Response.json({ paused: false, locked: false, ...data })
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }
    const b = body as Record<string, unknown>
    const state = { paused: !!b.paused, locked: !!b.locked }
    await store.setJSON(className, state)
    return Response.json(state)
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/pause/:class',
  method: ['GET', 'PUT', 'POST'],
}
