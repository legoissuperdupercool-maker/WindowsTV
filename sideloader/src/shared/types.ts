export type DeviceKind = 'tv' | 'iphone' | 'ipad' | 'other'

export interface AppleDevice {
  id: string
  name: string
  kind: DeviceKind
  model?: string
  os?: string
  /** Reachable right now (Wi-Fi, or connected by cable). */
  online?: boolean
  usb?: boolean
  /** iPhone/iPad only: Developer Mode is needed to run your own apps. */
  developerMode?: boolean
  canInstall?: boolean
  /** Apps ello Sideloader installed on it (newest first). */
  apps?: InstalledApp[]
}

export interface InstalledApp {
  name: string
  bundleId: string
  version: string
  /** The .ipa it was installed from (used for the weekly renewal). */
  source: string
  installedAt: number
  /** When Apple's free signing runs out (seconds since 1970). */
  expires: number | null
}

export interface AccountState {
  signedIn: boolean
  appleId: string | null
  /** Password kept (encrypted) so the weekly renewal can sign in by itself. */
  remember: boolean
}

export interface AppInfo {
  name: string
  bundleId: string
  version: string
  platforms: string[]
  path: string
  size: number
}

export interface DevicesResult {
  devices: AppleDevice[]
  /** Apple's USB device service (Apple Devices app / iTunes) is installed and running. */
  usbService: boolean
}

export interface PairableTv {
  identifier: string
  name: string
  ip: string
  port: number
}

export type HelperEvent =
  | { event: 'ready' }
  | { event: 'pin_required'; name: string }
  | { event: 'trust_required' }
  | { event: 'code_required'; mode: 'device' | 'sms' | 'manual' }
  | { event: 'progress'; text: string; percent: number | null }
  | { event: 'renewed'; device: string; app: string; ok: boolean; error?: string }
  | { event: 'exited'; message: string }

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/** Where Apple's machine data comes from at sign-in. */
export type AnisetteMode = 'auto' | 'builtin' | 'icloud' | 'server'
