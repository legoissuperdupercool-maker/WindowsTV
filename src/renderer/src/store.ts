import { create } from 'zustand'
import type { UpdateState, WebAppState } from '@shared/ipc'
import type {
  PlayOptions,
  Programme,
  SeriesEpisode,
  WatchItem,
  AppSettings,
  Category,
  Channel,
  PlaybackState,
  LoadProgress,
  StreamType,
  ListItem,
  Profile
} from '@shared/types'

export type RouteName = 'home' | 'live' | 'movies' | 'series' | 'guide' | 'settings'

interface State {
  ready: boolean
  settings: AppSettings | null
  route: RouteName
  currentSourceId?: string

  // catalogue for the active source + type
  channels: Channel[]
  categories: Category[]
  activeType: StreamType
  loading: boolean
  progress: LoadProgress | null
  /** Last catalogue load failure for the current source (shown on pages). */
  loadError: string | null

  playback: PlaybackState
  playerVisible: boolean
  /** Ordered channel ids for zapping (prev/next) from the player. */
  playQueue: string[]
  /** What kind of content is currently playing (controls live vs VOD UI). */
  nowPlayingKind: StreamType

  /** In-app web browser (e.g. YouTube opened inside WindowsTV). */
  webApp: WebAppState
  update: UpdateState | null
  /** Movie or series whose detail screen is open. */
  detail: Channel | null
  /** Series + episode list behind the episode currently playing. */
  episodeCtx: { series: SeriesRef; episodes: SeriesEpisode[]; index: number } | null
  /** Unfinished movies/episodes for the "Continue watching" row. */
  continueItems: WatchItem[]

  /** Netflix-style profiles; the active one owns favourites, history, My List and background. */
  profiles: Profile[]
  activeProfileId: string | null
  /** "Who's watching?" screen: shown at start when there are several profiles. */
  profilePicker: boolean

  // actions
  init: () => Promise<void>
  navigate: (route: RouteName) => void
  setSource: (id: string) => Promise<void>
  /** Re-download the current source's channels (e.g. the Retry button). */
  reloadSource: () => Promise<void>
  loadCatalog: (type: StreamType, force?: boolean) => Promise<void>
  refreshSettings: () => Promise<void>
  toggleFavorite: (channelId: string) => Promise<void>
  play: (channelId: string, queue?: string[], opts?: PlayOptions) => Promise<void>
  /** Play one episode of a series; the season list enables "next episode". */
  playEpisode: (series: SeriesRef, episodes: SeriesEpisode[], index: number, opts?: PlayOptions) => Promise<void>
  playNextEpisode: () => Promise<void>
  /** Replay a past programme (catch-up). */
  playCatchup: (channel: Channel, p: Programme) => Promise<void>
  /** Resume a "Continue watching" item. */
  resumeItem: (item: WatchItem) => Promise<void>
  refreshContinue: () => Promise<void>
  playAdjacent: (dir: 1 | -1) => Promise<void>
  stopPlayback: () => void
  setPlayerVisible: (v: boolean) => void
  openWebApp: (url: string, userAgent?: string) => void
  openDetail: (c: Channel) => void
  closeDetail: () => void
  /** Get a list (cached) without making it the active tab's list. */
  fetchList: (type: StreamType) => Promise<Channel[]>
  closeWebApp: () => void
  loadProfiles: () => Promise<void>
  selectProfile: (id: string) => Promise<void>
  saveProfile: (p: Partial<Profile> & { name: string }) => Promise<string | null>
  deleteProfile: (id: string) => Promise<string | null>
  pickBackground: (id: string) => Promise<string | null>
  setProfilePicker: (open: boolean) => void
  /** Add/remove a movie or series from the active profile's My List. */
  toggleMyList: (c: Channel) => Promise<void>
}

/** The active profile (or undefined before profiles load). */
export function activeProfile(s: { profiles: Profile[]; activeProfileId: string | null }): Profile | undefined {
  return s.profiles.find((p) => p.id === s.activeProfileId)
}

/**
 * Per-source, per-type list cache (`${sourceId}:${type}`). Lists can be tens of
 * thousands of items, so each is fetched from the main process once and reused
 * on every tab switch, until the source is reloaded or changed.
 */
const listCache = new Map<string, { channels: Channel[]; categories: Category[] }>()
function clearListCache(sourceId?: string): void {
  for (const k of [...listCache.keys()]) if (!sourceId || k.startsWith(sourceId + ':')) listCache.delete(k)
}

/** Enough about a series to play its episodes and label them. */
export interface SeriesRef {
  id: string
  name: string
  sourceId: string
  poster?: string
}

const idlePlayback: PlaybackState = {
  status: 'idle',
  position: 0,
  duration: 0,
  paused: false,
  volume: 100,
  muted: false,
  stats: {}
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: null,
  route: 'home',
  channels: [],
  categories: [],
  activeType: 'live',
  loading: false,
  progress: null,
  loadError: null,
  playback: idlePlayback,
  playerVisible: false,
  playQueue: [],
  nowPlayingKind: 'live',
  webApp: { open: false, url: '', title: '', canGoBack: false, loading: false },
  update: null,
  detail: null,
  episodeCtx: null,
  continueItems: [],
  profiles: [],
  activeProfileId: null,
  profilePicker: false,

  async init() {
    await get().loadProfiles()
    set({ profilePicker: get().profiles.length > 1 })
    const res = await window.api.settings.get()
    const settings = res.data ?? null
    const currentSourceId =
      settings?.lastSourceId && settings.sources.some((s) => s.id === settings.lastSourceId)
        ? settings.lastSourceId
        : settings?.sources.find((s) => s.enabled)?.id

    // Live player state + load progress streams.
    window.api.onPlayerState((playback) => {
      set({ playback })
      if (playback.status !== 'idle') set({ playerVisible: true })
    })
    window.api.onWebAppState((webApp) => set({ webApp }))
    window.api.onUpdateState((update) => set({ update }))
    void window.api.updates.getState().then((r) => r.data && set({ update: r.data }))
    window.api.onCatalogProgress((progress) => {
      if (progress.quiet) {
        // Background refresh: just pick up the new lists when it's done.
        if (progress.phase === 'done' && progress.sourceId === get().currentSourceId) {
          clearListCache(progress.sourceId)
          void get().loadCatalog(get().activeType, false)
        }
        return
      }
      set({ progress })
      if (progress.sourceId === get().currentSourceId) {
        if (progress.phase === 'error') set({ loadError: progress.message })
        if (progress.phase === 'done') set({ loadError: null })
      }
      if (progress.phase === 'done' || progress.phase === 'error') {
        // Errors stay on screen longer than success messages.
        setTimeout(() => {
          if (get().progress === progress) set({ progress: null, loading: false })
        }, progress.phase === 'error' ? 8000 : 1800)
        // Refresh the in-memory catalogue when a background refresh finishes.
        if (progress.phase === 'done' && progress.sourceId === get().currentSourceId) {
          clearListCache(progress.sourceId)
          void get().loadCatalog(get().activeType, false)
        }
      }
    })

    set({ settings, currentSourceId, ready: true })
    if (currentSourceId) {
      await get().setSource(currentSourceId)
    }
  },

  navigate(route) {
    set({ route })
  },

  async setSource(id) {
    clearListCache(id)
    set({ currentSourceId: id, loading: true, loadError: null, channels: [], categories: [] })
    await window.api.settings.update({ lastSourceId: id })
    const res = await window.api.catalog.load(id, false)
    if (!res.ok) set({ loadError: res.error ?? 'Could not load this source.' })
    await get().loadCatalog(get().activeType, false)
    set({ loading: false })
    void get().refreshContinue()
  },

  async reloadSource() {
    const id = get().currentSourceId
    if (!id) return
    set({ loading: true, loadError: null })
    clearListCache(id)
    const res = await window.api.catalog.load(id, true)
    if (!res.ok) set({ loadError: res.error ?? 'Could not load this source.' })
    await get().loadCatalog(get().activeType, false)
    set({ loading: false })
  },

  async loadCatalog(type, force = false) {
    const id = get().currentSourceId
    if (!id) return
    set({ activeType: type })
    const key = `${id}:${type}`
    if (force) {
      set({ loading: true })
      clearListCache(id)
      await window.api.catalog.load(id, true)
    }
    const cached = listCache.get(key)
    if (cached) {
      set({ channels: cached.channels, categories: cached.categories })
    } else {
      const res = await window.api.catalog.get(id, type)
      if (res.data) {
        const list = { channels: res.data.channels, categories: res.data.categories }
        if (list.channels.length) listCache.set(key, list)
        // Ignore a slow response if the user has already moved to another tab/source.
        if (get().activeType === type && get().currentSourceId === id) {
          set({ channels: list.channels, categories: list.categories })
        }
      }
    }
    if (force) set({ loading: false })
  },

  async refreshSettings() {
    const res = await window.api.settings.get()
    if (res.data) set({ settings: res.data })
  },

  async toggleFavorite(channelId) {
    const res = await window.api.favorites.toggle(channelId)
    if (res.data) set({ settings: res.data })
  },

  async play(channelId, queue, opts) {
    // Channel ids are `${sourceId}:${type}:${providerId}`, so the type is known
    // even when a different list (e.g. live) is the active one.
    const kind = (channelId.split(':')[1] as StreamType) || 'live'
    set({ playerVisible: true, nowPlayingKind: kind, episodeCtx: null })
    if (queue && queue.length) set({ playQueue: queue })
    if (kind === 'live') {
      await window.api.recents.add(channelId)
      await get().refreshSettings()
    }
    await window.api.player.load(channelId, opts)
  },

  async playEpisode(series, episodes, index, opts) {
    const ep = episodes[index]
    if (!ep) return
    set({ playerVisible: true, nowPlayingKind: 'series', playQueue: [], episodeCtx: { series, episodes, index } })
    await window.api.player.loadUrl(ep.url, `${series.name} · S${ep.season} E${ep.episode} ${ep.title}`, series.sourceId, {
      ...opts,
      poster: ep.thumb ?? series.poster,
      episode: { seriesId: series.id, seriesName: series.name, episodeId: ep.id, season: ep.season, episode: ep.episode, title: ep.title }
    })
  },

  async playCatchup(channel, p) {
    set({ playerVisible: true, nowPlayingKind: 'movie', episodeCtx: null, playQueue: [] })
    const res = await window.api.player.catchup(channel.id, p.start, p.stop, `${channel.name} · ${p.title} (catch-up)`)
    if (!res.ok) {
      set({ playback: { ...get().playback, status: 'error', error: res.error ?? 'Catch-up failed.', title: p.title } })
    }
  },

  async playNextEpisode() {
    const ctx = get().episodeCtx
    if (!ctx || ctx.index + 1 >= ctx.episodes.length) return
    await get().playEpisode(ctx.series, ctx.episodes, ctx.index + 1, { resume: false })
  },

  async resumeItem(item) {
    if (item.kind === 'movie' && item.channelId) {
      await get().play(item.channelId, undefined, { poster: item.poster })
      return
    }
    if (item.kind === 'episode' && item.series && item.url) {
      // Load the full episode list so "next episode" works after this one.
      const series: SeriesRef = { id: item.series.id, name: item.series.name, sourceId: item.sourceId, poster: item.poster }
      const res = await window.api.series.info(item.sourceId, item.series.id)
      const episodes = res.data?.episodes ?? []
      const index = episodes.findIndex((e) => e.id === item.series!.episodeId)
      if (index >= 0) await get().playEpisode(series, episodes, index)
      else
        await get().playEpisode(series, [{ id: item.series.episodeId, title: item.series.title, season: item.series.season, episode: item.series.episode, url: item.url }], 0)
    }
  },

  async refreshContinue() {
    const res = await window.api.progress.list(get().currentSourceId)
    if (res.data) set({ continueItems: res.data })
  },

  async playAdjacent(dir) {
    const { playQueue, playback } = get()
    if (!playQueue.length || !playback.channelId) return
    const idx = playQueue.indexOf(playback.channelId)
    if (idx < 0) return
    const nextIdx = (idx + dir + playQueue.length) % playQueue.length
    await get().play(playQueue[nextIdx])
  },

  stopPlayback() {
    // Positions are saved by the main process; refresh the row shortly after.
    setTimeout(() => void get().refreshContinue(), 300)
    window.api.player.command({ action: 'stop' })
    window.api.player.setRegion({ x: 0, y: 0, width: 0, height: 0, visible: false })
    set({ playerVisible: false, playback: idlePlayback })
  },

  setPlayerVisible(v) {
    set({ playerVisible: v })
    if (!v) {
      window.api.player.setRegion({ x: 0, y: 0, width: 0, height: 0, visible: false })
    }
  },

  openWebApp(url, userAgent) {
    // Stop IPTV playback so the two don't fight over the screen.
    if (useStore.getState().playerVisible) get().stopPlayback()
    set({ webApp: { open: true, url, title: '', canGoBack: false, loading: true } })
    void window.api.webapp.open(url, userAgent)
  },

  openDetail(c) {
    set({ detail: c })
  },

  closeDetail() {
    set({ detail: null })
  },

  async fetchList(type) {
    const id = get().currentSourceId
    if (!id) return []
    const key = `${id}:${type}`
    const cached = listCache.get(key)
    if (cached) return cached.channels
    const res = await window.api.catalog.get(id, type)
    if (!res.data) return []
    const list = { channels: res.data.channels, categories: res.data.categories }
    if (list.channels.length) listCache.set(key, list)
    return list.channels
  },

  async loadProfiles() {
    const res = await window.api.profiles.get()
    if (res.data) set({ profiles: res.data.profiles, activeProfileId: res.data.activeId })
  },

  async selectProfile(id) {
    if (id !== get().activeProfileId) {
      if (get().playerVisible) get().stopPlayback()
      const res = await window.api.profiles.select(id)
      if (res.data) set({ profiles: res.data.profiles, activeProfileId: res.data.activeId })
      await get().refreshSettings()
      void get().refreshContinue()
    }
    set({ profilePicker: false, route: 'home', detail: null })
  },

  async saveProfile(p) {
    const res = await window.api.profiles.save(p)
    if (!res.data) return res.error ?? 'Couldn’t save the profile.'
    set({ profiles: res.data.profiles, activeProfileId: res.data.activeId })
    return null
  },

  async deleteProfile(id) {
    const res = await window.api.profiles.remove(id)
    if (!res.data) return res.error ?? 'Couldn’t delete the profile.'
    set({ profiles: res.data.profiles, activeProfileId: res.data.activeId })
    await get().refreshSettings()
    void get().refreshContinue()
    return null
  },

  async pickBackground(id) {
    const res = await window.api.profiles.pickBackground(id)
    if (!res.ok) return res.error ?? 'Couldn’t use that picture.'
    if (res.data) set({ profiles: res.data.profiles, activeProfileId: res.data.activeId })
    return null
  },

  setProfilePicker(open) {
    set({ profilePicker: open })
  },

  async toggleMyList(c) {
    if (c.type !== 'movie' && c.type !== 'series') return
    const item: ListItem = {
      key: c.id,
      sourceId: c.sourceId,
      kind: c.type,
      title: c.name,
      poster: c.logo,
      group: c.group,
      addedAt: Date.now()
    }
    const res = await window.api.myList.toggle(item)
    if (res.data) {
      const myList = res.data
      set({ profiles: get().profiles.map((p) => (p.id === get().activeProfileId ? { ...p, myList } : p)) })
    }
  },

  closeWebApp() {
    void window.api.webapp.close()
    set({ webApp: { open: false, url: '', title: '', canGoBack: false, loading: false } })
  }
}))
