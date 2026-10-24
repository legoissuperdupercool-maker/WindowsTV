import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useRef, useState } from 'react'
import { activeProfile, cachedCategories, useStore, type RouteName } from '../store'
import { useLook } from '../hooks/useLook'
import { ADULT, featurable, newestFirst, shelfFilter } from '../contentFilter'
import { type SeedInfo } from '../recommend'
import { useRecommendations } from '../hooks/useRecommendations'
import { Icon } from '../components/Icon'
import {
  Billboard,
  ChannelCard,
  Collections,
  ContinueCard,
  PosterCard,
  Row,
  SkeletonRows,
  Top10Card,
  cleanCategory,
  metaStr,
  type BillboardItem
} from '../components/nf'
import { Initials } from '../components/Initials'
import { detectBrand } from '../components/brands'
import { FadeImg } from '../components/FadeImg'
import { getFocused } from '../hooks/useSpatialNavigation'
import type { AppTile, Category, Channel, EpgNowNext, ListItem, MediaDetails, Programme, WatchItem } from '@shared/types'

export function Home(): JSX.Element {
  const look = useLook()
  const { settings, navigate, channels, play, openWebApp, currentSourceId, loadCatalog, openDetail, fetchList, continueItems, resumeItem } = useStore(
    useShallow((s) => ({
      settings: s.settings,
      navigate: s.navigate,
      channels: s.channels,
      play: s.play,
      openWebApp: s.openWebApp,
      currentSourceId: s.currentSourceId,
      loadCatalog: s.loadCatalog,
      openDetail: s.openDetail,
      fetchList: s.fetchList,
      continueItems: s.continueItems,
      resumeItem: s.resumeItem
    }))
  )

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
  const [vodLists, setVodLists] = useState<{
    channels: Channel[]
    categories: Category[]
  }>({ channels: [], categories: [] })
  // Adult titles are never featured on Home.
  const me = useStore(activeProfile)
  const vod = useMemo(() => vodLists.channels.filter(shelfFilter(vodLists.categories, me)), [vodLists, me])
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
        found[key] = r.data
          ? {
              genre: r.data.genre,
              cast: r.data.cast,
              director: r.data.director
            }
          : {}
      }
      if (!cancelled) setSeedInfo((cur) => ({ ...cur, ...found }))
    })()
    return () => {
      cancelled = true
    }
  }, [currentSourceId, vod, myListItems, history])
  const recs = useRecommendations(vod, vodLists.categories, myListItems, history, seedInfo)
  const myList = useMemo(() => {
    const byId = new Map(vod.map((c) => [c.id, c]))
    const ok = featurable(vodLists.categories)
    return myListItems.map((i) => byId.get(i.key) ?? listItemChannel(i)).filter(ok)
  }, [vod, myListItems, vodLists.categories])

  // Built-in sections (Live TV, Guide…) live in the top tabs, so the apps row
  // only shows real apps.
  const apps = (settings?.appTiles ?? []).filter((t) => t.kind !== 'section')

  const homeChannels = useMemo(
    () => (currentSourceId ? channels.filter(featurable(cachedCategories(currentSourceId, 'live'))) : channels),
    [channels, currentSourceId]
  )
  const continueShown = useMemo(() => {
    if (!continueItems.length) return continueItems
    const ok = featurable(vodLists.categories)
    const ids = new Set(continueItems.map((it) => it.channelId).filter(Boolean))
    const adultIds = new Set(vodLists.channels.filter((c) => ids.has(c.id) && !ok(c)).map((c) => c.id))
    return continueItems.filter((it) => !ADULT.test(it.title) && !(it.channelId && adultIds.has(it.channelId)))
  }, [continueItems, vodLists])
  const recents = useMemo(
    () =>
      (settings?.recents ?? [])
        .map((id) => homeChannels.find((c) => c.id === id))
        .filter((c): c is Channel => Boolean(c))
        .slice(0, 12),
    [settings?.recents, homeChannels]
  )
  const live = useMemo(() => homeChannels.filter((c) => c.type === 'live').slice(0, 18), [homeChannels])
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
        items.map((c) => ({
          id: c.id,
          epgChannelId: c.epgChannelId,
          name: c.name
        })),
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
    const newest = (type: string): Channel[] => newestFirst(vod).filter((c) => c.type === type)
    const picks = dedupe([...recs.forYou.slice(0, 2), ...newest('movie').slice(0, 6), ...newest('series').slice(0, 3)])
    void (async () => {
      const items: BillboardItem[] = []
      for (const c of picks) {
        const info = c.type === 'movie' ? (await window.api.vod.info(c.sourceId, c.providerId)).data : null
        const art = info?.backdrop || metaStr(c, 'backdrop') || info?.poster || c.logo
        if (art)
          items.push({
            channel: c,
            info,
            kicker: recs.forYou.includes(c) ? 'Picked for you' : c.type === 'series' ? 'New episodes' : 'New on ello'
          })
        if (items.length >= 6) break
      }
      // Real wide artwork first.
      items.sort(
        (a, b) => Number(Boolean(b.info?.backdrop || metaStr(b.channel, 'backdrop'))) - Number(Boolean(a.info?.backdrop || metaStr(a.channel, 'backdrop')))
      )
      if (!cancelled) setBillboard(items)
    })()
    return () => {
      cancelled = true
    }
  }, [vod.length, recs.forYou.length, currentSourceId])

  const sortedVod = useMemo(() => newestFirst(vod), [vod])
  const newestMovies = useMemo(() => sortedVod.filter((c) => c.type === 'movie'), [sortedVod])
  const newestSeries = useMemo(() => sortedVod.filter((c) => c.type === 'series'), [sortedVod])
  // The provider's biggest categories become genre rows.
  const genreRows = useMemo(() => {
    const byGroup = new Map<string, Channel[]>()
    for (const c of sortedVod) if (c.group) (byGroup.get(c.group) ?? byGroup.set(c.group, []).get(c.group)!).push(c)
    const names = new Map(vodLists.categories.map((c) => [c.id, cleanCategory(c.name)]))
    const pick = (type: string, n: number): Array<{ id: string; title: string; items: Channel[] }> =>
      [...byGroup.entries()]
        .filter(([id, list]) => list[0]?.type === type && names.has(id) && list.length >= 6)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, n)
        .map(([id, list]) => ({
          id,
          title: names.get(id)!,
          items: list.slice(0, 30)
        }))
    return [...pick('movie', 4), ...pick('series', 3)]
  }, [sortedVod, vodLists.categories])
  const favorites = settings?.favorites ?? []
  const [shownRows, setShownRows] = useState(3)
  const hasVod = vod.length > 0
  useEffect(() => {
    if (!hasVod) return
    let id = 0
    const more = (): void => {
      setShownRows((n) => {
        if (n < 40) id = requestIdleCallback(more, { timeout: 400 })
        return n + 1
      })
    }
    id = requestIdleCallback(more, { timeout: 400 })
    return () => cancelIdleCallback(id)
  }, [hasVod])
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

  // Rows: the first few render at once, the rest in idle time, so a big
  // catalogue arriving doesn't freeze the screen.
  const rows: JSX.Element[] = []
  if (continueShown.length > 0)
    rows.push(
      <Row key="continue" title="Continue watching">
        {continueShown.map((it) => (
          <ContinueCard key={it.key} it={it} onOpen={() => void resumeItem(it)} />
        ))}
      </Row>
    )
  if (newestMovies.length >= 10)
    rows.push(
      <Row key="top10" title="Top 10 new movies" className="top10" onMore={() => navigate('movies')}>
        {newestMovies.slice(0, 10).map((c, n) => (
          <Top10Card key={c.id} c={c} n={n + 1} onOpen={openDetail} />
        ))}
      </Row>
    )
  if (myList.length > 0)
    rows.push(
      <Row key="mylist" title="My List" onMore={() => navigate('mylist')}>
        {myList.map((c) => (
          <PosterCard key={c.id} c={c} onOpen={openDetail} />
        ))}
      </Row>
    )
  if (live.length > 0)
    rows.push(
      <Row key="live" title="Live now" onMore={() => navigate('live')}>
        {live.map((c) => (
          <ChannelCard
            key={c.id}
            c={c}
            now={nn[c.id]?.now}
            favorite={favorites.includes(c.id)}
            onPlay={() =>
              void play(
                c.id,
                live.map((r) => r.id)
              )
            }
          />
        ))}
      </Row>
    )
  if (recs.forYou.length > 0)
    rows.push(
      <Row key="foryou" title="Recommended for you">
        {recs.forYou.map((c) => (
          <PosterCard key={c.id} c={c} onOpen={openDetail} />
        ))}
      </Row>
    )
  if (newestSeries.length > 0)
    rows.push(
      <Row key="newseries" title="New series" onMore={() => navigate('series')}>
        {newestSeries.slice(0, 30).map((c) => (
          <PosterCard key={c.id} c={c} onOpen={openDetail} />
        ))}
      </Row>
    )
  if (recs.because)
    rows.push(
      <Row key="because" title={`Because you watched ${recs.because.title}`}>
        {recs.because.items.map((c) => (
          <PosterCard key={c.id} c={c} onOpen={openDetail} />
        ))}
      </Row>
    )
  for (const g of genreRows)
    rows.push(
      <Row key={g.id} title={g.title} onMore={() => navigate(g.items[0]?.type === 'series' ? 'series' : 'movies')}>
        {g.items.map((c) => (
          <PosterCard key={c.id} c={c} onOpen={openDetail} />
        ))}
      </Row>
    )
  if (recents.length > 0)
    rows.push(
      <Row key="recents" title="Recently watched channels">
        {recents.map((c) => (
          <ChannelCard
            key={c.id}
            c={c}
            now={nn[c.id]?.now}
            favorite={favorites.includes(c.id)}
            onPlay={() =>
              void play(
                c.id,
                recents.map((r) => r.id)
              )
            }
          />
        ))}
      </Row>
    )
  return (
    <div className="page nf-page">
      <Billboard items={billboard} fallback={welcome} />
      {look === 'wonder' && <Collections />}

      <div className="nf-rows">
        {hasSources && !vod.length && <SkeletonRows rows={3} />}
        {rows.slice(0, shownRows)}

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
  return {
    id: i.key,
    sourceId: i.sourceId,
    type: i.kind,
    providerId: i.key.split(':').pop() ?? '',
    name: i.title,
    logo: i.poster,
    group: i.group,
    url: ''
  }
}
