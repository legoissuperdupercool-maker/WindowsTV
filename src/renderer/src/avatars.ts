/**
 * Profile pictures in the classic streaming style: a flat coloured square with a
 * simple, friendly face. Plain shapes only (no gradients or ids), so any number
 * can sit on one screen.
 */

interface Art {
  id: string
  name: string
  svg: string
}

type Eyes = 'pill' | 'dot' | 'happy' | 'wink' | 'wide' | 'sleepy'
type Mouth = 'smile' | 'grin' | 'small' | 'smirk' | 'open' | 'tongue'

function eyes(kind: Eyes, c: string): string {
  switch (kind) {
    case 'pill':
      return `<rect x="29" y="28" width="10" height="20" rx="5" fill="${c}"/><rect x="61" y="28" width="10" height="20" rx="5" fill="${c}"/>`
    case 'dot':
      return `<circle cx="34" cy="40" r="7" fill="${c}"/><circle cx="66" cy="40" r="7" fill="${c}"/>`
    case 'happy':
      return `<path d="M25 43 Q34 30 43 43 M57 43 Q66 30 75 43" stroke="${c}" stroke-width="6.5" fill="none" stroke-linecap="round"/>`
    case 'wink':
      return `<rect x="29" y="28" width="10" height="20" rx="5" fill="${c}"/><path d="M58 40 Q66 34 74 40" stroke="${c}" stroke-width="6.5" fill="none" stroke-linecap="round"/>`
    case 'wide':
      return `<ellipse cx="34" cy="39" rx="8" ry="11" fill="${c}"/><ellipse cx="66" cy="39" rx="8" ry="11" fill="${c}"/>`
    case 'sleepy':
      return `<path d="M25 37 Q34 47 43 37 M57 37 Q66 47 75 37" stroke="${c}" stroke-width="6.5" fill="none" stroke-linecap="round"/>`
  }
}

function mouth(kind: Mouth, c: string, bg: string): string {
  switch (kind) {
    case 'smile':
      return `<path d="M24 60 Q50 88 76 60" stroke="${c}" stroke-width="7.5" fill="none" stroke-linecap="round"/>`
    case 'grin':
      return `<path d="M27 59 H73 Q73 85 50 85 Q27 85 27 59Z" fill="${c}"/>`
    case 'small':
      return `<path d="M37 66 Q50 77 63 66" stroke="${c}" stroke-width="6.5" fill="none" stroke-linecap="round"/>`
    case 'smirk':
      return `<path d="M33 69 Q55 78 71 61" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/>`
    case 'open':
      return `<ellipse cx="50" cy="70" rx="10" ry="12" fill="${c}"/>`
    case 'tongue':
      return `<path d="M27 59 H73 Q73 85 50 85 Q27 85 27 59Z" fill="${c}"/><path d="M40 73 Q50 66 60 73 Q60 84 50 84 Q40 84 40 73Z" fill="${bg === '#ff5fa2' ? '#b3124f' : '#ff6f8e'}"/>`
  }
}

const face = (id: string, name: string, bg: string, e: Eyes, m: Mouth, dark = false): Art => {
  const c = dark ? '#1d1d1f' : '#ffffff'
  return {
    id,
    name,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/>${eyes(e, c)}${mouth(m, c, bg)}</svg>`
  }
}

export const AVATARS: Art[] = [
  face('blue', 'Sky', '#1f80e0', 'pill', 'smile'),
  face('yellow', 'Sunny', '#ffcf3d', 'pill', 'smile', true),
  face('red', 'Ruby', '#e5383b', 'pill', 'smile'),
  face('green', 'Mint', '#2fb36a', 'pill', 'smile'),
  face('purple', 'Violet', '#8e5cf6', 'dot', 'grin'),
  face('orange', 'Tangerine', '#ff8a3d', 'happy', 'grin'),
  face('teal', 'Lagoon', '#25c2b8', 'wink', 'smile', true),
  face('pink', 'Bubblegum', '#ff5fa2', 'wide', 'tongue'),
  face('slate', 'Slate', '#55657a', 'sleepy', 'small'),
  face('navy', 'Midnight', '#22346b', 'dot', 'smirk'),
  face('lime', 'Lime', '#a3d64f', 'happy', 'open', true),
  face('cherry', 'Cherry', '#b3123a', 'wide', 'small'),
  face('sky2', 'Breeze', '#5ab8ff', 'happy', 'smile', true),
  face('gold', 'Gold', '#e8a317', 'wink', 'grin', true),
  face('coral', 'Coral', '#ff6b5e', 'dot', 'open'),
  face('forest', 'Forest', '#1e6b4a', 'pill', 'smirk'),
  face('lilac', 'Lilac', '#c9a7ff', 'sleepy', 'grin', true),
  face('charcoal', 'Charcoal', '#2b2b30', 'wide', 'smile')
]

export function avatarArt(id?: string): Art | undefined {
  return AVATARS.find((a) => a.id === id)
}

/** A new profile gets a picture nobody else uses yet. */
export function freeAvatar(used: Array<string | undefined>): string {
  const taken = new Set(used.filter(Boolean))
  return `art:${(AVATARS.find((a) => !taken.has(`art:${a.id}`)) ?? AVATARS[0]).id}`
}
