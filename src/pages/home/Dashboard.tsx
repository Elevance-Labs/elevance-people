import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, Divider, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDateRange, formatDays } from '../../lib/constants'
import { HOLIDAY_COLUMNS, LEAVE_WITH_TYPE, todayIso, type LeaveWithType } from '../../lib/leaves'
import { currentCycle, monthLabel, type CurrentLines, type ReviewWithLines } from '../../lib/performance'
import { ASSIGNMENT_WITH_CYCLE, cycleLabel, quarterOf, type AssignmentWithCycle } from '../../lib/peerReviews'
import { OFFBOARDING_LIST, signOffOf, type OffboardingListRow } from '../../lib/offboarding'
import type { Announcement, Holiday, OffRow, OrgNode, PerformanceReview, ReviewDue, OneOnOne } from '../../lib/types'
import { PageHeader, PersonAvatar } from '../../components/common'
import { HolidayList, LeaveStatusChip } from '../../components/Leaves'
import { CompanyValues } from '../../components/CompanyValues'
import { ScoreSummary } from '../../components/Performance'
import { AnnouncementCard, AnnouncementsDrawer, AnnouncementsIcon } from '../../components/Announcements'

// How many upcoming leaves the dashboard lists; the rest are on My leaves.
const UPCOMING_SHOWN = 5
// How many upcoming holidays it lists.
const HOLIDAYS_SHOWN = 4

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Box component="section" sx={{ mb: 4 }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 1.5, minHeight: 36 }}>
        {icon}
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  )
}

// What's waiting on the person in Performance: reviews of their reports still
// to submit (managers), their own reviews and HR feedback still to acknowledge,
// peer reviews to write, feedback on their manager while its window is open,
// and (HR) a quarter with no peer reviews set up.
function PerformanceNotices() {
  const { employee, isManager, isHr } = useAuth()
  const me = employee!.id
  const [toSubmit, setToSubmit] = useState<ReviewDue[]>([])
  const [toRead, setToRead] = useState<Pick<PerformanceReview, 'id' | 'period'>[]>([])
  const [feedback, setFeedback] = useState(0)
  const [peerToWrite, setPeerToWrite] = useState<AssignmentWithCycle[]>([])
  const [noPeerCycle, setNoPeerCycle] = useState(false)
  // Their current 1:1, while their feedback on their manager is still owed.
  const [managerFeedbackDue, setManagerFeedbackDue] = useState<OneOnOne | null>(null)

  useEffect(() => {
    supabase
      .from('performance_reviews')
      .select('id, period')
      .eq('employee_id', me)
      .eq('status', 'submitted')
      .is('acknowledged_at', null)
      .then(({ data }) => setToRead((data ?? []) as Pick<PerformanceReview, 'id' | 'period'>[]))
    supabase
      .from('hr_feedback')
      .select('id')
      .eq('employee_id', me)
      .is('acknowledged_at', null)
      .then(({ data }) => setFeedback(data?.length ?? 0))
    supabase
      .from('peer_review_assignments')
      .select(ASSIGNMENT_WITH_CYCLE)
      .eq('reviewer_id', me)
      .is('submitted_at', null)
      .then(({ data }) =>
        setPeerToWrite(
          ((data ?? []) as unknown as AssignmentWithCycle[])
            .filter((a) => a.cycle?.status === 'open')
            .sort((a, b) => a.cycle!.due_date.localeCompare(b.cycle!.due_date)),
        ),
      )
    supabase
      .rpc('my_one_on_one')
      .maybeSingle()
      .then(({ data }) => {
        const row = data as OneOnOne | null
        setManagerFeedbackDue(row && !row.feedback_submitted_at ? row : null)
      })
    if (isHr) {
      const { year, quarter } = quarterOf()
      supabase
        .from('peer_review_cycles')
        .select('id')
        .eq('year', year)
        .eq('quarter', quarter)
        .then(({ data, error }) => setNoPeerCycle(!error && !data?.length))
    }
    if (isManager)
      supabase.rpc('performance_due', { p_period: currentCycle() }).then(({ data }) =>
        setToSubmit(((data ?? []) as ReviewDue[]).filter((r) => r.manager_id === me && r.status !== 'submitted')),
      )
  }, [me, isManager, isHr])

  if (!toSubmit.length && !toRead.length && !feedback && !peerToWrite.length && !noPeerCycle && !managerFeedbackDue)
    return null
  return (
    <Stack spacing={1.5} sx={{ mb: 4 }}>
      {toSubmit.length > 0 && (
        <Alert
          severity="warning"
          action={
            <Button component={Link} to="/performance?tab=team" color="inherit" size="small">
              My team
            </Button>
          }
        >
          {toSubmit.length === 1 ? '1 monthly review' : `${toSubmit.length} monthly reviews`} of{' '}
          {monthLabel(currentCycle())} to submit by {formatDate(toSubmit[0].due_date)}.
        </Alert>
      )}
      {toRead.length > 0 && (
        <Alert
          severity="info"
          action={
            <Button
              component={Link}
              to={toRead.length === 1 ? `/performance/reviews/${toRead[0].id}` : '/performance'}
              color="inherit"
              size="small"
            >
              Read
            </Button>
          }
        >
          {toRead.length === 1
            ? `Your ${monthLabel(toRead[0].period)} review is ready to read.`
            : `${toRead.length} reviews are ready to read.`}
        </Alert>
      )}
      {feedback > 0 && (
        <Alert
          severity="info"
          action={
            <Button component={Link} to="/performance" color="inherit" size="small">
              Read
            </Button>
          }
        >
          {feedback === 1 ? 'You have new feedback from HR.' : `You have ${feedback} new pieces of feedback from HR.`}
        </Alert>
      )}
      {peerToWrite.length > 0 && (
        <Alert
          severity="warning"
          action={
            <Button component={Link} to="/performance?tab=peer" color="inherit" size="small">
              Peer reviews
            </Button>
          }
        >
          {peerToWrite.length === 1 ? '1 peer review' : `${peerToWrite.length} peer reviews`} to write, due by{' '}
          {formatDate(peerToWrite[0].cycle!.due_date)}.
        </Alert>
      )}
      {managerFeedbackDue && (
        <Alert
          severity="warning"
          action={
            <Button component={Link} to="/performance" color="inherit" size="small">
              Give feedback
            </Button>
          }
        >
          Your {monthLabel(managerFeedbackDue.period)} 1:1: give feedback on {managerFeedbackDue.manager_name ?? 'your manager'}{' '}
          by {formatDate(managerFeedbackDue.due_date)}.
        </Alert>
      )}
      {noPeerCycle && (
        <Alert
          severity="warning"
          action={
            <Button component={Link} to="/performance?tab=cycles" color="inherit" size="small">
              Peer cycles
            </Button>
          }
        >
          No peer reviews set up for {cycleLabel(quarterOf())} yet.
        </Alert>
      )}
    </Stack>
  )
}

// Day and month, for the who's off tiles: "Jun 15".
const dayMonth = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

// One person off, as an avatar with their first name and when.
function OffTile({ row, when }: { row: OffRow; when: string }) {
  const range = formatDateRange(row.start_date, row.end_date)
  return (
    <Tooltip title={`${row.full_name} · ${range}${row.half_day ? ' · Half day' : ''}`}>
      <Stack spacing={0.5} sx={{ width: 84, alignItems: 'center', textAlign: 'center' }}>
        <PersonAvatar name={row.full_name} size={44} />
        <Typography variant="body2" noWrap sx={{ fontWeight: 500, maxWidth: '100%' }}>
          {row.full_name.trim().split(/\s+/)[0]}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
          {when}
        </Typography>
      </Stack>
    </Tooltip>
  )
}

// Who's off today and in the next 30 days. Everyone's leaves are private
// (RLS), so this reads who_is_off: approved leave, names and dates only.
function WhoIsOff() {
  const [rows, setRows] = useState<OffRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    supabase.rpc('who_is_off').then(({ data, error }) => {
      if (error) setFailed(true)
      else setRows((data ?? []) as OffRow[])
    })
  }, [])

  const today = todayIso()
  const offToday = (rows ?? []).filter((r) => r.start_date <= today)
  const later = (rows ?? []).filter((r) => r.start_date > today)
  const todayWhen = (r: OffRow) =>
    r.half_day ? 'Half day' : r.end_date === today ? 'Today' : `Until ${dayMonth(r.end_date)}`
  const laterWhen = (r: OffRow) =>
    r.start_date === r.end_date
      ? `${dayMonth(r.start_date)}${r.half_day ? ' · Half' : ''}`
      : `${dayMonth(r.start_date)} – ${dayMonth(r.end_date)}`
  const tiles = (list: OffRow[], when: (r: OffRow) => string, empty: string) =>
    list.length ? (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        {list.map((r) => (
          <OffTile key={`${r.employee_id}-${r.start_date}`} row={r} when={when(r)} />
        ))}
      </Box>
    ) : (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {empty}
      </Typography>
    )

  return (
    <Section title="Who's off">
      {failed ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Couldn't load who's off.
        </Typography>
      ) : (
        rows && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
              Today
            </Typography>
            {tiles(offToday, todayWhen, "Everyone's in today.")}
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
              Next 30 days
            </Typography>
            {tiles(later, laterWhen, 'No leave coming up.')}
          </Paper>
        )
      )}
    </Section>
  )
}

// The person's scores across every submitted review of them (RLS: their own
// reviews only once submitted), alongside their designation's current KPIs
// and expectations, which show even before they are scored.
const MY_SCORES =
  'period, status, kpis:performance_review_kpis(kpi_id, name, weight, rating, sort_order), ' +
  'expectations:performance_review_expectations(expectation_id, title, met, sort_order)'

function MyPerformance() {
  const { employee } = useAuth()
  const me = employee!.id
  const designation = employee!.designation_id
  const [reviews, setReviews] = useState<ReviewWithLines[] | null>(null)
  const [current, setCurrent] = useState<CurrentLines>({ kpis: [], expectations: [] })

  useEffect(() => {
    supabase
      .from('performance_reviews')
      .select(MY_SCORES)
      .eq('employee_id', me)
      .eq('status', 'submitted')
      .then(({ data, error }) => setReviews(error ? null : ((data ?? []) as unknown as ReviewWithLines[])))
  }, [me])

  useEffect(() => {
    if (!designation) return
    Promise.all([
      supabase.from('kpis').select('id, name').eq('designation_id', designation),
      supabase.from('expectations').select('id, title').eq('designation_id', designation),
    ]).then(([k, x]) => setCurrent({ kpis: k.error ? [] : (k.data ?? []), expectations: x.error ? [] : (x.data ?? []) }))
  }, [designation])

  if (!reviews) return null
  return (
    <Section
      title="My performance"
      action={
        <Button component={Link} to="/performance" size="small">
          Performance
        </Button>
      }
    >
      <ScoreSummary reviews={reviews} current={current} />
    </Section>
  )
}

// Company admins: appraisals waiting for their approval (RLS leaves out
// their own).
function AppraisalNotice() {
  const { isCompanyAdmin } = useAuth()
  const [waiting, setWaiting] = useState(0)

  useEffect(() => {
    if (!isCompanyAdmin) return
    supabase
      .from('salary_revisions')
      .select('id')
      .eq('status', 'review')
      .then(({ data }) => setWaiting(data?.length ?? 0))
  }, [isCompanyAdmin])

  if (!waiting) return null
  return (
    <Alert
      severity="warning"
      sx={{ mb: 4 }}
      action={
        <Button component={Link} to="/appraisals?status=review" color="inherit" size="small">
          Appraisals
        </Button>
      }
    >
      {waiting === 1 ? '1 appraisal is' : `${waiting} appraisals are`} waiting for your approval.
    </Alert>
  )
}

// HR and managers: offboardings waiting for their sign-off, and (managers)
// offboardings of their reports still under way.
function OffboardingNotices() {
  const { employee, isManager, isHr } = useAuth()
  const me = employee!.id
  const [rows, setRows] = useState<OffboardingListRow[]>([])
  const [nodes, setNodes] = useState<OrgNode[]>([])

  useEffect(() => {
    if (!isHr && !isManager) return
    Promise.all([
      supabase.from('offboardings').select(OFFBOARDING_LIST).eq('status', 'in_progress'),
      supabase.from('org_chart_nodes').select('employee_id, manager_id'),
    ]).then(([offboardingsRes, nodesRes]) => {
      setRows((offboardingsRes.data ?? []) as unknown as OffboardingListRow[])
      setNodes((nodesRes.data ?? []) as OrgNode[])
    })
  }, [isHr, isManager])

  const managerOf = (id: string) => nodes.find((n) => n.employee_id === id)?.manager_id ?? null
  const toSign = rows.filter((r) => signOffOf(r, r.tasks, managerOf(r.employee_id), { id: me, isHr }).mine)
  const team = isHr ? [] : rows.filter((r) => managerOf(r.employee_id) === me && !toSign.includes(r))
  if (!toSign.length && !team.length) return null
  return (
    <Stack spacing={1.5} sx={{ mb: 4 }}>
      {toSign.length > 0 && (
        <Alert
          severity="warning"
          action={
            <Button
              component={Link}
              to={toSign.length === 1 ? `/hr/offboarding/${toSign[0].id}` : '/hr/offboarding'}
              color="inherit"
              size="small"
            >
              Offboarding
            </Button>
          }
        >
          {toSign.length === 1 ? '1 offboarding is' : `${toSign.length} offboardings are`} waiting for your sign-off.
        </Alert>
      )}
      {team.length > 0 && (
        <Alert
          severity="info"
          action={
            <Button component={Link} to="/hr/offboarding" color="inherit" size="small">
              Offboarding
            </Button>
          }
        >
          {team.length === 1 ? 'Someone on your team is' : `${team.length} people on your team are`} leaving. Tick off
          the handover tasks as they're done.
        </Alert>
      )}
    </Stack>
  )
}

export default function Dashboard() {
  const { employee } = useAuth()
  const me = employee!.id
  const [announcements, setAnnouncements] = useState<Pick<Announcement, 'id' | 'body'>[]>([])
  const [upcoming, setUpcoming] = useState<LeaveWithType[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [allAnnouncements, setAllAnnouncements] = useState(false)
  const [todayLabel] = useState(() =>
    new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  )

  useEffect(() => {
    const today = todayIso()
    Promise.all([
      // The pinned ones, body only; the rest are in the drawer.
      supabase
        .from('announcements')
        .select('id, body')
        .gte('pinned_until', today)
        .order('created_at', { ascending: false }),
      supabase
        .from('leaves')
        .select(LEAVE_WITH_TYPE)
        .eq('employee_id', me)
        .in('status', ['pending', 'approved'])
        .gte('end_date', today)
        .order('start_date'),
      supabase.from('holidays').select(HOLIDAY_COLUMNS).gte('end_date', today).order('start_date'),
    ]).then(([announcementsRes, leavesRes, holidaysRes]) => {
      const failure = announcementsRes.error ?? leavesRes.error ?? holidaysRes.error
      if (failure) setError(failure.message)
      else {
        setAnnouncements(announcementsRes.data as Pick<Announcement, 'id' | 'body'>[])
        setUpcoming(leavesRes.data as unknown as LeaveWithType[])
        setHolidays((holidaysRes.data as Holiday[]).slice(0, HOLIDAYS_SHOWN))
      }
      setLoading(false)
    })
  }, [me])

  const firstName = employee!.full_name.trim().split(/\s+/)[0]

  return (
    <>
      <PageHeader title={`Welcome, ${firstName}`} subtitle={todayLabel} />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {loading && <LinearProgress sx={{ mb: 3 }} />}

      <PerformanceNotices />
      <OffboardingNotices />
      <AppraisalNotice />

      {/* Announcements and who's off side by side; stacked on a phone. */}
      {!loading && !error && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
            columnGap: 3,
          }}
        >
          <Section
            title="Announcements"
            icon={<AnnouncementsIcon size={32} />}
            action={
              <Button size="small" onClick={() => setAllAnnouncements(true)}>
                View all
              </Button>
            }
          >
            {announcements.length ? (
              <Stack spacing={2}>
                {announcements.map((a) => (
                  <AnnouncementCard key={a.id} html={a.body} />
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Nothing pinned right now.
              </Typography>
            )}
          </Section>
          <WhoIsOff />
        </Box>
      )}
      <AnnouncementsDrawer open={allAnnouncements} onClose={() => setAllAnnouncements(false)} />

      {!loading && !error && <MyPerformance />}

      {!loading && !error && (
        <Section
          title="Upcoming leave"
          action={
            <Button component={Link} to="/leaves" size="small">
              My leaves
            </Button>
          }
        >
          <Paper variant="outlined">
            {upcoming.slice(0, UPCOMING_SHOWN).map((l, i) => (
              <Box key={l.id}>
                {i > 0 && <Divider />}
                <Stack direction="row" spacing={2} sx={{ px: 2, py: 1.5, alignItems: 'center' }}>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {l.leave_type?.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {formatDateRange(l.start_date, l.end_date)} · {l.half_day ? 'Half day' : formatDays(l.days)}
                    </Typography>
                  </Box>
                  <LeaveStatusChip status={l.status} />
                </Stack>
              </Box>
            ))}
            {!upcoming.length && (
              <Typography variant="body2" sx={{ px: 2, py: 3, color: 'text.secondary', textAlign: 'center' }}>
                No upcoming leave.
              </Typography>
            )}
            {upcoming.length > UPCOMING_SHOWN && (
              <>
                <Divider />
                <Button component={Link} to="/leaves" size="small" sx={{ m: 1 }}>
                  {upcoming.length - UPCOMING_SHOWN} more
                </Button>
              </>
            )}
          </Paper>
        </Section>
      )}

      {holidays.length > 0 && (
        <Section title="Upcoming holidays">
          <HolidayList holidays={holidays} empty="" />
        </Section>
      )}

      {/* Last, so it's there to explore rather than in the way. */}
      {!loading && (
        <Section
          title="Our values"
          action={
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Tap a value to read more
            </Typography>
          }
        >
          <CompanyValues />
        </Section>
      )}
    </>
  )
}
