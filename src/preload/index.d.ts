import type { WindowsTvApi } from './index'

declare global {
  interface Window {
    api: WindowsTvApi
  }
}

export {}
