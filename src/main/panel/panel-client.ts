// ello panel — client SDK (TypeScript port for Ello Smart TV's main process).
// Mirrors admin-panel/clients/panel-client.js; keep them in sync if you change
// the request contract. Dependency-free.
//
// HONEST SECURITY NOTE: appSecret ships inside the app and can be extracted. It
// only stops casual request spoofing and tells apps apart — it is NOT what keeps
// an unlicensed user out. The real gate is the license key + the panel's
// decision (revoke / expire / ban / disable). Obfuscation + the integrity
// allowlist raise the bar against tampering; they don't make the client
// uncrackable.

import crypto from 'node:crypto'
import os from 'node:os'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

export interface PanelConfig {
  baseUrl: string
  appId: string
  appSecret: string
  version?: string
  identifier?: string
  selfHashPaths?: string[]
  timeoutMs?: number
  failOpen?: boolean
}

export interface GateResult {
  ok: boolean
  reason?: string | null
  label?: string | null
  expires_at?: number | null
  flagged?: boolean
  offline?: boolean
  skipped?: boolean
}

let _hwid: string | null = null
export function computeHwid(): string {
  if (_hwid) return _hwid
  let seed = ''
  try {
    if (process.platform === 'win32') {
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
        stdio: ['ignore', 'pipe', 'ignore']
      }).toString()
      seed = (out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i) || [])[1] || ''
    } else if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      seed = (out.match(/IOPlatformUUID"\s*=\s*"([^"]+)"/) || [])[1] || ''
    } else {
      for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try {
          seed = fs.readFileSync(p, 'utf8').trim()
          if (seed) break
        } catch {
          /* next */
        }
      }
    }
  } catch {
    /* fall through to hardware traits */
  }
  if (!seed) {
    const macs = Object.values(os.networkInterfaces())
      .flat()
      .filter((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
      .map((n) => n!.mac)
      .sort()
    const cpu = (os.cpus()[0] || ({} as os.CpuInfo)).model || ''
    seed = [process.platform, process.arch, cpu, os.cpus().length, Math.round(os.totalmem() / 1e8), ...macs].join('|')
  }
  _hwid = crypto.createHash('sha256').update('ello-hwid:' + seed).digest('hex')
  return _hwid
}

export function computeSelfHash(paths: string[] = []): string | null {
  const h = crypto.createHash('sha256')
  let any = false
  for (const p of paths) {
    try {
      h.update(fs.readFileSync(p))
      any = true
    } catch {
      /* skip missing */
    }
  }
  return any ? h.digest('hex') : null
}

export function createPanelClient(config: PanelConfig) {
  const {
    baseUrl,
    appId,
    appSecret,
    version = '',
    identifier = '',
    selfHashPaths = [],
    timeoutMs = 8000,
    failOpen = false
  } = config
  if (!baseUrl || !appId || !appSecret) throw new Error('panel-client: baseUrl, appId and appSecret are required')
  const root = baseUrl.replace(/\/+$/, '')
  const hwid = computeHwid()
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  async function post(path: string, payload: Record<string, unknown>) {
    const body = JSON.stringify(payload)
    const ts = Date.now()
    const signature = crypto.createHmac('sha256', appSecret).update(`${ts}.${body}`).digest('hex')
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(root + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-app-id': appId,
          'x-timestamp': String(ts),
          'x-signature': signature
        },
        body,
        signal: ctrl.signal
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { status: res.status, data, networkError: false }
    } catch {
      return { status: 0, data: { reason: 'unreachable' } as Record<string, unknown>, networkError: true }
    } finally {
      clearTimeout(to)
    }
  }

  async function validate(key: string): Promise<GateResult> {
    const r = await post('/api/validate', { key, hwid, identifier, version })
    if (r.networkError) return { ok: failOpen, reason: failOpen ? null : 'offline', offline: true }
    return {
      ok: r.data.valid === true,
      reason: (r.data.reason as string) || null,
      label: (r.data.label as string) ?? null,
      expires_at: (r.data.expires_at as number) ?? null
    }
  }

  async function integrity(key: string): Promise<GateResult> {
    const hash = computeSelfHash(selfHashPaths)
    if (!hash) return { ok: true, skipped: true }
    const r = await post('/api/integrity', { key, hash, hwid, identifier, version })
    if (r.networkError) return { ok: failOpen, reason: failOpen ? null : 'offline', offline: true }
    return { ok: r.data.action === 'allow', reason: (r.data.reason as string) || null, flagged: !!r.data.flagged }
  }

  async function heartbeat(key: string): Promise<GateResult> {
    const r = await post('/api/heartbeat', { key, hwid, identifier, version })
    if (r.networkError) return { ok: failOpen, offline: true }
    return { ok: r.data.action === 'allow', reason: (r.data.reason as string) || null }
  }

  async function enforceOnStartup(key: string): Promise<GateResult> {
    const lic = await validate(key)
    if (!lic.ok) return lic
    const integ = await integrity(key)
    if (!integ.ok) return integ
    return { ok: true, label: lic.label, expires_at: lic.expires_at }
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function startHeartbeat(
    key: string,
    { intervalMs = 5 * 60 * 1000, onRevoked = (_reason?: string | null) => {} }: { intervalMs?: number; onRevoked?: (reason?: string | null) => void } = {}
  ): () => void {
    stopHeartbeat()
    let fired = false
    heartbeatTimer = setInterval(async () => {
      const r = await heartbeat(key)
      if (!r.ok && !r.offline && !fired) {
        fired = true
        onRevoked(r.reason)
      }
    }, intervalMs)
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref()
    return stopHeartbeat
  }

  return { hwid, validate, integrity, heartbeat, enforceOnStartup, startHeartbeat, stopHeartbeat }
}
