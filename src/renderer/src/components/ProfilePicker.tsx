import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Avatar, AvatarArt, fallbackArt } from './Avatar'
import { Icon } from './Icon'
import { Wordmark } from './TopBar'
import { BACKGROUNDS, PROFILE_COLORS, backgroundCss } from '../backgrounds'
import { ACCENTS, swatchBackground } from '../theme'
import { AVATARS, freeAvatar } from '../avatars'
import type { Profile } from '@shared/types'

/** "Who's watching?": big pictures, names under them, and profile management. */
export function ProfilePicker(): JSX.Element {
  const { profiles, activeProfileId, selectProfile } = useStore()
  const [manage, setManage] = useState(false)
  const [editing, setEditing] = useState<Profile | 'new' | null>(null)

  if (editing) return <ProfileEditor profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />

  return (
    <div className="pp-screen">
      <div className="pp-logo">
        <Wordmark />
      </div>
      <div className="pp-center">
        <h1 className="pp-title">{manage ? 'Manage profiles' : 'Who’s watching?'}</h1>
        <div className="pp-row">
          {profiles.map((p) => (
            <button
              key={p.id}
              className={`focusable pp-tile ${manage ? 'manage' : ''}`}
              data-autofocus={p.id === activeProfileId ? true : undefined}
              onClick={() => (manage ? setEditing(p) : void selectProfile(p.id))}
            >
              <span className="pp-pic">
                <Avatar profile={p} size={168} />
                {manage && (
                  <span className="pp-edit">
                    <Icon name="edit" size={44} />
                  </span>
                )}
                {p.kids && <span className="pp-kids">KIDS</span>}
              </span>
              <span className="pp-name">{p.name}</span>
            </button>
          ))}
          {profiles.length < 8 && (
            <button className="focusable pp-tile" onClick={() => setEditing('new')}>
              <span className="pp-pic pp-add">
                <Icon name="add" size={72} />
              </span>
              <span className="pp-name">Add profile</span>
            </button>
          )}
        </div>
        <button className={`focusable pp-manage ${manage ? 'done' : ''}`} onClick={() => setManage((m) => !m)}>
          {manage ? 'Done' : 'Manage profiles'}
        </button>
      </div>
    </div>
  )
}

/** Full-screen profile editor, with the picture chooser behind the pencil. */
function ProfileEditor({ profile, onClose }: { profile: Profile | null; onClose: () => void }): JSX.Element {
  const { saveProfile, deleteProfile, pickBackground, profiles } = useStore()
  const [name, setName] = useState(profile?.name ?? '')
  const [avatar, setAvatar] = useState(profile?.avatar ?? (profile ? `art:${fallbackArt(profile.id)}` : freeAvatar(profiles.map((p) => p.avatar))))
  const [accent, setAccent] = useState(profile?.accent ?? 'auto')
  const [background, setBackground] = useState(profile?.background ?? 'default')
  const [kids, setKids] = useState(profile?.kids ?? false)
  const [hideAdult, setHideAdult] = useState(profile?.hideAdult ?? false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const live = profiles.find((p) => p.id === profile?.id)
  const hasPicture = (live?.background ?? background).startsWith('image:')

  useEffect(() => {
    if (choosing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, choosing])

  const save = async (): Promise<void> => {
    if (!name.trim()) return setError('Give the profile a name.')
    const bg = background === 'image' ? live?.background ?? 'default' : background
    const color = profile?.color ?? PROFILE_COLORS[profiles.length % PROFILE_COLORS.length]
    const err = await saveProfile({ id: profile?.id, name, color, avatar, accent, background: bg, kids, hideAdult: kids || hideAdult })
    if (err) setError(err)
    else onClose()
  }

  const choosePicture = async (): Promise<void> => {
    if (!profile) return
    const err = await pickBackground(profile.id)
    if (err) setError(err)
    else setBackground('image')
  }

  if (choosing)
    return (
      <AvatarChooser
        current={avatar}
        name={name || 'New profile'}
        onPick={(a) => {
          setAvatar(a)
          setChoosing(false)
        }}
        onClose={() => setChoosing(false)}
      />
    )

  return (
    <div className="pp-screen editor">
      <div className="pp-logo">
        <Wordmark />
      </div>
      <div className="pe-wrap" data-modal>
        <h1 className="pe-title">{profile ? 'Edit profile' : 'Add profile'}</h1>
        <div className="pe-body">
          <button className="focusable pe-avatar" title="Change picture" onClick={() => setChoosing(true)}>
            <Avatar profile={{ id: profile?.id, name: name || '?', avatar }} size={168} />
            <span className="pe-pencil">
              <Icon name="edit" size={22} />
            </span>
          </button>
          <div className="pe-fields">
            <input
              className="pe-name"
              value={name}
              maxLength={24}
              placeholder="Name"
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />

            <div className="pe-label">Theme colour</div>
            <div className="pe-swatches">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  className={`focusable pe-swatch ${(accent ?? 'auto') === a.id ? 'on' : ''}`}
                  style={{ background: swatchBackground(a.color) }}
                  title={a.name}
                  onClick={() => setAccent(a.id)}
                />
              ))}
            </div>

            <div className="pe-label">Background</div>
            <div className="bg-grid">
              {BACKGROUNDS.map((b) => (
                <button key={b.id} className={`focusable bg-option ${background === b.id ? 'on' : ''}`} onClick={() => setBackground(b.id)}>
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
                  <Icon name="image" size={24} />
                </span>
                <span>{hasPicture ? 'Change picture' : 'Your picture'}</span>
              </button>
            </div>

            <div className="pe-label">Viewing</div>
            <div className="profile-switches">
              <button className={`focusable switch-row ${kids ? 'on' : ''}`} onClick={() => setKids((k) => !k)}>
                <span className="switch-knob" />
                <span>
                  <b>Kids profile</b>
                  <small>Only kids &amp; family categories. Adult content is always hidden.</small>
                </span>
              </button>
              <button className={`focusable switch-row ${kids || hideAdult ? 'on' : ''}`} onClick={() => !kids && setHideAdult((h) => !h)} disabled={kids}>
                <span className="switch-knob" />
                <span>
                  <b>Hide adult content</b>
                  <small>Leaves out adult categories and titles everywhere.</small>
                </span>
              </button>
            </div>
            {error && <div className="test-result bad">{error}</div>}
          </div>
        </div>
        <div className="pe-actions">
          <button className="focusable pe-btn primary" onClick={() => void save()}>
            Save
          </button>
          <button className="focusable pe-btn" onClick={onClose}>
            Cancel
          </button>
          {profile && profiles.length > 1 &&
            (confirmDelete ? (
              <button className="focusable pe-btn danger" onClick={() => void deleteProfile(profile.id).then((e) => (e ? setError(e) : onClose()))}>
                Yes, delete {profile.name}
              </button>
            ) : (
              <button className="focusable pe-btn" onClick={() => setConfirmDelete(true)}>
                Delete profile
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

/** "Choose a profile picture": ello's characters, or your own photo. */
function AvatarChooser({ current, name, onPick, onClose }: { current: string; name: string; onPick: (a: string) => void; onClose: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const upload = async (): Promise<void> => {
    const r = await window.api.profiles.pickAvatar()
    if (r.ok && r.data) onPick(r.data)
    else if (!r.ok) setError(r.error ?? 'Couldn’t use that picture.')
  }
  return (
    <div className="pp-screen chooser">
      <div className="ac-head" data-modal>
        <button className="focusable ac-back" title="Back" onClick={onClose}>
          <Icon name="back" size={26} />
        </button>
        <div>
          <h1>Choose a profile picture</h1>
          <p>for {name}</p>
        </div>
        <span style={{ flex: 1 }} />
        <Avatar profile={{ name, avatar: current }} size={64} />
      </div>
      <div className="ac-body" data-modal>
        <h2>Your own picture</h2>
        <div className="ac-row">
          <button className="focusable ac-tile ac-upload" onClick={() => void upload()}>
            <Icon name="image" size={40} />
            <span>Upload a photo</span>
          </button>
          {current.startsWith('image:') && (
            <button className="focusable ac-tile on" onClick={() => onPick(current)}>
              <Avatar profile={{ name, avatar: current }} size={140} />
            </button>
          )}
        </div>
        {error && <div className="test-result bad">{error}</div>}
        <h2>The ello crew</h2>
        <div className="ac-row">
          {AVATARS.map((a) => (
            <button
              key={a.id}
              className={`focusable ac-tile ${current === `art:${a.id}` ? 'on' : ''}`}
              title={a.name}
              data-autofocus={current === `art:${a.id}` ? true : undefined}
              onClick={() => onPick(`art:${a.id}`)}
            >
              <AvatarArt id={a.id} size={140} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
