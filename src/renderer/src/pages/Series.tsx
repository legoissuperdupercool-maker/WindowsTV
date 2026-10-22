import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { CatalogStatus } from '../components/CatalogStatus'
import { useProgressive } from '../hooks/useProgressive'
import { Icon } from '../components/Icon'
import type { Channel, SeriesEpisode } from '@shared/types'

export function Series(): JSX.Element {
  const { channels, currentSourceId, loadCatalog, playEpisode } = useStore()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Channel | null>(null)
  const [episodes, setEpisodes] = useState<SeriesEpisode[] | null>(null)
  const [loadingEps, setLoadingEps] = useState(false)
  const [epError, setEpError] = useState<string | null>(null)

  useEffect(() => {
    void loadCatalog('series', false)
  }, [loadCatalog, currentSourceId])

  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return channels.filter((c) => !q || c.name.toLowerCase().includes(q))
  }, [channels, deferredQuery])
  const { visible, sentinelRef } = useProgressive(filtered)

  const openSeries = async (c: Channel): Promise<void> => {
    setSelected(c)
    setEpisodes(null)
    setEpError(null)
    setLoadingEps(true)
    const r = await window.api.series.info(c.sourceId, c.providerId)
    setLoadingEps(false)
    if (r.data) setEpisodes(r.data)
    else setEpError(r.error ?? 'Could not load episodes.')
  }

  if (!currentSourceId)
    return (
      <div className="page pad">
        <div className="empty">
          <div>
            <div className="big">📺</div>
            <h2>No source</h2>
          </div>
        </div>
      </div>
    )

  if (selected) {
    const bySeason = groupBySeason(episodes ?? [])
    return (
      <div className="page pad">
        <button className="focusable btn" style={{ margin: '4px 0 18px' }} onClick={() => setSelected(null)}>
          <Icon name="back" size={16} /> Back to series
        </button>
        <h1 className="section-title" style={{ margin: '0 0 8px' }}>
          {selected.name}
        </h1>
        {selected.meta?.plot ? (
          <p style={{ color: 'var(--text-dim)', maxWidth: 760, marginBottom: 22, lineHeight: 1.55 }}>
            {String(selected.meta.plot)}
          </p>
        ) : null}

        {loadingEps && <div className="spinner" />}
        {epError && <div className="test-result bad">{epError}</div>}
        {episodes &&
          [...bySeason.entries()].map(([season, eps]) => (
            <div key={season}>
              <div className="rail-title" style={{ margin: '18px 0 12px' }}>
                Season {season}
              </div>
              <div className="channel-grid">
                {eps.map((ep) => (
                  <button
                    key={ep.id}
                    className="focusable media-card"
                    onClick={() => void playEpisode(ep.url, `${selected.name} · ${ep.title}`)}
                  >
                    <div className="art">
                      <div className="logo-ph">E{ep.episode || '·'}</div>
                    </div>
                    <div className="body">
                      <div className="title">{ep.title}</div>
                      <div className="sub">{ep.duration ?? `Season ${ep.season}`}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    )
  }

  return (
    <div className="page pad">
      <h1 className="section-title">Series</h1>
      <div className="search-bar" style={{ maxWidth: 680 }}>
        <input placeholder="Search series…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {channels.length === 0 ? (
        <CatalogStatus what="series" />
      ) : (
        <div className="poster-grid">
          {visible.map((c) => (
            <button key={c.id} className="focusable poster-card" onClick={() => void openSeries(c)}>
              <div className="art">
                {c.logo ? <img src={c.logo} loading="lazy" /> : <span className="ph-txt">{c.name.slice(0, 2).toUpperCase()}</span>}
              </div>
              <div className="cap">{c.name}</div>
            </button>
          ))}
          <div ref={sentinelRef} style={{ gridColumn: '1 / -1', height: 1 }} />
        </div>
      )}
    </div>
  )
}

function groupBySeason(eps: SeriesEpisode[]): Map<number, SeriesEpisode[]> {
  const m = new Map<number, SeriesEpisode[]>()
  for (const ep of eps) {
    const arr = m.get(ep.season)
    if (arr) arr.push(ep)
    else m.set(ep.season, [ep])
  }
  return m
}
