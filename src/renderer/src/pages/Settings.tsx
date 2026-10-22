import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import type { Source, SourceKind } from '@shared/types'

function emptySource(kind: SourceKind): Source {
  return {
    id: crypto.randomUUID(),
    kind,
    name: '',
    url: '',
    username: '',
    password: '',
    epgUrl: '',
    userAgent: '',
    enabled: true
  }
}

export function Settings(): JSX.Element {
  const { settings, refreshSettings, setSource } = useStore()
  const [mpv, setMpv] = useState<{ path?: string; reason?: string }>({})
  const [editing, setEditing] = useState<Source | null>(null)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void window.api.appInfo().then((r) => setMpv({ path: r.data?.mpvPath, reason: r.data?.mpvReason }))
  }, [])

  if (!settings) return <div className="page">Loading…</div>

  const saveSource = async (): Promise<void> => {
    if (!editing) return
    if (!editing.name.trim() || !editing.url.trim()) {
      setTestMsg({ ok: false, message: 'Name and URL are required.' })
      return
    }
    await window.api.sources.save(editing)
    await refreshSettings()
    const wasFirst = settings.sources.length === 0
    setEditing(null)
    setTestMsg(null)
    if (wasFirst) await setSource(editing.id)
  }

  const removeSource = async (id: string): Promise<void> => {
    await window.api.sources.remove(id)
    await refreshSettings()
  }

  const toggleEnabled = async (s: Source): Promise<void> => {
    await window.api.sources.save({ ...s, enabled: !s.enabled })
    await refreshSettings()
  }

  const runTest = async (): Promise<void> => {
    if (!editing) return
    setTesting(true)
    setTestMsg(null)
    const r = await window.api.sources.test(editing)
    setTesting(false)
    setTestMsg(r.data ?? { ok: false, message: r.error ?? 'Test failed' })
  }

  const patchPlayer = async (partial: Partial<typeof settings>): Promise<void> => {
    await window.api.settings.update(partial)
    await refreshSettings()
  }

  return (
    <div className="page">
      <div className="settings-wrap">
        <h1 className="section-title">Settings</h1>

        {/* mpv status */}
        <div className="card">
          <h3>Playback engine (mpv)</h3>
          {mpv.path ? (
            <p className="hint" style={{ color: 'var(--good)' }}>
              ✓ mpv found: <code>{mpv.path}</code>
            </p>
          ) : (
            <p className="hint" style={{ color: 'var(--warn)' }}>
              ⚠ {mpv.reason ?? 'mpv not found.'}
            </p>
          )}
          <div className="field">
            <label>Custom mpv path (optional)</label>
            <input
              defaultValue={settings.mpvPath ?? ''}
              placeholder="C:\\path\\to\\mpv.exe"
              onBlur={(e) => void patchPlayer({ mpvPath: e.target.value.trim() })}
            />
          </div>
        </div>

        {/* Sources */}
        <div className="card">
          <h3>Sources</h3>
          <p className="hint">Your IPTV providers. You can add several and switch between them.</p>

          {settings.sources.map((s) => (
            <div className="source-row" key={s.id}>
              <span className="badge">{s.kind}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.url}
                </div>
              </div>
              <button
                className={`focusable switch ${s.enabled ? 'on' : ''}`}
                title={s.enabled ? 'Enabled' : 'Disabled'}
                onClick={() => void toggleEnabled(s)}
              >
                <span className="knob" />
              </button>
              <button className="focusable ghost-btn" onClick={() => setEditing({ ...s })}>
                Edit
              </button>
              <button className="focusable ghost-btn danger" onClick={() => void removeSource(s.id)}>
                Remove
              </button>
            </div>
          ))}

          {!editing && (
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="focusable ghost-btn primary" onClick={() => setEditing(emptySource('xtream'))}>
                <Icon name="live" size={16} /> Add Xtream login
              </button>
              <button className="focusable ghost-btn" onClick={() => setEditing(emptySource('m3u'))}>
                <Icon name="guide" size={16} /> Add M3U playlist
              </button>
            </div>
          )}

          {editing && (
            <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
              <div className="field row">
                <div>
                  <label>Display name</label>
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="My provider"
                  />
                </div>
                <div style={{ maxWidth: 160 }}>
                  <label>Type</label>
                  <select
                    value={editing.kind}
                    onChange={(e) => setEditing({ ...editing, kind: e.target.value as SourceKind })}
                  >
                    <option value="xtream">Xtream Codes</option>
                    <option value="m3u">M3U playlist</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label>{editing.kind === 'xtream' ? 'Server URL (http://host:port)' : 'Playlist URL or file path'}</label>
                <input
                  value={editing.url}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  placeholder={editing.kind === 'xtream' ? 'http://example.com:8080' : 'http://example.com/playlist.m3u'}
                />
              </div>

              {editing.kind === 'xtream' && (
                <div className="field row">
                  <div>
                    <label>Username</label>
                    <input
                      value={editing.username ?? ''}
                      onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                    />
                  </div>
                  <div>
                    <label>Password</label>
                    <input
                      type="password"
                      value={editing.password ?? ''}
                      onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="field">
                <label>EPG / XMLTV URL (optional{editing.kind === 'xtream' ? ' — auto-detected for Xtream' : ''})</label>
                <input
                  value={editing.epgUrl ?? ''}
                  onChange={(e) => setEditing({ ...editing, epgUrl: e.target.value })}
                  placeholder="http://example.com/xmltv.php?… or https://…/epg.xml.gz"
                />
              </div>

              <div className="field">
                <label>Custom User-Agent (optional — some providers require one)</label>
                <input
                  value={editing.userAgent ?? ''}
                  onChange={(e) => setEditing({ ...editing, userAgent: e.target.value })}
                  placeholder="Leave blank to use the global default"
                />
              </div>

              {testMsg && (
                <div className={`test-result ${testMsg.ok ? 'ok' : 'bad'}`}>
                  {testMsg.ok ? '✓ ' : '✕ '}
                  {testMsg.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button className="focusable ghost-btn primary" onClick={() => void saveSource()}>
                  Save source
                </button>
                <button className="focusable ghost-btn" onClick={() => void runTest()} data-disabled={testing ? '' : undefined}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                <button className="focusable ghost-btn" onClick={() => (setEditing(null), setTestMsg(null))}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Player quality */}
        <div className="card">
          <h3>Playback & quality</h3>
          <p className="hint">These apply to the mpv engine. Changes restart the player.</p>

          <div className="field row">
            <div>
              <label>Hardware decoding</label>
              <select defaultValue={settings.hwdec} onChange={(e) => void patchPlayer({ hwdec: e.target.value })}>
                <option value="auto-safe">Auto (safe) — recommended</option>
                <option value="auto">Auto (all)</option>
                <option value="d3d11va">Direct3D 11</option>
                <option value="dxva2">DXVA2</option>
                <option value="no">Off (software)</option>
              </select>
            </div>
            <div>
              <label>Network cache (seconds)</label>
              <input
                type="number"
                min={5}
                max={120}
                defaultValue={settings.cacheSeconds}
                onBlur={(e) => void patchPlayer({ cacheSeconds: Number(e.target.value) || 30 })}
              />
            </div>
          </div>

          <div className="field row">
            <div>
              <label>Network timeout (ms)</label>
              <input
                type="number"
                min={3000}
                max={60000}
                step={1000}
                defaultValue={settings.networkTimeoutMs}
                onBlur={(e) => void patchPlayer({ networkTimeoutMs: Number(e.target.value) || 15000 })}
              />
            </div>
            <div>
              <label>EPG cache lifetime (hours)</label>
              <input
                type="number"
                min={1}
                max={72}
                defaultValue={settings.epgTtlHours}
                onBlur={(e) => void patchPlayer({ epgTtlHours: Number(e.target.value) || 12 })}
              />
            </div>
          </div>

          <div className="field">
            <label>Default User-Agent</label>
            <input
              defaultValue={settings.userAgent}
              onBlur={(e) => void patchPlayer({ userAgent: e.target.value })}
            />
          </div>

          <div className="toggle" style={{ marginTop: 6 }}>
            <button
              className={`focusable switch ${settings.deinterlace ? 'on' : ''}`}
              onClick={() => void patchPlayer({ deinterlace: !settings.deinterlace })}
            >
              <span className="knob" />
            </button>
            <span>Deinterlace broadcast feeds (recommended for live TV)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
