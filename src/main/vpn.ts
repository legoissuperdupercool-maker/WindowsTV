import { app, safeStorage, session } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import { join } from 'node:path'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { VpnState } from '../shared/types'

/**
 * Built-in VPN, like UHF's: a WireGuard config from Mullvad, Proton, AirVPN or
 * any WireGuard provider, used only for ello's own traffic (provider lists,
 * TV guide, artwork and the video stream). The rest of the PC is untouched.
 *
 * wireproxy (bundled) runs the WireGuard tunnel in user space and exposes it as
 * local SOCKS5 + HTTP proxies: Node requests and the app's web content use
 * SOCKS5, mpv uses the HTTP proxy. No driver, no admin rights.
 *
 * Kill switch: while the VPN is switched on but not connected, ello's traffic
 * is blocked rather than sent over your normal connection.
 */
export class Vpn {
  private proc: ChildProcess | null = null
  private state: VpnState = { enabled: false, status: 'off' }
  private socksPort = 0
  private httpPort = 0
  private agent: SocksProxyAgent | null = null
  private dir = join(app.getPath('userData'), 'vpn')
  private configFile = join(this.dir, 'wireguard.conf.enc')
  private stopping = false

  constructor(
    private onChange: (s: VpnState) => void,
    /** Restart mpv so it picks up (or drops) the proxy. */
    private restartPlayer: () => Promise<void>
  ) {
    this.state.config = this.readInfo()
    // If the VPN was on last time, block traffic from the very first request
    // until restore() has connected it (no leak while starting up).
    try {
      if (this.state.config && readFileSync(join(this.dir, 'enabled'), 'utf8') === '1') {
        this.state = { ...this.state, enabled: true, status: 'connecting' }
        void session.defaultSession.setProxy({ proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' })
      }
    } catch {
      /* never enabled */
    }
  }

  getState(): VpnState {
    return this.state
  }

  /** Agent for Node HTTP(S) requests: the tunnel, or null when the VPN is off. Throws when it must block. */
  requestAgent(): SocksProxyAgent | null {
    if (!this.state.enabled) return null
    if (this.state.status !== 'connected' || !this.agent) {
      throw new Error('The VPN in ello isn’t connected, so nothing is sent until it is (Settings › VPN).')
    }
    return this.agent
  }

  /** mpv's --http-proxy value, or undefined when the VPN is off. Blocks (dead port) when down. */
  mpvProxy(): string | undefined {
    if (!this.state.enabled) return undefined
    return this.state.status === 'connected' ? `http://127.0.0.1:${this.httpPort}` : 'http://127.0.0.1:9'
  }

  // ---------------------------------------------------------------- config

  /** Save a WireGuard config (encrypted with Windows' protection for this user). */
  importConfig(text: string, fileName: string): VpnState {
    const info = parseWireGuard(text, fileName)
    mkdirSync(this.dir, { recursive: true })
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8')
    writeFileSync(this.configFile, data)
    writeFileSync(join(this.dir, 'info.json'), JSON.stringify(info))
    this.update({ config: info })
    if (this.state.enabled) void this.restart()
    return this.state
  }

  removeConfig(): VpnState {
    void this.setEnabled(false)
    rmSync(this.configFile, { force: true })
    rmSync(join(this.dir, 'info.json'), { force: true })
    this.update({ config: undefined })
    return this.state
  }

  private readInfo(): VpnState['config'] {
    try {
      return JSON.parse(readFileSync(join(this.dir, 'info.json'), 'utf8'))
    } catch {
      return undefined
    }
  }

  private readConfig(): string {
    const raw = readFileSync(this.configFile)
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
  }

  // ---------------------------------------------------------------- on / off

  async setEnabled(enabled: boolean, persist = true): Promise<VpnState> {
    if (persist) writeFileSync(join(this.ensureDir(), 'enabled'), enabled ? '1' : '0')
    if (enabled && !this.state.config) throw new Error('Import a WireGuard file first.')
    this.update({ enabled, error: undefined })
    if (enabled) await this.restart()
    else {
      this.kill()
      this.agent = null
      this.update({ status: 'off' })
      await this.applyProxies()
    }
    return this.state
  }

  /** On app start: switch the VPN back on if it was on. */
  async restore(): Promise<void> {
    if (this.state.enabled) await this.setEnabled(true, false)
  }

  private ensureDir(): string {
    mkdirSync(this.dir, { recursive: true })
    return this.dir
  }

  private async restart(): Promise<void> {
    this.kill()
    this.update({ status: 'connecting', error: undefined })
    await this.applyProxies() // blocks traffic while connecting
    try {
      const exe = wireproxyPath()
      if (!exe) throw new Error('The VPN component is missing from this installation. Please reinstall ello smartTV.')
      this.socksPort = await freePort()
      this.httpPort = await freePort()
      // wireproxy reads the WireGuard file at start-up; it's written decrypted
      // only for that moment and deleted right after.
      const runDir = this.ensureDir()
      const wgFile = join(runDir, `run-${process.pid}.conf`)
      const proxyFile = join(runDir, `wireproxy-${process.pid}.conf`)
      writeFileSync(wgFile, this.readConfig(), { mode: 0o600 })
      writeFileSync(
        proxyFile,
        `WGConfig = ${wgFile}\n\n[Socks5]\nBindAddress = 127.0.0.1:${this.socksPort}\n\n[http]\nBindAddress = 127.0.0.1:${this.httpPort}\n`
      )
      let output = ''
      const proc = spawn(exe, ['-c', proxyFile], { windowsHide: true })
      this.proc = proc
      proc.stdout?.on('data', (d) => (output = (output + d).slice(-2000)))
      proc.stderr?.on('data', (d) => (output = (output + d).slice(-2000)))
      proc.on('exit', () => {
        if (this.proc !== proc) return
        this.proc = null
        if (!this.stopping && this.state.enabled) {
          this.agent = null
          this.update({ status: 'error', error: explain(output) })
          void this.applyProxies()
        }
      })
      await waitForPort(this.socksPort, 8000)
      setTimeout(() => {
        rmSync(wgFile, { force: true })
        rmSync(proxyFile, { force: true })
      }, 3000)
      this.agent = new SocksProxyAgent(`socks5h://127.0.0.1:${this.socksPort}`)
      this.update({ status: 'connected' })
      await this.applyProxies()
    } catch (e) {
      this.kill()
      this.agent = null
      this.update({ status: 'error', error: (e as Error).message })
      await this.applyProxies()
    }
  }

  private kill(): void {
    if (!this.proc) return
    this.stopping = true
    this.proc.kill()
    this.proc = null
    this.stopping = false
  }

  stop(): void {
    this.kill()
  }

  /** Route the app's web content (artwork, web apps, updates) and mpv to match the VPN state. */
  private async applyProxies(): Promise<void> {
    const s = session.defaultSession
    if (!this.state.enabled) await s.setProxy({ mode: 'direct' })
    else if (this.state.status === 'connected')
      await s.setProxy({ proxyRules: `socks5://127.0.0.1:${this.socksPort}`, proxyBypassRules: '<-loopback>' })
    else await s.setProxy({ proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' }) // kill switch
    await s.closeAllConnections()
    await this.restartPlayer()
  }

  /** User-requested check: where does ello's traffic come out? */
  async check(): Promise<{ ip: string; country?: string; city?: string; mullvad?: boolean }> {
    const agent = this.requestAgent()
    const { fetchJson } = await import('./net/http')
    const r = await fetchJson<Record<string, unknown>>('https://am.i.mullvad.net/json', { timeoutMs: 12000, agentOverride: agent })
    return {
      ip: String(r.ip ?? '?'),
      country: r.country ? String(r.country) : undefined,
      city: r.city ? String(r.city) : undefined,
      mullvad: Boolean(r.mullvad_exit_ip)
    }
  }

  private update(p: Partial<VpnState>): void {
    this.state = { ...this.state, ...p }
    this.onChange(this.state)
  }
}

function wireproxyPath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'wireproxy', 'wireproxy.exe')]
    : [join(app.getAppPath(), 'resources', 'wireproxy', 'wireproxy.exe')]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** Pull what the UI shows out of a wg-quick config, and reject things that aren't one. */
export function parseWireGuard(text: string, fileName: string): NonNullable<VpnState['config']> {
  const get = (key: string): string | undefined => text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'mi'))?.[1]
  if (!/\[Interface\]/i.test(text) || !/\[Peer\]/i.test(text) || !get('PrivateKey') || !get('PublicKey') || !get('Endpoint')) {
    throw new Error('That isn’t a WireGuard configuration file. Download a .conf file from your VPN’s WireGuard settings.')
  }
  const endpoint = get('Endpoint')!
  const host = endpoint.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  const provider = /mullvad/i.test(fileName + text) || get('DNS')?.startsWith('10.64.0.1')
    ? 'Mullvad'
    : /proton/i.test(fileName)
      ? 'Proton VPN'
      : /airvpn/i.test(fileName + text)
        ? 'AirVPN'
        : undefined
  return { name: fileName.replace(/\.conf$/i, ''), endpoint: host, provider }
}

function explain(output: string): string {
  const o = output.toLowerCase()
  if (o.includes('handshake') || o.includes('timeout')) return 'The VPN server didn’t answer. Try another server file from your VPN provider.'
  if (o.includes('key')) return 'The WireGuard file’s keys were rejected. Download a fresh file from your VPN provider.'
  return 'The VPN connection stopped. ' + (output.trim().split('\n').pop()?.slice(0, 160) ?? '')
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
  })
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const sock = connect(port, '127.0.0.1')
      sock.once('connect', () => {
        sock.destroy()
        resolve()
      })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() > until) reject(new Error('The VPN didn’t start. Check that the WireGuard file is valid.'))
        else setTimeout(attempt, 250)
      })
    }
    attempt()
  })
}
