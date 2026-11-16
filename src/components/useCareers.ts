import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { brandingQuery, showsBranding } from '../lib/hiring'
import type { Branding } from '../lib/types'

// The public careers pages (the job list and one job). Reached without
// signing in, so branding comes only through public_branding. `?branding=off`
// drops the top bar; the colour and perks stay.
export function usePublicBranding() {
  const [branding, setBranding] = useState<Branding | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    supabase
      .rpc('public_branding')
      .maybeSingle()
      .then(({ data }) => {
        setBranding((data as Branding | null) ?? null)
        setLoaded(true)
      })
  }, [])
  return { branding, loaded }
}

// Whether this visit shows the top bar, and the query that keeps it so on
// links between the careers pages.
export function useBrandingParam() {
  const [params] = useSearchParams()
  const branded = showsBranding(params)
  return { branded, query: brandingQuery(branded) }
}

export function usePageTitle(title: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
