// Canonical IPC channel names, shared by main + preload so they never drift.

export const IPC = {
  // Settings / sources
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  licenseGet: 'license:get',
  licenseSet: 'license:set',
  licenseRefresh: 'license:refresh',
  licenseRemove: 'license:remove',
  sourcesSave: 'sources:save',
  sourcesRemove: 'sources:remove',
  sourceTest: 'sources:test',

  // Catalogue (channels / vod / categories)
  catalogLoad: 'catalog:load',
  catalogGet: 'catalog:get',
  catalogProgress: 'catalog:progress', // main -> renderer event

  // EPG
  epgNowNext: 'epg:nowNext',
  epgForChannel: 'epg:forChannel',
  epgGrid: 'epg:grid',
  epgRefresh: 'epg:refresh',

  // Favorites / recents
  favoriteToggle: 'favorite:toggle',
  recentAdd: 'recent:add',

  // Catalogue extras
  seriesInfo: 'series:info',
  vodInfo: 'vod:info',

  // Watch progress (continue watching / resume)
  progressList: 'progress:list',
  progressGet: 'progress:get',
  progressSeries: 'progress:series',

  // Player (mpv)
  playerLoad: 'player:load',
  playerLoadUrl: 'player:loadUrl',
  playerCatchup: 'player:catchup',
  playerCommand: 'player:command', // generic: play/pause/stop/seek/volume…
  playerState: 'player:state', // main -> renderer event
  playerSetRegion: 'player:setRegion', // renderer tells main where video should draw
  playerProbe: 'player:probe', // test if a url plays before committing

  // Windowing
  windowControl: 'window:control', // minimize/maximize/close/fullscreen
  overlayClickThrough: 'overlay:clickThrough',

  // In-app browser (web apps rendered inside WindowsTV)
  webappOpen: 'webapp:open',
  webappClose: 'webapp:close',
  webappBack: 'webapp:back',
  webappHome: 'webapp:home',
  webappReload: 'webapp:reload',
  webappState: 'webapp:state', // main -> renderer event

  // Launch an installed Windows app (Store/desktop) by protocol or path
  appLaunch: 'app:launch',
  devicePreview: 'app:device-preview',

  // Auto-update
  updateState: 'update:state', // main -> renderer event
  updateGetState: 'update:getState',
  updateCheck: 'update:check',
  updateInstall: 'update:install',

  // Profiles (who's watching), My List, backgrounds
  profilesGet: 'profiles:get',
  profileSelect: 'profiles:select',
  profileSave: 'profiles:save',
  profileDelete: 'profiles:delete',
  profilePickBackground: 'profiles:pickBackground',
  profileBackgroundImage: 'profiles:backgroundImage',
  profilePickAvatar: 'profiles:pickAvatar',
  profileAvatarImage: 'profiles:avatarImage',
  myListToggle: 'mylist:toggle',
  progressHistory: 'progress:history',

  // Built-in VPN
  vpnGet: 'vpn:get',
  vpnImport: 'vpn:import',
  vpnSetEnabled: 'vpn:setEnabled',
  vpnRemove: 'vpn:remove',
  vpnCheck: 'vpn:check',
  vpnState: 'vpn:state', // main -> renderer event

  // Multi-view (2 or 4 live channels at once)
  multiviewLayout: 'multiview:layout',
  multiviewLoad: 'multiview:load',
  multiviewClear: 'multiview:clear',
  multiviewAudio: 'multiview:audio',
  multiviewRegions: 'multiview:regions',
  multiviewStop: 'multiview:stop',
  multiviewState: 'multiview:state', // main -> renderer event

  // Recording + reminders
  recList: 'rec:list',
  recNow: 'rec:now',
  recSchedule: 'rec:schedule',
  recStop: 'rec:stop',
  recRemove: 'rec:remove',
  recReminderAdd: 'rec:reminderAdd',
  recReminderRemove: 'rec:reminderRemove',
  recPickFolder: 'rec:pickFolder',
  recOpenFolder: 'rec:openFolder',
  recChanged: 'rec:changed', // main -> renderer event
  reminderPlay: 'rec:reminderPlay', // main -> renderer event

  // Misc
  openExternal: 'app:openExternal',
  appInfo: 'app:info'
} as const

export interface WebAppState {
  open: boolean
  url: string
  title: string
  canGoBack: boolean
  loading: boolean
  /** Set when a site is known to require DRM we can't play in-app. */
  drmWarning?: string
}

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface PlayerCommand {
  action:
    | 'play'
    | 'pause'
    | 'toggle'
    | 'stop'
    | 'seek' // value = seconds (absolute)
    | 'seekRelative' // value = delta seconds
    | 'volume' // value = 0..100
    | 'mute'
    | 'unmute'
    | 'toggleMute'
    | 'cycleAudio'
    | 'cycleSub'
    | 'setAudioTrack'
    | 'setSubTrack' // value = track id, 0 = off
    | 'subScale' // value = 1 normal
    | 'subDelay' // value = seconds
    | 'audioDelay' // value = seconds
  value?: number
}

export interface VideoRegion {
  /** Device-independent pixels relative to the window content area. */
  x: number
  y: number
  width: number
  height: number
  /** When false, mpv is hidden (home screen / browsing with no video). */
  visible: boolean
}

export interface UpdateState {
  status: 'idle' | 'unsupported' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error'
  currentVersion: string
  newVersion?: string
  percent?: number
  message?: string
}
