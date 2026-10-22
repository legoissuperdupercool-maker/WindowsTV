// Brand definitions for app-launcher tiles: a bright brand colour + a recognisable
// white logo (inline SVG). When a tile matches a brand (by its URL/target or
// label) the tile uses the brand colour and logo instead of a generic icon.

export interface Brand {
  key: string
  color: string
  /** Inline SVG markup (white marks on the coloured tile). */
  svg: string
  test: RegExp
}

export const BRANDS: Brand[] = [
  {
    key: 'youtube',
    color: '#FF0000',
    test: /youtube|youtu\.be/i,
    svg: `<svg viewBox="0 0 92 64" height="50"><rect x="2" y="2" width="88" height="60" rx="15" fill="#fff"/><path d="M38 19l24 13-24 13z" fill="#FF0000"/></svg>`
  },
  {
    key: 'netflix',
    color: '#E50914',
    test: /netflix/i,
    svg: `<svg viewBox="0 0 46 58" height="54"><path fill="#fff" d="M6 2h9l16 34V2h9v54h-9L15 22v34H6z"/></svg>`
  },
  {
    key: 'spotify',
    color: '#1DB954',
    test: /spotify/i,
    svg: `<svg viewBox="0 0 56 56" height="52"><circle cx="28" cy="28" r="26" fill="#fff"/><g fill="none" stroke="#1DB954" stroke-width="4.2" stroke-linecap="round"><path d="M15 22c10-2.6 20.5-1.6 28 3.6"/><path d="M16 30c8.5-2 16.5-1 23.5 3"/><path d="M17.5 37.5c6.5-1.5 12.5-.7 18 2.6"/></g></svg>`
  },
  {
    key: 'disney',
    color: '#0A36C4',
    test: /disney/i,
    svg: `<svg viewBox="0 0 150 40" height="32"><text x="75" y="31" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="33" font-style="italic" font-weight="700" fill="#fff">Disney<tspan dx="3" dy="-5" font-family="Arial,Helvetica,sans-serif" font-style="normal" font-size="26">+</tspan></text></svg>`
  },
  {
    key: 'prime',
    color: '#1FA2E1',
    test: /prime|amazon/i,
    svg: `<svg viewBox="0 0 110 44" height="34"><text x="2" y="28" font-family="Arial,Helvetica,sans-serif" font-size="29" font-weight="800" fill="#fff">prime</text><path d="M4 33c15 9 34 9 49 0" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>`
  },
  {
    key: 'hulu',
    color: '#1CE783',
    test: /hulu/i,
    svg: `<svg viewBox="0 0 122 34" height="26"><text x="0" y="29" font-family="Arial,Helvetica,sans-serif" font-size="32" font-weight="900" fill="#0a3b22" letter-spacing="-1">hulu</text></svg>`
  },
  {
    key: 'max',
    color: '#0A2FE6',
    test: /\bmax\b|hbo/i,
    svg: `<svg viewBox="0 0 120 34" height="26"><text x="0" y="29" font-family="Arial,Helvetica,sans-serif" font-size="33" font-weight="900" fill="#fff" letter-spacing="-2">max</text></svg>`
  },
  {
    key: 'twitch',
    color: '#9146FF',
    test: /twitch/i,
    svg: `<svg viewBox="0 0 40 44" height="46"><path fill="#fff" d="M4 0L0 9v30h11v5l5-5h8l16-16V0H4zm32 22l-7 7h-9l-5 5v-5H7V4h29v18zM28 11h-4v11h4V11zm-11 0h-4v11h4V11z"/></svg>`
  },
  {
    key: 'appletv',
    color: '#1A1A1A',
    test: /apple\s*tv|tv\.apple/i,
    svg: `<svg viewBox="0 0 150 40" height="28"><text x="0" y="31" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="#fff">tv</text><text x="34" y="31" font-family="Arial" font-size="30" font-weight="400" fill="#fff">+</text></svg>`
  },
  {
    key: 'plex',
    color: '#E5A00D',
    test: /plex/i,
    svg: `<svg viewBox="0 0 48 48" height="46"><path fill="#1a1205" d="M12 4h12l12 20-12 20H12l12-20z"/></svg>`
  },
  {
    key: 'paramount',
    color: '#0064FF',
    test: /paramount/i,
    svg: `<svg viewBox="0 0 150 34" height="24"><text x="0" y="27" font-family="Arial" font-size="24" font-weight="800" fill="#fff" letter-spacing="-1">Paramount+</text></svg>`
  },
  {
    key: 'peacock',
    color: '#05AC3F',
    test: /peacock/i,
    svg: `<svg viewBox="0 0 150 34" height="24"><text x="0" y="27" font-family="Arial" font-size="26" font-weight="800" fill="#fff">peacock</text></svg>`
  }
]

export function detectBrand(target: string, label: string): Brand | null {
  const hay = `${target} ${label}`
  return BRANDS.find((b) => b.test.test(hay)) ?? null
}
