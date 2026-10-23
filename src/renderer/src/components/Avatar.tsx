import type { Profile } from '@shared/types'

/** Round profile picture: an emoji, or the first letter on the profile's colour. */
export function Avatar({ profile, size = 40 }: { profile: Pick<Profile, 'name' | 'color' | 'emoji'>; size?: number }): JSX.Element {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: profile.color, fontSize: profile.emoji ? size * 0.55 : size * 0.45 }}
      aria-hidden
    >
      {profile.emoji || profile.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
