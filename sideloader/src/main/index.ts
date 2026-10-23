import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { Helper } from './helper'
import type { AccountState, DevicesResult } from '../shared/types'

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
  // Test hook: screenshots of the Devices and Apple ID tabs (CI / development only).
  const shots = process.env['ELLO_SHOT_DIR']
  if (shots) {
    win.webContents.once('did-finish-load', async () => {
      const { writeFileSync } = await import('node:fs')
      const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      await wait(6000)
      writeFileSync(join(shots, 'devices.png'), (await win!.webContents.capturePage()).toPNG())
      await win!.webContents.executeJavaScript("document.querySelectorAll('.tab')[1].click()")
      await wait(1500)
      writeFileSync(join(shots, 'account.png'), (await win!.webContents.capturePage()).toPNG())
      app.exit(0)
    })
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

const ALLOWED = new Set([
  'devices', 'discover', 'pair', 'check', 'trustUsb', 'forget', 'revealDevMode',
  'account', 'signIn', 'signOut', 'appInfo', 'install'
])

/**
 * Weekly renewal: free Apple IDs sign apps for 7 days. Every few hours, apps
 * that run out within 2 days are signed again and reinstalled on devices that
 * are reachable (Wi-Fi, or plugged in). Needs "Keep me signed in".
 */
let renewing = false
async function renewDue(): Promise<void> {
  if (renewing) return
  renewing = true
  try {
    const acct = await helper.call<AccountState>('account')
    if (!acct.ok || !acct.data.signedIn) return
    const list = await helper.call<DevicesResult>('devices')
    if (!list.ok) return
    const soon = Date.now() / 1000 + 2 * 86400
    for (const d of list.data.devices) {
      for (const a of d.apps ?? []) {
        if (!a.expires || a.expires > soon) continue
        const r = await helper.call('install', { id: d.id, path: a.source })
        win?.webContents.send('helper:event', {
          event: 'renewed', device: d.name, app: a.name, ok: r.ok, error: r.ok ? undefined : r.error
        })
      }
    }
  } finally {
    renewing = false
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.ello.sideloader')
  ipcMain.handle('apple:call', (_e, cmd: string, args?: Record<string, unknown>) =>
    ALLOWED.has(cmd) ? helper.call(cmd, args) : { ok: false, error: `Unknown command ${cmd}` }
  )
  ipcMain.handle('apple:pin', (_e, pin: string) => helper.sendPin(String(pin)))
  ipcMain.handle('apple:code', (_e, code: string) => helper.sendCode(String(code)))
  ipcMain.handle('dialog:pickIpa', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose an app to install',
      filters: [{ name: 'iPhone, iPad and Apple TV apps', extensions: ['ipa'] }],
      properties: ['openFile']
    })
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('window:control', (_e, action: string) => {
    if (action === 'minimize') win?.minimize()
    else if (action === 'close') win?.close()
  })
  ipcMain.handle('app:version', () => app.getVersion())
  createWindow()
  setTimeout(() => void renewDue(), 60_000)
  setInterval(() => void renewDue(), 3 * 3600_000)
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
