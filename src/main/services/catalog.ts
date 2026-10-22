import { app } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type {
  AppSettings,
  Category,
  Channel,
  LoadProgress,
  Source,
  StreamType
} from '../../shared/types'
import * as xtream from './xtream'
import { loadM3u } from './m3u'
import { EpgStore } from './epg'

type ProgressFn = (p: LoadProgress) => void

interface SourceData {
  channels: Channel[]
  categories: Category[]
  epgUrl?: string
}

/**
 * Central catalogue: owns channels, categories and per-source EPG. Everything is
 * cached to disk so the app opens instantly and still works offline, then
 * refreshed in the background.
 */
export class Catalog {
  private data = new Map<string, SourceData>()
  private epg = new Map<string, EpgStore>()
  private cacheDir = join(app.getPath('userData'), 'catalog-cache')

  private cacheFile(sourceId: string): string {
    return join(this.cacheDir, `${sourceId.replace(/[^a-z0-9]/gi, '_')}.json`)
  }

  /** Load the on-disk catalogue for a source (fast path on startup). */
  async loadFromCache(sourceId: string): Promise<boolean> {
    const file = this.cacheFile(sourceId)
    if (!existsSync(file)) return false
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as SourceData
      this.data.set(sourceId, parsed)
      return true
    } catch {
      return false
    }
  }

  getEpg(sourceId: string): EpgStore {
    let s = this.epg.get(sourceId)
    if (!s) {
      s = new EpgStore()
      this.epg.set(sourceId, s)
    }
    return s
  }

  /** Full refresh of a source from the network. Emits progress throughout. */
  async refreshSource(
    source: Source,
    settings: AppSettings,
    onProgress: ProgressFn,
    force = true
  ): Promise<SourceData> {
    const ua = source.userAgent || settings.userAgent
    const timeout = settings.networkTimeoutMs

    onProgress({ sourceId: source.id, phase: 'connecting', message: `Connecting to ${source.name}…` })

    let result: SourceData
    if (source.kind === 'xtream') {
      const auth = await xtream.authenticate(source, ua, timeout)
      if (!auth.ok) throw new Error(auth.message)

      onProgress({ sourceId: source.id, phase: 'categories', message: 'Fetching categories…' })
      const categories = await xtream.getCategories(source, ua, timeout)

      onProgress({ sourceId: source.id, phase: 'channels', message: 'Fetching live channels…' })
      const live = await xtream.getLiveStreams(source, ua, timeout)

      onProgress({
        sourceId: source.id,
        phase: 'channels',
        message: 'Fetching movies & series…',
        count: live.length
      })
      const [vod, series] = await Promise.all([
        xtream.getVod(source, ua, timeout).catch(() => []),
        xtream.getSeries(source, ua, timeout).catch(() => [])
      ])

      result = {
        channels: [...live, ...vod, ...series],
        categories,
        epgUrl: source.epgUrl || xtream.xtreamEpgUrl(source)
      }
    } else {
      onProgress({ sourceId: source.id, phase: 'channels', message: 'Downloading playlist…' })
      const m3u = await loadM3u(source, ua, timeout)
      result = {
        channels: m3u.channels,
        categories: m3u.categories,
        epgUrl: source.epgUrl || m3u.epgUrl
      }
    }

    this.data.set(source.id, result)
    await this.persist(source.id, result)

    // EPG in the background — a failure here must never block the channel list.
    if (result.epgUrl) {
      onProgress({ sourceId: source.id, phase: 'epg', message: 'Loading TV guide…' })
      try {
        const epgRes = await this.getEpg(source.id).ensure(
          source.id,
          result.epgUrl,
          ua,
          settings.epgTtlHours,
          timeout,
          force
        )
        onProgress({ sourceId: source.id, phase: 'epg', message: epgRes.message, count: epgRes.channels })
      } catch (e) {
        onProgress({
          sourceId: source.id,
          phase: 'epg',
          message: `Guide unavailable: ${(e as Error).message}`
        })
      }
    }

    onProgress({
      sourceId: source.id,
      phase: 'done',
      message: `${result.channels.length} items loaded.`,
      count: result.channels.length
    })
    return result
  }

  /** Warm the EPG from cache (or network) without reloading channels. */
  async ensureEpg(source: Source, settings: AppSettings, force = false): Promise<void> {
    const data = this.data.get(source.id)
    const epgUrl = source.epgUrl || data?.epgUrl
    if (!epgUrl) return
    await this.getEpg(source.id)
      .ensure(
        source.id,
        epgUrl,
        source.userAgent || settings.userAgent,
        settings.epgTtlHours,
        settings.networkTimeoutMs,
        force
      )
      .catch(() => {})
  }

  private async persist(sourceId: string, data: SourceData): Promise<void> {
    try {
      await mkdir(this.cacheDir, { recursive: true })
      await writeFile(this.cacheFile(sourceId), JSON.stringify(data))
    } catch {
      /* non-fatal */
    }
  }

  getChannels(sourceId: string, type?: StreamType): Channel[] {
    const d = this.data.get(sourceId)
    if (!d) return []
    return type ? d.channels.filter((c) => c.type === type) : d.channels
  }

  getCategories(sourceId: string, type?: StreamType): Category[] {
    const d = this.data.get(sourceId)
    if (!d) return []
    return type ? d.categories.filter((c) => c.type === type) : d.categories
  }

  getChannel(channelId: string): Channel | undefined {
    for (const d of this.data.values()) {
      const c = d.channels.find((x) => x.id === channelId)
      if (c) return c
    }
    return undefined
  }

  drop(sourceId: string): void {
    this.data.delete(sourceId)
    this.epg.delete(sourceId)
  }

  hasData(sourceId: string): boolean {
    return this.data.has(sourceId)
  }
}
