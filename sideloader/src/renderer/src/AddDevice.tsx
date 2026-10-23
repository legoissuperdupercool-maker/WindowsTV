import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { prettyModel } from './App'
import type { AppleDevice, PairableTv } from '@shared/types'

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Steps({ at, labels }: { at: number; labels: string[] }): JSX.Element {
  return (
    <div className="steps">
      {labels.map((l, i) => (
        <span key={l} className={i < at ? 'done' : i === at ? 'active' : ''}>
          <i>{i < at ? '✓' : i + 1}</i> {l}
        </span>
      ))}
    </div>
  )
}

function Done({ device, onClose }: { device: AppleDevice; onClose: () => void }): JSX.Element {
  return (
    <div className="center-block">
      <span className="big-check">
        <Icon name="check" size={56} />
      </span>
      <h3>{device.name} is paired</h3>
      <p className="lead small">
        {[prettyModel(device.model), device.os && `version ${device.os}`].filter(Boolean).join(' · ')}
        {device.canInstall === false ? ' · app installing isn’t available on this device' : ''}
      </p>
      {device.kind !== 'tv' && device.developerMode === false && (
        <div className="banner">
          <Icon name="info" />
          <span>
            One more thing: the {device.kind === 'ipad' ? 'iPad' : 'iPhone'} needs <b>Developer Mode</b>, Apple’s own
            switch for running your own apps. Use <b>Show the switch on the device</b> on its card, then turn it on in
            Settings › Privacy &amp; Security.
          </span>
        </div>
      )}
      <button className="btn primary" onClick={onClose} autoFocus>
        Done
      </button>
    </div>
  )
}

function Failed({ text, onRetry, onClose }: { text: string; onRetry: () => void; onClose: () => void }): JSX.Element {
  return (
    <div className="center-block">
      <span className="big-check bad">
        <Icon name="error" size={56} />
      </span>
      <h3>That didn’t work</h3>
      <p className="lead small">{text}</p>
      <div className="row-buttons">
        <button className="btn primary" onClick={onRetry} autoFocus>
          <Icon name="refresh" size={18} /> Try again
        </button>
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------- Apple TV

type TvStep =
  | { s: 'intro' }
  | { s: 'searching' }
  | { s: 'notfound' }
  | { s: 'choose'; tvs: PairableTv[] }
  | { s: 'pairing'; tv: PairableTv }
  | { s: 'pin'; tv: PairableTv }
  | { s: 'verifying'; tv: PairableTv }
  | { s: 'done'; device: AppleDevice }
  | { s: 'error'; text: string }

export function AddAppleTv({ onClose, onAdded }: { onClose: () => void; onAdded: (d: AppleDevice) => void }): JSX.Element {
  const [step, setStep] = useState<TvStep>({ s: 'intro' })
  const [pin, setPin] = useState('')
  const pinRef = useRef<HTMLInputElement>(null)
  const current = useRef<PairableTv | null>(null)

  useEffect(
    () =>
      window.api.onEvent((e) => {
        if (e.event === 'pin_required' && current.current) {
          setPin('')
          setStep({ s: 'pin', tv: current.current })
        }
      }),
    []
  )
  useEffect(() => {
    if (step.s === 'pin') pinRef.current?.focus()
  }, [step.s])

  const search = async (): Promise<void> => {
    setStep({ s: 'searching' })
    const r = await window.api.discover()
    if (!r.ok) return setStep({ s: 'error', text: r.error })
    if (r.data.length === 0) return setStep({ s: 'notfound' })
    if (r.data.length === 1) return pair(r.data[0])
    setStep({ s: 'choose', tvs: r.data })
  }

  const pair = async (tv: PairableTv): Promise<void> => {
    current.current = tv
    setStep({ s: 'pairing', tv })
    const r = await window.api.pair(tv)
    current.current = null
    if (r.ok) {
      onAdded(r.data)
      setStep({ s: 'done', device: r.data })
    } else setStep({ s: 'error', text: r.error })
  }

  const submitPin = (): void => {
    if (step.s !== 'pin' || pin.length < 4) return
    void window.api.sendPin(pin)
    setStep({ s: 'verifying', tv: step.tv })
  }

  const at = { intro: 0, searching: 1, notfound: 1, choose: 1, pairing: 1, pin: 2, verifying: 3, done: 4, error: 0 }[step.s]

  return (
    <Sheet title="Add Apple TV" onClose={onClose}>
      {step.s !== 'error' && <Steps at={at} labels={['Open settings', 'Find', 'Enter code', 'Connect']} />}

      {step.s === 'intro' && (
        <div className="split">
          <div className="tv-art" aria-hidden>
            <div className="tv-screen">
              <div className="tv-crumb">Settings › Remotes and Devices</div>
              <div className="tv-title">Remote App and Devices</div>
              <div className="tv-row">Looking for devices…</div>
            </div>
            <div className="tv-stand" />
          </div>
          <div>
            <ol className="howto">
              <li>
                Make sure your Apple TV and this PC are on the <b>same Wi-Fi</b>.
              </li>
              <li>
                On the Apple TV, open <b>Settings › Remotes and Devices › Remote App and Devices</b>.
              </li>
              <li>Keep that screen open, then click Search.</li>
            </ol>
            <button className="btn primary" onClick={() => void search()} autoFocus>
              Search for Apple TV
            </button>
          </div>
        </div>
      )}

      {(step.s === 'searching' || step.s === 'pairing' || step.s === 'verifying') && (
        <div className="center-block">
          <div className="spinner" />
          <h3>
            {step.s === 'searching'
              ? 'Looking for your Apple TV…'
              : step.s === 'pairing'
                ? `Connecting to ${step.tv.name}…`
                : 'Checking the code and connecting securely…'}
          </h3>
          <p className="lead small">
            {step.s === 'pairing' ? 'A code will appear on your TV in a moment.' : 'This takes a few seconds.'}
          </p>
        </div>
      )}

      {step.s === 'notfound' && (
        <div className="center-block">
          <h3>No Apple TV found</h3>
          <ul className="list left">
            <li>Is the “Remote App and Devices” screen still open on the TV?</li>
            <li>Are the TV and this PC on the same Wi-Fi (not a guest network)?</li>
            <li>If Windows asked about network access for ello Sideloader, allow it on private networks.</li>
          </ul>
          <button className="btn primary" onClick={() => void search()} autoFocus>
            <Icon name="refresh" size={18} /> Search again
          </button>
        </div>
      )}

      {step.s === 'choose' && (
        <div className="choose">
          <p className="lead small">Several Apple TVs are ready to pair. Pick yours:</p>
          {step.tvs.map((tv) => (
            <button key={tv.identifier} className="choice" onClick={() => void pair(tv)}>
              <Icon name="tv" size={24} /> {tv.name}
            </button>
          ))}
        </div>
      )}

      {step.s === 'pin' && (
        <form
          className="center-block"
          onSubmit={(e) => {
            e.preventDefault()
            submitPin()
          }}
        >
          <h3>Enter the code shown on {step.tv.name}</h3>
          <input
            ref={pinRef}
            className="pin"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            placeholder="••••••"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <button className="btn primary" type="submit" disabled={pin.length < 4}>
            Pair
          </button>
        </form>
      )}

      {step.s === 'done' && <Done device={step.device} onClose={onClose} />}
      {step.s === 'error' && <Failed text={step.text} onRetry={() => setStep({ s: 'intro' })} onClose={onClose} />}
    </Sheet>
  )
}

// ----------------------------------------------------------------------------- iPhone / iPad

type UsbStep = { s: 'intro' } | { s: 'working'; trust: boolean } | { s: 'done'; device: AppleDevice } | { s: 'error'; text: string }

export function AddUsbDevice({
  usbService,
  onClose,
  onAdded
}: {
  usbService: boolean
  onClose: () => void
  onAdded: (d: AppleDevice) => void
}): JSX.Element {
  const [step, setStep] = useState<UsbStep>({ s: 'intro' })

  useEffect(
    () =>
      window.api.onEvent((e) => {
        if (e.event === 'trust_required') setStep((cur) => (cur.s === 'working' ? { s: 'working', trust: true } : cur))
      }),
    []
  )

  const connect = async (): Promise<void> => {
    setStep({ s: 'working', trust: false })
    const r = await window.api.trustUsb()
    if (r.ok) {
      onAdded(r.data)
      setStep({ s: 'done', device: r.data })
    } else setStep({ s: 'error', text: r.error })
  }

  const at = { intro: 0, working: 1, done: 3, error: 0 }[step.s]

  return (
    <Sheet title="Add iPhone or iPad" onClose={onClose}>
      {step.s !== 'error' && <Steps at={at} labels={['Plug in', 'Trust', 'Connect']} />}

      {step.s === 'intro' && (
        <div className="split">
          <div className="phone-art" aria-hidden>
            <div className="phone-screen">
              <div className="phone-title">Trust This Computer?</div>
              <div className="phone-text">Your settings and data will be accessible from this computer.</div>
              <div className="phone-btns">
                <span className="hl">Trust</span>
                <span>Don’t Trust</span>
              </div>
            </div>
            <div className="phone-cable" />
          </div>
          <div>
            {!usbService && (
              <div className="banner">
                <Icon name="info" />
                <span>
                  First install Apple’s <b>Apple Devices</b> app from the Microsoft Store. It provides the USB
                  connection.
                </span>
              </div>
            )}
            <ol className="howto">
              <li>
                Plug your iPhone or iPad into this PC with a <b>cable</b>.
              </li>
              <li>Unlock it.</li>
              <li>
                Click Connect, then tap <b>Trust</b> on the device and enter your passcode.
              </li>
            </ol>
            <button className="btn primary" onClick={() => void connect()} autoFocus>
              <Icon name="cable" size={18} /> Connect
            </button>
          </div>
        </div>
      )}

      {step.s === 'working' && (
        <div className="center-block">
          <div className="spinner" />
          <h3>{step.trust ? 'Tap “Trust” on your iPhone or iPad' : 'Looking for your iPhone or iPad…'}</h3>
          <p className="lead small">
            {step.trust ? 'Then enter your passcode on the device. Waiting up to 2 minutes.' : 'Keep it unlocked.'}
          </p>
        </div>
      )}

      {step.s === 'done' && <Done device={step.device} onClose={onClose} />}
      {step.s === 'error' && <Failed text={step.text} onRetry={() => setStep({ s: 'intro' })} onClose={onClose} />}
    </Sheet>
  )
}
