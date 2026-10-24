import { useEffect, useMemo, useRef, useState } from 'react'
import { featurable } from '../contentFilter'
import { useStore } from '../store'
import { Initials } from '../components/Initials'
import { Icon } from '../components/Icon'
import { useProgressive } from '../hooks/useProgressive'
import { useRecordings } from '../hooks/useRecordings'
import type { Channel, Programme, Reminder } from '@shared/types'

const PX_PER_MIN = 6
/** Hours of the past shown, so catch-up programmes can be replayed. */
const PAST_HOURS = 3
const FUTURE_HOURS = 5
/** ello Premium: days you can pick (yesterday for catch-up, today, 6 more). */
const FIRST_DAY = -1
const LAST_DAY = 6

function dayStart(offset: number): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return d.getTime()
}

function dayLabel(offset: number): string {
  if (offset === -1) return 'Yesterday'
  if (offset === 0) return 'Today'
  if (offset === 1) return 'Tomorrow'
  return new Date(dayStart(offset)).toLocaleDateString([], { weekday: 'short', day: 'numeric' })
}
/** Must match .guide-ch width in CSS. */
const CH_WIDTH = 210

export function Guide(): JSX.Element {
  const { channels, categories, currentSourceId, loadCatalog, play, playCatchup, settings } = useStore()
  const recEnabled = Boolean(settings?.recordings)
  const { recordings, reminders } = useRecordings()
  const [sheet, setSheet] = useState<{ c: Channel; p: Programme } | null>(null)
  const [sheetMsg, setSheetMsg] = useState<string | null>(null)
  const [grid, setGrid] = useState<Record<string, Programme[]>>({})
  const [, force] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const premium = useStore((s) => s.license.premium)
  const requirePremium = useStore((s) => s.requirePremium)
  // Free: a few hours back to a few hours ahead. Premium: a day picker, today
  // running on into tomorrow morning and other days shown whole.
  const [day, setDay] = useState(0)
  const pickDay = (d: number): void => {
    if (d === day || (d !== 0 && !requirePremium('The full TV guide'))) return
    setGrid({})
    setDay(d)
  }

  useEffect(() => {
    void loadCatalog('live', false)
  }, [loadCatalog, currentSourceId])

  // Window: a few hours back (catch-up) to a few hours ahead, on half hours.
  const { from, to } = useMemo(() => {
    if (day !== 0) return { from: dayStart(day), to: dayStart(day + 1) + 3600_000 }
    const d = new Date(Date.now() - PAST_HOURS * 3600_000)
    d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0)
    const start = d.getTime()
    return { from: start, to: premium ? dayStart(1) + 6 * 3600_000 : start + (PAST_HOURS + FUTURE_HOURS) * 3600_000 }
  }, [day, premium])
  const widthPx = (to - from) / 60_000 * PX_PER_MIN

  // The guide leaves out adult channels (they stay in Live TV under their own category).
  const live = useMemo(() => {
    const ok = featurable(categories)
    return channels.filter((c) => c.type === 'live' && ok(c))
  }, [channels, categories])
  // Rows load a page at a time as you scroll down (big providers have thousands).
  const { visible: rows, sentinelRef } = useProgressive(live, 40)

  useEffect(() => {
    if (!currentSourceId || rows.length === 0) return
    const missing = rows.filter((c) => !(c.id in grid))
    if (!missing.length) return
    void window.api.epg
      .grid(currentSourceId, missing.map((c) => ({ id: c.id, epgChannelId: c.epgChannelId, name: c.name })), from, to)
      .then((r) => r.data && setGrid((g) => ({ ...g, ...r.data })))
  }, [currentSourceId, rows.length, from, to])

  // Start scrolled to "now" (past programmes are to the left), and publish the
  // scroll offset as --sx so titles of already-running programmes stay visible.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = day === 0 ? Math.max(0, ((Date.now() - from) / 60_000) * PX_PER_MIN - 120) : 0
    const sync = (): void => el.style.setProperty('--sx', `${el.scrollLeft}px`)
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    return () => el.removeEventListener('scroll', sync)
  }, [rows.length > 0, day])

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
    else if (recEnabled && p.start > now) {
      setSheetMsg(null)
      setSheet({ c, p })
    } else void play(c.id, queue)
  }
  // A recording covers a programme when it overlaps most of it (recordings start a
  // minute early and run two minutes late, so neighbours only touch).
  const isRecording = (c: Channel, p: Programme): boolean =>
    recordings.some(
      (r) =>
        r.channelId === c.id &&
        (r.status === 'scheduled' || r.status === 'recording') &&
        Math.min(r.stop, p.stop) - Math.max(r.start, p.start) > (p.stop - p.start) / 2
    )
  const hasReminder = (c: Channel, p: Programme): Reminder | undefined =>
    reminders.find((r) => r.channelId === c.id && r.start === p.start)

  return (
    <div className="page pad" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="guide-top">
        <h1 className="section-title">TV Guide</h1>
        <div className="guide-days">
          {Array.from({ length: LAST_DAY - FIRST_DAY + 1 }, (_, i) => FIRST_DAY + i).map((d) => (
            <button key={d} className={`focusable chip guide-day ${d === day ? 'on' : ''}`} onClick={() => pickDay(d)}>
              {d !== 0 && !premium && <Icon name="lock" size={13} />} {dayLabel(d)}
            </button>
          ))}
        </div>
      </div>
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
                      <div style={{ padding: '10px 14px', color: 'var(--text-faint)', fontSize: 12 }}>{day === 0 ? 'No guide data' : 'No guide data for this day yet'}</div>
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
                            onContextMenu={(e) => {
                              if (!recEnabled || past) return
                              e.preventDefault()
                              setSheetMsg(null)
                              setSheet({ c, p })
                            }}
                            style={{
                              left,
                              width: Math.max(28, right - left - 3),
                              ['--l' as string]: `${left}px`,
                              ['--w' as string]: `${Math.max(28, right - left - 3)}px`
                            }}
                          >
                            <div className="pt">
                              {replay && <Icon name="history" size={14} />}
                              {recEnabled && isRecording(c, p) && <span className="rec-dot" title="Recording" />}
                              {recEnabled && hasReminder(c, p) && <Icon name="bell" size={13} />} {p.title}
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
          {recEnabled && ' · Click a later programme (or right-click) to record it or get a reminder'}
        </div>
      </div>
      {sheet && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="sheet prog-sheet" role="dialog">
            <div className="prog-when">
              {sheet.c.name} · {new Date(sheet.p.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              {' – '}
              {new Date(sheet.p.stop).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
            <h2>{sheet.p.title}</h2>
            {sheet.p.desc && <p className="prog-desc">{sheet.p.desc}</p>}
            {sheetMsg && <div className="test-result good">{sheetMsg}</div>}
            <div className="sheet-actions">
              {hasReminder(sheet.c, sheet.p) ? (
                <button
                  className="focusable btn"
                  onClick={() => void window.api.recordings.removeReminder(hasReminder(sheet.c, sheet.p)!.id).then(() => setSheetMsg('Reminder removed.'))}
                >
                  <Icon name="bell" size={18} /> Remove reminder
                </button>
              ) : (
                sheet.p.start > now && (
                  <button
                    className="focusable btn"
                    onClick={() =>
                      void window.api.recordings
                        .remind(sheet.c.id, sheet.p.title, sheet.p.start)
                        .then((r) => setSheetMsg(r.ok ? 'You’ll get a notification a minute before it starts.' : r.error ?? 'Couldn’t set the reminder.'))
                    }
                  >
                    <Icon name="bell" size={18} /> Remind me
                  </button>
                )
              )}
              {!isRecording(sheet.c, sheet.p) && (
                <button
                  className="focusable btn"
                  onClick={() =>
                    void (sheet.p.start > now
                      ? window.api.recordings.schedule(sheet.c.id, sheet.p.title, sheet.p.start, sheet.p.stop)
                      : window.api.recordings.now(sheet.c.id, sheet.p.title, sheet.p.stop + 120_000)
                    ).then((r) =>
                      setSheetMsg(
                        r.ok
                          ? 'Recording is set. Keep ello smartTV running (it can be minimised). Find it in Settings → Recordings.'
                          : r.error ?? 'Couldn’t set the recording.'
                      )
                    )
                  }
                >
                  <Icon name="record" size={18} /> {sheet.p.start > now ? 'Record' : 'Record the rest'}
                </button>
              )}
              <span className="spacer" />
              <button className="focusable btn" onClick={() => setSheet(null)}>
                Close
              </button>
              <button className="focusable btn primary" onClick={() => (setSheet(null), void play(sheet.c.id, queue))}>
                <Icon name="play" size={18} /> Watch channel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Past programme still inside the channel's catch-up window? */
function canReplay(c: Channel, p: Programme, now: number): boolean {
  return Boolean(c.catchup) && p.start >= now - c.catchup!.days * 86400_000
}
