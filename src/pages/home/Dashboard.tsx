import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, Divider, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { formatDateRange, formatDays } from '../../lib/constants'
import { HOLIDAY_COLUMNS, LEAVE_WITH_TYPE, todayIso, type LeaveWithType } from '../../lib/leaves'
import type { CurrentLines, ReviewWithLines } from '../../lib/performance'
import type { Announcement, Holiday, OffRow } from '../../lib/types'
import { PageHeader, PersonAvatar } from '../../components/common'
import { HolidayList, LeaveStatusChip } from '../../components/Leaves'
import { CompanyValues } from '../../components/CompanyValues'
import { Todos } from '../../components/Todos'
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

      <Todos />

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
