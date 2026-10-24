import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, Notification } from 'electron'
import Store from 'electron-store'
import type { Recording, Reminder } from '../shared/types'

interface Data {
  recordings: Recording[]
  reminders: Reminder[]
}

/**
 * Recording live TV to this PC, and reminders from the Guide.
 *
 * A recording is a separate, silent mpv that saves the stream as it arrives
 * (`--stream-record`, video frames not decoded, so it costs little CPU). It needs one
 * more connection to the provider while it runs. Scheduled recordings and
 * reminders only work while ello smartTV is running.
 */
export class Recorder {
  private store = new Store<Data>({ name: 'recordings', defaults: { recordings: [], reminders: [] } })
  private running = new Map<string, { proc: ChildProcess; timer: NodeJS.Timeout }>()
  private tick: NodeJS.Timeout | null = null

  constructor(
    private opts: {
      mpvPath: () => string | undefined
      folder: () => string
      resolve: (channelId: string) => { url: string; name: string; userAgent?: string } | null
      httpProxy: () => string | undefined
      onChange: () => void
      onReminderClick: (channelId: string) => void
    }
  ) {
    // Anything that was recording when the app closed has stopped.
    const list = this.store.get('recordings').map((r) =>
      r.status === 'recording' ? { ...r, status: 'failed' as const, error: 'ello smartTV was closed while recording.' } : r
    )
    this.store.set('recordings', list)
    this.tick = setInterval(() => this.check(), 15_000)
    setTimeout(() => this.check(), 3000)
  }

  list(): { recordings: Recording[]; reminders: Reminder[] } {
    return { recordings: this.store.get('recordings'), reminders: this.store.get('reminders') }
  }

  /** Record a channel now, until `stop` (default: 2 hours, or until stopped). */
  recordNow(channelId: string, title?: string, stop?: number): Recording {
    const ch = this.opts.resolve(channelId)
    if (!ch) throw new Error('This channel isn’t in your provider’s list any more.')
    const now = Date.now()
    const rec: Recording = {
      id: randomUUID(),
      channelId,
      channelName: ch.name,
      title: title || ch.name,
      start: now,
      stop: stop && stop > now ? stop : now + 2 * 3600_000,
      status: 'scheduled'
    }
    this.save([rec, ...this.store.get('recordings')])
    this.begin(rec)
    return rec
  }

  /** Record a programme from the Guide (a minute early, two minutes late). */
  schedule(channelId: string, title: string, start: number, stop: number): Recording {
    const ch = this.opts.resolve(channelId)
    if (!ch) throw new Error('This channel isn’t in your provider’s list any more.')
    const rec: Recording = {
      id: randomUUID(),
      channelId,
      channelName: ch.name,
      title,
      start: start - 60_000,
      stop: stop + 120_000,
      status: 'scheduled'
    }
    this.save([rec, ...this.store.get('recordings')])
    this.check()
    return rec
  }

  stop(id: string): void {
    const r = this.running.get(id)
    if (r) {
      clearTimeout(r.timer)
      r.proc.kill()
      return // the exit handler marks it done
    }
    this.update(id, { status: 'cancelled' })
  }

  remove(id: string): void {
    this.stop(id)
    this.save(this.store.get('recordings').filter((r) => r.id !== id))
  }

  addReminder(channelId: string, title: string, start: number): Reminder {
    const ch = this.opts.resolve(channelId)
    const rem: Reminder = { id: randomUUID(), channelId, channelName: ch?.name ?? 'Channel', title, start }
    this.store.set('reminders', [...this.store.get('reminders'), rem])
    this.opts.onChange()
    return rem
  }

  removeReminder(id: string): void {
    this.store.set('reminders', this.store.get('reminders').filter((r) => r.id !== id))
    this.opts.onChange()
  }

  shutdown(): void {
    if (this.tick) clearInterval(this.tick)
    for (const id of [...this.running.keys()]) this.stop(id)
  }

  // ---------------------------------------------------------------- internals

  private save(list: Recording[]): void {
    this.store.set('recordings', list.slice(0, 300))
    this.opts.onChange()
  }

  private update(id: string, patch: Partial<Recording>): void {
    this.save(this.store.get('recordings').map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  private check(): void {
    const now = Date.now()
    for (const r of this.store.get('recordings')) {
      if (r.status === 'scheduled' && r.start <= now && !this.running.has(r.id)) {
        if (r.stop <= now) this.update(r.id, { status: 'failed', error: 'ello smartTV wasn’t running at that time.' })
        else this.begin(r)
      }
    }
    // Reminders: one minute before the start; forget them once they've passed.
    const keep: Reminder[] = []
    for (const rem of this.store.get('reminders')) {
      if (rem.start - 60_000 <= now) {
        if (rem.start + 10 * 60_000 > now) this.notify(rem)
      } else keep.push(rem)
    }
    if (keep.length !== this.store.get('reminders').length) {
      this.store.set('reminders', keep)
      this.opts.onChange()
    }
  }

  private notify(rem: Reminder): void {
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: `${rem.title} starts soon`,
      body: `On ${rem.channelName}. Click to watch.`,
      silent: false
    })
    n.on('click', () => this.opts.onReminderClick(rem.channelId))
    n.show()
  }

  private begin(rec: Recording): void {
    const ch = this.opts.resolve(rec.channelId)
    const mpv = this.opts.mpvPath()
    if (!ch || !mpv) {
      this.update(rec.id, { status: 'failed', error: !ch ? 'Channel not found.' : 'mpv is missing.' })
      return
    }
    const folder = this.opts.folder()
    try {
      mkdirSync(folder, { recursive: true })
    } catch (e) {
      this.update(rec.id, { status: 'failed', error: `Can’t write to ${folder}: ${(e as Error).message}` })
      return
    }
    const stamp = new Date(Math.max(rec.start, Date.now())).toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')
    const safe = (s: string): string => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    const file = join(folder, `${safe(rec.title)} - ${safe(ch.name)} - ${stamp}.ts`)
    const proxy = this.opts.httpProxy()
    const args = [
      '--no-config',
      '--idle=no',
      '--terminal=no',
      // Tracks stay selected (only selected tracks are recorded) but nothing is
      // shown or played, and video frames aren't decoded.
      '--vo=null',
      '--ao=null',
      '--vd-lavc-skipframe=all',
      '--cache=yes',
      `--stream-record=${file}`,
      `--user-agent=${ch.userAgent ?? 'VLC/3.0.20 LibVLC/3.0.20'}`,
      '--stream-lavf-o-append=reconnect=1',
      '--stream-lavf-o-append=reconnect_streamed=1',
      '--stream-lavf-o-append=reconnect_delay_max=7',
      ...(proxy ? [`--http-proxy=${proxy}`] : []),
      ch.url
    ]
    const proc = spawn(mpv, args, { windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => proc.kill(), Math.max(1000, rec.stop - Date.now()))
    this.running.set(rec.id, { proc, timer })
    this.update(rec.id, { status: 'recording', file })
    proc.on('exit', () => {
      clearTimeout(timer)
      this.running.delete(rec.id)
      let size = 0
      try {
        size = statSync(file).size
      } catch {
        /* no file */
      }
      this.update(
        rec.id,
        size > 100_000
          ? { status: 'done' }
          : { status: 'failed', error: 'Nothing was recorded. The provider may allow only one stream at a time.' }
      )
    })
  }
}

export function defaultRecordFolder(): string {
  return join(app.getPath('videos'), 'ello smartTV')
}
