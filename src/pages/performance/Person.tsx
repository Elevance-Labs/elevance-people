import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Box, LinearProgress, Stack, Typography } from '@mui/material'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { REVIEW_WITH_LINES, type ReviewWithLines } from '../../lib/performance'
import type { DirectoryEntry } from '../../lib/types'
import { PageHeader } from '../../components/common'
import { PerformanceReport, ReviewList } from '../../components/Performance'
import { PrivateNotes } from '../../components/PrivateNotes'
import { HrFeedback } from '../../components/HrFeedback'

// One person's performance, for HR and their manager: the report from their
// submitted reviews, and every review (drafts too) to open. RLS decides which
// reviews come back. Their current manager also keeps private notes here, and
// HR writes them feedback (which their manager doesn't see).
export default function Person() {
  const { id } = useParams()
  const { employee, isHr } = useAuth()
  const [isTheirManager, setIsTheirManager] = useState(false)
  const [person, setPerson] = useState<Pick<DirectoryEntry, 'full_name' | 'designation' | 'department'> | null>(null)
  const [reviews, setReviews] = useState<ReviewWithLines[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('employee_directory').select('full_name, designation, department').eq('id', id!).maybeSingle(),
      supabase.from('performance_reviews').select(REVIEW_WITH_LINES).eq('employee_id', id!),
      supabase.from('org_chart_nodes').select('manager_id').eq('employee_id', id!).maybeSingle(),
    ]).then(([personRes, reviewsRes, nodeRes]) => {
      const failure = personRes.error ?? reviewsRes.error ?? nodeRes.error
      if (failure) setError(failure.message)
      else if (!personRes.data) setError('Employee not found.')
      else {
        setPerson(personRes.data as Pick<DirectoryEntry, 'full_name' | 'designation' | 'department'>)
        setReviews(reviewsRes.data as unknown as ReviewWithLines[])
        setIsTheirManager((nodeRes.data as { manager_id: string | null } | null)?.manager_id === employee!.id)
      }
      setLoading(false)
    })
  }, [id, employee])

  if (loading) return <LinearProgress />
  if (error || !person) return <Alert severity="error">{error}</Alert>

  return (
    <>
      <PageHeader
        title={person.full_name}
        subtitle={[person.designation, person.department].filter(Boolean).join(' · ') || undefined}
        back={isHr ? '/performance?tab=people' : '/performance?tab=team'}
      />
      <Stack spacing={3}>
        {isTheirManager && <PrivateNotes employeeId={id!} name={person.full_name} />}
        <PerformanceReport reviews={reviews} />
        {isHr && id !== employee!.id && <HrFeedback employeeId={id!} name={person.full_name} mode="hr" />}
        <Box component="section">
          <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
            Reviews
          </Typography>
          <ReviewList reviews={reviews} empty="No reviews yet." />
        </Box>
      </Stack>
    </>
  )
}
