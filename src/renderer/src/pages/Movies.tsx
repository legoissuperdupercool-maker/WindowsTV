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

  if (!currentSourceId) return <div className="page"><div className="empty"><div><div className="big">🎬</div><h2>No source</h2></div></div></div>

  return (
    <div className="page">
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
              onClick={() => void play(c.id, filtered.map((f) => f.id))}
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
                  <img
                    src={c.logo}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
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
