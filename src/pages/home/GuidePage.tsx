import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Button, LinearProgress, Paper, Stack } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { supabase } from '../../lib/supabase'
import { BUSINESS_FUNCTION_LABELS } from '../../lib/constants'
import { GUIDE_COLUMNS, guideUrls } from '../../lib/guides'
import type { Guide } from '../../lib/types'
import { PageHeader } from '../../components/common'

// One guide's Google Doc, framed like the handbook. A guide that doesn't
// exist, isn't the viewer's to read (RLS) or has no doc yet sends them back
// to Resources.
export default function GuidePage() {
  const { slug } = useParams()
  const [guide, setGuide] = useState<Guide | null | undefined>(undefined)

  useEffect(() => {
    supabase
      .from('guides')
      .select(GUIDE_COLUMNS)
      .eq('slug', slug!)
      .maybeSingle()
      .then(({ data }) => setGuide((data as Guide | null) ?? null))
  }, [slug])

  if (guide === undefined) return <LinearProgress />
  if (!guide?.doc_url) return <Navigate to="/resources" replace />
  const { open, embed } = guideUrls(guide.doc_url)

  return (
    <>
      <PageHeader
        title={guide.title}
        subtitle={`${BUSINESS_FUNCTION_LABELS[guide.business_function]} guide`}
        actions={
          <Stack direction="row" spacing={1}>
            <Button component={Link} to={`/resources?tab=${guide.business_function}`} startIcon={<ArrowBackIcon />}>
              Resources
            </Button>
            <Button variant="outlined" endIcon={<OpenInNewIcon />} href={open} target="_blank" rel="noopener noreferrer">
              Open in Google Docs
            </Button>
          </Stack>
        }
      />
      {/* Fills the rest of the window below the app bar and the page header. */}
      <Paper variant="outlined" sx={{ overflow: 'hidden', height: 'calc(100vh - 220px)', minHeight: 480 }}>
        <iframe
          src={embed}
          title={guide.title}
          style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
        />
      </Paper>
    </>
  )
}
