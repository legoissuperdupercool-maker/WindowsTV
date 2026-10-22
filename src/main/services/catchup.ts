import type { Channel, Source } from '../../shared/types'

/** What we learn about the provider's clock at login (Xtream server_info). */
export interface ServerClock {
  /** Server wall-clock minus UTC, in minutes (from time_now vs timestamp_now). */
  offsetMin?: number
  /** IANA zone name, e.g. "Europe/London" (fallback when offset is unknown). */
  timezone?: string
}

/**
 * Xtream reports `time_now` ("2026-10-22 23:40:00", server local time) and
 * `timestamp_now` (unix seconds). Their difference is the server's UTC offset,
 * which catch-up start times must be expressed in.
 */
export function serverOffsetMin(timeNow?: string, timestampNow?: number | string): number | undefined {
  if (!timeNow || timestampNow == null) return undefined
  const m = timeNow.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return undefined
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0)
  const real = Number(timestampNow) * 1000
  if (!Number.isFinite(real)) return undefined
  // Round to the nearest 15 minutes (all real time zones are multiples of 15).
  return Math.round((asUtc - real) / 60000 / 15) * 15
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Server-local "YYYY-MM-DD:HH-MM" for a UTC instant. */
export function formatServerTime(ms: number, clock: ServerClock): string {
  if (clock.offsetMin == null && clock.timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: clock.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date(ms))
      const g = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00'
      return `${g('year')}-${g('month')}-${g('day')}:${g('hour')}-${g('minute')}`
    } catch {
      /* unknown zone → fall through to UTC */
    }
  }
  const d = new Date(ms + (clock.offsetMin ?? 0) * 60000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}:${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}`
}

/** Xtream timeshift URL for [startMs, stopMs) on a live stream. */
function xtreamUrl(base: string, user: string, pass: string, streamId: string, startMs: number, stopMs: number, clock: ServerClock): string {
  const minutes = Math.max(1, Math.ceil((stopMs - startMs) / 60000))
  return `${base}/timeshift/${user}/${pass}/${minutes}/${formatServerTime(startMs, clock)}/${streamId}.ts`
}

/** Fill a catch-up URL template (M3U `catchup-source`). Common placeholders only. */
export function fillTemplate(tpl: string, startMs: number, stopMs: number): string {
  const s = Math.floor(startMs / 1000)
  const e = Math.floor(stopMs / 1000)
  const now = Math.floor(Date.now() / 1000)
  const d = new Date(startMs)
  const map: Record<string, string> = {
    utc: String(s),
    start: String(s),
    timestamp: String(s),
    utcend: String(e),
    end: String(e),
    lutc: String(now),
    now: String(now),
    duration: String(e - s),
    offset: String(now - s),
    Y: String(d.getUTCFullYear()),
    m: pad(d.getUTCMonth() + 1),
    d: pad(d.getUTCDate()),
    H: pad(d.getUTCHours()),
    M: pad(d.getUTCMinutes()),
    S: pad(d.getUTCSeconds())
  }
  return tpl.replace(/\$?\{(\w+)\}/g, (all, k: string) => map[k] ?? all)
}

/**
 * Build the catch-up URL for a programme on a channel, or explain why not.
 * Supports Xtream (tv_archive) and M3U `catchup` = xc / append / default.
 */
export function buildCatchupUrl(
  channel: Channel,
  source: Source,
  startMs: number,
  stopMs: number,
  clock: ServerClock
): { url?: string; reason?: string } {
  const c = channel.catchup
  if (!c) return { reason: 'This channel doesn’t offer catch-up.' }
  if (startMs < Date.now() - c.days * 86400_000) {
    return { reason: `Catch-up only goes back ${c.days} day${c.days === 1 ? '' : 's'} on this channel.` }
  }
  if (c.kind === 'xtream') {
    if (source.kind === 'xtream' && source.username && source.password) {
      return { url: xtreamUrl(source.url.replace(/\/+$/, ''), source.username, source.password, channel.providerId, startMs, stopMs, clock) }
    }
    // M3U `catchup="xc"`: credentials are inside the live URL (…/live/USER/PASS/ID.ts or …/USER/PASS/ID).
    const m = channel.url.match(/^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.\w+)?$/)
    if (!m) return { reason: 'Couldn’t work out this channel’s catch-up address.' }
    return { url: xtreamUrl(m[1], m[2], m[3], m[4], startMs, stopMs, clock) }
  }
  if (!c.template) return { reason: 'This channel’s catch-up address is missing.' }
  const filled = fillTemplate(c.template, startMs, stopMs)
  return { url: c.kind === 'append' ? channel.url + filled : filled }
}
