/**
 * Accent colours. The layout follows Netflix, the colour is yours: each profile
 * picks one, and it colours the buttons, progress bars, focus rings and the
 * logo dot everywhere (it replaces --blue, the old accent).
 */
export const ACCENTS: Array<{ id: string; name: string; color: string }> = [
  { id: 'blue', name: 'ello blue', color: '#4c8dff' },
  { id: 'red', name: 'Cinema red', color: '#e50914' },
  { id: 'purple', name: 'Purple', color: '#9b5cff' },
  { id: 'pink', name: 'Pink', color: '#ff3d8b' },
  { id: 'orange', name: 'Orange', color: '#ff7a1a' },
  { id: 'gold', name: 'Gold', color: '#f5b400' },
  { id: 'green', name: 'Green', color: '#1fc65f' },
  { id: 'teal', name: 'Teal', color: '#14c2b0' }
]

export function accentColor(id?: string): string {
  return ACCENTS.find((a) => a.id === id)?.color ?? id?.match(/^#[0-9a-f]{6}$/i)?.[0] ?? ACCENTS[0].color
}

/** Black or white text on top of the accent. */
function onAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111' : '#fff'
}

export function applyAccent(id?: string): void {
  const c = accentColor(id)
  const root = document.documentElement.style
  root.setProperty('--blue', c)
  root.setProperty('--accent', c)
  root.setProperty('--on-accent', onAccent(c))
  root.setProperty('--accent-soft', `${c}33`)
}
