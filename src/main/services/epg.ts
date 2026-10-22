import { XMLParser } from 'fast-xml-parser'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { EpgNowNext, Programme } from '../../shared/types'
import { fetchUrl } from '../net/http'

/**
 * XMLTV EPG store.
 *
 * Reliability features (the things that make broadcast EPGs "just work"):
 *  - Correct timezone handling: XMLTV dates with an explicit offset are honoured;
 *    dates without one are treated as UTC (and we never silently shift times).
 *  - Fuzzy fallback matching: if a channel's tvg-id has no programmes, we match on
 *    a normalised display name, so channels still get a guide.
 *  - Disk cache with TTL so the guide loads instantly and survives offline starts.
 *  - Defensive parsing: a malformed entry is skipped, never fatal.
 */
export class EpgStore {
  /** channelId (as used in XMLTV) -> programmes sorted by start. */
  private byChannel = new Map<string, Programme[]>()
  /** normalised display name -> canonical XMLTV channel id. */
  private nameIndex = new Map<string, string>()
  private loadedAt = 0
  private cacheDir: string

  constructor() {
    this.cacheDir = join(app.getPath('userData'), 'epg-cache')
  }

  get isLoaded(): boolean {
    return this.byChannel.size > 0
  }

  get ageMs(): number {
    return this.loadedAt ? Date.now() - this.loadedAt : Infinity
  }

  private cacheFile(sourceId: string): string {
    return join(this.cacheDir, `${sourceId.replace(/[^a-z0-9]/gi, '_')}.json`)
  }

  /**
   * Ensure EPG is available for a source, using the disk cache when it is younger
   * than ttlHours, otherwise fetching fresh. Returns a status for the UI.
   */
  async ensure(
    sourceId: string,
    epgUrl: string,
    userAgent: string,
    ttlHours: number,
    timeoutMs: number,
    force = false
  ): Promise<{ ok: boolean; channels: number; cached: boolean; message: string }> {
    await mkdir(this.cacheDir, { recursive: true })
    const file = this.cacheFile(sourceId)
    const ttlMs = Math.max(1, ttlHours) * 3600_000

    if (!force && existsSync(file)) {
      try {
        const cached = JSON.parse(await readFile(file, 'utf8')) as {
          at: number
          raw?: string
        }
        if (cached.at && Date.now() - cached.at < ttlMs && cached.raw) {
          this.ingest(cached.raw)
          this.loadedAt = cached.at
          return {
            ok: true,
            channels: this.byChannel.size,
            cached: true,
            message: `Loaded guide from cache (${this.byChannel.size} channels).`
          }
        }
      } catch {
        /* fall through to refetch */
      }
    }

    if (!epgUrl) {
      return { ok: false, channels: 0, cached: false, message: 'No EPG URL configured for this source.' }
    }

    try {
      const r = await fetchUrl(epgUrl, { userAgent, timeoutMs, retries: 2 })
      const raw = r.body.toString('utf8')
      this.ingest(raw)
      this.loadedAt = Date.now()
      await writeFile(file, JSON.stringify({ at: this.loadedAt, raw })).catch(() => {})
      return {
        ok: true,
        channels: this.byChannel.size,
        cached: false,
        message: `Downloaded guide: ${this.byChannel.size} channels with programmes.`
      }
    } catch (e) {
      // Fall back to any stale cache rather than showing no guide at all.
      if (existsSync(file)) {
        try {
          const cached = JSON.parse(await readFile(file, 'utf8')) as { at: number; raw?: string }
          if (cached.raw) {
            this.ingest(cached.raw)
            this.loadedAt = cached.at
            return {
              ok: true,
              channels: this.byChannel.size,
              cached: true,
              message: `EPG download failed (${(e as Error).message}); using cached guide.`
            }
          }
        } catch {
          /* ignore */
        }
      }
      return { ok: false, channels: 0, cached: false, message: `EPG failed: ${(e as Error).message}` }
    }
  }

  /** Parse an XMLTV document into the in-memory indexes. */
  ingest(xml: string): void {
    this.byChannel.clear()
    this.nameIndex.clear()

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
      isArray: (name) => name === 'programme' || name === 'channel' || name === 'display-name'
    })

    let doc: Record<string, unknown>
    try {
      doc = parser.parse(xml) as Record<string, unknown>
    } catch {
      return
    }
    const tv = (doc.tv ?? {}) as Record<string, unknown>

    // Channel display names -> id, for fuzzy fallback.
    const channels = (tv.channel ?? []) as Array<Record<string, unknown>>
    for (const ch of channels) {
      const id = String(ch['@_id'] ?? '').trim()
      if (!id) continue
      const names = (ch['display-name'] ?? []) as unknown[]
      for (const n of names) {
        const text = typeof n === 'object' && n ? String((n as Record<string, unknown>)['#text'] ?? '') : String(n ?? '')
        const key = normaliseName(text)
        if (key && !this.nameIndex.has(key)) this.nameIndex.set(key, id)
      }
      this.nameIndex.set(normaliseName(id), id)
    }

    const programmes = (tv.programme ?? []) as Array<Record<string, unknown>>
    for (const p of programmes) {
      const channel = String(p['@_channel'] ?? '').trim()
      const start = parseXmltvDate(String(p['@_start'] ?? ''))
      const stop = parseXmltvDate(String(p['@_stop'] ?? ''))
      if (!channel || !Number.isFinite(start)) continue
      const title = textOf(p.title) || 'No title'
      const prog: Programme = {
        channelId: channel,
        start,
        stop: Number.isFinite(stop) ? stop : start + 3600_000,
        title,
        desc: textOf(p.desc) || undefined,
        category: textOf(p.category) || undefined
      }
      const arr = this.byChannel.get(channel)
      if (arr) arr.push(prog)
      else this.byChannel.set(channel, [prog])
    }

    for (const arr of this.byChannel.values()) arr.sort((a, b) => a.start - b.start)
  }

  /** Resolve a channel to its programme list via tvg-id, then name fallback. */
  private resolve(epgChannelId?: string, channelName?: string): Programme[] | undefined {
    if (epgChannelId && this.byChannel.has(epgChannelId)) return this.byChannel.get(epgChannelId)
    if (epgChannelId) {
      const viaName = this.nameIndex.get(normaliseName(epgChannelId))
      if (viaName && this.byChannel.has(viaName)) return this.byChannel.get(viaName)
    }
    if (channelName) {
      const id = this.nameIndex.get(normaliseName(channelName))
      if (id && this.byChannel.has(id)) return this.byChannel.get(id)
    }
    return undefined
  }

  getNowNext(epgChannelId?: string, channelName?: string, at = Date.now()): EpgNowNext {
    const list = this.resolve(epgChannelId, channelName)
    if (!list || !list.length) return {}
    let now: Programme | undefined
    let next: Programme | undefined
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (p.start <= at && at < p.stop) {
        now = p
        next = list[i + 1]
        break
      }
      if (p.start > at) {
        next = p
        break
      }
    }
    return { now, next }
  }

  getForChannel(
    epgChannelId: string | undefined,
    channelName: string | undefined,
    from: number,
    to: number
  ): Programme[] {
    const list = this.resolve(epgChannelId, channelName)
    if (!list) return []
    return list.filter((p) => p.stop > from && p.start < to)
  }
}

// --------------------------------------------------------------------- helpers

function textOf(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return textOf(v[0])
  if (typeof v === 'object') return String((v as Record<string, unknown>)['#text'] ?? '')
  return String(v)
}

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(hd|fhd|uhd|4k|sd|tv|channel|ch|dz|us|uk|\|)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

/**
 * Parse an XMLTV timestamp. Formats seen in the wild:
 *   20250101120000 +0000
 *   20250101120000 -0500
 *   20250101120000        (no offset -> treated as UTC)
 *   202501011200          (no seconds)
 * Returns unix ms, or NaN if unparseable.
 */
export function parseXmltvDate(s: string): number {
  const m = s.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/)
  if (!m) {
    const fallback = Date.parse(s)
    return Number.isFinite(fallback) ? fallback : NaN
  }
  const [, Y, Mo, D, H, Mi, Se, tz] = m
  if (tz) {
    const iso = `${Y}-${Mo}-${D}T${H}:${Mi}:${Se || '00'}${tz.slice(0, 3)}:${tz.slice(3)}`
    const t = Date.parse(iso)
    if (Number.isFinite(t)) return t
  }
  // No offset: XMLTV leaves this implementation-defined. We standardise on UTC so
  // the guide is at least internally consistent (and document it in Settings).
  return Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, Se ? +Se : 0)
}
