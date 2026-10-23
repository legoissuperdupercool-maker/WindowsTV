import type { Category, Channel, Profile } from '@shared/types'
import { OTHER, countryOfCategory, countryOfChannel } from './country'

/** Titles or categories that look like adult content. */
export const ADULT =
  /\b(xxx|porn\w*|adult|adults only|erotic\w*|hentai|onlyfans|brazzers|vixen|blacked|bangbros|playboy|hustler|naughty ?america|reality ?kings|tushy|18\s*\+|\+\s*18)\b|\[x\]|\(x\)/i

/** Categories that look kid-friendly. */
export const KIDS =
  /\b(kids?|children|child|family|famil\w*|cartoons?|animation|animated|anime ?kids|junior|jr|disney|nick(elodeon|jr)?|pixar|dreamworks|cbeebies|baby ?tv|kinder|kinderen|enfants?|ni[ñn]os|bambini|kika|ketnet)\b/i

type List = { channels: Channel[]; categories: Category[] }

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
