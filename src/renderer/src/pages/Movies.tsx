import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { CatalogStatus } from '../components/CatalogStatus'
import { useProgressive } from '../hooks/useProgressive'
import { FadeImg } from '../components/FadeImg'

export function Movies(): JSX.Element {
  const { channels, categories, currentSourceId, loadCatalog, openDetail } = useStore()
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('__all__')

  useEffect(() => {
    void loadCatalog('movie', false)
  }, [loadCatalog, currentSourceId])

  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return channels.filter((c) => {
      if (cat !== '__all__' && c.group !== cat) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [channels, deferredQuery, cat])
  const { visible, sentinelRef } = useProgressive(filtered)

  if (!currentSourceId)
    return (
      <div className="page pad">
        <div className="empty">
          <div>
            <div className="big">🎬</div>
            <h2>No source</h2>
          </div>
        </div>
      </div>
    )

  return (
    <div className="page pad">
      <h1 className="section-title">Movies</h1>
      <div className="search-bar" style={{ maxWidth: 680 }}>
        <input placeholder="Search movies…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="source-select" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="__all__">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {channels.length === 0 ? (
        <CatalogStatus what="movies" />
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
