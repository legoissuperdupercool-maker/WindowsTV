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
  /** Live channels that support catch-up (replaying past programmes). */
  catchup?: {
    /** How many days back the provider keeps recordings. */
    days: number
    /** `xtream` = /timeshift/ URLs; `append`/`default` = M3U catchup-source template. */
    kind: 'xtream' | 'append' | 'default'
    template?: string
  }
}

/** A movie or series saved to a profile's "My List". */
export interface ListItem {
  /** Channel id (`${sourceId}:movie:${id}` / `${sourceId}:series:${id}`). */
  key: string
  sourceId: string
  kind: 'movie' | 'series'
  title: string
  poster?: string
  /** Category (group) id, used for recommendations. */
  group?: string
  addedAt: number
}

/** One person in the household (Netflix-style). */
export interface Profile {
  id: string
  name: string
  /** Avatar colour. */
  color: string
  /** Profile picture: `art:<id>` (ello's characters) or `image:<file>` (uploaded). */
  avatar?: string
  /** Older profiles: emoji shown instead of the initial. */
  emoji?: string
  /** Kids profile: only kid-friendly categories, never adult content. */
  kids?: boolean
  /** Hide adult categories and titles (always on for kids profiles). */
  hideAdult?: boolean
  /** Accent colour id (see renderer/theme.ts) or #rrggbb. */
  accent?: string
  /** Background preset id, or `image:<file>` for a picture the person chose. */
  background: string
  /** Live channels starred by this person (stored here while another profile is active). */
  favorites: string[]
  recents: string[]
  myList: ListItem[]
  createdAt: number
  /** Live TV: only channels from these countries (codes from `country.ts`; empty = all). */
  countries?: string[]
  hiddenCategories?: string[]
  hiddenChannels?: string[]
  channelSort?: ChannelSort
  /** Movies & series: countries/languages and categories left out of Home, rows and
   *  recommendations (search still finds them). */
  vodHiddenCountries?: string[]
  vodHiddenCategories?: string[]
}

export type ChannelSort = 'provider' | 'name' | 'number'

export interface SeriesEpisode {
  id: string
  title: string
  season: number
  episode: number
  url: string
  plot?: string
  duration?: string
  /** Episode still/thumbnail, when the provider has one. */
  thumb?: string
}

/** Rich info for a movie or series (Xtream get_vod_info / get_series_info). */
export interface MediaDetails {
  title: string
  poster?: string
  backdrop?: string
  plot?: string
  year?: string
  genre?: string
  /** Rating out of 10, as a display string (e.g. "7.4"). */
  rating?: string
  duration?: string
  cast?: string
  director?: string
}

/** A movie or episode the user has started (for "Continue watching"/resume). */
export interface WatchItem {
  key: string
  kind: 'movie' | 'episode'
  sourceId: string
  /** Movies: catalogue channel id (played via player.load). */
  channelId?: string
  /** Episodes: direct stream URL (played via player.loadUrl). */
  url?: string
  /** Movie title, or the series name for episodes. */
  title: string
  /** Episodes: "S1 E3 · Episode title". */
  subtitle?: string
  poster?: string
  position: number
  duration: number
  updatedAt: number
  finished: boolean
  series?: { id: string; name: string; season: number; episode: number; episodeId: string; title: string }
}

/** Extra info passed when starting VOD playback. */
export interface PlayOptions {
  /** Resume from the saved position (default true). false = start over. */
  resume?: boolean
  poster?: string
  episode?: { seriesId: string; seriesName: string; episodeId: string; season: number; episode: number; title: string }
}

export interface SeriesDetails {
  details: MediaDetails
  episodes: SeriesEpisode[]
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
  /**
   * While `loading`: `connecting` = waiting for the provider to answer;
   * `opening` = the stream is open and the first picture/sound is buffering.
   */
  stage?: 'connecting' | 'opening'
  /** When the current load started (ms epoch), for an elapsed-time readout. */
  loadStartedAt?: number
  channelId?: string
  title?: string
  position: number
  duration: number
  /** 0..100 */
  cacheBufferingPercent?: number
  paused: boolean
  volume: number
  muted: boolean
  /** True once a movie/episode played to its end (cleared on the next load). */
  ended?: boolean
  /** Human-readable error for the UI (addresses "nothing loads" with a reason). */
  error?: string
  /** Audio and subtitle tracks of the current stream (from mpv's track-list). */
  tracks?: { audio: MediaTrack[]; sub: MediaTrack[] }
  /** Live stream stats for a diagnostics overlay. */
  stats?: {
    videoCodec?: string
    audioCodec?: string
    width?: number
    height?: number
    fps?: number
    bitrateKbps?: number
    demuxerCacheSeconds?: number
    /** Current network download speed (bytes/s). */
    downloadBytesPerSec?: number
  }
}

export interface MediaTrack {
  id: number
  title?: string
  /** ISO language code as the stream labels it ("eng", "nl", …). */
  lang?: string
  codec?: string
  channels?: number
  selected: boolean
  external?: boolean
  forced?: boolean
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
  /** Video renderer: `gpu-next` (best), `gpu` (compatible) or `gpu-gl` (OpenGL). */
  videoOutput: string
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
  /** Look of the app ('cinema' is the old name for 'theater'). */
  uiTheme?: 'theater' | 'premium' | 'wonder' | 'glass' | 'classic' | 'cinema'
  /** Play the logo animation when the app starts (default on). */
  intro?: boolean
  /** Settings → Multi-view: watch 2 or 4 live channels at once. */
  multiView?: boolean
  /** Settings → Recording: record live TV and get reminders from the Guide. */
  recordings?: boolean
  /** Where recordings are saved (default: Videos\\ello smartTV). */
  recordFolder?: string
}

/** A live-TV recording (now, or scheduled from the Guide). */
export interface Recording {
  id: string
  channelId: string
  channelName: string
  title: string
  /** ms since 1970 */
  start: number
  stop: number
  status: 'scheduled' | 'recording' | 'done' | 'failed' | 'cancelled'
  file?: string
  error?: string
}

/** "Tell me when it starts" from the Guide. */
export interface Reminder {
  id: string
  channelId: string
  channelName: string
  title: string
  start: number
}

export interface AppTile {
  id: string
  label: string
  /**
   * - `section`: a built-in WindowsTV page.
   * - `web`: a web app opened INSIDE WindowsTV (in-app browser).
   * - `app`: an installed Windows app launched by protocol URI or .exe path.
   */
  kind: 'section' | 'web' | 'app'
  /**
   * - section: 'live' | 'movies' | 'series' | 'settings' | 'guide'
   * - web: the URL to load in-app
   * - app: a protocol URI (e.g. `netflix:`, `spotify:`) or a full path to an .exe
   */
  target: string
  color?: string
  icon?: string
  /** web tiles: optional custom User-Agent (e.g. to request a TV/leanback UI). */
  userAgent?: string
  /** True for the built-in tiles that ship with the app (not user-removable). */
  builtin?: boolean
}

/** Result wrapper so the UI always gets a reason on failure. */
export interface Result<T> {
  ok: boolean
  data?: T
  error?: string
}

/** Progress events emitted while loading a source (so the UI is never silent). */
/** Built-in VPN (WireGuard, only for ello's traffic). */
export interface VpnState {
  enabled: boolean
  status: 'off' | 'connecting' | 'connected' | 'error'
  error?: string
  config?: { name: string; endpoint: string; provider?: string }
}

export interface LoadProgress {
  sourceId: string
  phase: 'connecting' | 'categories' | 'channels' | 'epg' | 'done' | 'error'
  message: string
  count?: number
  /** Background refresh: update the lists, but don't show it on screen. */
  quiet?: boolean
}
