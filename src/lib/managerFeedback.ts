import type { ChipProps } from '@mui/material'
import { todayIso } from './leaves'
import type { ManagerFeedback, ManagerFeedbackAnswer } from './types'

export type FeedbackWithAnswers = ManagerFeedback & { answers: ManagerFeedbackAnswer[] }
export const FEEDBACK_WITH_ANSWERS = '*, answers:manager_feedback_answers(*)'

// The question list's limits (mirrors manager_feedback_questions_guard).
export const MIN_QUESTIONS = 3
export const MAX_QUESTIONS = 5

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (year: number, month: number) => new Date(year, month, 0).getDate()

/**
 * A quarter's feedback window, mirroring manager_feedback_start: its last
 * month, opening on the 1st, due on the 10th, closing on the last day.
 */
export function feedbackWindow(year: number, quarter: number) {
  const month = quarter * 3
  return {
    year,
    quarter,
    opens: `${year}-${pad(month)}-01`,
    due: `${year}-${pad(month)}-10`,
    closes: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
  }
}

// The window of the quarter a date falls in.
export function windowOf(date = todayIso()) {
  return feedbackWindow(Number(date.slice(0, 4)), Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1)
}

// The next window still to come or open: this quarter's, or once it has
// closed, next quarter's.
export function upcomingWindow(today = todayIso()) {
  const w = windowOf(today)
  return today <= w.closes ? w : feedbackWindow(w.quarter === 4 ? w.year + 1 : w.year, (w.quarter % 4) + 1)
}

export const isOpen = (w: ReturnType<typeof feedbackWindow>, today = todayIso()) => today >= w.opens && today <= w.closes

// The quarters HR can look back over, newest first.
export function recentQuarters(count = 4, date = todayIso()) {
  let { year, quarter } = windowOf(date)
  const out = []
  for (let i = 0; i < count; i++) {
    out.push({ year, quarter })
    if (--quarter === 0) {
      quarter = 4
      year--
    }
  }
  return out
}

export const quarterName = (q: { year: number; quarter: number }) => `Q${q.quarter} ${q.year}`

export type FeedbackState = 'to_do' | 'overdue' | 'submitted' | 'submitted_late' | 'missed'

export function feedbackState(
  f: { submitted_at: string | null; late: boolean | null } | null,
  w: ReturnType<typeof feedbackWindow>,
  today = todayIso(),
): FeedbackState {
  if (f?.submitted_at) return f.late ? 'submitted_late' : 'submitted'
  if (today > w.closes) return 'missed'
  return today > w.due ? 'overdue' : 'to_do'
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
