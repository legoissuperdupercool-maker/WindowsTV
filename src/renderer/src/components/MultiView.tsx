import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'
import { FadeImg } from './FadeImg'
import { Initials } from './Initials'
import type { Channel, PlaybackState } from '@shared/types'

/**
 * Multi-view: 2 or 4 live channels side by side. The tiles are holes in this
 * screen; each one has its own mpv drawing behind it. Only the selected tile
 * has sound (click a tile or press 1–4).
 */
export function MultiViewScreen({ initial }: { initial: string[] }): JSX.Element {
  const { closeMultiView, fetchList, play } = useStore()
  const [layout, setLayout] = useState<2 | 4>(initial.length > 2 ? 4 : 2)
  const [cells, setCells] = useState<Array<string | null>>(() => [...initial, null, null, null, null].slice(0, 4))
  const [states, setStates] = useState<Record<number, PlaybackState>>({})
  const [audio, setAudio] = useState(0)
  const [picking, setPicking] = useState<number | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [ready, setReady] = useState(false)
  const tileRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    void fetchList('live').then(setChannels)
    return window.api.multiview.onState(({ index, state }) => setStates((s) => ({ ...s, [index]: state })))
  }, [fetchList])

  // Players for the layout, then the channels that were already chosen.
  useEffect(() => {
    let alive = true
    setReady(false)
    void window.api.multiview.layout(layout).then(() => {
      if (!alive) return
      setReady(true)
      void window.api.multiview.audio(Math.min(audio, layout - 1))
    })
    return () => {
      alive = false
    }
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

  const loaded = useRef<Array<string | null>>([])
  useEffect(() => {
    if (!ready) return
    cells.slice(0, layout).forEach((id, i) => {
      if (loaded.current[i] === id) return
      loaded.current[i] = id
      if (id) void window.api.multiview.load(i, id)
      else void window.api.multiview.clear(i)
    })
  }, [ready, cells, layout])
  useEffect(() => {
    // Tiles dropped by switching 4 → 2 must be reloaded if they come back.
    loaded.current = loaded.current.slice(0, layout)
  }, [layout])

  // Tell the main process where each tile is on screen.
  const sendRegions = useCallback(() => {
    const regions = tileRefs.current.slice(0, layout).map((el) => {
      const r = el?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, visible: picking == null } : { x: 0, y: 0, width: 0, height: 0, visible: false }
    })
    void window.api.multiview.regions(regions)
  }, [layout, picking])
  useLayoutEffect(() => {
    sendRegions()
    window.addEventListener('resize', sendRegions)
    return () => window.removeEventListener('resize', sendRegions)
  }, [sendRegions, ready])

  const selectAudio = (i: number): void => {
    setAudio(i)
    void window.api.multiview.audio(i)
  }
  const setCell = (i: number, id: string | null): void => setCells((c) => c.map((x, j) => (j === i ? id : x)))

  // 1–4 picks the tile with sound.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (picking != null) return
      const n = Number(e.key)
      if (n >= 1 && n <= layout) selectAudio(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels])
  const watchFull = (id: string): void => {
    closeMultiView()
    void play(id)
  }

  return (
    <div className="mv-root">
      <div className="mv-bar">
        <div className="mv-title">
          <Icon name="grid" size={22} /> Multi-view
        </div>
        <div className="mv-layouts">
          {([2, 4] as const).map((n) => (
            <button key={n} className={`focusable chip ${layout === n ? 'on' : ''}`} onClick={() => setLayout(n)}>
              {n} channels
            </button>
          ))}
        </div>
        <span className="mv-hint">Click a channel for its sound · 1–{layout} · Esc closes</span>
        <button className="focusable tbtn" title="Close multi-view" onClick={closeMultiView}>
          <Icon name="close" />
        </button>
      </div>
      <div className={`mv-grid mv-${layout}`}>
        {Array.from({ length: layout }, (_, i) => {
          const id = cells[i]
          const ch = id ? byId.get(id) : undefined
          const st = states[i]
          const loading = id && (!st || st.status === 'loading' || st.status === 'buffering')
          return (
            <div
              key={i}
              ref={(el) => (tileRefs.current[i] = el)}
              className={`mv-tile ${audio === i ? 'audio' : ''} ${id ? '' : 'empty'}`}
              onClick={() => id && selectAudio(i)}
              onDoubleClick={() => id && watchFull(id)}
            >
              {!id ? (
                <button className="focusable mv-add" onClick={() => setPicking(i)}>
                  <Icon name="add" size={34} />
                  <span>Add a channel</span>
                </button>
              ) : (
                <>
                  <div className="mv-label">
                    {audio === i && <Icon name="volume" size={18} />}
                    <span>{ch?.name ?? st?.title ?? 'Channel'}</span>
                  </div>
                  {loading && <div className="spinner mv-spin" />}
                  {st?.status === 'error' && <div className="mv-error">{st.error ?? 'Couldn’t play this channel.'}</div>}
                  <div className="mv-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="focusable tbtn" title="Change channel" onClick={() => setPicking(i)}>
                      <Icon name="edit" size={20} />
                    </button>
                    <button className="focusable tbtn" title="Watch full screen" onClick={() => watchFull(id)}>
                      <Icon name="fullscreen" size={20} />
                    </button>
                    <button className="focusable tbtn" title="Remove" onClick={() => setCell(i, null)}>
                      <Icon name="close" size={20} />
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      {picking != null && (
        <ChannelPicker
          channels={channels}
          onPick={(c) => {
            setCell(picking, c.id)
            if (!cells.some(Boolean)) selectAudio(picking)
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}

function ChannelPicker({ channels, onPick, onClose }: { channels: Channel[]; onPick: (c: Channel) => void; onClose: () => void }): JSX.Element {
  const settings = useStore((s) => s.settings)
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
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
  const fav = new Set(settings?.favorites ?? [])
  const recents = settings?.recents ?? []
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hits = needle ? channels.filter((c) => c.name.toLowerCase().includes(needle)) : channels
    const score = (c: Channel): number => (fav.has(c.id) ? 2 : 0) + (recents.includes(c.id) ? 1 : 0)
    return [...hits].sort((a, b) => score(b) - score(a)).slice(0, 120)
  }, [q, channels]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="search-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-panel">
        <div className="search-head">
          <Icon name="search" size={26} />
          <input ref={input} className="search-input" placeholder="Find a channel" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="focusable icon-btn" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="search-results">
          <div className="search-section">{q ? 'Channels' : 'Favourites and recent first'}</div>
          <div className="search-channels">
            {list.map((c) => (
              <button key={c.id} className="focusable search-channel" onClick={() => onPick(c)}>
                <span className="sc-logo">{c.logo ? <FadeImg src={c.logo} alt="" /> : <Initials name={c.name} />}</span>
                <span className="sc-name">
                  {c.number ? <small>{c.number}</small> : null}
                  {c.name}
                </span>
                {fav.has(c.id) && <Icon name="star" size={16} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
