import { useEffect } from 'react'
import { activeProfile, useStore } from '../store'
import { backgroundCss, imageBackgroundCss } from '../backgrounds'
import { applyAccent } from '../theme'

/** Applies the active profile's background to the app (not while video plays). */
export function AppBackground(): null {
  const bg = useStore((s) => activeProfile(s)?.background ?? 'default')
  const accent = useStore((s) => activeProfile(s)?.accent)
  useEffect(() => applyAccent(accent), [accent])
  useEffect(() => {
    let cancelled = false
    const apply = (css: string): void => document.documentElement.style.setProperty('--app-bg', css)
    if (bg.startsWith('image:')) {
      void window.api.profiles.backgroundImage(bg).then((r) => {
        if (!cancelled) apply(r.data ? imageBackgroundCss(r.data) : backgroundCss('default'))
      })
    } else apply(backgroundCss(bg))
    return () => {
      cancelled = true
    }
  }, [bg])
  return null
}
