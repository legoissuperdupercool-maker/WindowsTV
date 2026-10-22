// Icons are Google's Material Symbols (Rounded, filled) — the same icon family
// Android TV / Google TV use. Each SVG is imported as raw markup so only the
// icons listed here end up in the bundle.
import live from '@material-symbols/svg-400/rounded/live_tv-fill.svg?raw'
import guide from '@material-symbols/svg-400/rounded/view_timeline-fill.svg?raw'
import movie from '@material-symbols/svg-400/rounded/movie-fill.svg?raw'
import series from '@material-symbols/svg-400/rounded/video_library-fill.svg?raw'
import web from '@material-symbols/svg-400/rounded/public-fill.svg?raw'
import settings from '@material-symbols/svg-400/rounded/settings-fill.svg?raw'
import play from '@material-symbols/svg-400/rounded/play_arrow-fill.svg?raw'
import pause from '@material-symbols/svg-400/rounded/pause-fill.svg?raw'
import stop from '@material-symbols/svg-400/rounded/stop-fill.svg?raw'
import back from '@material-symbols/svg-400/rounded/arrow_back-fill.svg?raw'
import prev from '@material-symbols/svg-400/rounded/skip_previous-fill.svg?raw'
import next from '@material-symbols/svg-400/rounded/skip_next-fill.svg?raw'
import star from '@material-symbols/svg-400/rounded/star-fill.svg?raw'
import search from '@material-symbols/svg-400/rounded/search-fill.svg?raw'
import refresh from '@material-symbols/svg-400/rounded/refresh-fill.svg?raw'
import minimize from '@material-symbols/svg-400/rounded/remove-fill.svg?raw'
import maximize from '@material-symbols/svg-400/rounded/crop_square-fill.svg?raw'
import close from '@material-symbols/svg-400/rounded/close-fill.svg?raw'
import volume from '@material-symbols/svg-400/rounded/volume_up-fill.svg?raw'
import mute from '@material-symbols/svg-400/rounded/volume_off-fill.svg?raw'
import info from '@material-symbols/svg-400/rounded/info-fill.svg?raw'
import audio from '@material-symbols/svg-400/rounded/music_note-fill.svg?raw'
import subtitle from '@material-symbols/svg-400/rounded/subtitles-fill.svg?raw'
import tv from '@material-symbols/svg-400/rounded/tv-fill.svg?raw'
import home from '@material-symbols/svg-400/rounded/home-fill.svg?raw'
import apps from '@material-symbols/svg-400/rounded/apps-fill.svg?raw'
import add from '@material-symbols/svg-400/rounded/add-fill.svg?raw'
import open from '@material-symbols/svg-400/rounded/open_in_new-fill.svg?raw'
import chevron from '@material-symbols/svg-400/rounded/chevron_right-fill.svg?raw'
import history from '@material-symbols/svg-400/rounded/history-fill.svg?raw'

const ICONS: Record<string, string> = {
  live,
  guide,
  movie,
  series,
  web,
  settings,
  play,
  pause,
  stop,
  back,
  prev,
  next,
  star,
  search,
  refresh,
  minimize,
  maximize,
  close,
  volume,
  mute,
  info,
  audio,
  subtitle,
  tv,
  home,
  apps,
  add,
  open,
  chevron,
  history
}

export function Icon({ name, size = 22 }: { name: string; size?: number; stroke?: number }): JSX.Element {
  return (
    <span
      className="msi"
      aria-hidden
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS.tv }}
    />
  )
}
