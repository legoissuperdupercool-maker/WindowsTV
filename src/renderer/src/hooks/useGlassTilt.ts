import { useEffect } from 'react'

/** Glass look: posters lean toward the pointer, with a light that follows it. */
export function useGlassTilt(on: boolean): void {
  useEffect(() => {
    if (!on) return
    let last: HTMLElement | null = null
    const reset = (el: HTMLElement | null): void => {
      el?.style.removeProperty('--rx')
      el?.style.removeProperty('--ry')
      el?.style.removeProperty('--mx')
      el?.style.removeProperty('--my')
    }
    const move = (e: PointerEvent): void => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.nf-card-hit, .nf-top10, .nf-wide') ?? null
      if (el !== last) {
        reset(last)
        last = el
      }
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const y = (e.clientY - r.top) / r.height
      el.style.setProperty('--ry', `${(x - 0.5) * 12}deg`)
      el.style.setProperty('--rx', `${(0.5 - y) * 10}deg`)
      el.style.setProperty('--mx', `${x * 100}%`)
      el.style.setProperty('--my', `${y * 100}%`)
    }
    document.addEventListener('pointermove', move, { passive: true })
    return () => {
      document.removeEventListener('pointermove', move)
      reset(last)
    }
  }, [on])
}
