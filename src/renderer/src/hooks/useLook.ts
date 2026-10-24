import { useStore } from '../store'
import { effectiveLook, type Look } from '../theme'

/** The look in use (Premium looks need ello Premium). */
export function useLook(): Look {
  return useStore((s) => effectiveLook(s.settings?.uiTheme, s.license.premium))
}
