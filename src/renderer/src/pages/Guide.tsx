import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Initials } from '../components/Initials'
import { Icon } from '../components/Icon'
import { useProgressive } from '../hooks/useProgressive'
import type { Channel, Programme } from '@shared/types'

const PX_PER_MIN = 6
/** Hours of the past shown, so catch-up programmes can be replayed. */
const PAST_HOURS = 3
const FUTURE_HOURS = 5
/** Must match .guide-ch width in CSS. */
const CH_WIDTH = 210

export function Guide(): JSX.Element {
  const { channels, currentSourceId, loadCatalog, play, playCatchup } = useStore()
  const [grid, setGrid] = useState<Record<string, Programme[]>>({})
  const [, force] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadCatalog('live', false)
  }, [loadCatalog, currentSourceId])

  // Window: a few hours back (catch-up) to a few hours ahead, on half hours.
  const from = useMemo(() => {
    const d = new Date(Date.now() - PAST_HOURS * 3600_000)
    d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0)
    return d.getTime()
  }, [])
  const to = from + (PAST_HOURS + FUTURE_HOURS) * 3600_000
  const widthPx = (to - from) / 60_000 * PX_PER_MIN

  const live = useMemo(() => channels.filter((c) => c.type === 'live'), [channels])
  // Rows load a page at a time as you scroll down (big providers have thousands).
  const { visible: rows, sentinelRef } = useProgressive(live, 40)

  useEffect(() => {
    if (!currentSourceId || rows.length === 0) return
    const missing = rows.filter((c) => !(c.id in grid))
    if (!missing.length) return
    void window.api.epg
      .grid(currentSourceId, missing.map((c) => ({ id: c.id, epgChannelId: c.epgChannelId, name: c.name })), from, to)
      .then((r) => r.data && setGrid((g) => ({ ...g, ...r.data })))
  }, [currentSourceId, rows.length, from])

  // Start scrolled to "now" (past programmes are to the left), and publish the
  // scroll offset as --sx so titles of already-running programmes stay visible.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = Math.max(0, ((Date.now() - from) / 60_000) * PX_PER_MIN - 120)
    const sync = (): void => el.style.setProperty('--sx', `${el.scrollLeft}px`)
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    return () => el.removeEventListener('scroll', sync)
  }, [rows.length > 0])

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

  const now = Date.now()
  const timeCells: number[] = []
  for (let t = from; t < to; t += 30 * 60_000) timeCells.push(t)
  const nowX = CH_WIDTH + ((now - from) / 60_000) * PX_PER_MIN
  const queue = live.map((r) => r.id)

  const onProgramme = (c: Channel, p: Programme): void => {
    if (p.stop <= now && canReplay(c, p, now)) void playCatchup(c, p)
    else void play(c.id, queue)
  }

  return (
    <div className="page pad" style={{ display: 'flex', flexDirection: 'column' }}>
      <h1 className="section-title">TV Guide</h1>
      <div className="guide-wrap">
        <div className="guide-scroll" ref={scrollRef}>
          <div style={{ width: CH_WIDTH + widthPx, position: 'relative' }}>
            {/* time header */}
            <div className="guide-head">
              <div className="corner" />
              {timeCells.map((t) => (
                <div key={t} className="guide-timecell" style={{ width: 30 * PX_PER_MIN, flex: '0 0 auto' }}>
                  {new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
              ))}
            </div>

            {/* now line */}
            {now >= from && now <= to && <div className="now-line" style={{ left: nowX }} />}

            {/* rows */}
            {rows.map((c) => {
              const progs = (grid[c.id] ?? []).filter((p) => p.stop > from && p.start < to)
              return (
                <div className="guide-row" key={c.id}>
                  <div className="guide-ch">
                    {c.logo ? (
                      <img src={c.logo} loading="lazy" style={{ width: 38, height: 38, objectFit: 'contain' }} />
                    ) : (
                      <Initials name={c.name} />
                    )}
                    <span className="nm">{c.name}</span>
                    {c.catchup && (
                      <span className="ch-replay" title={`Catch-up: ${c.catchup.days} day${c.catchup.days === 1 ? '' : 's'}`}>
                        <Icon name="history" size={16} />
                      </span>
                    )}
                  </div>
                  <div className="guide-progs" style={{ width: widthPx }}>
                    {progs.length === 0 ? (
                      <div style={{ padding: '10px 14px', color: 'var(--text-faint)', fontSize: 12 }}>No guide data</div>
                    ) : (
                      progs.map((p) => {
                        const left = Math.max(0, ((p.start - from) / 60_000) * PX_PER_MIN)
                        const right = Math.min(widthPx, ((p.stop - from) / 60_000) * PX_PER_MIN)
                        const past = p.stop <= now
                        const replay = past && canReplay(c, p, now)
                        const onAir = p.start <= now && now < p.stop
                        return (
                          <button
                            key={`${p.start}-${p.title}`}
                            className={`focusable guide-prog ${past && !replay ? 'past' : ''} ${onAir ? 'on-air' : ''}`}
                            title={replay ? 'Watch from the start (catch-up)' : past ? 'Already aired' : undefined}
                            onClick={() => onProgramme(c, p)}
                            style={{
                              left,
                              width: Math.max(28, right - left - 3),
                              ['--l' as string]: `${left}px`,
                              ['--w' as string]: `${Math.max(28, right - left - 3)}px`
                            }}
                          >
                            <div className="pt">
                              {replay && <Icon name="history" size={14} />} {p.title}
                            </div>
                            <div className="pw">
                              {new Date(p.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={sentinelRef} style={{ height: 1 }} />
          </div>
        </div>
        <div className="hint-line" style={{ paddingLeft: 0 }}>
          <Icon name="history" size={13} /> = watch from the start (catch-up) · Live programmes play the channel
        </div>
      </div>
    </div>
  )
}

/** Past programme still inside the channel's catch-up window? */
function canReplay(c: Channel, p: Programme, now: number): boolean {
  return Boolean(c.catchup) && p.start >= now - c.catchup!.days * 86400_000
}
