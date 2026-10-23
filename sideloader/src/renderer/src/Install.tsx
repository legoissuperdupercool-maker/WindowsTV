import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { AppInfo, AppleDevice, HelperEvent } from '@shared/types'

/** Live progress text from the helper while something is being installed. */
export function useProgress(active: boolean): { text: string; percent: number | null } | null {
  const [p, setP] = useState<{ text: string; percent: number | null } | null>(null)
  useEffect(() => {
    if (!active) {
      setP(null)
      return
    }
    return window.api.onEvent((e: HelperEvent) => {
      if (e.event === 'progress') setP({ text: e.text, percent: e.percent })
    })
  }, [active])
  return p
}

function daysLeft(expires: number | null): string {
  if (!expires) return ''
  const d = Math.round((expires * 1000 - Date.now()) / 86400_000)
  if (d < 0) return 'Expired: renew it'
  if (d === 0) return 'Expires today'
  return `Works for ${d} more day${d === 1 ? '' : 's'}`
}

/** "ello smartTV · Install" plus "Install another app (.ipa)…" and the apps already installed. */
export function InstallSection({
  device,
  onUpdate,
  signedIn,
  goSignIn
}: {
  device: AppleDevice
  onUpdate: (d: AppleDevice) => void
  signedIn: boolean
  goSignIn: () => void
}): JSX.Element {
  const [bundled, setBundled] = useState<AppInfo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const progress = useProgress(busy != null)
  const isTv = device.kind === 'tv'

  useEffect(() => {
    void window.api.appInfo().then((r) => r.ok && setBundled(r.data))
  }, [])

  const install = async (path?: string, name?: string): Promise<void> => {
    setBusy(name ?? 'app')
    setMessage(null)
    const r = await window.api.install(device.id, path)
    setBusy(null)
    if (r.ok) {
      onUpdate(r.data)
      setMessage({ ok: true, text: `${name ?? 'The app'} is on ${device.name}. Open it from the home screen.` })
    } else setMessage({ ok: false, text: r.error })
  }

  const chooseFile = async (): Promise<void> => {
    const path = await window.api.pickIpa()
    if (!path) return
    const info = await window.api.appInfo(path)
    if (!info.ok) {
      setMessage({ ok: false, text: info.error })
      return
    }
    await install(path, info.data.name)
  }

  const elloInstalled = device.apps?.find((a) => a.bundleId.startsWith('com.ello.smarttv'))
  const tvMismatch = isTv && bundled && !bundled.platforms.includes('AppleTVOS')
  const offline = !device.online

  return (
    <div className="install">
      <div className="install-row">
        <div>
          <div className="install-title">ello smartTV {bundled?.version && <span className="dim">{bundled.version}</span>}</div>
          <div className="install-sub">
            {tvMismatch
              ? 'The Apple TV version of ello is coming. This one is for iPhone and iPad.'
              : elloInstalled
                ? daysLeft(elloInstalled.expires)
                : 'Signed with your Apple ID and installed straight onto this device.'}
          </div>
        </div>
        {signedIn ? (
          <button
            className="btn primary"
            disabled={busy != null || !bundled || !!tvMismatch || offline}
            title={offline ? 'Connect the device first' : undefined}
            onClick={() => void install(undefined, 'ello smartTV')}
          >
            <Icon name="download" size={18} /> {elloInstalled ? 'Reinstall' : 'Install'}
          </button>
        ) : (
          <button className="btn primary" onClick={goSignIn}>
            <Icon name="person" size={18} /> Sign in first
          </button>
        )}
      </div>

      {busy && (
        <div className="progress">
          <div className="progress-text">
            <span className="spinner small" /> {progress?.text ?? 'Starting…'}
          </div>
          <div className="progress-bar">
            <span style={{ width: `${progress?.percent ?? 4}%` }} />
          </div>
        </div>
      )}

      {(device.apps ?? []).filter((a) => a !== elloInstalled).map((a) => (
        <div className="install-row slim" key={a.bundleId}>
          <div>
            <div className="install-title">{a.name}</div>
            <div className="install-sub">{daysLeft(a.expires)}</div>
          </div>
          <button className="btn ghost small" disabled={busy != null || offline || !signedIn} onClick={() => void install(a.source, a.name)}>
            <Icon name="sync" size={16} /> Renew
          </button>
        </div>
      ))}

      {signedIn && (
        <button className="btn ghost small" disabled={busy != null || offline} onClick={() => void chooseFile()}>
          <Icon name="add" size={16} /> Install another app (.ipa)…
        </button>
      )}
      {message && <div className={`msg ${message.ok ? 'good' : 'bad'}`}>{message.text}</div>}
    </div>
  )
}

/** Apple's two-factor code, asked whenever the helper needs it (sign-in or renewal). */
export function CodePrompt(): JSX.Element | null {
  const [mode, setMode] = useState<'device' | 'sms' | null>(null)
  const [code, setCode] = useState('')
  useEffect(
    () =>
      window.api.onEvent((e) => {
        if (e.event === 'code_required') {
          setCode('')
          setMode(e.mode)
        }
      }),
    []
  )
  if (!mode) return null
  const send = (): void => {
    void window.api.sendCode(code)
    setMode(null)
  }
  return (
    <div className="scrim">
      <div className="sheet narrow center-block">
        <span className="device-icon c-blue">
          <Icon name="lock" size={30} />
        </span>
        <h2>Enter the code from Apple</h2>
        <p className="lead small">
          {mode === 'device'
            ? 'Apple sent a 6-digit code to the devices signed in with this Apple ID. Allow it there, then type the code here.'
            : 'Apple sent a 6-digit code by text message to the phone number of this Apple ID.'}
        </p>
        <input
          className="pin"
          autoFocus
          inputMode="numeric"
          maxLength={7}
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && send()}
        />
        <div className="row-buttons">
          <button className="btn ghost" onClick={() => { void window.api.sendCode(''); setMode(null) }}>
            Cancel
          </button>
          <button className="btn primary" disabled={code.length !== 6} onClick={send}>
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
