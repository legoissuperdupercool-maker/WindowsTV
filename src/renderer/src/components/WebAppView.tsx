import { useStore } from '../store'
import { Icon } from './Icon'

/**
 * The control strip shown above an in-app web app. The web page itself is a
 * native WebContentsView managed by the main process and rendered BELOW this
 * 56px bar, so here we only draw the controls.
 */
export function WebAppView(): JSX.Element {
  const { webApp, closeWebApp } = useStore()

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 14px',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line)',
          zIndex: 300,
          WebkitAppRegion: 'drag'
        } as React.CSSProperties}
      >
        <button className="focusable winbtn" style={noDrag} title="Back" onClick={() => window.api.webapp.back()} data-disabled={webApp.canGoBack ? undefined : ''}>
          <Icon name="back" size={18} />
        </button>
        <button className="focusable winbtn" style={noDrag} title="App home" onClick={() => window.api.webapp.home()}>
          <Icon name="live" size={16} />
        </button>
        <button className="focusable winbtn" style={noDrag} title="Reload" onClick={() => window.api.webapp.reload()}>
          <Icon name="refresh" size={16} />
        </button>
        <div style={{ flex: 1, minWidth: 0, ...noDrag }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {webApp.title || 'Loading…'}
          </div>
          {webApp.drmWarning && (
            <div style={{ fontSize: 11, color: 'var(--warn)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ⚠ {webApp.drmWarning}
            </div>
          )}
        </div>
        {webApp.loading && <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />}
        <button className="focusable winbtn close" style={noDrag} title="Close app" onClick={closeWebApp}>
          <Icon name="close" size={18} />
        </button>
      </div>
      {/* The page fills the rest of the window (drawn natively below this bar). */}
    </>
  )
}

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
