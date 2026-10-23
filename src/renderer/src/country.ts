/**
 * Countries from the prefixes providers put on categories and channels
 * ("NL | Sport", "UK: BBC One", "|DE| ARD", "NETHERLANDS ▶ Sport").
 * Same rules as the iPad app.
 */
export const OTHER = 'Other'

export const COUNTRY_NAMES: Record<string, string> = {
  NL: 'Netherlands', BE: 'Belgium', UK: 'United Kingdom', US: 'United States', CA: 'Canada',
  DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', PT: 'Portugal', TR: 'Turkey',
  PL: 'Poland', RO: 'Romania', GR: 'Greece', AL: 'Albania', RS: 'Serbia', HR: 'Croatia',
  BA: 'Bosnia', SI: 'Slovenia', MK: 'North Macedonia', BG: 'Bulgaria', HU: 'Hungary',
  CZ: 'Czechia', SK: 'Slovakia', AT: 'Austria', CH: 'Switzerland', SE: 'Sweden', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', IE: 'Ireland', IS: 'Iceland', RU: 'Russia', UA: 'Ukraine',
  AR: 'Arabic', MA: 'Morocco', DZ: 'Algeria', TN: 'Tunisia', EG: 'Egypt', IN: 'India',
  PK: 'Pakistan', BD: 'Bangladesh', AF: 'Afghanistan', IR: 'Iran', IL: 'Israel', KU: 'Kurdish',
  AU: 'Australia', NZ: 'New Zealand', BR: 'Brazil', MX: 'Mexico', LA: 'Latin America',
  CO: 'Colombia', CL: 'Chile', PE: 'Peru', CN: 'China', JP: 'Japan', KR: 'Korea',
  PH: 'Philippines', TH: 'Thailand', VN: 'Vietnam', ID: 'Indonesia', MY: 'Malaysia',
  AFR: 'Africa', CAR: 'Caribbean', EX: 'Ex-Yugoslavia', LT: 'Lithuania', LV: 'Latvia',
  EE: 'Estonia', AM: 'Armenia', GE: 'Georgia', AZ: 'Azerbaijan', SO: 'Somalia', NG: 'Nigeria'
}

const ALIASES: Record<string, string> = {
  GB: 'UK', ENG: 'UK', EN: 'UK', USA: 'US', NLD: 'NL', HOL: 'NL', BEL: 'BE', GER: 'DE',
  DEU: 'DE', FRA: 'FR', ESP: 'ES', SP: 'ES', ITA: 'IT', POR: 'PT', PRT: 'PT', TUR: 'TR',
  POL: 'PL', ROM: 'RO', SWE: 'SE', NOR: 'NO', DAN: 'DK', DNK: 'DK', FIN: 'FI', ARB: 'AR',
  ARA: 'AR', IND: 'IN', PAK: 'PK', AUS: 'AU', BRA: 'BR', MEX: 'MX', LAT: 'LA', SUI: 'CH',
  AUT: 'AT', GRE: 'GR', ALB: 'AL', SRB: 'RS', CRO: 'HR', RUS: 'RU', UKR: 'UA', KUR: 'KU',
  BOS: 'BA', BUL: 'BG', HUN: 'HU', CZE: 'CZ', IRL: 'IE', PHI: 'PH', CHN: 'CN', JPN: 'JP',
  KOR: 'KR', AFG: 'AF', IRN: 'IR', ISR: 'IL', BAN: 'BD'
}

const BY_NAME: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const [code, name] of Object.entries(COUNTRY_NAMES)) out[name.toLowerCase()] = code
  Object.assign(out, {
    holland: 'NL', nederland: 'NL', england: 'UK', 'united kingdom': 'UK', usa: 'US', deutschland: 'DE',
    arab: 'AR', arabia: 'AR', turkiye: 'TR', türkiye: 'TR', belgie: 'BE', belgië: 'BE', espana: 'ES',
    españa: 'ES', italia: 'IT', latino: 'LA'
  })
  return out
})()

const PREFIX = /^\s*[[|(]?\s*([A-Za-z]{2,3})\s*[\]|)]?\s*([-|:•▶►/]|\s|$)/
const LEAD = /^\s*[[|(]?\s*([A-Za-z]+(?: [A-Za-z]+)?)/

function code(raw: string): string | undefined {
  const up = raw.toUpperCase()
  const c = ALIASES[up] ?? up
  return COUNTRY_NAMES[c] ? c : undefined
}

function detect(s: string, allowSpace: boolean): string | undefined {
  const m = s.match(PREFIX)
  if (m) {
    const whole = m[0]
    const sepIsSpace = !/[-|:•▶►/[\]()]/.test(whole)
    const raw = m[1]
    // "NL Sport" is fine for categories; channels need "NL: …" so "RTL 4" isn't read as a country.
    if (!sepIsSpace || (allowSpace && raw === raw.toUpperCase())) {
      const c = code(raw)
      if (c) return c
    }
  }
  if (allowSpace) {
    const l = s.match(LEAD)
    if (l) {
      const words = l[1].toLowerCase()
      return BY_NAME[words] ?? BY_NAME[words.split(' ')[0]]
    }
  }
  return undefined
}

export const countryOfCategory = (name: string): string | undefined => detect(name, true)
export const countryOfChannel = (name: string): string | undefined => detect(name, false)

export function countryFlag(c: string): string {
  const iso = c === 'UK' ? 'GB' : c
  if (iso.length !== 2 || !COUNTRY_NAMES[c] || ['AR', 'LA', 'EX', 'KU'].includes(c)) return '🌐'
  return String.fromCodePoint(...[...iso].map((ch) => 127397 + ch.charCodeAt(0)))
}

export const countryLabel = (c: string): string => (c === OTHER ? 'Other / no country' : COUNTRY_NAMES[c] ?? c)
