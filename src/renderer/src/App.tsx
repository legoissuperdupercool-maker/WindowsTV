import { useEffect, useRef } from 'react'
import { useStore } from './store'
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
import { Movies } from './pages/Movies'
import { Series } from './pages/Series'
import { Settings } from './pages/Settings'
import { Details } from './pages/Details'
import { PlayerOverlay } from './components/PlayerOverlay'
import { WebAppView } from './components/WebAppView'
import { LoadToast } from './components/LoadToast'

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
    closeDetail
  } = useStore()

  useSpatialNavigation()

  useEffect(() => {
    void init()
  }, [init])

  // Toggle the transparent-window body class so mpv shows through while playing.
  useEffect(() => {
    const playing = playerVisible && playback.status !== 'idle'
    document.documentElement.classList.toggle('playing', playing)
  }, [playerVisible, playback.status])

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
  }, [route, ready, detail?.id])

  // Global back behaviour: close player → return home → (root).
  useEffect(() => {
    setBackHandler(() => {
      if (webApp.open) {
        closeWebApp()
        return true
      }
      if (playerVisible) {
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
  }, [playerVisible, route, navigate, stopPlayback, setPlayerVisible, webApp.open, closeWebApp, detail, closeDetail])

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
  const overlayUp = playerVisible || webApp.open
  const showChrome = !overlayUp && !detail

  return (
    <>
      {/* Pages stay mounted (so scroll position and lists survive opening a
          movie or the player) but are display:none while the player / in-app
          browser / a detail screen is up — hidden elements aren't painted, so
          the transparent window still shows the mpv video behind it. */}
      <div style={{ display: showChrome ? 'contents' : 'none' }}>
        <TopBar />
        {route === 'home' && <Home />}
        {route === 'live' && <LiveTV />}
        {route === 'guide' && <Guide />}
        {route === 'movies' && <Movies />}
        {route === 'series' && <Series />}
        {route === 'settings' && <Settings />}
      </div>
      {detail && (
        <div style={{ display: overlayUp ? 'none' : 'contents' }}>
          <Details />
        </div>
      )}
      {playerVisible && !webApp.open && <PlayerOverlay />}
      {webApp.open && <WebAppView />}
      <LoadToast />
    </>
  )
}
