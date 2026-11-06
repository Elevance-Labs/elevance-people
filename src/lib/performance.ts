import type { ChipProps } from '@mui/material'
import { isoDate, todayIso } from './leaves'
import type { FeedbackKind, PerformanceReview, ReviewDue, ReviewExpectation, ReviewKpi } from './types'

export type ReviewWithLines = PerformanceReview & { kpis: ReviewKpi[]; expectations: ReviewExpectation[] }
export const REVIEW_WITH_LINES =
  '*, kpis:performance_review_kpis(*), expectations:performance_review_expectations(*)'

// Lines come back in no particular order; show them as the review lists them.
export function sortLines(review: ReviewWithLines): ReviewWithLines {
  const bySort = <T extends { sort_order: number }>(rows: T[]) => [...rows].sort((a, b) => a.sort_order - b.sort_order)
  return { ...review, kpis: bySort(review.kpis), expectations: bySort(review.expectations) }
}

// ---------------------------------------------------------------------------
// Months and quarters. A period is the reviewed month's first day, YYYY-MM-01,
// parsed as local time like every other date.
// ---------------------------------------------------------------------------

const parse = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00`)

export function addMonths(period: string, n: number) {
  const d = parse(period)
  return isoDate(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

export const monthOf = (date: string) => `${date.slice(0, 7)}-01`

// The month a 1:1 held today reviews: last month.
export const currentCycle = () => addMonths(monthOf(todayIso()), -1)

// The reviewed months offered in pickers, newest first.
export const recentCycles = (count = 6) => Array.from({ length: count }, (_, i) => addMonths(currentCycle(), -i))

// Mirrors the generated due_date: the 10th of the month after.
export const dueDateOf = (period: string) => `${addMonths(period, 1).slice(0, 8)}10`

// How long until a due date, or how long past it, in days.
export function dueCountdown(due: string, today = todayIso()) {
  const days = Math.round((new Date(`${due}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000)
  const label =
    days > 1 ? `${days} days left` : days === 1 ? '1 day left' : days === 0 ? 'due today'
      : days === -1 ? '1 day overdue' : `${-days} days overdue`
  return { days, overdue: days < 0, label }
}

// A due date in full, e.g. "Tue, 10 Nov 2026".
export const longDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export const monthLabel = (period: string) =>
  parse(period).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

export const shortMonthLabel = (period: string) =>
  parse(period).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })

export function quarterStart(date: string) {
  const d = parse(date)
  return isoDate(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1))
}

export const quarterLabel = (date: string) => {
  const d = parse(date)
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
}

// Mirrors public.review_goal_quarter: a review sets the goal of the quarter
// it is held in, the month after the one reviewed.
export const goalQuarterOf = (period: string) => quarterStart(addMonths(period, 1))

type GoalSource = Pick<PerformanceReview, 'id' | 'period' | 'status' | 'goal_set'>

/**
 * What a draft does with the quarterly goal, as review_submit will decide it:
 * rate progress on the goal of the reviewed month's quarter (if one was set),
 * and set the goal of the quarter it is held in (if none is set yet).
 * `others` are the employee's other reviews.
 */
export function goalPlan(review: Pick<PerformanceReview, 'id' | 'period'>, others: GoalSource[]) {
  const setters = others.filter((r) => r.id !== review.id && r.status === 'submitted' && r.goal_set)
  const rated = setters.find((r) => goalQuarterOf(r.period) === quarterStart(review.period))
  const setsQuarter = goalQuarterOf(review.period)
  const sets = !setters.some((r) => goalQuarterOf(r.period) === setsQuarter)
  return {
    rated: rated ? { goal: rated.goal_set!, quarter: quarterLabel(review.period) } : null,
    sets: sets ? quarterLabel(setsQuarter) : null,
  }
}

// The goal the employee is working to now: the newest one set.
export function currentGoal(reviews: GoalSource[]) {
  const latest = reviews
    .filter((r) => r.status === 'submitted' && r.goal_set)
    .sort((a, b) => b.period.localeCompare(a.period))[0]
  return latest ? { goal: latest.goal_set!, quarter: quarterLabel(goalQuarterOf(latest.period)) } : null
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/**
 * The KPI ratings as one score out of 5: weighted by the KPIs' weights when
 * every rated KPI has one, otherwise each counts the same. Null until rated.
 */
export function overallScore(kpis: Pick<ReviewKpi, 'rating' | 'weight'>[]) {
  const rated = kpis.filter((k) => k.rating != null)
  if (!rated.length) return null
  const weighted = rated.every((k) => k.weight != null && Number(k.weight) > 0)
  const weightOf = (k: Pick<ReviewKpi, 'weight'>) => (weighted ? Number(k.weight) : 1)
  const total = rated.reduce((sum, k) => sum + weightOf(k), 0)
  return rated.reduce((sum, k) => sum + k.rating! * weightOf(k), 0) / total
}

export function expectationsMet(expectations: Pick<ReviewExpectation, 'met'>[]) {
  const met = expectations.filter((x) => x.met === true).length
  const total = expectations.length
  return { met, total, percent: total ? Math.round((met / total) * 100) : null }
}

export const formatScore = (score: number | null) => (score == null ? '—' : score.toFixed(1))

// A KPI or expectation across reviews: what it was copied from, or its name
// if that is gone.
export const lineKey = (id: string | null, name: string) => id ?? `name:${name}`

// A KPI's or expectation's average across reviews; null (count 0) when it has
// not been scored yet.
export type LineAverage = { key: string; name: string; average: number | null; count: number }

// The KPIs and expectations the person's designation has now.
export type CurrentLines = { kpis: { id: string; name: string }[]; expectations: { id: string; title: string }[] }

/**
 * Submitted reviews summed up: each KPI's average rating out of 5 and each
 * expectation's share met (0–1); the KPI score (the average of each review's
 * overall score), the performance score (that as a percentage of 5) and the
 * expectation score (percent of all expectations met). The designation's
 * current KPIs and expectations come first, in the review form's order,
 * scored or not; then any others scored before, in the newest review's order.
 */
export function scoreSummary(
  reviews: Pick<ReviewWithLines, 'period' | 'status' | 'kpis' | 'expectations'>[],
  current: CurrentLines = { kpis: [], expectations: [] },
) {
  const submitted = reviews
    .filter((r) => r.status === 'submitted')
    .sort((a, b) => b.period.localeCompare(a.period))
  type Sum = { name: string; sum: number; count: number }
  const byName = <T,>(rows: T[], name: (r: T) => string) =>
    [...rows].sort((a, b) => name(a).toLowerCase().localeCompare(name(b).toLowerCase()))
  const kpis = new Map<string, Sum>(byName(current.kpis, (k) => k.name).map((k) => [k.id, { name: k.name, sum: 0, count: 0 }]))
  const expectations = new Map<string, Sum>(
    byName(current.expectations, (x) => x.title).map((x) => [x.id, { name: x.title, sum: 0, count: 0 }]),
  )
  const add = (map: Map<string, Sum>, key: string, name: string, value: number) => {
    const row = map.get(key) ?? { name, sum: 0, count: 0 }
    map.set(key, { name: row.name, sum: row.sum + value, count: row.count + 1 })
  }
  for (const r of submitted) {
    for (const k of [...r.kpis].sort((a, b) => a.sort_order - b.sort_order))
      if (k.rating != null) add(kpis, lineKey(k.kpi_id, k.name), k.name, k.rating)
    for (const x of [...r.expectations].sort((a, b) => a.sort_order - b.sort_order))
      if (x.met != null) add(expectations, lineKey(x.expectation_id, x.title), x.title, x.met ? 1 : 0)
  }
  const averages = (map: Map<string, Sum>): LineAverage[] =>
    [...map].map(([key, { name, sum, count }]) => ({ key, name, average: count ? sum / count : null, count }))

  const overall = submitted.map((r) => overallScore(r.kpis)).filter((s): s is number => s != null)
  const kpiScore = overall.length ? overall.reduce((a, b) => a + b, 0) / overall.length : null
  const marked = [...expectations.values()]
  const expectationsMarked = marked.reduce((n, x) => n + x.count, 0)
  return {
    reviews: submitted.length,
    kpis: averages(kpis),
    expectations: averages(expectations),
    kpiScore,
    performance: kpiScore == null ? null : Math.round((kpiScore / 5) * 100),
    expectationScore: expectationsMarked
      ? Math.round((marked.reduce((n, x) => n + x.sum, 0) / expectationsMarked) * 100)
      : null,
  }
}

/**
 * Mirrors review_submit's checks, in its order: what still stops a draft from
 * being submitted. Empty when it can go.
 */
export function submitProblems(review: ReviewWithLines, plan: ReturnType<typeof goalPlan>) {
  const blank = (s: string | null) => !s?.trim()
  const problems: string[] = []
  if (review.kpis.some((k) => k.rating == null)) problems.push('Rate every KPI.')
  else if (review.kpis.some((k) => k.rating! <= 2 && blank(k.note))) problems.push('Add a note to every KPI rated 1 or 2.')
  if (review.expectations.some((x) => x.met == null)) problems.push('Mark every expectation met or not met.')
  else if (review.expectations.some((x) => x.met === false && blank(x.note)))
    problems.push('Add a note to every expectation not met.')
  if (blank(review.evaluation)) problems.push('Write the evaluation.')
  if (blank(review.feedback)) problems.push('Write the feedback.')
  if (plan.rated && review.goal_progress == null) problems.push('Rate progress on the goal out of 10.')
  if (plan.sets && blank(review.goal_set)) problems.push(`Set the goal for ${plan.sets}.`)
  return problems
}

// ---------------------------------------------------------------------------
// Where a month's review stands
// ---------------------------------------------------------------------------

export type ReviewState = 'not_started' | 'overdue' | 'draft' | 'draft_overdue' | 'submitted' | 'submitted_late'

export function reviewState(row: Pick<ReviewDue, 'status' | 'due_date' | 'late'>, today = todayIso()): ReviewState {
  if (row.status === 'submitted') return row.late ? 'submitted_late' : 'submitted'
  const overdue = today > row.due_date
  if (row.status === 'draft') return overdue ? 'draft_overdue' : 'draft'
  return overdue ? 'overdue' : 'not_started'
}

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  not_started: 'Not started',
  overdue: 'Overdue',
  draft: 'Draft',
  draft_overdue: 'Draft · overdue',
  submitted: 'Submitted',
  submitted_late: 'Submitted late',
}

export const REVIEW_STATE_COLORS: Record<ReviewState, ChipProps['color']> = {
  not_started: 'default',
  overdue: 'error',
  draft: 'info',
  draft_overdue: 'error',
  submitted: 'success',
  submitted_late: 'warning',
}

// The database's own messages are written for people; constraint names are not.
export function reviewError(error: { code?: string; message: string }) {
  if (error.message.includes('performance_review_kpis_rating_check')) return 'Ratings are from 1 to 5.'
  if (error.message.includes('performance_reviews_goal_progress_check')) return 'Goal progress is from 0 to 10.'
  if (error.message.includes('performance_reviews_one_goal')) return 'This quarter already has a goal.'
  if (error.code === '42501' && error.message.includes('row-level security'))
    return "You can't change this review. Only the employee's manager can, while it is a draft."
  return error.message
}

export function noteError(error: { code?: string; message: string }) {
  if (error.message.includes('manager_notes_body_check')) return 'The note is too long: keep it under 10,000 characters.'
  if (error.code === '23505') return 'Your note was started in another tab. Reload the page, then add your changes.'
  if (error.code === '42501') return 'You can only keep notes about your direct reports.'
  return error.message
}

// ---------------------------------------------------------------------------
// Feedback from HR
// ---------------------------------------------------------------------------

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  general: 'General',
  appreciation: 'Appreciation',
  improvement: 'Improvement',
}

export const FEEDBACK_KIND_COLORS: Record<FeedbackKind, ChipProps['color']> = {
  general: 'default',
  appreciation: 'success',
  improvement: 'warning',
}

export function feedbackError(error: { code?: string; message: string }) {
  if (error.message.includes('hr_feedback_body_check')) return 'Write the feedback, up to 5,000 characters.'
  if (error.code === '42501') return 'Only HR can send feedback, and not to themselves.'
  return error.message
}
