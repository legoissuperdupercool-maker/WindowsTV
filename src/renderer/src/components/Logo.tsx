import { useId } from 'react'
import { LOGO_E, LOGO_L1, LOGO_L2, LOGO_O, LOGO_TRANSFORM, LOGO_VIEWBOX } from './logoPaths'
import type { Look } from '../theme'

/**
 * The ello logo: white letters, the "o" turning blue toward its lower right.
 * Every look uses it. Parts carry classes (lg-*) for the start-up animation.
 */
export function Logo({ height = 30, className = '' }: { look?: Look; height?: number; className?: string }): JSX.Element {
  const id = useId().replace(/:/g, '')
  return (
    <svg className={`logo ${className}`} viewBox={LOGO_VIEWBOX} height={height} aria-label="ello">
      <LogoLetters id={id} />
    </svg>
  )
}

/** The letters on their own, for use inside another SVG (the intro). */
export function LogoLetters({ id }: { id: string }): JSX.Element {
  return (
    <>
      <defs>
        {/* The paths are drawn upside down (potrace), so the box's y runs bottom → top. */}
        <linearGradient id={`${id}-o`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#f3f3f7" />
          <stop offset="0.5" stopColor="#f3f3f7" />
          <stop offset="0.7" stopColor="#8acbf9" />
          <stop offset="0.86" stopColor="#0986f5" />
          <stop offset="1" stopColor="#0a6fe0" />
        </linearGradient>
      </defs>
      <g transform={LOGO_TRANSFORM}>
        <path className="lg-e" d={LOGO_E} fill="#f3f3f7" />
        <path className="lg-l1" d={LOGO_L1} fill="#f3f3f7" />
        <path className="lg-l2" d={LOGO_L2} fill="#f3f3f7" />
        <path className="lg-o" d={LOGO_O} fill="#f3f3f7" />
        <path className="lg-o-tint" d={LOGO_O} fill={`url(#${id}-o)`} />
      </g>
    </>
  )
}
