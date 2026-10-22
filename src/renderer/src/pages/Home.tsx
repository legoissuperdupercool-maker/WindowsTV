import { useEffect, useMemo, useState } from 'react'
import { useStore, type RouteName } from '../store'
import { Icon } from '../components/Icon'
import { Initials } from '../components/Initials'
import { detectBrand } from '../components/brands'
import type { AppTile, Channel, EpgNowNext, Programme } from '@shared/types'

export function Home(): JSX.Element {
  const { settings, navigate, channels, play, openWebApp, currentSourceId } = useStore()
  const hasSources = (settings?.sources.length ?? 0) > 0

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

  return (
    <div className="page">
      {/* ---- hero ---- */}
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

      {/* ---- row 1: apps ---- */}
      <div className="rail">
        <div className="rail-title">Your apps</div>
        <div className="rail-track">
          {apps.map((tile) => (
            <AppCard key={tile.id} tile={tile} onClick={() => onTile(tile)} />
          ))}
          <button className="focusable app-card add-app" onClick={() => navigate('settings')}>
            <Icon name="add" size={30} />
            <span>Add app</span>
          </button>
        </div>
      </div>

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
      <div className="rail-track">
        {items.map((c) => {
          const now = nn[c.id]?.now
          return (
            <button key={c.id} className="focusable media-card" onClick={() => onPlay(c.id)}>
              <div className="art">
                {c.logo ? <img src={c.logo} loading="lazy" /> : <Initials name={c.name} />}
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
      </div>
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
