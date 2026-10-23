import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useFullscreenVideoRegion } from '../hooks/useVideoRegion'
import { Icon } from './Icon'
import { Initials } from './Initials'
import type { EpgNowNext, Programme } from '@shared/types'

export function PlayerOverlay(): JSX.Element {
  const {
    playback,
    stopPlayback,
    setPlayerVisible,
    playAdjacent,
    play,
    playQueue,
    channels,
    currentSourceId,
    nowPlayingKind,
    episodeCtx,
    playEpisode,
    playNextEpisode
  } = useStore()
  const [showControls, setShowControls] = useState(true)
  const [showStats, setShowStats] = useState(false)
  const [nowNext, setNowNext] = useState<EpgNowNext>({})
  const [digits, setDigits] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [volumeHud, setVolumeHud] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useFullscreenVideoRegion(true)

  const channel = channels.find((c) => c.id === playback.channelId)
  const isLive = nowPlayingKind === 'live'
  const busy = playback.status === 'loading' || playback.status === 'buffering'
  const errored = playback.status === 'error'
  const nextEp = episodeCtx ? episodeCtx.episodes[episodeCtx.index + 1] : undefined
  const close = useCallback(() => {
    stopPlayback()
    setPlayerVisible(false)
  }, [stopPlayback, setPlayerVisible])

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

  // Now/next for live channels (refreshed every minute).
  useEffect(() => {
    if (!currentSourceId || !channel || !isLive) {
      setNowNext({})
      return
    }
    const load = (): void =>
      void window.api.epg.nowNext(currentSourceId, channel.epgChannelId, channel.name).then((r) => setNowNext(r.data ?? {}))
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [currentSourceId, channel?.id, isLive])

  // Volume indicator: flash briefly when *the user* changes volume or mute
  // (not when mpv reports its initial volume as a stream opens).
  const lastVolAction = useRef(0)
  const volAction = (): void => {
    lastVolAction.current = Date.now()
  }
  useEffect(() => {
    if (Date.now() - lastVolAction.current > 2000) return
    setVolumeHud(true)
    const t = setTimeout(() => setVolumeHud(false), 1500)
    return () => clearTimeout(t)
  }, [playback.volume, playback.muted])

  // End of a title: episodes count down to the next one; movies close.
  useEffect(() => {
    if (!playback.ended) {
      setCountdown(null)
      return
    }
    if (nextEp) {
      setCountdown(10)
      return
    }
    const t = setTimeout(close, 1500)
    return () => clearTimeout(t)
  }, [playback.ended])
  useEffect(() => {
    if (countdown == null) return
    if (countdown <= 0) {
      setCountdown(null)
      void playNextEpisode()
      return
    }
    const t = setTimeout(() => setCountdown((c) => (c == null ? c : c - 1)), 1000)
    return () => clearTimeout(t)
  }, [countdown, playNextEpisode])

  // Typed channel number (live): "1", "0", "3" → jump to channel 103.
  useEffect(() => {
    if (!digits) return
    const t = setTimeout(() => {
      const n = Number(digits)
      setDigits('')
      const target = channels.find((c) => c.type === 'live' && c.number === n)
      if (target) void play(target.id, playQueue.length ? playQueue : channels.filter((c) => c.type === 'live').map((c) => c.id))
      else {
        setNotice(`No channel ${n}`)
        setTimeout(() => setNotice(null), 1600)
      }
    }, 1400)
    return () => clearTimeout(t)
  }, [digits])

  // Player keys (work even when controls are hidden).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT') return
      if (isLive && /^[0-9]$/.test(e.key)) {
        setDigits((d) => (d + e.key).slice(0, 4))
        return
      }
      switch (e.key) {
        case '+':
        case '=':
          volAction()
          window.api.player.command({ action: 'volume', value: Math.min(130, playback.volume + 5) })
          return
        case '-':
          volAction()
          window.api.player.command({ action: 'volume', value: Math.max(0, playback.volume - 5) })
          return
        case 'm':
          volAction()
          window.api.player.command({ action: 'toggleMute' })
          return
      }
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
          if (isLive) {
            e.preventDefault()
            void playAdjacent(-1)
          }
          break
        case 'ArrowDown':
          if (isLive) {
            e.preventDefault()
            void playAdjacent(1)
          }
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showControls, reveal, playAdjacent, isLive, playback.volume])

  const retry = (): void => {
    if (episodeCtx) void playEpisode(episodeCtx.series, episodeCtx.episodes, episodeCtx.index)
    else if (playback.channelId) void window.api.player.load(playback.channelId)
  }

  const title = channel?.name ?? playback.title ?? 'Playing'
  const kindLabel = nowPlayingKind === 'series' ? 'episode' : nowPlayingKind === 'movie' ? 'movie' : 'channel'

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

      {/* Top bar: channel identity */}
      <div className="player-top">
        <button className="focusable tbtn" title="Back" onClick={close}>
          <Icon name="back" />
        </button>
        {isLive && channel && (
          <div className="player-chlogo">
            {channel.logo ? <img src={channel.logo} alt="" /> : <Initials name={channel.name} className="player-chlogo-ph" />}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="player-title">
            {isLive && channel?.number ? <span className="player-chno">{channel.number}</span> : null}
            {title}
            {isLive && <span className="live-pill">● LIVE</span>}
          </div>
        </div>
        <button className="focusable tbtn" title="Stream info" onClick={() => setShowStats((v) => !v)}>
          <Icon name="info" />
        </button>
      </div>

      {/* Typed channel number / notices */}
      {(digits || notice) && <div className="player-digits">{digits || notice}</div>}

      {/* Volume */}
      {volumeHud && (
        <div className="player-volume">
          <Icon name={playback.muted ? 'mute' : 'volume'} size={24} />
          <div className="vol-bar">
            <span style={{ width: `${playback.muted ? 0 : Math.min(100, playback.volume)}%` }} />
          </div>
          <span className="vol-num">{playback.muted ? 'Muted' : playback.volume}</span>
        </div>
      )}

      {/* Up next (series) */}
      {countdown != null && nextEp && (
        <div className="up-next">
          <div className="up-next-label">Up next · playing in {countdown}s</div>
          <div className="up-next-title">
            S{nextEp.season} E{nextEp.episode} · {nextEp.title}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="focusable btn primary" data-autofocus onClick={() => (setCountdown(null), void playNextEpisode())}>
              <Icon name="play" size={20} /> Play now
            </button>
            <button className="focusable btn" onClick={() => (setCountdown(null), close())}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Center status: loading / buffering / error — never a silent black screen. */}
      {(busy || errored) && (
        <div className={`player-status ${errored ? 'error' : ''}`}>
          {busy && <div className="spinner" />}
          {errored ? (
            <>
              <div className="title">Couldn’t play this {kindLabel}</div>
              <div className="msg">{playback.error ?? 'Unknown error.'}</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
                <button className="focusable btn accent" onClick={retry}>
                  <Icon name="refresh" size={18} /> Retry
                </button>
                <button className="focusable btn" onClick={close}>
                  Back
                </button>
              </div>
            </>
          ) : (
            <LoadingInfo onRetry={retry} onCancel={close} />
          )}
        </div>
      )}

      {/* Bottom controls */}
      <div className="player-controls">
        {showStats && (
          <div className="stats-chip">
            <span>
              <b>Resolution</b> {playback.stats?.width ? `${playback.stats.width}×${playback.stats.height}` : '—'}
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
              <b>Bitrate</b> {playback.stats?.bitrateKbps ? `${(playback.stats.bitrateKbps / 1000).toFixed(1)} Mbps` : '—'}
            </span>
            <span>
              <b>Buffer</b> {playback.stats?.demuxerCacheSeconds ?? 0}s
            </span>
          </div>
        )}

        {/* Live: now / next mini guide */}
        {isLive && (nowNext.now || nowNext.next) && (
          <div className="mini-guide">
            {nowNext.now && <GuideCell label="Now" p={nowNext.now} progress />}
            {nowNext.next && <GuideCell label="Next" p={nowNext.next} />}
          </div>
        )}

        {/* VOD: seek bar */}
        {!isLive && playback.duration > 0 && (
          <SeekBar position={playback.position} duration={playback.duration} onActivity={reveal} />
        )}

        <div className="transport">
          {isLive && (
            <button className="focusable tbtn" title="Previous channel" onClick={() => void playAdjacent(-1)}>
              <Icon name="prev" size={26} />
            </button>
          )}
          {!isLive && (
            <button className="focusable tbtn" title="Back 15 s" onClick={() => window.api.player.command({ action: 'seekRelative', value: -15 })}>
              <Icon name="prev" size={26} />
            </button>
          )}
          <button className="focusable tbtn primary" data-autofocus onClick={() => window.api.player.command({ action: 'toggle' })}>
            <Icon name={playback.paused ? 'play' : 'pause'} size={32} />
          </button>
          {isLive ? (
            <button className="focusable tbtn" title="Next channel" onClick={() => void playAdjacent(1)}>
              <Icon name="next" size={26} />
            </button>
          ) : nextEp ? (
            <button className="focusable tbtn" title={`Next episode: ${nextEp.title}`} onClick={() => void playNextEpisode()}>
              <Icon name="next" size={26} />
            </button>
          ) : (
            <button className="focusable tbtn" title="Forward 15 s" onClick={() => window.api.player.command({ action: 'seekRelative', value: 15 })}>
              <Icon name="next" size={26} />
            </button>
          )}
          <button
            className="focusable tbtn"
            title={playback.muted ? 'Unmute' : 'Mute'}
            onClick={() => (volAction(), window.api.player.command({ action: 'toggleMute' }))}
          >
            <Icon name={playback.muted ? 'mute' : 'volume'} />
          </button>
          <div style={{ flex: 1 }} />
          {isLive && <span className="key-hint">Type a channel number to jump</span>}
          <button className="focusable tbtn" title="Audio track" onClick={() => window.api.player.command({ action: 'cycleAudio' })}>
            <Icon name="audio" />
          </button>
          <button className="focusable tbtn" title="Subtitles" onClick={() => window.api.player.command({ action: 'cycleSub' })}>
            <Icon name="subtitle" />
          </button>
          <button className="focusable tbtn" title="Stop" onClick={close}>
            <Icon name="stop" />
          </button>
        </div>
      </div>
    </div>
  )
}

function GuideCell({ label, p, progress }: { label: string; p: Programme; progress?: boolean }): JSX.Element {
  const pct = Math.max(0, Math.min(100, ((Date.now() - p.start) / (p.stop - p.start)) * 100))
  return (
    <div className="mg-cell">
      <div className="mg-label">
        {label} · {fmtTime(p.start)}–{fmtTime(p.stop)}
      </div>
      <div className="mg-title">{p.title}</div>
      {progress && (
        <div className="epg-progress">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
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
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

/** Clickable / draggable progress bar for movies and episodes. */
function SeekBar({ position, duration, onActivity }: { position: number; duration: number; onActivity: () => void }): JSX.Element {
  const barRef = useRef<HTMLDivElement>(null)
  // While dragging, show where you'll land instead of the playing position.
  const [drag, setDrag] = useState<number | null>(null)
  const fractionAt = (clientX: number): number => {
    const r = barRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }
  const shown = drag ?? position / duration
  return (
    <div className="seek">
      <span>{fmtDur(shown * duration)}</span>
      <div
        ref={barRef}
        className={`seek-bar ${drag != null ? 'dragging' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(fractionAt(e.clientX))
          onActivity()
        }}
        onPointerMove={(e) => {
          if (drag != null) {
            setDrag(fractionAt(e.clientX))
            onActivity()
          }
        }}
        onPointerUp={(e) => {
          if (drag == null) return
          window.api.player.command({ action: 'seek', value: fractionAt(e.clientX) * duration })
          setDrag(null)
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="seek-track">
          <span style={{ width: `${shown * 100}%` }} />
        </div>
        <i className="seek-thumb" style={{ left: `${shown * 100}%` }} />
      </div>
      <span>-{fmtDur(duration - shown * duration)}</span>
    </div>
  )
}

/** What the player is doing while the picture isn't there yet, so a black screen is never a mystery. */
function LoadingInfo({ onRetry, onCancel }: { onRetry: () => void; onCancel: () => void }): JSX.Element {
  const playback = useStore((s) => s.playback)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const buffering = playback.status === 'buffering'
  const stage = buffering ? 'buffering' : (playback.stage ?? 'connecting')
  const elapsed = playback.loadStartedAt && !buffering ? Math.max(0, Math.round((now - playback.loadStartedAt) / 1000)) : 0
  const pct = playback.cacheBufferingPercent
  const speed = fmtSpeed(playback.stats?.downloadBytesPerSec)
  const slow = elapsed >= 10

  const steps: Array<{ key: string; label: string }> = [
    { key: 'connecting', label: 'Connecting' },
    { key: 'opening', label: 'Starting' }
  ]
  const headline =
    stage === 'connecting' ? 'Connecting to your provider…' : stage === 'opening' ? 'Starting playback…' : 'Buffering…'
  const detail = [
    stage !== 'connecting' && pct != null && pct < 100 ? `${pct}% buffered` : null,
    stage !== 'connecting' ? speed : null,
    elapsed > 0 ? `${elapsed} s` : null
  ].filter(Boolean)

  return (
    <div className="loading-info">
      {!buffering && (
        <div className="load-steps">
          {steps.map((s, i) => {
            const idx = steps.findIndex((x) => x.key === stage)
            return (
              <span key={s.key} className={i < idx ? 'done' : i === idx ? 'active' : ''}>
                {i < idx ? '✓' : i + 1}
                <em>{s.label}</em>
              </span>
            )
          })}
        </div>
      )}
      <div className="msg strong">{headline}</div>
      {stage !== 'connecting' && pct != null && pct < 100 && (
        <div className="load-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {detail.length > 0 && <div className="msg small">{detail.join('  ·  ')}</div>}
      {slow && (
        <div className="msg small hint">
          {stage === 'connecting'
            ? 'Your provider is slow to answer. It may be busy or the stream may be offline.'
            : 'Large streams (like 4K) can take a while to start on a slower connection.'}
        </div>
      )}
      <div className="load-actions">
        {slow && (
          <button className="focusable btn" onClick={onRetry}>
            <Icon name="refresh" size={18} /> Retry
          </button>
        )}
        <button className="focusable btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function fmtSpeed(bytesPerSec?: number): string | null {
  if (!bytesPerSec || bytesPerSec <= 0) return null
  const mbit = (bytesPerSec * 8) / 1e6
  return mbit >= 1 ? `${mbit.toFixed(mbit >= 10 ? 0 : 1)} Mbps` : `${Math.round(bytesPerSec / 1000 * 8)} kbps`
}
