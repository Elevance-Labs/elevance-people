import { BRANDING_BUCKET, supabase } from './supabase'
import { COMPANY_DOMAIN, STAGE_LABELS } from './constants'
import type { ApplicationStage, ApplicationStageEvent, DirectoryEntry, JobApplication, JobOpening } from './types'

export type JobOpeningWithNames = JobOpening & {
  department: { name: string } | null
  designation: { title: string } | null
  manager: { full_name: string } | null
  // Computed field: the applications the viewer can see.
  application_count: number
}

// Embeds name each FK: job_openings references employees twice (manager and
// created_by), so keep every join unambiguous. Applications are counted by
// the application_count computed field, never job_applications(count): that
// is a whole-row reference, refused since some columns are hidden.
export const JOB_OPENING_WITH_NAMES =
  'id, title, department_id, designation_id, status, due_date, description, manager_id, created_by, created_at, updated_at, ' +
  'department:departments!job_openings_department_id_fkey(name), ' +
  'designation:designations!job_openings_designation_fkey(title), ' +
  'manager:employees!job_openings_manager_id_fkey(full_name), application_count'

// The public page for a job. HashRouter, so it works under any Pages path.
export function publicJobUrl(jobId: string) {
  return `${window.location.origin}${window.location.pathname}#/careers/${jobId}`
}

export function logoUrl(path: string | null) {
  return path ? supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl : null
}

// False when the browser won't allow it (e.g. not a secure context).
export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

// Who can be a hiring manager or interviewer: anyone who hasn't left.
export const canHire = (p: DirectoryEntry) => p.status !== 'left' && p.status !== 'terminated'

export function jobOpeningError(error: { code?: string; message: string }) {
  if (error.code === '23503') return 'This job has applications, so it can’t be deleted. Close it instead.'
  if (error.code === '42501') return 'Only HR can change job openings.'
  if (error.message.includes('job_openings_designation')) return 'Pick a designation from the selected department.'
  return error.message
}

// For the public form, whose visitors can't do anything with a constraint name.
export function applicationError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'You’ve already applied for this job with this email address.'
  if (error.code === '23514') return 'Please check your details: name, a valid email address, a phone number and your expected salary.'
  return error.message
}

// Hiring (application_hire) creates the employee record, so its errors are
// the employee form's.
export function hireError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'An employee with this company email already exists.'
  if (error.code === '23514' && error.message.includes('company_email'))
    return `Company email must be an @${COMPANY_DOMAIN} address.`
  return error.message
}

// ---------------------------------------------------------------------------
// Application stages. The database decides (application_move /
// application_undo); these mirror it so the app only offers what it allows.
// ---------------------------------------------------------------------------

export const STAGES = Object.keys(STAGE_LABELS) as ApplicationStage[]

// Mirrors public.application_next_stages.
export const NEXT_STAGES: Record<ApplicationStage, ApplicationStage[]> = {
  new: ['screened', 'rejected'],
  screened: ['shortlisted', 'test', 'rejected'],
  shortlisted: ['test', 'interview_1', 'rejected', 'abandoned'],
  test: ['interview_1', 'rejected', 'abandoned'],
  interview_1: ['interview_2', 'cleared', 'shelf', 'rejected', 'abandoned'],
  interview_2: ['interview_3', 'cleared', 'shelf', 'rejected', 'abandoned'],
  interview_3: ['cleared', 'shelf', 'rejected', 'abandoned'],
  cleared: ['shelf', 'offer_sent', 'rejected', 'abandoned'],
  shelf: ['offer_sent', 'rejected', 'abandoned'],
  offer_sent: ['hired', 'shelf', 'declined', 'rejected', 'abandoned'],
  hired: [],
  rejected: [],
  abandoned: [],
  declined: [],
}

// Mirrors public.application_stage_needs_reason: moving here needs text.
export const NEEDS_TEXT: ApplicationStage[] = [
  'interview_1', 'interview_2', 'interview_3', 'cleared', 'shelf', 'rejected', 'declined', 'abandoned',
]
// Of those, where the text is a reason; for the rest it's remarks.
export const NEEDS_REASON: ApplicationStage[] = ['shelf', 'rejected', 'declined', 'abandoned']

// What a job's hiring manager and interviewers see (application_team_stage)
// and may move an application out of (application_team_movable).
export const TEAM_STAGES: ApplicationStage[] = ['shortlisted', 'test', 'interview_1', 'interview_2', 'interview_3', 'cleared']
export const TEAM_MOVABLE: ApplicationStage[] = ['shortlisted', 'test', 'interview_1', 'interview_2', 'interview_3']

export function canMoveFrom(stage: ApplicationStage, isHr: boolean) {
  return NEXT_STAGES[stage].length > 0 && (isHr || TEAM_MOVABLE.includes(stage))
}

// The move an undo would reverse: the latest one not yet undone, if it led to
// the current stage (as application_undo checks).
export function undoableMove(events: ApplicationStageEvent[], stage: ApplicationStage) {
  const last = events.filter((e) => e.kind === 'move' && !e.undone_at).at(-1)
  return last && last.to_stage === stage ? last : null
}

// Every column but the salaries and HR's notes, which clients can't select.
export const APPLICATION_COLUMNS =
  'id, job_opening_id, full_name, email, phone, note, resume_path, resume_name, created_at, stage, stage_changed_at'
// Those, from application_hr_details (HR and the job's hiring manager).
export type ApplicationHrDetails = Pick<JobApplication, 'current_salary' | 'expected_salary' | 'hr_notes'>
export type BoardApplication = Omit<JobApplication, keyof ApplicationHrDetails>
