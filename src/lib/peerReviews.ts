import type { ChipProps } from '@mui/material'
import { isoDate, todayIso } from './leaves'
import type { PeerCycleStatus, PeerReviewAnswer, PeerReviewAssignment, PeerReviewCycle, PeerReviewQuestion } from './types'

export type AssignmentWithAnswers = PeerReviewAssignment & { answers: PeerReviewAnswer[] }
export const ASSIGNMENT_WITH_ANSWERS = '*, answers:peer_review_answers(*)'

// A reviewer's list: their forms with the cycle each belongs to.
export type AssignmentWithCycle = PeerReviewAssignment & {
  cycle: Pick<PeerReviewCycle, 'year' | 'quarter' | 'status' | 'due_date'> | null
}
export const ASSIGNMENT_WITH_CYCLE = '*, cycle:peer_review_cycles(year, quarter, status, due_date)'

// A cycle needs this many questions to open (mirrors peer_cycle_open).
export const MIN_QUESTIONS = 3
export const MAX_QUESTIONS = 5
// A subject sees their responses once there are this many (mirrors my_peer_feedback).
export const MIN_RESPONSES = 2

export const cycleLabel = (c: Pick<PeerReviewCycle, 'year' | 'quarter'>) => `Q${c.quarter} ${c.year}`

// The quarter today falls in, and the one after.
export function quarterOf(date = todayIso()) {
  return { year: Number(date.slice(0, 4)), quarter: Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1 }
}
// A new cycle's suggested due date: two weeks from today.
export function defaultDueDate() {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  return isoDate(d)
}

export function nextQuarter({ year, quarter }: { year: number; quarter: number }) {
  return quarter === 4 ? { year: year + 1, quarter: 1 } : { year, quarter: quarter + 1 }
}

export const PEER_CYCLE_STATUS_LABELS: Record<PeerCycleStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
}

export const PEER_CYCLE_STATUS_COLORS: Record<PeerCycleStatus, ChipProps['color']> = {
  draft: 'default',
  open: 'info',
  closed: 'success',
}

export type PeerState = 'to_do' | 'overdue' | 'submitted' | 'missed'

// Where one form stands: submitted, missed (cycle closed first), or still to do.
export function peerState(
  a: Pick<PeerReviewAssignment, 'submitted_at'>,
  c: Pick<PeerReviewCycle, 'status' | 'due_date'>,
  today = todayIso(),
): PeerState {
  if (a.submitted_at) return 'submitted'
  if (c.status === 'closed') return 'missed'
  return today > c.due_date ? 'overdue' : 'to_do'
}

export const PEER_STATE_LABELS: Record<PeerState, string> = {
  to_do: 'To do',
  overdue: 'Overdue',
  submitted: 'Submitted',
  missed: 'Missed',
}

export const PEER_STATE_COLORS: Record<PeerState, ChipProps['color']> = {
  to_do: 'info',
  overdue: 'error',
  submitted: 'success',
  missed: 'default',
}

// The average rating per question over some answers, in question order.
export function averages(questions: Pick<PeerReviewQuestion, 'id' | 'prompt' | 'sort_order'>[], answers: Pick<PeerReviewAnswer, 'question_id' | 'rating'>[]) {
  return [...questions]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((q) => {
      const ratings = answers.filter((x) => x.question_id === q.id && x.rating != null).map((x) => x.rating!)
      return { ...q, count: ratings.length, average: ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null }
    })
}

export function peerError(error: { code?: string; message: string }) {
  if (error.message.includes('peer_review_assignments_pair_key')) return 'They already review this person in this cycle.'
  if (error.message.includes('peer_review_assignments_not_self')) return 'Nobody reviews themselves.'
  if (error.message.includes('peer_review_questions_prompt_check')) return 'Write the question, up to 500 characters.'
  if (error.message.includes('peer_review_answers_rating_check')) return 'Ratings are from 1 to 5.'
  if (error.code === '42501' && error.message.includes('row-level security'))
    return "You can't change this. HR can't make themselves a subject of peer reviews."
  return error.message
}
