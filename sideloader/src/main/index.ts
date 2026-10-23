import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { Helper } from './helper'

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
const helper = new Helper((e) => win?.webContents.send('helper:event', e))

function createWindow(): void {
  win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#0e1013',
    title: 'ello Sideloader',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

const ALLOWED = new Set(['devices', 'discover', 'pair', 'check', 'trustUsb', 'forget', 'revealDevMode'])

app.whenReady().then(() => {
  app.setAppUserModelId('com.ello.sideloader')
  ipcMain.handle('apple:call', (_e, cmd: string, args?: Record<string, unknown>) =>
    ALLOWED.has(cmd) ? helper.call(cmd, args) : { ok: false, error: `Unknown command ${cmd}` }
  )
  ipcMain.handle('apple:pin', (_e, pin: string) => helper.sendPin(String(pin)))
  ipcMain.handle('window:control', (_e, action: string) => {
    if (action === 'minimize') win?.minimize()
    else if (action === 'close') win?.close()
  })
  ipcMain.handle('app:version', () => app.getVersion())
  createWindow()
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => {
  helper.stop()
  app.quit()
})
