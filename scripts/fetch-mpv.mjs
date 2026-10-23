// Best-effort downloader for a Windows mpv build.
//
// This runs during `npm install` (postinstall) and on demand. It is intentionally
// forgiving: WindowsTV can also use an mpv that is already installed on the user's
// PATH, or a path they set in Settings, so a failure here is never fatal.
//
// Source: zhongfly/mpv-winbuild (recommended Windows builds linked from mpv.io).
// The release assets are .7z archives, so extraction needs 7-Zip (`7z`/`7za`) on
// PATH. If that is missing we download the archive and tell the user how to finish.

import { createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MPV_DIR = resolve(__dirname, '..', 'resources', 'mpv')
const RELEASES_API =
  'https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest'

const log = (...a) => console.log('[fetch-mpv]', ...a)

if (process.platform !== 'win32' && !process.env.ELLO_CROSS_BUILD) {
  log('Not on Windows — skipping mpv download. Build on Windows to bundle mpv.')
  process.exit(0)
}

if (existsSync(join(MPV_DIR, 'mpv.exe'))) {
  log('mpv.exe already present in resources/mpv — nothing to do.')
  process.exit(0)
}

mkdirSync(MPV_DIR, { recursive: true })

function get(url, { json = false } = {}) {
  return new Promise((res, rej) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'WindowsTV-build-script',
          Accept: json ? 'application/vnd.github+json' : '*/*'
        }
      },
      (resp) => {
        if (
          resp.statusCode &&
          resp.statusCode >= 300 &&
          resp.statusCode < 400 &&
          resp.headers.location
        ) {
          resp.resume()
          return get(resp.headers.location, { json }).then(res, rej)
        }
        if (resp.statusCode !== 200) {
          resp.resume()
          return rej(new Error(`HTTP ${resp.statusCode} for ${url}`))
        }
        if (json) {
          const chunks = []
          resp.on('data', (c) => chunks.push(c))
          resp.on('end', () => {
            try {
              res(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            } catch (e) {
              rej(e)
            }
          })
        } else {
          res(resp)
        }
      }
    )
    req.on('error', rej)
  })
}

function sevenZip() {
  for (const bin of ['7z', '7za', '7zr']) {
    const r = spawnSync(bin, ['--help'], { stdio: 'ignore', shell: true })
    if (r.status === 0 || r.status === 1) return bin
  }
  return null
}

async function main() {
  log('Querying latest mpv Windows build…')
  const release = await get(RELEASES_API, { json: true })
  // Prefer a plain x86_64 build (not the v3/avx2 micro-arch ones) for compatibility.
  const assets = (release.assets || []).filter((a) => /\.7z$/.test(a.name))
  const asset =
    assets.find((a) => /mpv-x86_64-\d/.test(a.name)) ||
    assets.find((a) => /x86_64/.test(a.name)) ||
    assets[0]
  if (!asset) throw new Error('No .7z asset found in latest release')

  const archivePath = join(MPV_DIR, asset.name)
  log(`Downloading ${asset.name} (${(asset.size / 1e6).toFixed(1)} MB)…`)
  const resp = await get(asset.browser_download_url)
  await new Promise((res, rej) => {
    const out = createWriteStream(archivePath)
    resp.pipe(out)
    out.on('finish', res)
    out.on('error', rej)
  })

  const zip = sevenZip()
  if (!zip) {
    log('')
    log('Downloaded the archive but 7-Zip was not found on PATH.')
    log(`Please extract this file into resources/mpv so that mpv.exe sits directly in it:`)
    log(`   ${archivePath}`)
    log('Install 7-Zip (https://www.7-zip.org) and re-run `node scripts/fetch-mpv.mjs`.')
    return
  }

  log('Extracting…')
  const r = spawnSync(zip, ['x', '-y', `-o${MPV_DIR}`, archivePath], {
    stdio: 'inherit',
    shell: true
  })
  if (r.status !== 0) throw new Error('7-Zip extraction failed')

  if (!existsSync(join(MPV_DIR, 'mpv.exe'))) {
    const files = readdirSync(MPV_DIR)
    log('Extraction finished but mpv.exe is not at the top level. Contents:', files)
    log('Move mpv.exe (and its dlls) so mpv.exe sits directly in resources/mpv.')
    return
  }

  log('mpv ready at resources/mpv/mpv.exe')
}

main().catch((e) => {
  log('Could not download mpv automatically:', e.message)
  log('WindowsTV will still run if mpv is on your PATH or set in Settings.')
  log('See README.md ("Getting mpv") for manual steps.')
  // Never fail the install.
  process.exit(0)
})
