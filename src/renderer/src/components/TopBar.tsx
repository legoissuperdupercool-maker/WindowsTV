import { useEffect, useState } from 'react'
import { activeProfile, useStore, type RouteName } from '../store'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { Logo } from './Logo'
import { lookOf, type Look } from '../theme'

const CLASSIC_TABS: Array<{ route: RouteName; label: string }> = [
  { route: 'home', label: 'Home' },
  { route: 'live', label: 'Live TV' },
  { route: 'guide', label: 'Guide' },
  { route: 'movies', label: 'Movies' },
  { route: 'series', label: 'Series' }
]

const TABS: Array<{ route: RouteName; label: string; icon: string }> = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'series', label: 'Series', icon: 'series' },
  { route: 'movies', label: 'Movies', icon: 'movie' },
  { route: 'live', label: 'Live TV', icon: 'live' },
  { route: 'guide', label: 'TV Guide', icon: 'guide' },
  { route: 'mylist', label: 'My List', icon: 'bookmarks' }
]

/** The logo for the current look. */
export function Wordmark(): JSX.Element {
  const look = lookOf(useStore((s) => s.settings?.uiTheme))
  if (look !== 'classic') return <Logo look={look} height={32} />
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
  const look = lookOf(useStore((s) => s.settings?.uiTheme))
  if (look === 'theater') return <SideBar />
  if (look === 'classic') return <ClassicTopBar />
  return <TopNav look={look} />
}

type NavItem = { route: RouteName | 'search'; label: string; icon: string }
const NAV: Record<'premium' | 'wonder' | 'glass', NavItem[]> = {
  premium: [
    { route: 'home', label: 'Home', icon: 'home' },
    { route: 'movies', label: 'Movies', icon: 'movie' },
    { route: 'series', label: 'TV Shows', icon: 'series' },
    { route: 'live', label: 'Live TV', icon: 'live' },
    { route: 'guide', label: 'Guide', icon: 'guide' },
    { route: 'mylist', label: 'My Stuff', icon: 'bookmarks' }
  ],
  wonder: [
    { route: 'home', label: 'Home', icon: 'home' },
    { route: 'search', label: 'Search', icon: 'search' },
    { route: 'mylist', label: 'Watchlist', icon: 'add' },
    { route: 'movies', label: 'Movies', icon: 'movie' },
    { route: 'series', label: 'Series', icon: 'series' },
    { route: 'live', label: 'Live', icon: 'live' }
  ],
  glass: [
    { route: 'home', label: 'Watch Now', icon: 'play' },
    { route: 'movies', label: 'Movies', icon: 'movie' },
    { route: 'series', label: 'TV Shows', icon: 'series' },
    { route: 'live', label: 'Live', icon: 'live' },
    { route: 'guide', label: 'Guide', icon: 'guide' },
    { route: 'mylist', label: 'Library', icon: 'bookmarks' }
  ]
}

/** See-through over the artwork, solid (or frosted) once the page scrolls. */
function useScrolled(route: string): boolean {
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
  return solid
}

/** Premium, Wonder and Glass: a bar along the top, each in its own style. */
function TopNav({ look }: { look: Exclude<Look, 'theater' | 'classic'> }): JSX.Element {
  const { navigate, route, setProfilePicker, settings, currentSourceId, setSource, update } = useStore()
  const me = useStore(activeProfile)
  const solid = useScrolled(route)
  const sources = settings?.sources ?? []
  const items = NAV[look]
  return (
    <div className={`topbar look-nav look-nav-${look} ${solid ? 'solid' : ''}`}>
      <button className="ln-logo" onClick={() => navigate('home')} title="Home">
        <Logo look={look} height={look === 'wonder' ? 40 : 30} />
      </button>
      <nav className="ln-tabs">
        {items.map((t) => (
          <button
            key={t.route}
            className={`focusable ln-tab ${route === t.route ? 'active' : ''}`}
            onClick={() => (t.route === 'search' ? useStore.getState().setSearchOpen(true) : navigate(t.route))}
          >
            {look === 'wonder' && <Icon name={t.icon} size={20} />}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="spacer" />
      {sources.length > 1 && (
        <select className="source-select" value={currentSourceId ?? ''} onChange={(e) => void setSource(e.target.value)}>
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
      {look !== 'wonder' && (
        <button className="focusable icon-btn" title="Search everything (/ or Ctrl+K)" onClick={() => useStore.getState().setSearchOpen(true)}>
          <Icon name="search" size={24} />
        </button>
      )}
      <button className={`focusable icon-btn ${route === 'settings' ? 'active' : ''}`} title="Settings" onClick={() => navigate('settings')}>
        <Icon name="settings" size={24} />
      </button>
      {me && (
        <button className="focusable icon-btn avatar-btn" title={`${me.name} · switch profile`} onClick={() => setProfilePicker(true)}>
          <Avatar profile={me} size={34} round={look !== 'premium'} />
        </button>
      )}
      <Clock />
    </div>
  )
}

/**
 * Cinema look: a slim column of icons on the left (like a streaming app on a TV)
 * that slides open with labels when you point at it or move into it.
 */
function SideBar(): JSX.Element {
  const { navigate, route, setProfilePicker } = useStore()
  const me = useStore(activeProfile)
  const item = (key: string, icon: string, label: string, onClick: () => void, active = false): JSX.Element => (
    <button key={key} className={`focusable sb-item ${active ? 'active' : ''}`} onClick={onClick} title={label}>
      <span className="sb-icon">
        <Icon name={icon} size={26} />
      </span>
      <span className="sb-label">{label}</span>
    </button>
  )
  return (
    <>
      <nav className="sidebar" aria-label="Main">
        {me && (
          <button className="focusable sb-item sb-profile" onClick={() => setProfilePicker(true)} title={`${me.name} · switch profile`}>
            <span className="sb-icon">
              <Avatar profile={me} size={34} />
            </span>
            <span className="sb-label">
              {me.name}
              <small>Switch profile</small>
            </span>
          </button>
        )}
        <div className="sb-main">
          {item('search', 'search', 'Search', () => useStore.getState().setSearchOpen(true))}
          {TABS.map((t) => item(t.route, t.icon, t.label, () => navigate(t.route), route === t.route))}
        </div>
        {item('settings', 'settings', 'Settings', () => navigate('settings'), route === 'settings')}
      </nav>
      <WindowStrip />
    </>
  )
}

/** Top-right corner in the Cinema look: updates, source, clock and the window buttons (and a drag area). */
function WindowStrip(): JSX.Element {
  const { settings, currentSourceId, setSource, update, route } = useStore()
  const sources = settings?.sources ?? []
  const scrolled = useScrolled(route)
  return (
    <div className={`win-strip ${scrolled ? 'scrolled' : ''}`}>
      <span className="ws-logo">
        <Logo look="theater" height={34} />
      </span>
      <span style={{ flex: 1 }} />
      {sources.length > 1 && (
        <select className="source-select" value={currentSourceId ?? ''} onChange={(e) => void setSource(e.target.value)}>
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
      {update?.status === 'downloading' && <span className="update-pill quiet">Updating… {update.percent ?? 0}%</span>}
      <Clock />
    </div>
  )
}

/**
 * Minimize / maximize / close, always in the top-right corner (the window has no
 * frame of its own). Rendered once by App, over every screen.
 */
export function WindowControls(): JSX.Element {
  return (
    <div className="app-winctrls">
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
  )
}

function ClassicTopBar(): JSX.Element {
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
    <div className={`topbar ${solid ? 'solid' : ''}`}>
      <Wordmark />

      <nav className="tabs">
        {CLASSIC_TABS.map((t) => (
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
    </div>
  )
}
