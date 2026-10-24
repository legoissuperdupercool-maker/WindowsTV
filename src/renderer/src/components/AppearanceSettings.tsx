import { activeProfile, useStore } from '../store'
import { ACCENTS, accentColor } from '../theme'

/** Settings → Look: Cinema (big artwork and rows) or Classic (tiles), plus the profile's colour. */
export function AppearanceSettings(): JSX.Element | null {
  const { settings, refreshSettings, saveProfile } = useStore()
  const me = useStore(activeProfile)
  if (!settings) return null
  const theme = settings.uiTheme ?? 'cinema'
  const setTheme = async (uiTheme: 'cinema' | 'classic'): Promise<void> => {
    await window.api.settings.update({ uiTheme })
    await refreshSettings()
  }
  return (
    <div className="card">
      <h3>Look</h3>
      <div className="look-options">
        <button className={`focusable look-option ${theme === 'cinema' ? 'on' : ''}`} onClick={() => void setTheme('cinema')}>
          <span className="look-preview cinema">
            <i className="lp-hero" />
            <i className="lp-row" />
            <i className="lp-row" />
          </span>
          <b>Cinema</b>
          <small>Big artwork at the top, then rows of posters. Titles open in a window over the page.</small>
        </button>
        <button className={`focusable look-option ${theme === 'classic' ? 'on' : ''}`} onClick={() => void setTheme('classic')}>
          <span className="look-preview classic">
            <i className="lp-bar" />
            <i className="lp-cards" />
            <i className="lp-cards" />
          </span>
          <b>Classic</b>
          <small>Rounded tiles and cards with a light, airy layout. Titles open on their own screen.</small>
        </button>
      </div>
      {me && (
        <>
          <label style={{ marginTop: 18, display: 'block' }}>Colour for {me.name}</label>
          <div className="swatches accents">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                className={`focusable swatch accent ${accentColor(me.accent) === a.color ? 'on' : ''}`}
                style={{ background: a.color }}
                title={a.name}
                onClick={() => void saveProfile({ id: me.id, name: me.name, accent: a.id })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
