import { useEffect } from 'react'

/**
 * Lightweight spatial navigation for a 10-foot / remote-control UI.
 *
 * Any element with the `.focusable` class participates. Arrow keys (and a
 * gamepad/remote mapped to them) move focus to the geometrically nearest
 * focusable in that direction; Enter activates; Escape/Backspace/Backarrow go
 * back. Mouse hover also moves focus so pointer and remote stay in sync.
 */

type BackHandler = () => boolean // return true if handled

let current: HTMLElement | null = null
let backHandler: BackHandler | null = null

export function setBackHandler(fn: BackHandler | null): void {
  backHandler = fn
}

function focusables(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.focusable')
  ).filter((el) => el.offsetParent !== null && !el.hasAttribute('data-disabled'))
}

function setFocus(el: HTMLElement | null): void {
  if (current && current !== el) current.classList.remove('is-focused')
  current = el
  if (el) {
    el.classList.add('is-focused')
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}

export function focusFirst(): void {
  // A screen can mark its main action (e.g. "Play") as the default focus.
  const preferred = document.querySelector<HTMLElement>('.focusable[data-autofocus]')
  if (preferred && preferred.offsetParent !== null) {
    setFocus(preferred)
    return
  }
  const els = focusables()
  if (!els.length) {
    setFocus(null)
    return
  }
  // Prefer the top-left-most element.
  els.sort((a, b) => {
    const ra = a.getBoundingClientRect()
    const rb = b.getBoundingClientRect()
    return ra.top - rb.top || ra.left - rb.left
  })
  setFocus(els[0])
}

function rectCenter(el: HTMLElement): { x: number; y: number; r: DOMRect } {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }
}

function move(dir: 'up' | 'down' | 'left' | 'right'): void {
  const els = focusables()
  if (!els.length) return
  if (!current || !document.contains(current) || !els.includes(current)) {
    focusFirst()
    return
  }
  const from = rectCenter(current)
  let best: HTMLElement | null = null
  let bestScore = Infinity

  for (const el of els) {
    if (el === current) continue
    const to = rectCenter(el)
    const dx = to.x - from.x
    const dy = to.y - from.y

    let primary: number
    let cross: number
    let inDir: boolean
    switch (dir) {
      case 'up':
        inDir = dy < -4
        primary = -dy
        cross = Math.abs(dx)
        break
      case 'down':
        inDir = dy > 4
        primary = dy
        cross = Math.abs(dx)
        break
      case 'left':
        inDir = dx < -4
        primary = -dx
        cross = Math.abs(dy)
        break
      default:
        inDir = dx > 4
        primary = dx
        cross = Math.abs(dy)
        break
    }
    if (!inDir) continue
    // Favour tight alignment to the travel axis, then nearest in distance.
    const score = primary + cross * 2.2
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  if (best) setFocus(best)
}

function activate(): void {
  if (current) current.click()
}

export function useSpatialNavigation(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      switch (e.key) {
        case 'ArrowUp':
          if (typing) return
          e.preventDefault()
          move('up')
          break
        case 'ArrowDown':
          if (typing) return
          e.preventDefault()
          move('down')
          break
        case 'ArrowLeft':
          if (typing) return
          e.preventDefault()
          move('left')
          break
        case 'ArrowRight':
          if (typing) return
          e.preventDefault()
          move('right')
          break
        case 'Enter':
          if (typing) return
          e.preventDefault()
          activate()
          break
        case 'Backspace':
        case 'Escape':
        case 'BrowserBack':
          if (typing && e.key === 'Backspace') return
          if (backHandler && backHandler()) e.preventDefault()
          break
      }
    }

    const onOver = (e: MouseEvent): void => {
      const el = (e.target as HTMLElement)?.closest<HTMLElement>('.focusable')
      if (el && el !== current && !el.hasAttribute('data-disabled')) setFocus(el)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseover', onOver)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseover', onOver)
    }
  }, [])
}

/** Move focus to a specific element (e.g. restore it after closing a screen). */
export function focusElement(el: HTMLElement): void {
  setFocus(el)
}

export function getFocused(): HTMLElement | null {
  return current
}
