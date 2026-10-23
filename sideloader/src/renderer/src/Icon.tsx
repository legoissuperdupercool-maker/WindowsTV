// Material Symbols (Rounded, filled), as in ello smartTV.
import tv from '@material-symbols/svg-400/rounded/tv-fill.svg?raw'
import phone from '@material-symbols/svg-400/rounded/mobile-fill.svg?raw'
import tablet from '@material-symbols/svg-400/rounded/tablet_mac-fill.svg?raw'
import add from '@material-symbols/svg-400/rounded/add-fill.svg?raw'
import check from '@material-symbols/svg-400/rounded/check_circle-fill.svg?raw'
import wifi from '@material-symbols/svg-400/rounded/wifi-fill.svg?raw'
import usb from '@material-symbols/svg-400/rounded/usb-fill.svg?raw'
import refresh from '@material-symbols/svg-400/rounded/refresh-fill.svg?raw'
import trash from '@material-symbols/svg-400/rounded/delete-fill.svg?raw'
import lock from '@material-symbols/svg-400/rounded/lock-fill.svg?raw'
import shield from '@material-symbols/svg-400/rounded/verified_user-fill.svg?raw'
import close from '@material-symbols/svg-400/rounded/close-fill.svg?raw'
import minimize from '@material-symbols/svg-400/rounded/remove-fill.svg?raw'
import devices from '@material-symbols/svg-400/rounded/devices-fill.svg?raw'
import person from '@material-symbols/svg-400/rounded/person-fill.svg?raw'
import cable from '@material-symbols/svg-400/rounded/cable-fill.svg?raw'
import error from '@material-symbols/svg-400/rounded/error-fill.svg?raw'
import info from '@material-symbols/svg-400/rounded/info-fill.svg?raw'
import back from '@material-symbols/svg-400/rounded/arrow_back-fill.svg?raw'
import sync from '@material-symbols/svg-400/rounded/sync-fill.svg?raw'
import download from '@material-symbols/svg-400/rounded/download-fill.svg?raw'

const ICONS: Record<string, string> = {
  tv, phone, tablet, add, check, wifi, usb, refresh, trash, lock, shield, close, minimize,
  devices, person, cable, error, info, back, sync, download
}

export function Icon({ name, size = 22 }: { name: string; size?: number }): JSX.Element {
  return (
    <span
      className="msi"
      aria-hidden
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS.info }}
    />
  )
}
