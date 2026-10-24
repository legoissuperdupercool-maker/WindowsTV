import { useState } from 'react'

/** <img> that fades in once loaded and disappears (instead of a broken icon) on error. */
export function FadeImg(props: React.ImgHTMLAttributes<HTMLImageElement>): JSX.Element | null {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading')
  if (!props.src || state === 'error') return null
  return (
    <img
      loading="lazy"
      decoding="async"
      {...props}
      className={`fade-img ${state === 'loaded' ? 'loaded' : ''} ${props.className ?? ''}`}
      onLoad={() => setState('loaded')}
      onError={(e) => {
        setState('error')
        props.onError?.(e)
      }}
    />
  )
}
