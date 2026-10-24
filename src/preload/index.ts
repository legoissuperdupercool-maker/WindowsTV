import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type PlayerCommand, type UpdateState, type VideoRegion, type WebAppState } from '../shared/ipc'
import type {
  AppSettings,
  Category,
  Channel,
  EpgNowNext,
  LoadProgress,
  PlaybackState,
  Programme,
  Recording,
  Reminder,
  Result,
  MediaDetails,
  PlayOptions,
  WatchItem,
  ListItem,
  VpnState,
  Profile,
  SeriesDetails,
  Source,
  StreamType
} from '../shared/types'

export interface ProfilesState {
  activeId: string
  profiles: Profile[]
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  /** Scripted UI test run (ELLO_UI_STEPS): exposes the store to the test steps. */
  testMode: Boolean(process.env['ELLO_UI_STEPS']),
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
    get: (sourceId: string, type?: StreamType, offset?: number, limit?: number) =>
      invoke<{ channels: Channel[]; categories: Category[]; total: number }>(IPC.catalogGet, { sourceId, type, offset, limit })
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
      invoke<SeriesDetails>(IPC.seriesInfo, { sourceId, seriesId })
  },
  progress: {
    list: (sourceId?: string) => invoke<WatchItem[]>(IPC.progressList, sourceId),
    history: (sourceId?: string) => invoke<WatchItem[]>(IPC.progressHistory, sourceId),
    get: (key: string) => invoke<WatchItem | null>(IPC.progressGet, key),
    series: (sourceId: string, seriesId: string) =>
      invoke<Record<string, WatchItem>>(IPC.progressSeries, { sourceId, seriesId })
  },
  vod: {
    info: (sourceId: string, vodId: string) => invoke<MediaDetails>(IPC.vodInfo, { sourceId, vodId })
  },
  profiles: {
    get: () => invoke<ProfilesState>(IPC.profilesGet),
    select: (id: string) => invoke<ProfilesState>(IPC.profileSelect, id),
    save: (p: Partial<Profile> & { name: string }) => invoke<ProfilesState>(IPC.profileSave, p),
    remove: (id: string) => invoke<ProfilesState>(IPC.profileDelete, id),
    pickBackground: (id: string) => invoke<ProfilesState | null>(IPC.profilePickBackground, id),
    backgroundImage: (background: string) => invoke<string | null>(IPC.profileBackgroundImage, background),
    pickAvatar: () => invoke<string | null>(IPC.profilePickAvatar),
    avatarImage: (avatar: string) => invoke<string | null>(IPC.profileAvatarImage, avatar)
  },
  vpn: {
    get: () => invoke<VpnState>(IPC.vpnGet),
    importConfig: () => invoke<VpnState | null>(IPC.vpnImport),
    setEnabled: (enabled: boolean) => invoke<VpnState>(IPC.vpnSetEnabled, enabled),
    remove: () => invoke<VpnState>(IPC.vpnRemove),
    check: () => invoke<{ ip: string; country?: string; city?: string; mullvad?: boolean }>(IPC.vpnCheck)
  },
  onVpnState: (cb: (s: VpnState) => void) => subscribe<VpnState>(IPC.vpnState, cb),
  myList: {
    toggle: (item: ListItem) => invoke<ListItem[]>(IPC.myListToggle, item)
  },
  favorites: {
    toggle: (channelId: string) => invoke<AppSettings>(IPC.favoriteToggle, channelId)
  },
  recents: {
    add: (channelId: string) => invoke<AppSettings>(IPC.recentAdd, channelId)
  },
  player: {
    load: (channelId: string, opts?: PlayOptions) => invoke<boolean>(IPC.playerLoad, { channelId, opts }),
    loadUrl: (url: string, title?: string, sourceId?: string, opts?: PlayOptions) =>
      invoke<boolean>(IPC.playerLoadUrl, { url, title, sourceId, opts }),
    catchup: (channelId: string, start: number, stop: number, title?: string) =>
      invoke<boolean>(IPC.playerCatchup, { channelId, start, stop, title }),
    command: (cmd: PlayerCommand) => invoke<boolean>(IPC.playerCommand, cmd),
    setRegion: (region: VideoRegion) => invoke<boolean>(IPC.playerSetRegion, region),
    probe: (channelId: string) =>
      invoke<{ ok: boolean; status?: number; reason?: string }>(IPC.playerProbe, { channelId })
  },
  multiview: {
    layout: (n: number) => invoke<boolean>(IPC.multiviewLayout, n),
    load: (index: number, channelId: string) => invoke<boolean>(IPC.multiviewLoad, { index, channelId }),
    clear: (index: number) => invoke<boolean>(IPC.multiviewClear, index),
    audio: (index: number) => invoke<boolean>(IPC.multiviewAudio, index),
    regions: (regions: VideoRegion[]) => invoke<boolean>(IPC.multiviewRegions, regions),
    stop: () => invoke<boolean>(IPC.multiviewStop),
    onState: (cb: (e: { index: number; state: PlaybackState }) => void) =>
      subscribe<{ index: number; state: PlaybackState }>(IPC.multiviewState, cb)
  },
  recordings: {
    list: () => invoke<{ recordings: Recording[]; reminders: Reminder[]; folder: string }>(IPC.recList),
    now: (channelId: string, title?: string, stop?: number) => invoke<Recording>(IPC.recNow, { channelId, title, stop }),
    schedule: (channelId: string, title: string, start: number, stop: number) =>
      invoke<Recording>(IPC.recSchedule, { channelId, title, start, stop }),
    stop: (id: string) => invoke<boolean>(IPC.recStop, id),
    remove: (id: string) => invoke<boolean>(IPC.recRemove, id),
    remind: (channelId: string, title: string, start: number) => invoke<Reminder>(IPC.recReminderAdd, { channelId, title, start }),
    removeReminder: (id: string) => invoke<boolean>(IPC.recReminderRemove, id),
    pickFolder: () => invoke<string | null>(IPC.recPickFolder),
    openFolder: (file?: string) => invoke<boolean>(IPC.recOpenFolder, file),
    onChange: (cb: () => void) => subscribe<null>(IPC.recChanged, () => cb()),
    onReminderPlay: (cb: (channelId: string) => void) => subscribe<string>(IPC.reminderPlay, cb)
  },
  window: {
    control: (action: 'minimize' | 'maximize' | 'close' | 'fullscreen' | 'fullscreenOff' | 'pip' | 'pipOff') =>
      invoke<boolean>(IPC.windowControl, action),
    /** Fullscreen / picture-in-picture changes. */
    onMode: (cb: (m: { fullscreen: boolean; pip: boolean }) => void) => subscribe<{ fullscreen: boolean; pip: boolean }>('window:mode', cb)
  },
  webapp: {
    open: (url: string, userAgent?: string) => invoke<boolean>(IPC.webappOpen, { url, userAgent }),
    close: () => invoke<boolean>(IPC.webappClose),
    back: () => invoke<boolean>(IPC.webappBack),
    home: () => invoke<boolean>(IPC.webappHome),
    reload: () => invoke<boolean>(IPC.webappReload)
  },
  updates: {
    getState: () => invoke<UpdateState>(IPC.updateGetState),
    check: () => invoke<boolean>(IPC.updateCheck),
    install: () => invoke<boolean>(IPC.updateInstall)
  },
  launchApp: (target: string) => invoke<{ ok: boolean; message: string }>(IPC.appLaunch, target),
  openExternal: (url: string) => invoke<boolean>(IPC.openExternal, url),
  appInfo: () =>
    invoke<{ version: string; mpvPath?: string; mpvReason?: string; versions: NodeJS.ProcessVersions }>(IPC.appInfo),

  onPlayerState: (cb: (s: PlaybackState) => void) => subscribe<PlaybackState>(IPC.playerState, cb),
  onCatalogProgress: (cb: (p: LoadProgress) => void) =>
    subscribe<LoadProgress>(IPC.catalogProgress, cb),
  onWebAppState: (cb: (s: WebAppState) => void) => subscribe<WebAppState>(IPC.webappState, cb),
  onUpdateState: (cb: (s: UpdateState) => void) => subscribe<UpdateState>(IPC.updateState, cb)
}

contextBridge.exposeInMainWorld('api', api)

export type WindowsTvApi = typeof api
