import { createPublicKey, randomUUID, verify } from 'node:crypto'
import { hostname } from 'node:os'
import type { LicenseState } from '../shared/types'
import { getSettings, store, updateSettings } from './store'

/**
 * ello Premium. A licence key (ELLO-XXXX-XXXX-XXXX-XXXX) is activated with the
 * licence server (server/license, a Cloudflare Worker), which keeps to the
 * key's device limit and answers with a token signed by its private key. The
 * token is checked here with the public key, so Premium keeps working offline
 * until the token runs out (30 days); the app refreshes it every few days, so
 * a key switched off on the server stops working.
 *
 * Token: ELLO1.<payload>.<signature>, base64url; payload JSON
 * { n: name, k: key, d: device id, i: issued (ms), e: expires (ms) }.
 */
const PUBLIC_KEY = createPublicKey({
  key: Buffer.from('MCowBQYDK2VwAyEAAkh/kjNcUMH5Ze1O2mRd/U9PcgdPttOW2Y4fMJbuW7w=', 'base64'),
  format: 'der',
  type: 'spki'
})

/** Where the licence server runs (Settings can override it, for testing). */
const LICENSE_SERVER = ''
/** Refresh the token once it is this old. */
const REFRESH_AFTER_MS = 3 * 86_400_000

interface Payload {
  n?: string
  k?: string
  d?: string
  i?: number
  e?: number
}

function server(): string {
  return (getSettings().licenseServer || LICENSE_SERVER).replace(/\/+$/, '')
}

/** A random id for this PC, made once. */
function deviceId(): string {
  let id = getSettings().deviceId
  if (!id) {
    id = randomUUID()
    updateSettings({ deviceId: id })
  }
  return id
}

function readToken(token?: string): Payload | null {
  const parts = token?.split('.')
  if (!parts || parts.length !== 3 || parts[0] !== 'ELLO1') return null
  try {
    if (!verify(null, Buffer.from(`ELLO1.${parts[1]}`), PUBLIC_KEY, Buffer.from(parts[2], 'base64url'))) return null
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Payload
    if (p.d !== deviceId() || typeof p.e !== 'number' || p.e < Date.now()) return null
    return p
  } catch {
    return null
  }
}

export function licenseState(): LicenseState {
  const p = readToken(getSettings().licenseToken)
  const key = getSettings().licenseKey
  return p ? { premium: true, name: p.n, key } : { premium: false, key }
}

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${server()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

const deviceInfo = (): Record<string, string> => ({ device: deviceId(), deviceName: hostname(), platform: 'windows' })

export async function activateLicense(key: string): Promise<LicenseState> {
  const clean = key.trim().toUpperCase().replace(/\s+/g, '')
  if (!clean) return { premium: false, error: 'Enter your licence key.' }
  if (!server()) return { premium: false, error: 'Activation isn’t available yet. Try again after the next update.' }
  try {
    const { data } = await post('/v1/activate', { key: clean, ...deviceInfo() })
    const token = typeof data.token === 'string' ? data.token : undefined
    if (!token || !readToken(token)) {
      return { premium: false, error: typeof data.message === 'string' ? data.message : 'That licence key didn’t work.' }
    }
    updateSettings({ licenseKey: clean, licenseToken: token })
    return licenseState()
  } catch {
    return { premium: false, error: 'Couldn’t reach the licence server. Check your internet connection.' }
  }
}

export async function removeLicense(): Promise<LicenseState> {
  const key = getSettings().licenseKey
  // Frees this PC's place on the key; works offline too (the server then
  // still counts this PC until the key's devices are freed there).
  if (key && server()) await post('/v1/deactivate', { key, device: deviceId() }).catch(() => undefined)
  store.delete('licenseKey')
  store.delete('licenseToken')
  return { premium: false }
}

/** Renew the token in the background when it's a few days old. */
export async function refreshLicense(): Promise<LicenseState> {
  const { licenseKey, licenseToken } = getSettings()
  if (!licenseKey || !server()) return licenseState()
  const p = readToken(licenseToken)
  if (p && Date.now() - (p.i ?? 0) < REFRESH_AFTER_MS) return licenseState()
  try {
    const { status, data } = await post('/v1/refresh', { key: licenseKey, ...deviceInfo() })
    if (typeof data.token === 'string' && readToken(data.token)) updateSettings({ licenseToken: data.token })
    // Switched off, unknown, or this PC was removed from the key: Premium ends now.
    else if (status === 403 || status === 404) store.delete('licenseToken')
  } catch {
    /* offline: the current token keeps working until it runs out */
  }
  return licenseState()
}
