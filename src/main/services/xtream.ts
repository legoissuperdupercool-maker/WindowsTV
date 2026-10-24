import type { Category, Channel, MediaDetails, SeriesDetails, SeriesEpisode, Source } from '../../shared/types'
import { fetchJson, fetchUrl } from '../net/http'
import { serverOffsetMin, type ServerClock } from './catchup'

/**
 * Minimal, resilient Xtream Codes API client.
 *
 * Xtream panels are notoriously inconsistent (fields come back as strings,
 * numbers, or null; some actions 404 on some panels). We normalise everything
 * into our own Channel/Category types and never throw on a single bad row.
 */

interface XtreamAuth {
  user_info?: { auth?: number; status?: string; message?: string; exp_date?: string | null }
  server_info?: {
    url?: string
    port?: string
    https_port?: string
    server_protocol?: string
    timezone?: string
    time_now?: string
    timestamp_now?: number | string
  }
}

function base(source: Source): string {
  return source.url.replace(/\/+$/, '')
}

function api(source: Source, params: Record<string, string>): string {
  const q = new URLSearchParams({
    username: source.username ?? '',
    password: source.password ?? '',
    ...params
  })
  return `${base(source)}/player_api.php?${q.toString()}`
}

/** Minimum timeout for the big list endpoints (live/VOD/series): panels often
 *  spend 20–60 s building multi-MB JSON before sending the first byte. */
const LIST_TIMEOUT_MS = 90_000
const listTimeout = (t: number): number => Math.max(t, LIST_TIMEOUT_MS)

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s ? s : undefined
}

export async function authenticate(
  source: Source,
  userAgent: string,
  timeoutMs: number
): Promise<{ ok: boolean; message: string; expiry?: string; clock?: ServerClock }> {
  const data = await fetchJson<XtreamAuth>(api(source, {}), {
    userAgent: source.userAgent || userAgent,
    timeoutMs,
    retries: 2
  })
  const info = data.user_info
  if (!info) return { ok: false, message: 'No account info returned — check the server URL.' }
  if (info.auth === 0 || info.status === 'Expired' || info.status === 'Banned') {
    return { ok: false, message: info.message || `Account status: ${info.status ?? 'invalid'}` }
  }
  const expiry = info.exp_date
    ? new Date(Number(info.exp_date) * 1000).toLocaleDateString()
    : undefined
  const si = data.server_info ?? {}
  const clock: ServerClock = { offsetMin: serverOffsetMin(si.time_now, si.timestamp_now), timezone: si.timezone || undefined }
  return { ok: true, message: `Connected${expiry ? ` · expires ${expiry}` : ''}`, expiry, clock }
}

export async function getCategories(
  source: Source,
  userAgent: string,
  timeoutMs: number
): Promise<Category[]> {
  const out: Category[] = []
  const actions: Array<[string, Category['type']]> = [
    ['get_live_categories', 'live'],
    ['get_vod_categories', 'movie'],
    ['get_series_categories', 'series']
  ]
  for (const [action, type] of actions) {
    try {
      const rows = await fetchJson<Array<Record<string, unknown>>>(api(source, { action }), {
        userAgent: source.userAgent || userAgent,
        timeoutMs: listTimeout(timeoutMs),
        retries: 1
      })
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const id = str(r.category_id)
          const name = str(r.category_name)
          if (id && name) out.push({ id: `${source.id}:${type}:${id}`, name, type, sourceId: source.id })
        }
      }
    } catch {
      // A panel may not offer VOD/series — skip silently, keep the rest.
    }
  }
  return out
}

export async function getLiveStreams(
  source: Source,
  userAgent: string,
  timeoutMs: number
): Promise<Channel[]> {
  const rows = await fetchJson<Array<Record<string, unknown>>>(
    api(source, { action: 'get_live_streams' }),
    { userAgent: source.userAgent || userAgent, timeoutMs: listTimeout(timeoutMs), retries: 2 }
  )
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => {
      const streamId = str(r.stream_id ?? r.num)
      const name = str(r.name)
      if (!streamId || !name) return null
      const channel: Channel = {
        id: `${source.id}:live:${streamId}`,
        sourceId: source.id,
        type: 'live',
        providerId: streamId,
        name,
        logo: str(r.stream_icon),
        group: str(r.category_id) ? `${source.id}:live:${str(r.category_id)}` : undefined,
        epgChannelId: str(r.epg_channel_id),
        number: num(r.num),
        url: liveUrl(source, streamId),
        // tv_archive=1 → the provider keeps recordings for tv_archive_duration days.
        catchup: num(r.tv_archive) === 1 ? { days: num(r.tv_archive_duration) || 1, kind: 'xtream' } : undefined
      }
      return channel
    })
    .filter((c): c is Channel => c !== null)
}

export async function getVod(
  source: Source,
  userAgent: string,
  timeoutMs: number
): Promise<Channel[]> {
  const rows = await fetchJson<Array<Record<string, unknown>>>(
    api(source, { action: 'get_vod_streams' }),
    { userAgent: source.userAgent || userAgent, timeoutMs: listTimeout(timeoutMs), retries: 1 }
  ).catch(() => [])
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => {
      const streamId = str(r.stream_id)
      const name = str(r.name)
      if (!streamId || !name) return null
      const ext = str(r.container_extension) || 'mp4'
      const channel: Channel = {
        id: `${source.id}:movie:${streamId}`,
        sourceId: source.id,
        type: 'movie',
        providerId: streamId,
        name,
        logo: str(r.stream_icon) || str(r.cover),
        group: str(r.category_id) ? `${source.id}:movie:${str(r.category_id)}` : undefined,
        url: `${base(source)}/movie/${source.username}/${source.password}/${streamId}.${ext}`,
        meta: {
          rating: str(r.rating),
          added: str(r.added),
          plot: str(r.plot),
          // Some panels include these in the list; used for recommendations.
          genre: str(r.genre),
          year: str(r.year) ?? str(r.releasedate)?.match(/\d{4}/)?.[0],
          backdrop: firstStr(r.backdrop_path)
        }
      }
      return channel
    })
    .filter((c): c is Channel => c !== null)
}

/** Series listing (top-level series; episodes are fetched lazily via getSeriesInfo). */
export async function getSeries(
  source: Source,
  userAgent: string,
  timeoutMs: number
): Promise<Channel[]> {
  const rows = await fetchJson<Array<Record<string, unknown>>>(
    api(source, { action: 'get_series' }),
    { userAgent: source.userAgent || userAgent, timeoutMs: listTimeout(timeoutMs), retries: 1 }
  ).catch(() => [])
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => {
      const seriesId = str(r.series_id)
      const name = str(r.name)
      if (!seriesId || !name) return null
      const channel: Channel = {
        id: `${source.id}:series:${seriesId}`,
        sourceId: source.id,
        type: 'series',
        providerId: seriesId,
        name,
        logo: str(r.cover),
        group: str(r.category_id) ? `${source.id}:series:${str(r.category_id)}` : undefined,
        url: '', // resolved per-episode
        // The series list carries genre / cast / director: used for recommendations.
        meta: {
          plot: str(r.plot),
          rating: str(r.rating) ?? (num(r.rating_5based) ? String(num(r.rating_5based)! * 2) : undefined),
          genre: str(r.genre),
          cast: str(r.cast),
          director: str(r.director),
          backdrop: firstStr(r.backdrop_path),
          year: (str(r.releaseDate) ?? str(r.release_date) ?? str(r.year))?.match(/\d{4}/)?.[0],
          added: str(r.last_modified)
        }
      }
      return channel
    })
    .filter((c): c is Channel => c !== null)
}

export async function getSeriesInfo(
  source: Source,
  seriesId: string,
  userAgent: string,
  timeoutMs: number
): Promise<SeriesDetails> {
  const data = await fetchJson<Record<string, unknown>>(
    api(source, { action: 'get_series_info', series_id: seriesId }),
    { userAgent: source.userAgent || userAgent, timeoutMs, retries: 1 }
  )
  const episodesBySeason = (data.episodes ?? {}) as Record<string, Array<Record<string, unknown>>>
  const out: SeriesEpisode[] = []
  for (const [season, eps] of Object.entries(episodesBySeason)) {
    if (!Array.isArray(eps)) continue
    for (const e of eps) {
      const epId = str(e.id)
      if (!epId) continue
      const ext = str(e.container_extension) || 'mp4'
      const info = (e.info ?? {}) as Record<string, unknown>
      out.push({
        id: epId,
        title: str(e.title) || `Episode ${str(e.episode_num) ?? ''}`,
        season: num(season) ?? num(e.season) ?? 1,
        episode: num(e.episode_num) ?? 0,
        url: `${base(source)}/series/${source.username}/${source.password}/${epId}.${ext}`,
        plot: str(info.plot),
        duration: str(info.duration),
        thumb: str(info.movie_image)
      })
    }
  }
  out.sort((a, b) => a.season - b.season || a.episode - b.episode)
  const info = (data.info ?? {}) as Record<string, unknown>
  return { details: toDetails(info, str(info.name) ?? ''), episodes: out }
}

/** Full movie info: artwork, plot, cast… (Xtream get_vod_info). */
export async function getVodInfo(
  source: Source,
  vodId: string,
  userAgent: string,
  timeoutMs: number
): Promise<MediaDetails> {
  const data = await fetchJson<Record<string, unknown>>(api(source, { action: 'get_vod_info', vod_id: vodId }), {
    userAgent: source.userAgent || userAgent,
    timeoutMs,
    retries: 1
  })
  const info = (Array.isArray(data.info) ? {} : (data.info ?? {})) as Record<string, unknown>
  const movie = (data.movie_data ?? {}) as Record<string, unknown>
  return toDetails(info, str(info.name) ?? str(movie.name) ?? '')
}

/** Normalise the many field spellings Xtream panels use for media info. */
function toDetails(info: Record<string, unknown>, title: string): MediaDetails {
  const backdrops = info.backdrop_path
  const backdrop = Array.isArray(backdrops) ? str(backdrops[0]) : str(backdrops)
  const released = str(info.releasedate) ?? str(info.releaseDate) ?? str(info.release_date) ?? str(info.year)
  const ratingNum = num(info.rating) ?? (num(info.rating_5based) != null ? num(info.rating_5based)! * 2 : undefined)
  return {
    title,
    poster: str(info.movie_image) ?? str(info.cover) ?? str(info.cover_big),
    backdrop,
    plot: str(info.plot) ?? str(info.description),
    year: released?.match(/\d{4}/)?.[0],
    genre: str(info.genre),
    rating: ratingNum && ratingNum > 0 ? ratingNum.toFixed(1) : undefined,
    duration: str(info.duration) ?? (num(info.episode_run_time) ? `${num(info.episode_run_time)} min` : undefined),
    cast: str(info.cast) ?? str(info.actors),
    director: str(info.director)
  }
}

export function liveUrl(source: Source, streamId: string): string {
  // `.ts` is the most broadly compatible live container across panels; mpv also
  // handles `.m3u8` fine if a provider needs it (switchable later per source).
  return `${base(source)}/live/${source.username}/${source.password}/${streamId}.ts`
}

/** Derived XMLTV EPG endpoint for an Xtream source. */
export function xtreamEpgUrl(source: Source): string {
  const q = new URLSearchParams({
    username: source.username ?? '',
    password: source.password ?? ''
  })
  return `${base(source)}/xmltv.php?${q.toString()}`
}

/** Quick connectivity test used by the "Test" button in Settings. */
export async function testXtream(
  source: Source,
  userAgent: string,
  timeoutMs: number
): Promise<{ ok: boolean; message: string }> {
  try {
    const auth = await authenticate(source, userAgent, timeoutMs)
    return auth
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/** Touch the base URL to distinguish "server down" from "bad credentials". */
export async function reachable(source: Source, userAgent: string): Promise<boolean> {
  try {
    const r = await fetchUrl(base(source), { userAgent, timeoutMs: 6000, retries: 0, maxBytes: 1024 })
    return r.status > 0
  } catch {
    return false
  }
}

/** Panels send backdrop_path as a string or a list of URLs. */
function firstStr(v: unknown): string | undefined {
  return Array.isArray(v) ? str(v.find((x) => typeof x === 'string' && x.trim())) : str(v)
}
