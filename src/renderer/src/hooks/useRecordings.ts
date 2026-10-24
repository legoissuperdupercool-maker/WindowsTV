import { useCallback, useEffect, useState } from 'react'
import type { Recording, Reminder } from '@shared/types'

/** Recordings and reminders, kept up to date. */
export function useRecordings(): {
  recordings: Recording[]
  reminders: Reminder[]
  folder: string
  refresh: () => void
} {
  const [data, setData] = useState<{ recordings: Recording[]; reminders: Reminder[]; folder: string }>({
    recordings: [],
    reminders: [],
    folder: ''
  })
  const refresh = useCallback(() => {
    void window.api.recordings.list().then((r) => r.data && setData(r.data))
  }, [])
  useEffect(() => {
    refresh()
    return window.api.recordings.onChange(refresh)
  }, [refresh])
  return { ...data, refresh }
}
