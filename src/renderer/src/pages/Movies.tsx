import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'

export function Movies(): JSX.Element {
  const { channels, categories, currentSourceId, loadCatalog, play } = useStore()
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('__all__')

  useEffect(() => {
    void loadCatalog('movie', false)
  }, [loadCatalog, currentSourceId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return channels.filter((c) => {
      if (cat !== '__all__' && c.group !== cat) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [channels, query, cat])

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
        <div className="empty">
          <div>
            <div className="big">🎬</div>
            <h2>No movies</h2>
            <p>This source may not offer video-on-demand.</p>
          </div>
        </div>
      ) : (
        <div className="poster-grid">
          {filtered.slice(0, 400).map((c) => (
            <button
              key={c.id}
              className="focusable poster-card"
              onClick={() => void play(c.id, filtered.map((f) => f.id))}
            >
              <div className="art">
                {c.logo ? <img src={c.logo} loading="lazy" /> : <span className="ph-txt">{c.name.slice(0, 2).toUpperCase()}</span>}
              </div>
              <div className="cap">{c.name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
