import { useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'
import { autoSkipEnabled, setAutoSkip } from '../hooks/useSkipIntro'
import { useRecordings } from '../hooks/useRecordings'
import type { Recording } from '@shared/types'

/** Settings → Watching extras: skip intros, multi-view, recording & reminders. */
export function ExtrasSettings(): JSX.Element | null {
  const { settings, refreshSettings } = useStore()
  const [autoSkip, setAuto] = useState(autoSkipEnabled)
  const { recordings, reminders, folder } = useRecordings()
  if (!settings) return null

  const patch = async (p: Partial<typeof settings>): Promise<void> => {
    await window.api.settings.update(p)
    await refreshSettings()
  }

  return (
    <div className="card">
      <h3>Watching extras</h3>

      <SwitchRow
        on={autoSkip}
        title="Skip intros automatically"
        sub="ello learns each series’ intro the first time you skip it (with “Skip intro” or by jumping ahead), then skips it for you in later episodes."
        onClick={() => {
          setAutoSkip(!autoSkip)
          setAuto(!autoSkip)
        }}
      />
      <SwitchRow
        on={Boolean(settings.multiView)}
        title="Multi-view"
        sub="Watch 2 or 4 live channels at once (button in Live TV and in the player). Each channel is its own stream: your provider must allow that many connections at the same time."
        onClick={() => void patch({ multiView: !settings.multiView })}
      />
      <SwitchRow
        on={Boolean(settings.recordings)}
        title="Recording & reminders"
        sub="Record live TV to this PC (record button in the player, or schedule from the Guide), and get a notification when a programme starts. Uses one extra connection to your provider while recording; ello must be running."
        onClick={() => void patch({ recordings: !settings.recordings })}
      />

      {settings.recordings && (
        <div className="rec-panel">
          <div className="field row" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label>Recordings folder</label>
              <div className="rec-folder">{folder}</div>
            </div>
            <button className="focusable btn" onClick={() => void window.api.recordings.pickFolder()}>
              Change
            </button>
            <button className="focusable btn" onClick={() => void window.api.recordings.openFolder()}>
              Open
            </button>
          </div>

          <label>Recordings</label>
          {recordings.length === 0 ? (
            <p className="hint">Nothing recorded yet.</p>
          ) : (
            <div className="rec-list">
              {recordings.slice(0, 30).map((r) => (
                <RecRow key={r.id} r={r} />
              ))}
            </div>
          )}

          {reminders.length > 0 && (
            <>
              <label style={{ marginTop: 14 }}>Reminders</label>
              <div className="rec-list">
                {reminders.map((m) => (
                  <div className="rec-row" key={m.id}>
                    <Icon name="bell" size={18} />
                    <div className="rec-text">
                      <b>{m.title}</b>
                      <small>
                        {m.channelName} · {new Date(m.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                      </small>
                    </div>
                    <button className="focusable btn small" onClick={() => void window.api.recordings.removeReminder(m.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SwitchRow({ on, title, sub, onClick }: { on: boolean; title: string; sub: string; onClick: () => void }): JSX.Element {
  return (
    <button className={`focusable switch-row extras-row ${on ? 'on' : ''}`} onClick={onClick}>
      <span className="switch-knob" />
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </button>
  )
}

const STATUS: Record<Recording['status'], string> = {
  scheduled: 'Scheduled',
  recording: 'Recording now',
  done: 'Recorded',
  failed: 'Failed',
  cancelled: 'Cancelled'
}

function RecRow({ r }: { r: Recording }): JSX.Element {
  const when = new Date(r.start).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <div className={`rec-row ${r.status}`}>
      {r.status === 'recording' ? <span className="rec-dot" /> : <Icon name="record" size={18} />}
      <div className="rec-text">
        <b>{r.title}</b>
        <small>
          {r.channelName} · {when} · {STATUS[r.status]}
          {r.error ? ` · ${r.error}` : ''}
        </small>
      </div>
      {r.status === 'done' && r.file && (
        <button className="focusable btn small" onClick={() => void window.api.recordings.openFolder(r.file)}>
          Show
        </button>
      )}
      {(r.status === 'recording' || r.status === 'scheduled') && (
        <button className="focusable btn small" onClick={() => void window.api.recordings.stop(r.id)}>
          {r.status === 'recording' ? 'Stop' : 'Cancel'}
        </button>
      )}
      {r.status !== 'recording' && (
        <button className="focusable btn small" title="Remove from this list (the file stays)" onClick={() => void window.api.recordings.remove(r.id)}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}
