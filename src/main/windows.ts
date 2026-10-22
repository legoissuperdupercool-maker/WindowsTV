import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { VideoRegion } from '../shared/ipc'

/**
 * Layered-window video compositing.
 *
 *   ┌─────────────────────────────┐  uiWindow  (transparent, frameless, focused)
 *   │   React UI · controls · OSD  │  → owns ALL keyboard/mouse input + the taskbar
 *   │   ┌───────────────────────┐ │
 *   │   │   (transparent hole)   │ │  videoWindow (opaque, just beneath, passive)
 *   │   │   mpv draws here       │ │  → mpv --wid renders into this window
 *   │   └───────────────────────┘ │
 *   └─────────────────────────────┘
 *
 * The two windows are independent top-level windows (no owner/child relationship,
 * which on Windows can drop the main window from the taskbar). The video window is
 * created `focusable: false` and ignores mouse events, so it is a purely passive
 * display surface that never steals focus or input — the UI window always stays in
 * front as the active window. We keep the video window glued to the UI window's
 * content rectangle (or a sub-rectangle for previews) and show/hide it to match the
 * UI. mpv has no key bindings of its own, so input never needs to reach it.
 */
export class WindowManager {
  uiWindow!: BrowserWindow
  videoWindow!: BrowserWindow
  private lastRegion: VideoRegion = { x: 0, y: 0, width: 0, height: 0, visible: false }

  create(): void {
    // The video window is created first so we can hand mpv its native handle.
    this.videoWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      frame: false,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      backgroundColor: '#000000',
      webPreferences: { offscreen: false }
    })
    this.videoWindow.setIgnoreMouseEvents(true)
    this.videoWindow.loadURL('data:text/html,<body style="margin:0;background:#000"></body>')

    this.uiWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      minWidth: 900,
      minHeight: 560,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      title: 'WindowsTV',
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    this.uiWindow.once('ready-to-show', () => {
      this.uiWindow.show()
      this.uiWindow.focus()
    })

    this.uiWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    // Keep the video window glued behind the UI window on any geometry change.
    const reapply = (): void => this.applyRegion()
    this.uiWindow.on('move', reapply)
    this.uiWindow.on('resize', reapply)
    this.uiWindow.on('maximize', reapply)
    this.uiWindow.on('unmaximize', reapply)
    this.uiWindow.on('enter-full-screen', reapply)
    this.uiWindow.on('leave-full-screen', reapply)
    this.uiWindow.on('restore', reapply)
    this.uiWindow.on('minimize', () => {
      if (!this.videoWindow.isDestroyed()) this.videoWindow.hide()
    })
    this.uiWindow.on('focus', () => {
      // Bring the video surface back up directly beneath us without taking focus.
      if (!this.videoWindow.isDestroyed() && this.lastRegion.visible) {
        this.videoWindow.showInactive()
      }
    })
    this.uiWindow.on('closed', () => {
      if (!this.videoWindow.isDestroyed()) this.videoWindow.destroy()
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.uiWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      this.uiWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  /** HWND (as a number) of the video window, for mpv --wid. */
  getVideoWindowId(): number {
    const buf = this.videoWindow.getNativeWindowHandle()
    if (buf.length >= 8) return Number(buf.readBigUInt64LE(0))
    return buf.readUInt32LE(0)
  }

  /** Position the video window to match a region reported by the renderer. */
  setVideoRegion(region: VideoRegion): void {
    this.lastRegion = region
    this.applyRegion()
  }

  private applyRegion(): void {
    if (this.videoWindow.isDestroyed() || this.uiWindow.isDestroyed()) return
    const region = this.lastRegion
    if (!region.visible || this.uiWindow.isMinimized()) {
      if (this.videoWindow.isVisible()) this.videoWindow.hide()
      return
    }
    const content = this.uiWindow.getContentBounds()
    this.videoWindow.setBounds({
      x: Math.round(content.x + region.x),
      y: Math.round(content.y + region.y),
      width: Math.max(16, Math.round(region.width)),
      height: Math.max(16, Math.round(region.height))
    })
    // showInactive() both shows the surface and raises it just beneath the
    // focused UI window, without stealing focus.
    this.videoWindow.showInactive()
    this.uiWindow.focus()
  }

  control(action: string): void {
    const w = this.uiWindow
    switch (action) {
      case 'minimize':
        w.minimize()
        break
      case 'maximize':
        w.isMaximized() ? w.unmaximize() : w.maximize()
        break
      case 'close':
        w.close()
        break
      case 'fullscreen':
        w.setFullScreen(!w.isFullScreen())
        break
    }
  }

  send(channel: string, payload: unknown): void {
    if (!this.uiWindow.isDestroyed()) this.uiWindow.webContents.send(channel, payload)
  }
}
