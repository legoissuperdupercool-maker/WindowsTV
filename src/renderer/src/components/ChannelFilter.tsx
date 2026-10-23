import { useEffect, useMemo, useState } from 'react'
import { activeProfile, useStore } from '../store'
import { countriesIn } from '../contentFilter'
import { OTHER, countryFlag, countryLabel } from '../country'
import { Icon } from './Icon'
import type { ChannelSort } from '@shared/types'

export const SORT_LABELS: Record<ChannelSort, string> = {
  provider: 'Provider order',
  name: 'Name (A–Z)',
  number: 'Channel number'
}

/** Countries in the whole live list (also ones the profile filtered out). */
export function useLiveCountries(): Array<{ code: string; count: number }> {
  const rawList = useStore((s) => s.rawList)
  const channels = useStore((s) => s.channels)
  const raw = rawList('live')
  // `channels` changes whenever the list (re)loads, so the memo follows it.
  return useMemo(() => (raw ? countriesIn(raw) : []), [raw, channels]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Quick country switches above the channel grid (biggest first). */
export function CountryChips(): JSX.Element | null {
  const profile = useStore(activeProfile)
  const setChannelPrefs = useStore((s) => s.setChannelPrefs)
  const all = useLiveCountries()
  const selected = profile?.countries ?? []
  if (all.length < 2 && !selected.length) return null
  const top = all.slice(0, 12).map((c) => c.code)
  const codes = [...new Set([...selected, ...top])].sort(
    (a, b) => all.findIndex((c) => c.code === a) - all.findIndex((c) => c.code === b)
  )
  const toggle = (code: string): void => {
    const next = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]
    void setChannelPrefs({ countries: next })
  }
  return (
    <div className="country-chips">
      <button className={`focusable chip ${selected.length ? '' : 'on'}`} onClick={() => void setChannelPrefs({ countries: [] })}>
        All countries
      </button>
      {codes.map((code) => (
        <button key={code} className={`focusable chip ${selected.includes(code) ? 'on' : ''}`} onClick={() => toggle(code)}>
          {code === OTHER ? 'Other' : `${countryFlag(code)} ${countryLabel(code)}`}
        </button>
      ))}
    </div>
  )
}

/** Countries, sort order, hidden categories and channels (saved per profile). */
export function ChannelFilterSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const profile = useStore(activeProfile)
  const setChannelPrefs = useStore((s) => s.setChannelPrefs)
  const raw = useStore((s) => s.rawList)('live')
  const countries = useLiveCountries()
  const [catQuery, setCatQuery] = useState('')

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

  const selected = profile?.countries ?? []
  const hiddenCats = profile?.hiddenCategories ?? []
  const hiddenChannels = profile?.hiddenChannels ?? []
  const sort = profile?.channelSort ?? 'provider'
  const cats = (raw?.categories ?? []).filter((c) => !catQuery || c.name.toLowerCase().includes(catQuery.toLowerCase()))
  const hiddenList = useMemo(() => {
    const ids = new Set(hiddenChannels)
    return (raw?.channels ?? []).filter((c) => ids.has(c.id))
  }, [raw, hiddenChannels])

  const toggleCountry = (code: string): void =>
    void setChannelPrefs({ countries: selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code] })
  const toggleCat = (id: string): void =>
    void setChannelPrefs({ hiddenCategories: hiddenCats.includes(id) ? hiddenCats.filter((c) => c !== id) : [...hiddenCats, id] })

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet filter-sheet" role="dialog" aria-label="Filter channels">
        <h2>Filter channels</h2>

        <div className="field-label">Countries</div>
        <p className="filter-hint">
          Pick one or more to only see their channels. ello reads the country from your provider’s category names
          (like “NL | Sport” or “UK: News”).
        </p>
        <div className="filter-countries">
          <button className={`focusable chip ${selected.length ? '' : 'on'}`} onClick={() => void setChannelPrefs({ countries: [] })}>
            🌐 All countries
          </button>
          {countries.map((c) => (
            <button key={c.code} className={`focusable chip ${selected.includes(c.code) ? 'on' : ''}`} onClick={() => toggleCountry(c.code)}>
              {countryFlag(c.code)} {countryLabel(c.code)} <span className="chip-count">{c.count}</span>
            </button>
          ))}
        </div>

        <div className="field-label">Sort channels</div>
        <div className="filter-countries">
          {(Object.keys(SORT_LABELS) as ChannelSort[]).map((s) => (
            <button key={s} className={`focusable chip ${sort === s ? 'on' : ''}`} onClick={() => void setChannelPrefs({ channelSort: s })}>
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="field-label filter-row">
          <span>Categories</span>
          {hiddenCats.length > 0 && (
            <button className="focusable link-btn" onClick={() => void setChannelPrefs({ hiddenCategories: [] })}>
              Show all ({hiddenCats.length} hidden)
            </button>
          )}
        </div>
        <div className="search-bar">
          <input placeholder="Find a category…" value={catQuery} onChange={(e) => setCatQuery(e.target.value)} />
        </div>
        <div className="filter-cats">
          {cats.map((c) => {
            const on = !hiddenCats.includes(c.id)
            return (
              <button key={c.id} className={`focusable switch-row ${on ? 'on' : ''}`} onClick={() => toggleCat(c.id)}>
                <span className="switch-knob" />
                <b>{c.name}</b>
              </button>
            )
          })}
        </div>

        {hiddenList.length > 0 && (
          <>
            <div className="field-label">Hidden channels</div>
            <div className="filter-cats">
              {hiddenList.map((c) => (
                <button
                  key={c.id}
                  className="focusable switch-row"
                  onClick={() => void setChannelPrefs({ hiddenChannels: hiddenChannels.filter((id) => id !== c.id) })}
                >
                  <Icon name="add" size={18} />
                  <b>Show {c.name}</b>
                </button>
              ))}
            </div>
          </>
        )}

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
