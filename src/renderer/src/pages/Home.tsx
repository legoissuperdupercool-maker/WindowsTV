import { useEffect, useMemo, useRef, useState } from 'react'
import { activeProfile, cachedCategories, useStore, type RouteName } from '../store'
import { recommend, type SeedInfo } from '../recommend'
import { Icon } from '../components/Icon'
import { Billboard, ChannelCard, ContinueCard, PosterCard, Row, Top10Card, cleanCategory, metaStr, type BillboardItem } from '../components/nf'
import { Initials } from '../components/Initials'
import { detectBrand } from '../components/brands'
import { FadeImg } from '../components/FadeImg'
import { getFocused } from '../hooks/useSpatialNavigation'
import type { AppTile, Category, Channel, EpgNowNext, ListItem, MediaDetails, Programme, WatchItem } from '@shared/types'

export function Home(): JSX.Element {
  const { settings, navigate, channels, play, openWebApp, currentSourceId, loadCatalog, openDetail, fetchList, continueItems, resumeItem } =
    useStore()

  // Home shows live channels; make sure the live list is the active one (served
  // from cache after the first load, so this is instant).
  useEffect(() => {
    void loadCatalog('live', false)
  }, [loadCatalog, currentSourceId])
  const hasSources = (settings?.sources.length ?? 0) > 0

  // My List + recommendations, all worked out on this PC from this profile's
  // list and watch history.
  const profileId = useStore((s) => s.activeProfileId)
  const fullList = useStore((s) => activeProfile(s)?.myList)
  const myListItems = useMemo(() => (fullList ?? []).filter((i) => i.sourceId === currentSourceId), [fullList, currentSourceId])
  const [vodLists, setVodLists] = useState<{ channels: Channel[]; categories: Category[] }>({ channels: [], categories: [] })
  const vod = vodLists.channels
  // Re-read when the live list arrives too: on a fresh start the movie and
  // series lists may not be ready the first time.
  const liveCount = channels.length
  useEffect(() => {
    if (!currentSourceId) return
    void Promise.all([fetchList('movie'), fetchList('series')]).then(([m, s]) =>
      setVodLists({
        channels: [...m, ...s],
        categories: [...cachedCategories(currentSourceId, 'movie'), ...cachedCategories(currentSourceId, 'series')]
      })
    )
  }, [currentSourceId, fetchList, liveCount > 0])
  const [history, setHistory] = useState<WatchItem[]>([])
  useEffect(() => {
    void window.api.progress.history(currentSourceId).then((r) => setHistory(r.data ?? []))
  }, [currentSourceId, continueItems, profileId])
  // Movie lists rarely include genre/cast; read them for the few titles this
  // profile saved or watched (the provider's movie info, cached per session).
  const [seedInfo, setSeedInfo] = useState<Record<string, SeedInfo>>({})
  useEffect(() => {
    if (!currentSourceId || !vod.length) return
    const byId = new Map(vod.map((c) => [c.id, c]))
    const keys = [
      ...myListItems.filter((i) => i.kind === 'movie').map((i) => i.key),
      ...history.filter((h) => h.kind === 'movie' && h.channelId).map((h) => h.channelId!)
    ]
    const todo = [...new Set(keys)].filter((k) => !seedInfo[k] && !byId.get(k)?.meta?.genre).slice(0, 8)
    if (!todo.length) return
    let cancelled = false
    void (async () => {
      const found: Record<string, SeedInfo> = {}
      for (const key of todo) {
        const r = await window.api.vod.info(currentSourceId, key.split(':').pop() ?? '')
        found[key] = r.data ? { genre: r.data.genre, cast: r.data.cast, director: r.data.director } : {}
      }
      if (!cancelled) setSeedInfo((cur) => ({ ...cur, ...found }))
    })()
    return () => {
      cancelled = true
    }
  }, [currentSourceId, vod, myListItems, history])
  const recs = useMemo(
    () => recommend(vod, vodLists.categories, myListItems, history, seedInfo),
    [vod, vodLists.categories, myListItems, history, seedInfo]
  )
  const myList = useMemo(() => {
    const byId = new Map(vod.map((c) => [c.id, c]))
    return myListItems.map((i) => byId.get(i.key) ?? listItemChannel(i))
  }, [vod, myListItems])

  // Built-in sections (Live TV, Guide…) live in the top tabs, so the apps row
  // only shows real apps.
  const apps = (settings?.appTiles ?? []).filter((t) => t.kind !== 'section')

  const recents = useMemo(
    () =>
      (settings?.recents ?? [])
        .map((id) => channels.find((c) => c.id === id))
        .filter((c): c is Channel => Boolean(c))
        .slice(0, 12),
    [settings?.recents, channels]
  )
  const live = useMemo(() => channels.filter((c) => c.type === 'live').slice(0, 18), [channels])
  const featured = recents[0] ?? live[0]

  // EPG now/next for everything shown on the home screen.
  const [nn, setNn] = useState<Record<string, EpgNowNext>>({})
  useEffect(() => {
    if (!currentSourceId) return
    const items = dedupe([featured, ...recents, ...live].filter(Boolean) as Channel[])
    if (!items.length) return
    const now = Date.now()
    void window.api.epg
      .grid(
        currentSourceId,
        items.map((c) => ({ id: c.id, epgChannelId: c.epgChannelId, name: c.name })),
        now - 2 * 3600_000,
        now + 6 * 3600_000
      )
      .then((r) => {
        if (!r.data) return
        const map: Record<string, EpgNowNext> = {}
        for (const [id, progs] of Object.entries(r.data)) map[id] = deriveNowNext(progs as Programme[], now)
        setNn(map)
      })
  }, [currentSourceId, featured?.id, recents.length, live.length])

  const onTile = (tile: AppTile): void => {
    if (tile.kind === 'web') openWebApp(tile.target, tile.userAgent)
    else if (tile.kind === 'app') void window.api.launchApp(tile.target)
    else navigate(tile.target as RouteName)
  }

  // Billboard: titles for you first, then the newest, with real artwork where
  // the provider has it (movie info is fetched for the first few).
  const [billboard, setBillboard] = useState<BillboardItem[]>([])
  useEffect(() => {
    if (!vod.length) return
    let cancelled = false
    const newest = (type: string): Channel[] =>
      vod.filter((c) => c.type === type).sort((a, b) => Number(b.meta?.added ?? 0) - Number(a.meta?.added ?? 0))
    const picks = dedupe([...recs.forYou.slice(0, 2), ...newest('movie').slice(0, 6), ...newest('series').slice(0, 3)])
    void (async () => {
      const items: BillboardItem[] = []
      for (const c of picks) {
        const info = c.type === 'movie' ? (await window.api.vod.info(c.sourceId, c.providerId)).data : null
        const art = info?.backdrop || metaStr(c, 'backdrop') || info?.poster || c.logo
        if (art) items.push({ channel: c, info, kicker: recs.forYou.includes(c) ? 'Picked for you' : c.type === 'series' ? 'New episodes' : 'New on ello' })
        if (items.length >= 6) break
      }
      // Real wide artwork first.
      items.sort((a, b) => Number(Boolean(b.info?.backdrop || metaStr(b.channel, 'backdrop'))) - Number(Boolean(a.info?.backdrop || metaStr(a.channel, 'backdrop'))))
      if (!cancelled) setBillboard(items)
    })()
    return () => {
      cancelled = true
    }
  }, [vod.length, recs.forYou.length, currentSourceId])

  const newestMovies = useMemo(
    () => vod.filter((c) => c.type === 'movie').sort((a, b) => Number(b.meta?.added ?? 0) - Number(a.meta?.added ?? 0)),
    [vod]
  )
  const newestSeries = useMemo(
    () => vod.filter((c) => c.type === 'series').sort((a, b) => Number(b.meta?.added ?? 0) - Number(a.meta?.added ?? 0)),
    [vod]
  )
  // The provider's biggest categories become genre rows.
  const genreRows = useMemo(() => {
    const byGroup = new Map<string, Channel[]>()
    for (const c of vod) if (c.group) (byGroup.get(c.group) ?? byGroup.set(c.group, []).get(c.group)!).push(c)
    const names = new Map(vodLists.categories.map((c) => [c.id, cleanCategory(c.name)]))
    const pick = (type: string, n: number): Array<{ id: string; title: string; items: Channel[] }> =>
      [...byGroup.entries()]
        .filter(([id, list]) => list[0]?.type === type && names.has(id) && list.length >= 6)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, n)
        .map(([id, list]) => ({
          id,
          title: names.get(id)!,
          items: [...list].sort((a, b) => Number(b.meta?.added ?? 0) - Number(a.meta?.added ?? 0)).slice(0, 30)
        }))
    return [...pick('movie', 4), ...pick('series', 3)]
  }, [vod, vodLists.categories])
  const favorites = settings?.favorites ?? []
  const welcome = (
    <>
      <div className="nf-bb-kicker">Welcome</div>
      <h1 className="nf-bb-title">ello smartTV</h1>
      <p className="nf-bb-plot">
        {hasSources ? 'Your movies, series and channels are loading…' : 'Add your IPTV provider (Xtream login or M3U playlist) to start watching.'}
      </p>
      <div className="nf-bb-actions">
        <button className="focusable nf-btn play" onClick={() => navigate('settings')}>
          <Icon name={hasSources ? 'settings' : 'add'} size={22} /> {hasSources ? 'Manage sources' : 'Add a source'}
        </button>
      </div>
    </>
  )

  return (
    <div className="page nf-page">
      <Billboard items={billboard} fallback={welcome} />

      <div className="nf-rows">
        {continueItems.length > 0 && (
          <Row title="Continue watching">
            {continueItems.map((it) => (
              <ContinueCard key={it.key} it={it} onOpen={() => void resumeItem(it)} />
            ))}
          </Row>
        )}

        {newestMovies.length >= 10 && (
          <Row title="Top 10 new movies" className="top10" onMore={() => navigate('movies')}>
            {newestMovies.slice(0, 10).map((c, n) => (
              <Top10Card key={c.id} c={c} n={n + 1} onOpen={openDetail} />
            ))}
          </Row>
        )}

        {myList.length > 0 && (
          <Row title="My List" onMore={() => navigate('mylist')}>
            {myList.map((c) => (
              <PosterCard key={c.id} c={c} onOpen={openDetail} />
            ))}
          </Row>
        )}

        {live.length > 0 && (
          <Row title="Live now" onMore={() => navigate('live')}>
            {live.map((c) => (
              <ChannelCard key={c.id} c={c} now={nn[c.id]?.now} favorite={favorites.includes(c.id)} onPlay={() => void play(c.id, live.map((r) => r.id))} />
            ))}
          </Row>
        )}

        {recs.forYou.length > 0 && (
          <Row title="Recommended for you">
            {recs.forYou.map((c) => (
              <PosterCard key={c.id} c={c} onOpen={openDetail} />
            ))}
          </Row>
        )}

        {newestSeries.length > 0 && (
          <Row title="New series" onMore={() => navigate('series')}>
            {newestSeries.slice(0, 30).map((c) => (
              <PosterCard key={c.id} c={c} onOpen={openDetail} />
            ))}
          </Row>
        )}

        {recs.because && (
          <Row title={`Because you watched ${recs.because.title}`}>
            {recs.because.items.map((c) => (
              <PosterCard key={c.id} c={c} onOpen={openDetail} />
            ))}
          </Row>
        )}

        {genreRows.map((g) => (
          <Row key={g.id} title={g.title} onMore={() => navigate(g.items[0]?.type === 'series' ? 'series' : 'movies')}>
            {g.items.map((c) => (
              <PosterCard key={c.id} c={c} onOpen={openDetail} />
            ))}
          </Row>
        ))}

        {recents.length > 0 && (
          <Row title="Recently watched channels">
            {recents.map((c) => (
              <ChannelCard key={c.id} c={c} now={nn[c.id]?.now} favorite={favorites.includes(c.id)} onPlay={() => void play(c.id, recents.map((r) => r.id))} />
            ))}
          </Row>
        )}

        <Row title="Your apps">
          {apps.map((tile) => (
            <AppCard key={tile.id} tile={tile} onClick={() => onTile(tile)} />
          ))}
          <button className="focusable app-card add-app" onClick={() => navigate('settings')}>
            <Icon name="add" size={30} />
            <span>Add app</span>
          </button>
        </Row>
      </div>
    </div>
  )
}

function AppCard({ tile, onClick }: { tile: AppTile; onClick: () => void }): JSX.Element {
  const brand = detectBrand(tile.target, tile.label)
  if (brand) {
    return (
      <button className="focusable app-card" style={{ ['--c1' as string]: brand.color }} onClick={onClick} title={tile.label}>
        <span className="brand-mark" dangerouslySetInnerHTML={{ __html: brand.svg }} />
      </button>
    )
  }
  // Unknown app: its name on its chosen colour.
  return (
    <button className="focusable app-card" style={{ ['--c1' as string]: tile.color ?? '#3c4043' }} onClick={onClick}>
      <Icon name={tile.icon ?? 'web'} size={26} />
      <span className="ac-label">{tile.label}</span>
    </button>
  )
}

// --------------------------------------------------------------------- helpers

function dedupe(items: Channel[]): Channel[] {
  const seen = new Set<string>()
  return items.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
}
function deriveNowNext(progs: Programme[], at: number): EpgNowNext {
  let now: Programme | undefined
  let next: Programme | undefined
  for (let i = 0; i < progs.length; i++) {
    const p = progs[i]
    if (p.start <= at && at < p.stop) {
      now = p
      next = progs[i + 1]
      break
    }
    if (p.start > at) {
      next = p
      break
    }
  }
  return { now, next }
}

/** A saved title that's no longer in the provider's list still opens its detail screen. */
function listItemChannel(i: ListItem): Channel {
  return { id: i.key, sourceId: i.sourceId, type: i.kind, providerId: i.key.split(':').pop() ?? '', name: i.title, logo: i.poster, group: i.group, url: '' }
}
