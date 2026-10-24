import { useEffect, useState } from 'react'
import { AVATARS, avatarArt } from '../avatars'
import type { Profile } from '@shared/types'

// Uploaded pictures arrive as data: URLs from the main process; kept per session.
const imageCache = new Map<string, string | null>()

function useUploaded(ref?: string): string | null {
  const [url, setUrl] = useState<string | null>(ref ? imageCache.get(ref) ?? null : null)
  useEffect(() => {
    if (!ref?.startsWith('image:')) return setUrl(null)
    if (imageCache.has(ref)) return setUrl(imageCache.get(ref) ?? null)
    let alive = true
    void window.api.profiles.avatarImage(ref).then((r) => {
      imageCache.set(ref, r.data ?? null)
      if (alive) setUrl(r.data ?? null)
    })
    return () => {
      alive = false
    }
  }, [ref])
  return url
}

/** The character a profile without a chosen picture gets (stable per profile). */
export function fallbackArt(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATARS[h % AVATARS.length].id
}

/** Rounded-square profile picture: one of ello's characters, or an uploaded photo. */
export function Avatar({
  profile,
  size = 40,
  round = false
}: {
  profile: Pick<Profile, 'name'> & Partial<Pick<Profile, 'id' | 'avatar' | 'color'>>
  size?: number
  round?: boolean
}): JSX.Element {
  const ref = profile.avatar
  const uploaded = useUploaded(ref)
  const art = avatarArt(ref?.startsWith('art:') ? ref.slice(4) : fallbackArt(profile.id ?? profile.name))
  const radius = round ? '50%' : `${Math.max(4, Math.round(size * 0.12))}px`
  return (
    <span className="avatar pic" style={{ width: size, height: size, borderRadius: radius }} aria-hidden>
      {ref?.startsWith('image:') ? (
        uploaded ? <img src={uploaded} alt="" /> : null
      ) : (
        art && <span className="avatar-art" dangerouslySetInnerHTML={{ __html: art.svg }} />
      )}
    </span>
  )
}

/** Just the character drawing, for the picture chooser. */
export function AvatarArt({ id, size }: { id: string; size: number }): JSX.Element | null {
  const art = avatarArt(id)
  if (!art) return null
  return (
    <span className="avatar pic" style={{ width: size, height: size, borderRadius: Math.round(size * 0.12) }}>
      <span className="avatar-art" dangerouslySetInnerHTML={{ __html: art.svg }} />
    </span>
  )
}
