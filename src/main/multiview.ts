import type { BaseWindow } from 'electron'
import type { MpvPlayer } from './mpv/MpvPlayer'
import type { WindowManager } from './windows'
import type { VideoRegion } from '../shared/ipc'
import type { PlaybackState } from '../shared/types'

/**
 * Multi-view: 2 or 4 live channels at once. Each tile is its own mpv drawing
 * into its own native window behind the UI (like the main player), and only
 * the selected tile has sound.
 */
export class MultiView {
  private cells: Array<{ win: BaseWindow; player: MpvPlayer; channelId?: string }> = []
  private audio = 0

  constructor(
    private windows: WindowManager,
    private makePlayer: (wid: number) => MpvPlayer,
    private send: (index: number, state: PlaybackState) => void
  ) {}

  get size(): number {
    return this.cells.length
  }

  /** Make sure there are `n` tiles (2 or 4). */
  async setLayout(n: number): Promise<void> {
    n = n >= 4 ? 4 : 2
    const starts: Promise<void>[] = []
    while (this.cells.length > n) await this.dropCell(this.cells.length - 1)
    while (this.cells.length < n) {
      const win = this.windows.addSurface()
      const player = this.makePlayer(this.windows.surfaceId(win))
      const index = this.cells.length
      player.on('state', (s: PlaybackState) => this.send(this.cells.findIndex((c) => c.player === player), s))
      this.cells.push({ win, player })
      starts.push(player.start().then(() => player.setMuted(index !== this.audio)).catch(() => undefined))
    }
    // Tiles only take channels once their mpv is up.
    await Promise.all(starts)
  }

  async load(index: number, url: string, opts: { channelId: string; title: string; userAgent?: string }): Promise<void> {
    const cell = this.cells[index]
    if (!cell) throw new Error('No such tile.')
    cell.channelId = opts.channelId
    await cell.player.load(url, { title: opts.title, channelId: opts.channelId, userAgent: opts.userAgent })
    cell.player.setMuted(index !== this.audio)
  }

  clear(index: number): void {
    const cell = this.cells[index]
    if (!cell) return
    cell.channelId = undefined
    cell.player.stop()
  }

  setAudio(index: number): void {
    this.audio = index
    this.cells.forEach((c, i) => c.player.setMuted(i !== index))
  }

  setRegions(regions: VideoRegion[]): void {
    this.cells.forEach((c, i) => this.windows.setSurfaceRegion(c.win, regions[i] ?? { x: 0, y: 0, width: 0, height: 0, visible: false }))
  }

  private async dropCell(index: number): Promise<void> {
    const [cell] = this.cells.splice(index, 1)
    if (!cell) return
    try {
      await cell.player.quit()
    } catch {
      /* already gone */
    }
    this.windows.removeSurface(cell.win)
  }

  async stop(): Promise<void> {
    while (this.cells.length) await this.dropCell(this.cells.length - 1)
    this.audio = 0
  }
}
