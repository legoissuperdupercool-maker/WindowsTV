import type { Channel, ListItem, WatchItem } from '@shared/types'

/**
 * On-device recommendations: no data leaves the PC. Titles are scored by how
 * they relate to what this profile saved to My List and watched:
 *  - same category as a saved/watched title (the provider's genre buckets),
 *  - shared title words (sequels, franchises: "Spider-Man", "Fast & Furious"),
 *  - the provider's rating and how recently the title was added.
 */

interface Seed {
  key: string
  title: string
  group?: string
  weight: number
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'en', 'nl', 'de', 'la', 'le', 'el', 'part', 'season', 'vol', 'hd', 'fhd', 'uhd', '4k', 'multi', 'sub', 'dub'])

/** Meaningful words of a title, without provider prefixes like "EN - " or years. */
export function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/^[a-z]{2,3}\s*[-|:]\s*/, '') // "EN - ", "NL | "
    .replace(/\(\d{4}\)|\[\d{4}\]|\b(19|20)\d{2}\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
}

function seedsFrom(myList: ListItem[], history: WatchItem[], byKey: Map<string, Channel>): Seed[] {
  const seeds = new Map<string, Seed>()
  const add = (key: string, title: string, group: string | undefined, weight: number): void => {
    const cur = seeds.get(key)
    if (cur) cur.weight += weight
    else seeds.set(key, { key, title, group, weight })
  }
  myList.forEach((i, n) => add(i.key, i.title, i.group ?? byKey.get(i.key)?.group, 3 - Math.min(1.5, n * 0.05)))
  history.forEach((h, n) => {
    const key = h.kind === 'episode' && h.series ? `${h.sourceId}:series:${h.series.id}` : h.channelId ?? h.key
    const title = h.series?.name ?? h.title
    const recency = Math.max(0.3, 1 - n * 0.03)
    add(key, title, byKey.get(key)?.group, (h.finished ? 2 : 1.2) * recency)
  })
  return [...seeds.values()]
}

function ratingOf(c: Channel): number {
  const r = parseFloat(String(c.meta?.rating ?? ''))
  return Number.isFinite(r) ? Math.min(10, r) : 0
}

function addedRecently(c: Channel): number {
  const added = Number(c.meta?.added) * 1000
  if (!added) return 0
  const days = (Date.now() - added) / 86400_000
  return days < 30 ? 1 : days < 120 ? 0.4 : 0
}

export interface Recommendations {
  /** Overall picks for this profile. */
  forYou: Channel[]
  /** "Because you watched/saved <title>" for the strongest recent seed. */
  because?: { title: string; items: Channel[] }
}

export function recommend(candidates: Channel[], myList: ListItem[], history: WatchItem[], limit = 20): Recommendations {
  const byKey = new Map(candidates.map((c) => [c.id, c]))
  const seeds = seedsFrom(myList, history, byKey)
  if (!seeds.length) return { forYou: [] }

  const exclude = new Set(seeds.map((s) => s.key))
  const groupWeight = new Map<string, number>()
  const wordWeight = new Map<string, number>()
  for (const s of seeds) {
    if (s.group) groupWeight.set(s.group, (groupWeight.get(s.group) ?? 0) + s.weight)
    for (const w of titleWords(s.title)) wordWeight.set(w, (wordWeight.get(w) ?? 0) + s.weight)
  }

  const scored: Array<{ c: Channel; score: number }> = []
  for (const c of candidates) {
    if (exclude.has(c.id) || (c.type !== 'movie' && c.type !== 'series')) continue
    const g = c.group ? groupWeight.get(c.group) ?? 0 : 0
    let words = 0
    for (const w of titleWords(c.name)) words += wordWeight.get(w) ?? 0
    if (!g && !words) continue
    scored.push({ c, score: g * 1.0 + Math.min(words, 12) * 1.6 + ratingOf(c) * 0.25 + addedRecently(c) })
  }
  scored.sort((a, b) => b.score - a.score)
  const forYou = dedupeTitles(scored.map((s) => s.c)).slice(0, limit)

  // "Because you watched X": the most recent strong seed with a category.
  const anchor = seeds.find((s) => s.group && s.weight >= 1.5) ?? seeds.find((s) => s.group)
  let because: Recommendations['because']
  if (anchor) {
    const aw = new Set(titleWords(anchor.title))
    const items = candidates
      .filter((c) => !exclude.has(c.id) && (c.group === anchor.group || titleWords(c.name).some((w) => aw.has(w))))
      .map((c) => ({ c, s: (c.group === anchor.group ? 1 : 0) + titleWords(c.name).filter((w) => aw.has(w)).length * 2 + ratingOf(c) * 0.2 + addedRecently(c) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
    const shown = new Set(forYou.slice(0, 8).map((c) => c.id))
    const list = dedupeTitles(items.filter((c) => !shown.has(c.id))).slice(0, limit)
    if (list.length >= 4) because = { title: cleanTitle(anchor.title), items: list }
  }
  return { forYou, because }
}

/** Same film listed several times (4K / HD / language copies): keep the first. */
function dedupeTitles(list: Channel[]): Channel[] {
  const seen = new Set<string>()
  return list.filter((c) => {
    const k = titleWords(c.name).join(' ')
    if (!k || seen.has(k)) return !k
    seen.add(k)
    return true
  })
}

export function cleanTitle(t: string): string {
  return t.replace(/^[A-Z]{2,3}\s*[-|:]\s*/, '').trim()
}
