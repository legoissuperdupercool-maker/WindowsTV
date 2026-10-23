import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { MediaTrack } from '@shared/types'

const cmd = (action: Parameters<typeof window.api.player.command>[0]['action'], value?: number): void =>
  void window.api.player.command({ action, value })

const langNames = new Intl.DisplayNames(['en'], { type: 'language' })
const ISO3: Record<string, string> = {
  eng: 'en', dut: 'nl', nld: 'nl', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', por: 'pt',
  tur: 'tr', ara: 'ar', rus: 'ru', pol: 'pl', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', hin: 'hi', swe: 'sv',
  nor: 'no', dan: 'da', fin: 'fi', gre: 'el', ell: 'el', heb: 'he', hun: 'hu', cze: 'cs', ces: 'cs', rum: 'ro',
  ron: 'ro', ukr: 'uk', vie: 'vi', tha: 'th', ind: 'id', may: 'ms', msa: 'ms', per: 'fa', fas: 'fa'
}

function language(code?: string): string | undefined {
  if (!code || code === 'und') return undefined
  try {
    const name = langNames.of(ISO3[code.toLowerCase()] ?? code)
    return name && name !== code ? name : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

const CODECS: Record<string, string> = { aac: 'AAC', ac3: 'Dolby Digital', eac3: 'Dolby Digital+', truehd: 'Dolby TrueHD', dts: 'DTS', mp3: 'MP3', opus: 'Opus', flac: 'FLAC', subrip: 'SRT', ass: 'ASS', mov_text: 'Text', webvtt: 'WebVTT', hdmv_pgs_subtitle: 'Image', dvd_subtitle: 'Image', dvb_subtitle: 'Image' }

function channelsLabel(n?: number): string | undefined {
  if (!n) return undefined
  return n === 1 ? 'Mono' : n === 2 ? 'Stereo' : n === 6 ? '5.1' : n === 8 ? '7.1' : `${n} ch`
}

/** "English", "English · Commentary", or "Track 2" when the stream says nothing. */
export function trackLabel(t: MediaTrack, n: number): { main: string; sub: string } {
  const lang = language(t.lang)
  const title = t.title && t.title.toLowerCase() !== (lang ?? '').toLowerCase() ? t.title : undefined
  const main = [lang, title].filter(Boolean).join(' · ') || `Track ${n}`
  const sub = [CODECS[t.codec ?? ''] ?? t.codec?.toUpperCase(), channelsLabel(t.channels), t.forced ? 'Forced' : undefined, t.external ? 'External' : undefined]
    .filter(Boolean)
    .join(' · ')
  return { main, sub }
}

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.stopPropagation()
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    ref.current?.querySelector<HTMLElement>('.on, button')?.focus()
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])
  return (
    <div className="player-pop" ref={ref} onMouseDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

function Stepper({ label, value, unit, step, min, max, onChange, format }: {
  label: string; value: number; unit?: string; step: number; min: number; max: number
  onChange: (v: number) => void; format?: (v: number) => string
}): JSX.Element {
  const set = (v: number): void => onChange(Math.round(Math.max(min, Math.min(max, v)) * 100) / 100)
  return (
    <div className="pop-stepper">
      <span>{label}</span>
      <button className="focusable" onClick={() => set(value - step)} aria-label={`Less ${label}`}>−</button>
      <b>{format ? format(value) : `${value}${unit ?? ''}`}</b>
      <button className="focusable" onClick={() => set(value + step)} aria-label={`More ${label}`}>+</button>
    </div>
  )
}

const fmtDelay = (v: number): string => (v === 0 ? 'In sync' : `${v > 0 ? '+' : ''}${v.toFixed(1)} s`)

/** Audio: pick a language/track, fix lip sync. */
export function AudioMenu({ tracks, onClose }: { tracks: MediaTrack[]; onClose: () => void }): JSX.Element {
  const [delay, setDelay] = useState(0)
  return (
    <Popover onClose={onClose}>
      <div className="pop-title">Audio</div>
      {tracks.length === 0 && <div className="pop-empty">This stream has no separate audio tracks.</div>}
      {tracks.map((t, i) => {
        const l = trackLabel(t, i + 1)
        return (
          <button key={t.id} className={`focusable pop-item ${t.selected ? 'on' : ''}`} onClick={() => cmd('setAudioTrack', t.id)}>
            <span className="pop-check">{t.selected && <Icon name="check" size={18} />}</span>
            <span className="pop-text"><b>{l.main}</b>{l.sub && <small>{l.sub}</small>}</span>
          </button>
        )
      })}
      <div className="pop-sep" />
      <Stepper label="Sound delay" value={delay} step={0.1} min={-5} max={5} format={fmtDelay}
        onChange={(v) => { setDelay(v); cmd('audioDelay', v) }} />
    </Popover>
  )
}

/** Subtitles: off or a track, size and timing. */
export function SubtitleMenu({ tracks, onClose }: { tracks: MediaTrack[]; onClose: () => void }): JSX.Element {
  const [scale, setScale] = useState(1)
  const [delay, setDelay] = useState(0)
  const off = !tracks.some((t) => t.selected)
  return (
    <Popover onClose={onClose}>
      <div className="pop-title">Subtitles</div>
      <button className={`focusable pop-item ${off ? 'on' : ''}`} onClick={() => cmd('setSubTrack', 0)}>
        <span className="pop-check">{off && <Icon name="check" size={18} />}</span>
        <span className="pop-text"><b>Off</b></span>
      </button>
      {tracks.length === 0 && <div className="pop-empty">This title has no subtitles from your provider.</div>}
      {tracks.map((t, i) => {
        const l = trackLabel(t, i + 1)
        return (
          <button key={t.id} className={`focusable pop-item ${t.selected ? 'on' : ''}`} onClick={() => cmd('setSubTrack', t.id)}>
            <span className="pop-check">{t.selected && <Icon name="check" size={18} />}</span>
            <span className="pop-text"><b>{l.main}</b>{l.sub && <small>{l.sub}</small>}</span>
          </button>
        )
      })}
      {tracks.length > 0 && (
        <>
          <div className="pop-sep" />
          <Stepper label="Size" value={scale} step={0.1} min={0.5} max={2.5} format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => { setScale(v); cmd('subScale', v) }} />
          <Stepper label="Timing" value={delay} step={0.1} min={-10} max={10} format={fmtDelay}
            onChange={(v) => { setDelay(v); cmd('subDelay', v) }} />
        </>
      )}
    </Popover>
  )
}

/** Volume slider with mute. */
export function VolumeMenu({ volume, muted, onClose }: { volume: number; muted: boolean; onClose: () => void }): JSX.Element {
  const shown = muted ? 0 : volume
  return (
    <Popover onClose={onClose}>
      <div className="pop-title">Volume <span className="pop-value">{muted ? 'Muted' : `${volume}%`}</span></div>
      <div className="pop-volume">
        <button className="focusable pop-round" onClick={() => cmd('toggleMute')} title={muted ? 'Unmute' : 'Mute'}>
          <Icon name={muted || volume === 0 ? 'mute' : 'volume'} size={22} />
        </button>
        <input
          type="range"
          min={0}
          max={130}
          step={1}
          value={shown}
          style={{ ['--fill' as string]: `${(shown / 130) * 100}%` }}
          onChange={(e) => {
            if (muted) cmd('unmute')
            cmd('volume', Number(e.target.value))
          }}
        />
      </div>
      <div className="pop-hint">+ and − change the volume while watching, M mutes. Above 100% boosts quiet streams.</div>
    </Popover>
  )
}
