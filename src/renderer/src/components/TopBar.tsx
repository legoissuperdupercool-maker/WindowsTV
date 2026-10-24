import { useEffect, useState } from 'react'
import { activeProfile, useStore, type RouteName } from '../store'
import { Icon } from './Icon'
import { Avatar } from './Avatar'

const TABS: Array<{ route: RouteName; label: string }> = [
  { route: 'home', label: 'Home' },
  { route: 'series', label: 'Series' },
  { route: 'movies', label: 'Movies' },
  { route: 'live', label: 'Live TV' },
  { route: 'guide', label: 'TV Guide' },
  { route: 'mylist', label: 'My List' }
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
  const { settings, currentSourceId, setSource, navigate, route, update, setProfilePicker } = useStore()
  const me = useStore(activeProfile)
  const sources = settings?.sources ?? []

  // See-through over the billboard; solid once the page scrolls.
  const [solid, setSolid] = useState(false)
  useEffect(() => {
    const onScroll = (e: Event): void => {
      const t = e.target as HTMLElement
      if (t?.classList?.contains('page')) setSolid(t.scrollTop > 24)
    }
    document.addEventListener('scroll', onScroll, true)
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [])
  useEffect(() => {
    const page = document.querySelector<HTMLElement>('.page')
    setSolid(Boolean(page && page.scrollTop > 24))
  }, [route])

  return (
    <div className={`topbar nf-topbar ${solid ? 'solid' : ''}`}>
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

      {update?.status === 'ready' && (
        <button className="focusable update-pill" onClick={() => void window.api.updates.install()}>
          <Icon name="refresh" size={18} /> Update ready · Restart
        </button>
      )}
      {update?.status === 'downloading' && (
        <span className="update-pill quiet">Updating… {update.percent ?? 0}%</span>
      )}

      <button className="focusable icon-btn" title="Search everything (/ or Ctrl+K)" onClick={() => useStore.getState().setSearchOpen(true)}>
        <Icon name="search" size={24} />
      </button>
      <button className="focusable icon-btn" title="Settings" onClick={() => navigate('settings')}>
        <Icon name="settings" size={24} />
      </button>

      {me && (
        <button className="focusable icon-btn avatar-btn" title={`${me.name} · switch profile`} onClick={() => setProfilePicker(true)}>
          <Avatar profile={me} size={34} />
        </button>
      )}

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
