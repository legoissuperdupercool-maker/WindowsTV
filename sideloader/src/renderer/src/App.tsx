import { useCallback, useEffect, useState } from 'react'
import { Icon } from './Icon'
import { AddAppleTv, AddUsbDevice } from './AddDevice'
import type { AppleDevice, DevicesResult } from '@shared/types'

type Tab = 'devices' | 'account' | 'privacy'

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('devices')
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.api.version().then(setVersion)
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
        {tab === 'devices' && <DevicesPage />}
        {tab === 'account' && <AccountPage />}
        {tab === 'privacy' && <PrivacyPage />}
      </main>
      <footer className="foot">ello Sideloader {version && `· ${version}`}</footer>
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

function DevicesPage(): JSX.Element {
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
  onUpdate,
  onForget
}: {
  device: AppleDevice
  onUpdate: (d: AppleDevice) => void
  onForget: () => void
}): JSX.Element {
  const [busy, setBusy] = useState<'check' | 'forget' | null>(null)
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
        <p className="hint">
          Turn it on: Settings › Privacy &amp; Security › Developer Mode. It’s Apple’s own switch for running your
          own apps.
        </p>
      )}

      <div className="install-row">
        <div>
          <div className="install-title">ello smartTV</div>
          <div className="install-sub">Installing comes with the next update (Apple ID signing).</div>
        </div>
        <button className="btn primary" disabled title="Coming in the next update">
          <Icon name="download" size={18} /> Install
        </button>
      </div>

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

function AccountPage(): JSX.Element {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Apple ID</h1>
          <p className="lead">Used only to sign ello smartTV so your devices will run it. Free accounts work.</p>
        </div>
      </div>
      <div className="card wide">
        <div className="soon">
          <span className="device-icon c-blue">
            <Icon name="person" size={30} />
          </span>
          <div>
            <div className="device-name">Sign-in arrives with the next update</div>
            <p className="lead small">
              The next step builds Apple ID sign-in and app signing. Until then you can pair your devices on the
              Devices tab — that part is ready to test.
            </p>
          </div>
        </div>
        <ul className="list">
          <li>
            <Icon name="person" size={18} /> Use a separate free Apple ID just for this. Your devices stay signed in with
            your normal one.
          </li>
          <li>
            <Icon name="lock" size={18} /> Your password goes only from this PC to Apple and is never saved.
          </li>
          <li>
            <Icon name="shield" size={18} /> The login check Apple requires (“anisette”) is made on this PC, not by
            someone else’s server.
          </li>
        </ul>
      </div>
    </>
  )
}

// ----------------------------------------------------------------------------- privacy

function PrivacyPage(): JSX.Element {
  const rows: Array<[string, string, string]> = [
    ['tv', 'Your Apple TV, iPhone and iPad', 'Pairing, checking and (soon) installing — over your own Wi-Fi or cable.'],
    ['person', 'Apple', 'Only for Apple ID sign-in and signing, when that arrives. Nothing else.'],
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
