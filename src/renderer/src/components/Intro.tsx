import { useEffect, useRef } from 'react'
import { Logo } from './Logo'
import type { Look } from '../theme'

const LENGTH: Record<Look, number> = { theater: 2700, premium: 2500, wonder: 3000, glass: 2400, classic: 1800 }

/** The logo animation when the app starts. Any key or click skips it. */
export function Intro({ look, onDone }: { look: Look; onDone: () => void }): JSX.Element {
  const done = useRef(false)
  const finish = (): void => {
    if (done.current) return
    done.current = true
    onDone()
  }
  useEffect(() => {
    const t = setTimeout(finish, LENGTH[look])
    const skip = (e: KeyboardEvent): void => {
      e.preventDefault()
      finish()
    }
    window.addEventListener('keydown', skip, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', skip, true)
    }
  }, [look])
  return (
    <div className={`intro intro-${look}`} onClick={finish} style={{ ['--len' as string]: `${LENGTH[look]}ms` }}>
      {look === 'theater' && (
        <div className="in-ribbons" aria-hidden>
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} style={{ ['--i' as string]: i }} />
          ))}
        </div>
      )}
      {look === 'wonder' && <div className="in-stars" aria-hidden />}
      {look === 'glass' && <div className="in-glow" aria-hidden />}
      <div className="in-logo">
        <Logo look={look} height={look === 'theater' ? 230 : 130} />
        {look === 'premium' && <span className="in-glint" aria-hidden />}
      </div>
    </div>
  )
}
