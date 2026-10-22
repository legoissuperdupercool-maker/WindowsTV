import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type PlayerCommand, type VideoRegion } from '../shared/ipc'
import type {
  AppSettings,
  Category,
  Channel,
  EpgNowNext,
  LoadProgress,
  PlaybackState,
  Programme,
  Result,
  SeriesEpisode,
  Source,
  StreamType
} from '../shared/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  settings: {
    get: () => invoke<AppSettings>(IPC.settingsGet),
    update: (partial: Partial<AppSettings>) => invoke<AppSettings>(IPC.settingsUpdate, partial)
  },
  sources: {
    save: (source: Source) => invoke<AppSettings>(IPC.sourcesSave, source),
    remove: (sourceId: string) => invoke<AppSettings>(IPC.sourcesRemove, sourceId),
    test: (source: Source) => invoke<{ ok: boolean; message: string }>(IPC.sourceTest, source)
  },
  catalog: {
    load: (sourceId: string, force = false) =>
      invoke<{ count: number; cached: boolean }>(IPC.catalogLoad, { sourceId, force }),
    get: (sourceId: string, type?: StreamType) =>
      invoke<{ channels: Channel[]; categories: Category[] }>(IPC.catalogGet, { sourceId, type })
  },
  epg: {
    nowNext: (sourceId: string, epgChannelId?: string, name?: string) =>
      invoke<EpgNowNext>(IPC.epgNowNext, { sourceId, epgChannelId, name }),
    forChannel: (
      sourceId: string,
      epgChannelId: string | undefined,
      name: string | undefined,
      from: number,
      to: number
    ) => invoke<Programme[]>(IPC.epgForChannel, { sourceId, epgChannelId, name, from, to }),
    grid: (
      sourceId: string,
      channels: Array<{ id: string; epgChannelId?: string; name: string }>,
      from: number,
      to: number
    ) => invoke<Record<string, Programme[]>>(IPC.epgGrid, { sourceId, channels, from, to }),
    refresh: (sourceId: string) => invoke<boolean>(IPC.epgRefresh, sourceId)
  },
  series: {
    info: (sourceId: string, seriesId: string) =>
      invoke<SeriesEpisode[]>(IPC.seriesInfo, { sourceId, seriesId })
  },
  favorites: {
    toggle: (channelId: string) => invoke<AppSettings>(IPC.favoriteToggle, channelId)
  },
  recents: {
    add: (channelId: string) => invoke<AppSettings>(IPC.recentAdd, channelId)
  },
  player: {
    load: (channelId: string) => invoke<boolean>(IPC.playerLoad, { channelId }),
    loadUrl: (url: string, title?: string, sourceId?: string) =>
      invoke<boolean>(IPC.playerLoadUrl, { url, title, sourceId }),
    command: (cmd: PlayerCommand) => invoke<boolean>(IPC.playerCommand, cmd),
    setRegion: (region: VideoRegion) => invoke<boolean>(IPC.playerSetRegion, region),
    probe: (channelId: string) =>
      invoke<{ ok: boolean; status?: number; reason?: string }>(IPC.playerProbe, { channelId })
  },
  window: {
    control: (action: 'minimize' | 'maximize' | 'close' | 'fullscreen') =>
      invoke<boolean>(IPC.windowControl, action)
  },
  openExternal: (url: string) => invoke<boolean>(IPC.openExternal, url),
  appInfo: () =>
    invoke<{ mpvPath?: string; mpvReason?: string; versions: NodeJS.ProcessVersions }>(IPC.appInfo),

  onPlayerState: (cb: (s: PlaybackState) => void) => subscribe<PlaybackState>(IPC.playerState, cb),
  onCatalogProgress: (cb: (p: LoadProgress) => void) =>
    subscribe<LoadProgress>(IPC.catalogProgress, cb)
}

contextBridge.exposeInMainWorld('api', api)

export type WindowsTvApi = typeof api
