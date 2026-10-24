import { useEffect, useRef, useState } from 'react'

/**
 * Skip intro / credits for series, learned from the viewer.
 *
 * IPTV providers don't say where intros are, so ello learns them per series:
 * when you jump forward early in an episode (with "Skip intro" or by seeking),
 * the span you skipped is remembered, and later episodes offer to skip exactly
 * that span (or skip it by themselves, if that's switched on in Settings).
 * The same for credits: pressing "Next episode" near the end remembers how long
 * the credits run, so the button shows up at the right moment next time.
 * Everything stays on this PC (localStorage).
 */

interface Learned {
  /** Intro span (seconds from the start). */
  start?: number
  end?: number
  /** Credits length (seconds before the end). */
  credits?: number
}

const KEY = (seriesId: string): string => `ello.skip.${seriesId}`
/** Before anything is learned: offer a standard skip in the first minutes. */
const DEFAULT_INTRO = 85
const DEFAULT_WINDOW = 300
const DEFAULT_CREDITS = 40

export function loadLearned(seriesId: string): Learned {
  try {
    return JSON.parse(localStorage.getItem(KEY(seriesId)) ?? '{}') as Learned
  } catch {
    return {}
  }
}

function saveLearned(seriesId: string, patch: Learned): void {
  try {
    localStorage.setItem(KEY(seriesId), JSON.stringify({ ...loadLearned(seriesId), ...patch }))
  } catch {
    /* storage full / unavailable: nothing learned this time */
  }
}

export function autoSkipEnabled(): boolean {
  try {
    return localStorage.getItem('ello.autoSkipIntro') === '1'
  } catch {
    return false
  }
}

export function setAutoSkip(on: boolean): void {
  try {
    localStorage.setItem('ello.autoSkipIntro', on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export interface SkipState {
  /** Show "Skip intro" now: seek to `to`. */
  intro: { to: number; learned: boolean } | null
  /** Show "Next episode" now (credits). */
  credits: boolean
  /** Call when the viewer presses "Next episode" (learns the credits length). */
  noteNext: () => void
}

export function useSkipIntro(opts: {
  seriesId?: string
  episodeKey?: string
  position: number
  duration: number
  playing: boolean
  hasNext: boolean
  seek: (to: number) => void
}): SkipState {
  const { seriesId, episodeKey, position, duration, playing, hasNext, seek } = opts
  const [learned, setLearned] = useState<Learned>({})
  const last = useRef<number | null>(null)
  const jump = useRef<{ from: number; to: number; at: number } | null>(null)
  const autoDone = useRef(false)
  const startedAt = useRef(Date.now())
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLearned(seriesId ? loadLearned(seriesId) : {})
    last.current = null
    jump.current = null
    autoDone.current = false
    startedAt.current = Date.now()
    return () => {
      // Leaving the episode within a few seconds of a skip still counts it.
      if (settle.current) clearTimeout(settle.current)
      const done = jump.current
      if (seriesId && done && done.to - done.from >= 20 && done.to - done.from <= 240) {
        saveLearned(seriesId, { start: Math.max(0, Math.round(done.from)), end: Math.round(done.to) })
      }
    }
  }, [seriesId, episodeKey])

  // Learn the intro from forward jumps early in the episode. Several jumps close
  // together (pressing +15 s a few times) count as one skip.
  useEffect(() => {
    if (!seriesId) return
    const prev = last.current
    last.current = position
    // The resume jump right after an episode opens isn't a skip.
    if (prev == null || Date.now() - startedAt.current < 5000) return
    const delta = position - prev
    if (delta > 5 && prev < 900) {
      const now = Date.now()
      const j = jump.current
      jump.current = j && now - j.at < 8000 ? { from: j.from, to: position, at: now } : { from: prev, to: position, at: now }
      // Remember the skip once no more jumps follow for a few seconds.
      if (settle.current) clearTimeout(settle.current)
      const sid = seriesId
      settle.current = setTimeout(() => {
        const done = jump.current
        jump.current = null
        if (!done) return
        const length = done.to - done.from
        if (length >= 20 && length <= 240) {
          const patch = { start: Math.max(0, Math.round(done.from)), end: Math.round(done.to) }
          saveLearned(sid, patch)
          setLearned((l) => ({ ...l, ...patch }))
        }
      }, 8000)
    }
  }, [position, seriesId])

  let intro: SkipState['intro'] = null
  if (seriesId && duration > 0) {
    if (learned.start != null && learned.end != null) {
      if (position >= learned.start - 2 && position < learned.end - 3) intro = { to: learned.end, learned: true }
    } else if (position > 3 && position < DEFAULT_WINDOW && duration > 600) {
      intro = { to: position + DEFAULT_INTRO, learned: false }
    }
  }

  // Auto-skip a learned intro, once per episode.
  useEffect(() => {
    if (intro?.learned && playing && !autoDone.current && autoSkipEnabled()) {
      autoDone.current = true
      seek(intro.to)
    }
  }, [intro?.learned, intro?.to, playing]) // eslint-disable-line react-hooks/exhaustive-deps

  const remaining = duration - position
  const creditsLen = learned.credits ?? DEFAULT_CREDITS
  const credits = Boolean(seriesId && hasNext && duration > 300 && remaining > 1 && remaining <= creditsLen)

  return {
    intro,
    credits,
    noteNext: () => {
      if (!seriesId || duration <= 0) return
      const r = Math.round(duration - position)
      if (r >= 15 && r <= 600) {
        saveLearned(seriesId, { credits: r })
        setLearned((l) => ({ ...l, credits: r }))
      }
    }
  }
}
