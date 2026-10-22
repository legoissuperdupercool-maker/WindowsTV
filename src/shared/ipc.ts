// Canonical IPC channel names, shared by main + preload so they never drift.

export const IPC = {
  // Settings / sources
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
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

  // Player (mpv)
  playerLoad: 'player:load',
  playerLoadUrl: 'player:loadUrl',
  playerCommand: 'player:command', // generic: play/pause/stop/seek/volume…
  playerState: 'player:state', // main -> renderer event
  playerSetRegion: 'player:setRegion', // renderer tells main where video should draw
  playerProbe: 'player:probe', // test if a url plays before committing

  // Windowing
  windowControl: 'window:control', // minimize/maximize/close/fullscreen
  overlayClickThrough: 'overlay:clickThrough',

  // Misc
  openExternal: 'app:openExternal',
  appInfo: 'app:info'
} as const

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
    | 'setSubTrack'
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
