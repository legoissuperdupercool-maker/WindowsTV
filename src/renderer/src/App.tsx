import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { SearchOverlay } from './components/SearchOverlay'
import { MultiViewScreen } from './components/MultiView'
import {
  useSpatialNavigation,
  setBackHandler,
  focusFirst,
  focusElement,
  getFocused
} from './hooks/useSpatialNavigation'
import { TopBar } from './components/TopBar'
import { Home } from './pages/Home'
import { LiveTV } from './pages/LiveTV'
import { Guide } from './pages/Guide'
import { Movies, MyList, Series } from './pages/Browse'
import { ClassicHome } from './pages/classic/Home'
import { ClassicMovies } from './pages/classic/Movies'
import { ClassicSeries } from './pages/classic/Series'
import { ClassicDetails } from './pages/classic/Details'
import { Settings } from './pages/Settings'
import { Details } from './pages/Details'
import { PlayerOverlay } from './components/PlayerOverlay'
import { WebAppView } from './components/WebAppView'
import { LoadToast } from './components/LoadToast'
import { ProfilePicker } from './components/ProfilePicker'
import { AppBackground } from './components/AppBackground'
import { Intro } from './components/Intro'
import { LOOKS, lookOf } from './theme'
import { useGlassTilt } from './hooks/useGlassTilt'

export default function App(): JSX.Element {
  const {
    ready,
    route,
    init,
    playback,
    playerVisible,
    navigate,
    stopPlayback,
    setPlayerVisible,
    webApp,
    closeWebApp,
    detail,
    closeDetail,
    profilePicker,
    setProfilePicker
  } = useStore()
  const settings = useStore((st) => st.settings)
  // Look classes on <html>: theme-cinema for every look built on the shared
  // screens (Theater, Premium, Wonder, Glass), plus theme-<look> for its design.
  const look = lookOf(settings?.uiTheme)
  useEffect(() => {
    const root = document.documentElement.classList
    root.toggle('theme-cinema', look !== 'classic')
    root.toggle('theme-classic', look === 'classic')
    for (const l of LOOKS) root.toggle(`theme-${l.id}`, l.id === look)
  }, [look])

  // Logo animation at start (and from Settings → Look → "Play intro").
  const [intro, setIntro] = useState<'pending' | 'playing' | 'done'>('pending')
  useEffect(() => {
    if (intro === 'pending' && settings) setIntro(settings.intro === false ? 'done' : 'playing')
  }, [settings, intro])
  useEffect(() => {
    const replay = (): void => setIntro('playing')
    window.addEventListener('ello:intro', replay)
    return () => window.removeEventListener('ello:intro', replay)
  }, [])
  useGlassTilt(look === 'glass')
  const multiView = useStore((st) => st.multiView)

  useSpatialNavigation()

  useEffect(() => {
    void init()
  }, [init])

  // Toggle the transparent-window body class so mpv shows through while playing.
  useEffect(() => {
    const playing = (playerVisible && playback.status !== 'idle') || multiView != null
    document.documentElement.classList.toggle('playing', playing)
  }, [playerVisible, playback.status, multiView])

  // Re-seed focus whenever the page changes. Opening a detail screen remembers
  // the focused card; closing it puts focus back on that card.
  const focusBeforeDetail = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (detail) focusBeforeDetail.current ??= getFocused()
    const t = setTimeout(() => {
      const back = focusBeforeDetail.current
      if (!detail && back && back.isConnected && back.offsetParent) {
        focusElement(back)
        focusBeforeDetail.current = null
      } else {
        if (!detail) focusBeforeDetail.current = null
        focusFirst()
      }
    }, 60)
    return () => clearTimeout(t)
  }, [route, ready, detail?.id, profilePicker])

  // Global back behaviour: close player → return home → (root).
  useEffect(() => {
    setBackHandler(() => {
      if (profilePicker) {
        setProfilePicker(false)
        return true
      }
      if (webApp.open) {
        closeWebApp()
        return true
      }
      if (useStore.getState().multiView) {
        useStore.getState().closeMultiView()
        return true
      }
      if (playerVisible) {
        // Back/Esc first leaves picture-in-picture or fullscreen, then the player.
        const mode = useStore.getState().windowMode
        if (mode.pip) {
          void window.api.window.control('pipOff')
          return true
        }
        if (mode.fullscreen) {
          void window.api.window.control('fullscreenOff')
          return true
        }
        stopPlayback()
        setPlayerVisible(false)
        return true
      }
      if (detail) {
        closeDetail()
        return true
      }
      if (route !== 'home') {
        navigate('home')
        return true
      }
      return false
    })
    return () => setBackHandler(null)
  }, [playerVisible, route, navigate, stopPlayback, setPlayerVisible, webApp.open, closeWebApp, detail, closeDetail, profilePicker, setProfilePicker])

  const searchOpen = useStore((st) => st.searchOpen)
  const setSearchOpen = useStore((st) => st.setSearchOpen)
  // "/" or Ctrl+K opens search from anywhere outside the player and text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (useStore.getState().playerVisible) return
      if (e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen])

  if (!ready) {
    // Same splash as index.html, so there's no flash while settings load.
    return (
      <div className="splash">
        <img src="./icon.png" alt="" />
        <div className="name">
          <b>
            ello<span style={{ color: '#4c8dff' }}>.</span>
          </b>{' '}
          <span>smartTV</span>
        </div>
        <div className="bar">
          <i />
        </div>
      </div>
    )
  }

  // The full-screen player and the in-app browser bring their own top controls,
  // so the main top bar is hidden while either is active.
  const overlayUp = playerVisible || webApp.open || multiView != null
  const cinema = look !== 'classic'
  // Cinema: the detail window opens over the page, so the page stays. Classic:
  // the detail screen replaces it.
  const showChrome = !overlayUp && !profilePicker && (cinema || !detail)

  return (
    <>
      {/* Pages stay mounted (so scroll position and lists survive opening a
          movie or the player) but are display:none while the player / in-app
          browser / a detail screen is up — hidden elements aren't painted, so
          the transparent window still shows the mpv video behind it. */}
      <div style={{ display: showChrome ? 'contents' : 'none' }}>
        <TopBar />
        {route === 'home' && (cinema ? <Home /> : <ClassicHome />)}
        {route === 'live' && <LiveTV />}
        {route === 'guide' && <Guide />}
        {route === 'movies' && (cinema ? <Movies /> : <ClassicMovies />)}
        {route === 'series' && (cinema ? <Series /> : <ClassicSeries />)}
        {route === 'settings' && <Settings />}
        {route === 'mylist' && <MyList />}
      </div>
      {detail && (
        <div style={{ display: overlayUp ? 'none' : 'contents' }}>
          {cinema ? <Details /> : <ClassicDetails />}
        </div>
      )}
      {playerVisible && !webApp.open && <PlayerOverlay />}
      {webApp.open && <WebAppView />}
      {profilePicker && !overlayUp && <ProfilePicker />}
      {searchOpen && !overlayUp && <SearchOverlay onClose={() => setSearchOpen(false)} />}
      {multiView && !playerVisible && <MultiViewScreen initial={multiView} />}
      <AppBackground />
      <LoadToast />
      {intro === 'playing' && <Intro look={look} onDone={() => setIntro('done')} />}
    </>
  )
}
