import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import type { Programme } from '@shared/types'

const PX_PER_MIN = 6
const WINDOW_HOURS = 4
const CH_WIDTH = 200

export function Guide(): JSX.Element {
  const { channels, currentSourceId, loadCatalog, play } = useStore()
  const [grid, setGrid] = useState<Record<string, Programme[]>>({})
  const [, force] = useState(0)

  useEffect(() => {
    void loadCatalog('live', false)
  }, [loadCatalog, currentSourceId])

  // Window start: floor to the previous half hour.
  const from = useMemo(() => {
    const d = new Date()
    d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0)
    return d.getTime()
  }, [])
  const to = from + WINDOW_HOURS * 3600_000
  const widthPx = WINDOW_HOURS * 60 * PX_PER_MIN

  const rows = channels.slice(0, 80)

  useEffect(() => {
    if (!currentSourceId || rows.length === 0) return
    void window.api.epg
      .grid(
        currentSourceId,
        rows.map((c) => ({ id: c.id, epgChannelId: c.epgChannelId, name: c.name })),
        from,
        to
      )
      .then((r) => r.data && setGrid(r.data))
  }, [currentSourceId, channels.length, from])

  // Tick the now-line every minute.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  if (!currentSourceId)
    return (
      <div className="page">
        <div className="empty">
          <div>
            <div className="big">🗓️</div>
            <h2>No source</h2>
          </div>
        </div>
      </div>
    )

  const timeCells: number[] = []
  for (let t = from; t < to; t += 30 * 60_000) timeCells.push(t)
  const nowX = CH_WIDTH + ((Date.now() - from) / 60_000) * PX_PER_MIN

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <h1 className="section-title">TV Guide</h1>
      <div className="guide-wrap">
        <div className="guide-scroll">
          <div style={{ width: CH_WIDTH + widthPx, position: 'relative' }}>
            {/* time header */}
            <div className="guide-head">
              <div className="corner" />
              {timeCells.map((t) => (
                <div key={t} className="guide-timecell" style={{ width: 30 * PX_PER_MIN, flex: '0 0 auto' }}>
                  {new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              ))}
            </div>

            {/* now line */}
            {Date.now() >= from && Date.now() <= to && (
              <div className="now-line" style={{ left: nowX }} />
            )}

            {/* rows */}
            {rows.map((c) => {
              const progs = (grid[c.id] ?? []).filter((p) => p.stop > from && p.start < to)
              return (
                <div className="guide-row" key={c.id}>
                  <div className="guide-ch">
                    {c.logo ? <img src={c.logo} loading="lazy" /> : null}
                    <span className="nm">{c.name}</span>
                  </div>
                  <div className="guide-progs" style={{ width: widthPx }}>
                    {progs.length === 0 ? (
                      <div style={{ padding: '10px 14px', color: 'var(--text-faint)', fontSize: 12 }}>
                        No guide data
                      </div>
                    ) : (
                      progs.map((p) => {
                        const left = Math.max(0, ((p.start - from) / 60_000) * PX_PER_MIN)
                        const right = Math.min(widthPx, ((p.stop - from) / 60_000) * PX_PER_MIN)
                        return (
                          <button
                            key={`${p.start}-${p.title}`}
                            className="focusable guide-prog"
                            onClick={() => void play(c.id, rows.map((r) => r.id))}
                            style={{
                              position: 'absolute',
                              left,
                              width: Math.max(28, right - left),
                              top: 0,
                              bottom: 0
                            }}
                          >
                            <div className="pt">{p.title}</div>
                            <div className="pw">
                              {new Date(p.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
