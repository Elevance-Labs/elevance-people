import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
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
import AddIcon from '@mui/icons-material/Add'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/constants'
import { todayIso } from '../lib/leaves'
import { formatScore } from '../lib/performance'
import {
  ASSIGNMENT_WITH_CYCLE,
  MIN_RESPONSES,
  PEER_CYCLE_STATUS_COLORS,
  PEER_CYCLE_STATUS_LABELS,
  PEER_STATE_COLORS,
  PEER_STATE_LABELS,
  cycleLabel,
  defaultDueDate,
  nextQuarter,
  peerError,
  peerState,
  quarterOf,
  type AssignmentWithCycle,
} from '../lib/peerReviews'
import type { DirectoryEntry, MyPeerFeedback as Response, PeerReviewAssignment, PeerReviewCycle } from '../lib/types'
import { FormDialog, PersonAvatar } from './common'

/** The signed-in reviewer's peer review forms, newest quarter first. */
export function PeerReviewList() {
  const { employee } = useAuth()
  const me = employee!.id
  const navigate = useNavigate()
  const [rows, setRows] = useState<AssignmentWithCycle[]>([])
  const [names, setNames] = useState<Map<string, Pick<DirectoryEntry, 'full_name' | 'designation'>>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('peer_review_assignments')
      .select(ASSIGNMENT_WITH_CYCLE)
      .eq('reviewer_id', me)
      .then(async ({ data, error: loadError }) => {
        if (loadError) {
          setError(loadError.message)
          setLoading(false)
          return
        }
        const list = (data as unknown as AssignmentWithCycle[]).filter((a) => a.cycle)
        const { data: people } = await supabase
          .from('employee_directory')
          .select('id, full_name, designation')
          .in('id', list.map((a) => a.subject_id))
        const byId = new Map(((people ?? []) as Pick<DirectoryEntry, 'id' | 'full_name' | 'designation'>[]).map((p) => [p.id, p]))
        setNames(byId)
        setRows(
          list.sort(
            (a, b) => b.cycle!.year - a.cycle!.year || b.cycle!.quarter - a.cycle!.quarter ||
              (byId.get(a.subject_id)?.full_name ?? '').localeCompare(byId.get(b.subject_id)?.full_name ?? ''),
          ),
        )
        setLoading(false)
      })
  }, [me])

  if (loading) return <LinearProgress />
  if (error) return <Alert severity="error">{error}</Alert>

  const toDo = rows.filter((a) => !a.submitted_at && a.cycle!.status === 'open').length
  return (
    <Stack spacing={2}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        HR asked you to review these colleagues{toDo ? `; ${toDo} still to write` : ''}. They read your answers
        without your name once the quarter's reviews close; HR sees them with your name.
      </Typography>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Person</TableCell>
                <TableCell>Quarter</TableCell>
                <TableCell>Due</TableCell>
                <TableCell>Review</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((a) => {
                const state = peerState(a, a.cycle!)
                const person = names.get(a.subject_id)
                return (
                  <TableRow key={a.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <PersonAvatar name={person?.full_name ?? '?'} size={32} />
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {person?.full_name ?? 'Someone no longer here'}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {person?.designation ?? ''}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>{cycleLabel(a.cycle!)}</TableCell>
                    <TableCell>{formatDate(a.cycle!.due_date)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={PEER_STATE_LABELS[state]} color={PEER_STATE_COLORS[state]} variant="outlined" />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant={state === 'to_do' || state === 'overdue' ? 'contained' : 'text'}
                        onClick={() => navigate(`/performance/peer/${a.id}`)}
                      >
                        {state === 'to_do' || state === 'overdue' ? 'Write' : 'View'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    Nobody has asked you for a peer review.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  )
}

type CycleRow = PeerReviewCycle & { assignments: Pick<PeerReviewAssignment, 'submitted_at'>[] }

/** HR: every quarter's peer reviews, and setting up a new one. */
export function PeerCycles() {
  const navigate = useNavigate()
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ quarter: '', due: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('peer_review_cycles')
      .select('*, assignments:peer_review_assignments(submitted_at)')
    if (loadError) setError(loadError.message)
    else setCycles((data as unknown as CycleRow[]).sort((a, b) => b.year - a.year || b.quarter - a.quarter))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const now = quarterOf()
  const key = (q: { year: number; quarter: number }) => `${q.year}-${q.quarter}`
  const offered = [now, nextQuarter(now)].filter((q) => !cycles.some((c) => key(c) === key(q)))
  const missingNow = !loading && !cycles.some((c) => key(c) === key(now))

  function openCreate() {
    setForm({ quarter: offered[0] ? key(offered[0]) : '', due: defaultDueDate() })
    setFormError(null)
    setCreating(true)
  }

  async function create() {
    const [year, quarter] = form.quarter.split('-').map(Number)
    if (!form.quarter || !form.due) return setFormError('Pick a quarter and a due date.')
    if (form.due < todayIso()) return setFormError('Pick a due date, today or later.')
    setBusy(true)
    const { data, error: createError } = await supabase.rpc('peer_cycle_create', {
      p_year: year,
      p_quarter: quarter,
      p_due_date: form.due,
    })
    setBusy(false)
    if (createError) return setFormError(peerError(createError))
    navigate(`/performance/cycles/${data as string}`)
  }

  return (
    <Stack spacing={2}>
      {missingNow && (
        <Alert severity="warning" action={<Button color="inherit" size="small" onClick={openCreate}>Set up</Button>}>
          No peer reviews set up for {cycleLabel(now)} yet. Each quarter needs one.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack direction="row" sx={{ p: 2, alignItems: 'center' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
            One round of peer reviews per quarter: pick who is reviewed and by whom.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={!offered.length}>
            Set up peer reviews
          </Button>
        </Stack>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Quarter</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Due</TableCell>
                <TableCell>Submitted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cycles.map((c) => (
                <TableRow
                  key={c.id}
                  hover
                  onClick={() => navigate(`/performance/cycles/${c.id}`)}
                  sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                >
                  <TableCell sx={{ fontWeight: 500 }}>{cycleLabel(c)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={PEER_CYCLE_STATUS_LABELS[c.status]} color={PEER_CYCLE_STATUS_COLORS[c.status]} />
                  </TableCell>
                  <TableCell>{formatDate(c.due_date)}</TableCell>
                  <TableCell>
                    {c.assignments.filter((a) => a.submitted_at).length} of {c.assignments.length}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !cycles.length && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    No peer reviews yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={creating}
        title="Set up peer reviews"
        submitLabel="Set up"
        error={formError}
        busy={busy}
        onSubmit={create}
        onClose={() => setCreating(false)}
      >
        <TextField
          select
          label="Quarter"
          required
          value={form.quarter}
          onChange={(e) => setForm((f) => ({ ...f, quarter: e.target.value }))}
        >
          {offered.map((q) => (
            <MenuItem key={key(q)} value={key(q)}>
              {cycleLabel(q)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          type="date"
          label="Due date"
          required
          value={form.due}
          onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          It starts as a draft with last quarter's questions. Add who is reviewed and by whom, then open it.
        </Typography>
      </FormDialog>
    </Stack>
  )
}

/**
 * What colleagues wrote about the signed-in person in closed quarters, as
 * my_peer_feedback gives it: no names, shuffled, only with enough responses.
 */
export function MyPeerFeedback() {
  const [responses, setResponses] = useState<Response[]>([])

  useEffect(() => {
    supabase.rpc('my_peer_feedback').then(({ data }) => setResponses((data ?? []) as Response[]))
  }, [])

  if (!responses.length) return null
  const cycles = [...new Map(responses.map((r) => [r.cycle_id, r])).values()]

  return (
    <Box component="section" aria-label="Peer feedback">
      <Typography variant="h6" component="h2" sx={{ mb: 0.5 }}>
        Peer feedback
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        What colleagues wrote about you, without their names. A quarter shows once it closes with at least{' '}
        {MIN_RESPONSES} responses.
      </Typography>
      <Stack spacing={2}>
        {cycles.map((c) => {
          const theirs = responses.filter((r) => r.cycle_id === c.cycle_id)
          const prompts = [...theirs[0].answers].sort((a, b) => a.sort_order - b.sort_order).map((a) => a.prompt)
          return (
            <Paper key={c.cycle_id} variant="outlined" component="section" aria-label={cycleLabel(c)} sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
                {cycleLabel(c)} · {theirs.length} responses
              </Typography>
              <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                {prompts.map((prompt) => {
                  const answers = theirs.map((r) => r.answers.find((a) => a.prompt === prompt)!).filter(Boolean)
                  const average = answers.reduce((s, a) => s + a.rating, 0) / answers.length
                  return (
                    <Box key={prompt}>
                      <Stack direction="row" spacing={2}>
                        <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: 500 }}>
                          {prompt}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {formatScore(average)} / 5
                        </Typography>
                      </Stack>
                      {answers
                        .filter((a) => a.comment)
                        .map((a, i) => (
                          <Typography key={i} variant="body2" sx={{ color: 'text.secondary', pl: 2 }}>
                            “{a.comment}”
                          </Typography>
                        ))}
                    </Box>
                  )
                })}
                {theirs.some((r) => r.open_feedback) && (
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      In their words
                    </Typography>
                    {theirs
                      .filter((r) => r.open_feedback)
                      .map((r) => (
                        <Typography key={r.response} variant="body2" sx={{ color: 'text.secondary', pl: 2, whiteSpace: 'pre-wrap' }}>
                          “{r.open_feedback}”
                        </Typography>
                      ))}
                  </Box>
                )}
              </Stack>
            </Paper>
          )
        })}
      </Stack>
    </Box>
  )
}
