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
  | { event: 'exited'; message: string }

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
