import type { Category, Channel, Profile } from '@shared/types'
import { OTHER, countryOfCategory, countryOfChannel, countryOfVod } from './country'

/** Titles or categories that look like adult content. */
export const ADULT =
  /\b(xxx|porn\w*|adult|adults only|erotic\w*|hentai|onlyfans|brazzers|vixen|blacked|bangbros|playboy|hustler|naughty ?america|reality ?kings|tushy|18\s*\+|\+\s*18)\b|\[x\]|\(x\)/i

/** Categories that look kid-friendly. */
export const KIDS =
  /\b(kids?|children|child|family|famil\w*|cartoons?|animation|animated|anime ?kids|junior|jr|disney|nick(elodeon|jr)?|pixar|dreamworks|cbeebies|baby ?tv|kinder|kinderen|enfants?|ni[ñn]os|bambini|kika|ketnet)\b/i

type List = { channels: Channel[]; categories: Category[] }

/**
 * Movies & series on Home, rows and recommendations: not adult, and not in a
 * country/language or category the profile chose to leave out. Search ignores this.
 */
export function shelfFilter(categories: Category[], profile: Profile | undefined): (c: Pick<Channel, 'name' | 'group'>) => boolean {
  const notAdult = featurable(categories)
  const countries = new Set(profile?.vodHiddenCountries ?? [])
  const cats = new Set(profile?.vodHiddenCategories ?? [])
  if (!countries.size && !cats.size) return notAdult
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const catCountry = new Map<string, string | undefined>()
  return (c) => {
    if (!notAdult(c)) return false
    if (c.group && cats.has(c.group)) return false
    if (!countries.size) return true
    const key = c.group ?? ''
    let code = catCountry.get(key)
    if (!catCountry.has(key)) {
      code = c.group ? countryOfVod(names.get(c.group), '') : undefined
      catCountry.set(key, code)
    }
    code = code ?? countryOfChannel(c.name)
    return !(code && countries.has(code))
  }
}

/**
 * Adult titles are never featured (Home, billboards, Top 10, "New" and genre rows),
 * whatever the profile allows; they stay reachable by picking their category.
 */
export function featurable(categories: Category[]): (c: Pick<Channel, 'name' | 'group'>) => boolean {
  const adult = new Set(categories.filter((c) => ADULT.test(c.name)).map((c) => c.id))
  return (c) => !(c.group && adult.has(c.group)) && !adultTitle(c)
}

// The adult test is a long regex; run it once per title.
const adultCache = new WeakMap<object, boolean>()
function adultTitle(c: Pick<Channel, 'name'>): boolean {
  let v = adultCache.get(c)
  if (v === undefined) {
    v = ADULT.test(c.name)
    adultCache.set(c, v)
  }
  return v
}

/** Newest first (by the provider's "added" date), sorted once per list. */
const newestCache = new WeakMap<Channel[], Channel[]>()
export function newestFirst(list: Channel[]): Channel[] {
  let out = newestCache.get(list)
  if (!out) {
    out = list
      .map((c) => [Number(c.meta?.added ?? 0) || 0, c] as const)
      .sort((a, b) => b[0] - a[0])
      .map((x) => x[1])
    newestCache.set(list, out)
  }
  return out
}

const cache = new Map<string, { src: List; out: List }>()

/**
 * What a profile may see. Kids profiles only see kid-friendly categories (when
 * the provider has any for that list) and never adult content; other profiles
 * can choose to hide adult content.
 */
export function filterForProfile(key: string, list: List, profile: Profile | undefined): List {
  const live = key.endsWith(':live')
  const prefs = live ? livePrefsKey(profile) : ''
  if (!profile || (!profile.kids && !profile.hideAdult && !prefs)) return list
  const cacheKey = `${key}|${profile.id}|${profile.kids ? 'k' : ''}${profile.hideAdult ? 'a' : ''}|${prefs}`
  const hit = cache.get(cacheKey)
  if (hit && hit.src.channels === list.channels && hit.src.categories === list.categories) return hit.out

  let { channels, categories } = list
  if (profile.kids || profile.hideAdult) {
    const adultCats = new Set(categories.filter((c) => ADULT.test(c.name)).map((c) => c.id))
    categories = categories.filter((c) => !adultCats.has(c.id))
    channels = channels.filter((c) => !(c.group && adultCats.has(c.group)) && !ADULT.test(c.name))
    if (profile.kids) {
      const kidCats = categories.filter((c) => KIDS.test(c.name))
      if (kidCats.length) {
        const ids = new Set(kidCats.map((c) => c.id))
        categories = kidCats
        channels = channels.filter((c) => c.group && ids.has(c.group))
      }
    }
  }
  if (live && prefs) ({ channels, categories } = applyLivePrefs(channels, categories, profile))
  const out = { channels, categories }
  cache.set(cacheKey, { src: list, out })
  return out
}

function livePrefsKey(p: Profile | undefined): string {
  if (!p) return ''
  const parts = [p.countries ?? [], p.hiddenCategories ?? [], p.hiddenChannels ?? []]
  if (!parts.some((x) => x.length) && (p.channelSort ?? 'provider') === 'provider') return ''
  return `${parts.map((x) => x.join(',')).join(';')};${p.channelSort ?? 'provider'}`
}

/** Live TV: chosen countries only, minus hidden categories and channels, in the chosen order. */
function applyLivePrefs(channels: Channel[], categories: Category[], p: Profile): List {
  const countries = new Set(p.countries ?? [])
  const hiddenCats = new Set(p.hiddenCategories ?? [])
  const hiddenChannels = new Set(p.hiddenChannels ?? [])
  const catCountry = new Map(categories.map((c) => [c.id, countryOfCategory(c.name)]))
  let list = channels.filter((c) => {
    if (hiddenChannels.has(c.id)) return false
    if (c.group && hiddenCats.has(c.group)) return false
    if (!countries.size) return true
    // The category's country wins; in mixed categories the channel's own prefix ("NL: RTL 4") decides.
    const code = (c.group ? catCountry.get(c.group) : undefined) ?? countryOfChannel(c.name) ?? OTHER
    return countries.has(code)
  })
  const used = new Set(list.map((c) => c.group))
  let cats = categories.filter((c) => {
    if (hiddenCats.has(c.id)) return false
    if (!countries.size) return true
    const code = catCountry.get(c.id)
    return code ? countries.has(code) : used.has(c.id)
  })
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  if (p.channelSort === 'name') {
    list = [...list].sort((a, b) => collator.compare(a.name, b.name))
    cats = [...cats].sort((a, b) => collator.compare(a.name, b.name))
  } else if (p.channelSort === 'number') {
    list = [...list].sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
  }
  return { channels: list, categories: cats }
}

/** Countries in a live list (from category names, else channel names), most channels first. */
export function countriesIn(list: List): Array<{ code: string; count: number }> {
  const catCountry = new Map(list.categories.map((c) => [c.id, countryOfCategory(c.name)]))
  const counts = new Map<string, number>()
  for (const c of list.channels) {
    const code = (c.group ? catCountry.get(c.group) : undefined) ?? countryOfChannel(c.name) ?? OTHER
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => (a.code === OTHER ? 1 : 0) - (b.code === OTHER ? 1 : 0) || b.count - a.count)
}
