import type { Holiday, Leave, LeaveBalance, LeaveType } from './types'

export type LeaveWithType = Leave & { leave_type: Pick<LeaveType, 'name'> | null }
export const LEAVE_WITH_TYPE = '*, leave_type:leave_types(name)'

const parseDate = (value: string) => new Date(`${value}T00:00:00`)

export const yearOf = (date: string) => Number(date.slice(0, 4))
export const thisYear = () => new Date().getFullYear()

// A Date as YYYY-MM-DD in local time.
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const todayIso = () => isoDate(new Date())

// The years offered in year pickers: next year back to two years ago.
export const yearOptions = () => [1, 0, -1, -2].map((offset) => thisYear() + offset)

export const HOLIDAY_COLUMNS = 'id, name, start_date, end_date'
type HolidayDates = Pick<Holiday, 'start_date' | 'end_date'>

// Holidays that start in a year, as a query filter's bounds.
export const yearBounds = (year: number) => [`${year}-01-01`, `${year}-12-31`] as const

// The holidays that fall on any day between start and end.
export const holidaysIn = <H extends HolidayDates>(holidays: H[], start: string, end: string) =>
  holidays.filter((h) => h.start_date <= end && h.end_date >= start)

// Mirrors public.leave_days: Monday–Friday between the dates that aren't a
// holiday, halved for a half day.
export function leaveDays(start: string, end: string, halfDay: boolean, holidays: HolidayDates[] = []) {
  if (!start || !end || end < start || yearOf(start) !== yearOf(end)) return 0
  let days = 0
  for (const d = parseDate(start); d <= parseDate(end); d.setDate(d.getDate() + 1)) {
    const day = isoDate(d)
    if (d.getDay() !== 0 && d.getDay() !== 6 && !holidays.some((h) => h.start_date <= day && h.end_date >= day)) days++
  }
  return halfDay ? days / 2 : days
}

// Days still free in a balance; null when the type has no limit.
export const remainingOf = (b: LeaveBalance) =>
  b.quota === null ? null : Math.max(b.quota - b.approved - b.pending, 0)

// The database's own messages are written for people; constraint names are not.
export function leaveError(error: { code?: string; message: string }) {
  if (error.message.includes('leaves_one_year_check'))
    return "A leave can't run into the next year. Split it into two requests."
  if (error.message.includes('leaves_dates_check')) return 'The end date is before the start date.'
  if (error.message.includes('leaves_half_day_check')) return 'A half day must start and end on the same date.'
  if (error.code === '42501' && error.message.includes('row-level security'))
    return "You don't have permission to do that."
  return error.message
}

export function leaveSettingsError(error: { code?: string; message: string }, duplicate: string, inUse: string) {
  if (error.code === '23505') return duplicate
  if (error.code === '23503') return inUse
  if (error.code === '23514') return 'Days must be 0 or more, in steps of half a day.'
  if (error.code === '42501') return 'Only HR can change leave settings.'
  return error.message
}

export function holidayError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'There is already a holiday with this name that year.'
  if (error.message.includes('holidays_one_year_check'))
    return "A holiday can't run into the next year. Add one for each year."
  if (error.message.includes('holidays_dates_check')) return 'The end date is before the start date.'
  if (error.code === '42501') return 'Only HR can change holidays.'
  return error.message
}
