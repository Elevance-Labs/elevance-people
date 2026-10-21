import type { SalaryRevision } from './types'

type Figures = Pick<SalaryRevision, 'effective_from' | 'basic_salary' | 'contractual_amount'>

export const totalOf = (r: Pick<SalaryRevision, 'basic_salary' | 'contractual_amount'>) =>
  Number(r.basic_salary) + Number(r.contractual_amount)

// "July 2026" for a month's first day.
export const monthOf = (firstDay: string) =>
  new Date(`${firstDay.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

// A <input type="month"> value (YYYY-MM) and the first day it stands for.
export const firstDayOf = (month: string) => (month ? `${month}-01` : '')
export const monthInput = (firstDay: string) => firstDay.slice(0, 7)

// The first day of this month, local time.
export function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// Approved salaries, newest month first.
export const byMonthDesc = <T extends Figures>(rows: T[]) =>
  [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from))

// Mirrors public.salary_on: the approved salary in force in a month.
export const salaryOn = <T extends Figures>(approved: T[], month = thisMonth()) =>
  byMonthDesc(approved).find((r) => r.effective_from <= month) ?? null

// The latest approved salary (it may not have started yet); a new appraisal
// must start after it.
export const latestOf = <T extends Figures>(approved: T[]) => byMonthDesc(approved)[0] ?? null

// Where an approved salary stands: in force now, still to come, or replaced.
export function phaseOf<T extends Figures>(r: T, approved: T[]): 'active' | 'upcoming' | 'past' {
  if (r.effective_from > thisMonth()) return 'upcoming'
  return salaryOn(approved) === r ? 'active' : 'past'
}

// The change from one total to another, as "+12.5%"; null with nothing before.
export function changeOf(before: Pick<SalaryRevision, 'basic_salary' | 'contractual_amount'> | null, after: Figures) {
  if (!before || !totalOf(before)) return null
  const pct = ((totalOf(after) - totalOf(before)) / totalOf(before)) * 100
  return `${pct >= 0 ? '+' : ''}${Math.round(pct * 10) / 10}%`
}

export function salaryError(error: { code?: string; message: string }) {
  if (error.message.includes('salary_revisions_one_open_key'))
    return 'This employee already has an appraisal open. Finish or delete that one first.'
  if (error.message.includes('salary_revisions_effective_from_check')) return 'Pick the month the salary starts from.'
  if (error.code === '23514') return error.message.includes('reason') ? error.message : 'Amounts must be 0 or more.'
  if (error.code === '42501' && error.message.includes('row-level security')) return "You don't have permission to do that."
  return error.message
}
