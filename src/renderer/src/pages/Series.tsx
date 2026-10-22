import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return channels.filter((c) => !q || c.name.toLowerCase().includes(q))
  }, [channels, query])

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
      <div className="page">
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
      <div className="page">
        <button className="focusable ghost-btn" style={{ marginBottom: 18 }} onClick={() => setSelected(null)}>
          ← Back to series
        </button>
        <h1 className="section-title">{selected.name}</h1>
        {selected.meta?.plot ? (
          <p style={{ color: 'var(--text-dim)', maxWidth: 760, marginTop: -12, marginBottom: 20 }}>
            {String(selected.meta.plot)}
          </p>
        ) : null}

        {loadingEps && <div className="spinner" />}
        {epError && <div className="test-result bad">{epError}</div>}
        {episodes &&
          [...bySeason.entries()].map(([season, eps]) => (
            <div key={season}>
              <div className="row-label">Season {season}</div>
              <div className="channel-grid" style={{ maxHeight: 'none' }}>
                {eps.map((ep) => (
                  <button
                    key={ep.id}
                    className="focusable channel-card"
                    onClick={() => void playEpisode(ep.url, `${selected.name} · ${ep.title}`)}
                  >
                    <div className="logo ph">E{ep.episode || '·'}</div>
                    <div className="meta">
                      <div className="name">{ep.title}</div>
                      <div className="epg-now">{ep.duration ?? ''}</div>
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
    <div className="page">
      <h1 className="section-title">Series</h1>
      <div className="search-bar" style={{ maxWidth: 680 }}>
        <input placeholder="Search series…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {channels.length === 0 ? (
        <div className="empty">
          <div>
            <div className="big">📺</div>
            <h2>No series</h2>
            <p>This source may not offer series, or they are still loading.</p>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 18
          }}
        >
          {filtered.slice(0, 400).map((c) => (
            <button
              key={c.id}
              className="focusable"
              onClick={() => void openSeries(c)}
              style={{
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                borderRadius: 14,
                padding: 0,
                overflow: 'hidden',
                textAlign: 'left'
              }}
            >
              <div style={{ aspectRatio: '2/3', background: '#0a0d14' }}>
                {c.logo && (
                  <img src={c.logo} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
              </div>
              <div style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.name}
              </div>
            </button>
          ))}
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
