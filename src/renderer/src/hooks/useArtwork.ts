import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Channel } from '@shared/types'

/**
 * Artwork the movie list leaves out. Movie lists often have no wide artwork
 * and sometimes no (working) poster; the provider's movie info usually has
 * both. It is read only for cards that come on screen and need it, a few at a
 * time, and kept for the session.
 */
export interface Artwork {
  poster?: string
  backdrop?: string
}

const cache = new Map<string, Promise<Artwork>>()
const waiting: Array<() => void> = []
let running = 0
const MAX_AT_ONCE = 3

function lookup(c: Channel): Promise<Artwork> {
  const key = `${c.sourceId}:${c.providerId}`
  let p = cache.get(key)
  if (!p) {
    p = new Promise<Artwork>((resolve) => {
      const run = (): void => {
        running++
        window.api.vod
          .info(c.sourceId, c.providerId)
          .then((r) => resolve({ poster: r.data?.poster, backdrop: r.data?.backdrop }))
          .catch(() => resolve({}))
          .finally(() => {
            running--
            waiting.shift()?.()
          })
      }
      if (running < MAX_AT_ONCE) run()
      else waiting.push(run)
    })
    cache.set(key, p)
  }
  return p
}

/** Movie artwork for `c` once the element is near the screen and `need` is true. */
export function useArtwork(c: Channel, need: boolean, ref: RefObject<HTMLElement>): Artwork {
  const [art, setArt] = useState<Artwork>({})
  const asked = useRef(false)
  useEffect(() => {
    if (!need || c.type !== 'movie' || asked.current || !ref.current) return
    let alive = true
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        asked.current = true
        void lookup(c).then((a) => alive && setArt(a))
      },
      { rootMargin: '300px' }
    )
    io.observe(ref.current)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [need, c, ref])
  return art
}
