import { useEffect, useId, useRef } from 'react'
import { LogoLetters } from './Logo'
import { LOGO_VIEWBOX } from './logoPaths'

const LENGTH = 3200

// The planet's edge: the top of a big ellipse (centre 836,1900) that peaks under the logo.
const RX = 1500
const RY = 1333
const TOP = 567
const EDGE_Y = 1900 - RY * Math.sqrt(1 - (636 / RX) ** 2)

/**
 * The start-up animation, built on the logo artwork: a blue planet rises out of
 * the dark, its edge lights up from the middle outward, the letters come up one
 * by one and the "o" fills with blue. Any key or click skips it.
 */
export function Intro({ onDone }: { look?: string; onDone: () => void }): JSX.Element {
  const id = useId().replace(/:/g, '')
  const done = useRef(false)
  const finish = (): void => {
    if (done.current) return
    done.current = true
    onDone()
  }
  useEffect(() => {
    const t = setTimeout(finish, LENGTH)
    const skip = (e: KeyboardEvent): void => {
      e.preventDefault()
      finish()
    }
    window.addEventListener('keydown', skip, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', skip, true)
    }
  }, [])
  const [, , vw, vh] = LOGO_VIEWBOX.split(' ').map(Number)
  return (
    <div className="intro" onClick={finish} style={{ ['--len' as string]: `${LENGTH}ms` }}>
      <svg className="in-scene" viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <radialGradient id={`${id}-planet`} gradientUnits="userSpaceOnUse" cx="836" cy="980" r="760">
            <stop offset="0" stopColor="#2a86f2" />
            <stop offset="0.38" stopColor="#0c46b8" />
            <stop offset="0.72" stopColor="#03144a" />
            <stop offset="1" stopColor="#010614" />
          </radialGradient>
          <linearGradient id={`${id}-edge`} gradientUnits="userSpaceOnUse" x1="200" y1="0" x2="1472" y2="0">
            <stop offset="0" stopColor="#1450d0" stopOpacity="0" />
            <stop offset="0.22" stopColor="#1458e0" />
            <stop offset="0.5" stopColor="#3ad6ff" />
            <stop offset="0.78" stopColor="#1458e0" />
            <stop offset="1" stopColor="#1450d0" stopOpacity="0" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-20%" y="-200%" width="140%" height="500%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <ellipse className="in-planet" cx="836" cy="1900" rx={RX} ry={RY} fill={`url(#${id}-planet)`} />
        <g className="in-edge">
          {[`M836 ${TOP} A${RX} ${RY} 0 0 0 200 ${EDGE_Y}`, `M836 ${TOP} A${RX} ${RY} 0 0 1 1472 ${EDGE_Y}`].map((d) => (
            <g key={d}>
              <path className="in-arc glow" pathLength={1} d={d} fill="none" stroke={`url(#${id}-edge)`} strokeWidth="10" filter={`url(#${id}-glow)`} />
              <path className="in-arc" pathLength={1} d={d} fill="none" stroke={`url(#${id}-edge)`} strokeWidth="3.5" strokeLinecap="round" />
            </g>
          ))}
        </g>
        <circle className="in-flare" cx="836" cy={TOP} r="60" fill="#7fe3ff" filter={`url(#${id}-glow)`} />
        <svg className="in-letters" x="560" y="311" width="545" height="246" viewBox={`0 0 ${vw} ${vh}`}>
          <LogoLetters id={`${id}-l`} />
        </svg>
      </svg>
    </div>
  )
}
