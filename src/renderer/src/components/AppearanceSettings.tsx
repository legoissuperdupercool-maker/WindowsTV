import { activeProfile, useStore } from '../store'
import { ACCENTS, LOOKS, PREMIUM_LOOKS, swatchBackground, type Look } from '../theme'
import { useLook } from '../hooks/useLook'
import { Icon } from './Icon'
import { Logo } from './Logo'

/** Settings → Look: the app's style, the start-up animation and the profile's colour. */
export function AppearanceSettings(): JSX.Element | null {
  const { settings, refreshSettings, saveProfile } = useStore()
  const me = useStore(activeProfile)
  const look = useLook()
  const premium = useStore((s) => s.license.premium)
  const requirePremium = useStore((s) => s.requirePremium)
  if (!settings) return null
  const update = async (partial: { uiTheme?: Look; intro?: boolean }): Promise<void> => {
    await window.api.settings.update(partial)
    await refreshSettings()
  }
  return (
    <div className="card">
      <h3>Look</h3>
      <div className="look-options five">
        {LOOKS.map((l) => (
          <button key={l.id} className={`focusable look-option ${look === l.id ? 'on' : ''}`} onClick={() => (!PREMIUM_LOOKS.has(l.id) || requirePremium(`The ${l.name} style`)) && void update({ uiTheme: l.id })}>
            <span className={`look-preview lp-${l.id}`}>
              <span className="lp-logo">
                <Logo look={l.id} height={l.id === 'theater' ? 16 : 14} />
              </span>
              <i className="lp-hero" />
              <i className="lp-row" />
              <i className="lp-row" />
            </span>
            <b>
              {l.name}
              {PREMIUM_LOOKS.has(l.id) && !premium && (
                <span className="premium-badge" title="ello Premium">
                  <Icon name="lock" size={13} /> Premium
                </span>
              )}
            </b>
            <small>{l.blurb}</small>
          </button>
        ))}
      </div>
      <div className="look-intro">
        <button className={`focusable switch-row ${settings.intro !== false ? 'on' : ''}`} onClick={() => void update({ intro: settings.intro === false })}>
          <span className="switch-knob" />
          <span>
            <b>Logo animation at start</b>
            <small>Plays when the app opens. Any key or click skips it.</small>
          </span>
        </button>
        <button className="focusable btn" onClick={() => window.dispatchEvent(new Event('ello:intro'))}>
          Play intro
        </button>
      </div>
      {me && (
        <>
          <label style={{ marginTop: 18, display: 'block' }}>Colour for {me.name}</label>
          <div className="swatches accents">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                className={`focusable swatch accent ${(me.accent ?? 'auto') === a.id ? 'on' : ''}`}
                style={{ background: swatchBackground(a.color) }}
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
