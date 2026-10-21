import { todayIso } from './leaves'
import type { Offboarding, OffboardingTask } from './types'

// No employee embed: a manager can't read `employees`, so names come from
// employee_directory.
export type OffboardingListRow = Offboarding & { tasks: Pick<OffboardingTask, 'done_at'>[] }
export const OFFBOARDING_LIST = '*, tasks:offboarding_tasks(done_at)'

export type SignOffStep = 'done' | 'waiting' | 'not_needed'

// Where sign-off stands, mirroring offboarding_sign_off: it opens once HR has
// set the reason and last day, every task is ticked and the last day has come;
// the manager (from the org chart now) is needed only if there is one. `mine`
// is what the viewer could sign as, if anything.
export function signOffOf(
  o: Offboarding,
  tasks: Pick<OffboardingTask, 'done_at'>[],
  managerId: string | null,
  viewer: { id: string; isHr: boolean },
) {
  const blocker =
    !o.reason || !o.last_working_day
      ? 'HR has to set the reason and last working day.'
      : tasks.some((t) => !t.done_at)
        ? 'Every task has to be ticked off.'
        : o.last_working_day > todayIso()
          ? 'Sign-off opens on the last working day.'
          : null
  const hr: SignOffStep = o.hr_signed_by ? 'done' : 'waiting'
  const manager: SignOffStep = o.manager_signed_by ? 'done' : managerId ? 'waiting' : 'not_needed'
  const asHr = viewer.isHr && hr === 'waiting'
  const asManager = managerId === viewer.id && manager === 'waiting'
  const open = o.status === 'in_progress' && !blocker
  return { blocker, hr, manager, open, mine: open && (asHr || asManager), asHr, asManager }
}

export function offboardingError(error: { code?: string; message: string }) {
  if (error.code === '42501' && error.message.includes('row-level security')) return "You don't have permission to do that."
  return error.message
}
