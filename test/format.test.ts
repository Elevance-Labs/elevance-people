// Formatting and the company-config helpers: pure functions, no DOM.
//
// `yarn test` pins TZ to America/Los_Angeles on purpose: west of UTC, a
// date-only string parsed as UTC lands on the previous day, so this is the
// zone where getting it wrong shows.
import { reporter } from './setup'
import { formatDate, formatDateRange, formatDays, formatEmployeeNumber } from '../src/lib/constants'
import { leaveDays, leaveError, leaveSettingsError, remainingOf } from '../src/lib/leaves'
import {
  byDepartmentThenTitle,
  configError,
  countOf,
  trimOrNull,
  type DesignationWithDepartment,
} from '../src/lib/company'

const { check, done } = reporter()

// ---- employee numbers ----
check('employee numbers are padded to four digits', formatEmployeeNumber(7) === '#0007', formatEmployeeNumber(7))
check('longer numbers are not cut', formatEmployeeNumber(12345) === '#12345', formatEmployeeNumber(12345))

// ---- dates are calendar days, not instants ----
const local = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

check('a date shows the day it names, in a zone west of UTC',
  formatDate('2024-03-01') === local(2024, 3, 1), `${formatDate('2024-03-01')} vs ${local(2024, 3, 1)}`)
check('a timestamp is read as its date part', formatDate('2024-03-01T23:30:00Z') === local(2024, 3, 1),
  formatDate('2024-03-01T23:30:00Z'))
check('no date shows a dash', formatDate(null) === '—')
check('the zone really is west of UTC', new Date('2024-03-01').getDate() === 29,
  'TZ is not pinned — run through `yarn test`')

// ---- embedded counts ----
check('an embedded count is read', countOf([{ count: 3 }]) === 3)
check('a missing count is zero', countOf(null) === 0 && countOf([]) === 0 && countOf(undefined) === 0)

// ---- designations sort by department, then title ----
const d = (title: string, department: string | null): DesignationWithDepartment => ({
  id: title, department_id: department ?? '', title, description: null,
  department: department ? { name: department } : null,
})
const sorted = [d('Tester', 'QA'), d('Lead', 'Engineering'), d('Developer', 'Engineering'), d('Orphan', null)]
  .sort(byDepartmentThenTitle)
  .map((x) => x.title)
check('designations group by department, then title', sorted.join() === 'Orphan,Developer,Lead,Tester', sorted.join())

// ---- database errors become sentences ----
check('a duplicate (23505) gets the duplicate message',
  configError({ code: '23505', message: 'dup' }, 'Already exists', 'In use') === 'Already exists')
check('a foreign key refusal (23503) gets the in-use message',
  configError({ code: '23503', message: 'fk' }, 'Already exists', 'In use') === 'In use')
check('a permission refusal (42501) says who may do it',
  configError({ code: '42501', message: 'rls' }, 'a', 'b').includes('company admin'))
check('anything else passes through', configError({ message: 'boom' }, 'a', 'b') === 'boom')

// ---- optional text ----
check('blank text is stored as null', trimOrNull('   ') === null)
check('text is trimmed', trimOrNull('  Ops  ') === 'Ops')

// ---- leave days: Monday to Friday, as public.leave_days counts them ----
check('a working week is five days', leaveDays('2026-06-08', '2026-06-12', false) === 5)
check('a weekend counts nothing', leaveDays('2026-06-13', '2026-06-14', false) === 0)
check('Friday to Monday is two days', leaveDays('2026-06-12', '2026-06-15', false) === 2)
check('a half day is half', leaveDays('2026-06-10', '2026-06-10', true) === 0.5)
check('an end before the start counts nothing', leaveDays('2026-06-12', '2026-06-10', false) === 0)
check('a range into the next year counts nothing', leaveDays('2026-12-30', '2027-01-04', false) === 0)
check('missing dates count nothing', leaveDays('', '', false) === 0)
const eid = [{ start_date: '2026-06-10', end_date: '2026-06-11' }]
check('a holiday in the week is not counted', leaveDays('2026-06-08', '2026-06-12', false, eid) === 3)
check('a half day on a holiday counts nothing', leaveDays('2026-06-10', '2026-06-10', true, eid) === 0)
check('a holiday outside the dates changes nothing', leaveDays('2026-06-15', '2026-06-19', false, eid) === 5)
// A DST change falls inside this range in Los Angeles; days must not double or vanish.
check('a range across a clock change counts each day once', leaveDays('2026-03-06', '2026-03-10', false) === 3,
  leaveDays('2026-03-06', '2026-03-10', false))

// ---- what is left of a balance ----
const balance = { leave_type_id: 't', name: 'Annual', quota: 14, approved: 6, pending: 3 }
check('pending and approved both use up the quota', remainingOf(balance) === 5)
check('an overdrawn balance shows none left, not a negative', remainingOf({ ...balance, approved: 20 }) === 0)
check('no quota means no limit', remainingOf({ ...balance, quota: null }) === null)

check('one day, half a day and several are worded right',
  formatDays(1) === '1 day' && formatDays(0.5) === '0.5 day' && formatDays(3) === '3 days')
check('a one-day range shows one date', formatDateRange('2026-06-10', '2026-06-10') === formatDate('2026-06-10'))
check('a range shows both ends', formatDateRange('2026-06-10', '2026-06-12').includes('–'))

// ---- leave errors become sentences ----
const constraint = (name: string) => ({ code: '23514', message: `new row violates check constraint "${name}"` })
check('crossing a year says to split it', leaveError(constraint('leaves_one_year_check')).includes('Split it'))
check('an end before the start says so', leaveError(constraint('leaves_dates_check')).includes('before the start'))
check('a long half day says why', leaveError(constraint('leaves_half_day_check')).includes('same date'))
check('an RLS refusal says permission',
  leaveError({ code: '42501', message: 'new row violates row-level security policy for table "leaves"' })
    === "You don't have permission to do that.")
check('a trigger message written for people passes through',
  leaveError({ code: 'P0001', message: 'This leave overlaps another one.' }) === 'This leave overlaps another one.')

check('a duplicate leave setting gets its message', leaveSettingsError({ code: '23505', message: '' }, 'dup', 'used') === 'dup')
check('a leave type in use gets its message', leaveSettingsError({ code: '23503', message: '' }, 'dup', 'used') === 'used')
check('bad day counts are explained', leaveSettingsError({ code: '23514', message: '' }, 'a', 'b').includes('half a day'))
check('leave settings are HR only', leaveSettingsError({ code: '42501', message: '' }, 'a', 'b').includes('Only HR'))

done()
