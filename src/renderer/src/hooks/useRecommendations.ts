import { useEffect, useState } from 'react'
import { prepareRecommendations, recommend, type Recommendations, type SeedInfo } from '../recommend'
import type { Category, Channel, ListItem, WatchItem } from '@shared/types'

const EMPTY: Recommendations = { forYou: [] }

/** Recommendations worked out in the background: the rows appear a moment later instead of freezing the screen. */
export function useRecommendations(
  vod: Channel[],
  categories: Category[],
  myList: ListItem[],
  history: WatchItem[],
  seedInfo: Record<string, SeedInfo>
): Recommendations {
  const [recs, setRecs] = useState<Recommendations>(EMPTY)
  useEffect(() => {
    let cancelled = false
    if (!vod.length || (!myList.length && !history.length)) {
      setRecs(EMPTY)
      return
    }
    void prepareRecommendations(vod, categories).then(() => {
      if (!cancelled) setRecs(recommend(vod, categories, myList, history, seedInfo))
    })
    return () => {
      cancelled = true
    }
  }, [vod, categories, myList, history, seedInfo])
  return recs
}
