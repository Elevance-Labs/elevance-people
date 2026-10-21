import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDay } from '../../lib/constants'
import {
  REVIEW_WITH_LINES,
  currentCycle,
  monthLabel,
  recentCycles,
  reviewError,
  reviewState,
  type ReviewWithLines,
} from '../../lib/performance'
import type { ReviewDue } from '../../lib/types'
import { PageHeader, PersonAvatar } from '../../components/common'
import { PerformanceReport, ReviewList, ReviewStateChip } from '../../components/Performance'
import { HrFeedback } from '../../components/HrFeedback'
import { MyPeerFeedback, PeerCycles, PeerReviewList } from '../../components/PeerReviews'

// One page for the module; each tab shows to whoever it concerns. The tab
// lives in the URL (?tab=team), the month on the team and people tabs too
// (?month=2026-09-01). The database decides what each person reads.
const TABS = [
  { value: 'me', label: 'Me' },
  { value: 'team', label: 'My team', managersOnly: true },
  { value: 'peer', label: 'Peer reviews', reviewersOnly: true },
  { value: 'people', label: 'People', hrOnly: true },
  { value: 'cycles', label: 'Peer cycles', hrOnly: true },
]

export default function Performance() {
  const { employee, isHr, isManager } = useAuth()
  const me = employee!.id
  const [params, setParams] = useSearchParams()
  // Whether anyone has asked this person for a peer review (RLS: opened cycles only).
  const [isReviewer, setIsReviewer] = useState(false)
  useEffect(() => {
    supabase
      .from('peer_review_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('reviewer_id', me)
      .then(({ count }) => setIsReviewer(!!count))
  }, [me])
  const tabs = TABS.filter(
    (t) => (isHr || !t.hrOnly) && (isManager || !t.managersOnly) && (isReviewer || !t.reviewersOnly),
  )
  const tab = tabs.find((t) => t.value === params.get('tab'))?.value ?? 'me'

  return (
    <>
      <PageHeader title="Performance" subtitle="Monthly 1:1 reviews, KPIs, expectations, goals and feedback" />
      {tabs.length > 1 && (
        <Tabs
          value={tab}
          onChange={(_, value: string) => setParams(value === 'me' ? {} : { tab: value }, { replace: true })}
          sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          {tabs.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </Tabs>
      )}
      {tab === 'me' && <MyPerformance />}
      {tab === 'team' && <DueList scope="team" />}
      {tab === 'people' && <DueList scope="people" />}
      {tab === 'peer' && <PeerReviewList />}
      {tab === 'cycles' && <PeerCycles />}
    </>
  )
}

// The signed-in person's own submitted reviews: the report, then the list.
function MyPerformance() {
  const { employee } = useAuth()
  const me = employee!.id
  const [reviews, setReviews] = useState<ReviewWithLines[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Only submitted ones reach an employee (RLS); HR could read more, so ask for those alone.
    supabase
      .from('performance_reviews')
      .select(REVIEW_WITH_LINES)
      .eq('employee_id', me)
      .eq('status', 'submitted')
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        else setReviews(data as unknown as ReviewWithLines[])
        setLoading(false)
      })
  }, [me])

  if (loading) return <LinearProgress />
  if (error) return <Alert severity="error">{error}</Alert>

  const unread = reviews.filter((r) => !r.acknowledged_at).length
  return (
    <Stack spacing={3}>
      {unread > 0 && (
        <Alert severity="info">
          {unread === 1 ? 'A review is' : `${unread} reviews are`} waiting for you to read and acknowledge.
        </Alert>
      )}
      <PerformanceReport reviews={reviews} />
      <HrFeedback employeeId={me} name={employee!.full_name} mode="employee" />
      <MyPeerFeedback />
      <Box component="section">
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
          Reviews
        </Typography>
        <ReviewList reviews={reviews} empty="No reviews yet." />
      </Box>
    </Stack>
  )
}

// One month's reviews: a manager's direct reports, or (HR) everyone.
function DueList({ scope }: { scope: 'team' | 'people' }) {
  const { employee } = useAuth()
  const me = employee!.id
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const cycles = useMemo(() => recentCycles(), [])
  const month = cycles.includes(params.get('month') ?? '') ? params.get('month')! : currentCycle()
  const [rows, setRows] = useState<ReviewDue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  // My team: the reports the manager has private notes about.
  const [noted, setNoted] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase.rpc('performance_due', { p_period: month })
    if (loadError) setError(loadError.message)
    else {
      // HR gets everyone from the function; My team is only their own reports.
      const all = (data ?? []) as ReviewDue[]
      setRows(scope === 'team' ? all.filter((r) => r.manager_id === me) : all)
      setError(null)
    }
    setLoading(false)
  }, [month, scope, me])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (scope !== 'team') return
    // RLS returns only the caller's own notes.
    supabase
      .from('manager_notes')
      .select('employee_id')
      .neq('body', '')
      .then(({ data }) => setNoted(new Set(((data ?? []) as { employee_id: string }[]).map((n) => n.employee_id))))
  }, [scope])

  async function start(row: ReviewDue) {
    setStarting(row.employee_id)
    const { data, error: startError } = await supabase.rpc('review_start', {
      p_employee_id: row.employee_id,
      p_period: month,
    })
    setStarting(null)
    if (startError) return setError(reviewError(startError))
    navigate(`/performance/reviews/${data as string}`)
  }

  const submitted = rows.filter((r) => r.status === 'submitted').length
  const reviewable = rows.filter((r) => r.manager_id)
  const late = reviewable.filter((r) => ['overdue', 'draft_overdue'].includes(reviewState(r))).length
  const noManager = rows.length - reviewable.length
  const due = rows[0]?.due_date

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Stack direction="row" spacing={2} sx={{ p: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
        <TextField
          select
          label="Month reviewed"
          value={month}
          onChange={(e) => {
            const next = new URLSearchParams(params)
            next.set('month', e.target.value)
            setParams(next, { replace: true })
          }}
          sx={{ minWidth: 200 }}
        >
          {cycles.map((c) => (
            <MenuItem key={c} value={c}>
              {monthLabel(c)}
            </MenuItem>
          ))}
        </TextField>
        {!loading && due && (
          <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
            Due {formatDate(due)} · {submitted} of {reviewable.length} submitted
            {late > 0 && ` · ${late} overdue`}
          </Typography>
        )}
        {scope === 'people' && noManager > 0 && (
          <Chip color="warning" variant="outlined" label={`${noManager} without a manager`} />
        )}
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mx: 2, mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {loading && <LinearProgress />}
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Employee</TableCell>
              {scope === 'people' && <TableCell>Manager</TableCell>}
              <TableCell>Review</TableCell>
              <TableCell>Submitted</TableCell>
              <TableCell>Acknowledged</TableCell>
              {scope === 'team' && <TableCell align="right" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.employee_id}
                hover
                onClick={scope === 'people' ? () => navigate(`/performance/people/${r.employee_id}`) : undefined}
                sx={{ cursor: scope === 'people' ? 'pointer' : undefined, '&:last-child td': { borderBottom: 0 } }}
              >
                <TableCell>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <PersonAvatar name={r.full_name} size={32} />
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {r.full_name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {r.designation ?? 'No designation'}
                        {scope === 'team' && noted.has(r.employee_id) && ' · Has private notes'}
                      </Typography>
                    </Box>
                  </Stack>
                </TableCell>
                {scope === 'people' && (
                  <TableCell>
                    {r.manager_name ?? <Chip size="small" color="warning" variant="outlined" label="No manager" />}
                  </TableCell>
                )}
                <TableCell>{r.manager_id ? <ReviewStateChip state={reviewState(r)} /> : '—'}</TableCell>
                <TableCell>{r.submitted_at ? formatDay(r.submitted_at) : '—'}</TableCell>
                <TableCell>{r.acknowledged_at ? formatDay(r.acknowledged_at) : '—'}</TableCell>
                {scope === 'team' && (
                  <TableCell align="right">
                    {r.review_id ? (
                      <Button size="small" onClick={() => navigate(`/performance/reviews/${r.review_id}`)}>
                        {r.status === 'draft' ? 'Continue' : 'View'}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="contained"
                        loading={starting === r.employee_id}
                        onClick={() => start(r)}
                      >
                        Start review
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!loading && !rows.length && (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                  {scope === 'team'
                    ? `None of your reports is due a review for ${monthLabel(month)}.`
                    : `Nobody is due a review for ${monthLabel(month)}.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}
