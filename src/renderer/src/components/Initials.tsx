// Fallback "logo" for channels with no artwork: initials on a colour that's
// stable per channel name, so a grid of logo-less channels isn't a wall of grey.

const PALETTE = ['#1a73e8', '#d93025', '#188038', '#9334e6', '#e8710a', '#007b83', '#185abc', '#c5221f', '#a142f4', '#b06000']

export function initialsColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function Initials({ name, className = 'logo-ph' }: { name: string; className?: string }): JSX.Element {
  const letters = name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  return (
    <div className={className} style={{ background: initialsColor(name) }}>
      {letters || name.slice(0, 2).toUpperCase()}
    </div>
  )
}
