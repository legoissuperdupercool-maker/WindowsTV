import Store from 'electron-store'
import { app, dialog, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { extname, join, basename } from 'node:path'
import { userInfo } from 'node:os'
import type { ChannelSort, ListItem, Profile } from '../shared/types'
import { getSettings, updateSettings } from './store'
import type { WatchProgress } from './progress'

interface Data {
  activeId: string | null
  profiles: Profile[]
}

export const PROFILE_COLORS = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#e52592', '#12a4af', '#5f6368']
const MAX_PROFILES = 8
const MAX_BG_BYTES = 20 * 1024 * 1024

/**
 * Netflix-style profiles. Each person has their own favourites, recently
 * watched channels, watch progress, My List and background. The active
 * profile's favourites/recents live in the settings (where the rest of the app
 * reads them); switching profile swaps them in and out.
 */
export class Profiles {
  private store = new Store<Data>({ name: 'profiles', defaults: { activeId: null, profiles: [] } })

  constructor(private progress: WatchProgress) {
    if (!this.store.get('profiles').length) {
      // First run with profiles: everything saved so far becomes profile 1.
      const s = getSettings()
      const first: Profile = {
        id: 'default',
        name: defaultName(),
        color: PROFILE_COLORS[0],
        background: 'default',
        favorites: s.favorites,
        recents: s.recents,
        myList: [],
        createdAt: Date.now()
      }
      this.store.set({ activeId: first.id, profiles: [first] })
    }
    progress.useProfile(this.active().id)
  }

  active(): Profile {
    const { activeId, profiles } = this.store.store
    return profiles.find((p) => p.id === activeId) ?? profiles[0]
  }

  get(): { activeId: string; profiles: Profile[] } {
    return { activeId: this.active().id, profiles: this.syncedProfiles() }
  }

  /** Profiles with the active one's favourites/recents taken from the settings. */
  private syncedProfiles(): Profile[] {
    const s = getSettings()
    const activeId = this.active().id
    return this.store
      .get('profiles')
      .map((p) => (p.id === activeId ? { ...p, favorites: s.favorites, recents: s.recents } : p))
  }

  select(id: string): { activeId: string; profiles: Profile[] } {
    const profiles = this.syncedProfiles()
    const next = profiles.find((p) => p.id === id)
    if (!next) throw new Error('That profile no longer exists.')
    this.store.set({ activeId: id, profiles })
    updateSettings({ favorites: next.favorites, recents: next.recents })
    this.progress.useProfile(id)
    return this.get()
  }

  save(input: Partial<Profile> & { name: string }): { activeId: string; profiles: Profile[] } {
    const profiles = this.syncedProfiles()
    const name = input.name.trim().slice(0, 24) || 'Profile'
    const existing = input.id ? profiles.find((p) => p.id === input.id) : undefined
    if (existing) {
      Object.assign(existing, {
        name,
        color: input.color ?? existing.color,
        emoji: input.emoji === undefined ? existing.emoji : input.emoji || undefined,
        background: input.background ?? existing.background,
        kids: input.kids ?? existing.kids,
        hideAdult: input.hideAdult ?? existing.hideAdult,
        countries: stringList(input.countries) ?? existing.countries,
        hiddenCategories: stringList(input.hiddenCategories) ?? existing.hiddenCategories,
        hiddenChannels: stringList(input.hiddenChannels) ?? existing.hiddenChannels,
        channelSort: SORTS.includes(input.channelSort as ChannelSort) ? input.channelSort : existing.channelSort
      })
    } else {
      if (profiles.length >= MAX_PROFILES) throw new Error(`You can have up to ${MAX_PROFILES} profiles.`)
      profiles.push({
        id: randomUUID(),
        name,
        color: input.color ?? PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
        emoji: input.emoji || undefined,
        background: input.background ?? 'default',
        kids: input.kids ?? false,
        hideAdult: input.hideAdult ?? input.kids ?? false,
        favorites: [],
        recents: [],
        myList: [],
        createdAt: Date.now()
      })
    }
    this.store.set('profiles', profiles)
    return this.get()
  }

  delete(id: string): { activeId: string; profiles: Profile[] } {
    let profiles = this.syncedProfiles()
    if (profiles.length <= 1) throw new Error('You need at least one profile.')
    const gone = profiles.find((p) => p.id === id)
    if (!gone) return this.get()
    if (this.active().id === id) this.select(profiles.find((p) => p.id !== id)!.id)
    profiles = this.syncedProfiles().filter((p) => p.id !== id)
    this.store.set('profiles', profiles)
    this.progress.deleteProfile(id)
    removeBackgroundFile(gone.background)
    return this.get()
  }

  toggleMyList(item: ListItem): ListItem[] {
    const profiles = this.syncedProfiles()
    const me = profiles.find((p) => p.id === this.active().id)!
    me.myList = me.myList.some((i) => i.key === item.key)
      ? me.myList.filter((i) => i.key !== item.key)
      : [{ ...item, addedAt: Date.now() }, ...me.myList].slice(0, 500)
    this.store.set('profiles', profiles)
    return me.myList
  }

  /** Let the person pick a picture; it's copied into the app's folder. */
  async pickBackground(win: BrowserWindow, profileId: string): Promise<{ activeId: string; profiles: Profile[] } | null> {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a background picture',
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const src = res.filePaths[0]
    if (statSync(src).size > MAX_BG_BYTES) throw new Error('That picture is too big (20 MB max).')
    const dir = backgroundDir()
    mkdirSync(dir, { recursive: true })
    const file = `${profileId}-${Date.now()}${extname(src).toLowerCase()}`
    copyFileSync(src, join(dir, file))
    const profile = this.syncedProfiles().find((p) => p.id === profileId)
    if (profile) removeBackgroundFile(profile.background)
    return this.save({ id: profileId, name: profile?.name ?? 'Profile', background: `image:${file}` })
  }
}

function backgroundDir(): string {
  return join(app.getPath('userData'), 'backgrounds')
}

function removeBackgroundFile(background: string): void {
  if (!background.startsWith('image:')) return
  try {
    rmSync(join(backgroundDir(), basename(background.slice(6))), { force: true })
  } catch {
    /* already gone */
  }
}

/** A chosen background picture as a data: URL (the page can't load local files directly). */
export function backgroundImage(background: string): string | null {
  if (!background.startsWith('image:')) return null
  const file = join(backgroundDir(), basename(background.slice(6)))
  try {
    const ext = extname(file).slice(1).replace('jpg', 'jpeg')
    return `data:image/${ext};base64,${readFileSync(file).toString('base64')}`
  } catch {
    return null
  }
}

function defaultName(): string {
  try {
    const n = userInfo().username
    return n ? n.charAt(0).toUpperCase() + n.slice(1, 24) : 'Me'
  } catch {
    return 'Me'
  }
}

const SORTS: ChannelSort[] = ['provider', 'name', 'number']

/** Lists of ids from the renderer: strings only, and not unbounded. */
function stringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.filter((x): x is string => typeof x === 'string' && x.length < 300).slice(0, 5000)
}
