import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { app } from 'electron'

/**
 * Resolve an mpv executable, trying (in order):
 *  1. an explicit path the user set in Settings,
 *  2. the mpv bundled with the app (resources/mpv/mpv.exe),
 *  3. an mpv already installed on the system PATH.
 *
 * Returning a reason when nothing is found lets the UI tell the user exactly how
 * to fix it, instead of failing silently.
 */
export function resolveMpvPath(userPath?: string): { path?: string; reason?: string } {
  if (userPath && userPath.trim()) {
    if (existsSync(userPath)) return { path: userPath }
    return { reason: `The mpv path set in Settings does not exist: ${userPath}` }
  }

  const bundled = bundledMpvPath()
  if (bundled && existsSync(bundled)) return { path: bundled }

  const onPath = findOnPath()
  if (onPath) return { path: onPath }

  return {
    reason:
      'mpv was not found. Install it, drop mpv.exe into the app folder, or set its ' +
      'path in Settings → Player. See the README section "Getting mpv".'
  }
}

function bundledMpvPath(): string | null {
  // In a packaged build, extraResources places mpv under process.resourcesPath/mpv.
  // In dev, read from the repo's resources/mpv directory.
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'mpv', 'mpv.exe')]
    : [
        join(app.getAppPath(), 'resources', 'mpv', 'mpv.exe'),
        join(process.cwd(), 'resources', 'mpv', 'mpv.exe')
      ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function findOnPath(): string | null {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const r = spawnSync(cmd, ['mpv'], { encoding: 'utf8' })
    if (r.status === 0) {
      const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
      if (first && existsSync(first)) return first
    }
  } catch {
    /* ignore */
  }
  return null
}
