import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { WindowManager } from './windows'
import { MpvPlayer } from './mpv/MpvPlayer'
import { resolveMpvPath } from './mpv/resolveMpv'
import { Catalog } from './services/catalog'
import { registerIpc, type MainContext } from './ipcHandlers'
import { getSettings } from './store'
import { IPC } from '../shared/ipc'
import { initUpdater } from './updater'
import { WatchProgress } from './progress'

const progress = new WatchProgress()

// Single instance only — a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let windows: WindowManager
let player: MpvPlayer
let catalog: Catalog
let mpvInfo: { path?: string; reason?: string }

function buildPlayer(wid: number): MpvPlayer {
  const settings = getSettings()
  mpvInfo = resolveMpvPath(settings.mpvPath)
  const p = new MpvPlayer({
    binaryPath: mpvInfo.path || 'mpv',
    wid,
    userAgent: settings.userAgent,
    cacheSeconds: settings.cacheSeconds,
    hwdec: settings.hwdec,
    videoOutput: settings.videoOutput,
    deinterlace: settings.deinterlace,
    networkTimeoutMs: settings.networkTimeoutMs
  })
  p.on('state', (state) => {
    windows.send(IPC.playerState, state)
    progress.onState(state)
  })
  p.on('log', (line: string) => {
    if (process.env['WTV_DEBUG']) console.log('[mpv]', line.trim())
  })
  return p
}

async function restartPlayer(): Promise<void> {
  try {
    await player.quit()
  } catch {
    /* ignore */
  }
  player = buildPlayer(windows.getVideoWindowId())
  // Re-point IPC context's player reference by re-registering is avoided; instead
  // the context holds a getter — see MainContext below.
  ctx.player = player
}

let ctx: MainContext

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ello.smarttv')

  app.on('browser-window-created', (_, win) => {
    optimizer.watchWindowShortcuts(win)
  })

  windows = new WindowManager()
  windows.create()

  catalog = new Catalog()
  player = buildPlayer(windows.getVideoWindowId())

  ctx = {
    catalog,
    player,
    windows,
    get mpvInfo() {
      return mpvInfo
    },
    restartPlayer,
    updater: initUpdater((state) => windows.send(IPC.updateState, state)),
    progress
  } as unknown as MainContext

  registerIpc(ctx)

  // Start mpv eagerly so the first channel zaps instantly. If mpv is missing the
  // error surfaces through player state, not a crash.
  if (mpvInfo.path) {
    player.start().catch(() => {
      /* state carries the reason */
    })
  }

  // CI video test: play a URL straight after start-up (see .github/workflows/video-test.yml).
  const testUrl = process.env['ELLO_TEST_PLAY']
  if (testUrl) {
    windows.uiWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => void player.load(testUrl, { title: 'Video test' }), 4000)
      const gpuLog = process.env['ELLO_GPU_LOG']
      if (gpuLog) writeFileSync(gpuLog, JSON.stringify(app.getGPUFeatureStatus(), null, 1))
      if (process.env['ELLO_TEST_HIDE_UI']) setTimeout(() => windows.uiWindow.setOpacity(0), 6000)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windows.create()
    }
  })
})

app.on('second-instance', () => {
  if (windows?.uiWindow && !windows.uiWindow.isDestroyed()) {
    if (windows.uiWindow.isMinimized()) windows.uiWindow.restore()
    windows.uiWindow.focus()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', async () => {
  progress.flush()
  try {
    await player?.quit()
  } catch {
    /* ignore */
  }
})
