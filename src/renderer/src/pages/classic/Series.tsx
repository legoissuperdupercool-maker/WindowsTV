import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { CatalogStatus } from '../../components/CatalogStatus'
import { FadeImg } from '../../components/FadeImg'
import { useProgressive } from '../../hooks/useProgressive'

export function ClassicSeries(): JSX.Element {
  const { channels, currentSourceId, loadCatalog, openDetail } = useStore()
  const [query, setQuery] = useState('')

  useEffect(() => {
    void loadCatalog('series', false)
  }, [loadCatalog, currentSourceId])

  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return channels.filter((c) => !q || c.name.toLowerCase().includes(q))
  }, [channels, deferredQuery])
  const { visible, sentinelRef } = useProgressive(filtered)

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
            <button key={c.id} className="focusable poster-card" onClick={() => openDetail(c)}>
              <div className="art">
                <span className="ph-txt">{c.name.slice(0, 2).toUpperCase()}</span>
                {c.logo && <FadeImg src={c.logo} alt="" className="poster-img" />}
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
