import { spawn, ChildProcess } from 'node:child_process'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaTrack, PlaybackState } from '../../shared/types'

interface LoadOptions {
  title?: string
  channelId?: string
  userAgent?: string
  referrer?: string
  /** Seconds to wait for the stream to actually start before declaring failure. */
  startTimeoutMs?: number
  /** Start playback at this position (seconds), e.g. to resume a movie. */
  startSeconds?: number
}

interface MpvConfig {
  binaryPath: string
  wid?: number
  userAgent: string
  cacheSeconds: number
  hwdec: string
  videoOutput?: string
  /** HTTP proxy for streams (the built-in VPN's tunnel). */
  httpProxy?: string
  /** D3D11 adapter (GPU) for mpv to render on; unset = Windows' default. */
  d3d11Adapter?: string
  deinterlace: boolean
  networkTimeoutMs: number
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Wraps a long-lived `mpv --idle` process and talks to it over its JSON IPC pipe.
 *
 * Design goals, in order:
 *  1. Quality  — gpu-next video output, hardware decode, high-quality scaling.
 *  2. Resilience — generous cache + ffmpeg reconnect so IPTV jitter never kills playback.
 *  3. Honesty  — every failure to start is turned into a human error string, so the UI
 *                never shows a silent black screen (the classic UHF "nothing loads").
 */
export class MpvPlayer extends EventEmitter {
  private proc: ChildProcess | null = null
  private sock: net.Socket | null = null
  private cfg: MpvConfig
  private pipePath: string
  private reqId = 1
  private pending = new Map<number, Pending>()
  private buffer = ''
  private startWatchdog: NodeJS.Timeout | null = null
  private started = false
  private adapterReady: Promise<void> = Promise.resolve()
  /** mpv stderr lines since the current load started. */
  private recentLog: string[] = []
  /** Stream open, first frames not playing yet. */
  private opening = false
  /** mpv paused itself to refill its cache. */
  private waitingForCache = false

  private state: PlaybackState = {
    status: 'idle',
    position: 0,
    duration: 0,
    paused: false,
    volume: 100,
    muted: false,
    stats: {}
  }

  constructor(cfg: MpvConfig) {
    super()
    this.cfg = cfg
    // Unique per-process pipe name (Windows named pipe namespace).
    this.pipePath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\windowstv-mpv-${process.pid}-${Date.now()}`
        : join(tmpdir(), `windowstv-mpv-${process.pid}-${Date.now()}.sock`) // development on Linux/macOS
  }

  getState(): PlaybackState {
    return this.state
  }

  /** Render on this GPU once the lookup finishes; mpv's start waits for it. */
  useAdapter(name: Promise<string | undefined>): void {
    this.adapterReady = name.then((n) => {
      this.cfg.d3d11Adapter = n
    })
  }

  /** Launch mpv in idle mode and connect to its IPC pipe. Idempotent. */
  async start(): Promise<void> {
    await this.adapterReady
    if (this.proc) return

    const args = this.buildArgs()
    this.proc = spawn(this.cfg.binaryPath, args, {
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.proc.on('error', (err) => {
      this.setState({
        status: 'error',
        error: `Could not start mpv: ${err.message}. Check the mpv path in Settings.`
      })
      this.emit('fatal', err)
    })
    this.proc.on('exit', (code) => {
      this.cleanupSocket()
      this.proc = null
      this.emit('exit', code)
    })
    // Surface mpv stderr for diagnostics (not shown to users unless they open the log).
    this.proc.stderr?.on('data', (d) => {
      const text = d.toString()
      // Keep recent warnings/errors so a failed load can say *why*.
      for (const line of text.split(/\r?\n/)) if (line.trim()) this.recentLog.push(line.trim())
      if (this.recentLog.length > 40) this.recentLog.splice(0, this.recentLog.length - 40)
      this.emit('log', text)
    })

    await this.connectPipe()
    await this.setupObservers()
  }

  private buildArgs(): string[] {
    const c = this.cfg
    const args = [
      '--idle=yes',
      '--force-window=yes',
      '--terminal=no',
      '--no-input-default-bindings',
      '--no-osc',
      '--osd-level=0',
      `--input-ipc-server=${this.pipePath}`,
      // --- Video quality ---
      ...videoOutputArgs(c.videoOutput),
      ...(c.d3d11Adapter && c.videoOutput !== 'gpu-gl' ? [`--d3d11-adapter=${c.d3d11Adapter}`] : []),
      `--hwdec=${c.hwdec || 'auto-safe'}`,
      '--profile=high-quality',
      '--video-sync=audio',
      '--interpolation=no',
      '--dither-depth=auto',
      c.deinterlace && process.platform === 'win32' ? '--deinterlace=auto' : '--deinterlace=no', // 'auto' needs mpv 0.38+
      // --- Resilience / caching (IPTV jitter) ---
      '--cache=yes',
      `--cache-secs=${Math.max(5, c.cacheSeconds || 30)}`,
      '--demuxer-max-bytes=256MiB',
      '--demuxer-max-back-bytes=64MiB',
      '--demuxer-readahead-secs=20',
      '--hls-bitrate=max',
      `--network-timeout=${Math.round((c.networkTimeoutMs || 15000) / 1000)}`,
      '--stream-lavf-o-append=reconnect=1',
      '--stream-lavf-o-append=reconnect_streamed=1',
      '--stream-lavf-o-append=reconnect_on_network_error=1',
      '--stream-lavf-o-append=reconnect_delay_max=7',
      // --- Audio ---
      '--audio-channels=auto-safe',
      '--volume-max=130',
      // --- Behaviour ---
      '--keep-open=no',
      '--idle=yes',
      `--user-agent=${c.userAgent}`,
      ...(c.httpProxy ? [`--http-proxy=${c.httpProxy}`] : []),
      '--msg-level=all=warn'
    ]
    if (typeof c.wid === 'number' && c.wid > 0) {
      args.push(`--wid=${c.wid}`)
    }
    // Diagnostics: full mpv log to a file (used by the CI video test).
    if (process.env['ELLO_MPV_LOG']) args.push(`--log-file=${process.env['ELLO_MPV_LOG']}`)
    return args
  }

  // ------------------------------------------------------------------ IPC pipe

  private connectPipe(): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 8000
      const attempt = (): void => {
        const sock = net.connect(this.pipePath)
        sock.on('connect', () => {
          this.sock = sock
          sock.setEncoding('utf8')
          sock.on('data', (chunk) => this.onData(chunk.toString()))
          sock.on('error', () => this.cleanupSocket())
          sock.on('close', () => this.cleanupSocket())
          resolve()
        })
        sock.on('error', () => {
          sock.destroy()
          if (Date.now() > deadline) {
            reject(new Error('Timed out connecting to the mpv IPC pipe.'))
          } else {
            setTimeout(attempt, 120)
          }
        })
      }
      attempt()
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof msg.request_id === 'number' && this.pending.has(msg.request_id)) {
        const p = this.pending.get(msg.request_id)!
        clearTimeout(p.timer)
        this.pending.delete(msg.request_id)
        if (msg.error === 'success') p.resolve(msg.data)
        else p.reject(new Error(String(msg.error)))
      } else if (typeof msg.event === 'string') {
        this.onEvent(msg)
      }
    }
  }

  /** Send a command and await its reply. */
  /** Positional (`[name, ...args]`) or named (`{ name, ...args }`) mpv command. */
  private command<T = unknown>(cmd: unknown[] | Record<string, unknown>, timeoutMs = 5000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.sock) return reject(new Error('mpv is not connected'))
      const id = this.reqId++
      const payload = JSON.stringify({ command: cmd, request_id: id }) + '\n'
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('mpv command timed out'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer
      })
      this.sock.write(payload)
    })
  }

  /** Fire-and-forget command (ignore the reply). */
  private send(cmd: unknown[]): void {
    if (!this.sock) return
    try {
      this.sock.write(JSON.stringify({ command: cmd }) + '\n')
    } catch {
      /* socket gone */
    }
  }

  private async setupObservers(): Promise<void> {
    const props = [
      'pause',
      'core-idle',
      'paused-for-cache',
      'cache-buffering-state',
      'demuxer-cache-time',
      'time-pos',
      'duration',
      'volume',
      'mute',
      'width',
      'height',
      'video-codec',
      'audio-codec',
      'estimated-vf-fps',
      'video-bitrate',
      'eof-reached',
      'cache-speed',
      'track-list'
    ]
    let id = 1
    for (const name of props) {
      this.send(['observe_property', id++, name])
    }
  }

  private onEvent(msg: Record<string, unknown>): void {
    const event = msg.event as string
    if (event === 'property-change') {
      this.onProperty(msg.name as string, msg.data)
    } else if (event === 'file-loaded') {
      // The stream is open, but the first frames may still be many seconds
      // away (4K, slow providers): keep showing "loading" until mpv's core is
      // actually running, so the screen is never silently black.
      this.clearWatchdog()
      this.started = true
      this.opening = true
      this.setState({ status: this.state.paused ? 'paused' : 'loading', stage: 'opening', error: undefined })
      this.armOpeningWatchdog()
    } else if (event === 'start-file') {
      this.setState({ status: 'loading' })
    } else if (event === 'end-file') {
      const reason = String(msg.reason ?? '')
      if (reason === 'error') {
        this.clearWatchdog()
        this.opening = false
        const err = this.humanError(String(msg.file_error ?? ''), this.recentLog.join('\n'))
        this.setState({ status: 'error', error: err })
      } else if (reason === 'eof' && this.state.status !== 'idle') {
        this.setState({ status: 'idle', ended: true })
      }
    }
  }

  private onProperty(name: string, data: unknown): void {
    const stats = { ...this.state.stats }
    switch (name) {
      case 'pause':
        this.setState({ paused: Boolean(data) })
        if (this.started) this.setState({ status: this.activeStatus() })
        break
      case 'paused-for-cache':
        this.waitingForCache = Boolean(data)
        if (this.started) this.setState({ status: this.activeStatus() })
        break
      case 'core-idle':
        // false = audio/video are really being played.
        if (data === false && this.opening) {
          this.opening = false
          this.clearWatchdog()
          this.setState({ stage: undefined, status: this.activeStatus() })
        }
        break
      case 'track-list': {
        const list = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []
        const toTrack = (t: Record<string, unknown>): MediaTrack => ({
          id: Number(t.id),
          title: typeof t.title === 'string' ? t.title : undefined,
          lang: typeof t.lang === 'string' ? t.lang : undefined,
          codec: typeof t.codec === 'string' ? t.codec : undefined,
          channels: typeof t['demux-channel-count'] === 'number' ? (t['demux-channel-count'] as number) : undefined,
          selected: Boolean(t.selected),
          external: Boolean(t.external),
          forced: Boolean(t.forced)
        })
        this.setState({
          tracks: {
            audio: list.filter((t) => t.type === 'audio').map(toTrack),
            sub: list.filter((t) => t.type === 'sub').map(toTrack)
          }
        })
        break
      }
      case 'cache-speed':
        stats.downloadBytesPerSec = typeof data === 'number' ? data : undefined
        this.setState({ stats })
        break
      case 'cache-buffering-state':
        this.setState({ cacheBufferingPercent: typeof data === 'number' ? data : undefined })
        break
      case 'demuxer-cache-time':
        stats.demuxerCacheSeconds = typeof data === 'number' ? Math.round(data) : undefined
        this.setState({ stats })
        break
      case 'time-pos':
        if (typeof data === 'number') this.setState({ position: data })
        break
      case 'duration':
        if (typeof data === 'number') this.setState({ duration: data })
        break
      case 'volume':
        if (typeof data === 'number') this.setState({ volume: Math.round(data) })
        break
      case 'mute':
        this.setState({ muted: Boolean(data) })
        break
      case 'width':
        stats.width = typeof data === 'number' ? data : undefined
        this.setState({ stats })
        break
      case 'height':
        stats.height = typeof data === 'number' ? data : undefined
        this.setState({ stats })
        break
      case 'video-codec':
        stats.videoCodec = data ? String(data) : undefined
        this.setState({ stats })
        break
      case 'audio-codec':
        stats.audioCodec = data ? String(data) : undefined
        this.setState({ stats })
        break
      case 'estimated-vf-fps':
        stats.fps = typeof data === 'number' ? Math.round(data * 100) / 100 : undefined
        this.setState({ stats })
        break
      case 'video-bitrate':
        stats.bitrateKbps = typeof data === 'number' ? Math.round(data / 1000) : undefined
        this.setState({ stats })
        break
    }
  }

  /** Status once a stream is open, from the pause / opening / cache flags. */
  private activeStatus(): PlaybackState['status'] {
    if (this.state.paused) return 'paused'
    if (this.opening) return 'loading'
    if (this.waitingForCache) return 'buffering'
    return 'playing'
  }

  /** The stream opened but nothing plays: give up after a while with a reason. */
  private armOpeningWatchdog(): void {
    this.startWatchdog = setTimeout(() => {
      if (this.opening && !this.state.paused && this.state.status !== 'error') {
        this.opening = false
        this.setState({
          status: 'error',
          stage: undefined,
          error:
            'The stream opened but no picture or sound arrived within a minute. The provider may be ' +
            'overloaded or your connection too slow for this stream. Try again, or pick a lower quality version.'
        })
        this.send(['stop'])
      }
    }, 60_000)
  }

  /**
   * Turn mpv's terse end-file error ("loading failed") plus its recent log
   * lines into a reason a person can act on. Log lines can contain the stream
   * URL (with the login in it), so they're only ever shown with URLs removed.
   */
  private humanError(fileError: string, log = ''): string {
    const e = `${fileError}\n${log}`.toLowerCase()
    if (/\b401\b|unauthorized/.test(e)) return 'Your provider rejected the login (HTTP 401). Check the username and password in Settings.'
    if (/\b403\b|forbidden/.test(e))
      return 'Your provider refused this stream (HTTP 403). Your subscription may not include it, you may have too many streams open, or the provider blocks this User-Agent.'
    if (/\b404\b|not found/.test(e)) return 'This title is no longer on your provider’s server (HTTP 404). It may have been removed or moved.'
    if (/\b(429|458|509)\b|too many|max(imum)? connections/.test(e))
      return 'Your provider says you have too many streams open. Close other devices or apps using this account and try again.'
    if (/\b5\d\d\b|bad gateway|service unavailable|internal server error/.test(e))
      return 'Your provider’s server had an error (HTTP 5xx). It’s usually temporary, so try again in a minute.'
    if (/timed out|timeout/.test(e)) return 'Your provider didn’t respond in time. The server may be busy or down.'
    if (/connection refused|could not connect|failed to resolve|name resolution|no route/.test(e))
      return 'Couldn’t reach your provider’s server. Check your internet connection or VPN.'
    if (/ssl|tls|certificate/.test(e)) return 'The secure connection to your provider failed (TLS/SSL error).'
    if (/invalid data|unrecognized file format|no (video|audio) or audio streams|end of file/.test(e))
      return 'The provider sent something that isn’t a playable video. This title may be broken on their side.'
    const detail = log
      .split('\n')
      .reverse()
      .find((l) => /error|fail|cannot|could not/i.test(l))
      ?.replace(/[a-z]+:\/\/\S+/gi, '<stream>')
      .slice(0, 160)
    if (detail) return `The stream failed to start. mpv said: ${detail}`
    if (fileError) return `The stream failed to start (${fileError}). It may be offline or blocked by your provider.`
    return 'The stream failed to start. It may be offline or blocked by your provider.'
  }

  // ------------------------------------------------------------------ Public API

  async load(url: string, opts: LoadOptions = {}): Promise<void> {
    if (!this.sock) await this.start()
    this.started = false
    this.opening = false
    this.waitingForCache = false
    this.recentLog = []
    this.setState({
      status: 'loading',
      stage: 'connecting',
      loadStartedAt: Date.now(),
      ended: false,
      channelId: opts.channelId,
      title: opts.title,
      error: undefined,
      position: 0,
      duration: 0,
      stats: {}
    })

    const headerFields: string[] = []
    if (opts.userAgent) headerFields.push(`User-Agent: ${opts.userAgent}`)
    if (opts.referrer) headerFields.push(`Referer: ${opts.referrer}`)

    // Per-file options. Sent as a *named* argument: mpv 0.38 inserted an
    // `index` parameter before `options`, so the old positional form
    // (loadfile url replace {opts}) fails with "invalid parameter".
    const fileOpts: Record<string, string> = {}
    if (headerFields.length) fileOpts['http-header-fields'] = headerFields.join(',')
    if (opts.startSeconds && opts.startSeconds > 0) fileOpts.start = String(Math.floor(opts.startSeconds))

    // Reset the watchdog: if nothing starts in time, tell the user *why* it's blank.
    this.armWatchdog(opts.startTimeoutMs ?? Math.max(12000, this.cfg.networkTimeoutMs + 5000))

    try {
      await this.command({
        name: 'loadfile',
        url,
        flags: 'replace',
        ...(Object.keys(fileOpts).length ? { options: fileOpts } : {})
      })
    } catch (e) {
      this.clearWatchdog()
      this.setState({
        status: 'error',
        error: `Could not send the stream to mpv: ${(e as Error).message}`
      })
    }
  }

  private armWatchdog(ms: number): void {
    this.clearWatchdog()
    this.startWatchdog = setTimeout(() => {
      if (!this.started && this.state.status !== 'error') {
        this.setState({
          status: 'error',
          error:
            'The stream did not start within the timeout. It may be offline, ' +
            'geo-blocked, or require a different User-Agent (set one on the source in Settings).'
        })
        this.send(['stop'])
      }
    }, ms)
  }

  private clearWatchdog(): void {
    if (this.startWatchdog) {
      clearTimeout(this.startWatchdog)
      this.startWatchdog = null
    }
  }

  play(): void {
    this.send(['set_property', 'pause', false])
  }
  pause(): void {
    this.send(['set_property', 'pause', true])
  }
  togglePause(): void {
    this.send(['cycle', 'pause'])
  }
  stop(): void {
    this.clearWatchdog()
    this.started = false
    this.opening = false
    this.send(['stop'])
    this.setState({ status: 'idle', channelId: undefined, title: undefined })
  }
  seekAbsolute(seconds: number): void {
    this.send(['seek', seconds, 'absolute'])
  }
  seekRelative(delta: number): void {
    this.send(['seek', delta, 'relative'])
  }
  setVolume(vol: number): void {
    this.send(['set_property', 'volume', Math.max(0, Math.min(130, vol))])
  }
  setMuted(muted: boolean): void {
    this.send(['set_property', 'mute', muted])
  }
  toggleMute(): void {
    this.send(['cycle', 'mute'])
  }
  cycleAudio(): void {
    this.send(['cycle', 'audio'])
  }
  cycleSub(): void {
    this.send(['cycle', 'sub'])
  }
  setAudioTrack(id: number): void {
    this.send(['set_property', 'aid', id])
  }
  /** 0 = subtitles off. */
  setSubTrack(id: number): void {
    this.send(['set_property', 'sid', id > 0 ? id : 'no'])
  }
  /** Subtitle size, 1 = normal. */
  setSubScale(scale: number): void {
    this.send(['set_property', 'sub-scale', Math.max(0.5, Math.min(2.5, scale))])
  }
  /** Subtitle timing in seconds (positive = later). */
  setSubDelay(seconds: number): void {
    this.send(['set_property', 'sub-delay', seconds])
  }
  /** Audio timing in seconds (positive = later). */
  setAudioDelay(seconds: number): void {
    this.send(['set_property', 'audio-delay', seconds])
  }

  /** Update the --wid at runtime is not possible; store for next start. */
  setWindowId(wid: number): void {
    this.cfg.wid = wid
  }

  updateConfig(partial: Partial<MpvConfig>): void {
    this.cfg = { ...this.cfg, ...partial }
  }

  async quit(): Promise<void> {
    this.clearWatchdog()
    this.send(['quit'])
    this.cleanupSocket()
    if (this.proc) {
      const p = this.proc
      setTimeout(() => {
        if (!p.killed) p.kill()
      }, 1000)
    }
  }

  private cleanupSocket(): void {
    if (this.sock) {
      this.sock.removeAllListeners()
      this.sock.destroy()
      this.sock = null
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('mpv disconnected'))
    }
    this.pending.clear()
  }

  private setState(partial: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...partial }
    this.emit('state', this.state)
  }
}

export type { MpvConfig, LoadOptions }

/**
 * mpv renderer flags for the "Video renderer" setting.
 *
 * --d3d11-flip=no: mpv draws into a child window of ours (--wid). With the
 * default flip-model swapchain, laptops with two GPUs (e.g. Intel/AMD + NVIDIA
 * Optimus) show a black picture when mpv renders on the other GPU than the one
 * driving the screen; the classic blit model is composited by Windows and works
 * on every setup.
 */
function videoOutputArgs(mode?: string): string[] {
  if (process.platform !== 'win32') return ['--vo=gpu-next,gpu,x11'] // development on Linux/macOS
  switch (mode) {
    case 'gpu':
      return ['--vo=gpu', '--gpu-api=d3d11', '--d3d11-flip=no']
    case 'gpu-gl':
      return ['--vo=gpu', '--gpu-api=opengl']
    default:
      return ['--vo=gpu-next,gpu', '--gpu-api=d3d11', '--d3d11-flip=no']
  }
}
