import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/constants'
import {
  ASSIGNMENT_WITH_ANSWERS,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  PEER_CYCLE_STATUS_COLORS,
  PEER_CYCLE_STATUS_LABELS,
  PEER_STATE_COLORS,
  PEER_STATE_LABELS,
  averages,
  cycleLabel,
  peerError,
  peerState,
  type AssignmentWithAnswers,
} from '../../lib/peerReviews'
import { formatScore } from '../../lib/performance'
import type { DirectoryEntry, PeerReviewCycle, PeerReviewQuestion } from '../../lib/types'
import { ConfirmDialog, PageHeader, PersonAvatar } from '../../components/common'

type Person = Pick<DirectoryEntry, 'id' | 'full_name' | 'designation' | 'status'>
const LOGIN_STATUSES = ['probation', 'active', 'notice_period']

// Picks one person; clears itself after each pick.
function PersonPicker({ label, options, onPick }: { label: string; options: Person[]; onPick: (p: Person) => void }) {
  const [input, setInput] = useState('')
  return (
    <Autocomplete
      options={options}
      value={null}
      inputValue={input}
      onInputChange={(_e, value, reason) => setInput(reason === 'reset' ? '' : value)}
      onChange={(_e, p) => {
        if (p) onPick(p)
        setInput('')
      }}
      getOptionLabel={(p) => p.full_name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      renderOption={({ key, ...props }, p) => (
        <li key={key} {...props}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <PersonAvatar name={p.full_name} size={28} />
            <Box>
              <Typography variant="body2">{p.full_name}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {p.designation ?? 'No designation'}
              </Typography>
            </Box>
          </Stack>
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={label} />}
      sx={{ minWidth: 260 }}
    />
  )
}

type Confirm = 'open' | 'close' | 'delete'

// One quarter's peer reviews, for HR: due date, questions (while a draft),
// who reviews whom, opening and closing, and every response with its
// reviewer's name. HR never appears here as a subject.
export default function PeerCycle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { employee } = useAuth()
  const me = employee!.id
  const [cycle, setCycle] = useState<PeerReviewCycle | null>(null)
  const [questions, setQuestions] = useState<PeerReviewQuestion[]>([])
  const [assignments, setAssignments] = useState<AssignmentWithAnswers[]>([])
  const [people, setPeople] = useState<Person[]>([])
  // People picked to be reviewed who don't have a reviewer yet (not saved until they do).
  const [pending, setPending] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [due, setDue] = useState('')
  const [newQuestion, setNewQuestion] = useState('')
  const [editing, setEditing] = useState<{ id: string; prompt: string } | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const [cycleRes, questionsRes, assignmentsRes, peopleRes] = await Promise.all([
      supabase.from('peer_review_cycles').select('*').eq('id', id!).maybeSingle(),
      supabase.from('peer_review_questions').select('*').eq('cycle_id', id!).order('sort_order'),
      supabase.from('peer_review_assignments').select(ASSIGNMENT_WITH_ANSWERS).eq('cycle_id', id!),
      supabase.from('employee_directory').select('id, full_name, designation, status').order('full_name'),
    ])
    const failure = cycleRes.error ?? questionsRes.error ?? assignmentsRes.error ?? peopleRes.error
    if (failure || !cycleRes.data) setError(failure ? failure.message : 'Peer review cycle not found.')
    else {
      setCycle(cycleRes.data as PeerReviewCycle)
      setDue((cycleRes.data as PeerReviewCycle).due_date)
      setQuestions(questionsRes.data as PeerReviewQuestion[])
      setAssignments(assignmentsRes.data as unknown as AssignmentWithAnswers[])
      setPeople(peopleRes.data as Person[])
      setError(null)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const nameOf = useMemo(() => {
    const names = new Map(people.map((p) => [p.id, p.full_name]))
    return (who: string) => names.get(who) ?? 'Someone no longer here'
  }, [people])

  if (loading) return <LinearProgress />
  if (!cycle) return <Alert severity="error">{error}</Alert>

  const draft = cycle.status === 'draft'
  const closed = cycle.status === 'closed'
  const eligible = people.filter((p) => LOGIN_STATUSES.includes(p.status))
  const subjects = [...new Set([...assignments.map((a) => a.subject_id), ...pending])].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b)),
  )
  const submitted = assignments.filter((a) => a.submitted_at).length

  // Every write here reloads the page from the database afterwards.
  async function run(write: PromiseLike<{ error: { code?: string; message: string } | null }>) {
    setBusy(true)
    setError(null)
    const { error: writeError } = await write
    setBusy(false)
    if (writeError) {
      setError(peerError(writeError))
      return false
    }
    await load()
    return true
  }

  async function addQuestion() {
    if (!newQuestion.trim()) return
    if (await run(supabase.from('peer_review_questions').insert({ cycle_id: cycle!.id, prompt: newQuestion.trim() })))
      setNewQuestion('')
  }

  async function addReviewer(subjectId: string, reviewer: Person) {
    if (await run(supabase.from('peer_review_assignments').insert({ cycle_id: cycle!.id, subject_id: subjectId, reviewer_id: reviewer.id })))
      setPending((p) => p.filter((s) => s !== subjectId))
  }

  async function act() {
    const action = confirm
    setConfirm(null)
    if (action === 'delete') {
      if (await run(supabase.from('peer_review_cycles').delete().eq('id', cycle!.id))) navigate('/performance?tab=cycles')
      return
    }
    await run(supabase.rpc(action === 'open' ? 'peer_cycle_open' : 'peer_cycle_close', { p_cycle_id: cycle!.id }))
  }

  const CONFIRM: Record<Confirm, { title: string; message: string; label: string }> = {
    open: {
      title: `Open ${cycleLabel(cycle)} peer reviews?`,
      message: `Every reviewer gets their forms, due ${formatDate(cycle.due_date)}. The questions can't change after this; reviewers can still be added.`,
      label: 'Open',
    },
    close: {
      title: `Close ${cycleLabel(cycle)} peer reviews?`,
      message: `Forms not submitted by now are missed. Each person then reads what was written about them, without names, if at least two reviewers submitted.`,
      label: 'Close',
    },
    delete: { title: 'Delete this draft?', message: 'Its questions and reviewers go too.', label: 'Delete' },
  }

  return (
    <>
      <PageHeader
        title={`Peer reviews ${cycleLabel(cycle)}`}
        subtitle={`Due ${formatDate(cycle.due_date)} · ${submitted} of ${assignments.length} submitted`}
        back="/performance?tab=cycles"
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip size="small" label={PEER_CYCLE_STATUS_LABELS[cycle.status]} color={PEER_CYCLE_STATUS_COLORS[cycle.status]} />
            {draft && (
              <>
                <Button color="error" onClick={() => setConfirm('delete')}>
                  Delete
                </Button>
                <Button variant="contained" onClick={() => setConfirm('open')}>
                  Open cycle
                </Button>
              </>
            )}
            {cycle.status === 'open' && (
              <Button variant="contained" onClick={() => setConfirm('close')}>
                Close cycle
              </Button>
            )}
          </Stack>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack spacing={3}>
        {!closed && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <TextField
                type="date"
                label="Due date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Button
                disabled={!due || due === cycle.due_date || busy}
                onClick={() => run(supabase.from('peer_review_cycles').update({ due_date: due }).eq('id', cycle.id))}
              >
                Save date
              </Button>
            </Stack>
          </Paper>
        )}

        <Paper variant="outlined" component="section" aria-label="Questions" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
            Questions
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
            Each rated 1–5 with an optional comment, then open feedback. {MIN_QUESTIONS} to {MAX_QUESTIONS} questions
            {draft ? '; they can be changed until the cycle opens.' : '.'}
          </Typography>
          <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
            {questions.map((q) => (
              <Box component="li" key={q.id} sx={{ py: 0.5 }}>
                {editing?.id === q.id ? (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TextField
                      label="Question"
                      fullWidth
                      autoFocus
                      value={editing.prompt}
                      onChange={(e) => setEditing({ id: q.id, prompt: e.target.value })}
                      slotProps={{ htmlInput: { maxLength: 500 } }}
                    />
                    <Button onClick={() => setEditing(null)}>Cancel</Button>
                    <Button
                      variant="contained"
                      disabled={!editing.prompt.trim()}
                      onClick={async () => {
                        if (await run(supabase.from('peer_review_questions').update({ prompt: editing.prompt.trim() }).eq('id', q.id)))
                          setEditing(null)
                      }}
                    >
                      Save
                    </Button>
                  </Stack>
                ) : (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ flexGrow: 1 }}>
                      {q.prompt}
                    </Typography>
                    {draft && (
                      <>
                        <IconButton size="small" aria-label={`Edit ${q.prompt}`} onClick={() => setEditing({ id: q.id, prompt: q.prompt })}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label={`Delete ${q.prompt}`}
                          onClick={() => run(supabase.from('peer_review_questions').delete().eq('id', q.id))}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </Stack>
                )}
              </Box>
            ))}
          </Box>
          {draft && questions.length < MAX_QUESTIONS && (
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center' }}>
              <TextField
                label="New question"
                placeholder="e.g. Shares knowledge with the team."
                fullWidth
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
              <Button startIcon={<AddIcon />} onClick={addQuestion} disabled={!newQuestion.trim() || busy}>
                Add
              </Button>
            </Stack>
          )}
        </Paper>

        <Box component="section" aria-label="People">
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap', rowGap: 1.5 }}>
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
              People reviewed
            </Typography>
            {!closed && (
              <PersonPicker
                label="Add a person to review"
                options={eligible.filter((p) => p.id !== me && !subjects.includes(p.id))}
                onPick={(p) => setPending((list) => [...list, p.id])}
              />
            )}
          </Stack>
          <Stack spacing={2}>
            {subjects.map((subjectId) => {
              const theirs = assignments
                .filter((a) => a.subject_id === subjectId)
                .sort((a, b) => nameOf(a.reviewer_id).localeCompare(nameOf(b.reviewer_id)))
              const done = theirs.filter((a) => a.submitted_at)
              const showing = open.has(subjectId)
              return (
                <Paper key={subjectId} variant="outlined" component="section" aria-label={nameOf(subjectId)} sx={{ p: 2 }}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                    <PersonAvatar name={nameOf(subjectId)} size={32} />
                    <Typography sx={{ fontWeight: 500, flexGrow: 1 }}>{nameOf(subjectId)}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {theirs.length ? `${done.length} of ${theirs.length} submitted` : 'Add at least one reviewer'}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
                    {theirs.map((a) => {
                      const state = peerState(a, cycle)
                      return (
                        <Chip
                          key={a.id}
                          label={`${nameOf(a.reviewer_id)} · ${PEER_STATE_LABELS[state]}`}
                          color={PEER_STATE_COLORS[state]}
                          variant="outlined"
                          onDelete={
                            !closed && !a.submitted_at
                              ? () => run(supabase.from('peer_review_assignments').delete().eq('id', a.id))
                              : undefined
                          }
                        />
                      )
                    })}
                    {!closed && (
                      <PersonPicker
                        label="Add reviewer"
                        options={eligible.filter((p) => p.id !== subjectId && !theirs.some((a) => a.reviewer_id === p.id))}
                        onPick={(p) => addReviewer(subjectId, p)}
                      />
                    )}
                  </Stack>
                  {done.length > 0 && (
                    <>
                      <Button
                        size="small"
                        sx={{ mt: 1 }}
                        onClick={() =>
                          setOpen((s) => {
                            const next = new Set(s)
                            if (next.has(subjectId)) next.delete(subjectId)
                            else next.add(subjectId)
                            return next
                          })
                        }
                      >
                        {showing ? 'Hide responses' : `Show responses (${done.length})`}
                      </Button>
                      {showing && (
                        <Box sx={{ mt: 1 }}>
                          {averages(questions, done.flatMap((a) => a.answers)).map((q) => (
                            <Box key={q.id} sx={{ py: 1 }}>
                              <Stack direction="row" spacing={2}>
                                <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: 500 }}>
                                  {q.prompt}
                                </Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                  {formatScore(q.average)} / 5
                                </Typography>
                              </Stack>
                              {done.map((a) => {
                                const answer = a.answers.find((x) => x.question_id === q.id)
                                return (
                                  answer?.comment && (
                                    <Typography key={a.id} variant="body2" sx={{ color: 'text.secondary', pl: 2 }}>
                                      {nameOf(a.reviewer_id)} ({answer.rating}): {answer.comment}
                                    </Typography>
                                  )
                                )
                              })}
                            </Box>
                          ))}
                          <Divider sx={{ my: 1 }} />
                          {done.map((a) => (
                            <Typography key={a.id} variant="body2" sx={{ py: 0.5, whiteSpace: 'pre-wrap' }}>
                              <Link component={RouterLink} to={`/performance/peer/${a.id}`}>
                                {nameOf(a.reviewer_id)}
                              </Link>
                              : {a.open_feedback || '—'}
                            </Typography>
                          ))}
                        </Box>
                      )}
                    </>
                  )}
                </Paper>
              )
            })}
            {!subjects.length && (
              <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">Nobody added yet. Add a person, then who reviews them.</Typography>
              </Paper>
            )}
          </Stack>
        </Box>
      </Stack>

      {confirm && (
        <ConfirmDialog
          open
          title={CONFIRM[confirm].title}
          message={CONFIRM[confirm].message}
          confirmLabel={CONFIRM[confirm].label}
          destructive={confirm === 'delete'}
          onConfirm={act}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}
