import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * A horizontal row (rails, episodes) with ‹ › buttons at the ends, so it can be
 * browsed with a mouse too — scrollbars are hidden for the TV look and the
 * wheel scrolls the page. Remote/arrow-key focus scrolls it as before.
 */
export function ScrollRow({ className, children }: { className: string; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true })
    el.addEventListener('scroll', update, { passive: true })
    // Shift + wheel scrolls sideways (the plain wheel keeps scrolling the page).
    const onWheel = (e: WheelEvent): void => {
      if (!e.shiftKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollBy({ left: e.deltaY, behavior: 'auto' })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      mo.disconnect()
      el.removeEventListener('scroll', update)
      el.removeEventListener('wheel', onWheel)
    }
  }, [update])

  const page = (dir: 1 | -1): void => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <div className="scroll-row">
      {edges.left && (
        <button className="scroll-arrow left" tabIndex={-1} aria-label="Scroll left" onClick={() => page(-1)}>
          <Icon name="chevron" size={28} />
        </button>
      )}
      <div ref={ref} className={className}>
        {children}
      </div>
      {edges.right && (
        <button className="scroll-arrow right" tabIndex={-1} aria-label="Scroll right" onClick={() => page(1)}>
          <Icon name="chevron" size={28} />
        </button>
      )}
    </div>
  )
}
