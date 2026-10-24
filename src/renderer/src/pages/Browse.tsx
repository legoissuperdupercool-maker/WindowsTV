import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { activeProfile, useStore } from '../store'
import { CatalogStatus } from '../components/CatalogStatus'
import { useProgressive } from '../hooks/useProgressive'
import { Billboard, PosterCard, Row, Top10Card, cleanCategory, metaStr, type BillboardItem } from '../components/nf'
import { cleanTitle } from '../recommend'
import { newestFirst, shelfFilter } from '../contentFilter'
import { VodFilterSheet } from '../components/VodFilter'
import type { Channel, ListItem } from '@shared/types'


/**
 * Movies / Series, Netflix style: a billboard, then "New", Top 10 and one row
 * per category. Picking a genre (or searching) switches to a poster grid.
 */
function BrowsePage({ type }: { type: 'movie' | 'series' }): JSX.Element {
  const { channels, categories, currentSourceId, loadCatalog, openDetail } = useStore()
  const [genre, setGenre] = useState<string>('')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const label = type === 'movie' ? 'Movies' : 'Series'

  useEffect(() => {
    void loadCatalog(type, false)
    setGenre('')
    setQuery('')
  }, [loadCatalog, currentSourceId, type])

  const list = useMemo(() => channels.filter((c) => c.type === type), [channels, type])
  const sorted = useMemo(() => newestFirst(list), [list])
  // What the page features: everything except adult titles (those only show when their genre is picked).
  const me = useStore(activeProfile)
  const [filtering, setFiltering] = useState(false)
  const hiddenCount = (me?.vodHiddenCountries?.length ?? 0) + (me?.vodHiddenCategories?.length ?? 0)
  const shelf = useMemo(() => sorted.filter(shelfFilter(categories, me)), [sorted, categories, me])

  const groupRows = (items: Channel[]): Array<{ id: string; title: string; items: Channel[]; total: number }> => {
    const byGroup = new Map<string, Channel[]>()
    for (const c of items) if (c.group) (byGroup.get(c.group) ?? byGroup.set(c.group, []).get(c.group)!).push(c)
    return categories
      .filter((cat) => (byGroup.get(cat.id)?.length ?? 0) > 0)
      .map((cat) => ({ id: cat.id, title: cleanCategory(cat.name), items: byGroup.get(cat.id)!.slice(0, 30), total: byGroup.get(cat.id)!.length }))
      .sort((a, b) => b.total - a.total)
  }
  const rows = useMemo(() => groupRows(shelf), [shelf, categories])
  const genres = useMemo(() => groupRows(sorted), [sorted, categories])
  const [rowCount, setRowCount] = useState(8)
  useEffect(() => setRowCount(8), [type, currentSourceId])

  // Billboard: the newest with artwork (movie info for the first few).
  const [billboard, setBillboard] = useState<BillboardItem[]>([])
  useEffect(() => {
    if (!shelf.length) return
    let cancelled = false
    void (async () => {
      const items: BillboardItem[] = []
      for (const c of shelf.slice(0, 10)) {
        const info = type === 'movie' ? (await window.api.vod.info(c.sourceId, c.providerId)).data : null
        if (info?.backdrop || metaStr(c, 'backdrop') || info?.poster || c.logo) items.push({ channel: c, info, kicker: `New ${type === 'movie' ? 'film' : 'series'}` })
        if (items.length >= 5) break
      }
      items.sort((a, b) => Number(Boolean(b.info?.backdrop || metaStr(b.channel, 'backdrop'))) - Number(Boolean(a.info?.backdrop || metaStr(a.channel, 'backdrop'))))
      if (!cancelled) setBillboard(items)
    })()
    return () => {
      cancelled = true
    }
  }, [shelf.length, type, currentSourceId])

  const q = deferredQuery.trim().toLowerCase()
  const gridItems = useMemo(
    () => (genre || q ? sorted.filter((c) => (!genre || c.group === genre) && (!q || c.name.toLowerCase().includes(q))) : []),
    [sorted, genre, q]
  )
  const { visible, sentinelRef } = useProgressive(gridItems, 48)

  if (!currentSourceId)
    return (
      <div className="page pad">
        <div className="empty">
          <div>
            <h2>No source</h2>
            <p>Add your IPTV provider in Settings.</p>
          </div>
        </div>
      </div>
    )

  const header = (
    <div className="nf-browse-head">
      <h1>{label}</h1>
      <select className="nf-genre" value={genre} onChange={(e) => setGenre(e.target.value)}>
        <option value="">Genres</option>
        {genres.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title} ({r.total})
          </option>
        ))}
      </select>
      <input className="nf-filter" placeholder={`Search ${label.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      <button className="focusable nf-filter-btn" onClick={() => setFiltering(true)} title="Choose which countries and categories show">
        Filter {hiddenCount > 0 && <b>{hiddenCount}</b>}
      </button>
      {(genre || q) && (
        <button className="focusable nf-clear" onClick={() => (setGenre(''), setQuery(''))}>
          Clear
        </button>
      )}
      {filtering && <VodFilterSheet onClose={() => setFiltering(false)} />}
    </div>
  )

  if (list.length === 0)
    return (
      <div className="page nf-page padded">
        {header}
        <CatalogStatus what={type === 'movie' ? 'movies' : 'series'} />
      </div>
    )

  if (genre || q)
    return (
      <div className="page nf-page padded">
        {header}
        <div className="nf-grid-title">
          {genre ? genres.find((r) => r.id === genre)?.title : `Results for “${deferredQuery.trim()}”`} · {gridItems.length}
        </div>
        <div className="nf-grid">
          {visible.map((c) => (
            <PosterCard key={c.id} c={c} onOpen={openDetail} wide={false} />
          ))}
          <div ref={sentinelRef} style={{ gridColumn: '1 / -1', height: 1 }} />
        </div>
      </div>
    )

  return (
    <div
      className="page nf-page"
      onScroll={(e) => {
        const el = e.currentTarget
        if (el.scrollTop + el.clientHeight > el.scrollHeight - 900 && rowCount < rows.length) setRowCount((n) => n + 6)
      }}
    >
      <Billboard items={billboard} />
      <div className="nf-browse-float">{header}</div>
      <div className="nf-rows">
        <Row title={`New ${label.toLowerCase()}`}>
          {shelf.slice(0, 30).map((c) => (
            <PosterCard key={c.id} c={c} onOpen={openDetail} />
          ))}
        </Row>
        {shelf.length >= 10 && (
          <Row title={`Top 10 ${label.toLowerCase()} this week`} className="top10">
            {shelf.slice(0, 10).map((c, n) => (
              <Top10Card key={c.id} c={c} n={n + 1} onOpen={openDetail} />
            ))}
          </Row>
        )}
        {rows.slice(0, rowCount).map((r) => (
          <Row key={r.id} title={r.title} onMore={() => setGenre(r.id)}>
            {r.items.map((c) => (
              <PosterCard key={c.id} c={c} onOpen={openDetail} />
            ))}
          </Row>
        ))}
      </div>
    </div>
  )
}

export function Movies(): JSX.Element {
  return <BrowsePage type="movie" />
}

export function Series(): JSX.Element {
  return <BrowsePage type="series" />
}

/** My List: everything this profile saved. */
export function MyList(): JSX.Element {
  const { currentSourceId, fetchList, openDetail } = useStore()
  const saved = useStore((s) => activeProfile(s)?.myList ?? [])
  const [all, setAll] = useState<Channel[]>([])
  useEffect(() => {
    void Promise.all([fetchList('movie'), fetchList('series')]).then(([m, s]) => setAll([...m, ...s]))
  }, [fetchList, currentSourceId])
  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all])
  const items = saved.filter((i) => i.sourceId === currentSourceId).map((i) => byId.get(i.key) ?? fromItem(i))
  return (
    <div className="page nf-page padded">
      <div className="nf-browse-head">
        <h1>My List</h1>
      </div>
      {items.length === 0 ? (
        <div className="nf-empty">
          <p>Nothing here yet.</p>
          <p className="dim">Use the + on any movie or series to save it here.</p>
        </div>
      ) : (
        <div className="nf-grid">
          {items.map((c) => (
            <PosterCard key={c.id} c={c} onOpen={openDetail} wide={false} />
          ))}
        </div>
      )}
    </div>
  )
}

function fromItem(i: ListItem): Channel {
  return { id: i.key, sourceId: i.sourceId, type: i.kind, providerId: i.key.split(':').pop() ?? '', name: cleanTitle(i.title), logo: i.poster, group: i.group, url: '' }
}
