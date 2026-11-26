import { formatDate } from './constants'
import { leaveApprovalAs, todayIso } from './leaves'
import { bySection } from './onboarding'
import { signOffOf } from './offboarding'
import { PAYROLL_START_DAY, periodLabel } from './payroll'
import { reimbursementActions } from './reimbursements'
import type { Leave, Offboarding, OnboardingStatus, OnboardingTask, Payroll, Reimbursement } from './types'

// The dashboard's To do list: nudges that take the viewer to where something
// waits on them, never the work itself. Each builder takes rows already read
// and decides, as the database would, whether the next step is the viewer's.

export type TodoArea =
  | 'performance'
  | 'appraisals'
  | 'leaves'
  | 'reimbursements'
  | 'onboarding'
  | 'offboarding'
  | 'payroll'
  | 'equipment'

export interface Todo {
  key: string
  area: TodoArea
  text: string
  // YYYY-MM-DD: when it's due (or starts), for the caption and the order.
  due?: string
  // What the date means: "Due" unless said otherwise.
  dueLabel?: string
  to: string
  action: string
}

export interface TodoViewer {
  id: string
  isHr: boolean
  isFinance: boolean
  isCompanyAdmin: boolean
  canManagePayroll: boolean
  departmentId: string | null
}

export const isOverdue = (t: Todo, today = todayIso()) => !!t.due && t.due < today

// Overdue first, then soonest due, then the undated ones, each in the order given.
export function sortTodos(todos: Todo[], today = todayIso()) {
  const rank = (t: Todo) => (isOverdue(t, today) ? 0 : t.due ? 1 : 2)
  return todos
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || (a.t.due ?? '').localeCompare(b.t.due ?? '') || a.i - b.i)
    .map(({ t }) => t)
}

// "Due Jun 15, 2026", or "Overdue · due Jun 5, 2026".
export function dueCaption(t: Todo, today = todayIso()) {
  if (!t.due) return null
  const label = t.dueLabel ?? 'Due'
  return isOverdue(t, today) ? `Overdue · ${label.toLowerCase()} ${formatDate(t.due)}` : `${label} ${formatDate(t.due)}`
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

// ------------------------------- leaves -------------------------------

type PendingLeave = Pick<Leave, 'id' | 'status' | 'employee_id' | 'start_date' | 'hr_approved_by' | 'manager_approved_by'>

// One row for every pending leave the viewer's approval would move on.
export function leaveTodos(
  leaves: PendingLeave[],
  managerOf: (employeeId: string) => string | null,
  viewer: TodoViewer,
): Todo[] {
  const mine = leaves.filter((l) => {
    const as = leaveApprovalAs(l, managerOf(l.employee_id), viewer)
    return as.hr || as.manager
  })
  if (!mine.length) return []
  const soonest = mine.map((l) => l.start_date).sort()[0]
  return [
    {
      key: 'leaves',
      area: 'leaves',
      text: `${mine.length === 1 ? '1 leave request is' : `${mine.length} leave requests are`} waiting for your approval.`,
      due: soonest,
      dueLabel: mine.length === 1 ? 'Starts' : 'First starts',
      to: '/leaves/requests',
      action: 'Leave requests',
    },
  ]
}

// --------------------------- reimbursements ---------------------------

type OpenClaim = Pick<Reimbursement, 'employee_id' | 'created_by' | 'status'>

const CLAIM_STEPS = [
  { action: 'approve', verb: 'approve', status: 'review' },
  { action: 'process', verb: 'process', status: 'approved' },
  { action: 'disburse', verb: 'disburse', status: 'processed' },
] as const

// Claims waiting on the viewer, one row per step (approve, process, disburse).
export function reimbursementTodos(claims: OpenClaim[], viewer: TodoViewer): Todo[] {
  return CLAIM_STEPS.flatMap(({ action, verb, status }) => {
    const n = claims.filter((c) => reimbursementActions(c, viewer).includes(action)).length
    if (!n) return []
    return [
      {
        key: `reimbursements-${action}`,
        area: 'reimbursements' as const,
        text: `${plural(n, 'reimbursement claim', 'reimbursement claims')} to ${verb}.`,
        to: `/finance/reimbursements?status=${status}`,
        action: 'Reimbursements',
      },
    ]
  })
}

// --------------------- onboarding and offboarding ---------------------

export type ChecklistTaskRow = Pick<
  OnboardingTask,
  'section' | 'section_order' | 'sort_order' | 'department_id' | 'done_at'
>

export interface ChecklistPeople {
  nameOf: (employeeId: string) => string
  managerOf: (employeeId: string) => string | null
  // An employee's department; known to HR only (managers can't read employees).
  departmentOf: (employeeId: string) => string | null | undefined
}

// Who is nudged about a checklist section: a department's section goes to
// the employee's manager when they can tick it (their own department's, as
// can_tick_checklist_task); everyone's sections, and any a manager can't tick,
// go to HR.
function sectionIsMine(
  departmentId: string | null,
  employeeId: string,
  people: ChecklistPeople,
  viewer: TodoViewer,
) {
  const managerId = people.managerOf(employeeId)
  const managerCanTick =
    !!departmentId &&
    !!managerId &&
    (managerId === viewer.id ? viewer.departmentId : people.departmentOf(managerId)) === departmentId
  if (managerCanTick) return managerId === viewer.id
  return viewer.isHr
}

// One row per section with tasks left, for whoever that section is for.
function sectionTodos(
  kind: 'onboarding' | 'offboarding',
  run: { id: string; employee_id: string },
  tasks: ChecklistTaskRow[],
  due: string | undefined,
  people: ChecklistPeople,
  viewer: TodoViewer,
): Todo[] {
  const name = people.nameOf(run.employee_id)
  return bySection(tasks.filter((t) => !t.done_at)).flatMap((s) => {
    if (!sectionIsMine(s.tasks[0].department_id, run.employee_id, people, viewer)) return []
    return [
      {
        key: `${kind}-${run.id}-${s.name}`,
        area: kind,
        text: `${name}’s ${kind}: ${s.name} (${plural(s.tasks.length, 'task', 'tasks')} left).`,
        due,
        dueLabel: kind === 'offboarding' ? 'Last day' : 'Due',
        to: `/hr/${kind}/${run.id}`,
        action: kind === 'onboarding' ? 'Onboarding' : 'Offboarding',
      },
    ]
  })
}

export function onboardingTodos(
  runs: { id: string; employee_id: string; status: OnboardingStatus; due_date: string; tasks: ChecklistTaskRow[] }[],
  people: ChecklistPeople,
  viewer: TodoViewer,
): Todo[] {
  return runs
    .filter((o) => o.status === 'in_progress' && o.employee_id !== viewer.id)
    .flatMap((o) => {
      if (o.tasks.length && o.tasks.every((t) => t.done_at))
        return viewer.isHr
          ? [
              {
                key: `onboarding-${o.id}-complete`,
                area: 'onboarding' as const,
                text: `${people.nameOf(o.employee_id)}’s onboarding is ready to complete.`,
                due: o.due_date,
                to: `/hr/onboarding/${o.id}`,
                action: 'Onboarding',
              },
            ]
          : []
      return sectionTodos('onboarding', o, o.tasks, o.due_date, people, viewer)
    })
}

export function offboardingTodos(
  runs: (Offboarding & { tasks: ChecklistTaskRow[] })[],
  people: ChecklistPeople,
  viewer: TodoViewer,
): Todo[] {
  return runs
    .filter((o) => o.status === 'in_progress' && o.employee_id !== viewer.id)
    .flatMap((o) => {
      const name = people.nameOf(o.employee_id)
      const due = o.last_working_day ?? undefined
      const out: Todo[] = []
      if (viewer.isHr && (!o.reason || !o.last_working_day))
        out.push({
          key: `offboarding-${o.id}-details`,
          area: 'offboarding',
          text: `Set the reason and last working day for ${name}’s offboarding.`,
          due,
          dueLabel: 'Last day',
          to: `/hr/offboarding/${o.id}`,
          action: 'Offboarding',
        })
      out.push(...sectionTodos('offboarding', o, o.tasks, due, people, viewer))
      if (signOffOf(o, o.tasks, people.managerOf(o.employee_id), viewer).mine)
        out.push({
          key: `offboarding-${o.id}-sign-off`,
          area: 'offboarding',
          text: `${name}’s offboarding is waiting for your sign-off.`,
          due,
          dueLabel: 'Last day',
          to: `/hr/offboarding/${o.id}`,
          action: 'Offboarding',
        })
      return out
    })
}

// ------------------------------- payroll -------------------------------

// Each open payroll's next step if it's the viewer's (as payroll_move),
// oldest first, and, from PAYROLL_START_DAY, starting this month's if it has
// none.
export function payrollTodos(
  payrolls: Pick<Payroll, 'id' | 'year' | 'month' | 'status'>[],
  viewer: TodoViewer,
  today = todayIso(),
): Todo[] {
  if (!viewer.canManagePayroll) return []
  const out: Todo[] = payrolls
    .filter((p) => p.status !== 'disbursed')
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .flatMap((open) => {
      const label = periodLabel(open)
      const text =
        open.status === 'draft'
          ? `The ${label} payroll is a draft. Send it for review when it’s ready.`
          : open.status === 'review' && viewer.isCompanyAdmin
            ? `The ${label} payroll is waiting for your approval.`
            : open.status === 'approved' && viewer.isFinance
              ? `The ${label} payroll is approved. Mark it processed.`
              : open.status === 'processed' && viewer.isFinance
                ? `The ${label} payroll is processed. Mark it disbursed once salaries are paid.`
                : null
      return text
        ? [{ key: `payroll-${open.id}`, area: 'payroll' as const, text, to: `/finance/payroll/${open.id}`, action: 'Payroll' }]
        : []
    })
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  if (Number(today.slice(8, 10)) < PAYROLL_START_DAY || payrolls.some((p) => p.year === year && p.month === month))
    return out
  const lastDay = new Date(year, month, 0).getDate()
  return [
    ...out,
    {
      key: 'payroll-start',
      area: 'payroll',
      text: `Start the ${periodLabel({ year, month })} payroll.`,
      due: `${today.slice(0, 8)}${String(lastDay).padStart(2, '0')}`,
      to: '/finance/payroll',
      action: 'Payroll',
    },
  ]
}
