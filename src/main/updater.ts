import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/ipc'

const { autoUpdater } = electronUpdater

/**
 * Auto-update from the public `ello-smarttv-releases` GitHub repo (configured in
 * electron-builder.yml → `publish`, which writes resources/app-update.yml).
 *
 * Updates download in the background and install when the app quits, or
 * immediately if the user presses "Restart" in the UI. electron-updater checks
 * the installer's SHA-512 from latest.yml before installing.
 *
 * Only the installed (NSIS) build can update itself; the portable EXE and dev
 * runs report `unsupported`.
 */
export function initUpdater(send: (state: UpdateState) => void): {
  check: () => void
  install: () => void
  getState: () => UpdateState
} {
  let state: UpdateState = { status: 'idle', currentVersion: app.getVersion() }
  const set = (patch: Partial<UpdateState>): void => {
    state = { ...state, ...patch }
    send(state)
  }

  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR)
  if (!app.isPackaged || portable) {
    set({
      status: 'unsupported',
      message: portable
        ? 'The portable version can’t update itself — use the installer (Setup.exe) for automatic updates.'
        : 'Updates are only available in the installed app.'
    })
    return { check: () => {}, install: () => {}, getState: () => state }
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', message: undefined }))
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', newVersion: info.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ status: 'up-to-date' }))
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', newVersion: info.version, percent: 100 }))
  autoUpdater.on('error', (err) => {
    // 404 here usually means the releases repo / first release doesn't exist yet.
    const msg = String(err?.message ?? err)
    set({
      status: 'error',
      message: /404|not found/i.test(msg) ? 'No update feed found yet.' : msg.split('\n')[0]
    })
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => {
      /* reported via the 'error' event */
    })
  }

  // First check shortly after launch, then every 4 hours.
  setTimeout(check, 10_000)
  setInterval(check, 4 * 3600_000)

  return {
    check,
    install: () => {
      if (state.status === 'ready') autoUpdater.quitAndInstall(false, true)
    },
    getState: () => state
  }
}
