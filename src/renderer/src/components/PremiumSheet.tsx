import { useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

const FEATURES: Array<{ title: string; text: string }> = [
  { title: 'The full TV guide', text: 'Up to 7 days ahead and further back for catch-up, with a day picker. Free shows the next few hours.' },
  { title: 'Premium styles', text: 'Premium, Wonder and Glass, each with its own cards, menus and player.' },
  { title: 'VPN on iPad', text: 'Connect ello to your WireGuard VPN inside the app, so your provider doesn’t see your IP address.' }
]

/** ello Premium: what it adds and where to enter the licence key. */
export function PremiumSheet(): JSX.Element | null {
  const feature = useStore((s) => s.premiumSheet)
  const license = useStore((s) => s.license)
  const setPremiumSheet = useStore((s) => s.setPremiumSheet)
  const refreshLicense = useStore((s) => s.refreshLicense)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  if (feature == null) return null
  const close = (): void => {
    setPremiumSheet(null)
    setMsg(null)
    setKey('')
  }
  const unlock = async (): Promise<void> => {
    const r = await window.api.license.set(key)
    if (r.data?.premium) {
      await refreshLicense()
      setMsg(null)
    } else setMsg('That key isn’t valid. Paste the whole key, starting with ELLO1.')
  }
  const remove = async (): Promise<void> => {
    await window.api.license.set('')
    await refreshLicense()
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet premium-sheet" role="dialog" aria-label="ello Premium" data-modal>
        <div className="premium-head">
          <Icon name="premium" size={34} />
          <div>
            <h2>ello Premium</h2>
            <p>{license.premium ? `Unlocked${license.name ? ` for ${license.name}` : ''}. Thank you!` : feature ? `${feature} is part of ello Premium.` : 'One key, yours to keep.'}</p>
          </div>
        </div>
        <ul className="premium-list">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <Icon name={license.premium ? 'check' : 'lock'} size={20} />
              <span>
                <b>{f.title}</b>
                <small>{f.text}</small>
              </span>
            </li>
          ))}
        </ul>
        {!license.premium && (
          <div className="field">
            <label htmlFor="premium-key">Licence key</label>
            <input
              id="premium-key"
              className="focusable"
              placeholder="ELLO1.…"
              value={key}
              spellCheck={false}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void unlock()}
            />
            {msg && <p className="premium-error">{msg}</p>}
          </div>
        )}
        <div className="sheet-actions">
          {license.premium && (
            <button className="focusable btn" onClick={() => void remove()}>
              Remove key
            </button>
          )}
          <span className="spacer" />
          <button className="focusable btn" onClick={close}>
            {license.premium ? 'Done' : 'Not now'}
          </button>
          {!license.premium && (
            <button className="focusable btn primary" onClick={() => void unlock()} disabled={!key.trim()}>
              Unlock
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
