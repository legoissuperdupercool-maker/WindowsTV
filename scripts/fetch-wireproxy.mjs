// Downloads wireproxy (https://github.com/pufferffish/wireproxy, ISC licence) for
// the Windows build. wireproxy runs a WireGuard tunnel in user space and offers
// it as a local SOCKS5 + HTTP proxy, which is how ello's built-in VPN sends only
// its own traffic through Mullvad/Proton/any WireGuard provider, with no system
// VPN, driver or admin rights. Bundled into resources/wireproxy/wireproxy.exe.

import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(__dirname, '..', 'resources', 'wireproxy')
const API = 'https://api.github.com/repos/pufferffish/wireproxy/releases/latest'
const log = (...a) => console.log('[fetch-wireproxy]', ...a)

if (process.platform !== 'win32') {
  log('Not on Windows — skipping.')
  process.exit(0)
}
if (existsSync(join(DIR, 'wireproxy.exe'))) {
  log('wireproxy.exe already present.')
  process.exit(0)
}
mkdirSync(DIR, { recursive: true })

function get(url, json = false) {
  return new Promise((res, rej) => {
    https
      .get(url, { headers: { 'User-Agent': 'ello-smarttv-build', Accept: json ? 'application/vnd.github+json' : '*/*' } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return get(r.headers.location, json).then(res, rej)
        if (r.statusCode !== 200) return rej(new Error(`HTTP ${r.statusCode} for ${url}`))
        if (!json) return res(r)
        let body = ''
        r.on('data', (d) => (body += d))
        r.on('end', () => res(JSON.parse(body)))
      })
      .on('error', rej)
  })
}

function findExe(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      const found = findExe(p)
      if (found) return found
    } else if (/^wireproxy.*\.exe$/i.test(name)) return p
  }
  return null
}

const release = await get(API, true)
const asset = release.assets.find((a) => /windows/i.test(a.name) && /amd64|x86_64|x64/i.test(a.name))
if (!asset) {
  log('No Windows build in', release.tag_name, release.assets.map((a) => a.name).join(', '))
  process.exit(1)
}
log('Downloading', release.tag_name, asset.name)
const archive = join(DIR, asset.name)
await new Promise((res, rej) => get(asset.browser_download_url).then((r) => r.pipe(createWriteStream(archive)).on('finish', res).on('error', rej), rej))
if (/\.exe$/i.test(asset.name)) {
  renameSync(archive, join(DIR, 'wireproxy.exe'))
} else {
  // Windows 10/11 ship bsdtar, which handles .tar.gz and .zip.
  const r = spawnSync('tar', ['-xf', archive, '-C', DIR], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('Could not extract ' + asset.name)
  const exe = findExe(DIR)
  if (!exe) throw new Error('wireproxy.exe not found in ' + asset.name)
  if (exe !== join(DIR, 'wireproxy.exe')) renameSync(exe, join(DIR, 'wireproxy.exe'))
}
log('wireproxy ready at resources/wireproxy/wireproxy.exe')
