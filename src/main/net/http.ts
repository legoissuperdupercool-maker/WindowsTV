import http from 'node:http'
import https from 'node:https'
import { gunzipSync } from 'node:zlib'
import { URL } from 'node:url'

export interface FetchOptions {
  userAgent?: string
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
  method?: 'GET' | 'HEAD'
  /** Abort after this many bytes (for cheap stream probing). */
  maxBytes?: number
}

export interface FetchResult {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
  finalUrl: string
}

const DEFAULT_UA = 'VLC/3.0.20 LibVLC/3.0.20'

/**
 * A single HTTP(S) request with redirect following, gzip handling and an overall
 * timeout. Throws a descriptive Error on any failure.
 */
function once(url: string, opts: FetchOptions, redirectsLeft: number): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return reject(new Error(`Invalid URL: ${url}`))
    }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      u,
      {
        method: opts.method ?? 'GET',
        headers: {
          'User-Agent': opts.userAgent || DEFAULT_UA,
          'Accept-Encoding': 'gzip, deflate',
          Accept: '*/*',
          ...opts.headers
        },
        timeout: opts.timeoutMs ?? 15000
      },
      (res) => {
        const status = res.statusCode ?? 0
        // Redirects
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'))
          const next = new URL(res.headers.location, u).toString()
          return once(next, opts, redirectsLeft - 1).then(resolve, reject)
        }
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (c: Buffer) => {
          chunks.push(c)
          total += c.length
          if (opts.maxBytes && total >= opts.maxBytes) {
            res.destroy()
          }
        })
        res.on('end', () => finish())
        res.on('close', () => finish())
        let finished = false
        function finish(): void {
          if (finished) return
          finished = true
          let body = Buffer.concat(chunks)
          const enc = String(res.headers['content-encoding'] || '')
          const isGzUrl = /\.gz($|\?)/i.test(url)
          if ((enc.includes('gzip') || isGzUrl) && body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
            try {
              body = gunzipSync(body)
            } catch {
              /* leave as-is */
            }
          }
          resolve({ status, headers: res.headers, body, finalUrl: u.toString() })
        }
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${opts.timeoutMs ?? 15000} ms`))
    })
    req.on('error', (err) => reject(err))
    req.end()
  })
}

/** Fetch with exponential-backoff retries. */
export async function fetchUrl(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const retries = opts.retries ?? 2
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await once(url, opts, 6)
      if (r.status >= 400) {
        throw new Error(describeStatus(r.status))
      }
      return r
    } catch (e) {
      lastErr = e as Error
      if (attempt < retries) {
        await delay(400 * Math.pow(2, attempt))
      }
    }
  }
  throw new Error(lastErr?.message || 'Request failed')
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const r = await fetchUrl(url, opts)
  return r.body.toString('utf8')
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, opts)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('The server did not return valid JSON (is the URL / login correct?).')
  }
}

/**
 * Cheap reachability probe: request a few KB and report whether the server
 * answered. Used to pre-flight a stream and give the user a reason before mpv
 * even opens — turning "nothing loads" into an explanation.
 */
export async function probeStream(
  url: string,
  opts: FetchOptions = {}
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  try {
    const r = await fetchUrl(url, {
      ...opts,
      method: 'GET',
      maxBytes: 8192,
      retries: 0,
      timeoutMs: opts.timeoutMs ?? 8000
    })
    return { ok: r.status >= 200 && r.status < 400, status: r.status }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

function describeStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Unauthorized (401) — check your username and password.'
    case 403:
      return 'Forbidden (403) — the server rejected the request (subscription expired, IP/User-Agent blocked, or max connections reached).'
    case 404:
      return 'Not found (404) — the playlist or stream URL is wrong or has moved.'
    case 429:
      return 'Too many requests (429) — the provider is rate-limiting you; try again shortly.'
    case 503:
      return 'Service unavailable (503) — the provider is down or overloaded.'
    default:
      return `Server returned HTTP ${status}.`
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
