import Store from 'electron-store'
import type { AppSettings, AppTile } from '../shared/types'

// Bright, flat solid colours for the built-in sections. Brand tiles (YouTube,
// Netflix, …) get their own brand colour + logo automatically in the UI.
// Installed-app targets are best-effort protocol links; edit them in Settings.
const defaultTiles: AppTile[] = [
  { id: 'live', label: 'Live TV', kind: 'section', target: 'live', color: '#2979FF', icon: 'live', builtin: true },
  { id: 'guide', label: 'TV Guide', kind: 'section', target: 'guide', color: '#7C4DFF', icon: 'guide', builtin: true },
  { id: 'movies', label: 'Movies', kind: 'section', target: 'movies', color: '#FF3B30', icon: 'movie', builtin: true },
  { id: 'series', label: 'Series', kind: 'section', target: 'series', color: '#FF9F0A', icon: 'series', builtin: true },
  { id: 'youtube', label: 'YouTube', kind: 'web', target: 'https://www.youtube.com', icon: 'web' },
  { id: 'netflix', label: 'Netflix', kind: 'app', target: 'netflix:', icon: 'tv' },
  { id: 'disney', label: 'Disney+', kind: 'app', target: 'disneyplus:', icon: 'tv' },
  { id: 'prime', label: 'Prime Video', kind: 'app', target: 'primevideo:', icon: 'tv' },
  { id: 'spotify', label: 'Spotify', kind: 'app', target: 'spotify:', icon: 'tv' },
  { id: 'settings', label: 'Settings', kind: 'section', target: 'settings', color: '#34C759', icon: 'settings', builtin: true }
]

const defaults: AppSettings = {
  sources: [],
  favorites: [],
  recents: [],
  mpvPath: '',
  // VLC's UA is widely accepted by IPTV panels; users can override per source.
  userAgent: 'VLC/3.0.20 LibVLC/3.0.20',
  cacheSeconds: 30,
  hwdec: 'auto-safe',
  deinterlace: true,
  networkTimeoutMs: 15000,
  epgTtlHours: 12,
  appTiles: defaultTiles,
  lastSourceId: undefined
}

// electron-store persists JSON to userData/config.json.
export const store = new Store<AppSettings>({ defaults, name: 'windowstv-settings' })

export function getSettings(): AppSettings {
  // Merge in case new default keys were added since the file was written.
  return { ...defaults, ...store.store, appTiles: store.get('appTiles') || defaultTiles }
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  for (const [k, v] of Object.entries(partial)) {
    store.set(k, v as never)
  }
  return getSettings()
}
