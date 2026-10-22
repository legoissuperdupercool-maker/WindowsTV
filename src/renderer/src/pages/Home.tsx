import { useStore, type RouteName } from '../store'
import { Icon } from '../components/Icon'
import type { AppTile } from '@shared/types'

export function Home(): JSX.Element {
  const { settings, navigate, channels, play } = useStore()
  const tiles = settings?.appTiles ?? []
  const hasSources = (settings?.sources.length ?? 0) > 0

  const recents = (settings?.recents ?? [])
    .map((id) => channels.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .slice(0, 8)

  const onTile = (tile: AppTile): void => {
    if (tile.kind === 'web') {
      void window.api.openExternal(tile.target)
    } else {
      navigate(tile.target as RouteName)
    }
  }

  return (
    <div className="page">
      {!hasSources && (
        <div
          className="card"
          style={{ background: 'var(--accent-grad)', border: 'none', marginBottom: 26 }}
        >
          <h3 style={{ fontSize: 22 }}>Welcome to WindowsTV 👋</h3>
          <p className="hint" style={{ color: 'rgba(255,255,255,0.85)' }}>
            Add your IPTV provider (Xtream login or an M3U playlist) to start watching.
          </p>
          <button className="focusable ghost-btn" onClick={() => navigate('settings')}>
            <Icon name="settings" size={16} /> Add a source
          </button>
        </div>
      )}

      <h1 className="section-title">Home</h1>

      <div className="tile-grid">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            className="focusable app-tile"
            style={{ ['--tile-color' as string]: tile.color ?? '#334' }}
            onClick={() => onTile(tile)}
          >
            <span className="glow" />
            <span className="tile-icon">
              <Icon name={tile.icon ?? 'tv'} size={30} />
            </span>
            <div>
              <div className="tile-label">{tile.label}</div>
              <div className="tile-sub">
                {tile.kind === 'web' ? 'Open app' : sectionSub(tile.target)}
              </div>
            </div>
          </button>
        ))}
      </div>

      {recents.length > 0 && (
        <>
          <div className="row-label">Recently watched</div>
          <div className="channel-grid" style={{ maxHeight: 'none' }}>
            {recents.map((c) => (
              <button key={c.id} className="focusable channel-card" onClick={() => void play(c.id)}>
                {c.logo ? (
                  <img className="logo" src={c.logo} loading="lazy" />
                ) : (
                  <div className="logo ph">{c.name.slice(0, 2).toUpperCase()}</div>
                )}
                <div className="meta">
                  <div className="name">{c.name}</div>
                  <div className="epg-now">{c.group ? 'Live' : c.type}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function sectionSub(target: string): string {
  switch (target) {
    case 'live':
      return 'Watch channels'
    case 'guide':
      return 'What’s on now'
    case 'movies':
      return 'On demand'
    case 'series':
      return 'Box sets'
    case 'settings':
      return 'Sources & player'
    default:
      return ''
  }
}
