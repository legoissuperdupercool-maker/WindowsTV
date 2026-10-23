import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { BACKGROUNDS, PROFILE_COLORS, PROFILE_EMOJIS, backgroundCss } from '../backgrounds'
import type { Profile } from '@shared/types'

/** Netflix-style "Who's watching?" screen, with profile management. */
export function ProfilePicker(): JSX.Element {
  const { profiles, activeProfileId, selectProfile } = useStore()
  const [manage, setManage] = useState(false)
  const [editing, setEditing] = useState<Profile | 'new' | null>(null)

  return (
    <div className="profile-screen">
      <h1>{manage ? 'Manage profiles' : 'Who’s watching?'}</h1>
      <div className="profile-row">
        {profiles.map((p) => (
          <button
            key={p.id}
            className={`focusable profile-tile ${p.id === activeProfileId ? 'current' : ''}`}
            data-autofocus={p.id === activeProfileId ? true : undefined}
            onClick={() => (manage ? setEditing(p) : void selectProfile(p.id))}
          >
            <span className="profile-pic">
              <Avatar profile={p} size={132} />
              {manage && (
                <span className="profile-edit">
                  <Icon name="edit" size={36} />
                </span>
              )}
            </span>
            <span className="profile-name">{p.name}</span>
          </button>
        ))}
        {profiles.length < 8 && (
          <button className="focusable profile-tile" onClick={() => setEditing('new')}>
            <span className="profile-pic add">
              <Icon name="add" size={56} />
            </span>
            <span className="profile-name">Add profile</span>
          </button>
        )}
      </div>
      <button className="focusable btn ghost-outline" onClick={() => setManage((m) => !m)}>
        {manage ? 'Done' : 'Manage profiles'}
      </button>
      {editing && <ProfileEditor profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ProfileEditor({ profile, onClose }: { profile: Profile | null; onClose: () => void }): JSX.Element {
  const { saveProfile, deleteProfile, pickBackground, profiles } = useStore()
  const [name, setName] = useState(profile?.name ?? '')
  const [color, setColor] = useState(profile?.color ?? PROFILE_COLORS[profiles.length % PROFILE_COLORS.length])
  const [emoji, setEmoji] = useState(profile?.emoji ?? '')
  const [background, setBackground] = useState(profile?.background ?? 'default')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The picture background is saved straight away by the main process.
  const live = profiles.find((p) => p.id === profile?.id)
  const hasPicture = (live?.background ?? background).startsWith('image:')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (): Promise<void> => {
    if (!name.trim()) return setError('Give the profile a name.')
    const bg = background === 'image' ? live?.background ?? 'default' : background
    const err = await saveProfile({ id: profile?.id, name, color, emoji, background: bg })
    if (err) setError(err)
    else onClose()
  }

  const choosePicture = async (): Promise<void> => {
    if (!profile) return
    const err = await pickBackground(profile.id)
    if (err) setError(err)
    else setBackground('image')
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet profile-sheet" role="dialog" aria-label="Edit profile">
        <div className="profile-sheet-head">
          <Avatar profile={{ name: name || '?', color, emoji }} size={84} />
          <input
            className="profile-name-input"
            value={name}
            maxLength={24}
            placeholder="Name"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
        </div>

        <div className="field-label">Colour</div>
        <div className="swatches">
          {PROFILE_COLORS.map((c) => (
            <button
              key={c}
              className={`focusable swatch ${c === color ? 'on' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <div className="field-label">Picture</div>
        <div className="swatches">
          {PROFILE_EMOJIS.map((e) => (
            <button key={e || 'none'} className={`focusable emoji ${e === emoji ? 'on' : ''}`} onClick={() => setEmoji(e)}>
              {e || (name.trim().charAt(0).toUpperCase() || 'A')}
            </button>
          ))}
        </div>

        <div className="field-label">Background</div>
        <div className="bg-grid">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.id}
              className={`focusable bg-option ${background === b.id ? 'on' : ''}`}
              onClick={() => setBackground(b.id)}
            >
              <span className="bg-swatch" style={{ background: backgroundCss(b.id) }} />
              <span>{b.name}</span>
            </button>
          ))}
          <button
            className={`focusable bg-option ${background === 'image' || (background.startsWith('image:') && hasPicture) ? 'on' : ''}`}
            onClick={() => void choosePicture()}
            disabled={!profile}
            title={profile ? 'Use a picture from this PC' : 'Save the profile first, then choose a picture'}
          >
            <span className="bg-swatch picture">
              <Icon name="image" size={26} />
            </span>
            <span>{hasPicture ? 'Change picture' : 'Your picture'}</span>
          </button>
        </div>

        {error && <div className="test-result bad">{error}</div>}

        <div className="sheet-actions">
          {profile && profiles.length > 1 && (
            confirmDelete ? (
              <button className="focusable btn danger" onClick={() => void deleteProfile(profile.id).then((e) => (e ? setError(e) : onClose()))}>
                Delete {profile.name}?
              </button>
            ) : (
              <button className="focusable btn" onClick={() => setConfirmDelete(true)}>
                <Icon name="delete" size={18} /> Delete
              </button>
            )
          )}
          <span className="spacer" />
          <button className="focusable btn" onClick={onClose}>
            Cancel
          </button>
          <button className="focusable btn primary" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
