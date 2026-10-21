import { todayIso } from './leaves'
import type { Employee, Onboarding, OnboardingTask } from './types'

export type OnboardingWithEmployee = Onboarding & {
  employee: Pick<Employee, 'full_name' | 'company_email' | 'date_of_joining'> | null
}

// Names the FK: onboardings references employees several times (the person,
// and who created, completed or cancelled it).
const EMPLOYEE = 'employee:employees!onboardings_employee_id_fkey(full_name, company_email, date_of_joining)'
export const ONBOARDING_WITH_EMPLOYEE = `*, ${EMPLOYEE}`

// The list also needs each onboarding's progress.
export type OnboardingListRow = OnboardingWithEmployee & { tasks: Pick<OnboardingTask, 'done_at'>[] }
export const ONBOARDING_LIST = `*, ${EMPLOYEE}, tasks:onboarding_tasks(done_at)`

export const isOverdue = (o: Pick<Onboarding, 'status' | 'due_date'>) =>
  o.status === 'in_progress' && o.due_date < todayIso()

export function progressOf(tasks: Pick<OnboardingTask, 'done_at'>[]) {
  const done = tasks.filter((t) => t.done_at).length
  return { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 }
}

// Tasks grouped by their section, in checklist order. Onboarding's and
// offboarding's tasks have the same shape.
type ChecklistTask = Pick<OnboardingTask, 'section' | 'section_order' | 'sort_order'>
export function bySection<T extends ChecklistTask>(tasks: T[]) {
  const sorted = [...tasks].sort((a, b) => a.section_order - b.section_order || a.sort_order - b.sort_order)
  const sections: { name: string; tasks: T[] }[] = []
  for (const t of sorted) {
    const last = sections.at(-1)
    if (last?.name === t.section) last.tasks.push(t)
    else sections.push({ name: t.section, tasks: [t] })
  }
  return sections
}

// Moves the item at `index` one place up (-1) or down (+1): the new order of ids.
export function moved<T extends { id: string }>(items: T[], index: number, by: -1 | 1) {
  const ids = items.map((i) => i.id)
  ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
  return ids
}

export function onboardingError(error: { code?: string; message: string }) {
  if (error.code === '42501') return 'Only HR can change an onboarding.'
  return error.message
}

export function checklistError(error: { code?: string; message: string }, kind: 'onboarding' | 'offboarding') {
  if (error.code === '23505') return 'A section with this name already exists.'
  if (error.code === '42501') return `Only a company admin can change the ${kind} checklist.`
  return error.message
}
