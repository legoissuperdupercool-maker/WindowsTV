import { contextBridge, ipcRenderer } from 'electron'
import type { AppleDevice, DevicesResult, HelperEvent, PairableTv, Result } from '../shared/types'

const call = <T>(cmd: string, args?: Record<string, unknown>): Promise<Result<T>> =>
  ipcRenderer.invoke('apple:call', cmd, args)

const api = {
  devices: () => call<DevicesResult>('devices'),
  discover: () => call<PairableTv[]>('discover'),
  pair: (tv: PairableTv) => call<AppleDevice>('pair', { ...tv }),
  check: (id: string) => call<AppleDevice>('check', { id }),
  trustUsb: () => call<AppleDevice>('trustUsb'),
  forget: (id: string) => call<boolean>('forget', { id }),
  sendPin: (pin: string): Promise<void> => ipcRenderer.invoke('apple:pin', pin),
  onEvent: (cb: (e: HelperEvent) => void): (() => void) => {
    const fn = (_: unknown, e: HelperEvent): void => cb(e)
    ipcRenderer.on('helper:event', fn)
    return () => ipcRenderer.removeListener('helper:event', fn)
  },
  windowControl: (action: 'minimize' | 'close'): Promise<void> => ipcRenderer.invoke('window:control', action),
  version: (): Promise<string> => ipcRenderer.invoke('app:version')
}

export type SideloaderApi = typeof api
contextBridge.exposeInMainWorld('api', api)
