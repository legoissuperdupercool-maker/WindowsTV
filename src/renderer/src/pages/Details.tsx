import { useEffect, useMemo, useState } from 'react'
import { useStore, type SeriesRef } from '../store'
import { Icon } from '../components/Icon'
import { FadeImg } from '../components/FadeImg'
import type { MediaDetails, SeriesEpisode, WatchItem } from '@shared/types'

/**
 * Google-TV-style detail screen for a movie or series: full-bleed backdrop,
 * title + meta, Resume / Start over, plot and credits; series add season tabs
 * and an episode row with per-episode progress.
 */
export function Details(): JSX.Element | null {
  const { detail, closeDetail, play, playEpisode, playerVisible } = useStore()
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

  return (
    <div className="detail">
      <div className="detail-art">
        {backdrop ? <FadeImg src={backdrop} alt="" /> : poster ? <FadeImg src={poster} alt="" className="blur" /> : null}
      </div>
      <div className="detail-scrim" />

      <button className="focusable icon-btn detail-back" title="Back" onClick={closeDetail}>
        <Icon name="back" size={24} />
      </button>

      <div className="detail-body">
        <div className="detail-main">
          {!backdrop && poster && <FadeImg src={poster} alt="" className="detail-poster" />}
          <h1 className="detail-title">{title}</h1>
          {meta && <div className="detail-meta">{meta}</div>}

          <div className="detail-actions">
            {detail.type === 'series' ? (
              next && (
                <button className="focusable btn primary" data-autofocus onClick={() => playEp(upNext.index, upNext.resume)}>
                  <Icon name="play" size={22} /> {upNext.resume ? 'Resume' : 'Play'} S{next.season} E{next.episode}
                </button>
              )
            ) : canResume ? (
              <>
                <button className="focusable btn primary" data-autofocus onClick={() => void play(detail.id, undefined, { poster })}>
                  <Icon name="play" size={22} /> Resume
                </button>
                <button className="focusable btn" onClick={() => void play(detail.id, undefined, { resume: false, poster })}>
                  <Icon name="refresh" size={20} /> Start over
                </button>
              </>
            ) : (
              <button className="focusable btn primary" data-autofocus onClick={() => void play(detail.id, undefined, { poster })}>
                <Icon name="play" size={22} /> Play
              </button>
            )}
          </div>

          {canResume && movieProgress && (
            <div className="detail-progress">
              <div className="epg-progress">
                <span style={{ width: `${pct(movieProgress)}%` }} />
              </div>
              <span>{minutesLeft(movieProgress)} left</span>
            </div>
          )}

          {plot && <p className="detail-plot">{plot}</p>}
          {(info?.cast || info?.director) && (
            <div className="detail-credits">
              {info?.cast && (
                <div>
                  <span>Cast</span> {info.cast}
                </div>
              )}
              {info?.director && (
                <div>
                  <span>Director</span> {info.director}
                </div>
              )}
            </div>
          )}
        </div>

        {detail.type === 'series' && (
          <div className="detail-episodes">
            {error && <div className="test-result bad">{error}</div>}
            {!episodes && !error && <div className="spinner" />}
            {seasons.length > 1 && (
              <div className="season-tabs">
                {seasons.map((s) => (
                  <button key={s} className={`focusable tab ${s === season ? 'active' : ''}`} onClick={() => setSeason(s)}>
                    Season {s}
                  </button>
                ))}
              </div>
            )}
            <div className="episode-row">
              {all.map((ep, index) =>
                ep.season !== season ? null : (
                  <button key={ep.id} className="focusable episode-card" onClick={() => playEp(index)}>
                    <div className="ep-art">
                      {ep.thumb ? <FadeImg src={ep.thumb} alt="" /> : <span className="ep-num">E{ep.episode}</span>}
                      {epProgress[ep.id]?.finished && (
                        <span className="ep-watched" title="Watched">
                          ✓
                        </span>
                      )}
                    </div>
                    {epProgress[ep.id] && !epProgress[ep.id].finished && (
                      <div className="epg-progress flush">
                        <span style={{ width: `${pct(epProgress[ep.id])}%` }} />
                      </div>
                    )}
                    <div className="ep-body">
                      <div className="ep-title">
                        {ep.episode}. {ep.title}
                      </div>
                      {ep.duration && <div className="ep-sub">{ep.duration}</div>}
                    </div>
                  </button>
                )
              )}
            </div>
          </div>
        )}
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
