import { useEffect } from 'react'

/**
 * Tells the main process where mpv should draw. For the fullscreen player this is
 * the entire window content area; the main process positions the video window
 * behind this transparent UI window accordingly.
 */
export function useFullscreenVideoRegion(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const apply = (): void => {
      window.api.player.setRegion({
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        visible: true
      })
    }
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      window.api.player.setRegion({ x: 0, y: 0, width: 0, height: 0, visible: false })
    }
  }, [active])
}
