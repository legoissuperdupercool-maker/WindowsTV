import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { HelperEvent, Result } from '../shared/types'

type Pending = { resolve: (r: Result<unknown>) => void }

/**
 * Runs the Python helper (helper/ello_apple_helper.py) that talks to the Apple
 * devices, and exchanges one JSON object per line with it.
 */
export class Helper {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buffer = ''

  constructor(private onEvent: (e: HelperEvent) => void) {}

  private command(): { file: string; args: string[] } | null {
    // Packaged: PyInstaller build in resources/helper. Dev: run the script with Python.
    const exe = join(process.resourcesPath, 'helper', 'ello-apple-helper', 'ello-apple-helper.exe')
    if (app.isPackaged && existsSync(exe)) return { file: exe, args: [] }
    const script = join(app.getAppPath(), 'helper', 'ello_apple_helper.py')
    if (existsSync(script)) return { file: process.env['ELLO_PYTHON'] || 'python', args: [script] }
    return null
  }

  private start(): void {
    if (this.proc) return
    const cmd = this.command()
    if (!cmd) throw new Error('The Apple device helper is missing from this installation. Please reinstall ello Sideloader.')
    const proc = spawn(cmd.file, cmd.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let nl: number
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim()
        this.buffer = this.buffer.slice(nl + 1)
        if (line) this.onLine(line)
      }
    })
    proc.stderr.on('data', () => {
      /* library logging; not shown */
    })
    const failAll = (message: string): void => {
      this.proc = null
      for (const p of this.pending.values()) p.resolve({ ok: false, error: message })
      this.pending.clear()
      this.onEvent({ event: 'exited', message })
    }
    proc.on('error', (e) => failAll(`Couldn't start the Apple device helper: ${e.message}`))
    proc.on('exit', (code) => failAll(code ? `The Apple device helper stopped (code ${code}).` : 'The Apple device helper stopped.'))
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (typeof msg.event === 'string') {
      this.onEvent(msg as unknown as HelperEvent)
      return
    }
    const p = this.pending.get(msg.id as number)
    if (!p) return
    this.pending.delete(msg.id as number)
    p.resolve(msg.ok ? { ok: true, data: msg.data } : { ok: false, error: String(msg.error ?? 'Something went wrong.') })
  }

  private write(obj: unknown): void {
    this.start()
    this.proc!.stdin.write(JSON.stringify(obj) + '\n')
  }

  call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
    return new Promise((resolve) => {
      const id = this.nextId++
      this.pending.set(id, { resolve: resolve as Pending['resolve'] })
      try {
        this.write({ id, cmd, ...args })
      } catch (e) {
        this.pending.delete(id)
        resolve({ ok: false, error: (e as Error).message })
      }
    })
  }

  sendPin(pin: string): void {
    if (this.proc) this.write({ pin })
  }

  stop(): void {
    if (!this.proc) return
    try {
      this.proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n')
    } catch {
      /* already gone */
    }
    this.proc.kill()
    this.proc = null
  }
}
