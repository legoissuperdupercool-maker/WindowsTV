import { useEffect, useState } from 'react'
import { useStore, type RouteName } from '../store'
import { Icon } from './Icon'

const TABS: Array<{ route: RouteName; label: string }> = [
  { route: 'home', label: 'Home' },
  { route: 'live', label: 'Live TV' },
  { route: 'guide', label: 'Guide' },
  { route: 'movies', label: 'Movies' },
  { route: 'series', label: 'Series' }
]

export function Wordmark(): JSX.Element {
  return (
    <span className="wordmark">
      <span className="w-ello">
        ello<span className="dot">.</span>
      </span>
      <span className="w-tv">smartTV</span>
    </span>
  )
}

function Clock(): JSX.Element {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return <span className="clock">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
}

export function TopBar(): JSX.Element {
  const { settings, currentSourceId, setSource, navigate, route } = useStore()
  const sources = settings?.sources ?? []

  return (
    <div className="topbar">
      <Wordmark />

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.route}
            className={`focusable tab ${route === t.route ? 'active' : ''}`}
            onClick={() => navigate(t.route)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="spacer" />

      {sources.length > 1 && (
        <select
          className="source-select"
          value={currentSourceId ?? ''}
          onChange={(e) => void setSource(e.target.value)}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <button className="focusable icon-btn" title="Search channels" onClick={() => navigate('live')}>
        <Icon name="search" size={24} />
      </button>
      <button className="focusable icon-btn" title="Settings" onClick={() => navigate('settings')}>
        <Icon name="settings" size={24} />
      </button>

      <Clock />

      <div className="win-ctrls">
        <button className="winbtn" title="Minimize" onClick={() => window.api.window.control('minimize')}>
          <Icon name="minimize" size={18} />
        </button>
        <button className="winbtn" title="Maximize" onClick={() => window.api.window.control('maximize')}>
          <Icon name="maximize" size={16} />
        </button>
        <button className="winbtn close" title="Close" onClick={() => window.api.window.control('close')}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  )
}
