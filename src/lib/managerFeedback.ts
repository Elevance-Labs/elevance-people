import type { ChipProps } from '@mui/material'
import { isoDate, todayIso } from './leaves'
import { dueDateOf } from './performance'
import type { ManagerFeedback, ManagerFeedbackAnswer } from './types'

export type FeedbackWithAnswers = ManagerFeedback & { answers: ManagerFeedbackAnswer[] }
export const FEEDBACK_WITH_ANSWERS = '*, answers:manager_feedback_answers(*)'

// The question list's limits (mirrors manager_feedback_questions_guard).
export const MIN_QUESTIONS = 3
export const MAX_QUESTIONS = 5

const parse = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00`)

// The last day a reviewed month's feedback can be submitted: the end of the
// month after it (mirrors manager_feedback_closes).
export function closesOf(period: string) {
  const d = parse(period)
  return isoDate(new Date(d.getFullYear(), d.getMonth() + 2, 0))
}

export type FeedbackState = 'to_do' | 'overdue' | 'submitted' | 'submitted_late' | 'missed'

// Where a form stands: submitted, missed (its window closed first), or to do
// and overdue after the 10th.
export function feedbackState(
  f: { submitted_at: string | null; late: boolean | null } | null,
  period: string,
  today = todayIso(),
): FeedbackState {
  if (f?.submitted_at) return f.late ? 'submitted_late' : 'submitted'
  if (today > closesOf(period)) return 'missed'
  return today > dueDateOf(period) ? 'overdue' : 'to_do'
}

export const FEEDBACK_STATE_LABELS: Record<FeedbackState, string> = {
  to_do: 'To do',
  overdue: 'Overdue',
  submitted: 'Submitted',
  submitted_late: 'Submitted late',
  missed: 'Missed',
}

export const FEEDBACK_STATE_COLORS: Record<FeedbackState, ChipProps['color']> = {
  to_do: 'info',
  overdue: 'error',
  submitted: 'success',
  submitted_late: 'warning',
  missed: 'default',
}

export function managerFeedbackError(error: { code?: string; message: string }) {
  if (error.message.includes('manager_feedback_questions_prompt_check')) return 'Write the question, up to 500 characters.'
  if (error.message.includes('manager_feedback_answers_rating_check')) return 'Ratings are from 1 to 5.'
  if (error.code === '42501' && error.message.includes('row-level security')) return "You can't change this."
  return error.message
}
