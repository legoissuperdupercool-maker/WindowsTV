import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { activeProfile, useStore } from '../store'
import { ChannelFilterSheet, CountryChips, SORT_LABELS } from '../components/ChannelFilter'
import { CatalogStatus } from '../components/CatalogStatus'
import { Initials } from '../components/Initials'
import { FadeImg } from '../components/FadeImg'
import { getFocused } from '../hooks/useSpatialNavigation'
import { useProgressive } from '../hooks/useProgressive'
import { Icon } from '../components/Icon'
import type { Channel, ChannelSort, EpgNowNext, Programme } from '@shared/types'

const ALL = '__all__'
const FAV = '__fav__'

export function LiveTV(): JSX.Element {
  const { channels, categories, currentSourceId, settings, play, toggleFavorite, loadCatalog } =
    useStore()
  const [cat, setCat] = useState<string>(ALL)
  const [query, setQuery] = useState('')
  const [nowNext, setNowNext] = useState<Record<string, EpgNowNext>>({})
  const favorites = useMemo(() => settings?.favorites ?? [], [settings?.favorites])
  const profile = useStore(activeProfile)
  const setChannelPrefs = useStore((s) => s.setChannelPrefs)
  const [showFilters, setShowFilters] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; channel?: Channel; categoryId?: string } | null>(null)
  const sort = profile?.channelSort ?? 'provider'
  const hiddenCount = (profile?.hiddenCategories?.length ?? 0) + (profile?.hiddenChannels?.length ?? 0)

  const hideChannel = (id: string): void =>
    void setChannelPrefs({ hiddenChannels: [...(profile?.hiddenChannels ?? []), id] })
  const hideCategory = (id: string): void => {
    if (cat === id) setCat(ALL)
    void setChannelPrefs({ hiddenCategories: [...(profile?.hiddenCategories ?? []), id] })
  }
  const nextSort = (): void => {
    const order: ChannelSort[] = ['provider', 'name', 'number']
    void setChannelPrefs({ channelSort: order[(order.indexOf(sort) + 1) % order.length] })
  }

  // Live channels only on this page.
  useEffect(() => {
    void loadCatalog('live', false)
  }, [loadCatalog, currentSourceId])

  // Search runs on a deferred copy of the query so typing never stutters.
  const deferredQuery = useDeferredValue(query)
  const favSet = useMemo(() => new Set(favorites), [favorites])
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return channels.filter((c) => {
      if (cat === FAV && !favSet.has(c.id)) return false
      if (cat !== ALL && cat !== FAV && c.group !== cat) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [channels, cat, deferredQuery, favSet])

  // Category counts in a single pass (was: one full scan per category).
  const groupCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of channels) if (c.group) m.set(c.group, (m.get(c.group) ?? 0) + 1)
    return m
  }, [channels])

  const { visible, sentinelRef } = useProgressive(filtered)

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
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const id = getFocused()?.getAttribute('data-channel-id')
      if (e.key.toLowerCase() === 'f' && id) void toggleFavorite(id)
      if (e.key.toLowerCase() === 'h' && id) hideChannel(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFavorite, profile]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  if (!currentSourceId) return <NoSource />

  const cats = [
    { id: ALL, name: 'All channels', count: channels.length },
    { id: FAV, name: '★ Favorites', count: favorites.length },
    ...categories.map((c) => ({
      id: c.id,
      name: c.name,
      count: groupCounts.get(c.id) ?? 0
    }))
  ]

  return (
    <div className="page fixed">
      <div className="livetv">
        <div className="cat-rail">
          {cats.map((c) => (
            <button
              key={c.id}
              className={`focusable cat-item ${cat === c.id ? 'active' : ''}`}
              onClick={() => setCat(c.id)}
              onContextMenu={(e) => {
                if (c.id === ALL || c.id === FAV) return
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, categoryId: c.id })
              }}
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
            <button className="focusable ghost-btn" onClick={nextSort} title="Change the order">
              ↕ {SORT_LABELS[sort]}
            </button>
            {settings?.multiView && (
              <button className="focusable ghost-btn" title="Watch 2 or 4 channels at once" onClick={() => useStore.getState().openMultiView()}>
                <Icon name="grid" size={18} /> Multi-view
              </button>
            )}
            <button
              className={`focusable ghost-btn ${profile?.countries?.length ? 'primary' : ''}`}
              onClick={() => setShowFilters(true)}
            >
              Filter{hiddenCount ? ` · ${hiddenCount} hidden` : ''}
            </button>
          </div>
          <CountryChips />

          {filtered.length === 0 ? (
            channels.length === 0 ? (
              <CatalogStatus what="channels" />
            ) : (
              <div className="catalog-status">
                <h2>No matches</h2>
                <p>Try a different category or search.</p>
              </div>
            )
          ) : (
            <div className="channel-grid">
              {visible.map((c) => {
                const nn = nowNext[c.id]
                const fav = favorites.includes(c.id)
                return (
                  <button
                    key={c.id}
                    className="focusable media-card"
                    data-channel-id={c.id}
                    onClick={() => void play(c.id, filtered.map((f) => f.id))}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, channel: c })
                    }}
                  >
                    <div className="art">
                      {c.logo ? (
                        <FadeImg src={c.logo} alt="" />
                      ) : (
                        <Initials name={c.name} />
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
              <div ref={sentinelRef} style={{ gridColumn: '1 / -1', height: 1 }} />
            </div>
          )}
          <div className="hint-line">
            Press <b>F</b> to favorite the highlighted channel · <b>H</b> to hide it · right-click for more · Enter to watch
          </div>
        </div>
      </div>
      {showFilters && <ChannelFilterSheet onClose={() => setShowFilters(false)} />}
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menu.channel && (
            <>
              <button onClick={() => (void toggleFavorite(menu.channel!.id), setMenu(null))}>
                <Icon name="star" size={16} /> {favorites.includes(menu.channel.id) ? 'Remove from favourites' : 'Add to favourites'}
              </button>
              <button onClick={() => (hideChannel(menu.channel!.id), setMenu(null))}>
                <Icon name="close" size={16} /> Hide channel
              </button>
              {menu.channel.group && (
                <button onClick={() => (hideCategory(menu.channel!.group!), setMenu(null))}>
                  <Icon name="close" size={16} /> Hide its category
                </button>
              )}
            </>
          )}
          {menu.categoryId && (
            <button onClick={() => (hideCategory(menu.categoryId!), setMenu(null))}>
              <Icon name="close" size={16} /> Hide this category
            </button>
          )}
        </div>
      )}
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
