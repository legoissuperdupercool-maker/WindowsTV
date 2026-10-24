import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Settings → Device preview: ello at iPad and iPhone screen sizes, side by
 * side in device frames, to check layouts. Each device is a full copy of the
 * app (same profiles and settings) shown at the device's size in points.
 * It previews the Windows app's screens; the iPad app itself is native.
 */
let win: BrowserWindow | null = null

function appUrl(): string {
  const base =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
  return `${base}${base.includes('?') ? '&' : '?'}preview=1`
}

export function openDevicePreview(): void {
  if (win && !win.isDestroyed()) {
    win.focus()
    return
  }
  const preload = join(__dirname, '../preload/index.mjs')
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 800,
    minHeight: 600,
    title: 'ello · Device preview',
    backgroundColor: '#0b0c10',
    autoHideMenuBar: true,
    webPreferences: { webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  // Only our own app page may be shown, with ello's preload and safe settings.
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    if (!params.src.startsWith(appUrl().split('?')[0])) {
      e.preventDefault()
      return
    }
    prefs.preload = preload
    prefs.contextIsolation = true
    prefs.nodeIntegration = false
    prefs.sandbox = false
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => (win = null))

  const file = join(app.getPath('temp'), 'ello-device-preview.html')
  writeFileSync(file, page(appUrl()))
  void win.loadFile(file)

  // Development: save a screenshot of the preview (ELLO_PREVIEW_SHOT=file.png).
  const shot = process.env['ELLO_PREVIEW_SHOT']
  if (shot) {
    const w = win
    setTimeout(() => void w.webContents.capturePage().then((img) => writeFileSync(shot, img.toPNG())), 14000)
  }
}

function page(src: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>ello · Device preview</title>
<style>
:root{--bg:#0b0c10;--bar:#14161c;--chip:#22252e;--text:#f3f3f7;--dim:#9aa0ab;--accent:#4c8dff}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:13px system-ui,Segoe UI,sans-serif;overflow:hidden}
.bar{height:52px;display:flex;align-items:center;gap:8px;padding:0 16px;background:var(--bar);border-bottom:1px solid #20232b}
.bar b{margin-right:10px;font-size:14px}
.chip{background:var(--chip);color:var(--text);border:0;border-radius:16px;padding:7px 13px;font:inherit;cursor:pointer}
.chip.on{background:var(--text);color:#111}
.sp{flex:1}
.stage{position:absolute;inset:52px 0 0 0;display:flex;align-items:center;justify-content:center;gap:40px;padding:24px;flex-wrap:nowrap}
.dev{display:flex;flex-direction:column;align-items:center;gap:10px}
.frame{background:#000;border:2px solid #3a3d46;box-shadow:0 0 0 6px #17181d,0 30px 60px rgba(0,0,0,.6);overflow:hidden;position:relative}
.frame webview{display:inline-flex;background:#000}
.label{color:var(--dim);font-size:12px}
</style></head><body>
<div class="bar">
  <b>Device preview</b>
  <span id="devs"></span>
  <span class="sp"></span>
  <button class="chip" id="rot">Portrait</button>
  <button class="chip" id="reload">Reload</button>
</div>
<div class="stage" id="stage"></div>
<script>
const SRC = ${JSON.stringify(src)};
// Screen sizes in points (CSS pixels), landscape; corner radius of the screen.
const DEVICES = [
  { id: 'ipad11', name: 'iPad Pro 11"', w: 1194, h: 834, r: 18 },
  { id: 'ipad', name: 'iPad', w: 1180, h: 820, r: 18 },
  { id: 'ipadmini', name: 'iPad mini', w: 1133, h: 744, r: 18 },
  { id: 'iphone', name: 'iPhone 15 Pro', w: 852, h: 393, r: 46 },
  { id: 'iphonese', name: 'iPhone SE', w: 667, h: 375, r: 6 }
];
let on = ['ipad11', 'iphone'];
let portrait = false;
try { const s = JSON.parse(localStorage.getItem('ello.preview') || '{}'); if (Array.isArray(s.on)) on = s.on; portrait = !!s.portrait } catch {}
const save = () => { try { localStorage.setItem('ello.preview', JSON.stringify({ on, portrait })) } catch {} };

function chips() {
  const el = document.getElementById('devs');
  el.innerHTML = '';
  for (const d of DEVICES) {
    const b = document.createElement('button');
    b.className = 'chip' + (on.includes(d.id) ? ' on' : '');
    b.textContent = d.name;
    b.onclick = () => { on = on.includes(d.id) ? on.filter(x => x !== d.id) : [...on, d.id]; save(); chips(); build() };
    el.appendChild(b);
  }
  document.getElementById('rot').textContent = portrait ? 'Landscape' : 'Portrait';
}

let views = [];
function build() {
  const stage = document.getElementById('stage');
  stage.innerHTML = '';
  views = DEVICES.filter(d => on.includes(d.id)).map(d => {
    const w = portrait ? d.h : d.w, h = portrait ? d.w : d.h;
    const wrap = document.createElement('div'); wrap.className = 'dev';
    const frame = document.createElement('div'); frame.className = 'frame';
    const wv = document.createElement('webview');
    wv.setAttribute('src', SRC);
    frame.appendChild(wv);
    const label = document.createElement('div'); label.className = 'label';
    label.textContent = d.name + ' · ' + w + ' × ' + h;
    wrap.append(frame, label);
    stage.appendChild(wrap);
    return { d, w, h, frame, wv };
  });
  fit();
}

// Scale every device by the same factor so all fit next to each other; the
// page inside still sees the device's real size (zoom, not resize).
function fit() {
  if (!views.length) return;
  const stage = document.getElementById('stage');
  const gap = 40, pad = 48, labelH = 30;
  const totalW = views.reduce((a, v) => a + v.w, 0) + gap * (views.length - 1);
  const maxH = Math.max(...views.map(v => v.h));
  const s = Math.min(1, (stage.clientWidth - pad) / totalW, (stage.clientHeight - pad - labelH) / maxH);
  for (const v of views) {
    const W = Math.round(v.w * s), H = Math.round(v.h * s);
    v.frame.style.width = W + 'px'; v.frame.style.height = H + 'px';
    v.frame.style.borderRadius = Math.round(v.d.r * s + 4) + 'px';
    v.wv.style.width = W + 'px'; v.wv.style.height = H + 'px';
    const apply = () => { try { v.wv.setZoomFactor(s) } catch {} };
    if (v.ready) apply(); else v.wv.addEventListener('dom-ready', () => { v.ready = true; apply() }, { once: true });
  }
}

document.getElementById('rot').onclick = () => { portrait = !portrait; save(); chips(); build() };
document.getElementById('reload').onclick = () => views.forEach(v => v.wv.reload());
window.addEventListener('resize', fit);
chips(); build();
</script></body></html>`
}
