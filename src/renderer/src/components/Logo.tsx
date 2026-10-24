import type { Look } from '../theme'

/*
 * The ello logo, drawn for each look:
 *  - Theater: tall red capitals on a gentle curve.
 *  - Premium: lowercase with a swoosh underneath.
 *  - Wonder:  an arc of light over the name, ending in a star.
 *  - Glass:   a frosted play tile next to the name.
 * Parts carry classes (lg-*) so the start-up animation can move them.
 */
export function Logo({ look, height = 30, className = '' }: { look: Look; height?: number; className?: string }): JSX.Element {
  const font = "'Google Sans Flex Variable', 'Segoe UI', sans-serif"
  if (look === 'theater') {
    return (
      <svg className={`logo logo-theater ${className}`} viewBox="0 0 220 64" height={height} aria-label="ello">
        <defs>
          <linearGradient id="lg-red" x1="0" x2="1">
            <stop offset="0" stopColor="#b1060f" />
            <stop offset="0.5" stopColor="#e50914" />
            <stop offset="1" stopColor="#b1060f" />
          </linearGradient>
          <path id="lg-curve" d="M8 52 Q110 40 212 52" />
        </defs>
        <text
          className="lg-text"
          fill="url(#lg-red)"
          style={{ fontFamily: font, fontWeight: 900, fontSize: 58, letterSpacing: 2, fontVariationSettings: "'wdth' 60, 'wght' 950" }}
        >
          <textPath href="#lg-curve" startOffset="50%" textAnchor="middle">
            ELLO
          </textPath>
        </text>
      </svg>
    )
  }
  if (look === 'premium') {
    return (
      <svg className={`logo logo-premium ${className}`} viewBox="0 0 196 64" height={height} aria-label="ello">
        <text className="lg-text" x="4" y="40" fill="#fff" style={{ fontFamily: font, fontWeight: 800, fontSize: 44, letterSpacing: -1 }}>
          ello
        </text>
        <path className="lg-swoosh" pathLength="1" d="M8 50 Q56 64 104 50" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" />
        <path className="lg-swoosh-head" d="M96 44 L106 49.5 L98 57" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <text className="lg-sub" x="112" y="40" fill="rgba(255,255,255,0.7)" style={{ fontFamily: font, fontWeight: 500, fontSize: 17 }}>
          smartTV
        </text>
      </svg>
    )
  }
  if (look === 'wonder') {
    return (
      <svg className={`logo logo-wonder ${className}`} viewBox="0 0 180 70" height={height} aria-label="ello">
        <defs>
          <linearGradient id="lg-arc" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.35" stopColor="#7fb6ff" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <filter id="lg-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path className="lg-arc" pathLength="1" d="M10 58 C 30 6, 132 0, 160 30" fill="none" stroke="url(#lg-arc)" strokeWidth="3.5" strokeLinecap="round" filter="url(#lg-glow)" />
        <path className="lg-star" d="M160 22 l2.6 5.4 5.4 2.6 -5.4 2.6 -2.6 5.4 -2.6 -5.4 -5.4 -2.6 5.4 -2.6z" fill="#fff" filter="url(#lg-glow)" />
        <text className="lg-text" x="24" y="60" fill="#fff" style={{ fontFamily: font, fontWeight: 700, fontSize: 42, letterSpacing: 0.5 }}>
          ello
        </text>
      </svg>
    )
  }
  if (look === 'glass') {
    return (
      <svg className={`logo logo-glass ${className}`} viewBox="0 0 150 56" height={height} aria-label="ello">
        <defs>
          <linearGradient id="lg-tile" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5a5a5f" />
            <stop offset="1" stopColor="#1c1c1e" />
          </linearGradient>
          <linearGradient id="lg-shine" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="lg-tile">
          <rect x="3" y="5" width="46" height="46" rx="12" fill="url(#lg-tile)" stroke="rgba(255,255,255,0.28)" strokeWidth="1" />
          <rect x="3" y="5" width="46" height="46" rx="12" fill="url(#lg-shine)" />
          <path d="M21 17 L37 28 L21 39 Z" fill="#fff" strokeLinejoin="round" stroke="#fff" strokeWidth="2.5" />
        </g>
        <text className="lg-text" x="58" y="40" fill="#f5f5f7" style={{ fontFamily: font, fontWeight: 600, fontSize: 34, letterSpacing: -0.8 }}>
          ello
        </text>
      </svg>
    )
  }
  return (
    <span className={`wordmark ${className}`}>
      <span className="w-ello">
        ello<span className="dot">.</span>
      </span>
      <span className="w-tv">smartTV</span>
    </span>
  )
}
