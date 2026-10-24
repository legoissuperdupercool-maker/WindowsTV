import { useStore } from '../store'
import { Icon } from './Icon'

/** Settings → ello Premium: status, and the way in to enter a key. */
export function PremiumCard(): JSX.Element {
  const license = useStore((s) => s.license)
  const setPremiumSheet = useStore((s) => s.setPremiumSheet)
  return (
    <div className={`card premium-card ${license.premium ? 'on' : ''}`}>
      <Icon name="premium" size={30} />
      <div className="premium-card-text">
        <h3>ello Premium</h3>
        <p>
          {license.premium
            ? `Unlocked${license.name ? ` for ${license.name}` : ''}: the full TV guide, all styles and the iPad VPN.`
            : 'The full 7-day TV guide, the Premium, Wonder and Glass styles and the VPN on iPad.'}
        </p>
      </div>
      <button className={`focusable btn ${license.premium ? '' : 'primary'}`} onClick={() => setPremiumSheet('')}>
        {license.premium ? 'Manage' : 'Enter key'}
      </button>
    </div>
  )
}
