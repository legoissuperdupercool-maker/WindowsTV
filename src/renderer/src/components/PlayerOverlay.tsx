import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useFullscreenVideoRegion } from '../hooks/useVideoRegion'
import { Icon } from './Icon'
import type { EpgNowNext } from '@shared/types'

export function PlayerOverlay(): JSX.Element {
  const { playback, stopPlayback, setPlayerVisible, playAdjacent, channels, currentSourceId, nowPlayingKind } =
    useStore()
  const [showControls, setShowControls] = useState(true)
  const [showStats, setShowStats] = useState(false)
  const [nowNext, setNowNext] = useState<EpgNowNext>({})
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useFullscreenVideoRegion(true)

  const channel = channels.find((c) => c.id === playback.channelId)
  const isLive = nowPlayingKind === 'live'
  const playing = playback.status === 'playing'
  const busy = playback.status === 'loading' || playback.status === 'buffering'
  const errored = playback.status === 'error'

  const reveal = useCallback(() => {
    setShowControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    // Only auto-hide while actually playing; keep visible if paused/busy/errored.
    hideTimer.current = setTimeout(() => {
      if (useStore.getState().playback.status === 'playing') setShowControls(false)
    }, 3800)
  }, [])

  useEffect(() => {
    reveal()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [reveal, playback.status, playback.channelId])

  // Current programme for the info bar.
  useEffect(() => {
    if (!currentSourceId || !channel) {
      setNowNext({})
      return
    }
    void window.api.epg
      .nowNext(currentSourceId, channel.epgChannelId, channel.name)
      .then((r) => setNowNext(r.data ?? {}))
  }, [currentSourceId, channel?.id])

  // Player key handling (works even when controls are hidden).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT') return
      // First interaction just reveals controls.
      if (!showControls && ['ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key)) {
        reveal()
        if (e.key !== 'Enter') e.preventDefault()
        return
      }
      switch (e.key) {
        case ' ':
          e.preventDefault()
          window.api.player.command({ action: 'toggle' })
          reveal()
          break
        case 'ArrowUp':
          e.preventDefault()
          void playAdjacent(-1)
          break
        case 'ArrowDown':
          e.preventDefault()
          void playAdjacent(1)
          break
        case 'ArrowRight':
          if (!isLive) {
            window.api.player.command({ action: 'seekRelative', value: 15 })
            reveal()
          }
          break
        case 'ArrowLeft':
          if (!isLive) {
            window.api.player.command({ action: 'seekRelative', value: -15 })
            reveal()
          }
          break
        case 'm':
          window.api.player.command({ action: 'toggleMute' })
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showControls, reveal, playAdjacent, isLive])

  const title = channel?.name ?? playback.title ?? 'Playing'

  return (
    <div
      className={`player-root ${showControls || busy || errored ? 'show-controls' : ''}`}
      onMouseMove={reveal}
      onClick={(e) => {
        // Click on the empty video area toggles play/pause (not on a control).
        if ((e.target as HTMLElement).classList.contains('player-hit')) {
          window.api.player.command({ action: 'toggle' })
          reveal()
        }
      }}
    >
      <div className="player-hit" style={{ position: 'absolute', inset: 0 }} />
      <div className="player-scrim" />

      {/* Top bar */}
      <div className="player-top">
        <button className="focusable tbtn" onClick={() => (stopPlayback(), setPlayerVisible(false))}>
          <Icon name="back" />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {title}
            {isLive && (
              <span
                style={{
                  marginLeft: 12,
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'var(--bad)',
                  verticalAlign: 'middle'
                }}
              >
                ● LIVE
              </span>
            )}
          </div>
          {nowNext.now && (
            <div style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 2 }}>
              {fmtTime(nowNext.now.start)}–{fmtTime(nowNext.now.stop)} · {nowNext.now.title}
              {nowNext.next && (
                <span style={{ color: 'var(--text-faint)' }}> · Next: {nowNext.next.title}</span>
              )}
            </div>
          )}
        </div>
        <button className="focusable tbtn" title="Stats" onClick={() => setShowStats((v) => !v)}>
          <Icon name="info" />
        </button>
      </div>

      {/* Center status: loading / buffering / error — never a silent black screen. */}
      {(busy || errored) && (
        <div className={`player-status ${errored ? 'error' : ''}`}>
          {busy && <div className="spinner" />}
          {errored ? (
            <>
              <div className="title">Couldn’t play this channel</div>
              <div className="msg">{playback.error ?? 'Unknown error.'}</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
                <button
                  className="focusable ghost-btn primary"
                  onClick={() => playback.channelId && window.api.player.load(playback.channelId)}
                >
                  <Icon name="refresh" size={16} /> Retry
                </button>
                <button
                  className="focusable ghost-btn"
                  onClick={() => (stopPlayback(), setPlayerVisible(false))}
                >
                  Back
                </button>
              </div>
            </>
          ) : (
            <div className="msg">
              {playback.status === 'buffering'
                ? `Buffering…${
                    playback.cacheBufferingPercent != null
                      ? ` ${playback.cacheBufferingPercent}%`
                      : ''
                  }`
                : `Loading ${title}…`}
            </div>
          )}
        </div>
      )}

      {/* Bottom controls */}
      <div className="player-controls">
        {showStats && (
          <div className="stats-chip" style={{ marginBottom: 14 }}>
            <span>
              <b>Resolution</b>{' '}
              {playback.stats?.width ? `${playback.stats.width}×${playback.stats.height}` : '—'}
            </span>
            <span>
              <b>Video</b> {playback.stats?.videoCodec ?? '—'}
            </span>
            <span>
              <b>Audio</b> {playback.stats?.audioCodec ?? '—'}
            </span>
            <span>
              <b>FPS</b> {playback.stats?.fps ?? '—'}
            </span>
            <span>
              <b>Bitrate</b>{' '}
              {playback.stats?.bitrateKbps ? `${(playback.stats.bitrateKbps / 1000).toFixed(1)} Mbps` : '—'}
            </span>
            <span>
              <b>Buffer</b> {playback.stats?.demuxerCacheSeconds ?? 0}s
            </span>
          </div>
        )}

        {!isLive && playback.duration > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="epg-progress" style={{ height: 6 }}>
              <span style={{ width: `${(playback.position / playback.duration) * 100}%` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              <span>{fmtDur(playback.position)}</span>
              <span>{fmtDur(playback.duration)}</span>
            </div>
          </div>
        )}

        <div className="transport">
          <button className="focusable tbtn" title="Previous channel" onClick={() => void playAdjacent(-1)}>
            <Icon name="prev" size={26} />
          </button>
          <button
            className="focusable tbtn primary"
            onClick={() => window.api.player.command({ action: 'toggle' })}
          >
            <Icon name={playing ? 'pause' : 'play'} size={32} />
          </button>
          <button className="focusable tbtn" title="Next channel" onClick={() => void playAdjacent(1)}>
            <Icon name="next" size={26} />
          </button>
          <button
            className="focusable tbtn"
            title={playback.muted ? 'Unmute' : 'Mute'}
            onClick={() => window.api.player.command({ action: 'toggleMute' })}
          >
            <Icon name={playback.muted ? 'mute' : 'volume'} />
          </button>
          <div style={{ flex: 1 }} />
          <button className="focusable tbtn" title="Audio track" onClick={() => window.api.player.command({ action: 'cycleAudio' })}>
            <Icon name="audio" />
          </button>
          <button className="focusable tbtn" title="Subtitles" onClick={() => window.api.player.command({ action: 'cycleSub' })}>
            <Icon name="subtitle" />
          </button>
          <button className="focusable tbtn" title="Stop" onClick={() => (stopPlayback(), setPlayerVisible(false))}>
            <Icon name="stop" />
          </button>
        </div>
      </div>
    </div>
  )
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`
}
