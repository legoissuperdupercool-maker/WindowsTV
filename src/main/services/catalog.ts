import { app } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
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
import type { ServerClock } from './catchup'

type ProgressFn = (p: LoadProgress) => void

interface SourceData {
  channels: Channel[]
  categories: Category[]
  epgUrl?: string
  /** Provider clock (Xtream), needed for catch-up start times. */
  clock?: ServerClock
  /** When the lists were downloaded (ms epoch). */
  fetchedAt?: number
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
      // Caches written before fetchedAt existed: the file's date is close enough.
      parsed.fetchedAt ??= statSync(file).mtimeMs
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

  /** True when the lists are older than `maxAgeMs` (or were never downloaded). */
  isStale(sourceId: string, maxAgeMs: number): boolean {
    const at = this.data.get(sourceId)?.fetchedAt
    return !at || Date.now() - at > maxAgeMs
  }

  /**
   * Full refresh of a source from the network. Emits progress throughout.
   * `sequential` downloads the live / movie / series lists one after another
   * (one connection at a time — gentler on providers' connection limits);
   * otherwise in parallel, which is faster when someone is waiting for them.
   */
  async refreshSource(
    source: Source,
    settings: AppSettings,
    onProgress: ProgressFn,
    force = true,
    sequential = false
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

      onProgress({ sourceId: source.id, phase: 'channels', message: 'Fetching channels, movies & series…' })
      // Fetch all three lists together and keep whatever succeeds, so one slow
      // or broken list (common on overloaded panels) doesn't leave you with nothing.
      const lists = [
        () => xtream.getLiveStreams(source, ua, timeout),
        () => xtream.getVod(source, ua, timeout),
        () => xtream.getSeries(source, ua, timeout)
      ]
      const settled = <T>(p: Promise<T>): Promise<PromiseSettledResult<T>> =>
        p.then((value) => ({ status: 'fulfilled', value }) as const, (reason) => ({ status: 'rejected', reason }) as const)
      const results: PromiseSettledResult<Channel[]>[] = []
      if (sequential) for (const get of lists) results.push(await settled(get()))
      else results.push(...(await Promise.all(lists.map((get) => settled(get())))))
      const [liveR, vodR, seriesR] = results
      const live = liveR.status === 'fulfilled' ? liveR.value : []
      const vod = vodR.status === 'fulfilled' ? vodR.value : []
      const series = seriesR.status === 'fulfilled' ? seriesR.value : []
      if (!live.length && !vod.length && !series.length) {
        const err = [liveR, vodR, seriesR].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
        throw new Error(
          err ? `Logged in, but couldn't download the channel list: ${(err.reason as Error).message}` : 'Logged in, but the provider returned no channels, movies or series.'
        )
      }
      if (liveR.status === 'rejected') {
        onProgress({ sourceId: source.id, phase: 'channels', message: `Live channels failed: ${(liveR.reason as Error).message}` })
      }

      result = {
        channels: [...live, ...vod, ...series],
        categories,
        epgUrl: source.epgUrl || xtream.xtreamEpgUrl(source),
        clock: auth.clock,
        fetchedAt: Date.now()
      }
    } else {
      onProgress({ sourceId: source.id, phase: 'channels', message: 'Downloading playlist…' })
      const m3u = await loadM3u(source, ua, timeout)
      result = {
        channels: m3u.channels,
        categories: m3u.categories,
        epgUrl: source.epgUrl || m3u.epgUrl,
        fetchedAt: Date.now()
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

  getClock(sourceId: string): ServerClock {
    return this.data.get(sourceId)?.clock ?? {}
  }

  drop(sourceId: string): void {
    this.data.delete(sourceId)
    this.epg.delete(sourceId)
  }

  hasData(sourceId: string): boolean {
    return this.data.has(sourceId)
  }
}
