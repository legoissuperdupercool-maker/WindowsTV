import { useEffect, useMemo, useRef, useState } from 'react'
import { activeProfile, cachedCategories, useStore, type RouteName } from '../store'
import { recommend, type SeedInfo } from '../recommend'
import { Icon } from '../components/Icon'
import { ScrollRow } from '../components/ScrollRow'
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
  useEffect(() => {
    if (!currentSourceId) return
    void Promise.all([fetchList('movie'), fetchList('series')]).then(([m, s]) =>
      setVodLists({
        channels: [...m, ...s],
        categories: [...cachedCategories(currentSourceId, 'movie'), ...cachedCategories(currentSourceId, 'series')]
      })
    )
  }, [currentSourceId, fetchList])
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
  const onNow = live.filter((c) => c.id !== featured?.id).slice(0, 3)

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

  const featuredNow = featured ? nn[featured.id]?.now : undefined

  // Newest movies (by "added" date) with backdrop artwork for the carousel.
  const [movieSlides, setMovieSlides] = useState<MovieSlide[]>([])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const movies = await fetchList('movie')
      const newest = [...movies]
        .sort((a, b) => Number(b.meta?.added ?? 0) - Number(a.meta?.added ?? 0))
        .slice(0, 8)
      const infos = await Promise.all(
        newest.map(async (c) => ({ channel: c, info: (await window.api.vod.info(c.sourceId, c.providerId)).data }))
      )
      if (!cancelled) setMovieSlides(infos.filter((x): x is MovieSlide => Boolean(x.info?.backdrop)).slice(0, 5))
    })()
    return () => {
      cancelled = true
    }
  }, [currentSourceId, fetchList])

  const liveHero = (
    <section className="hero" style={{ ['--hero' as string]: heroColor(featured?.name ?? 'ello') }}>
      <div className="hero-main">
        {featured ? (
          <>
            <span className="hero-kicker">
              <span className="live-dot" /> {featured.type === 'live' ? 'Live now' : 'Continue watching'}
            </span>
            <h1 className="hero-title">{featured.name}</h1>
            {featuredNow ? (
              <div className="hero-prog">
                <div className="hero-prog-title">{featuredNow.title}</div>
                <div className="hero-prog-row">
                  <span>{fmt(featuredNow.start)}</span>
                  <div className="hero-bar">
                    <span style={{ width: `${progress(featuredNow)}%` }} />
                  </div>
                  <span>{fmt(featuredNow.stop)}</span>
                </div>
              </div>
            ) : (
              <p className="hero-meta">Pick up where you left off.</p>
            )}
            <div className="hero-actions">
              <button className="focusable btn on-color" onClick={() => void play(featured.id)}>
                <Icon name="play" size={22} /> Watch
              </button>
              <button className="focusable btn on-color" onClick={() => navigate('guide')}>
                <Icon name="guide" size={20} /> Guide
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="hero-kicker">Welcome</span>
            <h1 className="hero-title">ello smartTV</h1>
            <p className="hero-meta">
              {hasSources
                ? 'Your channels are loading…'
                : 'Add your IPTV provider (Xtream login or M3U playlist) to start watching.'}
            </p>
            <div className="hero-actions">
              <button className="focusable btn on-color" onClick={() => navigate('settings')}>
                <Icon name={hasSources ? 'settings' : 'add'} size={20} />
                {hasSources ? 'Manage sources' : 'Add a source'}
              </button>
            </div>
          </>
        )}
      </div>

      {onNow.length > 0 && (
        <div className="hero-side">
          <div className="hero-side-title">On now</div>
          {onNow.map((c) => {
            const p = nn[c.id]?.now
            return (
              <button key={c.id} className="focusable on-now" onClick={() => void play(c.id, live.map((l) => l.id))}>
                {c.logo ? <img className="on-now-logo" src={c.logo} loading="lazy" /> : <Initials name={c.name} className="on-now-logo" />}
                <div className="on-now-text">
                  <div className="on-now-ch">{c.name}</div>
                  <div className="on-now-prog">{p ? p.title : 'Live'}</div>
                  {p && (
                    <div className="hero-bar thin">
                      <span style={{ width: `${progress(p)}%` }} />
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )

  return (
    <div className="page">
      {/* ---- hero: newest movies with real artwork, plus the live slide ---- */}
      <HeroCarousel
        slides={[
          ...movieSlides.map((m) => ({ key: m.channel.id, node: <MovieHero item={m} onPlay={() => void play(m.channel.id)} onInfo={() => openDetail(m.channel)} /> })),
          { key: 'live', node: liveHero }
        ]}
      />

      {/* ---- row 1: apps ---- */}
      <div className="rail">
        <div className="rail-title">Your apps</div>
        <ScrollRow className="rail-track">
          {apps.map((tile) => (
            <AppCard key={tile.id} tile={tile} onClick={() => onTile(tile)} />
          ))}
          <button className="focusable app-card add-app" onClick={() => navigate('settings')}>
            <Icon name="add" size={30} />
            <span>Add app</span>
          </button>
        </ScrollRow>
      </div>

      {/* ---- continue watching ---- */}
      {continueItems.length > 0 && (
        <div className="rail">
          <div className="rail-title">Continue watching</div>
          <ScrollRow className="rail-track">
            {continueItems.map((it) => (
              <button key={it.key} className="focusable media-card" onClick={() => void resumeItem(it)}>
                <div className="art cover">
                  <Initials name={it.title} />
                  {it.poster && <FadeImg src={it.poster} alt="" className="cover-img" />}
                </div>
                <div className="epg-progress flush">
                  <span style={{ width: `${Math.min(100, (it.position / Math.max(1, it.duration)) * 100)}%` }} />
                </div>
                <div className="body">
                  <div className="title">{it.title}</div>
                  <div className="sub">{it.subtitle ?? `${Math.max(1, Math.round((it.duration - it.position) / 60))} min left`}</div>
                </div>
              </button>
            ))}
          </ScrollRow>
        </div>
      )}

      {myList.length > 0 && <PosterRail title="My List" items={myList} onOpen={openDetail} />}
      {recs.forYou.length > 0 && <PosterRail title="Recommended for you" items={recs.forYou} onOpen={openDetail} />}

      {/* ---- row 2: live channels ---- */}
      {live.length > 0 && (
        <MediaRail
          title="Live now"
          count={channels.filter((c) => c.type === 'live').length}
          items={live}
          nn={nn}
          onPlay={(id) => void play(id, live.map((r) => r.id))}
        />
      )}

      {recs.because && (
        <PosterRail title={`Because you watched ${recs.because.title}`} items={recs.because.items} onOpen={openDetail} />
      )}

      {recents.length > 0 && (
        <MediaRail
          title="Recently watched"
          items={recents}
          nn={nn}
          onPlay={(id) => void play(id, recents.map((r) => r.id))}
        />
      )}
    </div>
  )
}

interface MovieSlide {
  channel: Channel
  info: MediaDetails
}

/** Rotating hero: crossfades every 9 s, pauses while something in it is focused. */
function HeroCarousel({ slides }: { slides: Array<{ key: string; node: JSX.Element }> }): JSX.Element {
  const [i, setI] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const index = slides.length ? i % slides.length : 0
  useEffect(() => {
    if (slides.length < 2) return
    const t = setInterval(() => {
      const f = getFocused()
      if (f && ref.current?.contains(f)) return
      setI((n) => n + 1)
    }, 9000)
    return () => clearInterval(t)
  }, [slides.length])
  return (
    <div className="hero-carousel" ref={ref}>
      <div key={slides[index]?.key} className="hero-slide">
        {slides[index]?.node}
      </div>
      {slides.length > 1 && (
        <div className="hero-dots">
          {slides.map((s, n) => (
            <button key={s.key} className={`hero-dot ${n === index ? 'on' : ''}`} onClick={() => setI(n)} aria-label={`Slide ${n + 1}`} />
          ))}
        </div>
      )}
    </div>
  )
}

function MovieHero({ item, onPlay, onInfo }: { item: MovieSlide; onPlay: () => void; onInfo: () => void }): JSX.Element {
  const { info, channel } = item
  const meta = [info.year, info.rating ? `★ ${info.rating}` : undefined, info.genre].filter(Boolean).join('  ·  ')
  return (
    <section className="hero art-hero">
      <FadeImg src={info.backdrop} alt="" className="hero-backdrop" />
      <div className="hero-shade" />
      <div className="hero-main">
        <span className="hero-kicker">New movie</span>
        <h1 className="hero-title">{info.title || channel.name}</h1>
        {meta && <div className="hero-artmeta">{meta}</div>}
        {info.plot && <p className="hero-plot">{info.plot}</p>}
        <div className="hero-actions">
          <button className="focusable btn primary" onClick={onPlay}>
            <Icon name="play" size={22} /> Play
          </button>
          <button className="focusable btn on-color" onClick={onInfo}>
            <Icon name="info" size={20} /> More info
          </button>
        </div>
      </div>
    </section>
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

function MediaRail({
  title,
  items,
  nn,
  onPlay,
  count
}: {
  title: string
  items: Channel[]
  nn: Record<string, EpgNowNext>
  onPlay: (id: string) => void
  count?: number
}): JSX.Element {
  const favorites = useStore((s) => s.settings?.favorites ?? [])
  return (
    <div className="rail">
      <div className="rail-title">
        {title} {count ? <span className="count">{count} channels</span> : null}
      </div>
      <ScrollRow className="rail-track">
        {items.map((c) => {
          const now = nn[c.id]?.now
          return (
            <button key={c.id} className="focusable media-card" onClick={() => onPlay(c.id)}>
              <div className="art">
                {c.logo ? <FadeImg src={c.logo} alt="" /> : <Initials name={c.name} />}
                {c.number ? <span className="chno">{c.number}</span> : null}
                {favorites.includes(c.id) && (
                  <span className="fav-pin">
                    <Icon name="star" size={16} />
                  </span>
                )}
              </div>
              <div className="body">
                <div className="title">{c.name}</div>
                <div className="sub">{now ? now.title : 'Live channel'}</div>
                {now && (
                  <div className="epg-progress">
                    <span style={{ width: `${progress(now)}%` }} />
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </ScrollRow>
    </div>
  )
}

// --------------------------------------------------------------------- helpers

function fmt(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
function progress(p: Programme): number {
  return Math.max(0, Math.min(100, ((Date.now() - p.start) / (p.stop - p.start)) * 100))
}
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

/** A bright hero colour picked from the featured channel's name. */
function heroColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return ['#1a73e8', '#c5221f', '#137333', '#8430ce', '#d56e0c', '#007b83'][h % 6]
}

/** A row of movie / series posters (My List, recommendations). */
function PosterRail({ title, items, onOpen }: { title: string; items: Channel[]; onOpen: (c: Channel) => void }): JSX.Element {
  return (
    <div className="rail">
      <div className="rail-title">{title}</div>
      <ScrollRow className="rail-track posters">
        {items.map((c) => (
          <button key={c.id} className="focusable poster-card" onClick={() => onOpen(c)}>
            <div className="art">
              <span className="ph-txt">{c.name.replace(/^[A-Z]{2,3}\s*[-|:]\s*/, '').slice(0, 2).toUpperCase()}</span>
              {c.logo && <FadeImg src={c.logo} alt="" className="poster-img" />}
            </div>
            <div className="cap">{c.name}</div>
          </button>
        ))}
      </ScrollRow>
    </div>
  )
}

/** A saved title that's no longer in the provider's list still opens its detail screen. */
function listItemChannel(i: ListItem): Channel {
  return { id: i.key, sourceId: i.sourceId, type: i.kind, providerId: i.key.split(':').pop() ?? '', name: i.title, logo: i.poster, group: i.group, url: '' }
}
