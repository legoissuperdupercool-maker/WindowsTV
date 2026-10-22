// Domain types shared across the main process, preload bridge and renderer.

export type SourceKind = 'xtream' | 'm3u'

/** A configured IPTV provider. */
export interface Source {
  id: string
  kind: SourceKind
  name: string
  /** Xtream: base server URL (http://host:port). M3U: the playlist URL or file path. */
  url: string
  /** Xtream only. */
  username?: string
  /** Xtream only. */
  password?: string
  /** Optional explicit XMLTV EPG url. For Xtream we can derive one automatically. */
  epgUrl?: string
  /** Optional per-source User-Agent (some providers require a specific one). */
  userAgent?: string
  /** Unix ms of last successful refresh. */
  lastSync?: number
  enabled: boolean
}

export type StreamType = 'live' | 'movie' | 'series'

/** A playable channel / VOD entry, normalised across source kinds. */
export interface Channel {
  /** Stable id: `${sourceId}:${type}:${providerId}`. */
  id: string
  sourceId: string
  type: StreamType
  /** Provider-native id (stream_id for Xtream). */
  providerId: string
  name: string
  logo?: string
  group?: string
  /** XMLTV channel id for EPG matching (tvg-id). */
  epgChannelId?: string
  /** Fully-resolved playback URL (may be built lazily for Xtream). */
  url: string
  /** Live channel number, when the provider supplies one. */
  number?: number
  /** For VOD/series: extra metadata. */
  meta?: Record<string, unknown>
}

export interface SeriesEpisode {
  id: string
  title: string
  season: number
  episode: number
  url: string
  plot?: string
  duration?: string
}

export interface Category {
  id: string
  name: string
  type: StreamType
  sourceId: string
}

/** A single EPG programme entry. Times are unix ms (UTC-normalised). */
export interface Programme {
  channelId: string
  start: number
  stop: number
  title: string
  desc?: string
  category?: string
}

export interface EpgNowNext {
  now?: Programme
  next?: Programme
}

/** mpv observable playback state surfaced to the UI. */
export interface PlaybackState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error'
  channelId?: string
  title?: string
  position: number
  duration: number
  /** 0..100 */
  cacheBufferingPercent?: number
  paused: boolean
  volume: number
  muted: boolean
  /** Human-readable error for the UI (addresses "nothing loads" with a reason). */
  error?: string
  /** Live stream stats for a diagnostics overlay. */
  stats?: {
    videoCodec?: string
    audioCodec?: string
    width?: number
    height?: number
    fps?: number
    bitrateKbps?: number
    demuxerCacheSeconds?: number
  }
}

export interface AppSettings {
  sources: Source[]
  favorites: string[] // channel ids
  recents: string[] // channel ids, most-recent first
  /** Explicit mpv.exe path override. Empty = auto-resolve. */
  mpvPath?: string
  /** Default network User-Agent for playback + fetching. */
  userAgent: string
  /** mpv cache size in seconds (bigger = more resilient to jitter). */
  cacheSeconds: number
  /** Hardware decoding mode passed to mpv (`auto-safe` is a good default). */
  hwdec: string
  /** Deinterlace broadcast feeds. */
  deinterlace: boolean
  /** Connection timeout (ms) for playlist/EPG/stream probing. */
  networkTimeoutMs: number
  /** How long (hours) EPG stays cached before a refresh is attempted. */
  epgTtlHours: number
  /** Launcher app tiles on the home screen. */
  appTiles: AppTile[]
  /** Last opened source id, for restoring context. */
  lastSourceId?: string
}

export interface AppTile {
  id: string
  label: string
  /** Built-in section route, or an external URL to open. */
  kind: 'section' | 'web'
  /** For section tiles: 'live' | 'movies' | 'series' | 'settings' | 'guide'. */
  target: string
  color?: string
  icon?: string
}

/** Result wrapper so the UI always gets a reason on failure. */
export interface Result<T> {
  ok: boolean
  data?: T
  error?: string
}

/** Progress events emitted while loading a source (so the UI is never silent). */
export interface LoadProgress {
  sourceId: string
  phase: 'connecting' | 'categories' | 'channels' | 'epg' | 'done' | 'error'
  message: string
  count?: number
}
