import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { cleanTitle } from '../recommend'
import { FadeImg } from './FadeImg'
import { Initials } from './Initials'
import { Icon } from './Icon'
import type { Channel } from '@shared/types'

/** One search across live channels, movies and series. Opened with the search button, / or Ctrl+K. */

const RECENT_KEY = 'ello.recentSearches'

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
function saveRecent(q: string): void {
  const list = [q, ...loadRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/** Lowercase, no accents, no provider prefix ("NL | ", "EN - "). */
function norm(s: string): string {
  return cleanTitle(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

interface Indexed {
  c: Channel
  n: string
}

function rank(list: Indexed[], q: string, limit: number): Channel[] {
  const words = q.split(/\s+/).filter(Boolean)
  const scored: Array<{ c: Channel; s: number }> = []
  for (const it of list) {
    if (!words.every((w) => it.n.includes(w))) continue
    let s = 0
    if (it.n === q) s += 100
    else if (it.n.startsWith(q)) s += 50
    else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(it.n)) s += 25
    s -= it.n.length / 100
    scored.push({ c: it.c, s })
  }
  scored.sort((a, b) => b.s - a.s)
  const seen = new Set<string>()
  const out: Channel[] = []
  for (const { c } of scored) {
    const key = norm(c.name)
    if (c.type !== 'live' && seen.has(key)) continue // same title in 4K/HD/other copies
    seen.add(key)
    out.push(c)
    if (out.length >= limit) break
  }
  return out
}

export function SearchOverlay({ onClose }: { onClose: () => void }): JSX.Element {
  const { fetchList, play, openDetail, settings } = useStore()
  const [query, setQuery] = useState('')
  const [lists, setLists] = useState<Record<'live' | 'movie' | 'series', Indexed[]> | null>(null)
  const [recent, setRecent] = useState(loadRecent)
  const input = useRef<HTMLInputElement>(null)
  const deferred = useDeferredValue(query)

  useEffect(() => {
    input.current?.focus()
    let alive = true
    void Promise.all([fetchList('live'), fetchList('movie'), fetchList('series')]).then(([l, m, s]) => {
      if (!alive) return
      const idx = (cs: Channel[]): Indexed[] => cs.map((c) => ({ c, n: norm(c.name) }))
      setLists({ live: idx(l), movie: idx(m), series: idx(s) })
    })
    return () => {
      alive = false
    }
  }, [fetchList])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const q = norm(deferred.trim())
  const results = useMemo(() => {
    if (!lists || q.length < 2) return null
    return { live: rank(lists.live, q, 18), movie: rank(lists.movie, q, 24), series: rank(lists.series, q, 24) }
  }, [lists, q])
  const total = results ? results.live.length + results.movie.length + results.series.length : 0
  const favorites = new Set(settings?.favorites ?? [])

  const remember = (): void => {
    if (query.trim().length >= 2) {
      saveRecent(query.trim())
      setRecent(loadRecent())
    }
  }
  const openTitle = (c: Channel): void => {
    remember()
    onClose()
    openDetail(c)
  }
  const watch = (c: Channel): void => {
    remember()
    onClose()
    void play(c.id, results?.live.map((x) => x.id))
  }

  return (
    <div className="search-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-panel">
        <div className="search-head">
          <Icon name="search" size={26} />
          <input
            ref={input}
            className="search-input"
            placeholder="Search channels, movies and series"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') remember()
            }}
          />
          <button className="focusable icon-btn" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>

        {!lists && <div className="search-empty">Loading your lists…</div>}

        {lists && q.length < 2 && (
          <div className="search-recent">
            {recent.length > 0 ? (
              <>
                <div className="search-section">Recent searches</div>
                <div className="search-chips">
                  {recent.map((r) => (
                    <button key={r} className="focusable chip" onClick={() => setQuery(r)}>
                      <Icon name="history" size={16} /> {r}
                    </button>
                  ))}
                  <button
                    className="focusable chip"
                    onClick={() => {
                      localStorage.removeItem(RECENT_KEY)
                      setRecent([])
                    }}
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : (
              <div className="search-empty">
                Type at least two letters. Searches {lists.live.length.toLocaleString()} channels,{' '}
                {lists.movie.length.toLocaleString()} movies and {lists.series.length.toLocaleString()} series.
              </div>
            )}
          </div>
        )}

        {results && total === 0 && <div className="search-empty">Nothing found for “{deferred.trim()}”.</div>}

        {results && total > 0 && (
          <div className="search-results">
            {results.live.length > 0 && (
              <>
                <div className="search-section">Live TV · {results.live.length}</div>
                <div className="search-channels">
                  {results.live.map((c) => (
                    <button key={c.id} className="focusable search-channel" onClick={() => watch(c)}>
                      <span className="sc-logo">{c.logo ? <FadeImg src={c.logo} alt="" /> : <Initials name={c.name} />}</span>
                      <span className="sc-name">
                        {c.number ? <small>{c.number}</small> : null}
                        {c.name}
                      </span>
                      {favorites.has(c.id) && <Icon name="star" size={16} />}
                    </button>
                  ))}
                </div>
              </>
            )}
            {(['movie', 'series'] as const).map((kind) =>
              results[kind].length > 0 ? (
                <div key={kind}>
                  <div className="search-section">
                    {kind === 'movie' ? 'Movies' : 'Series'} · {results[kind].length}
                  </div>
                  <div className="search-posters">
                    {results[kind].map((c) => (
                      <button key={c.id} className="focusable poster-card" onClick={() => openTitle(c)}>
                        <div className="art">
                          <span className="ph-txt">{cleanTitle(c.name).slice(0, 2).toUpperCase()}</span>
                          {c.logo && <FadeImg src={c.logo} alt="" className="poster-img" />}
                        </div>
                        <div className="cap">{cleanTitle(c.name)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}
      </div>
    </div>
  )
}
