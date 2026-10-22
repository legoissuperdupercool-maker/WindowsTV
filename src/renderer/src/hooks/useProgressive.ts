import { useEffect, useRef, useState } from 'react'

/**
 * Render a long list a page at a time: start with `step` items and add another
 * page whenever the sentinel element (placed after the list) scrolls into view.
 * Keeps tab switches fast for providers with tens of thousands of items.
 */
export function useProgressive<T>(items: T[], step = 60): { visible: T[]; sentinelRef: React.RefObject<HTMLDivElement> } {
  const [count, setCount] = useState(step)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // New list (category / search / tab changed) → start from the first page.
  useEffect(() => setCount(step), [items, step])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || count >= items.length) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(c + step, items.length))
      },
      { rootMargin: '800px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [count, items.length, step])

  return { visible: items.slice(0, count), sentinelRef }
}
