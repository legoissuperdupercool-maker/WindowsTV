import Store from 'electron-store'
import type { AppSettings, AppTile } from '../shared/types'

const defaultTiles: AppTile[] = [
  { id: 'live', label: 'Live TV', kind: 'section', target: 'live', color: '#2f6bff', icon: 'live' },
  { id: 'guide', label: 'TV Guide', kind: 'section', target: 'guide', color: '#7a3cff', icon: 'guide' },
  { id: 'movies', label: 'Movies', kind: 'section', target: 'movies', color: '#ff5a3c', icon: 'movie' },
  { id: 'series', label: 'Series', kind: 'section', target: 'series', color: '#ff9f1c', icon: 'series' },
  { id: 'youtube', label: 'YouTube', kind: 'web', target: 'https://www.youtube.com/tv', color: '#ff0033', icon: 'web' },
  { id: 'settings', label: 'Settings', kind: 'section', target: 'settings', color: '#4b5563', icon: 'settings' }
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
