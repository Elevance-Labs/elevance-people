import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined'
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined'
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined'
import PriceCheckOutlinedIcon from '@mui/icons-material/PriceCheckOutlined'
import RequestQuoteOutlinedIcon from '@mui/icons-material/RequestQuoteOutlined'
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/constants'
import { currentCycle, monthLabel } from '../lib/performance'
import { ASSIGNMENT_WITH_CYCLE, cycleLabel, quarterOf, type AssignmentWithCycle } from '../lib/peerReviews'
import {
  dueCaption,
  isOverdue,
  leaveTodos,
  offboardingTodos,
  onboardingTodos,
  payrollTodos,
  reimbursementTodos,
  sortTodos,
  type ChecklistPeople,
  type ChecklistTaskRow,
  type Todo,
  type TodoArea,
  type TodoViewer,
} from '../lib/todos'
import type {
  DirectoryEntry,
  Offboarding,
  OneOnOne,
  OnboardingStatus,
  OrgNode,
  Payroll,
  PerformanceReview,
  Reimbursement,
  ReviewDue,
} from '../lib/types'

const ICONS: Record<TodoArea, ReactNode> = {
  performance: <TrendingUpOutlinedIcon fontSize="small" />,
  appraisals: <RequestQuoteOutlinedIcon fontSize="small" />,
  leaves: <EventAvailableOutlinedIcon fontSize="small" />,
  reimbursements: <PriceCheckOutlinedIcon fontSize="small" />,
  onboarding: <HowToRegOutlinedIcon fontSize="small" />,
  offboarding: <PersonRemoveOutlinedIcon fontSize="small" />,
  payroll: <PaymentsOutlinedIcon fontSize="small" />,
}

const TASKS = 'tasks:{table}(section, section_order, sort_order, department_id, done_at)'
const ONBOARDINGS = `id, employee_id, status, due_date, ${TASKS.replace('{table}', 'onboarding_tasks')}`
const OFFBOARDINGS = `*, ${TASKS.replace('{table}', 'offboarding_tasks')}`

type OnboardingRun = {
  id: string
  employee_id: string
  status: OnboardingStatus
  due_date: string
  tasks: ChecklistTaskRow[]
}

// What's waiting on the person in Performance: reviews of their reports still
// to submit (managers), their own reviews and HR feedback still to
// acknowledge, peer reviews to write, feedback on their manager while its
// window is open, and (HR) a quarter with no peer reviews set up.
function usePerformanceTodos(add: (source: string, todos: Todo[]) => void) {
  const { employee, isManager, isHr } = useAuth()
  const me = employee!.id

  useEffect(() => {
    supabase
      .from('performance_reviews')
      .select('id, period')
      .eq('employee_id', me)
      .eq('status', 'submitted')
      .is('acknowledged_at', null)
      .then(({ data }) => {
        const toRead = (data ?? []) as Pick<PerformanceReview, 'id' | 'period'>[]
        add(
          'reviews-to-read',
          toRead.length
            ? [
                {
                  key: 'reviews-to-read',
                  area: 'performance',
                  text:
                    toRead.length === 1
                      ? `Your ${monthLabel(toRead[0].period)} review is ready to read.`
                      : `${toRead.length} reviews are ready to read.`,
                  to: toRead.length === 1 ? `/performance/reviews/${toRead[0].id}` : '/performance',
                  action: 'Read',
                },
              ]
            : [],
        )
      })
    supabase
      .from('hr_feedback')
      .select('id')
      .eq('employee_id', me)
      .is('acknowledged_at', null)
      .then(({ data }) => {
        const n = data?.length ?? 0
        add(
          'hr-feedback',
          n
            ? [
                {
                  key: 'hr-feedback',
                  area: 'performance',
                  text: n === 1 ? 'You have new feedback from HR.' : `You have ${n} new pieces of feedback from HR.`,
                  to: '/performance',
                  action: 'Read',
                },
              ]
            : [],
        )
      })
    supabase
      .from('peer_review_assignments')
      .select(ASSIGNMENT_WITH_CYCLE)
      .eq('reviewer_id', me)
      .is('submitted_at', null)
      .then(({ data }) => {
        const open = ((data ?? []) as unknown as AssignmentWithCycle[])
          .filter((a) => a.cycle?.status === 'open')
          .sort((a, b) => a.cycle!.due_date.localeCompare(b.cycle!.due_date))
        add(
          'peer-reviews',
          open.length
            ? [
                {
                  key: 'peer-reviews',
                  area: 'performance',
                  text: `${open.length === 1 ? '1 peer review' : `${open.length} peer reviews`} to write, due by ${formatDate(open[0].cycle!.due_date)}.`,
                  to: '/performance?tab=peer',
                  action: 'Peer reviews',
                },
              ]
            : [],
        )
      })
    supabase
      .rpc('my_one_on_one')
      .maybeSingle()
      .then(({ data }) => {
        const row = data as OneOnOne | null
        add(
          'manager-feedback',
          row && !row.feedback_submitted_at
            ? [
                {
                  key: 'manager-feedback',
                  area: 'performance',
                  text: `Your ${monthLabel(row.period)} 1:1: give feedback on ${row.manager_name ?? 'your manager'} by ${formatDate(row.due_date)}.`,
                  to: '/performance',
                  action: 'Give feedback',
                },
              ]
            : [],
        )
      })
    if (isHr) {
      const quarter = quarterOf()
      supabase
        .from('peer_review_cycles')
        .select('id')
        .eq('year', quarter.year)
        .eq('quarter', quarter.quarter)
        .then(({ data, error }) =>
          add(
            'peer-cycle',
            !error && !data?.length
              ? [
                  {
                    key: 'peer-cycle',
                    area: 'performance',
                    text: `No peer reviews set up for ${cycleLabel(quarter)} yet.`,
                    to: '/performance?tab=cycles',
                    action: 'Peer cycles',
                  },
                ]
              : [],
          ),
        )
    }
    if (isManager)
      supabase.rpc('performance_due', { p_period: currentCycle() }).then(({ data }) => {
        const due = ((data ?? []) as ReviewDue[]).filter((r) => r.manager_id === me && r.status !== 'submitted')
        add(
          'reviews-to-submit',
          due.length
            ? [
                {
                  key: 'reviews-to-submit',
                  area: 'performance',
                  text: `${due.length === 1 ? '1 monthly review' : `${due.length} monthly reviews`} of ${monthLabel(currentCycle())} to submit by ${formatDate(due[0].due_date)}.`,
                  to: '/performance?tab=team',
                  action: 'My team',
                },
              ]
            : [],
        )
      })
  }, [me, isManager, isHr, add])
}

// The dashboard's To do list: every nudge for the viewer in one place,
// overdue first, each linking to where it's done. Hidden when there's none.
// Each source loads on its own and is left out if it fails; RLS decides what
// each role reads, and the builders in lib/todos.ts what is the viewer's.
export function Todos() {
  const { employee, isHr, isFinance, isCompanyAdmin, isManager, canManagePayroll } = useAuth()
  const me = employee!.id
  const [parts, setParts] = useState<Record<string, Todo[]>>({})
  const [add] = useState(() => (source: string, todos: Todo[]) => setParts((p) => ({ ...p, [source]: todos })))
  const viewer = useMemo<TodoViewer>(
    () => ({ id: me, isHr, isFinance, isCompanyAdmin, canManagePayroll, departmentId: employee!.department_id }),
    [me, isHr, isFinance, isCompanyAdmin, canManagePayroll, employee],
  )

  usePerformanceTodos(add)

  // Company admins: appraisals waiting for their approval (RLS leaves out their own).
  useEffect(() => {
    if (!isCompanyAdmin) return
    supabase
      .from('salary_revisions')
      .select('id')
      .eq('status', 'review')
      .then(({ data }) => {
        const n = data?.length ?? 0
        add(
          'appraisals',
          n
            ? [
                {
                  key: 'appraisals',
                  area: 'appraisals',
                  text: `${n === 1 ? '1 appraisal is' : `${n} appraisals are`} waiting for your approval.`,
                  to: '/appraisals?status=review',
                  action: 'Appraisals',
                },
              ]
            : [],
        )
      })
  }, [isCompanyAdmin, add])

  // HR and managers: leave to approve, and onboarding and offboarding work.
  useEffect(() => {
    if (!isHr && !isManager) return
    let leaves = supabase
      .from('leaves')
      .select('id, status, employee_id, start_date, hr_approved_by, manager_approved_by')
      .eq('status', 'pending')
    // Never one's own, except a company admin, who approves theirs.
    if (!isCompanyAdmin) leaves = leaves.neq('employee_id', me)
    Promise.all([
      leaves,
      supabase.from('onboardings').select(ONBOARDINGS).eq('status', 'in_progress'),
      supabase.from('offboardings').select(OFFBOARDINGS).eq('status', 'in_progress'),
      supabase.from('org_chart_nodes').select('employee_id, manager_id'),
      supabase.from('employee_directory').select('id, full_name'),
      // Managers' departments, to know whose a department's section is; HR only.
      isHr ? supabase.from('employees').select('id, department_id') : Promise.resolve({ data: [], error: null }),
    ]).then(([leavesRes, onboardingsRes, offboardingsRes, nodesRes, directoryRes, employeesRes]) => {
      const nodes = new Map(((nodesRes.data ?? []) as OrgNode[]).map((n) => [n.employee_id, n.manager_id]))
      const names = new Map(((directoryRes.data ?? []) as Pick<DirectoryEntry, 'id' | 'full_name'>[]).map((d) => [d.id, d.full_name]))
      const departments = new Map(
        ((employeesRes.data ?? []) as { id: string; department_id: string | null }[]).map((e) => [e.id, e.department_id]),
      )
      const people: ChecklistPeople = {
        nameOf: (id) => names.get(id) ?? 'A former employee',
        managerOf: (id) => nodes.get(id) ?? null,
        departmentOf: (id) => departments.get(id),
      }
      if (!nodesRes.error) {
        if (!leavesRes.error) add('leaves', leaveTodos(leavesRes.data ?? [], people.managerOf, viewer))
        if (!onboardingsRes.error)
          add('onboarding', onboardingTodos((onboardingsRes.data ?? []) as unknown as OnboardingRun[], people, viewer))
        if (!offboardingsRes.error)
          add(
            'offboarding',
            offboardingTodos(
              (offboardingsRes.data ?? []) as unknown as (Offboarding & { tasks: ChecklistTaskRow[] })[],
              people,
              viewer,
            ),
          )
      }
    })
  }, [me, isHr, isManager, isCompanyAdmin, viewer, add])

  // Payroll roles: claims to move on, and the payroll's next step.
  useEffect(() => {
    if (!canManagePayroll) return
    supabase
      .from('reimbursements')
      .select('id, employee_id, created_by, status')
      .in('status', ['review', 'approved', 'processed'])
      .then(({ data, error }) => {
        if (!error) add('reimbursements', reimbursementTodos((data ?? []) as Reimbursement[], viewer))
      })
    supabase
      .from('payrolls')
      .select('id, year, month, status')
      .then(({ data, error }) => {
        if (!error) add('payroll', payrollTodos((data ?? []) as Payroll[], viewer))
      })
  }, [canManagePayroll, viewer, add])

  const todos = sortTodos(Object.values(parts).flat())
  if (!todos.length) return null
  return (
    <Box component="section" sx={{ mb: 4 }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 1.5, minHeight: 36 }}>
        <Typography variant="h6" component="h2">
          To do
        </Typography>
        <Chip label={todos.length} size="small" color="primary" />
      </Stack>
      <Paper variant="outlined">
        {todos.map((t, i) => {
          const caption = dueCaption(t)
          const late = isOverdue(t)
          return (
            <Box key={t.key} data-todo={t.key}>
              {i > 0 && <Divider />}
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 1, sm: 2 }}
                sx={{ px: 2, py: 1.5, alignItems: { xs: 'stretch', sm: 'center' } }}
              >
                <Stack direction="row" spacing={1.5} sx={{ flexGrow: 1, minWidth: 0, alignItems: 'center' }}>
                  <Box
                    sx={{
                      display: 'flex',
                      flexShrink: 0,
                      p: 0.75,
                      borderRadius: '50%',
                      bgcolor: late ? 'error.main' : 'background.muted',
                      color: late ? 'error.contrastText' : 'text.secondary',
                    }}
                  >
                    {ICONS[t.area]}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {t.text}
                    </Typography>
                    {caption && (
                      <Typography variant="caption" sx={{ color: late ? 'error.main' : 'text.secondary' }}>
                        {caption}
                      </Typography>
                    )}
                  </Box>
                </Stack>
                <Button
                  component={Link}
                  to={t.to}
                  size="small"
                  sx={{ flexShrink: 0, alignSelf: { xs: 'flex-end', sm: 'center' } }}
                >
                  {t.action}
                </Button>
              </Stack>
            </Box>
          )
        })}
      </Paper>
    </Box>
  )
}
