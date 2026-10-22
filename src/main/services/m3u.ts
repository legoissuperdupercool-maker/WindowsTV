import type { Category, Channel, Source } from '../../shared/types'
import { fetchUrl } from '../net/http'
import { readFile } from 'node:fs/promises'

/**
 * Parser for extended M3U / M3U8 playlists.
 *
 * Handles the common tags produced by IPTV panels and tools:
 *   #EXTM3U url-tvg="..." x-tvg-url="..."
 *   #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="..." tvg-chno="..",Channel Name
 *   #EXTGRP:Group
 *   <url>
 */

export interface M3uResult {
  channels: Channel[]
  categories: Category[]
  epgUrl?: string
}

const ATTR_RE = /([a-zA-Z0-9-]+)="([^"]*)"/g

function parseAttrs(line: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(line)) !== null) {
    attrs[m[1].toLowerCase()] = m[2]
  }
  return attrs
}

export function parseM3u(text: string, source: Source): M3uResult {
  const lines = text.split(/\r?\n/)
  const channels: Channel[] = []
  const groupSet = new Map<string, string>()
  let epgUrl: string | undefined

  let pending: Partial<Channel> | null = null
  let pendingGroup: string | undefined
  let seq = 0

  for (let raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('#EXTM3U')) {
      const attrs = parseAttrs(line)
      epgUrl = attrs['url-tvg'] || attrs['x-tvg-url'] || epgUrl
      continue
    }

    if (line.startsWith('#EXTINF')) {
      const attrs = parseAttrs(line)
      const commaIdx = line.lastIndexOf(',')
      const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : 'Unknown'
      const group = attrs['group-title'] || undefined
      pendingGroup = group
      pending = {
        name: attrs['tvg-name'] || name || 'Unknown',
        logo: attrs['tvg-logo'] || undefined,
        epgChannelId: attrs['tvg-id'] || undefined,
        number: attrs['tvg-chno'] ? Number(attrs['tvg-chno']) : undefined
      }
      continue
    }

    if (line.startsWith('#EXTGRP')) {
      const g = line.split(':')[1]?.trim()
      if (g) pendingGroup = g
      continue
    }

    // Ignore other directives (#EXTVLCOPT, #KODIPROP, comments).
    if (line.startsWith('#')) continue

    // This is a URL line — finalise the pending entry.
    const url = line
    const idBase = pending?.epgChannelId || pending?.name || `item-${seq}`
    const providerId = `${idBase}-${seq}`
    seq++

    let groupId: string | undefined
    if (pendingGroup) {
      groupId = `${source.id}:live:${slug(pendingGroup)}`
      if (!groupSet.has(groupId)) groupSet.set(groupId, pendingGroup)
    }

    const type = guessType(url, pendingGroup)
    channels.push({
      id: `${source.id}:${type}:${providerId}`,
      sourceId: source.id,
      type,
      providerId,
      name: pending?.name || 'Unknown',
      logo: pending?.logo,
      group: groupId,
      epgChannelId: pending?.epgChannelId,
      number: pending?.number,
      url
    })

    pending = null
    pendingGroup = undefined
  }

  const categories: Category[] = [...groupSet.entries()].map(([id, name]) => ({
    id,
    name,
    type: 'live',
    sourceId: source.id
  }))

  return { channels, categories, epgUrl }
}

function guessType(url: string, group?: string): Channel['type'] {
  const g = (group || '').toLowerCase()
  if (/\b(vod|movie|film)\b/.test(g)) return 'movie'
  if (/\b(series|show|season)\b/.test(g)) return 'series'
  // A URL ending in a file container is usually VOD; a live stream is ts/m3u8/no-ext.
  if (/\.(mp4|mkv|avi|mov)(\?|$)/i.test(url)) return 'movie'
  return 'live'
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Load a playlist from an http(s) URL or a local file path. */
export async function loadM3u(
  source: Source,
  userAgent: string,
  timeoutMs: number
): Promise<M3uResult> {
  let text: string
  if (/^https?:\/\//i.test(source.url)) {
    // Big playlists can take a while before the first byte arrives.
    const r = await fetchUrl(source.url, {
      userAgent: source.userAgent || userAgent,
      timeoutMs: Math.max(timeoutMs, 90_000),
      retries: 2
    })
    text = r.body.toString('utf8')
  } else {
    text = await readFile(source.url, 'utf8')
  }
  if (!/#EXTM3U/i.test(text.slice(0, 256)) && !/#EXTINF/i.test(text.slice(0, 2048))) {
    throw new Error('That does not look like an M3U playlist (no #EXTM3U/#EXTINF header found).')
  }
  return parseM3u(text, source)
}
