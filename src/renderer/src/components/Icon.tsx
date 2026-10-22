// Small inline-SVG icon set (stroke-based, inherits currentColor) so the UI stays
// crisp at TV sizes without an icon-font dependency.

const paths: Record<string, string> = {
  live: 'M4 7h16v11H4zM8 4l4 3 4-3',
  guide: 'M4 5h16v14H4zM4 9h16M9 5v14',
  movie: 'M4 5h16v14H4zM4 9h16M8 5v4M16 5v4M8 15h8',
  series: 'M3 7h13v10H3zM16 9l5-2v10l-5-2',
  web: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  settings:
    'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 00-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 00-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 00-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 000 2l-2 1.5 2 3.4 2.3-1a7 7 0 001.7 1l.3 2.5h4l.3-2.5a7 7 0 001.7-1l2.3 1 2-3.4-2-1.5c.07-.3.1-.66.1-1z',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  stop: 'M6 6h12v12H6z',
  back: 'M15 5l-7 7 7 7',
  star: 'M12 3l2.9 6 6.6.5-5 4.3 1.6 6.4L12 17l-6.1 3.2L7.5 13.8l-5-4.3 6.6-.5z',
  search: 'M11 4a7 7 0 105 12 7 7 0 00-5-12zM21 21l-5-5',
  refresh: 'M4 4v5h5M20 20v-5h-5M20 9a8 8 0 00-14-3L4 9M4 15a8 8 0 0014 3l2-3',
  minimize: 'M6 12h12',
  maximize: 'M5 5h14v14H5z',
  close: 'M6 6l12 12M18 6L6 18',
  volume: 'M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 010 8M19 5a9 9 0 010 14',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6',
  info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 100 18 9 9 0 000-18z',
  audio: 'M9 18V5l12-2v13M9 13l12-2M6 18a3 3 0 100 .01',
  subtitle: 'M4 5h16v14H4zM7 15h5M15 15h2M7 11h2M12 11h5',
  tv: 'M4 6h16v11H4zM9 20h6M8 3l4 3 4-3'
}

export function Icon({
  name,
  size = 20,
  stroke = 2
}: {
  name: keyof typeof paths | string
  size?: number
  stroke?: number
}): JSX.Element {
  const filled = name === 'play' || name === 'pause' || name === 'stop' || name === 'star'
  const d = paths[name] ?? ''
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}
