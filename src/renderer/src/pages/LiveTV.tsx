import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { getFocused } from '../hooks/useSpatialNavigation'
import { Icon } from '../components/Icon'
import type { EpgNowNext, Programme } from '@shared/types'

const ALL = '__all__'
const FAV = '__fav__'

export function LiveTV(): JSX.Element {
  const { channels, categories, currentSourceId, settings, play, toggleFavorite, loadCatalog } =
    useStore()
  const [cat, setCat] = useState<string>(ALL)
  const [query, setQuery] = useState('')
  const [nowNext, setNowNext] = useState<Record<string, EpgNowNext>>({})
  const favorites = settings?.favorites ?? []

  // Live channels only on this page.
  useEffect(() => {
    void loadCatalog('live', false)
  }, [loadCatalog, currentSourceId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return channels.filter((c) => {
      if (cat === FAV && !favorites.includes(c.id)) return false
      if (cat !== ALL && cat !== FAV && c.group !== cat) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [channels, cat, query, favorites])

  // Fetch EPG now/next for the visible channels in one batched call.
  const reqRef = useRef(0)
  useEffect(() => {
    if (!currentSourceId || filtered.length === 0) return
    const subset = filtered.slice(0, 300)
    const from = Date.now() - 2 * 3600_000
    const to = Date.now() + 6 * 3600_000
    const myReq = ++reqRef.current
    const handle = setTimeout(async () => {
      const res = await window.api.epg.grid(
        currentSourceId,
        subset.map((c) => ({ id: c.id, epgChannelId: c.epgChannelId, name: c.name })),
        from,
        to
      )
      if (myReq !== reqRef.current || !res.data) return
      const map: Record<string, EpgNowNext> = {}
      const now = Date.now()
      for (const [id, progs] of Object.entries(res.data)) {
        map[id] = deriveNowNext(progs as Programme[], now)
      }
      setNowNext(map)
    }, 120)
    return () => clearTimeout(handle)
  }, [filtered, currentSourceId])

  // Keyboard affordances: F = favourite, I = (reserved) info on the focused card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === 'f') {
        const id = getFocused()?.getAttribute('data-channel-id')
        if (id) void toggleFavorite(id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFavorite])

  if (!currentSourceId) return <NoSource />

  const cats = [
    { id: ALL, name: 'All channels', count: channels.length },
    { id: FAV, name: '★ Favorites', count: favorites.length },
    ...categories.map((c) => ({
      id: c.id,
      name: c.name,
      count: channels.filter((ch) => ch.group === c.id).length
    }))
  ]

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <div className="livetv">
        <div className="cat-rail">
          {cats.map((c) => (
            <button
              key={c.id}
              className={`focusable cat-item ${cat === c.id ? 'active' : ''}`}
              onClick={() => setCat(c.id)}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.name}
              </span>
              <span className="count">{c.count}</span>
            </button>
          ))}
        </div>

        <div className="channel-pane">
          <div className="search-bar">
            <input
              placeholder="Search channels…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {filtered.length === 0 ? (
            <div className="empty">
              <div>
                <div className="big">📺</div>
                <h2>No channels</h2>
                <p>{channels.length ? 'Try a different category or search.' : 'Loading…'}</p>
              </div>
            </div>
          ) : (
            <div className="channel-grid">
              {filtered.slice(0, 600).map((c) => {
                const nn = nowNext[c.id]
                const fav = favorites.includes(c.id)
                return (
                  <button
                    key={c.id}
                    className="focusable media-card"
                    data-channel-id={c.id}
                    onClick={() => void play(c.id, filtered.map((f) => f.id))}
                  >
                    <div className="art">
                      {c.logo ? (
                        <img src={c.logo} loading="lazy" />
                      ) : (
                        <div className="logo-ph">{c.name.slice(0, 2).toUpperCase()}</div>
                      )}
                      {c.type === 'live' && <span className="badge-live">LIVE</span>}
                      {c.number ? <span className="chno">{c.number}</span> : null}
                      {fav && (
                        <span className="fav-pin">
                          <Icon name="star" size={16} />
                        </span>
                      )}
                    </div>
                    <div className="body">
                      <div className="title">{c.name}</div>
                      <div className="sub">{nn?.now ? nn.now.title : 'No guide data'}</div>
                      {nn?.now && <ProgressBar p={nn.now} />}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          <div className="hint-line">
            Press <b>F</b> to favorite the highlighted channel · Enter to watch
          </div>
        </div>
      </div>
    </div>
  )
}

function ProgressBar({ p }: { p: Programme }): JSX.Element | null {
  const now = Date.now()
  const pct = Math.max(0, Math.min(100, ((now - p.start) / (p.stop - p.start)) * 100))
  return (
    <div className="epg-progress">
      <span style={{ width: `${pct}%` }} />
    </div>
  )
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

function NoSource(): JSX.Element {
  const navigate = useStore((s) => s.navigate)
  return (
    <div className="page">
      <div className="empty">
        <div>
          <div className="big">🔌</div>
          <h2>No source selected</h2>
          <p>Add an IPTV provider to see your channels.</p>
          <button
            className="focusable ghost-btn primary"
            style={{ marginTop: 14 }}
            onClick={() => navigate('settings')}
          >
            Go to Settings
          </button>
        </div>
      </div>
    </div>
  )
}
