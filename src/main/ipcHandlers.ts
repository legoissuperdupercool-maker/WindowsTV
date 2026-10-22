import { ipcMain, shell } from 'electron'
import { IPC, type PlayerCommand, type VideoRegion } from '../shared/ipc'
import type { Result, Source, StreamType } from '../shared/types'
import { getSettings, updateSettings } from './store'
import type { Catalog } from './services/catalog'
import type { MpvPlayer } from './mpv/MpvPlayer'
import { type WindowManager, launchInstalledApp } from './windows'
import * as xtream from './services/xtream'
import { probeStream } from './net/http'

export interface MainContext {
  catalog: Catalog
  player: MpvPlayer
  windows: WindowManager
  mpvInfo: { path?: string; reason?: string }
  restartPlayer: () => Promise<void>
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

  ipcMain.handle(IPC.settingsUpdate, async (_e, partial) => {
    try {
      const before = getSettings()
      const after = updateSettings(partial)
      // Restart mpv only if a startup-time option actually changed.
      const playerKeys = ['mpvPath', 'userAgent', 'cacheSeconds', 'hwdec', 'deinterlace', 'networkTimeoutMs']
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
  ipcMain.handle(IPC.catalogLoad, async (_e, args: { sourceId: string; force?: boolean }) => {
    const settings = getSettings()
    const source = settings.sources.find((s) => s.id === args.sourceId)
    if (!source) return fail('Source not found')
    const onProgress = (p: unknown): void => windows.send(IPC.catalogProgress, p)
    try {
      // Fast path: show cached catalogue immediately, then refresh if stale/forced.
      const hadCache = catalog.hasData(source.id) || (await catalog.loadFromCache(source.id))
      if (hadCache && !args.force) {
        void catalog.refreshSource(source, settings, onProgress, false).catch((e) =>
          onProgress({ sourceId: source.id, phase: 'error', message: (e as Error).message })
        )
        await catalog.ensureEpg(source, settings, false)
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
    (_e, args: { sourceId: string; type?: StreamType }) => {
      try {
        return ok({
          channels: catalog.getChannels(args.sourceId, args.type),
          categories: catalog.getCategories(args.sourceId, args.type)
        })
      } catch (e) {
        return fail(e)
      }
    }
  )

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
  ipcMain.handle(IPC.playerLoad, async (_e, args: { channelId: string }) => {
    const settings = getSettings()
    const channel = catalog.getChannel(args.channelId)
    if (!channel) return fail('Channel not found')
    const source = settings.sources.find((s) => s.id === channel.sourceId)
    const ua = source?.userAgent || settings.userAgent
    try {
      await ctx.player.load(channel.url, {
        title: channel.name,
        channelId: channel.id,
        userAgent: ua,
        startTimeoutMs: settings.networkTimeoutMs + 6000
      })
      return ok(true)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(
    IPC.playerLoadUrl,
    async (_e, args: { url: string; title?: string; sourceId?: string }) => {
      const settings = getSettings()
      const source = settings.sources.find((s) => s.id === args.sourceId)
      const ua = source?.userAgent || settings.userAgent
      try {
        await ctx.player.load(args.url, {
          title: args.title,
          userAgent: ua,
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
    }
    return ok(true)
  })

  ipcMain.handle(IPC.playerSetRegion, (_e, region: VideoRegion) => {
    windows.setVideoRegion(region)
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

  ipcMain.handle(IPC.appInfo, () =>
    ok({
      mpvPath: ctx.mpvInfo.path,
      mpvReason: ctx.mpvInfo.reason,
      versions: process.versions
    })
  )
}
