import type { Category, Channel, Profile } from '@shared/types'

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
  if (!profile || (!profile.kids && !profile.hideAdult)) return list
  const cacheKey = `${key}|${profile.id}|${profile.kids ? 'k' : ''}${profile.hideAdult ? 'a' : ''}`
  const hit = cache.get(cacheKey)
  if (hit && hit.src.channels === list.channels && hit.src.categories === list.categories) return hit.out

  const adultCats = new Set(list.categories.filter((c) => ADULT.test(c.name)).map((c) => c.id))
  let categories = list.categories.filter((c) => !adultCats.has(c.id))
  let channels = list.channels.filter((c) => !(c.group && adultCats.has(c.group)) && !ADULT.test(c.name))
  if (profile.kids) {
    const kidCats = categories.filter((c) => KIDS.test(c.name))
    if (kidCats.length) {
      const ids = new Set(kidCats.map((c) => c.id))
      categories = kidCats
      channels = channels.filter((c) => c.group && ids.has(c.group))
    }
  }
  const out = { channels, categories }
  cache.set(cacheKey, { src: list, out })
  return out
}
