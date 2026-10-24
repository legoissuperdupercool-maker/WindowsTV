/**
 * Profile pictures: ello's own illustrated characters (vector, drawn here, so
 * they're sharp at any size). The same drawings are exported as PNGs for the
 * Apple apps (scripts/export-avatars.mjs). A profile stores `art:<id>`, or
 * `image:<file>` for a picture the person uploaded.
 */

type Eyes = 'dots' | 'happy' | 'big' | 'wink' | 'sleepy' | 'stars' | 'shades' | 'robot' | 'alien' | 'cyclops' | 'owl'
type Mouth = 'smile' | 'grin' | 'open' | 'o' | 'cat' | 'tongue' | 'flat' | 'teeth' | 'beak' | 'none'

const eyes = (kind: Eyes, y = 52, gap = 13, ink = '#1b1b1f'): string => {
  const l = 50 - gap
  const r = 50 + gap
  switch (kind) {
    case 'dots':
      return `<circle cx="${l}" cy="${y}" r="4.6" fill="${ink}"/><circle cx="${r}" cy="${y}" r="4.6" fill="${ink}"/>` +
        `<circle cx="${l + 1.6}" cy="${y - 1.6}" r="1.5" fill="#fff"/><circle cx="${r + 1.6}" cy="${y - 1.6}" r="1.5" fill="#fff"/>`
    case 'big':
      return `<ellipse cx="${l}" cy="${y}" rx="7" ry="8" fill="#fff"/><ellipse cx="${r}" cy="${y}" rx="7" ry="8" fill="#fff"/>` +
        `<circle cx="${l + 1}" cy="${y + 1}" r="4.6" fill="${ink}"/><circle cx="${r + 1}" cy="${y + 1}" r="4.6" fill="${ink}"/>` +
        `<circle cx="${l + 2.6}" cy="${y - 1}" r="1.6" fill="#fff"/><circle cx="${r + 2.6}" cy="${y - 1}" r="1.6" fill="#fff"/>`
    case 'happy':
      return `<path d="M${l - 5} ${y + 2} q5 -7 10 0" stroke="${ink}" stroke-width="3.6" fill="none" stroke-linecap="round"/>` +
        `<path d="M${r - 5} ${y + 2} q5 -7 10 0" stroke="${ink}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`
    case 'wink':
      return `<circle cx="${l}" cy="${y}" r="4.6" fill="${ink}"/><circle cx="${l + 1.6}" cy="${y - 1.6}" r="1.5" fill="#fff"/>` +
        `<path d="M${r - 5} ${y + 1} q5 -6 10 0" stroke="${ink}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`
    case 'sleepy':
      return `<path d="M${l - 5} ${y} q5 5 10 0" stroke="${ink}" stroke-width="3.4" fill="none" stroke-linecap="round"/>` +
        `<path d="M${r - 5} ${y} q5 5 10 0" stroke="${ink}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`
    case 'stars': {
      const star = (cx: number): string =>
        `<path transform="translate(${cx} ${y})" d="M0 -7 L2 -2.2 L7 -2 L3.1 1.2 L4.4 6.2 L0 3.4 L-4.4 6.2 L-3.1 1.2 L-7 -2 L-2 -2.2Z" fill="#ffd23f" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>`
      return star(l) + star(r)
    }
    case 'shades':
      return `<path d="M${l - 11} ${y - 6} h22 v4 q-1 10 -11 10 q-10 0 -11 -10z" fill="${ink}"/>` +
        `<path d="M${r - 11} ${y - 6} h22 v4 q-1 10 -11 10 q-10 0 -11 -10z" fill="${ink}"/>` +
        `<rect x="${l + 10}" y="${y - 6}" width="${r - l - 20}" height="3.4" fill="${ink}"/>` +
        `<path d="M${l - 7} ${y - 3} l5 0" stroke="#fff" stroke-width="2" opacity=".55" stroke-linecap="round"/>` +
        `<path d="M${r - 7} ${y - 3} l5 0" stroke="#fff" stroke-width="2" opacity=".55" stroke-linecap="round"/>`
    case 'robot':
      return `<rect x="${l - 7}" y="${y - 5}" width="14" height="10" rx="3" fill="#5ff2e0"/><rect x="${r - 7}" y="${y - 5}" width="14" height="10" rx="3" fill="#5ff2e0"/>` +
        `<rect x="${l - 3}" y="${y - 2}" width="5" height="4" rx="1" fill="#0d3b47"/><rect x="${r - 3}" y="${y - 2}" width="5" height="4" rx="1" fill="#0d3b47"/>`
    case 'alien':
      return `<ellipse cx="${l - 1}" cy="${y}" rx="8.5" ry="11" transform="rotate(-18 ${l - 1} ${y})" fill="${ink}"/>` +
        `<ellipse cx="${r + 1}" cy="${y}" rx="8.5" ry="11" transform="rotate(18 ${r + 1} ${y})" fill="${ink}"/>` +
        `<ellipse cx="${l + 1}" cy="${y - 4}" rx="2.4" ry="3.2" fill="#fff" opacity=".85"/><ellipse cx="${r + 3}" cy="${y - 4}" rx="2.4" ry="3.2" fill="#fff" opacity=".85"/>`
    case 'cyclops':
      return `<circle cx="50" cy="${y}" r="12" fill="#fff"/><circle cx="51.5" cy="${y + 1.5}" r="7" fill="${ink}"/><circle cx="54" cy="${y - 1.5}" r="2.4" fill="#fff"/>`
    case 'owl':
      return `<circle cx="${l}" cy="${y}" r="11" fill="#fff6d8"/><circle cx="${r}" cy="${y}" r="11" fill="#fff6d8"/>` +
        `<circle cx="${l + 1}" cy="${y + 1}" r="6" fill="${ink}"/><circle cx="${r - 1}" cy="${y + 1}" r="6" fill="${ink}"/>` +
        `<circle cx="${l + 3}" cy="${y - 1.5}" r="2" fill="#fff"/><circle cx="${r + 1}" cy="${y - 1.5}" r="2" fill="#fff"/>`
  }
}

const mouth = (kind: Mouth, y = 66, ink = '#1b1b1f'): string => {
  switch (kind) {
    case 'smile':
      return `<path d="M41 ${y} q9 9 18 0" stroke="${ink}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`
    case 'grin':
      return `<path d="M38 ${y - 2} q12 16 24 0 z" fill="${ink}"/><path d="M42 ${y + 3.5} q8 5 16 0 q-8 -1 -16 0z" fill="#ff7a8a"/>`
    case 'open':
      return `<ellipse cx="50" cy="${y + 1}" rx="7" ry="6" fill="${ink}"/><ellipse cx="50" cy="${y + 4}" rx="4.4" ry="2.6" fill="#ff7a8a"/>`
    case 'o':
      return `<ellipse cx="50" cy="${y + 1}" rx="4" ry="4.8" fill="${ink}"/>`
    case 'cat':
      return `<path d="M42 ${y - 1} q4 5 8 0 q4 5 8 0" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    case 'tongue':
      return `<path d="M40 ${y - 1} q10 10 20 0" stroke="${ink}" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M50 ${y + 3} q-1 8 5 8 q5 -1 3 -8z" fill="#ff6f86" stroke="${ink}" stroke-width="2"/>`
    case 'flat':
      return `<path d="M43 ${y} h14" stroke="${ink}" stroke-width="3.4" stroke-linecap="round"/>`
    case 'teeth':
      return `<rect x="38" y="${y - 4}" width="24" height="10" rx="5" fill="${ink}"/><path d="M41 ${y - 4} h18 v4 h-18z" fill="#fff"/><path d="M47 ${y - 4} v4 M53 ${y - 4} v4" stroke="${ink}" stroke-width="1.4"/>`
    case 'beak':
      return `<path d="M44 ${y - 6} q6 -3 12 0 l-6 9z" fill="#ffb02e" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>`
    case 'none':
      return ''
  }
}

const cheeks = (y = 62, color = '#ff7f9a', o = 0.55): string =>
  `<ellipse cx="29" cy="${y}" rx="5.5" ry="3.6" fill="${color}" opacity="${o}"/><ellipse cx="71" cy="${y}" rx="5.5" ry="3.6" fill="${color}" opacity="${o}"/>`

const bg = (a: string, b: string): string =>
  `<defs><radialGradient id="g" cx="30%" cy="22%" r="95%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs><rect width="100" height="100" fill="url(#g)"/>`

/** Face shapes sit a little low, like a character peeking up into the frame. */
const blob = (fill: string): string => `<path d="M14 100 V60 C14 30 30 18 50 18 C70 18 86 30 86 60 V100Z" fill="${fill}"/>`

interface Art {
  id: string
  name: string
  svg: string
}

const A = (id: string, name: string, body: string): Art => ({
  id,
  name,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`
})

export const AVATARS: Art[] = [
  A('sunny', 'Sunny', bg('#4f8cff', '#1d3fa8') + blob('#ffd23f') + eyes('happy') + mouth('grin') + cheeks()),
  A('mochi', 'Mochi', bg('#ff9ec4', '#d94f8c') + blob('#fff4f0') + eyes('sleepy', 54) + mouth('cat', 66) + cheeks(63, '#ff6f9a', 0.7)),
  A('robo', 'Robo', bg('#2a3550', '#11172a') +
    `<rect x="47.5" y="8" width="5" height="12" fill="#9aa6bd"/><circle cx="50" cy="8" r="5" fill="#ff5a5a"/>` +
    `<rect x="18" y="22" width="64" height="70" rx="14" fill="#c9d2e3"/><rect x="18" y="22" width="64" height="70" rx="14" fill="none" stroke="#8b97ad" stroke-width="2"/>` +
    `<rect x="10" y="46" width="8" height="18" rx="3" fill="#9aa6bd"/><rect x="82" y="46" width="8" height="18" rx="3" fill="#9aa6bd"/>` +
    eyes('robot', 50) + mouth('teeth', 72, '#3b4560')),
  A('kitty', 'Kitty', bg('#26c6b0', '#0c7d73') +
    `<path d="M20 44 L24 14 L44 30Z M80 44 L76 14 L56 30Z" fill="#ff9a3c"/><path d="M25 38 L27 22 L38 31Z M75 38 L73 22 L62 31Z" fill="#ffc6a6"/>` +
    blob('#ff9a3c') + `<path d="M50 62 l-3 -3 h6z" fill="#e2476a"/>` + eyes('big', 50) + mouth('cat', 67) +
    `<path d="M20 60 l12 2 M20 66 l12 0 M80 60 l-12 2 M80 66 l-12 0" stroke="#7a3d12" stroke-width="1.6" stroke-linecap="round"/>`),
  A('bear', 'Bear', bg('#4cc26b', '#1e7a3c') +
    `<circle cx="24" cy="30" r="11" fill="#8a5a3c"/><circle cx="76" cy="30" r="11" fill="#8a5a3c"/><circle cx="24" cy="30" r="5.5" fill="#c99a76"/><circle cx="76" cy="30" r="5.5" fill="#c99a76"/>` +
    blob('#8a5a3c') + `<ellipse cx="50" cy="66" rx="15" ry="11" fill="#d8b08f"/><ellipse cx="50" cy="61" rx="5" ry="3.6" fill="#2b1a10"/>` +
    eyes('dots', 48) + mouth('smile', 68, '#2b1a10')),
  A('panda', 'Panda', bg('#9b6dff', '#5328b8') +
    `<circle cx="24" cy="28" r="11" fill="#1b1b1f"/><circle cx="76" cy="28" r="11" fill="#1b1b1f"/>` + blob('#ffffff') +
    `<ellipse cx="36" cy="52" rx="9" ry="11" transform="rotate(25 36 52)" fill="#1b1b1f"/><ellipse cx="64" cy="52" rx="9" ry="11" transform="rotate(-25 64 52)" fill="#1b1b1f"/>` +
    `<circle cx="37" cy="52" r="3.6" fill="#fff"/><circle cx="63" cy="52" r="3.6" fill="#fff"/><ellipse cx="50" cy="63" rx="4.5" ry="3.2" fill="#1b1b1f"/>` +
    mouth('smile', 70) + cheeks(66, '#ff9ab8', 0.6)),
  A('fox', 'Fox', bg('#2f6f4e', '#123824') +
    `<path d="M16 50 L22 12 L46 32Z M84 50 L78 12 L54 32Z" fill="#ff7a1a"/><path d="M22 40 L25 22 L38 32Z M78 40 L75 22 L62 32Z" fill="#3b1b08"/>` +
    blob('#ff7a1a') + `<path d="M14 100 V70 Q32 64 50 78 Q68 64 86 70 V100Z" fill="#fff4e8"/><ellipse cx="50" cy="72" rx="4.6" ry="3.4" fill="#1b1b1f"/>` +
    eyes('wink', 52) + mouth('smile', 80)),
  A('frog', 'Frog', bg('#ffd23f', '#e89a00') +
    `<circle cx="30" cy="30" r="13" fill="#5bd16a"/><circle cx="70" cy="30" r="13" fill="#5bd16a"/>` + blob('#5bd16a') +
    `<circle cx="30" cy="30" r="8" fill="#fff"/><circle cx="70" cy="30" r="8" fill="#fff"/><circle cx="31" cy="31" r="4.4" fill="#1b1b1f"/><circle cx="69" cy="31" r="4.4" fill="#1b1b1f"/>` +
    `<path d="M28 60 q22 22 44 0" stroke="#1b1b1f" stroke-width="3.6" fill="none" stroke-linecap="round"/>` + cheeks(58, '#ff8f8f', 0.6)),
  A('ghost', 'Ghost', bg('#3b2a6b', '#160f33') +
    `<path d="M20 96 V48 C20 26 34 14 50 14 C66 14 80 26 80 48 V96 L72 88 L64 96 L56 88 L50 96 L44 88 L36 96 L28 88Z" fill="#f4f1ff"/>` +
    eyes('dots', 46) + mouth('o', 62) + cheeks(56, '#b49cff', 0.7)),
  A('alien', 'Zib', bg('#1b1236', '#07040f') +
    `<path d="M34 24 Q30 10 24 8 M66 24 Q70 10 76 8" stroke="#a8f06a" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="24" cy="8" r="4" fill="#a8f06a"/><circle cx="76" cy="8" r="4" fill="#a8f06a"/>` +
    `<path d="M50 20 C74 20 86 36 82 58 C78 80 62 96 50 96 C38 96 22 80 18 58 C14 36 26 20 50 20Z" fill="#a8f06a"/>` +
    eyes('alien', 54, 14) + mouth('flat', 78, '#2d5a12') + `<circle cx="18" cy="84" r="2" fill="#fff" opacity=".6"/><circle cx="86" cy="22" r="1.4" fill="#fff" opacity=".6"/>`),
  A('monster', 'Grub', bg('#ff8a3d', '#d4451a') +
    `<path d="M26 34 Q20 14 32 10 Q30 22 36 28Z M74 34 Q80 14 68 10 Q70 22 64 28Z" fill="#fff0d6"/>` +
    `<path d="M12 100 V58 C12 30 30 20 50 20 C70 20 88 30 88 58 V100Z" fill="#3d8bff"/>` +
    `<path d="M12 56 l5 -4 l5 4 l5 -4 l5 4 M68 56 l5 -4 l5 4 l5 -4 l5 4" stroke="#2a63c0" stroke-width="2" fill="none"/>` +
    eyes('cyclops', 50) + mouth('teeth', 74)),
  A('penguin', 'Pip', bg('#7fd1ff', '#2c8fd6') + blob('#1f2433') +
    `<path d="M50 30 C66 30 76 44 76 62 C76 84 64 100 50 100 C36 100 24 84 24 62 C24 44 34 30 50 30Z" fill="#ffffff"/>` +
    eyes('dots', 52, 11) + mouth('beak', 66) + cheeks(62, '#ff9ab8', 0.7)),
  A('owl', 'Hoot', bg('#24305e', '#0b1029') + `<circle cx="16" cy="18" r="1.6" fill="#fff"/><circle cx="84" cy="30" r="1.2" fill="#fff"/><circle cx="74" cy="12" r="1" fill="#fff"/>` +
    `<path d="M22 40 L26 22 L40 32Z M78 40 L74 22 L60 32Z" fill="#a0673e"/>` + blob('#a0673e') +
    `<path d="M14 100 V80 Q50 66 86 80 V100Z" fill="#c98e5f"/>` + eyes('owl', 50, 14) + mouth('beak', 68)),
  A('dino', 'Rex', bg('#ff6b6b', '#c43d3d') +
    `<path d="M30 22 l6 -10 l5 10 M45 18 l5 -11 l5 11 M60 22 l5 -10 l6 10" fill="#2fbf71"/>` + blob('#2fbf71') +
    `<path d="M14 100 V82 Q50 92 86 82 V100Z" fill="#1f9a59"/><circle cx="40" cy="74" r="1.8" fill="#14663b"/><circle cx="60" cy="74" r="1.8" fill="#14663b"/>` +
    eyes('dots', 50) + mouth('grin', 64)),
  A('cool', 'Ace', bg('#ffe066', '#f5a300') + blob('#ff4d5e') + eyes('shades', 52, 14) + mouth('smile', 70, '#5a0b16') +
    `<path d="M30 22 q8 -8 16 -2 q6 -9 16 -2 q8 -4 12 4" stroke="#5a0b16" stroke-width="4" fill="none" stroke-linecap="round"/>`),
  A('star', 'Nova', bg('#2b1840', '#0f0717') + `<circle cx="18" cy="20" r="1.6" fill="#ffd23f"/><circle cx="84" cy="16" r="1.2" fill="#fff"/><circle cx="88" cy="40" r="1.4" fill="#ffd23f"/>` +
    blob('#ff6fb5') + eyes('stars', 52) + mouth('open', 68) + cheeks(62, '#fff', 0.35)),
  A('bunny', 'Bun', bg('#7ff0c8', '#22b38a') +
    `<ellipse cx="36" cy="18" rx="7" ry="20" fill="#ffffff"/><ellipse cx="64" cy="18" rx="7" ry="20" fill="#ffffff"/><ellipse cx="36" cy="18" rx="3.4" ry="14" fill="#ffb3c7"/><ellipse cx="64" cy="18" rx="3.4" ry="14" fill="#ffb3c7"/>` +
    blob('#ffffff') + `<path d="M50 62 l-3 -3 h6z" fill="#ff7a9a"/>` + eyes('big', 52) + mouth('cat', 68) + cheeks(64)),
  A('tiger', 'Stripe', bg('#24323a', '#0d1418') +
    `<circle cx="24" cy="30" r="10" fill="#ff8f1f"/><circle cx="76" cy="30" r="10" fill="#ff8f1f"/><circle cx="24" cy="30" r="5" fill="#2b1a10"/><circle cx="76" cy="30" r="5" fill="#2b1a10"/>` +
    blob('#ff8f1f') + `<path d="M50 20 v10 M38 22 l3 8 M62 22 l-3 8 M14 56 l10 2 M14 64 l9 0 M86 56 l-10 2 M86 64 l-9 0" stroke="#2b1a10" stroke-width="3.4" stroke-linecap="round"/>` +
    `<ellipse cx="50" cy="70" rx="14" ry="10" fill="#fff4e3"/><ellipse cx="50" cy="65" rx="4.4" ry="3.2" fill="#2b1a10"/>` + eyes('dots', 50) + mouth('smile', 72, '#2b1a10'))
]

export function avatarArt(id?: string): Art | undefined {
  return AVATARS.find((a) => a.id === id)
}

/** A new profile gets a picture nobody else uses yet. */
export function freeAvatar(used: Array<string | undefined>): string {
  const taken = new Set(used.filter(Boolean))
  return `art:${(AVATARS.find((a) => !taken.has(`art:${a.id}`)) ?? AVATARS[0]).id}`
}
