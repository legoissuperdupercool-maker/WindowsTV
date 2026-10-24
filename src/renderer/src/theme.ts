/**
 * Accent colours. The layout follows Netflix, the colour is yours: each profile
 * picks one, and it colours the buttons, progress bars, focus rings and the
 * logo dot everywhere (it replaces --blue, the old accent).
 */
export const ACCENTS: Array<{ id: string; name: string; color: string }> = [
  { id: 'auto', name: 'Match the style', color: 'auto' },
  { id: 'blue', name: 'ello blue', color: '#4c8dff' },
  { id: 'red', name: 'Cinema red', color: '#e50914' },
  { id: 'purple', name: 'Purple', color: '#9b5cff' },
  { id: 'pink', name: 'Pink', color: '#ff3d8b' },
  { id: 'orange', name: 'Orange', color: '#ff7a1a' },
  { id: 'gold', name: 'Gold', color: '#f5b400' },
  { id: 'green', name: 'Green', color: '#1fc65f' },
  { id: 'teal', name: 'Teal', color: '#14c2b0' }
]

// ------------------------------------------------------------------ looks

/** The app's styles. Theater, Premium, Wonder and Glass share the same screens with their own design. */
export type Look = 'theater' | 'premium' | 'wonder' | 'glass' | 'classic'

export const LOOKS: Array<{ id: Look; name: string; blurb: string; color: string }> = [
  { id: 'theater', name: 'Theater', blurb: 'Black, a side menu and big artwork that fills the screen.', color: '#e50914' },
  { id: 'premium', name: 'Premium', blurb: 'Deep slate, tabs along the top and a rounded hero carousel.', color: '#00a8e1' },
  { id: 'wonder', name: 'Wonder', blurb: 'A starry blue night, glowing cards and collection tiles.', color: '#1f80e0' },
  { id: 'glass', name: 'Glass', blurb: 'Frosted glass, a floating tab bar and cards that tilt as you point.', color: '#f5f5f7' },
  { id: 'classic', name: 'Classic', blurb: 'The original rounded tiles and cards.', color: '#4c8dff' }
]

/** Looks that come with ello Premium. */
export const PREMIUM_LOOKS: ReadonlySet<Look> = new Set<Look>(['premium', 'wonder', 'glass'])

/** The look in use: a Premium look falls back to Theater without Premium. */
export function effectiveLook(value: string | undefined, premium: boolean): Look {
  const look = lookOf(value)
  return !premium && PREMIUM_LOOKS.has(look) ? 'theater' : look
}

/** The saved setting as a look ('cinema' was the old name for Theater). */
export function lookOf(value?: string): Look {
  return LOOKS.some((l) => l.id === value) ? (value as Look) : 'theater'
}

let currentLook: Look = 'theater'

export function accentColor(id?: string, look: Look = currentLook): string {
  if (!id || id === 'auto') return LOOKS.find((l) => l.id === look)?.color ?? '#4c8dff'
  return ACCENTS.find((a) => a.id === id)?.color ?? id.match(/^#[0-9a-f]{6}$/i)?.[0] ?? '#4c8dff'
}

/** Black or white text on top of the accent. */
function onAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111' : '#fff'
}

export function applyAccent(id?: string, look?: Look): void {
  if (look) currentLook = look
  const c = accentColor(id)
  const root = document.documentElement.style
  root.setProperty('--blue', c)
  root.setProperty('--accent', c)
  root.setProperty('--on-accent', onAccent(c))
  root.setProperty('--accent-soft', `${c}33`)
}

/** "Match the style" shows the styles' colours together. */
export function swatchBackground(color: string): string {
  return color === 'auto' ? 'conic-gradient(#e50914 0 25%, #00a8e1 0 50%, #1f80e0 0 75%, #f5f5f7 0)' : color
}
