import type { SideloaderApi } from './index'

declare global {
  interface Window {
    api: SideloaderApi
  }
}
