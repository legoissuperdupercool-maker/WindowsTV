import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { VpnState } from '@shared/types'

type Check = { ip: string; country?: string; city?: string; mullvad?: boolean }

/** Settings card for the built-in VPN (WireGuard, only ello's traffic). */
export function VpnCard(): JSX.Element {
  const [vpn, setVpn] = useState<VpnState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [check, setCheck] = useState<Check | null>(null)

  useEffect(() => {
    void window.api.vpn.get().then((r) => r.data && setVpn(r.data))
    return window.api.onVpnState((s) => {
      setVpn(s)
      if (s.status !== 'connected') setCheck(null)
    })
  }, [])

  const run = async <T,>(fn: () => Promise<{ ok: boolean; data?: T; error?: string }>, then?: (d: T) => void): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setError(r.error ?? 'Something went wrong.')
    else if (r.data !== undefined && r.data !== null) then?.(r.data)
  }

  const status = vpn?.status ?? 'off'
  const label = {
    off: 'Off: ello uses your normal connection',
    connecting: 'Connecting…',
    connected: `Connected${vpn?.config ? ` via ${vpn.config.provider ?? vpn.config.name}` : ''}`,
    error: 'Not connected: ello is blocked until the VPN works (kill switch)'
  }[status]

  return (
    <div className="card">
      <h3>VPN (only for ello)</h3>
      <p className="hint">
        Send ello’s traffic (your provider, the TV guide, artwork and the video itself) through a WireGuard VPN like
        Mullvad, Proton VPN or AirVPN. The rest of your PC keeps using your normal connection. No separate VPN app needed.
      </p>

      {vpn?.config ? (
        <>
          <div className="vpn-row">
            <span className={`vpn-dot ${status}`} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{vpn.config.provider ?? 'WireGuard'} · {vpn.config.name}</div>
              <div className="hint" style={{ margin: 0 }}>
                {label}
                {status === 'error' && vpn.error ? ` · ${vpn.error}` : ''}
              </div>
            </div>
            <button
              className={`focusable switch ${vpn.enabled ? 'on' : ''}`}
              title={vpn.enabled ? 'Turn the VPN off' : 'Turn the VPN on'}
              disabled={busy}
              onClick={() => void run(() => window.api.vpn.setEnabled(!vpn.enabled), setVpn)}
            >
              <span className="knob" />
            </button>
          </div>
          <div className="row-actions">
            <button className="focusable btn" disabled={busy || status !== 'connected'} onClick={() => void run(() => window.api.vpn.check(), setCheck)}>
              <Icon name="info" size={18} /> Check my connection
            </button>
            <button className="focusable btn" disabled={busy} onClick={() => void run(() => window.api.vpn.importConfig(), setVpn)}>
              Use another server file
            </button>
            <button className="focusable btn" disabled={busy} onClick={() => void run(() => window.api.vpn.remove(), setVpn)}>
              Remove
            </button>
          </div>
          {check && (
            <div className="test-result ok">
              ello’s traffic comes out at {check.ip}
              {check.city || check.country ? ` (${[check.city, check.country].filter(Boolean).join(', ')})` : ''}
              {check.mullvad ? ' · Mullvad confirmed' : ''}.
            </div>
          )}
        </>
      ) : (
        <>
          <ol className="hint vpn-steps">
            <li>
              On your VPN’s website, open its <b>WireGuard configuration</b> page (Mullvad: Account › WireGuard
              configuration; Proton: Downloads › WireGuard).
            </li>
            <li>Pick a server close to you (or in the country you want) and download the <b>.conf</b> file.</li>
            <li>Import it here, then switch the VPN on.</li>
          </ol>
          <button className="focusable btn accent" disabled={busy} onClick={() => void run(() => window.api.vpn.importConfig(), setVpn)}>
            Import WireGuard file…
          </button>
        </>
      )}
      {error && <div className="test-result bad">{error}</div>}
      <p className="hint" style={{ marginTop: 12 }}>
        The file holds your VPN key, so ello stores it encrypted for your Windows account. “Check my connection” asks
        am.i.mullvad.net which address your traffic comes from; nothing else is contacted.
      </p>
    </div>
  )
}
