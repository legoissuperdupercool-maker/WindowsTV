// License gate for Ello Smart TV. Runs on startup before the main window opens:
// validate the stored key + check build integrity with the panel, prompt for a
// key if needed, then keep a heartbeat so a revoke/ban/disable takes effect
// while the app is running.

import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import Store from 'electron-store'
import { createPanelClient, type GateResult } from './panel-client'
import { PANEL_CONFIG, PANEL_ENABLED, PANEL_FAIL_OPEN } from './config'

const licenseStore = new Store<{ key: string }>({ name: 'ello-license', defaults: { key: '' } })

function selfHashPaths(): string[] {
  // Only meaningful in a packaged build; in dev there's no asar to hash and the
  // integrity check is skipped.
  return app.isPackaged ? [path.join(process.resourcesPath, 'app.asar')] : []
}

function makeClient() {
  return createPanelClient({
    baseUrl: PANEL_CONFIG.baseUrl,
    appId: PANEL_CONFIG.appId,
    appSecret: PANEL_CONFIG.appSecret,
    version: app.getVersion(),
    selfHashPaths: selfHashPaths(),
    failOpen: PANEL_FAIL_OPEN
  })
}

function messageFor(reason?: string | null): string {
  switch (reason) {
    case 'invalid':
      return 'That license key is not valid for Ello Smart TV.'
    case 'revoked':
      return 'This license key has been revoked.'
    case 'expired':
      return 'This license key has expired.'
    case 'banned':
      return 'This device has been banned.'
    case 'disabled':
      return 'This device has been disabled.'
    case 'tampered':
      return 'This build failed its integrity check and will not run. Please reinstall from the official source.'
    case 'offline':
      return 'Could not reach the licensing server. Check your connection and try again.'
    default:
      return 'Access to Ello Smart TV could not be authorized.'
  }
}

// A tiny, preload-free key entry window. The page hands its value back by
// setting document.title, which the main process reads via page-title-updated.
function promptForKey(reason?: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 460,
      height: 360,
      resizable: false,
      title: 'ello smartTV — activation',
      backgroundColor: '#0d0f14',
      webPreferences: { sandbox: true }
    })
    const note = reason ? messageFor(reason) : ''
    const html = `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;background:#0d0f14;color:#e7ebf2;font:14px/1.5 system-ui,Segoe UI,sans-serif}
      .wrap{padding:26px;display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box}
      h1{margin:0;font-size:20px}
      .note{color:#ff5d6c;min-height:1.2em}
      input{padding:.6em .7em;border-radius:8px;border:1px solid #283040;background:#1c212b;color:#fff;font:inherit;letter-spacing:.06em;text-transform:uppercase}
      button{padding:.65em;border:0;border-radius:8px;color:#fff;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#5b8cff,#7a5bff)}
      .fine{color:#8b95a7;font-size:12px;margin-top:auto}
    </style><div class="wrap">
      <h1>Activate ello&nbsp;smartTV</h1>
      <div class="note">${note.replace(/"/g, '&quot;')}</div>
      <input id="k" placeholder="XXXX-XXXX-XXXX-XXXX" autofocus />
      <button id="go">Activate</button>
      <div class="fine">Ello Smart TV validates your license with our server and records this
        device (an anonymous hardware id) and your IP address to prevent abuse.</div>
    </div><script>
      const submit = () => { const v = document.getElementById('k').value.trim(); if (v) document.title = 'ELLO_KEY:' + v }
      document.getElementById('go').onclick = submit
      document.getElementById('k').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
    </script>`
    win.setMenuBarVisibility(false)
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

    let done = false
    win.webContents.on('page-title-updated', (e, title) => {
      if (title.startsWith('ELLO_KEY:')) {
        e.preventDefault()
        done = true
        const key = title.slice('ELLO_KEY:'.length).toUpperCase()
        win.close()
        resolve(key)
      }
    })
    win.on('closed', () => {
      if (!done) resolve(null)
    })
  })
}

/**
 * Enforce licensing before the app opens. Resolves to the valid key on success.
 * On failure it shows a message and quits the app (returns null). A no-op that
 * resolves to '' when the panel isn't configured yet.
 */
export async function enforceLicense(): Promise<string | null> {
  if (!PANEL_ENABLED) {
    console.warn('[panel] not configured (src/main/panel/config.ts) — license gate disabled.')
    return ''
  }
  const client = makeClient()
  let key = licenseStore.get('key') || ''

  // Up to a few attempts: validate, and prompt for a new key on invalid/missing.
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: GateResult = key ? await client.enforceOnStartup(key) : { ok: false, reason: 'invalid' }
    if (res.ok) {
      licenseStore.set('key', key)
      beginHeartbeat(client, key)
      return key
    }

    // Terminal reasons — don't bother re-prompting, just explain and quit.
    if (res.reason === 'tampered' || res.reason === 'banned' || res.reason === 'disabled' || res.reason === 'offline') {
      dialog.showErrorBox('ello smartTV', messageFor(res.reason))
      app.quit()
      return null
    }

    const entered = await promptForKey(key ? res.reason : null)
    if (entered == null) {
      app.quit()
      return null
    }
    key = entered
  }

  dialog.showErrorBox('ello smartTV', 'Too many failed activation attempts.')
  app.quit()
  return null
}

function beginHeartbeat(client: ReturnType<typeof makeClient>, key: string): void {
  client.startHeartbeat(key, {
    onRevoked: (reason) => {
      dialog.showErrorBox('ello smartTV', messageFor(reason))
      app.quit()
    }
  })
}
