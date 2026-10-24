import { useEffect, useMemo, useState } from 'react'
import { activeProfile, useStore, type SeriesRef } from '../store'
import { Icon } from '../components/Icon'
import { FadeImg } from '../components/FadeImg'
import { PosterCard } from '../components/nf'
import { cleanTitle } from '../recommend'
import type { Channel, MediaDetails, SeriesEpisode, WatchItem } from '@shared/types'

/**
 * Netflix-style detail window for a movie or series, over the page: artwork
 * header with Play / Resume / My List, facts, the episode list per season and
 * "More like this".
 */
export function Details(): JSX.Element | null {
  const { detail, closeDetail, play, playEpisode, playerVisible, toggleMyList, fetchList, openDetail } = useStore()
  // More like this: the same category, newest first.
  const [similar, setSimilar] = useState<Channel[]>([])
  useEffect(() => {
    setSimilar([])
    if (!detail || (detail.type !== 'movie' && detail.type !== 'series')) return
    let alive = true
    void fetchList(detail.type).then((list) => {
      if (!alive) return
      const same = list.filter((c) => c.group && c.group === detail.group && c.id !== detail.id)
      same.sort((a, b) => Number(b.meta?.added ?? 0) - Number(a.meta?.added ?? 0))
      setSimilar(same.slice(0, 12))
    })
    return () => {
      alive = false
    }
  }, [detail?.id])
  const myList = useStore((s) => activeProfile(s)?.myList)
  const [info, setInfo] = useState<MediaDetails | null>(null)
  const [episodes, setEpisodes] = useState<SeriesEpisode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [season, setSeason] = useState<number | null>(null)
  const [movieProgress, setMovieProgress] = useState<WatchItem | null>(null)
  const [epProgress, setEpProgress] = useState<Record<string, WatchItem>>({})

  // Load the title's info / episodes.
  useEffect(() => {
    if (!detail) return
    setInfo(null)
    setEpisodes(null)
    setError(null)
    setSeason(null)
    if (detail.type === 'series') {
      void window.api.series.info(detail.sourceId, detail.providerId).then((r) => {
        if (r.data) {
          setInfo(r.data.details)
          setEpisodes(r.data.episodes)
        } else setError(r.error ?? 'Couldn’t load episodes.')
      })
    } else {
      void window.api.vod.info(detail.sourceId, detail.providerId).then((r) => {
        if (r.data) setInfo(r.data) // missing info isn't fatal — it still plays
      })
    }
  }, [detail?.id])

  // Watch progress — reloaded when you come back from the player.
  useEffect(() => {
    if (!detail || playerVisible) return
    if (detail.type === 'series') {
      void window.api.progress.series(detail.sourceId, detail.providerId).then((r) => setEpProgress(r.data ?? {}))
    } else {
      void window.api.progress.get(detail.id).then((r) => setMovieProgress(r.data ?? null))
    }
  }, [detail?.id, playerVisible])

  const all = episodes ?? []
  // Where to pick up a series: the episode in progress, or the one after the
  // last finished episode, or the very first.
  const upNext = useMemo(() => {
    const touched = Object.values(epProgress).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (!touched || !all.length) return { index: 0, resume: false }
    const i = all.findIndex((e) => e.id === touched.series?.episodeId)
    if (i < 0) return { index: 0, resume: false }
    if (!touched.finished) return { index: i, resume: true }
    return { index: Math.min(i + 1, all.length - 1), resume: false }
  }, [epProgress, episodes])

  // Default season tab: the one containing the "up next" episode.
  useEffect(() => {
    if (season == null && all.length) setSeason(all[upNext.index]?.season ?? all[0].season)
  }, [episodes, upNext])

  const seasons = useMemo(() => [...new Set(all.map((e) => e.season))], [episodes])

  if (!detail) return null

  const title = info?.title || detail.name
  const backdrop = info?.backdrop || undefined
  const poster = info?.poster || detail.logo
  const plot = info?.plot || (typeof detail.meta?.plot === 'string' ? (detail.meta.plot as string) : undefined)
  const meta = [info?.year, info?.duration, info?.rating ? `★ ${info.rating}` : undefined, info?.genre]
    .filter(Boolean)
    .join('  ·  ')

  const seriesRef: SeriesRef = { id: detail.providerId, name: detail.name, sourceId: detail.sourceId, poster }
  const playEp = (index: number, resume = true): void => void playEpisode(seriesRef, all, index, { resume })

  const canResume = movieProgress && !movieProgress.finished && movieProgress.position >= 30
  const next = all[upNext.index]

  const genres = (info?.genre || (typeof detail.meta?.genre === 'string' ? (detail.meta.genre as string) : '')).split(/[,/]/).map((g) => g.trim()).filter(Boolean)
  const year = info?.year || (typeof detail.meta?.year === 'string' ? (detail.meta.year as string) : undefined)
  const rating = info?.rating || (typeof detail.meta?.rating === 'string' ? (detail.meta.rating as string) : undefined)
  const seasonEps = all.map((ep, index) => ({ ep, index })).filter((x) => x.ep.season === season)

  return (
    <div className="nf-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && closeDetail()}>
      <div className="nf-modal" data-modal role="dialog" aria-label={title}>
        <div className="nf-modal-hero">
          {backdrop ? (
            <FadeImg src={backdrop} alt="" className="nf-modal-backdrop" />
          ) : (
            poster && (
              <>
                <FadeImg src={poster} alt="" className="nf-bb-blur" />
                <FadeImg src={poster} alt="" className="nf-modal-poster" />
              </>
            )
          )}
          <div className="nf-modal-shade" />
          <button className="focusable nf-close" title="Close (Esc)" onClick={closeDetail}>
            <Icon name="close" size={24} />
          </button>
          <div className="nf-modal-head">
            <h1 className="nf-modal-title">{cleanTitle(title)}</h1>
            <div className="nf-bb-actions">
              {detail.type === 'series' ? (
                next && (
                  <button className="focusable nf-btn play" data-autofocus onClick={() => playEp(upNext.index, upNext.resume)}>
                    <Icon name="play" size={26} /> {upNext.resume ? 'Resume' : 'Play'} S{next.season} E{next.episode}
                  </button>
                )
              ) : canResume ? (
                <>
                  <button className="focusable nf-btn play" data-autofocus onClick={() => void play(detail.id, undefined, { poster })}>
                    <Icon name="play" size={26} /> Resume
                  </button>
                  <button className="focusable nf-btn more" onClick={() => void play(detail.id, undefined, { resume: false, poster })}>
                    <Icon name="refresh" size={22} /> Start over
                  </button>
                </>
              ) : (
                <button className="focusable nf-btn play" data-autofocus onClick={() => void play(detail.id, undefined, { poster })}>
                  <Icon name="play" size={26} /> Play
                </button>
              )}
              <MyListButton inList={Boolean(myList?.some((i) => i.key === detail.id))} onToggle={() => void toggleMyList(detail)} />
            </div>
            {canResume && movieProgress && (
              <div className="nf-modal-progress">
                <div className="nf-wide-bar">
                  <span style={{ width: `${pct(movieProgress)}%` }} />
                </div>
                <span>{minutesLeft(movieProgress)} left</span>
              </div>
            )}
          </div>
        </div>

        <div className="nf-modal-body">
          <div className="nf-modal-cols">
            <div>
              <div className="nf-bb-meta">
                {rating && Number(rating) > 0 && <span className="nf-match">★ {Number(rating).toFixed(1)}</span>}
                {year && <span>{year}</span>}
                {info?.duration && <span>{info.duration}</span>}
                {detail.type === 'series' && seasons.length > 0 && <span>{seasons.length} season{seasons.length === 1 ? '' : 's'}</span>}
                <span className="nf-hd">HD</span>
              </div>
              {plot && <p className="nf-modal-plot">{plot}</p>}
            </div>
            <div className="nf-modal-facts">
              {info?.cast && (
                <div>
                  <span>Cast:</span> {info.cast}
                </div>
              )}
              {genres.length > 0 && (
                <div>
                  <span>Genres:</span> {genres.join(', ')}
                </div>
              )}
              {info?.director && (
                <div>
                  <span>Director:</span> {info.director}
                </div>
              )}
            </div>
          </div>

          {detail.type === 'series' && (
            <div className="nf-episodes">
              <div className="nf-episodes-head">
                <h3>Episodes</h3>
                {seasons.length > 1 && (
                  <select className="nf-genre" value={season ?? ''} onChange={(e) => setSeason(Number(e.target.value))}>
                    {seasons.map((s) => (
                      <option key={s} value={s}>
                        Season {s}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {error && <div className="test-result bad">{error}</div>}
              {!episodes && !error && <div className="spinner" />}
              {seasonEps.map(({ ep, index }) => {
                const p = epProgress[ep.id]
                return (
                  <button key={ep.id} className={`focusable nf-episode ${index === upNext.index ? 'current' : ''}`} onClick={() => playEp(index)}>
                    <span className="nf-ep-num">{ep.episode}</span>
                    <span className="nf-ep-art">
                      {ep.thumb ? <FadeImg src={ep.thumb} alt="" /> : poster ? <FadeImg src={poster} alt="" className="dim" /> : null}
                      <span className="nf-wide-play small">
                        <Icon name="play" size={22} />
                      </span>
                      {p && (
                        <span className="nf-wide-bar">
                          <span style={{ width: `${p.finished ? 100 : pct(p)}%` }} />
                        </span>
                      )}
                    </span>
                    <span className="nf-ep-text">
                      <span className="nf-ep-top">
                        <b>{ep.title}</b>
                        {ep.duration && <span>{ep.duration}</span>}
                      </span>
                      {ep.plot && <span className="nf-ep-plot">{ep.plot}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {similar.length > 0 && (
            <div className="nf-similar">
              <h3>More like this</h3>
              <div className="nf-grid small">
                {similar.map((c) => (
                  <PosterCard key={c.id} c={c} onOpen={openDetail} wide={false} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function pct(i: WatchItem): number {
  return i.duration ? Math.min(100, (i.position / i.duration) * 100) : 0
}
function minutesLeft(i: WatchItem): string {
  const m = Math.max(1, Math.round((i.duration - i.position) / 60))
  if (m < 60) return `${m} min`
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`
}

function MyListButton({ inList, onToggle }: { inList: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button className={`focusable nf-round ${inList ? 'on' : ''}`} onClick={onToggle} title={inList ? 'Remove from My List' : 'Add to My List'}>
      <Icon name={inList ? 'check' : 'add'} size={24} />
    </button>
  )
}
