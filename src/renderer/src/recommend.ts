import type { Category, Channel, ListItem, WatchItem } from '@shared/types'
import { ADULT } from './contentFilter'

/**
 * On-device recommendations: nothing leaves the PC. For each title the profile
 * saved or watched ("seeds"), candidates are scored on what actually makes two
 * titles alike:
 *   - shared genres (from the provider's metadata, or genre words in its category names),
 *   - shared cast / director,
 *   - the same franchise (the whole seed title appearing in the candidate, e.g.
 *     "El Camino: A Breaking Bad Movie"); single common words ("bad", "love") never count,
 *   - then quality: provider rating, and a little for new arrivals.
 * Adult content is never recommended, other-language copies of titles are left
 * out, and titles listed several times (4K / HD / languages) appear once.
 */

export interface SeedInfo {
  genre?: string
  cast?: string
  director?: string
}

interface Seed {
  key: string
  title: string
  type: 'movie' | 'series'
  genres: Set<string>
  people: Set<string>
  core: string[]
  lang?: string
  weight: number
}

interface Indexed {
  c: Channel
  core: string[]
  coreKey: string
  genres: Set<string>
  people: Set<string>
  lang?: string
  adult: boolean
  rating: number
  fresh: number
}

// ----------------------------------------------------------------------------- text helpers

/** Language from a provider prefix ("EN - ", "NL | ") or a country tag ("(US)"). */
const LANG_ALIASES: Record<string, string> = { US: 'EN', UK: 'EN', GB: 'EN', ENG: 'EN', AU: 'EN', CA: 'EN', IE: 'EN' }
function langOf(text: string | undefined): string | undefined {
  if (!text) return undefined
  const prefix = text.match(/^\s*\[?([A-Z]{2,3})\]?\s*[-|:•]/)
  const tag = text.match(/\((US|UK|GB|EN)\)\s*$/i)
  const code = (prefix?.[1] ?? tag?.[1])?.toUpperCase()
  return code ? LANG_ALIASES[code] ?? code : undefined
}

const STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'at', 'for', 'with', 'from', 'by', 'part', 'season', 'vol',
  'hd', 'fhd', 'uhd', '4k', 'sd', 'multi', 'sub', 'subs', 'dub', 'movie', 'film', 'series', 'us', 'uk'
])

/** Meaningful words of a title, without prefixes ("EN - "), years, country tags or quality labels. */
export function coreWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/^\s*\[?[a-z]{2,3}\]?\s*[-|:•]\s*/, '')
    .replace(/\[[^\]]*\]|\((?:19|20)\d{2}\)|\((?:us|uk|gb|en)\)|\b(?:19|20)\d{2}\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))
}

export function cleanTitle(t: string): string {
  return t
    .replace(/^\s*\[?[A-Z]{2,3}\]?\s*[-|:•]\s*/, '')
    .replace(/\s*\((?:19|20)\d{2}\)|\s*\((?:US|UK|GB|EN)\)/gi, '')
    .trim()
}

const GENRE_WORDS: Record<string, string> = {
  action: 'action', adventure: 'adventure', animation: 'animation', animated: 'animation', anime: 'animation',
  cartoon: 'animation', comedy: 'comedy', comedies: 'comedy', crime: 'crime', documentary: 'documentary',
  documentaries: 'documentary', docu: 'documentary', drama: 'drama', dramas: 'drama', family: 'family',
  kids: 'family', children: 'family', fantasy: 'fantasy', history: 'history', historical: 'history',
  horror: 'horror', music: 'music', musical: 'music', mystery: 'mystery', romance: 'romance', romantic: 'romance',
  'sci-fi': 'scifi', scifi: 'scifi', science: 'scifi', thriller: 'thriller', thrillers: 'thriller',
  suspense: 'thriller', war: 'war', western: 'western', reality: 'reality', sport: 'sport', sports: 'sport',
  biography: 'biography', biopic: 'biography', superhero: 'action', martial: 'action', soap: 'drama'
}

function genresOf(...texts: Array<string | undefined>): Set<string> {
  const out = new Set<string>()
  for (const t of texts) {
    if (!t) continue
    for (const w of t.toLowerCase().split(/[^a-z-]+/)) {
      const g = GENRE_WORDS[w]
      if (g) out.add(g)
    }
  }
  return out
}

function peopleOf(...texts: Array<string | undefined>): Set<string> {
  const out = new Set<string>()
  for (const t of texts) {
    if (!t) continue
    for (const name of t.split(/[,;/]+/).map((n) => n.trim().toLowerCase()).slice(0, 6)) {
      if (name.length > 3 && name.includes(' ')) out.add(name)
    }
  }
  return out
}

function metaStr(c: Channel, key: string): string | undefined {
  const v = c.meta?.[key]
  return typeof v === 'string' && v.trim() ? v : undefined
}

// ----------------------------------------------------------------------------- index

// Analysing a title (regexes over its name and category) is the expensive part,
// so each Channel is analysed once and remembered for as long as it exists.
const itemCache = new WeakMap<Channel, Indexed>()

function indexOne(c: Channel, catName: Map<string, string>): Indexed {
  const hit = itemCache.get(c)
  if (hit) return hit
  const cat = c.group ? catName.get(c.group) : undefined
  const core = coreWords(c.name)
  const rating = parseFloat(metaStr(c, 'rating') ?? '')
  const added = Number(metaStr(c, 'added')) * 1000
  const ageDays = added ? (Date.now() - added) / 86400_000 : Infinity
  const it: Indexed = {
    c,
    core,
    coreKey: `${c.type}:${core.join(' ')}`,
    genres: genresOf(metaStr(c, 'genre'), cat),
    people: peopleOf(metaStr(c, 'cast'), metaStr(c, 'director')),
    lang: langOf(c.name) ?? langOf(cat),
    adult: ADULT.test(c.name) || ADULT.test(cat ?? ''),
    rating: Number.isFinite(rating) ? Math.min(10, rating) : 0,
    fresh: ageDays < 30 ? 1 : ageDays < 120 ? 0.4 : 0
  }
  itemCache.set(c, it)
  return it
}

function buildIndex(candidates: Channel[], categories: Category[]): Indexed[] {
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const out: Indexed[] = []
  for (const c of candidates) if (c.type === 'movie' || c.type === 'series') out.push(indexOne(c, catName))
  return out
}

/**
 * Analyse a big list a slice at a time (yielding between slices), so the first
 * recommendations never freeze the screen. Afterwards `recommend` is quick.
 */
export async function prepareRecommendations(candidates: Channel[], categories: Category[]): Promise<void> {
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  let last = performance.now()
  for (const c of candidates) {
    if (c.type !== 'movie' && c.type !== 'series') continue
    indexOne(c, catName)
    if (performance.now() - last > 12) {
      await new Promise((r) => setTimeout(r, 0))
      last = performance.now()
    }
  }
}

/** The seed's whole title appears in the candidate's ("Breaking Bad" → "El Camino: A Breaking Bad Movie"). */
function sameFranchise(seedCore: string[], cand: string[]): boolean {
  if (seedCore.length < 2 && !(seedCore.length === 1 && seedCore[0].length >= 6)) return false
  const hay = ` ${cand.join(' ')} `
  return hay.includes(` ${seedCore.join(' ')} `)
}

function similarity(seed: Seed, it: Indexed): number {
  let score = 0
  let related = false
  if (sameFranchise(seed.core, it.core)) {
    score += 12
    related = true
  }
  let sharedGenres = 0
  for (const g of it.genres) if (seed.genres.has(g)) sharedGenres++
  if (sharedGenres) {
    // Jaccard-style: sharing 2 of 2 genres beats sharing 1 of 5.
    const union = new Set([...seed.genres, ...it.genres]).size
    score += 3 * sharedGenres + 4 * (sharedGenres / union)
    // Enough overlap: two genres, or all of them when one side only has one
    // (movies whose only genre comes from a "Crime" category, say).
    related = related || sharedGenres >= Math.min(2, seed.genres.size, it.genres.size)
  }
  let sharedPeople = 0
  for (const p of it.people) if (seed.people.has(p)) sharedPeople++
  if (sharedPeople) {
    score += 3 * Math.min(2, sharedPeople)
    related = true
  }
  if (!related) return 0
  if (it.c.type === seed.type) score += 2
  return score
}

// ----------------------------------------------------------------------------- public

export interface Recommendations {
  forYou: Channel[]
  because?: { title: string; items: Channel[] }
}

export function recommend(
  candidates: Channel[],
  categories: Category[],
  myList: ListItem[],
  history: WatchItem[],
  seedInfo: Record<string, SeedInfo> = {},
  limit = 20
): Recommendations {
  const index = buildIndex(candidates, categories)
  const byId = new Map(index.map((it) => [it.c.id, it]))

  // Seeds: My List (strong) and watch history (finished counts more), recent first.
  const seeds = new Map<string, Seed>()
  const addSeed = (key: string, title: string, type: 'movie' | 'series', weight: number): void => {
    const cur = seeds.get(key)
    if (cur) {
      cur.weight += weight
      return
    }
    const it = byId.get(key)
    const info = seedInfo[key] ?? {}
    seeds.set(key, {
      key,
      title,
      type,
      genres: new Set([...(it?.genres ?? []), ...genresOf(info.genre)]),
      people: new Set([...(it?.people ?? []), ...peopleOf(info.cast, info.director)]),
      core: coreWords(title),
      lang: it?.lang ?? langOf(title),
      weight
    })
  }
  history.forEach((h, n) => {
    const isEp = h.kind === 'episode' && h.series
    const key = isEp ? `${h.sourceId}:series:${h.series!.id}` : h.channelId ?? h.key
    addSeed(key, isEp ? h.series!.name : h.title, isEp ? 'series' : 'movie', (h.finished ? 2 : 1.2) * Math.max(0.3, 1 - n * 0.04))
  })
  myList.forEach((i, n) => addSeed(i.key, i.title, i.kind, 3 * Math.max(0.5, 1 - n * 0.03)))
  const seedList = [...seeds.values()]
  if (!seedList.length) return { forYou: [] }

  // Languages this profile watches in; other-language copies are left out.
  const langs = new Map<string, number>()
  for (const s of seedList) if (s.lang) langs.set(s.lang, (langs.get(s.lang) ?? 0) + s.weight)
  const totalLang = [...langs.values()].reduce((a, b) => a + b, 0)
  const okLangs = new Set([...langs].filter(([, w]) => w >= totalLang * 0.2).map(([l]) => l))
  const seedCores = new Set(seedList.map((s) => `${s.type}:${s.core.join(' ')}`))

  const eligible = index.filter(
    (it) =>
      !it.adult &&
      !seeds.has(it.c.id) &&
      !seedCores.has(it.coreKey) &&
      it.core.length > 0 &&
      (!okLangs.size || !it.lang || okLangs.has(it.lang))
  )

  const rank = (score: (it: Indexed) => number, minScore: number): Channel[] => {
    const scored: Array<{ it: Indexed; s: number }> = []
    for (const it of eligible) {
      const s = score(it)
      if (s >= minScore) scored.push({ it, s: s + it.rating * 0.35 + it.fresh * 0.5 })
    }
    scored.sort((a, b) => b.s - a.s)
    const seen = new Set<string>()
    const out: Channel[] = []
    for (const { it } of scored) {
      if (seen.has(it.coreKey)) continue // same film in another quality / language
      seen.add(it.coreKey)
      out.push(it.c)
      if (out.length >= limit) break
    }
    return out
  }

  // "Because you watched X": the most recent seed that has something to go on.
  const anchor = seedList.find((s) => s.genres.size || s.people.size || s.core.length >= 2)
  let because: Recommendations['because']
  if (anchor) {
    const items = rank((it) => similarity(anchor, it), 6)
    if (items.length >= 4) because = { title: cleanTitle(anchor.title), items }
  }

  // "Recommended for you": similarity to all seeds, weighted by how much they matter.
  const shown = new Set((because?.items ?? []).slice(0, 10).map((c) => c.id))
  const forYou = rank((it) => {
    if (shown.has(it.c.id)) return 0
    let total = 0
    for (const s of seedList) total += similarity(s, it) * s.weight
    return total / Math.max(1, seedList.length ** 0.5)
  }, 6)

  return { forYou, because }
}
