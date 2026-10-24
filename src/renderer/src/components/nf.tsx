import { useEffect, useRef, useState, type ReactNode } from 'react'
import { activeProfile, useStore } from '../store'
import { cleanTitle } from '../recommend'
import { Icon } from './Icon'
import { FadeImg } from './FadeImg'
import { Initials } from './Initials'
import { ScrollRow } from './ScrollRow'
import { getFocused } from '../hooks/useSpatialNavigation'
import type { Channel, MediaDetails, Programme, WatchItem } from '@shared/types'

/*
 * The Netflix-style building blocks: billboard, rows, poster cards that grow
 * on hover with quick actions, Top 10, wide "continue" tiles and live tiles.
 */

export const metaStr = (c: Channel, k: string): string | undefined => {
  const v = c.meta?.[k]
  return typeof v === 'string' && v.trim() ? v : undefined
}

/** "EN | Action Movies" → "Action Movies" */
export function cleanCategory(name: string): string {
  const out = name
    .replace(/^\s*[[|(]?\s*(?:[A-Za-z]{2,3}|movies?|films?|series|vod|tv\s*shows?)\s*[\]|)]?\s*[-|:•▶►/]\s*/i, '')
    .replace(/^\s*[[|(]?\s*(?:movies?|films?|series|vod)\s*[\]|)]?\s*[-|:•▶►/]\s*/i, '')
    .trim()
  return out || name
}

/** A calm colour per title, for tiles without artwork. */
export function hue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h % 360
}

// --------------------------------------------------------------------- billboard

export interface BillboardItem {
  channel: Channel
  info?: MediaDetails | null
  kicker?: string
}

/** Big artwork header that rotates every 10 s (pauses while you're in it). */
export function Billboard({ items, fallback }: { items: BillboardItem[]; fallback?: ReactNode }): JSX.Element {
  const { play, openDetail, toggleMyList } = useStore()
  const myList = useStore((s) => activeProfile(s)?.myList)
  const [i, setI] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const index = items.length ? i % items.length : 0
  useEffect(() => {
    if (items.length < 2) return
    const t = setInterval(() => {
      const f = getFocused()
      if ((f && ref.current?.contains(f)) || ref.current?.matches(':hover')) return
      setI((n) => n + 1)
    }, 10_000)
    return () => clearInterval(t)
  }, [items.length])

  const item = items[index]
  if (!item) {
    return (
      <section className="nf-billboard nf-bb-empty" ref={ref}>
        <div className="nf-bb-art" />
        <div className="nf-bb-shade" />
        <div className="nf-bb-body">{fallback}</div>
      </section>
    )
  }
  const c = item.channel
  const info = item.info
  const backdrop = info?.backdrop || metaStr(c, 'backdrop')
  const poster = info?.poster || c.logo
  const title = cleanTitle(info?.title || c.name)
  const plot = info?.plot || metaStr(c, 'plot')
  const year = info?.year || metaStr(c, 'year')
  const rating = info?.rating || metaStr(c, 'rating')
  const genre = info?.genre || metaStr(c, 'genre')
  const inList = Boolean(myList?.some((x) => x.key === c.id))

  return (
    <section className="nf-billboard" ref={ref}>
      <div key={c.id} className="nf-bb-art">
        {backdrop ? (
          <FadeImg src={backdrop} alt="" className="nf-bb-backdrop" />
        ) : (
          <>
            {poster && <FadeImg src={poster} alt="" className="nf-bb-blur" />}
            {poster && <FadeImg src={poster} alt="" className="nf-bb-poster" />}
          </>
        )}
      </div>
      <div className="nf-bb-shade" />
      <div key={`${c.id}-body`} className="nf-bb-body">
        <div className="nf-bb-kicker">
          <span className="nf-bb-badge">{c.type === 'series' ? 'SERIES' : 'FILM'}</span> {item.kicker}
        </div>
        <h1 className="nf-bb-title">{title}</h1>
        <div className="nf-bb-meta">
          {rating && Number(rating) > 0 && <span className="nf-match">★ {Number(rating).toFixed(1)}</span>}
          {year && <span>{year}</span>}
          {genre && <span>{genre.split(/[,/]/).slice(0, 3).join(' · ')}</span>}
        </div>
        {plot && <p className="nf-bb-plot">{plot}</p>}
        <div className="nf-bb-actions">
          <button
            className="focusable nf-btn play"
            onClick={() => (c.type === 'series' ? openDetail(c) : void play(c.id, undefined, { poster }))}
          >
            <Icon name="play" size={26} /> Play
          </button>
          <button className="focusable nf-btn more" onClick={() => openDetail(c)}>
            <Icon name="info" size={24} /> More info
          </button>
          <button className="focusable nf-round" title={inList ? 'Remove from My List' : 'Add to My List'} onClick={() => void toggleMyList(c)}>
            <Icon name={inList ? 'check' : 'add'} size={24} />
          </button>
        </div>
      </div>
      {items.length > 1 && (
        <>
          <button className="nf-bb-arrow prev" aria-label="Previous" onClick={() => setI((n) => (n - 1 + items.length) % items.length)}>
            <Icon name="chevron" size={34} />
          </button>
          <button className="nf-bb-arrow next" aria-label="Next" onClick={() => setI((n) => n + 1)}>
            <Icon name="chevron" size={34} />
          </button>
        </>
      )}
      {items.length > 1 && (
        <div className="nf-bb-dots">
          {items.map((it, n) => (
            <button key={n === index ? `${it.channel.id}-${i}` : it.channel.id} className={`nf-dot ${n === index ? 'on' : ''}`} onClick={() => setI(n)} aria-label={`Title ${n + 1}`} />
          ))}
        </div>
      )}
    </section>
  )
}

// --------------------------------------------------------------------- rows

/** Wonder look: big glowing tiles for the main collections, under the billboard. */
export function Collections(): JSX.Element {
  const navigate = useStore((s) => s.navigate)
  const tiles: Array<{ route: 'movies' | 'series' | 'live' | 'guide' | 'mylist'; label: string; icon: string; from: string; to: string }> = [
    { route: 'movies', label: 'Movies', icon: 'movie', from: '#1d3c8f', to: '#0b1640' },
    { route: 'series', label: 'Series', icon: 'series', from: '#5b2a86', to: '#1d0d33' },
    { route: 'live', label: 'Live TV', icon: 'live', from: '#0f6e74', to: '#062a33' },
    { route: 'guide', label: 'TV Guide', icon: 'guide', from: '#8a3b1f', to: '#2e1208' },
    { route: 'mylist', label: 'Watchlist', icon: 'bookmarks', from: '#2d4f2a', to: '#0d1d0c' }
  ]
  return (
    <div className="nf-collections">
      {tiles.map((t) => (
        <button
          key={t.route}
          className="focusable nf-collection"
          style={{ ['--c1' as string]: t.from, ['--c2' as string]: t.to }}
          onClick={() => navigate(t.route)}
        >
          <Icon name={t.icon} size={34} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )
}

/** Shimmering rows while the catalogue loads. */
export function SkeletonRows({ rows = 2 }: { rows?: number }): JSX.Element {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="nf-skel-row" aria-hidden>
          <div className="nf-skel-title" />
          <div className="nf-skel-track">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="nf-skel-card" style={{ animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

export function Row({ title, onMore, children, className = '' }: { title: string; onMore?: () => void; children: ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`nf-row ${className}`}>
      <h2 className="nf-row-title">
        {onMore ? (
          <button className="nf-row-link" onClick={onMore}>
            {title} <span className="nf-explore">Explore all <Icon name="chevron" size={16} /></span>
          </button>
        ) : (
          title
        )}
      </h2>
      <ScrollRow className="nf-track">{children}</ScrollRow>
    </section>
  )
}

/** Poster that grows on hover / focus and shows quick actions. */
export function PosterCard({ c, onOpen }: { c: Channel; onOpen: (c: Channel) => void }): JSX.Element {
  const { play, toggleMyList } = useStore()
  const inList = useStore((s) => Boolean(activeProfile(s)?.myList.some((x) => x.key === c.id)))
  const title = cleanTitle(c.name)
  const year = metaStr(c, 'year')
  const rating = metaStr(c, 'rating')
  const genre = metaStr(c, 'genre')?.split(/[,/]/)[0]
  return (
    <div className="nf-card">
      <button className="focusable nf-card-hit" onClick={() => onOpen(c)} title={title}>
        <div className="nf-poster" style={{ ['--h' as string]: hue(title) }}>
          <span className="nf-ph">{title}</span>
          {c.logo && <FadeImg src={c.logo} alt="" />}
        </div>
      </button>
      <div className="nf-card-pop">
        <div className="nf-pop-actions">
          <button
            className="nf-pop-btn play"
            title={c.type === 'series' ? 'Episodes' : 'Play'}
            onClick={() => (c.type === 'series' ? onOpen(c) : void play(c.id, undefined, { poster: c.logo }))}
          >
            <Icon name="play" size={18} />
          </button>
          <button className="nf-pop-btn" title={inList ? 'Remove from My List' : 'Add to My List'} onClick={() => void toggleMyList(c)}>
            <Icon name={inList ? 'check' : 'add'} size={18} />
          </button>
          <span style={{ flex: 1 }} />
          <button className="nf-pop-btn" title="More info" onClick={() => onOpen(c)}>
            <Icon name="chevron" size={18} />
          </button>
        </div>
        <div className="nf-pop-title">{title}</div>
        <div className="nf-pop-meta">
          {rating && Number(rating) > 0 && <span className="nf-match">★ {Number(rating).toFixed(1)}</span>}
          {year && <span>{year}</span>}
          {genre && <span>{genre}</span>}
        </div>
      </div>
    </div>
  )
}

/** Top 10: big outlined numbers next to the posters. */
export function Top10Card({ c, n, onOpen }: { c: Channel; n: number; onOpen: (c: Channel) => void }): JSX.Element {
  const title = cleanTitle(c.name)
  return (
    <button className="focusable nf-top10" onClick={() => onOpen(c)} title={title}>
      <svg className="nf-top10-num" viewBox="0 0 120 160" aria-hidden>
        <text x="118" y="150" textAnchor="end">
          {n}
        </text>
      </svg>
      <div className="nf-poster" style={{ ['--h' as string]: hue(title) }}>
        <span className="nf-ph">{title}</span>
        {c.logo && <FadeImg src={c.logo} alt="" />}
      </div>
    </button>
  )
}

/** Continue watching: wide tile with a progress bar. */
export function ContinueCard({ it, onOpen }: { it: WatchItem; onOpen: () => void }): JSX.Element {
  const left = Math.max(1, Math.round((it.duration - it.position) / 60))
  return (
    <button className="focusable nf-wide" onClick={onOpen}>
      <div className="nf-wide-art" style={{ ['--h' as string]: hue(it.title) }}>
        {it.poster ? <FadeImg src={it.poster} alt="" /> : <Initials name={it.title} />}
        <span className="nf-wide-play">
          <Icon name="play" size={30} />
        </span>
        <div className="nf-wide-bar">
          <span style={{ width: `${Math.min(100, (it.position / Math.max(1, it.duration)) * 100)}%` }} />
        </div>
      </div>
      <div className="nf-wide-title">{cleanTitle(it.title)}</div>
      <div className="nf-wide-sub">{it.subtitle ? `${it.subtitle} · ` : ''}{left < 60 ? `${left} min left` : `${Math.floor(left / 60)} h ${left % 60} min left`}</div>
    </button>
  )
}

/** Live channel tile: logo on a colour, what's on now. */
export function ChannelCard({ c, now, onPlay, favorite }: { c: Channel; now?: Programme; onPlay: () => void; favorite?: boolean }): JSX.Element {
  const pct = now ? Math.max(0, Math.min(100, ((Date.now() - now.start) / (now.stop - now.start)) * 100)) : 0
  return (
    <button className="focusable nf-wide nf-live" onClick={onPlay}>
      <div className="nf-wide-art live" style={{ ['--h' as string]: hue(c.name) }}>
        {c.logo ? <FadeImg src={c.logo} alt="" className="nf-live-logo" /> : <span className="nf-live-name">{c.name}</span>}
        <span className="nf-live-badge">LIVE</span>
        {favorite && (
          <span className="nf-live-fav">
            <Icon name="star" size={16} />
          </span>
        )}
        {now && (
          <div className="nf-wide-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="nf-wide-title">{c.name}</div>
      <div className="nf-wide-sub">{now ? now.title : 'Live channel'}</div>
    </button>
  )
}
