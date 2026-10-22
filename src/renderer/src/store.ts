import { create } from 'zustand'
import type { WebAppState } from '@shared/ipc'
import type {
  AppSettings,
  Category,
  Channel,
  PlaybackState,
  LoadProgress,
  StreamType
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

  playback: PlaybackState
  playerVisible: boolean
  /** Ordered channel ids for zapping (prev/next) from the player. */
  playQueue: string[]
  /** What kind of content is currently playing (controls live vs VOD UI). */
  nowPlayingKind: StreamType

  /** In-app web browser (e.g. YouTube opened inside WindowsTV). */
  webApp: WebAppState

  // actions
  init: () => Promise<void>
  navigate: (route: RouteName) => void
  setSource: (id: string) => Promise<void>
  loadCatalog: (type: StreamType, force?: boolean) => Promise<void>
  refreshSettings: () => Promise<void>
  toggleFavorite: (channelId: string) => Promise<void>
  play: (channelId: string, queue?: string[]) => Promise<void>
  playEpisode: (url: string, title: string) => Promise<void>
  playAdjacent: (dir: 1 | -1) => Promise<void>
  stopPlayback: () => void
  setPlayerVisible: (v: boolean) => void
  openWebApp: (url: string, userAgent?: string) => void
  closeWebApp: () => void
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
  playback: idlePlayback,
  playerVisible: false,
  playQueue: [],
  nowPlayingKind: 'live',
  webApp: { open: false, url: '', title: '', canGoBack: false, loading: false },

  async init() {
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
    window.api.onCatalogProgress((progress) => {
      set({ progress })
      if (progress.phase === 'done' || progress.phase === 'error') {
        setTimeout(() => {
          if (get().progress === progress) set({ progress: null, loading: false })
        }, 1800)
        // Refresh the in-memory catalogue when a background refresh finishes.
        if (progress.phase === 'done' && progress.sourceId === get().currentSourceId) {
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
    set({ currentSourceId: id, loading: true })
    await window.api.settings.update({ lastSourceId: id })
    await window.api.catalog.load(id, false)
    await get().loadCatalog(get().activeType, false)
    set({ loading: false })
  },

  async loadCatalog(type, force = false) {
    const id = get().currentSourceId
    if (!id) return
    set({ activeType: type })
    if (force) {
      set({ loading: true })
      await window.api.catalog.load(id, true)
    }
    const res = await window.api.catalog.get(id, type)
    if (res.data) {
      set({ channels: res.data.channels, categories: res.data.categories })
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

  async play(channelId, queue) {
    const kind = get().channels.find((c) => c.id === channelId)?.type ?? 'live'
    set({ playerVisible: true, nowPlayingKind: kind })
    if (queue && queue.length) set({ playQueue: queue })
    await window.api.recents.add(channelId)
    await get().refreshSettings()
    await window.api.player.load(channelId)
  },

  async playEpisode(url, title) {
    set({ playerVisible: true, nowPlayingKind: 'series', playQueue: [] })
    await window.api.player.loadUrl(url, title, get().currentSourceId)
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

  closeWebApp() {
    void window.api.webapp.close()
    set({ webApp: { open: false, url: '', title: '', canGoBack: false, loading: false } })
  }
}))
