import { useCallback, useEffect, useState } from 'react'
import { Icon } from './Icon'
import { AddAppleTv, AddUsbDevice } from './AddDevice'
import { CodePrompt, InstallSection } from './Install'
import type { AccountState, AnisetteMode, AppleDevice, DevicesResult } from '@shared/types'

type Tab = 'devices' | 'account' | 'privacy'

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('devices')
  const [version, setVersion] = useState('')
  const [account, setAccount] = useState<AccountState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    void window.api.version().then(setVersion)
    void window.api.account().then((r) => r.ok && setAccount(r.data))
    return window.api.onEvent((e) => {
      if (e.event === 'renewed') {
        setToast(e.ok ? `${e.app} on ${e.device} was renewed for another week.` : `Couldn’t renew ${e.app} on ${e.device}: ${e.error}`)
        setTimeout(() => setToast(null), 12000)
      }
    })
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <nav className="tabs">
        {(
          [
            ['devices', 'Devices', 'devices'],
            ['account', 'Apple ID', 'person'],
            ['privacy', 'Privacy', 'shield']
          ] as const
        ).map(([key, label, icon]) => (
          <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            <Icon name={icon} size={20} /> {label}
          </button>
        ))}
      </nav>
      <main className="page" key={tab}>
        {tab === 'devices' && <DevicesPage signedIn={!!account?.signedIn} goSignIn={() => setTab('account')} />}
        {tab === 'account' && <AccountPage account={account} onChange={setAccount} />}
        {tab === 'privacy' && <PrivacyPage />}
      </main>
      <footer className="foot">ello Sideloader {version && `· ${version}`}</footer>
      {toast && <div className="toast">{toast}</div>}
      <CodePrompt />
    </div>
  )
}

function TitleBar(): JSX.Element {
  return (
    <header className="titlebar">
      <div className="brand">
        <img src="./icon.png" alt="" />
        <span>
          <b>ello</b>
          <b className="dot">.</b> <span className="dim">Sideloader</span>
        </span>
      </div>
      <div className="window-buttons">
        <button title="Minimize" onClick={() => void window.api.windowControl('minimize')}>
          <Icon name="minimize" size={18} />
        </button>
        <button title="Close" className="close" onClick={() => void window.api.windowControl('close')}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </header>
  )
}

// ----------------------------------------------------------------------------- devices

function DevicesPage({ signedIn, goSignIn }: { signedIn: boolean; goSignIn: () => void }): JSX.Element {
  const [data, setData] = useState<DevicesResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<'tv' | 'usb' | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const r = await window.api.devices()
    setRefreshing(false)
    if (r.ok) {
      setData(r.data)
      setError(null)
    } else setError(r.error)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const update = (d: AppleDevice): void =>
    setData((cur) => cur && { ...cur, devices: [...cur.devices.filter((x) => x.id !== d.id), d] })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your Apple devices</h1>
          <p className="lead">
            Pair them once. ello Sideloader puts ello smartTV on them with your own free Apple ID and renews it every
            week.
          </p>
        </div>
        <button className="btn ghost" onClick={() => void refresh()} disabled={refreshing}>
          <Icon name="refresh" size={18} /> {refreshing ? 'Looking…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="banner bad">
          <Icon name="error" /> {error}
        </div>
      )}
      {data && !data.usbService && (
        <div className="banner">
          <Icon name="info" />
          <span>
            To add an iPhone or iPad, install Apple’s <b>Apple Devices</b> app from the Microsoft Store (it provides the
            USB connection). Apple TV works without it.
          </span>
        </div>
      )}

      <div className="grid">
        {!data && !error && (
          <>
            <div className="card skeleton" />
            <div className="card skeleton" />
          </>
        )}
        {data?.devices.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            signedIn={signedIn}
            goSignIn={goSignIn}
            onUpdate={update}
            onForget={() => setData((cur) => cur && { ...cur, devices: cur.devices.filter((x) => x.id !== d.id) })}
          />
        ))}
        <button className="card add" onClick={() => setAdding('tv')}>
          <span className="add-icon c-blue">
            <Icon name="tv" size={30} />
          </span>
          <span className="add-title">Add Apple TV</span>
          <span className="add-sub">Over Wi-Fi, with the code shown on your TV</span>
        </button>
        <button className="card add" onClick={() => setAdding('usb')}>
          <span className="add-icon c-green">
            <Icon name="phone" size={30} />
          </span>
          <span className="add-title">Add iPhone or iPad</span>
          <span className="add-sub">With a cable, the first time</span>
        </button>
      </div>

      {adding === 'tv' && (
        <AddAppleTv
          onClose={() => setAdding(null)}
          onAdded={(d) => {
            update(d)
          }}
        />
      )}
      {adding === 'usb' && (
        <AddUsbDevice
          usbService={data?.usbService ?? true}
          onClose={() => setAdding(null)}
          onAdded={(d) => {
            update(d)
          }}
        />
      )}
    </>
  )
}

const KIND_ICON = { tv: 'tv', iphone: 'phone', ipad: 'tablet', other: 'devices' } as const
const KIND_COLOR = { tv: 'c-blue', iphone: 'c-green', ipad: 'c-yellow', other: 'c-red' } as const

function DeviceCard({
  device,
  signedIn,
  goSignIn,
  onUpdate,
  onForget
}: {
  device: AppleDevice
  signedIn: boolean
  goSignIn: () => void
  onUpdate: (d: AppleDevice) => void
  onForget: () => void
}): JSX.Element {
  const [busy, setBusy] = useState<'check' | 'forget' | 'reveal' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmForget, setConfirmForget] = useState(false)
  const os = device.kind === 'tv' ? 'tvOS' : device.kind === 'ipad' ? 'iPadOS' : 'iOS'

  const check = async (): Promise<void> => {
    setBusy('check')
    setMessage(null)
    const r = await window.api.check(device.id)
    setBusy(null)
    if (r.ok) {
      onUpdate(r.data)
      setMessage({ ok: true, text: 'Connected securely.' })
    } else {
      onUpdate({ ...device, online: false })
      setMessage({ ok: false, text: r.error })
    }
  }

  const reveal = async (): Promise<void> => {
    setBusy('reveal')
    setMessage(null)
    const r = await window.api.revealDevMode(device.id)
    setBusy(null)
    const where = device.kind === 'ipad' ? 'iPad' : 'iPhone'
    setMessage(
      r.ok
        ? { ok: true, text: `Done. On the ${where}: Settings › Privacy & Security › Developer Mode › on, then restart when it asks and confirm “Turn On”. Then click Check connection.` }
        : { ok: false, text: r.error }
    )
  }

  const forget = async (): Promise<void> => {
    setBusy('forget')
    const r = await window.api.forget(device.id)
    setBusy(null)
    if (r.ok) onForget()
    else setMessage({ ok: false, text: r.error })
  }

  return (
    <div className="card device">
      <div className="device-top">
        <span className={`device-icon ${KIND_COLOR[device.kind]}`}>
          <Icon name={KIND_ICON[device.kind]} size={30} />
        </span>
        <div className="device-text">
          <div className="device-name">{device.name}</div>
          <div className="device-meta">
            {[prettyModel(device.model), device.os && `${os} ${device.os}`].filter(Boolean).join(' · ') || 'Apple device'}
          </div>
        </div>
      </div>

      <div className="chips">
        <span className={`chip ${device.online ? 'good' : ''}`}>
          <i className="dot-status" />
          {device.online ? (device.usb ? 'Connected by cable' : 'On your Wi-Fi') : 'Not reachable right now'}
        </span>
        {device.kind !== 'tv' && device.developerMode != null && (
          <span className={`chip ${device.developerMode ? 'good' : 'warn'}`}>
            Developer Mode {device.developerMode ? 'on' : 'off'}
          </span>
        )}
      </div>

      {device.kind !== 'tv' && device.developerMode === false && (
        <div className="devmode">
          <p className="hint">
            Developer Mode is Apple’s own switch for running your own apps. Apple hides it until a computer asks
            for it:
          </p>
          <button className="btn ghost small" onClick={() => void reveal()} disabled={busy != null || !device.usb}>
            {busy === 'reveal' ? 'Asking…' : 'Show the switch on the device'}
          </button>
          {!device.usb && <p className="hint">Connect it with a cable to do this.</p>}
        </div>
      )}

      <InstallSection device={device} onUpdate={onUpdate} signedIn={signedIn} goSignIn={goSignIn} />

      {message && <div className={`msg ${message.ok ? 'good' : 'bad'}`}>{message.text}</div>}

      <div className="device-actions">
        <button className="btn ghost small" onClick={() => void check()} disabled={busy != null}>
          <Icon name="sync" size={16} /> {busy === 'check' ? 'Checking…' : 'Check connection'}
        </button>
        {confirmForget ? (
          <>
            <span className="confirm">Forget this device?</span>
            <button className="btn danger small" onClick={() => void forget()} disabled={busy != null}>
              Forget
            </button>
            <button className="btn ghost small" onClick={() => setConfirmForget(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn ghost small" onClick={() => setConfirmForget(true)} disabled={busy != null}>
            <Icon name="trash" size={16} /> Forget
          </button>
        )}
      </div>
    </div>
  )
}

/** Apple's model codes → friendly names for the devices people are likely to have. */
export function prettyModel(model?: string): string | undefined {
  if (!model) return undefined
  const names: Record<string, string> = {
    'AppleTV5,3': 'Apple TV HD',
    'AppleTV6,2': 'Apple TV 4K',
    'AppleTV11,1': 'Apple TV 4K (2nd gen)',
    'AppleTV14,1': 'Apple TV 4K (3rd gen)'
  }
  if (names[model]) return names[model]
  if (model.startsWith('iPhone')) return 'iPhone'
  if (model.startsWith('iPad')) return 'iPad'
  if (model.startsWith('AppleTV')) return 'Apple TV'
  return model
}

// ----------------------------------------------------------------------------- Apple ID

function AccountPage({
  account,
  onChange
}: {
  account: AccountState | null
  onChange: (a: AccountState) => void
}): JSX.Element {
  const [appleId, setAppleId] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await window.api.signIn(appleId, password, remember)
    setBusy(false)
    setPassword('')
    if (r.ok) onChange(r.data)
    else setError(r.error)
  }
  const signOut = async (): Promise<void> => {
    const r = await window.api.signOut()
    if (r.ok) onChange(r.data)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Apple ID</h1>
          <p className="lead">Used only to sign the apps you install, so your devices will run them. Free accounts work.</p>
        </div>
      </div>
      <div className="card wide">
        {account?.signedIn ? (
          <div className="soon">
            <span className="device-icon c-green">
              <Icon name="check" size={30} />
            </span>
            <div style={{ flex: 1 }}>
              <div className="device-name">Signed in as {account.appleId}</div>
              <p className="lead small">
                {account.remember
                  ? 'Apps are renewed automatically every week while this PC is on and the device is reachable.'
                  : 'You’ll be asked to sign in again when apps need renewing (every 7 days).'}
              </p>
            </div>
            <button className="btn ghost" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        ) : (
          <form
            className="signin"
            onSubmit={(e) => {
              e.preventDefault()
              void signIn()
            }}
          >
            <label>
              <span>Apple ID (email)</span>
              <input type="email" autoComplete="off" spellCheck={false} value={appleId} onChange={(e) => setAppleId(e.target.value)} placeholder="name@icloud.com" />
            </label>
            <label>
              <span>Password</span>
              <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>
                Keep me signed in for the weekly renewal
                <small>The password is stored on this PC, encrypted by Windows for your user account only.</small>
              </span>
            </label>
            {error && <div className="msg bad">{error}</div>}
            <button className="btn primary" disabled={busy || !appleId.includes('@') || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
        <ul className="list">
          <li>
            <Icon name="person" size={18} /> Use a separate free Apple ID just for this. Your devices stay signed in with
            your normal one.
          </li>
          <li>
            <Icon name="lock" size={18} /> Your password goes only from this PC to Apple (gsa.apple.com).
          </li>
          <li>
            <Icon name="person" size={18} /> Codes not arriving? Install{' '}
            <a href="https://secure-appldnld.apple.com/windows/061-91601-20200323-974a39d0-41fc-4761-b571-318b7d9205ed/iCloudSetup.exe" target="_blank" rel="noreferrer">
              iCloud for Windows 7.21 from Apple
            </a>{' '}
            (not the Microsoft Store version). ello then signs in through Apple’s own iCloud, which Apple trusts more.
          </li>
          <li>
            <Icon name="shield" size={18} /> The login check Apple requires (“anisette”) is made on this PC with Apple’s own
            code, unless you set an anisette server below.
          </li>
        </ul>
      </div>
      <AnisetteCard />
    </>
  )
}

/** Advanced: get Apple's machine data ("anisette") from a server instead of this PC. */
function AnisetteCard(): JSX.Element {
  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [mode, setMode] = useState<AnisetteMode>('auto')
  useEffect(() => {
    void window.api.getAnisette().then((r) => {
      if (r.ok) {
        setUrl(r.data.url)
        setSaved(r.data.url)
        setMode(r.data.mode)
      }
    })
  }, [])
  const pickMode = async (m: AnisetteMode): Promise<void> => {
    const r = await window.api.setAnisetteMode(m)
    if (r.ok) setMode(r.data)
  }
  const save = async (value: string): Promise<void> => {
    setBusy(true)
    setMsg(null)
    const r = await window.api.setAnisette(value)
    setBusy(false)
    if (r.ok) {
      setSaved(r.data)
      setUrl(r.data)
      setMsg({ ok: true, text: r.data ? 'The server answers. Sign-ins now use it.' : 'Back to this PC (iCloud for Windows or built-in).' })
    } else setMsg({ ok: false, text: r.error })
  }
  return (
    <div className="card wide">
      <h3 style={{ margin: '0 0 6px' }}>Machine data (anisette)</h3>
      <p className="lead small">
        Apple wants machine data with every sign-in. Automatic tries iCloud for Windows first and, if Apple refuses it
        (-80046, -80045), quietly tries again with Apple Music’s own code on this PC, then your server if you set one.
      </p>
      <label className="signin" style={{ display: 'block', marginBottom: 14 }}>
        <span>Use</span>
        <select value={mode} onChange={(e) => void pickMode(e.target.value as AnisetteMode)}>
          <option value="auto">Automatic (recommended)</option>
          <option value="builtin">Apple Music (built-in, on this PC)</option>
          <option value="icloud">iCloud for Windows</option>
          <option value="server">Anisette server only</option>
        </select>
      </label>
      <p className="lead small">
        Anisette server (optional): one that answers with v1 JSON, such as your own anisette-v3-server. It sees no password,
        only that a sign-in is happening.
      </p>
      <form
        className="signin"
        onSubmit={(e) => {
          e.preventDefault()
          void save(url)
        }}
      >
        <label>
          <span>Server address</span>
          <input type="url" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ani.example.com" />
        </label>
        {msg && <div className={`msg ${msg.ok ? 'good' : 'bad'}`}>{msg.text}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn primary" disabled={busy || url.trim() === saved}>
            {busy ? 'Checking…' : 'Use this server'}
          </button>
          {saved && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void save('')}>
              Stop using it
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

// ----------------------------------------------------------------------------- privacy

function PrivacyPage(): JSX.Element {
  const rows: Array<[string, string, string]> = [
    ['tv', 'Your Apple TV, iPhone and iPad', 'Pairing, checking and installing apps, over your own Wi-Fi or cable.'],
    ['person', 'Apple', 'Only to sign in (gsa.apple.com) and to get the free signing certificate (developerservices2.apple.com).'],
    ['lock', 'Anyone else', 'Nothing. No analytics, no tracking, no third-party servers.']
  ]
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Privacy</h1>
          <p className="lead">Who ello Sideloader talks to — the complete list.</p>
        </div>
      </div>
      <div className="card wide">
        {rows.map(([icon, who, what]) => (
          <div className="privacy-row" key={who}>
            <span className="device-icon small c-blue">
              <Icon name={icon} size={22} />
            </span>
            <div>
              <div className="install-title">{who}</div>
              <div className="install-sub">{what}</div>
            </div>
          </div>
        ))}
        <p className="lead small">
          Pairing keys are stored only on this PC. The device list keeps names, models and OS versions — no serial
          numbers are shown or sent anywhere. The source code is in your ello repo under <code>sideloader/</code>.
        </p>
      </div>
    </>
  )
}
