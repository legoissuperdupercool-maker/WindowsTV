/**
 * ello Premium licence server.
 *
 * The app sends the licence key it was given plus a random id for the device;
 * this checks the key in D1, keeps to the key's device limit and answers with
 * a signed token (Ed25519). The app checks that token offline with the public
 * key and comes back to refresh it every few days, so a revoked key stops
 * working once its token runs out.
 *
 * Token: ELLO1.<payload>.<signature>, base64url; payload JSON
 * { n: name, k: key, d: device id, i: issued (ms), e: expires (ms) }.
 *
 * Secrets: LICENSE_PRIVATE_KEY (pkcs8, base64) and ADMIN_TOKEN.
 */

export interface Env {
  DB: D1Database
  LICENSE_PRIVATE_KEY: string
  ADMIN_TOKEN: string
}

/** How long a token works without reaching the server. */
const TOKEN_DAYS = 30
const DAY = 86_400_000

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization' }
  })

const b64u = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

let signingKey: Promise<CryptoKey> | null = null
function getSigningKey(env: Env): Promise<CryptoKey> {
  signingKey ??= crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(env.LICENSE_PRIVATE_KEY), (c) => c.charCodeAt(0)),
    { name: 'Ed25519' },
    false,
    ['sign']
  )
  return signingKey
}

async function makeToken(env: Env, payload: Record<string, unknown>): Promise<string> {
  const body = `ELLO1.${b64u(new TextEncoder().encode(JSON.stringify(payload)))}`
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, await getSigningKey(env), new TextEncoder().encode(body))
  return `${body}.${b64u(sig)}`
}

/** Keys as people type them: upper case, no spaces. */
const normKey = (k: unknown): string => (typeof k === 'string' ? k.trim().toUpperCase().replace(/\s+/g, '') : '')
const cleanText = (s: unknown, max = 80): string => (typeof s === 'string' ? s.trim().slice(0, max) : '')

/** ELLO-XXXX-XXXX-XXXX-XXXX (no 0/O/1/I so it reads back easily). */
function newKey(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const chars = [...bytes].map((b) => abc[b % abc.length]).join('')
  return `ELLO-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`
}

function sameString(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

interface KeyRow {
  key: string
  name: string
  max_devices: number
  revoked: number
}

async function activate(env: Env, body: Record<string, unknown>): Promise<Response> {
  const key = normKey(body.key)
  const device = cleanText(body.device, 64)
  if (!key || !device) return json({ error: 'missing', message: 'Licence key and device are needed.' }, 400)
  const row = await env.DB.prepare('SELECT key, name, max_devices, revoked FROM keys WHERE key = ?').bind(key).first<KeyRow>()
  if (!row) return json({ error: 'unknown', message: 'That licence key doesn’t exist.' }, 404)
  if (row.revoked) return json({ error: 'revoked', message: 'This licence key has been switched off.' }, 403)

  const now = Date.now()
  const known = await env.DB.prepare('SELECT 1 FROM activations WHERE key = ? AND device = ?').bind(key, device).first()
  if (!known) {
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM activations WHERE key = ?').bind(key).first<{ n: number }>()
    if ((used?.n ?? 0) >= row.max_devices) {
      return json(
        { error: 'limit', message: `This key is already used on ${row.max_devices} device${row.max_devices === 1 ? '' : 's'}. Remove it from one of them first.` },
        403
      )
    }
    await env.DB.prepare('INSERT INTO activations (key, device, device_name, platform, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(key, device, cleanText(body.deviceName), cleanText(body.platform, 20), now, now)
      .run()
  } else {
    await env.DB.prepare('UPDATE activations SET last_seen = ?, device_name = ? WHERE key = ? AND device = ?')
      .bind(now, cleanText(body.deviceName), key, device)
      .run()
  }
  const token = await makeToken(env, { n: row.name, k: key, d: device, i: now, e: now + TOKEN_DAYS * DAY })
  return json({ token, name: row.name })
}

async function deactivate(env: Env, body: Record<string, unknown>): Promise<Response> {
  const key = normKey(body.key)
  const device = cleanText(body.device, 64)
  if (!key || !device) return json({ error: 'missing' }, 400)
  await env.DB.prepare('DELETE FROM activations WHERE key = ? AND device = ?').bind(key, device).run()
  return json({ ok: true })
}

async function admin(env: Env, path: string, request: Request): Promise<Response> {
  const auth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!env.ADMIN_TOKEN || !sameString(auth, env.ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401)
  const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {}

  if (path === '/v1/admin/keys' && request.method === 'GET') {
    const keys = await env.DB.prepare('SELECT key, name, max_devices, revoked, note, created_at FROM keys ORDER BY created_at DESC LIMIT 500').all()
    const acts = await env.DB.prepare('SELECT key, device, device_name, platform, first_seen, last_seen FROM activations').all()
    return json({ keys: keys.results, activations: acts.results })
  }
  if (path === '/v1/admin/keys' && request.method === 'POST') {
    const name = cleanText(body.name)
    if (!name) return json({ error: 'missing', message: 'A name is needed.' }, 400)
    const max = Math.min(10, Math.max(1, Number(body.maxDevices) || 2))
    const key = newKey()
    await env.DB.prepare('INSERT INTO keys (key, name, max_devices, revoked, note, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .bind(key, name, max, cleanText(body.note, 200), Date.now())
      .run()
    return json({ key, name, max_devices: max })
  }
  if (path === '/v1/admin/revoke' && request.method === 'POST') {
    await env.DB.prepare('UPDATE keys SET revoked = ? WHERE key = ?').bind(body.revoked === false ? 0 : 1, normKey(body.key)).run()
    return json({ ok: true })
  }
  if (path === '/v1/admin/reset' && request.method === 'POST') {
    // Frees all devices of a key (someone got a new PC).
    await env.DB.prepare('DELETE FROM activations WHERE key = ?').bind(normKey(body.key)).run()
    return json({ ok: true })
  }
  return json({ error: 'not_found' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return json({})
    try {
      if (url.pathname === '/' || url.pathname === '/admin') {
        return new Response(ADMIN_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      if (request.method === 'POST' && (url.pathname === '/v1/activate' || url.pathname === '/v1/refresh')) {
        return await activate(env, (await request.json().catch(() => ({}))) as Record<string, unknown>)
      }
      if (request.method === 'POST' && url.pathname === '/v1/deactivate') {
        return await deactivate(env, (await request.json().catch(() => ({}))) as Record<string, unknown>)
      }
      if (url.pathname.startsWith('/v1/admin/')) return await admin(env, url.pathname, request)
      return json({ error: 'not_found' }, 404)
    } catch (e) {
      return json({ error: 'server', message: e instanceof Error ? e.message : 'Server error' }, 500)
    }
  }
}

/** /admin: make keys, see where they're used, switch them off. */
const ADMIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ello Licences</title>
<style>
:root{--bg:#0e0f12;--card:#181a20;--line:#262932;--text:#f3f3f7;--dim:#9aa0ab;--gold:#ffc440;--red:#ff8a80}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,Segoe UI,sans-serif}
main{max-width:980px;margin:32px auto;padding:0 16px}h1{font-size:22px;margin:0 0 16px}
.card{background:var(--card);border-radius:12px;padding:18px;margin-bottom:16px}
input{background:#22252d;color:var(--text);border:0;border-radius:8px;padding:10px 12px;font:inherit}
button{background:var(--gold);color:#1a1200;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}
button.ghost{background:#2a2d36;color:var(--text);font-weight:600;padding:6px 10px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
table{width:100%;border-collapse:collapse}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:12px}code{font-size:13px}.dim{color:var(--dim);font-size:12px}.off{color:var(--red)}
#new{margin-top:10px;font-size:16px}
.scroll{overflow-x:auto}
</style></head><body><main>
<h1>ello Premium licences</h1>
<div class="card row"><input id="tok" type="password" placeholder="Admin token" style="flex:1;min-width:200px"><button onclick="saveTok()">Sign in</button></div>
<div class="card">
<div class="row"><input id="name" placeholder="Buyer name or email" style="flex:1;min-width:200px"><input id="max" type="number" min="1" max="10" value="2" style="width:90px" title="Devices"><button onclick="make()">Make key</button></div>
<div id="new"></div>
</div>
<div class="card scroll"><table><thead><tr><th>Key</th><th>Name</th><th>Devices</th><th></th></tr></thead><tbody id="list"><tr><td colspan="4" class="dim">Sign in to see your keys.</td></tr></tbody></table></div>
</main><script>
let tok='';try{tok=sessionStorage.getItem('t')||''}catch{}
document.getElementById('tok').value=tok;
const api=(p,o={})=>fetch(p,{...o,headers:{'content-type':'application/json',authorization:'Bearer '+tok}}).then(r=>r.json());
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function saveTok(){tok=document.getElementById('tok').value.trim();try{sessionStorage.setItem('t',tok)}catch{};load()}
async function make(){const name=document.getElementById('name').value.trim();if(!name)return;
const r=await api('/v1/admin/keys',{method:'POST',body:JSON.stringify({name,maxDevices:+document.getElementById('max').value})});
document.getElementById('new').innerHTML=r.key?'New key for '+esc(r.name)+': <code>'+esc(r.key)+'</code> <button class="ghost" onclick="navigator.clipboard.writeText(\\''+r.key+'\\')">Copy</button>':'<span class="off">'+esc(r.message||r.error)+'</span>';load()}
async function act(p,key,extra={}){await api(p,{method:'POST',body:JSON.stringify({key,...extra})});load()}
async function load(){const r=await api('/v1/admin/keys');const el=document.getElementById('list');
if(!r.keys){el.innerHTML='<tr><td colspan="4" class="off">'+esc(r.error)+'</td></tr>';return}
el.innerHTML=r.keys.map(k=>{const a=r.activations.filter(x=>x.key===k.key);
return '<tr><td><code>'+esc(k.key)+'</code>'+(k.revoked?' <span class="off">off</span>':'')+'</td><td>'+esc(k.name)+'<div class="dim">'+new Date(k.created_at).toLocaleDateString()+'</div></td><td>'+a.length+' / '+k.max_devices+a.map(x=>'<div class="dim">'+esc(x.device_name||x.device)+' · '+esc(x.platform)+' · '+new Date(x.last_seen).toLocaleDateString()+'</div>').join('')+'</td><td class="row">'+
(k.revoked?'<button class="ghost" onclick="act(\\'/v1/admin/revoke\\',\\''+k.key+'\\',{revoked:false})">Switch on</button>':'<button class="ghost" onclick="act(\\'/v1/admin/revoke\\',\\''+k.key+'\\')">Switch off</button>')+
'<button class="ghost" onclick="act(\\'/v1/admin/reset\\',\\''+k.key+'\\')">Free devices</button></td></tr>'}).join('')||'<tr><td colspan="4" class="dim">No keys yet.</td></tr>'}
if(tok)load();
</script></body></html>`
