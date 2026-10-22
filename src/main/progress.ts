import Store from 'electron-store'
import type { PlaybackState, WatchItem } from '../shared/types'

type Current = Omit<WatchItem, 'position' | 'duration' | 'updatedAt' | 'finished'>

/** Below this many seconds in, we don't bother offering "Resume". */
const MIN_RESUME_S = 30
/** At or beyond this fraction of the runtime, a title counts as watched. */
const FINISHED_AT = 0.95
const MAX_ITEMS = 300

/**
 * Remembers how far you got in every movie/episode, saved to
 * userData/watch-progress.json. Fed by the player's state events, so it works
 * however playback was started and survives the app being closed mid-film.
 */
export class WatchProgress {
  private store = new Store<{ items: Record<string, WatchItem> }>({
    name: 'watch-progress',
    defaults: { items: {} }
  })
  private current: Current | null = null
  private pos = 0
  private dur = 0
  private lastSave = 0

  /** Call when playback starts. `null` for live TV (not tracked). */
  begin(item: Current | null): void {
    this.flush()
    this.current = item
    this.pos = 0
    this.dur = 0
    this.lastSave = Date.now()
  }

  /** Seconds to resume from, if the title was left part-way through. */
  resumePosition(key: string): number | undefined {
    const it = this.store.get('items')[key]
    if (!it || it.finished || it.position < MIN_RESUME_S) return undefined
    return Math.max(0, it.position - 3) // back up a few seconds for context
  }

  onState(state: PlaybackState): void {
    if (!this.current) return
    if (state.duration > 0) this.dur = state.duration
    if (state.position > 0) this.pos = state.position
    if (state.ended) {
      this.save(true)
      this.current = null
      return
    }
    if (state.status === 'idle') {
      this.flush()
      this.current = null
      return
    }
    if (Date.now() - this.lastSave > 10_000) this.save(false)
  }

  /** Persist the current position now (stop, switching title, app quit). */
  flush(): void {
    if (this.current) this.save(false)
  }

  private save(ended: boolean): void {
    if (!this.current || this.dur <= 0 || this.pos <= 0) return
    this.lastSave = Date.now()
    const items = { ...this.store.get('items') }
    items[this.current.key] = {
      ...this.current,
      position: Math.round(this.pos),
      duration: Math.round(this.dur),
      updatedAt: Date.now(),
      finished: ended || this.pos / this.dur >= FINISHED_AT
    }
    // Keep the file small: drop the oldest entries.
    const keys = Object.keys(items)
    if (keys.length > MAX_ITEMS) {
      keys
        .sort((a, b) => items[a].updatedAt - items[b].updatedAt)
        .slice(0, keys.length - MAX_ITEMS)
        .forEach((k) => delete items[k])
    }
    this.store.set('items', items)
  }

  /** Unfinished titles, most recent first (for the "Continue watching" row). */
  list(sourceId?: string): WatchItem[] {
    return Object.values(this.store.get('items'))
      .filter((i) => !i.finished && i.position >= MIN_RESUME_S && (!sourceId || i.sourceId === sourceId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
  }

  get(key: string): WatchItem | undefined {
    return this.store.get('items')[key]
  }

  /** All saved episodes of one series, keyed by episode id. */
  forSeries(sourceId: string, seriesId: string): Record<string, WatchItem> {
    const out: Record<string, WatchItem> = {}
    for (const it of Object.values(this.store.get('items'))) {
      if (it.sourceId === sourceId && it.series?.id === seriesId) out[it.series.episodeId] = it
    }
    return out
  }
}
