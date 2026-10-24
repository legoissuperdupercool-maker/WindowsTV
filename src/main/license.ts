import { createPublicKey, verify } from 'node:crypto'
import type { LicenseState } from '../shared/types'

/**
 * ello Premium, unlocked with a licence key. Keys are signed with ello's
 * private key (kept off this repo) and checked here with the public key, so
 * no server or account is needed and the check works offline.
 *
 * Key: ELLO1.<payload>.<signature>, both base64url; payload is JSON
 * { n: name on the licence, i: issue date }.
 */
const PUBLIC_KEY = createPublicKey({
  key: Buffer.from('MCowBQYDK2VwAyEAAkh/kjNcUMH5Ze1O2mRd/U9PcgdPttOW2Y4fMJbuW7w=', 'base64'),
  format: 'der',
  type: 'spki'
})

export function checkLicense(key?: string): LicenseState {
  const parts = key?.trim().replace(/\s+/g, '').split('.')
  if (!parts || parts.length !== 3 || parts[0] !== 'ELLO1') return { premium: false }
  try {
    const payload = Buffer.from(parts[1], 'base64url')
    const ok = verify(null, Buffer.from(`ELLO1.${parts[1]}`), PUBLIC_KEY, Buffer.from(parts[2], 'base64url'))
    if (!ok) return { premium: false }
    const data = JSON.parse(payload.toString('utf8')) as { n?: string }
    return { premium: true, name: typeof data.n === 'string' ? data.n : undefined }
  } catch {
    return { premium: false }
  }
}
