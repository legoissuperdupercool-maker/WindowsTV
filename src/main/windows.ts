import { BrowserWindow, WebContentsView, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { VideoRegion, WebAppState } from '../shared/ipc'

/** Height (DIP) of the WindowsTV control strip shown above an in-app web app. */
const WEBAPP_BAR = 56

/** Sites whose web players use DRM we can't decode in a stock Electron build. */
const DRM_HINTS: Array<{ re: RegExp; name: string }> = [
  { re: /netflix\.com/i, name: 'Netflix' },
  { re: /disneyplus\.com/i, name: 'Disney+' },
  { re: /(primevideo|amazon)\.[a-z.]+\/.*video/i, name: 'Prime Video' },
  { re: /max\.com|hbomax\.com/i, name: 'Max' },
  { re: /hulu\.com/i, name: 'Hulu' }
]

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
  private webView: WebContentsView | null = null
  private webHome = ''

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

    // Keep the video window glued behind the UI window on any geometry change,
    // and resize the in-app web view to match.
    const reapply = (): void => {
      this.applyRegion()
      this.layoutWebView()
    }
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

  // ------------------------------------------------------------------ in-app web apps

  /** Open a web app INSIDE WindowsTV, below the control strip. */
  openWebApp(url: string, userAgent?: string): void {
    this.webHome = url
    // Hide IPTV video while a web app is in front.
    this.lastRegion = { ...this.lastRegion, visible: false }
    this.applyRegion()

    if (!this.webView) {
      this.webView = new WebContentsView({
        webPreferences: { contextIsolation: true, nodeIntegration: false }
      })
      this.uiWindow.contentView.addChildView(this.webView)
      const wc = this.webView.webContents
      // Keep navigation inside the view instead of spawning OS windows.
      wc.setWindowOpenHandler(({ url: u }) => {
        wc.loadURL(u)
        return { action: 'deny' }
      })
      const emit = (): void => this.emitWebState()
      wc.on('did-navigate', emit)
      wc.on('did-navigate-in-page', emit)
      wc.on('page-title-updated', emit)
      wc.on('did-start-loading', emit)
      wc.on('did-stop-loading', emit)
    }
    if (userAgent) this.webView.webContents.setUserAgent(userAgent)
    this.layoutWebView()
    this.webView.webContents.loadURL(url)
    this.emitWebState()
  }

  closeWebApp(): void {
    if (this.webView) {
      this.uiWindow.contentView.removeChildView(this.webView)
      this.webView.webContents.close()
      this.webView = null
    }
    this.emitWebState()
  }

  webAppBack(): void {
    const wc = this.webView?.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }
  webAppHome(): void {
    if (this.webView && this.webHome) this.webView.webContents.loadURL(this.webHome)
  }
  webAppReload(): void {
    this.webView?.webContents.reload()
  }

  private layoutWebView(): void {
    if (!this.webView || this.uiWindow.isDestroyed()) return
    const { width, height } = this.uiWindow.getContentBounds()
    this.webView.setBounds({ x: 0, y: WEBAPP_BAR, width, height: Math.max(0, height - WEBAPP_BAR) })
  }

  private emitWebState(): void {
    const wc = this.webView?.webContents
    const url = wc?.getURL() ?? ''
    const drm = DRM_HINTS.find((h) => h.re.test(url))
    const state: WebAppState = {
      open: Boolean(this.webView),
      url,
      title: wc?.getTitle() ?? '',
      canGoBack: Boolean(wc?.navigationHistory.canGoBack()),
      loading: Boolean(wc?.isLoading()),
      drmWarning: drm
        ? `${drm.name} uses DRM that won't play inside WindowsTV. Install the ${drm.name} app and add it as an “installed app” tile instead.`
        : undefined
    }
    this.send('webapp:state', state)
  }

  send(channel: string, payload: unknown): void {
    if (!this.uiWindow.isDestroyed()) this.uiWindow.webContents.send(channel, payload)
  }
}

/** Launch an installed Windows app by protocol URI (e.g. `netflix:`) or .exe path. */
export async function launchInstalledApp(target: string): Promise<{ ok: boolean; message: string }> {
  const t = target.trim()
  if (!t) return { ok: false, message: 'No app target set.' }
  // A protocol/URI (scheme:...) with no Windows path separators → openExternal.
  const looksLikeUri = /^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[a-z]:\\/i.test(t)
  try {
    if (looksLikeUri) {
      await shell.openExternal(t)
      return { ok: true, message: 'Launched.' }
    }
    const err = await shell.openPath(t) // returns '' on success
    return err ? { ok: false, message: err } : { ok: true, message: 'Launched.' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
