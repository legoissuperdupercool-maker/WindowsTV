import { app, ipcMain, shell } from 'electron'
import { IPC, type PlayerCommand, type UpdateState, type VideoRegion } from '../shared/ipc'
import type { LoadProgress, PlayOptions, Result, Source, StreamType } from '../shared/types'
import type { WatchProgress } from './progress'
import { avatarImage, backgroundImage, pickAvatar, type Profiles } from './profiles'
import type { Vpn } from './vpn'
import { dialog } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { getSettings, store, updateSettings } from './store'
import { checkLicense } from './license'
import type { Catalog } from './services/catalog'
import type { MpvPlayer } from './mpv/MpvPlayer'
import { type WindowManager, launchInstalledApp } from './windows'
import type { MultiView } from './multiview'
import { defaultRecordFolder, type Recorder } from './recorder'
import * as xtream from './services/xtream'
import { probeStream } from './net/http'
import { buildCatchupUrl } from './services/catchup'

export interface MainContext {
  catalog: Catalog
  player: MpvPlayer
  windows: WindowManager
  mpvInfo: { path?: string; reason?: string }
  restartPlayer: () => Promise<void>
  updater: { check: () => void; install: () => void; getState: () => UpdateState }
  progress: WatchProgress
  profiles: Profiles
  vpn: Vpn
  multiview: MultiView
  recorder: Recorder
}

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}
function fail(error: unknown): Result<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

export function registerIpc(ctx: MainContext): void {
  // `catalog` and `windows` are stable for the app's lifetime; `player` can be
  // replaced by restartPlayer(), so always read it through `ctx.player`.
  const { catalog, windows } = ctx

  // ---------------------------------------------------------------- settings
  ipcMain.handle(IPC.settingsGet, () => ok(getSettings()))

  // ------------------------------------------------------------ ello Premium
  ipcMain.handle(IPC.licenseGet, () => ok(checkLicense(getSettings().licenseKey)))
  ipcMain.handle(IPC.licenseSet, (_e, key: string) => {
    const state = checkLicense(key)
    // Only a valid key is saved; an empty one removes the licence.
    if (state.premium) updateSettings({ licenseKey: key.trim() })
    else if (!key.trim()) store.delete('licenseKey')
    return ok(state)
  })

  ipcMain.handle(IPC.settingsUpdate, async (_e, partial) => {
    try {
      const before = getSettings()
      const after = updateSettings(partial)
      // Restart mpv only if a startup-time option actually changed.
      const playerKeys = ['mpvPath', 'userAgent', 'cacheSeconds', 'hwdec', 'videoOutput', 'deinterlace', 'networkTimeoutMs']
      if (playerKeys.some((k) => (before as never)[k] !== (after as never)[k])) {
        await ctx.restartPlayer()
      }
      return ok(after)
    } catch (e) {
      return fail(e)
    }
  })

  // ---------------------------------------------------------------- sources
  ipcMain.handle(IPC.sourcesSave, (_e, source: Source) => {
    try {
      const settings = getSettings()
      const sources = [...settings.sources]
      const idx = sources.findIndex((s) => s.id === source.id)
      if (idx >= 0) sources[idx] = source
      else sources.push(source)
      return ok(updateSettings({ sources }))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(IPC.sourcesRemove, (_e, sourceId: string) => {
    try {
      const settings = getSettings()
      catalog.drop(sourceId)
      return ok(
        updateSettings({
          sources: settings.sources.filter((s) => s.id !== sourceId),
          lastSourceId: settings.lastSourceId === sourceId ? undefined : settings.lastSourceId
        })
      )
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(IPC.sourceTest, async (_e, source: Source) => {
    const settings = getSettings()
    const ua = source.userAgent || settings.userAgent
    try {
      if (source.kind === 'xtream') {
        return ok(await xtream.testXtream(source, ua, settings.networkTimeoutMs))
      }
      const probe = await probeStream(source.url, { userAgent: ua, timeoutMs: settings.networkTimeoutMs })
      return ok({
        ok: probe.ok,
        message: probe.ok ? 'Playlist URL is reachable.' : probe.reason || 'Unreachable.'
      })
    } catch (e) {
      return ok({ ok: false, message: e instanceof Error ? e.message : String(e) })
    }
  })

  // ---------------------------------------------------------------- catalogue
  /** Lists older than this are refreshed in the background. */
  const CATALOG_MAX_AGE_MS = 12 * 3600_000
  const backgroundRefreshing = new Set<string>()
  /** Run `job` once nothing is playing (checked every 20 s). */
  const whenNotPlaying = (job: () => Promise<unknown>): Promise<unknown> =>
    new Promise((resolve) => {
      const tryRun = (): void => {
        const status = ctx.player.getState().status
        if (status === 'idle' || status === 'error') resolve(job())
        else setTimeout(tryRun, 20_000)
      }
      tryRun()
    })
  ipcMain.handle(IPC.catalogLoad, async (_e, args: { sourceId: string; force?: boolean }) => {
    const settings = getSettings()
    const source = settings.sources.find((s) => s.id === args.sourceId)
    if (!source) return fail('Source not found')
    const onProgress = (p: unknown): void => windows.send(IPC.catalogProgress, p)
    try {
      // Fast path: show the cached catalogue immediately. Only refresh it when
      // it's out of date, quietly, one list at a time, and never while something
      // is playing: big list downloads compete with the stream for bandwidth and
      // for the provider's (often 1–2) allowed connections, which causes buffering.
      const hadCache = catalog.hasData(source.id) || (await catalog.loadFromCache(source.id))
      if (hadCache && !args.force) {
        if (catalog.isStale(source.id, CATALOG_MAX_AGE_MS) && !backgroundRefreshing.has(source.id)) {
          backgroundRefreshing.add(source.id)
          const quiet = (p: LoadProgress): void => onProgress({ ...p, quiet: true })
          void whenNotPlaying(() =>
            catalog
              .refreshSource(source, getSettings(), quiet, false, true)
              .catch(() => {
                /* keep the cached lists; try again next start */
              })
              .finally(() => backgroundRefreshing.delete(source.id))
          )
        } else {
          void whenNotPlaying(() => catalog.ensureEpg(source, settings, false))
        }
        return ok({ count: catalog.getChannels(source.id).length, cached: true })
      }
      const data = await catalog.refreshSource(source, settings, onProgress, Boolean(args.force))
      return ok({ count: data.channels.length, cached: false })
    } catch (e) {
      onProgress({ sourceId: source.id, phase: 'error', message: (e as Error).message })
      return fail(e)
    }
  })

  ipcMain.handle(
    IPC.catalogGet,
    (_e, args: { sourceId: string; type?: StreamType; offset?: number; limit?: number }) => {
      try {
        // Big lists go over in pages: one huge message blocks both processes while
        // it's copied (hundreds of ms for tens of thousands of titles).
        const all = catalog.getChannels(args.sourceId, args.type)
        const offset = Math.max(0, args.offset ?? 0)
        const channels = args.limit ? all.slice(offset, offset + args.limit) : all
        return ok({
          channels,
          categories: offset === 0 ? catalog.getCategories(args.sourceId, args.type) : [],
          total: all.length
        })
      } catch (e) {
        return fail(e)
      }
    }
  )

  // Movie info rarely changes; cache it for the session (key: source + vod id).
  const vodInfoCache = new Map<string, unknown>()
  ipcMain.handle(IPC.vodInfo, async (_e, args: { sourceId: string; vodId: string }) => {
    const key = `${args.sourceId}:${args.vodId}`
    if (vodInfoCache.has(key)) return ok(vodInfoCache.get(key))
    const settings = getSettings()
    const source = settings.sources.find((s) => s.id === args.sourceId)
    if (!source || source.kind !== 'xtream') return fail('Movie details need an Xtream source.')
    try {
      const info = await xtream.getVodInfo(source, args.vodId, source.userAgent || settings.userAgent, settings.networkTimeoutMs)
      vodInfoCache.set(key, info)
      return ok(info)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(IPC.seriesInfo, async (_e, args: { sourceId: string; seriesId: string }) => {
    const settings = getSettings()
    const source = settings.sources.find((s) => s.id === args.sourceId)
    if (!source || source.kind !== 'xtream') return fail('Series episodes require an Xtream source.')
    try {
      const eps = await xtream.getSeriesInfo(
        source,
        args.seriesId,
        source.userAgent || settings.userAgent,
        settings.networkTimeoutMs
      )
      return ok(eps)
    } catch (e) {
      return fail(e)
    }
  })

  // ---------------------------------------------------------------- EPG
  ipcMain.handle(
    IPC.epgNowNext,
    (_e, args: { sourceId: string; epgChannelId?: string; name?: string }) => {
      try {
        return ok(catalog.getEpg(args.sourceId).getNowNext(args.epgChannelId, args.name))
      } catch (e) {
        return fail(e)
      }
    }
  )

  ipcMain.handle(
    IPC.epgForChannel,
    (_e, args: { sourceId: string; epgChannelId?: string; name?: string; from: number; to: number }) => {
      try {
        return ok(
          catalog.getEpg(args.sourceId).getForChannel(args.epgChannelId, args.name, args.from, args.to)
        )
      } catch (e) {
        return fail(e)
      }
    }
  )

  ipcMain.handle(
    IPC.epgGrid,
    (
      _e,
      args: { sourceId: string; channels: Array<{ id: string; epgChannelId?: string; name: string }>; from: number; to: number }
    ) => {
      try {
        const epg = catalog.getEpg(args.sourceId)
        const grid: Record<string, unknown> = {}
        for (const ch of args.channels) {
          grid[ch.id] = epg.getForChannel(ch.epgChannelId, ch.name, args.from, args.to)
        }
        return ok(grid)
      } catch (e) {
        return fail(e)
      }
    }
  )

  ipcMain.handle(IPC.epgRefresh, async (_e, sourceId: string) => {
    const settings = getSettings()
    const source = settings.sources.find((s) => s.id === sourceId)
    if (!source) return fail('Source not found')
    try {
      await catalog.ensureEpg(source, settings, true)
      return ok(true)
    } catch (e) {
      return fail(e)
    }
  })

  // ---------------------------------------------------------------- favourites / recents
  ipcMain.handle(IPC.favoriteToggle, (_e, channelId: string) => {
    const s = getSettings()
    const favorites = s.favorites.includes(channelId)
      ? s.favorites.filter((f) => f !== channelId)
      : [...s.favorites, channelId]
    return ok(updateSettings({ favorites }))
  })

  ipcMain.handle(IPC.recentAdd, (_e, channelId: string) => {
    const s = getSettings()
    const recents = [channelId, ...s.recents.filter((r) => r !== channelId)].slice(0, 30)
    return ok(updateSettings({ recents }))
  })

  // ---------------------------------------------------------------- player
  ipcMain.handle(IPC.playerLoad, async (_e, args: { channelId: string; opts?: PlayOptions }) => {
    const settings = getSettings()
    const channel = catalog.getChannel(args.channelId)
    if (!channel) return fail('This title isn’t in your provider’s list any more (or the list hasn’t loaded yet). Try again in a moment, or use Reload in Settings.')
    const source = settings.sources.find((s) => s.id === channel.sourceId)
    const ua = source?.userAgent || settings.userAgent
    // Movies are tracked for "Continue watching"; live TV isn't.
    const isMovie = channel.type === 'movie'
    ctx.progress.begin(
      isMovie
        ? { key: channel.id, kind: 'movie', sourceId: channel.sourceId, channelId: channel.id, title: channel.name, poster: args.opts?.poster ?? channel.logo }
        : null
    )
    const startSeconds = isMovie && args.opts?.resume !== false ? ctx.progress.resumePosition(channel.id) : undefined
    try {
      await ctx.player.load(channel.url, {
        title: channel.name,
        channelId: channel.id,
        userAgent: ua,
        startTimeoutMs: settings.networkTimeoutMs + 6000,
        startSeconds
      })
      return ok(true)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(
    IPC.playerLoadUrl,
    async (_e, args: { url: string; title?: string; sourceId?: string; opts?: PlayOptions }) => {
      const settings = getSettings()
      const source = settings.sources.find((s) => s.id === args.sourceId)
      const ua = source?.userAgent || settings.userAgent
      const ep = args.opts?.episode
      const key = ep && args.sourceId ? `${args.sourceId}:ep:${ep.episodeId}` : null
      ctx.progress.begin(
        key && ep && args.sourceId
          ? {
              key,
              kind: 'episode',
              sourceId: args.sourceId,
              url: args.url,
              title: ep.seriesName,
              subtitle: `S${ep.season} E${ep.episode} · ${ep.title}`,
              poster: args.opts?.poster,
              series: { id: ep.seriesId, name: ep.seriesName, season: ep.season, episode: ep.episode, episodeId: ep.episodeId, title: ep.title }
            }
          : null
      )
      const startSeconds = key && args.opts?.resume !== false ? ctx.progress.resumePosition(key) : undefined
      try {
        await ctx.player.load(args.url, {
          title: args.title,
          userAgent: ua,
          startTimeoutMs: settings.networkTimeoutMs + 6000,
          startSeconds
        })
        return ok(true)
      } catch (e) {
        return fail(e)
      }
    }
  )

  // Replay a past programme from the Guide (catch-up / timeshift).
  ipcMain.handle(
    IPC.playerCatchup,
    async (_e, args: { channelId: string; start: number; stop: number; title?: string }) => {
      const settings = getSettings()
      const channel = catalog.getChannel(args.channelId)
      if (!channel) return fail('Channel not found')
      const source = settings.sources.find((s) => s.id === channel.sourceId)
      if (!source) return fail('Source not found')
      const { url, reason } = buildCatchupUrl(channel, source, args.start, args.stop, catalog.getClock(source.id))
      if (!url) return fail(reason ?? 'Catch-up isn’t available for this programme.')
      ctx.progress.begin(null)
      try {
        await ctx.player.load(url, {
          title: args.title ?? channel.name,
          channelId: channel.id,
          userAgent: source.userAgent || settings.userAgent,
          startTimeoutMs: settings.networkTimeoutMs + 6000
        })
        return ok(true)
      } catch (e) {
        return fail(e)
      }
    }
  )

  ipcMain.handle(IPC.playerProbe, async (_e, args: { channelId: string }) => {
    const settings = getSettings()
    const channel = catalog.getChannel(args.channelId)
    if (!channel) return fail('Channel not found')
    const source = settings.sources.find((s) => s.id === channel.sourceId)
    const ua = source?.userAgent || settings.userAgent
    return ok(await probeStream(channel.url, { userAgent: ua, timeoutMs: settings.networkTimeoutMs }))
  })

  ipcMain.handle(IPC.playerCommand, (_e, cmd: PlayerCommand) => {
    const player = ctx.player
    switch (cmd.action) {
      case 'play':
        player.play()
        break
      case 'pause':
        player.pause()
        break
      case 'toggle':
        player.togglePause()
        break
      case 'stop':
        player.stop()
        break
      case 'seek':
        if (typeof cmd.value === 'number') player.seekAbsolute(cmd.value)
        break
      case 'seekRelative':
        if (typeof cmd.value === 'number') player.seekRelative(cmd.value)
        break
      case 'volume':
        if (typeof cmd.value === 'number') player.setVolume(cmd.value)
        break
      case 'mute':
        player.setMuted(true)
        break
      case 'unmute':
        player.setMuted(false)
        break
      case 'toggleMute':
        player.toggleMute()
        break
      case 'cycleAudio':
        player.cycleAudio()
        break
      case 'cycleSub':
        player.cycleSub()
        break
      case 'setAudioTrack':
        if (typeof cmd.value === 'number') player.setAudioTrack(cmd.value)
        break
      case 'setSubTrack':
        if (typeof cmd.value === 'number') player.setSubTrack(cmd.value)
        break
      case 'subScale':
        if (typeof cmd.value === 'number') player.setSubScale(cmd.value)
        break
      case 'subDelay':
        if (typeof cmd.value === 'number') player.setSubDelay(cmd.value)
        break
      case 'audioDelay':
        if (typeof cmd.value === 'number') player.setAudioDelay(cmd.value)
        break
    }
    return ok(true)
  })

  ipcMain.handle(IPC.playerSetRegion, (_e, region: VideoRegion) => {
    windows.setVideoRegion(region)
    return ok(true)
  })

  // ---------------------------------------------------------------- multi-view
  const guardAsync = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
    try {
      return ok(await fn())
    } catch (e) {
      return fail(e)
    }
  }
  ipcMain.handle(IPC.multiviewLayout, (_e, n: number) =>
    guardAsync(async () => {
      ctx.player.stop() // the single player makes room (provider connection limits)
      await ctx.multiview.setLayout(n)
      return true
    })
  )
  ipcMain.handle(IPC.multiviewLoad, (_e, args: { index: number; channelId: string }) =>
    guardAsync(async () => {
      const settings = getSettings()
      const channel = catalog.getChannel(args.channelId)
      if (!channel) throw new Error('This channel isn’t in your provider’s list any more.')
      const source = settings.sources.find((s) => s.id === channel.sourceId)
      await ctx.multiview.load(args.index, channel.url, {
        channelId: channel.id,
        title: channel.name,
        userAgent: source?.userAgent || settings.userAgent
      })
      return true
    })
  )
  ipcMain.handle(IPC.multiviewClear, (_e, index: number) => guard(() => (ctx.multiview.clear(index), true)))
  ipcMain.handle(IPC.multiviewAudio, (_e, index: number) => guard(() => (ctx.multiview.setAudio(index), true)))
  ipcMain.handle(IPC.multiviewRegions, (_e, regions: VideoRegion[]) => guard(() => (ctx.multiview.setRegions(regions), true)))
  ipcMain.handle(IPC.multiviewStop, () => guardAsync(async () => (await ctx.multiview.stop(), true)))

  // ---------------------------------------------------------------- recording + reminders
  ipcMain.handle(IPC.recList, () => ok({ ...ctx.recorder.list(), folder: getSettings().recordFolder || defaultRecordFolder() }))
  ipcMain.handle(IPC.recNow, (_e, a: { channelId: string; title?: string; stop?: number }) =>
    guard(() => ctx.recorder.recordNow(a.channelId, a.title, a.stop))
  )
  ipcMain.handle(IPC.recSchedule, (_e, a: { channelId: string; title: string; start: number; stop: number }) =>
    guard(() => ctx.recorder.schedule(a.channelId, a.title, a.start, a.stop))
  )
  ipcMain.handle(IPC.recStop, (_e, id: string) => guard(() => (ctx.recorder.stop(id), true)))
  ipcMain.handle(IPC.recRemove, (_e, id: string) => guard(() => (ctx.recorder.remove(id), true)))
  ipcMain.handle(IPC.recReminderAdd, (_e, a: { channelId: string; title: string; start: number }) =>
    guard(() => ctx.recorder.addReminder(a.channelId, a.title, a.start))
  )
  ipcMain.handle(IPC.recReminderRemove, (_e, id: string) => guard(() => (ctx.recorder.removeReminder(id), true)))
  ipcMain.handle(IPC.recPickFolder, async () => {
    const r = await dialog.showOpenDialog(windows.uiWindow, {
      title: 'Where should recordings be saved?',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return ok(null)
    updateSettings({ recordFolder: r.filePaths[0] })
    return ok(r.filePaths[0])
  })
  ipcMain.handle(IPC.recOpenFolder, async (_e, file?: string) => {
    if (file) shell.showItemInFolder(file)
    else await shell.openPath(getSettings().recordFolder || defaultRecordFolder())
    return ok(true)
  })

  // ---------------------------------------------------------------- windowing / misc
  ipcMain.handle(IPC.windowControl, (_e, action: string) => {
    windows.control(action)
    return ok(true)
  })

  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    shell.openExternal(url)
    return ok(true)
  })

  // ---------------------------------------------------------------- in-app web apps
  ipcMain.handle(IPC.webappOpen, (_e, args: { url: string; userAgent?: string }) => {
    windows.openWebApp(args.url, args.userAgent)
    return ok(true)
  })
  ipcMain.handle(IPC.webappClose, () => {
    windows.closeWebApp()
    return ok(true)
  })
  ipcMain.handle(IPC.webappBack, () => {
    windows.webAppBack()
    return ok(true)
  })
  ipcMain.handle(IPC.webappHome, () => {
    windows.webAppHome()
    return ok(true)
  })
  ipcMain.handle(IPC.webappReload, () => {
    windows.webAppReload()
    return ok(true)
  })

  // ---------------------------------------------------------------- installed apps
  ipcMain.handle(IPC.appLaunch, async (_e, target: string) => {
    return ok(await launchInstalledApp(target))
  })

  ipcMain.handle(IPC.progressList, (_e, sourceId?: string) => ok(ctx.progress.list(sourceId)))
  ipcMain.handle(IPC.progressHistory, (_e, sourceId?: string) => ok(ctx.progress.history(sourceId)))

  // ---------------------------------------------------------------- profiles / My List
  const guard = <T>(fn: () => T): Result<T> => {
    try {
      return ok(fn())
    } catch (e) {
      return fail(e)
    }
  }
  // ---------------------------------------------------------------- built-in VPN
  ipcMain.handle(IPC.vpnGet, () => ok(ctx.vpn.getState()))
  ipcMain.handle(IPC.vpnImport, async () => {
    try {
      const res = await dialog.showOpenDialog(windows.uiWindow, {
        title: 'Choose a WireGuard configuration file',
        properties: ['openFile'],
        filters: [{ name: 'WireGuard configuration', extensions: ['conf'] }]
      })
      if (res.canceled || !res.filePaths[0]) return ok(null)
      const file = res.filePaths[0]
      if (statSync(file).size > 64 * 1024) throw new Error('That file is too big to be a WireGuard configuration.')
      return ok(ctx.vpn.importConfig(readFileSync(file, 'utf8'), basename(file)))
    } catch (e) {
      return fail(e)
    }
  })
  ipcMain.handle(IPC.vpnSetEnabled, async (_e, enabled: boolean) => {
    try {
      return ok(await ctx.vpn.setEnabled(Boolean(enabled)))
    } catch (e) {
      return fail(e)
    }
  })
  ipcMain.handle(IPC.vpnRemove, () => ok(ctx.vpn.removeConfig()))
  ipcMain.handle(IPC.vpnCheck, async () => {
    try {
      return ok(await ctx.vpn.check())
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(IPC.profilesGet, () => ok(ctx.profiles.get()))
  ipcMain.handle(IPC.profileSelect, (_e, id: string) => guard(() => ctx.profiles.select(id)))
  ipcMain.handle(IPC.profileSave, (_e, p) => guard(() => ctx.profiles.save(p)))
  ipcMain.handle(IPC.profileDelete, (_e, id: string) => guard(() => ctx.profiles.delete(id)))
  ipcMain.handle(IPC.myListToggle, (_e, item) => guard(() => ctx.profiles.toggleMyList(item)))
  ipcMain.handle(IPC.profilePickBackground, async (_e, id: string) => {
    try {
      return ok(await ctx.profiles.pickBackground(windows.uiWindow, id))
    } catch (e) {
      return fail(e)
    }
  })
  ipcMain.handle(IPC.profileBackgroundImage, (_e, background: string) => ok(backgroundImage(background)))
  ipcMain.handle(IPC.profilePickAvatar, async () => {
    try {
      return ok(await pickAvatar(windows.uiWindow))
    } catch (e) {
      return fail(e)
    }
  })
  ipcMain.handle(IPC.profileAvatarImage, (_e, avatar: string) => ok(avatarImage(avatar)))
  ipcMain.handle(IPC.progressGet, (_e, key: string) => ok(ctx.progress.get(key) ?? null))
  ipcMain.handle(IPC.progressSeries, (_e, args: { sourceId: string; seriesId: string }) =>
    ok(ctx.progress.forSeries(args.sourceId, args.seriesId))
  )

  ipcMain.handle(IPC.updateGetState, () => ok(ctx.updater.getState()))
  ipcMain.handle(IPC.updateCheck, () => (ctx.updater.check(), ok(true)))
  ipcMain.handle(IPC.updateInstall, () => (ctx.updater.install(), ok(true)))

  ipcMain.handle(IPC.appInfo, () =>
    ok({
      version: app.getVersion(),
      mpvPath: ctx.mpvInfo.path,
      mpvReason: ctx.mpvInfo.reason,
      versions: process.versions
    })
  )
}
