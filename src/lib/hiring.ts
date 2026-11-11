import { BRANDING_BUCKET, TEST_FILES_BUCKET, supabase } from './supabase'
import { COMPANY_DOMAIN, STAGE_LABELS, TEST_FILE_ACCEPT, TEST_FILE_MAX_BYTES } from './constants'
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
  'interview_questions, ' +
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

// ---------------------------------------------------------------------------
// Test and interview scores. application_move requires them; these mirror it.
// ---------------------------------------------------------------------------

// A new job's interview questions: the column default on job_openings.
export const DEFAULT_INTERVIEW_QUESTIONS = [
  'Technical skills: depth of knowledge and hands-on ability for the role',
  'Problem solving: breaks down unfamiliar problems and reasons to sound solutions',
  'Communication and people skills: explains clearly, listens and works well with others',
  'Culture fit: shares our values and suits how we work',
  'Mindset: ownership, curiosity and a drive to learn and grow',
]
// Mirrors public.valid_interview_questions.
export const MAX_INTERVIEW_QUESTIONS = 10
export const INTERVIEW_QUESTION_MAX_LENGTH = 300

export const INTERVIEW_STAGES: ApplicationStage[] = ['interview_1', 'interview_2', 'interview_3']

// What a move needs scored: a test score on from the test, a rating per
// question on from an interview; nothing when abandoned.
export function scoresNeeded(from: ApplicationStage, to: ApplicationStage | ''): 'test' | 'interview' | null {
  if (!to || to === 'abandoned') return null
  if (from === 'test') return 'test'
  if (INTERVIEW_STAGES.includes(from)) return 'interview'
  return null
}

const percent = (ratings: number[]) => (ratings.reduce((s, r) => s + r, 0) / ratings.length / 5) * 100

// The test score of the latest move on from the test that still stands.
export function testScore(events: ApplicationStageEvent[]) {
  return events.filter((e) => e.test_score != null && !e.undone_at).at(-1)?.test_score ?? null
}

export type QuestionScore = { question: string; percent: number; ratings: number }

// Interview ratings that still stand (undone moves left out), per question
// across the interviews, as a percentage of the top rating; the combined
// score is the mean of those. The test score is not part of it.
export function interviewScores(events: ApplicationStageEvent[]) {
  const byQuestion = new Map<string, number[]>()
  let interviews = 0
  for (const e of events) {
    if (e.undone_at || !e.interview_questions || !e.interview_ratings) continue
    interviews++
    e.interview_questions.forEach((q, i) => {
      byQuestion.set(q, [...(byQuestion.get(q) ?? []), e.interview_ratings![i]])
    })
  }
  const questions: QuestionScore[] = [...byQuestion].map(([question, ratings]) => ({
    question,
    percent: percent(ratings),
    ratings: ratings.length,
  }))
  const combined = questions.length ? questions.reduce((s, q) => s + q.percent, 0) / questions.length : null
  return { interviews, questions, combined }
}

// ---------------------------------------------------------------------------
// Test files: the submitted test, attached by HR or the job's hiring manager
// (can_attach_test_files). application_add_test_file / _remove_test_file and
// application_move decide; these mirror them.
// ---------------------------------------------------------------------------

export const MAX_TEST_FILES = 3

// Moving on from the test, except to rejected or abandoned, needs a file.
export const needsTestFile = (from: ApplicationStage, to: ApplicationStage | '') =>
  from === 'test' && !!to && to !== 'rejected' && to !== 'abandoned'

// Mirrors application_passed_test: once it has moved on from the test, the
// application keeps at least one file.
export const passedTest = (events: ApplicationStageEvent[]) =>
  events.some((e) => e.kind === 'move' && !e.undone_at && needsTestFile(e.from_stage, e.to_stage))

export function testFileProblem(file: File) {
  if (!TEST_FILE_ACCEPT.split(',').includes(file.type)) return 'Test files must be PDFs or JPEG, PNG or WebP images.'
  if (file.size > TEST_FILE_MAX_BYTES) return 'Test files must be 5 MB or smaller.'
  return null
}

// Upload into the application's folder under a fresh name, then attach it;
// the upload is removed if attaching fails.
export async function attachTestFile(applicationId: string, file: File) {
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1].replace('jpeg', 'jpg')
  const path = `${applicationId}/${crypto.randomUUID()}.${ext}`
  const bucket = supabase.storage.from(TEST_FILES_BUCKET)
  const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type })
  if (uploadError) return uploadError
  const { error } = await supabase.rpc('application_add_test_file', {
    p_application_id: applicationId,
    p_path: path,
    p_name: file.name,
  })
  if (error) await bucket.remove([path])
  return error
}

// Detach it, then remove the file (only allowed once no row points at it).
export async function removeTestFile(id: string) {
  const { data: path, error } = await supabase.rpc('application_remove_test_file', { p_file_id: id })
  if (error) return error
  if (path) await supabase.storage.from(TEST_FILES_BUCKET).remove([path as string])
  return null
}

// Every column but the salaries and HR's notes, which clients can't select.
export const APPLICATION_COLUMNS =
  'id, job_opening_id, full_name, email, phone, note, resume_path, resume_name, created_at, stage, stage_changed_at'
// Those, from application_hr_details (HR and the job's hiring manager).
export type ApplicationHrDetails = Pick<JobApplication, 'current_salary' | 'expected_salary' | 'hr_notes'>
export type BoardApplication = Omit<JobApplication, keyof ApplicationHrDetails>
