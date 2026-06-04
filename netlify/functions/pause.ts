import type { Config } from '@netlify/functions'

export default async () => {
  return new Response('Not used', { status: 404 })
}

export const config: Config = {
  path: '/api/pause-disabled',
  method: ['GET'],
}
