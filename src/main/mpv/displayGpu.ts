import { execFile } from 'node:child_process'

/**
 * Name of the GPU that drives the screen, when that's worth telling mpv.
 *
 * Laptops with two GPUs (Intel/AMD + NVIDIA Optimus) drive the screen with the
 * integrated GPU, but mpv may render on the NVIDIA one; its picture inside our
 * video window then stays black. Rendering on the GPU that drives the display
 * fixes it. Returns undefined when there's only one GPU, or when it's unclear
 * which one drives the screen (e.g. a second monitor on the other GPU), so mpv
 * keeps its default.
 */
export function findDisplayGpu(timeoutMs = 4000): Promise<string | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  const script =
    'Get-CimInstance Win32_VideoController | ' +
    'Select-Object Name, CurrentHorizontalResolution | ConvertTo-Json -Compress'
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(undefined)
        try {
          const parsed = JSON.parse(stdout.trim() || '[]')
          const gpus: Array<{ Name?: string; CurrentHorizontalResolution?: number | null }> = Array.isArray(parsed)
            ? parsed
            : [parsed]
          if (gpus.length < 2) return resolve(undefined)
          const driving = gpus.filter((g) => g.Name && (g.CurrentHorizontalResolution ?? 0) > 0)
          resolve(driving.length === 1 ? driving[0].Name!.trim() : undefined)
        } catch {
          resolve(undefined)
        }
      }
    )
  })
}
