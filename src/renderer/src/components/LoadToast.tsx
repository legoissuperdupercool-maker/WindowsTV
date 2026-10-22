import { useStore } from '../store'

export function LoadToast(): JSX.Element | null {
  const progress = useStore((s) => s.progress)
  if (!progress) return null
  const done = progress.phase === 'done'
  const error = progress.phase === 'error'
  return (
    <div className="load-toast" role="status">
      {!done && !error && <span className="spinner mini-spinner" />}
      {done && <span style={{ color: 'var(--good)' }}>✓</span>}
      {error && <span style={{ color: 'var(--bad)' }}>⚠</span>}
      <span>{progress.message}</span>
    </div>
  )
}
