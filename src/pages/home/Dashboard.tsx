import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, Divider, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDateRange, formatDays } from '../../lib/constants'
import { HOLIDAY_COLUMNS, LEAVE_WITH_TYPE, thisYear, todayIso, type LeaveWithType } from '../../lib/leaves'
import { currentCycle, monthLabel } from '../../lib/performance'
import { ASSIGNMENT_WITH_CYCLE, cycleLabel, quarterOf, type AssignmentWithCycle } from '../../lib/peerReviews'
import { OFFBOARDING_LIST, signOffOf, type OffboardingListRow } from '../../lib/offboarding'
import type { Announcement, Holiday, LeaveBalance, OrgNode, PerformanceReview, ReviewDue } from '../../lib/types'
import { PageHeader } from '../../components/common'
import { BalanceCards, HolidayList, LeaveStatusChip } from '../../components/Leaves'
import { CompanyValues } from '../../components/CompanyValues'
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
// peer reviews to write, and (HR) a quarter with no peer reviews set up.
function PerformanceNotices() {
  const { employee, isManager, isHr } = useAuth()
  const me = employee!.id
  const [toSubmit, setToSubmit] = useState<ReviewDue[]>([])
  const [toRead, setToRead] = useState<Pick<PerformanceReview, 'id' | 'period'>[]>([])
  const [feedback, setFeedback] = useState(0)
  const [peerToWrite, setPeerToWrite] = useState<AssignmentWithCycle[]>([])
  const [noPeerCycle, setNoPeerCycle] = useState(false)

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

  if (!toSubmit.length && !toRead.length && !feedback && !peerToWrite.length && !noPeerCycle) return null
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
  const year = thisYear()
  const [announcements, setAnnouncements] = useState<Pick<Announcement, 'id' | 'body'>[]>([])
  const [balances, setBalances] = useState<LeaveBalance[]>([])
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
      supabase.rpc('leave_balances', { p_employee_id: me, p_year: year }),
      supabase
        .from('leaves')
        .select(LEAVE_WITH_TYPE)
        .eq('employee_id', me)
        .in('status', ['pending', 'approved'])
        .gte('end_date', today)
        .order('start_date'),
      supabase.from('holidays').select(HOLIDAY_COLUMNS).gte('end_date', today).order('start_date'),
    ]).then(([announcementsRes, balancesRes, leavesRes, holidaysRes]) => {
      const failure = announcementsRes.error ?? balancesRes.error ?? leavesRes.error ?? holidaysRes.error
      if (failure) setError(failure.message)
      else {
        setAnnouncements(announcementsRes.data as Pick<Announcement, 'id' | 'body'>[])
        setBalances(balancesRes.data as LeaveBalance[])
        setUpcoming(leavesRes.data as unknown as LeaveWithType[])
        setHolidays((holidaysRes.data as Holiday[]).slice(0, HOLIDAYS_SHOWN))
      }
      setLoading(false)
    })
  }, [me, year])

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

      {!loading && !error && (
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
      )}
      <AnnouncementsDrawer open={allAnnouncements} onClose={() => setAllAnnouncements(false)} />

      {!loading && !error && (
        <Section
          title={`Leave balance ${year}`}
          action={
            <Button component={Link} to="/leaves" size="small">
              My leaves
            </Button>
          }
        >
          {balances.length ? (
            <BalanceCards balances={balances} />
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
              HR hasn't set up any leave types yet.
            </Typography>
          )}

          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 500, mb: 1 }}>
            Upcoming leave
          </Typography>
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
