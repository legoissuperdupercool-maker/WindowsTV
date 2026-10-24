import { useEffect, useMemo, useState } from 'react'
import { activeProfile, cachedCategories, useStore } from '../store'
import { countryFlag, countryLabel, countryOfVod } from '../country'
import { cleanCategory } from './nf'
import type { Category, Channel } from '@shared/types'

/**
 * Movies & series: which countries/languages and categories show on Home, the
 * Movies/Series pages and in recommendations. Search still finds everything.
 * Saved per profile.
 */
export function VodFilterSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const profile = useStore(activeProfile)
  const { currentSourceId, fetchList, setChannelPrefs } = useStore()
  const [data, setData] = useState<{ channels: Channel[]; cats: Array<Category & { kind: string }> } | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void Promise.all([fetchList('movie'), fetchList('series')]).then(([m, s]) =>
      setData({
        channels: [...m, ...s],
        cats: [
          ...cachedCategories(currentSourceId ?? undefined, 'movie').map((c) => ({ ...c, kind: 'Movies' })),
          ...cachedCategories(currentSourceId ?? undefined, 'series').map((c) => ({ ...c, kind: 'Series' }))
        ]
      })
    )
  }, [currentSourceId, fetchList])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const hiddenCountries = profile?.vodHiddenCountries ?? []
  const hiddenCats = profile?.vodHiddenCategories ?? []

  // Countries / languages found in the catalogue, biggest first.
  const countries = useMemo(() => {
    if (!data) return []
    const names = new Map(data.cats.map((c) => [c.id, c.name]))
    const byCat = new Map<string, string | undefined>()
    const counts = new Map<string, number>()
    for (const c of data.channels) {
      const key = c.group ?? ''
      if (!byCat.has(key)) byCat.set(key, c.group ? countryOfVod(names.get(c.group), '') : undefined)
      const code = byCat.get(key) ?? countryOfVod(undefined, c.name)
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count }))
  }, [data])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of data?.channels ?? []) if (c.group) m.set(c.group, (m.get(c.group) ?? 0) + 1)
    return m
  }, [data])
  const q = query.trim().toLowerCase()
  const cats = (data?.cats ?? []).filter((c) => (counts.get(c.id) ?? 0) > 0 && (!q || c.name.toLowerCase().includes(q)))

  const toggleCountry = (code: string): void =>
    void setChannelPrefs({
      vodHiddenCountries: hiddenCountries.includes(code) ? hiddenCountries.filter((c) => c !== code) : [...hiddenCountries, code]
    })
  const toggleCat = (id: string): void =>
    void setChannelPrefs({ vodHiddenCategories: hiddenCats.includes(id) ? hiddenCats.filter((c) => c !== id) : [...hiddenCats, id] })

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet filter-sheet" role="dialog" aria-label="What shows for movies and series" data-modal>
        <h2>What shows for movies & series</h2>
        <p className="filter-hint">
          Hidden countries and categories stay out of Home, the Movies and Series pages and your recommendations.
          Search still finds everything. Saved for {profile?.name ?? 'this profile'}.
        </p>

        <div className="field-label filter-row">
          <span>Countries & languages</span>
          {hiddenCountries.length > 0 && (
            <button className="focusable link-btn" onClick={() => void setChannelPrefs({ vodHiddenCountries: [] })}>
              Show all ({hiddenCountries.length} hidden)
            </button>
          )}
        </div>
        {!data ? (
          <p className="filter-hint">Reading your movies and series…</p>
        ) : countries.length === 0 ? (
          <p className="filter-hint">Your provider’s categories don’t name countries or languages.</p>
        ) : (
          <div className="filter-countries">
            {countries.map((c) => {
              const hidden = hiddenCountries.includes(c.code)
              return (
                <button
                  key={c.code}
                  className={`focusable chip vod-chip ${hidden ? 'off' : 'on'}`}
                  title={hidden ? 'Hidden. Click to show again.' : 'Click to hide'}
                  onClick={() => toggleCountry(c.code)}
                >
                  {countryFlag(c.code)} {countryLabel(c.code)} <span className="chip-count">{c.count}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="field-label filter-row">
          <span>Categories</span>
          {hiddenCats.length > 0 && (
            <button className="focusable link-btn" onClick={() => void setChannelPrefs({ vodHiddenCategories: [] })}>
              Show all ({hiddenCats.length} hidden)
            </button>
          )}
        </div>
        <div className="search-bar">
          <input placeholder="Find a category…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="filter-cats">
          {cats.map((c) => {
            const on = !hiddenCats.includes(c.id)
            return (
              <button key={`${c.kind}:${c.id}`} className={`focusable switch-row ${on ? 'on' : ''}`} onClick={() => toggleCat(c.id)}>
                <span className="switch-knob" />
                <b>{cleanCategory(c.name)}</b>
                <small className="vod-cat-kind">
                  {c.kind} · {counts.get(c.id) ?? 0}
                </small>
              </button>
            )
          })}
        </div>

        <div className="sheet-actions">
          <span className="spacer" />
          <button className="focusable btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
