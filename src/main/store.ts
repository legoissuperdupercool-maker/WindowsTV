import Store from 'electron-store'
import type { AppSettings, AppTile } from '../shared/types'

// Calm, flat solid colors (plain blue / purple / red / amber / green / slate).
const defaultTiles: AppTile[] = [
  { id: 'live', label: 'Live TV', kind: 'section', target: 'live', color: '#3f6fa6', icon: 'live', builtin: true },
  { id: 'guide', label: 'TV Guide', kind: 'section', target: 'guide', color: '#6a62a0', icon: 'guide', builtin: true },
  { id: 'movies', label: 'Movies', kind: 'section', target: 'movies', color: '#b0514e', icon: 'movie', builtin: true },
  { id: 'series', label: 'Series', kind: 'section', target: 'series', color: '#c3a650', icon: 'series', builtin: true },
  { id: 'youtube', label: 'YouTube', kind: 'web', target: 'https://www.youtube.com', color: '#b84a44', icon: 'web' },
  { id: 'settings', label: 'Settings', kind: 'section', target: 'settings', color: '#4a5160', icon: 'settings', builtin: true }
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
