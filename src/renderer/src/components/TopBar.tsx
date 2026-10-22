import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

function Clock(): JSX.Element {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="clock">
      <div className="time">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="date">
        {now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>
    </div>
  )
}

export function TopBar(): JSX.Element {
  const { settings, currentSourceId, setSource, navigate } = useStore()
  const sources = settings?.sources ?? []

  return (
    <div className="topbar">
      <button
        className="brand no-drag"
        onClick={() => navigate('home')}
        style={{ background: 'none', border: 'none' }}
      >
        <span className="logo">
          <Icon name="tv" size={18} />
        </span>
        WindowsTV
      </button>

      <div className="spacer" />

      {sources.length > 0 && (
        <select
          className="source-select no-drag"
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

      <Clock />

      <div className="no-drag" style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
        <button className="winbtn" title="Minimize" onClick={() => window.api.window.control('minimize')}>
          <Icon name="minimize" size={16} />
        </button>
        <button className="winbtn" title="Maximize" onClick={() => window.api.window.control('maximize')}>
          <Icon name="maximize" size={14} />
        </button>
        <button className="winbtn close" title="Close" onClick={() => window.api.window.control('close')}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  )
}
