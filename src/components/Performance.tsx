import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Box,
  Chip,
  Grid,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import {
  REVIEW_STATE_COLORS,
  REVIEW_STATE_LABELS,
  currentGoal,
  expectationsMet,
  formatScore,
  goalQuarterOf,
  lineKey,
  monthLabel,
  overallScore,
  quarterLabel,
  reviewState,
  scoreSummary,
  shortMonthLabel,
  type ReviewState,
  type ReviewWithLines,
} from '../lib/performance'
import type { PerformanceReview } from '../lib/types'

// How many months the report charts and tabulates.
const MONTHS_SHOWN = 12

export function ReviewStateChip({ state }: { state: ReviewState }) {
  return (
    <Chip
      label={REVIEW_STATE_LABELS[state]}
      color={REVIEW_STATE_COLORS[state]}
      size="small"
      variant={state === 'submitted' ? 'filled' : 'outlined'}
    />
  )
}

function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="h5" component="p" sx={{ my: 0.5 }}>
        {value}
      </Typography>
      {detail && (
        <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
          {detail}
        </Typography>
      )}
    </Paper>
  )
}

// The width a box is laid out at, so a chart draws in real pixels and its
// text stays its true size at any width.
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => el.clientWidth > 0 && setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

// One series over time: the overall score per month, 1 to 5. A hairline grid
// at each whole score, a 2px line, ringed markers and a tooltip on hover or
// focus. The table below the chart carries the same numbers.
function ScoreTrend({ points }: { points: { label: string; month: string; score: number }[] }) {
  const theme = useTheme()
  const [active, setActive] = useState<number | null>(null)
  const [box, W] = useWidth(640)
  const H = 200
  const pad = { left: 32, right: 40, top: 16, bottom: 28 }
  const x = (i: number) =>
    points.length === 1 ? (pad.left + W - pad.right) / 2 : pad.left + (i * (W - pad.left - pad.right)) / (points.length - 1)
  const y = (score: number) => pad.top + ((5 - score) * (H - pad.top - pad.bottom)) / 4
  const labelEvery = (W - pad.left - pad.right) / Math.max(points.length - 1, 1) < 56 ? 2 : 1
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.score)}`).join(' ')
  const ink = theme.palette.text.secondary
  const color = theme.palette.primary.main
  const surface = theme.palette.background.paper
  const last = points.at(-1)!
  const shown = active == null ? null : points[active]

  return (
    <Box ref={box} sx={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Overall score by month, latest ${formatScore(last.score)} out of 5`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {[1, 2, 3, 4, 5].map((s) => (
          <g key={s}>
            <line x1={pad.left} x2={W - pad.right} y1={y(s)} y2={y(s)} stroke={theme.palette.divider} strokeWidth={1} />
            <text x={pad.left - 10} y={y(s)} dy="0.32em" textAnchor="end" fontSize={12} fill={ink}>
              {s}
            </text>
          </g>
        ))}
        {/* Every month's label while they fit, else every other one. */}
        {points.map((p, i) =>
          (points.length - 1 - i) % labelEvery ? null : (
            <text key={p.month} x={x(i)} y={H - 6} textAnchor="middle" fontSize={12} fill={ink}>
              {p.label}
            </text>
          ),
        )}
        {shown && (
          <line x1={x(active!)} x2={x(active!)} y1={pad.top} y2={H - pad.bottom} stroke={theme.palette.divider} />
        )}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g
            key={p.month}
            tabIndex={0}
            role="button"
            aria-label={`${monthLabel(p.month)}: ${formatScore(p.score)} out of 5`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            style={{ outline: 'none', cursor: 'default' }}
          >
            <circle cx={x(i)} cy={y(p.score)} r={14} fill="transparent" />
            <circle cx={x(i)} cy={y(p.score)} r={active === i ? 6 : 4} fill={color} stroke={surface} strokeWidth={2} />
          </g>
        ))}
        <text x={x(points.length - 1) + 10} y={y(last.score)} dy="0.32em" fontSize={12} fontWeight={600} fill={theme.palette.text.primary}>
          {formatScore(last.score)}
        </text>
      </svg>
      {shown && (
        <Paper
          elevation={3}
          role="tooltip"
          sx={{
            position: 'absolute',
            left: `${(x(active!) / W) * 100}%`,
            top: `${(y(shown.score) / H) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 12px))',
            px: 1.25,
            py: 0.75,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {monthLabel(shown.month)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {formatScore(shown.score)} / 5
          </Typography>
        </Paper>
      )}
    </Box>
  )
}

const MET = <CheckCircleIcon fontSize="small" color="success" aria-label="Met" />
const NOT_MET = <CancelIcon fontSize="small" color="error" aria-label="Not met" />

/**
 * An employee's submitted reviews as a report: the latest figures, the overall
 * score over time, and every rating month by month.
 */
export function PerformanceReport({ reviews }: { reviews: ReviewWithLines[] }) {
  const theme = useTheme()
  const months = reviews
    .filter((r) => r.status === 'submitted')
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-MONTHS_SHOWN)

  if (!months.length) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">No submitted reviews yet. They show here once a manager submits one.</Typography>
      </Paper>
    )
  }

  const latest = months.at(-1)!
  const previous = months.at(-2)
  const score = overallScore(latest.kpis)
  const delta = previous && score != null ? score - (overallScore(previous.kpis) ?? score) : null
  const met = expectationsMet(latest.expectations)
  const goal = currentGoal(reviews)
  const points = months.flatMap((r) => {
    const s = overallScore(r.kpis)
    return s == null ? [] : [{ month: r.period, label: shortMonthLabel(r.period), score: s }]
  })

  // Every KPI and expectation in these months, in the latest review's order first.
  const keyOf = lineKey
  const kpiRows = new Map<string, string>()
  const expectationRows = new Map<string, string>()
  for (const r of [...months].reverse()) {
    for (const k of r.kpis) if (!kpiRows.has(keyOf(k.kpi_id, k.name))) kpiRows.set(keyOf(k.kpi_id, k.name), k.name)
    for (const x of r.expectations)
      if (!expectationRows.has(keyOf(x.expectation_id, x.title))) expectationRows.set(keyOf(x.expectation_id, x.title), x.title)
  }
  // A sequential tint of the primary hue: the higher the rating, the deeper.
  const tint = (rating: number) => alpha(theme.palette.primary.main, 0.06 + (rating - 1) * 0.07)

  return (
    <Stack spacing={3}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile
            label={`Overall, ${monthLabel(latest.period)}`}
            value={`${formatScore(score)} / 5`}
            detail={
              delta == null
                ? 'Weighted average of the KPI ratings'
                : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} on ${monthLabel(previous!.period)}`
            }
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile
            label="Expectations met"
            value={met.percent == null ? '—' : `${met.percent}%`}
            detail={met.total ? `${met.met} of ${met.total} in ${monthLabel(latest.period)}` : 'No expectations set'}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile
            label={goal ? `Goal, ${goal.quarter}` : 'Goal'}
            value={latest.goal_progress == null ? '—' : `${latest.goal_progress} / 10`}
            detail={goal?.goal ?? 'No goal set yet'}
          />
        </Grid>
      </Grid>

      {points.length > 0 && (
        <Paper variant="outlined" component="section" aria-label="Overall score" sx={{ p: 2 }}>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
            Overall score
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
            KPI ratings out of 5, weighted, by month reviewed
          </Typography>
          <ScoreTrend points={points} />
        </Paper>
      )}

      <Paper variant="outlined" component="section" aria-label="By month" sx={{ overflow: 'hidden' }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, p: 2, pb: 1 }}>
          By month
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 200 }} />
                {months.map((r) => (
                  <TableCell key={r.id} align="center" sx={{ whiteSpace: 'nowrap' }}>
                    {shortMonthLabel(r.period)}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Overall</TableCell>
                {months.map((r) => (
                  <TableCell key={r.id} align="center" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {formatScore(overallScore(r.kpis))}
                  </TableCell>
                ))}
              </TableRow>
              {[...kpiRows].map(([key, name]) => (
                <TableRow key={key}>
                  <TableCell>{name}</TableCell>
                  {months.map((r) => {
                    const rating = r.kpis.find((k) => keyOf(k.kpi_id, k.name) === key)?.rating
                    return (
                      <TableCell
                        key={r.id}
                        align="center"
                        sx={{ fontVariantNumeric: 'tabular-nums', bgcolor: rating ? tint(rating) : undefined }}
                      >
                        {rating ?? '—'}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
              {[...expectationRows].map(([key, title]) => (
                <TableRow key={key}>
                  <TableCell>{title}</TableCell>
                  {months.map((r) => {
                    const x = r.expectations.find((e) => keyOf(e.expectation_id, e.title) === key)
                    return (
                      <TableCell key={r.id} align="center" sx={{ lineHeight: 0 }}>
                        {x?.met == null ? '—' : x.met ? MET : NOT_MET}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
              <TableRow sx={{ '& td': { borderBottom: 0 } }}>
                <TableCell>Goal progress</TableCell>
                {months.map((r) => (
                  <TableCell key={r.id} align="center" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {r.goal_progress == null ? '—' : `${r.goal_progress}/10`}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  )
}

// One KPI's or expectation's average, with a bar out of the most it can be.
function AverageRow({ name, value, percent, detail }: { name: string; value: string; percent: number; detail: string }) {
  return (
    <Box sx={{ px: 2, py: 1.25 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', mb: 0.75 }}>
        <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          {name}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {value}
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={percent} aria-label={`${name}: ${value}, ${detail}`} />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {detail}
      </Typography>
    </Box>
  )
}

const reviewCount = (n: number) => (n === 1 ? '1 review' : `${n} reviews`)

/**
 * Scores across every submitted review: the performance score, the KPI and
 * expectation scores, then each KPI's average rating and each expectation's
 * share met.
 */
export function ScoreSummary({ reviews }: { reviews: ReviewWithLines[] }) {
  const s = scoreSummary(reviews)
  if (!s.reviews) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">No scores yet. They show here once your manager submits a monthly review.</Typography>
      </Paper>
    )
  }
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile
            label="Performance score"
            value={s.performance == null ? '—' : `${s.performance}%`}
            detail="Average KPI score out of 5, as a percentage"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile
            label="KPI score"
            value={`${formatScore(s.kpiScore)} / 5`}
            detail={`Average over ${reviewCount(s.reviews)}`}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile
            label="Expectation score"
            value={s.expectationScore == null ? '—' : `${s.expectationScore}%`}
            detail={`Expectations met over ${reviewCount(s.reviews)}`}
          />
        </Grid>
      </Grid>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" component="section" aria-label="KPIs">
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, px: 2, pt: 1.5 }}>
              KPIs
            </Typography>
            {s.kpis.map((k) => (
              <AverageRow
                key={k.key}
                name={k.name}
                value={`${formatScore(k.average)} / 5`}
                percent={(k.average / 5) * 100}
                detail={`Average of ${reviewCount(k.count)}`}
              />
            ))}
            {!s.kpis.length && (
              <Typography variant="body2" sx={{ px: 2, py: 1.5, color: 'text.secondary' }}>
                No KPIs rated.
              </Typography>
            )}
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" component="section" aria-label="Expectations">
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, px: 2, pt: 1.5 }}>
              Expectations
            </Typography>
            {s.expectations.map((x) => (
              <AverageRow
                key={x.key}
                name={x.name}
                value={`${Math.round(x.average * 100)}%`}
                percent={x.average * 100}
                detail={`Met in ${Math.round(x.average * x.count)} of ${reviewCount(x.count)}`}
              />
            ))}
            {!s.expectations.length && (
              <Typography variant="body2" sx={{ px: 2, py: 1.5, color: 'text.secondary' }}>
                No expectations marked.
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Stack>
  )
}

/** Reviews, newest first, each linking to its page. */
export function ReviewList({
  reviews,
  empty,
}: {
  reviews: (Pick<PerformanceReview, 'id' | 'period' | 'status' | 'due_date' | 'late' | 'acknowledged_at' | 'goal_set'> & {
    kpis?: ReviewWithLines['kpis']
  })[]
  empty: string
}) {
  const sorted = [...reviews].sort((a, b) => b.period.localeCompare(a.period))
  return (
    <Paper variant="outlined">
      <List disablePadding>
        {sorted.map((r) => {
          const score = r.kpis ? overallScore(r.kpis) : null
          return (
            <ListItemButton key={r.id} component={Link} to={`/performance/reviews/${r.id}`} divider>
              <ListItemText
                primary={monthLabel(r.period)}
                secondary={[
                  score != null && `Overall ${formatScore(score)} / 5`,
                  r.goal_set && `Set the ${quarterLabel(goalQuarterOf(r.period))} goal`,
                  r.status === 'submitted' && !r.acknowledged_at && 'Not yet acknowledged',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <ReviewStateChip state={reviewState(r)} />
            </ListItemButton>
          )
        })}
        {!sorted.length && (
          <Typography variant="body2" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            {empty}
          </Typography>
        )}
      </List>
    </Paper>
  )
}
