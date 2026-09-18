import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { supabaseDb } from '../../db/supabase.js'
import { classPlaylists, dailyBackups } from '../../db/schema.js'

const ALL_CLASSES = ['kangaroos', 'bilby', 'swans', 'numbats', 'bobtails', 'karak', 'wombats', 'PE']

// Runs automatically every night (see the schedule below) and writes one
// consolidated snapshot of the ENTIRE app's state - every class playlist,
// plus pause/lock state, banned songs, and pending requests for every
// class - into a single dated row. Playlists already have their own
// per-save history table, so this is a second, independent safety net:
// even if something unexpected happened to that finer-grained log, or to
// the Blobs store, there's still a full daily restore point covering
// everything else too.
export default async () => {
  const playlistRows = await supabaseDb.select().from(classPlaylists)

  const pauseStore = getStore('class-pause-state')
  const bannedStore = getStore('class-banned')
  const requestsStore = getStore('class-requests')

  const blobsSnapshot: Record<string, unknown> = {}
  for (const c of ALL_CLASSES) {
    blobsSnapshot[c] = {
      pause: await pauseStore.get(c, { type: 'json' }).catch(() => null),
      banned: await bannedStore.get(c, { type: 'json' }).catch(() => null),
      requests: await requestsStore.get(c, { type: 'json' }).catch(() => null),
    }
  }

  const snapshotDate = new Date().toISOString().slice(0, 10) // YYYY-MM-DD, UTC
  const data = {
    playlists: playlistRows,
    blobs: blobsSnapshot,
    generatedAt: new Date().toISOString(),
  }

  await supabaseDb
    .insert(dailyBackups)
    .values({ snapshotDate, data })
    .onConflictDoUpdate({
      target: dailyBackups.snapshotDate,
      set: { data, createdAt: new Date() },
    })

  return new Response(
    JSON.stringify({ ok: true, snapshotDate, classesSnapshotted: playlistRows.length }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

export const config: Config = {
  // 16:00 UTC = midnight AWST (Perth, no daylight saving) - runs once
  // overnight, well outside school hours.
  schedule: '0 16 * * *',
}
