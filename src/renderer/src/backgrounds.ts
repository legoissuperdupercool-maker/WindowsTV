/** Background presets a profile can pick (calm, dark enough for white text). */
export const BACKGROUNDS: Array<{ id: string; name: string; css: string }> = [
  {
    id: 'default',
    name: 'ello',
    css: 'radial-gradient(1100px 520px at 0% -10%, rgba(76,141,255,0.16), transparent 70%), #0e1013'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    css: 'radial-gradient(1200px 700px at 80% -20%, rgba(66,90,200,0.35), transparent 70%), linear-gradient(180deg, #0b1026, #0a0c14)'
  },
  {
    id: 'aurora',
    name: 'Aurora',
    css: 'radial-gradient(900px 520px at 10% 0%, rgba(52,199,89,0.26), transparent 70%), radial-gradient(900px 520px at 95% 10%, rgba(147,52,230,0.30), transparent 70%), #0b0d12'
  },
  {
    id: 'sunset',
    name: 'Sunset',
    css: 'radial-gradient(1000px 560px at 100% 0%, rgba(255,112,67,0.30), transparent 70%), radial-gradient(900px 500px at 0% 100%, rgba(229,37,146,0.22), transparent 70%), #120c10'
  },
  {
    id: 'ocean',
    name: 'Ocean',
    css: 'radial-gradient(1100px 600px at 50% -20%, rgba(18,164,175,0.32), transparent 70%), linear-gradient(180deg, #071a22, #070d12)'
  },
  {
    id: 'forest',
    name: 'Forest',
    css: 'radial-gradient(1000px 560px at 0% 0%, rgba(24,128,56,0.34), transparent 70%), linear-gradient(180deg, #0a1610, #090c0b)'
  },
  {
    id: 'rose',
    name: 'Rose',
    css: 'radial-gradient(1000px 560px at 90% -10%, rgba(244,114,182,0.26), transparent 70%), #130d12'
  },
  { id: 'black', name: 'Black', css: '#000000' }
]

export function backgroundCss(id: string | undefined): string {
  return (BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0]).css
}

/** A chosen picture, darkened so text stays readable on top of it. */
export function imageBackgroundCss(dataUrl: string): string {
  return `linear-gradient(rgba(10,11,14,0.55), rgba(10,11,14,0.88)), url("${dataUrl}") center / cover no-repeat`
}

export const PROFILE_COLORS = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#e52592', '#12a4af', '#5f6368']
export const PROFILE_EMOJIS = ['', '😀', '😎', '🦄', '🐱', '🐶', '🦊', '🐼', '🚀', '⚽', '🎮', '🎬', '🌙']
