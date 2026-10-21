import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Divider,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDay } from '../../lib/constants'
import {
  REVIEW_WITH_LINES,
  formatScore,
  goalPlan,
  goalQuarterOf,
  monthLabel,
  overallScore,
  quarterLabel,
  reviewError,
  reviewState,
  sortLines,
  submitProblems,
  type ReviewWithLines,
} from '../../lib/performance'
import type { DirectoryEntry, PerformanceReview, ReviewExpectation, ReviewKpi } from '../../lib/types'
import { ConfirmDialog, PageHeader } from '../../components/common'
import { ReviewStateChip } from '../../components/Performance'
import { PrivateNotes } from '../../components/PrivateNotes'

type GoalSource = Pick<PerformanceReview, 'id' | 'period' | 'status' | 'goal_set'>

const RATING_HINT = '1 well below · 2 below · 3 meets · 4 above · 5 well above expectations'

function Block({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" component="section" aria-label={title} sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {subtitle}
        </Typography>
      )}
      <Stack spacing={2.5} divider={<Divider flexItem />} sx={{ mt: 2 }}>
        {children}
      </Stack>
    </Paper>
  )
}

function Text({ value }: { value: string | null }) {
  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: value ? undefined : 'text.secondary' }}>
      {value || '—'}
    </Typography>
  )
}

// The parts of a draft the manager writes, compared to decide what to save.
const reviewFields = (r: ReviewWithLines) => ({
  evaluation: r.evaluation?.trim() ? r.evaluation : null,
  feedback: r.feedback?.trim() ? r.feedback : null,
  goal_set: r.goal_set?.trim() ? r.goal_set : null,
  goal_progress: r.goal_progress,
})
const kpiFields = (k: ReviewKpi) => ({ rating: k.rating, note: k.note?.trim() ? k.note : null })
const expectationFields = (x: ReviewExpectation) => ({ met: x.met, note: x.note?.trim() ? x.note : null })
const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b)

export default function Review() {
  const { id } = useParams()
  const { employee } = useAuth()
  const me = employee!.id
  const [saved, setSaved] = useState<ReviewWithLines | null>(null)
  const [draft, setDraft] = useState<ReviewWithLines | null>(null)
  const [people, setPeople] = useState<Map<string, DirectoryEntry>>(new Map())
  const [managerId, setManagerId] = useState<string | null>(null)
  const [others, setOthers] = useState<GoalSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [busy, setBusy] = useState<'save' | 'submit' | 'acknowledge' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('performance_reviews')
      .select(REVIEW_WITH_LINES)
      .eq('id', id!)
      .maybeSingle()
    if (loadError || !data) {
      setError(loadError ? loadError.message : 'Review not found.')
      setLoading(false)
      return
    }
    const review = sortLines(data as unknown as ReviewWithLines)
    const ids = [review.employee_id, review.submitted_by].filter((x): x is string => !!x)
    const [peopleRes, nodeRes, othersRes] = await Promise.all([
      supabase.from('employee_directory').select('id, full_name, designation').in('id', ids),
      supabase.from('org_chart_nodes').select('manager_id').eq('employee_id', review.employee_id).maybeSingle(),
      // The person's other reviews decide what the draft does with the goal.
      supabase.from('performance_reviews').select('id, period, status, goal_set').eq('employee_id', review.employee_id),
    ])
    const failure = peopleRes.error ?? nodeRes.error ?? othersRes.error
    if (failure) setError(failure.message)
    else {
      setPeople(new Map((peopleRes.data as DirectoryEntry[]).map((p) => [p.id, p])))
      setManagerId((nodeRes.data as { manager_id: string | null } | null)?.manager_id ?? null)
      setOthers(othersRes.data as GoalSource[])
      setSaved(review)
      setDraft(review)
      setError(null)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const plan = useMemo(() => (draft ? goalPlan(draft, others) : null), [draft, others])

  if (loading) return <LinearProgress />
  if (!draft || !saved || !plan) return <Alert severity="error">{error}</Alert>

  const editable = draft.status === 'draft' && managerId === me
  const own = draft.employee_id === me
  const person = people.get(draft.employee_id)
  const nameOf = (who: string | null) => (who && people.get(who)?.full_name) || 'someone no longer here'
  const dirty =
    !same(reviewFields(draft), reviewFields(saved)) ||
    draft.kpis.some((k, i) => !same(kpiFields(k), kpiFields(saved.kpis[i]))) ||
    draft.expectations.some((x, i) => !same(expectationFields(x), expectationFields(saved.expectations[i])))
  const score = overallScore(draft.kpis)

  const setKpi = (i: number, change: Partial<ReviewKpi>) =>
    setDraft((d) => d && { ...d, kpis: d.kpis.map((k, j) => (j === i ? { ...k, ...change } : k)) })
  const setExpectation = (i: number, change: Partial<ReviewExpectation>) =>
    setDraft((d) => d && { ...d, expectations: d.expectations.map((x, j) => (j === i ? { ...x, ...change } : x)) })
  const setField = (change: Partial<PerformanceReview>) => setDraft((d) => d && { ...d, ...change })

  // Writes only what changed since the last save. False if anything failed.
  async function save() {
    const writes = []
    if (!same(reviewFields(draft!), reviewFields(saved!)))
      writes.push(() => supabase.from('performance_reviews').update(reviewFields(draft!)).eq('id', draft!.id))
    draft!.kpis.forEach((k, i) => {
      if (!same(kpiFields(k), kpiFields(saved!.kpis[i])))
        writes.push(() => supabase.from('performance_review_kpis').update(kpiFields(k)).eq('id', k.id))
    })
    draft!.expectations.forEach((x, i) => {
      if (!same(expectationFields(x), expectationFields(saved!.expectations[i])))
        writes.push(() => supabase.from('performance_review_expectations').update(expectationFields(x)).eq('id', x.id))
    })
    for (const write of writes) {
      const { error: saveError } = await write()
      if (saveError) {
        setError(reviewError(saveError))
        return false
      }
    }
    setSaved(draft)
    return true
  }

  async function saveDraft() {
    setBusy('save')
    setError(null)
    setNotice(null)
    if (await save()) setNotice('Draft saved.')
    setBusy(null)
  }

  // Checks the draft, then asks for confirmation: a submitted review is final.
  function askToSubmit() {
    setError(null)
    setNotice(null)
    const found = submitProblems(draft!, plan!)
    setProblems(found)
    if (!found.length) setConfirming(true)
  }

  async function submit() {
    setConfirming(false)
    setBusy('submit')
    if (await save()) {
      const { error: submitError } = await supabase.rpc('review_submit', { p_review_id: draft!.id })
      if (submitError) setError(reviewError(submitError))
      else {
        setNotice(`Submitted. ${person?.full_name ?? 'They'} can now read it.`)
        await load()
      }
    }
    setBusy(null)
  }

  async function acknowledge() {
    setBusy('acknowledge')
    const { error: ackError } = await supabase.rpc('review_acknowledge', { p_review_id: draft!.id })
    setBusy(null)
    if (ackError) return setError(reviewError(ackError))
    load()
  }

  // Submitted: the goal as review_submit recorded it. Draft: as it will.
  const rated = draft.status === 'submitted'
    ? draft.goal_rated && { goal: draft.goal_rated, quarter: quarterLabel(draft.period) }
    : plan.rated
  const setsQuarter = draft.status === 'submitted'
    ? draft.goal_set && quarterLabel(goalQuarterOf(draft.period))
    : plan.sets

  return (
    <>
      <PageHeader
        title={`${own ? 'Your' : `${person?.full_name ?? 'Employee'}'s`} ${monthLabel(draft.period)} review`}
        subtitle={[person?.designation, `Due ${formatDate(draft.due_date)}`, score != null && `Overall ${formatScore(score)} / 5`]
          .filter(Boolean)
          .join(' · ')}
        back={own ? '/performance' : managerId === me ? '/performance?tab=team' : `/performance/people/${draft.employee_id}`}
        actions={<ReviewStateChip state={reviewState(draft)} />}
      />

      <Stack spacing={2} sx={{ mb: 3 }}>
        {draft.status === 'submitted' && (
          <Alert severity={draft.acknowledged_at ? 'success' : 'info'} variant="outlined">
            Submitted by {nameOf(draft.submitted_by)} on {formatDay(draft.submitted_at!)}
            {draft.late && ', after the due date'}.{' '}
            {draft.acknowledged_at
              ? `Acknowledged on ${formatDay(draft.acknowledged_at)}.`
              : own
                ? 'Read it through, then acknowledge it below.'
                : 'Not yet acknowledged.'}
          </Alert>
        )}
        {draft.status === 'draft' && !editable && (
          <Alert severity="info" variant="outlined">
            A draft. Only {person?.full_name ?? 'the employee'}'s manager can fill it in and submit it.
          </Alert>
        )}
      </Stack>

      <Stack spacing={3}>
        {/* The manager's own talking points, beside the form; never part of the review. */}
        {managerId === me && <PrivateNotes employeeId={draft.employee_id} name={person?.full_name ?? 'them'} />}

        <Block title="KPIs" subtitle={editable ? RATING_HINT : 'Rated out of 5'}>
          {draft.kpis.map((k, i) => (
            <Box key={k.id} component="section" aria-label={k.name}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 500 }}>{k.name}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {[k.target && `Target: ${k.target}`, k.weight != null && `Weight ${Number(k.weight)}%`, k.description]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
                {editable ? (
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={k.rating}
                    onChange={(_, value: number | null) => value != null && setKpi(i, { rating: value })}
                    aria-label={`Rating for ${k.name}`}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <ToggleButton key={n} value={n} sx={{ width: 40 }}>
                        {n}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                ) : (
                  <Typography variant="h6" component="p" sx={{ flexShrink: 0 }}>
                    {k.rating ?? '—'}
                    <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
                      {' '}/ 5
                    </Typography>
                  </Typography>
                )}
              </Stack>
              {editable ? (
                <TextField
                  label="Note"
                  fullWidth
                  multiline
                  minRows={1}
                  required={k.rating != null && k.rating <= 2}
                  helperText={k.rating != null && k.rating <= 2 ? 'Needed for a rating of 1 or 2' : undefined}
                  value={k.note ?? ''}
                  onChange={(e) => setKpi(i, { note: e.target.value })}
                  sx={{ mt: 1.5 }}
                />
              ) : (
                k.note && (
                  <Box sx={{ mt: 1 }}>
                    <Text value={k.note} />
                  </Box>
                )
              )}
            </Box>
          ))}
          {!draft.kpis.length && <Text value="This designation has no KPIs." />}
        </Block>

        <Block title="Expectations">
          {draft.expectations.map((x, i) => (
            <Box key={x.id} component="section" aria-label={x.title}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                <Typography sx={{ flexGrow: 1, fontWeight: 500 }}>{x.title}</Typography>
                {editable ? (
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={x.met}
                    onChange={(_, value: boolean | null) => value != null && setExpectation(i, { met: value })}
                    aria-label={`Was "${x.title}" met`}
                  >
                    <ToggleButton value={true} color="success">
                      Met
                    </ToggleButton>
                    <ToggleButton value={false} color="error">
                      Not met
                    </ToggleButton>
                  </ToggleButtonGroup>
                ) : (
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
                    {x.met ? <CheckCircleIcon color="success" fontSize="small" /> : <CancelIcon color="error" fontSize="small" />}
                    <Typography variant="body2">{x.met ? 'Met' : 'Not met'}</Typography>
                  </Stack>
                )}
              </Stack>
              {editable ? (
                <TextField
                  label="Note"
                  fullWidth
                  multiline
                  minRows={1}
                  required={x.met === false}
                  helperText={x.met === false ? 'Needed when not met' : undefined}
                  value={x.note ?? ''}
                  onChange={(e) => setExpectation(i, { note: e.target.value })}
                  sx={{ mt: 1.5 }}
                />
              ) : (
                x.note && (
                  <Box sx={{ mt: 1 }}>
                    <Text value={x.note} />
                  </Box>
                )
              )}
            </Box>
          ))}
          {!draft.expectations.length && <Text value="This designation has no expectations." />}
        </Block>

        <Block title="Goal">
          {rated && (
            <Box>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {rated.quarter} goal
              </Typography>
              <Text value={rated.goal} />
              {editable ? (
                <TextField
                  select
                  label="Progress"
                  required
                  value={draft.goal_progress ?? ''}
                  onChange={(e) => setField({ goal_progress: Number(e.target.value) })}
                  sx={{ mt: 1.5, minWidth: 160 }}
                >
                  {Array.from({ length: 11 }, (_, n) => (
                    <MenuItem key={n} value={n}>
                      {n} / 10
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <Typography sx={{ mt: 1, fontWeight: 500 }}>Progress {draft.goal_progress ?? '—'} / 10</Typography>
              )}
            </Box>
          )}
          {setsQuarter && (
            <Box>
              {editable ? (
                <TextField
                  label={`Goal for ${setsQuarter}`}
                  required
                  fullWidth
                  multiline
                  minRows={2}
                  helperText="Set in the first review of each quarter, then rated out of 10 in the next ones"
                  value={draft.goal_set ?? ''}
                  onChange={(e) => setField({ goal_set: e.target.value })}
                />
              ) : (
                <>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Goal set for {setsQuarter}
                  </Typography>
                  <Text value={draft.goal_set} />
                </>
              )}
            </Box>
          )}
          {!rated && !setsQuarter && <Text value="No goal in this review." />}
        </Block>

        <Block title="Evaluation and feedback">
          {editable ? (
            <TextField
              label="Evaluation"
              required
              fullWidth
              multiline
              minRows={3}
              helperText={`How ${monthLabel(draft.period)} went`}
              value={draft.evaluation ?? ''}
              onChange={(e) => setField({ evaluation: e.target.value })}
            />
          ) : (
            <Box>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Evaluation
              </Typography>
              <Text value={draft.evaluation} />
            </Box>
          )}
          {editable ? (
            <TextField
              label="Feedback"
              required
              fullWidth
              multiline
              minRows={3}
              helperText="What to keep doing and what to change"
              value={draft.feedback ?? ''}
              onChange={(e) => setField({ feedback: e.target.value })}
            />
          ) : (
            <Box>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Feedback
              </Typography>
              <Text value={draft.feedback} />
            </Box>
          )}
        </Block>

        {problems.length > 0 && (
          <Alert severity="warning">
            Before submitting:
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </Box>
          </Alert>
        )}
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {notice && <Alert severity="success">{notice}</Alert>}

        <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
          {editable && (
            <>
              <Button onClick={saveDraft} loading={busy === 'save'} disabled={!dirty || !!busy}>
                Save draft
              </Button>
              <Button variant="contained" onClick={askToSubmit} loading={busy === 'submit'} disabled={!!busy}>
                Submit review
              </Button>
            </>
          )}
          {own && draft.status === 'submitted' && !draft.acknowledged_at && (
            <Button variant="contained" onClick={acknowledge} loading={busy === 'acknowledge'}>
              Acknowledge
            </Button>
          )}
        </Stack>
      </Stack>

      <ConfirmDialog
        open={confirming}
        title="Submit this review?"
        message={`Once submitted it can't be changed or reopened, by you or anyone else. ${
          person?.full_name ?? 'The employee'
        } will be able to read it.`}
        confirmLabel="Submit"
        onConfirm={submit}
        onClose={() => setConfirming(false)}
      />
    </>
  )
}
