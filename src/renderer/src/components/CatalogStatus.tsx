import { useStore } from '../store'
import { Icon } from './Icon'

/**
 * Shown wherever a list (channels, movies, series) is empty, so the page always
 * explains itself: still loading, failed (with the reason + Retry), or the
 * provider genuinely has none.
 */
export function CatalogStatus({ what }: { what: string }): JSX.Element {
  const { loading, loadError, progress, reloadSource, navigate } = useStore()

  if (loading) {
    return (
      <div className="catalog-status">
        <div className="spinner" />
        <h2>Loading your {what}…</h2>
        <p>{progress?.message ?? 'Big providers can take up to a minute the first time.'}</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="catalog-status error">
        <h2>Couldn’t load your {what}</h2>
        <p>{loadError}</p>
        <div className="catalog-status-actions">
          <button className="focusable btn" onClick={() => void reloadSource()}>
            <Icon name="refresh" size={20} /> Retry
          </button>
          <button className="focusable btn" onClick={() => navigate('settings')}>
            <Icon name="settings" size={20} /> Check source
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="catalog-status">
      <h2>No {what} from this source</h2>
      <p>Your provider didn’t list any {what}. If that’s wrong, reload it.</p>
      <div className="catalog-status-actions">
        <button className="focusable btn" onClick={() => void reloadSource()}>
          <Icon name="refresh" size={20} /> Reload
        </button>
      </div>
    </div>
  )
}
