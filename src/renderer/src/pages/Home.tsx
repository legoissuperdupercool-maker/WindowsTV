import { useEffect, useMemo, useState } from 'react'
import { useStore, type RouteName } from '../store'
import { Icon } from '../components/Icon'
import type { AppTile, Channel, EpgNowNext, Programme } from '@shared/types'

export function Home(): JSX.Element {
  const { settings, navigate, channels, play, openWebApp, currentSourceId } = useStore()
  const tiles = settings?.appTiles ?? []
  const hasSources = (settings?.sources.length ?? 0) > 0

  const recents = useMemo(
    () =>
      (settings?.recents ?? [])
        .map((id) => channels.find((c) => c.id === id))
        .filter((c): c is Channel => Boolean(c))
        .slice(0, 12),
    [settings?.recents, channels]
  )

  const liveSample = useMemo(
    () => channels.filter((c) => c.type === 'live').slice(0, 18),
    [channels]
  )

  const featured = recents[0] ?? liveSample[0]

  // EPG now/next for everything shown on the home screen.
  const [nn, setNn] = useState<Record<string, EpgNowNext>>({})
  useEffect(() => {
    if (!currentSourceId) return
    const items = dedupe([featured, ...recents, ...liveSample].filter(Boolean) as Channel[])
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
  }, [currentSourceId, featured?.id, recents.length, liveSample.length])

  const onTile = (tile: AppTile): void => {
    if (tile.kind === 'web') openWebApp(tile.target, tile.userAgent)
    else if (tile.kind === 'app') void window.api.launchApp(tile.target)
    else navigate(tile.target as RouteName)
  }

  const featuredNow = featured ? nn[featured.id]?.now : undefined
  const grad = gradientFor(featured?.name ?? 'WindowsTV')

  return (
    <div className="page">
      {/* ---- hero spotlight ---- */}
      <section className="hero">
        <div className="hero-bg" style={{ background: grad }} />
        <div className="hero-inner">
          {featured ? (
            <>
              <span className="hero-kicker">
                <span className="dot" /> {featured.type === 'live' ? 'Live now' : 'Continue'}
              </span>
              <h1 className="hero-title">{featured.name}</h1>
              <p className="hero-meta">
                {featuredNow
                  ? `${fmt(featuredNow.start)}–${fmt(featuredNow.stop)}  ·  ${featuredNow.title}`
                  : 'Pick up where you left off, or browse your channels, guide and on-demand library.'}
              </p>
              <div className="hero-actions">
                <button className="focusable btn primary" onClick={() => void play(featured.id)}>
                  <Icon name="play" size={18} /> Watch
                </button>
                <button className="focusable btn" onClick={() => navigate('live')}>
                  <Icon name="live" size={16} /> Browse channels
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="hero-kicker">Welcome</span>
              <h1 className="hero-title">WindowsTV</h1>
              <p className="hero-meta">
                {hasSources
                  ? 'Your channels are loading — pick an app below to get started.'
                  : 'Add your IPTV provider (Xtream login or an M3U playlist) to start watching in high quality.'}
              </p>
              <div className="hero-actions">
                <button className="focusable btn accent" onClick={() => navigate('settings')}>
                  <Icon name="settings" size={16} /> {hasSources ? 'Manage sources' : 'Add a source'}
                </button>
                {hasSources && (
                  <button className="focusable btn" onClick={() => navigate('live')}>
                    <Icon name="live" size={16} /> Live TV
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ---- apps ---- */}
      <div className="rail">
        <div className="rail-title">Apps</div>
        <div className="rail-track">
          {tiles.map((tile) => (
            <AppCard key={tile.id} tile={tile} onClick={() => onTile(tile)} />
          ))}
        </div>
      </div>

      {recents.length > 0 && (
        <MediaRail title="Recently watched" items={recents} nn={nn} onPlay={(id) => void play(id, recents.map((r) => r.id))} />
      )}

      {liveSample.length > 0 && (
        <MediaRail
          title="Live TV"
          count={channels.filter((c) => c.type === 'live').length}
          items={liveSample}
          nn={nn}
          onPlay={(id) => void play(id, liveSample.map((r) => r.id))}
        />
      )}
    </div>
  )
}

function AppCard({ tile, onClick }: { tile: AppTile; onClick: () => void }): JSX.Element {
  const sub = tile.kind === 'web' ? 'Open in app' : tile.kind === 'app' ? 'Launch app' : sectionSub(tile.target)
  return (
    <button
      className="focusable app-card"
      style={{ ['--c1' as string]: tile.color ?? '#39425a' }}
      onClick={onClick}
    >
      <span className="ac-icon">
        <Icon name={tile.icon ?? 'tv'} size={26} />
      </span>
      <div>
        <div className="ac-label">{tile.label}</div>
        <div className="ac-sub">{sub}</div>
      </div>
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
        {title} {count ? <span className="count">{count}</span> : null}
      </div>
      <div className="rail-track">
        {items.map((c) => {
          const now = nn[c.id]?.now
          return (
            <button key={c.id} className="focusable media-card" onClick={() => onPlay(c.id)}>
              <div className="art">
                {c.logo ? <img src={c.logo} loading="lazy" /> : <div className="logo-ph">{c.name.slice(0, 2).toUpperCase()}</div>}
                {c.type === 'live' && <span className="badge-live">LIVE</span>}
                {c.number ? <span className="chno">{c.number}</span> : null}
                {favorites.includes(c.id) && (
                  <span className="fav-pin">
                    <Icon name="star" size={16} />
                  </span>
                )}
              </div>
              <div className="body">
                <div className="title">{c.name}</div>
                <div className="sub">{now ? now.title : c.type === 'live' ? 'Live channel' : c.type}</div>
                {now && (
                  <div className="epg-progress">
                    <span style={{ width: `${progress(now)}%` }} />
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------- helpers
function sectionSub(target: string): string {
  return (
    { live: 'Watch channels', guide: 'What’s on now', movies: 'On demand', series: 'Box sets', settings: 'Sources & player' }[
      target
    ] ?? ''
  )
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

/** A calm, flat single-hue wash for the hero (derived from the featured title). */
function gradientFor(seed: string): string {
  const h = hash(seed) % 360
  return `linear-gradient(135deg, hsl(${h} 34% 22%) 0%, hsl(${h} 30% 14%) 52%, #07090e 100%)`
}
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
