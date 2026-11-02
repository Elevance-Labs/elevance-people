import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { supabase } from '../lib/supabase'
import { formatDate, formatDay } from '../lib/constants'
import { dueCountdown, dueDateOf, formatScore, longDate, monthLabel, recentCycles } from '../lib/performance'
import {
  FEEDBACK_STATE_COLORS,
  FEEDBACK_STATE_LABELS,
  FEEDBACK_WITH_ANSWERS,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  closesOf,
  feedbackState,
  managerFeedbackError,
  type FeedbackWithAnswers,
} from '../lib/managerFeedback'
import type { DirectoryEntry, ManagerFeedbackDue, ManagerFeedbackQuestion, OneOnOne } from '../lib/types'
import { PersonAvatar } from './common'

/**
 * The signed-in person's current 1:1 (last month's), as soon as it's due:
 * the due date, where their manager's review of them stands (they read it
 * once submitted), and their own feedback on the manager. Nothing for
 * someone not due one (no manager, or joined since).
 */
export function MyOneOnOne() {
  const navigate = useNavigate()
  const [row, setRow] = useState<OneOnOne | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    supabase
      .rpc('my_one_on_one')
      .maybeSingle()
      .then(({ data }) => setRow((data as OneOnOne | null) ?? null))
  }, [])

  async function start() {
    setStarting(true)
    setError(null)
    const { data, error: startError } = await supabase.rpc('manager_feedback_start')
    setStarting(false)
    if (startError) return setError(managerFeedbackError(startError))
    navigate(`/performance/manager-feedback/${data as string}`)
  }

  if (!row) return null
  const manager = row.manager_name ?? 'your manager'
  const countdown = dueCountdown(row.due_date)
  const feedback = feedbackState(row.feedback_id ? { submitted_at: row.feedback_submitted_at, late: null } : null, row.period)
  const allDone = row.review_status === 'submitted' && !!row.feedback_submitted_at
  const review =
    row.review_status === 'submitted'
      ? { label: 'Submitted', color: 'success' as const }
      : row.review_status === 'draft'
        ? { label: 'In progress', color: 'info' as const }
        : { label: 'Not started', color: 'default' as const }

  return (
    <Paper variant="outlined" component="section" aria-label="Your 1:1" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, flexGrow: 1 }}>
          Your {monthLabel(row.period)} 1:1 with {manager}
        </Typography>
        <Chip
          label={allDone ? 'All done' : `Due ${longDate(row.due_date)} · ${countdown.label}`}
          color={allDone ? 'success' : countdown.overdue ? 'error' : countdown.days <= 3 ? 'warning' : 'info'}
        />
      </Stack>
      <Stack divider={<Divider flexItem />} sx={{ mt: 1.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ py: 1.5, alignItems: { sm: 'center' } }}>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Your review, from {manager}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {row.review_status === 'submitted'
                ? 'Ready to read.'
                : `${manager} fills it in at your 1:1; you can read it once it's submitted.`}
            </Typography>
          </Box>
          <Chip size="small" label={review.label} color={review.color} variant="outlined" />
          {row.review_status === 'submitted' && row.review_id && (
            <Button onClick={() => navigate(`/performance/reviews/${row.review_id}`)}>Read</Button>
          )}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ py: 1.5, alignItems: { sm: 'center' } }}>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Your feedback on {manager}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {row.feedback_submitted_at ? 'In. Thank you.' : `Only HR reads it; ${manager} never sees it.`}
            </Typography>
          </Box>
          <Chip size="small" label={FEEDBACK_STATE_LABELS[feedback]} color={FEEDBACK_STATE_COLORS[feedback]} variant="outlined" />
          {row.feedback_id ? (
            <Button
              onClick={() => navigate(`/performance/manager-feedback/${row.feedback_id}`)}
              variant={row.feedback_submitted_at ? 'text' : 'contained'}
            >
              {row.feedback_submitted_at ? 'View' : 'Continue'}
            </Button>
          ) : (
            feedback !== 'missed' && (
              <Button variant="contained" onClick={start} loading={starting}>
                Give feedback
              </Button>
            )
          )}
        </Stack>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Paper>
  )
}

/**
 * HR: a month's feedback on managers — who owes it and its state, each
 * manager's averages with every response (and its author), and the questions.
 */
export function ManagerFeedbackAdmin() {
  const navigate = useNavigate()
  const months = useMemo(() => recentCycles(), [])
  const [period, setPeriod] = useState(months[0])
  const [rows, setRows] = useState<ManagerFeedbackDue[]>([])
  const [forms, setForms] = useState<FeedbackWithAnswers[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.rpc('manager_feedback_due', { p_period: period }),
      supabase.from('manager_feedback').select(FEEDBACK_WITH_ANSWERS).eq('period', period),
      supabase.from('employee_directory').select('id, full_name'),
    ]).then(([dueRes, formsRes, peopleRes]) => {
      const failure = dueRes.error ?? formsRes.error ?? peopleRes.error
      if (failure) setError(failure.message)
      else {
        setRows((dueRes.data ?? []) as ManagerFeedbackDue[])
        setForms(formsRes.data as unknown as FeedbackWithAnswers[])
        setNames(new Map((peopleRes.data as Pick<DirectoryEntry, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name])))
        setError(null)
      }
      setLoading(false)
    })
  }, [period])

  const nameOf = (id: string | null) => (id && names.get(id)) || 'Someone no longer here'
  const submitted = forms.filter((f) => f.submitted_at)
  const managers = [...new Set(submitted.map((f) => f.manager_id ?? ''))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack direction="row" spacing={2} sx={{ p: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
          <TextField
            select
            label="Month reviewed"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {months.map((m) => (
              <MenuItem key={m} value={m}>
                {monthLabel(m)}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
            Given at the 1:1, due {formatDate(dueDateOf(period))}, closes {formatDate(closesOf(period))}
            {!loading && ` · ${submitted.length} of ${rows.length} submitted`}
          </Typography>
        </Stack>
        {error && <Alert severity="error" sx={{ mx: 2, mb: 2 }}>{error}</Alert>}
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Manager</TableCell>
                <TableCell>Feedback</TableCell>
                <TableCell>Submitted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const state = feedbackState(r.feedback_id ? r : null, period)
                return (
                  <TableRow
                    key={r.employee_id}
                    hover
                    onClick={r.feedback_id ? () => navigate(`/performance/manager-feedback/${r.feedback_id}`) : undefined}
                    sx={{ cursor: r.feedback_id ? 'pointer' : undefined, '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <PersonAvatar name={r.full_name} size={32} />
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {r.full_name}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{r.manager_name ?? '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" label={FEEDBACK_STATE_LABELS[state]} color={FEEDBACK_STATE_COLORS[state]} variant="outlined" />
                    </TableCell>
                    <TableCell>{r.submitted_at ? formatDay(r.submitted_at) : '—'}</TableCell>
                  </TableRow>
                )
              })}
              {!loading && !rows.length && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    Nobody owes feedback on a manager for {monthLabel(period)}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {managers.length > 0 && (
        <Box component="section" aria-label="By manager">
          <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
            By manager
          </Typography>
          <Stack spacing={2}>
            {managers.map((managerId) => {
              const theirs = submitted.filter((f) => (f.manager_id ?? '') === managerId)
              const prompts = [...new Set(theirs.flatMap((f) => [...f.answers].sort((a, b) => a.sort_order - b.sort_order).map((a) => a.prompt)))]
              return (
                <Paper key={managerId} variant="outlined" component="section" aria-label={nameOf(managerId)} sx={{ p: 2 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {nameOf(managerId)} · {theirs.length} {theirs.length === 1 ? 'response' : 'responses'}
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    {prompts.map((prompt) => {
                      const ratings = theirs.flatMap((f) => f.answers.filter((a) => a.prompt === prompt && a.rating != null).map((a) => a.rating!))
                      return (
                        <Stack key={prompt} direction="row" spacing={2} sx={{ py: 0.5 }}>
                          <Typography variant="body2" sx={{ flexGrow: 1 }}>
                            {prompt}
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {formatScore(ratings.reduce((s, r) => s + r, 0) / ratings.length)} / 5
                          </Typography>
                        </Stack>
                      )
                    })}
                  </Box>
                  {theirs.some((f) => f.body) && (
                    <>
                      <Divider sx={{ my: 1 }} />
                      {theirs
                        .filter((f) => f.body)
                        .map((f) => (
                          <Typography key={f.id} variant="body2" sx={{ py: 0.5, whiteSpace: 'pre-wrap' }}>
                            <Box component="span" sx={{ fontWeight: 500 }}>
                              {nameOf(f.employee_id)}:
                            </Box>{' '}
                            {f.body}
                          </Typography>
                        ))}
                    </>
                  )}
                </Paper>
              )
            })}
          </Stack>
        </Box>
      )}

      <FeedbackQuestions />
    </Stack>
  )
}

// HR's question list. Edits reach only forms started afterwards.
function FeedbackQuestions() {
  const [questions, setQuestions] = useState<ManagerFeedbackQuestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const [editing, setEditing] = useState<{ id: string; prompt: string } | null>(null)

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from('manager_feedback_questions').select('*').order('sort_order')
    if (loadError) setError(loadError.message)
    else setQuestions(data as ManagerFeedbackQuestion[])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(write: PromiseLike<{ error: { code?: string; message: string } | null }>) {
    setError(null)
    const { error: writeError } = await write
    if (writeError) {
      setError(managerFeedbackError(writeError))
      return false
    }
    await load()
    return true
  }

  return (
    <Paper variant="outlined" component="section" aria-label="Questions" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
        Questions
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        {MIN_QUESTIONS} to {MAX_QUESTIONS} questions, each rated 1–5, then a feedback box. Changes reach only forms
        started afterwards.
      </Typography>
      <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
        {questions.map((x) => (
          <Box component="li" key={x.id} sx={{ py: 0.5 }}>
            {editing?.id === x.id ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  label="Question"
                  fullWidth
                  autoFocus
                  value={editing.prompt}
                  onChange={(e) => setEditing({ id: x.id, prompt: e.target.value })}
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                />
                <Button onClick={() => setEditing(null)}>Cancel</Button>
                <Button
                  variant="contained"
                  disabled={!editing.prompt.trim()}
                  onClick={async () => {
                    if (await run(supabase.from('manager_feedback_questions').update({ prompt: editing.prompt.trim() }).eq('id', x.id)))
                      setEditing(null)
                  }}
                >
                  Save
                </Button>
              </Stack>
            ) : (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  {x.prompt}
                </Typography>
                <IconButton size="small" aria-label={`Edit ${x.prompt}`} onClick={() => setEditing({ id: x.id, prompt: x.prompt })}>
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={`Delete ${x.prompt}`}
                  disabled={questions.length <= MIN_QUESTIONS}
                  onClick={() => run(supabase.from('manager_feedback_questions').delete().eq('id', x.id))}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            )}
          </Box>
        ))}
      </Box>
      {questions.length < MAX_QUESTIONS && (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center' }}>
          <TextField
            label="New question"
            fullWidth
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <Button
            disabled={!adding.trim()}
            onClick={async () => {
              if (await run(supabase.from('manager_feedback_questions').insert({ prompt: adding.trim() }))) setAdding('')
            }}
          >
            Add
          </Button>
        </Stack>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Paper>
  )
}
