import { useEffect } from 'react'
import { useStore } from './store'
import {
  useSpatialNavigation,
  setBackHandler,
  focusFirst
} from './hooks/useSpatialNavigation'
import { TopBar } from './components/TopBar'
import { Home } from './pages/Home'
import { LiveTV } from './pages/LiveTV'
import { Guide } from './pages/Guide'
import { Movies } from './pages/Movies'
import { Series } from './pages/Series'
import { Settings } from './pages/Settings'
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
    closeWebApp
  } = useStore()

  useSpatialNavigation()

  useEffect(() => {
    void init()
  }, [init])

  // Toggle the transparent-window body class so mpv shows through while playing.
  useEffect(() => {
    const playing = playerVisible && playback.status !== 'idle'
    document.body.classList.toggle('playing', playing)
  }, [playerVisible, playback.status])

  // Re-seed focus whenever the page changes.
  useEffect(() => {
    const t = setTimeout(() => focusFirst(), 60)
    return () => clearTimeout(t)
  }, [route, ready])

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
      if (route !== 'home') {
        navigate('home')
        return true
      }
      return false
    })
    return () => setBackHandler(null)
  }, [playerVisible, route, navigate, stopPlayback, setPlayerVisible, webApp.open, closeWebApp])

  if (!ready) {
    return (
      <div className="empty">
        <div>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          Starting ello smartTV…
        </div>
      </div>
    )
  }

  // The full-screen player and the in-app browser bring their own top controls,
  // so the main top bar is hidden while either is active.
  const showChrome = !playerVisible && !webApp.open

  return (
    <>
      {/* Pages are not rendered while the player / in-app browser is up: the
          UI window must stay transparent so the mpv video behind it shows. */}
      {showChrome && <TopBar />}
      {showChrome && route === 'home' && <Home />}
      {showChrome && route === 'live' && <LiveTV />}
      {showChrome && route === 'guide' && <Guide />}
      {showChrome && route === 'movies' && <Movies />}
      {showChrome && route === 'series' && <Series />}
      {showChrome && route === 'settings' && <Settings />}
      {playerVisible && !webApp.open && <PlayerOverlay />}
      {webApp.open && <WebAppView />}
      <LoadToast />
    </>
  )
}
