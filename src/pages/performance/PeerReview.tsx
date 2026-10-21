import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDay } from '../../lib/constants'
import {
  ASSIGNMENT_WITH_ANSWERS,
  PEER_STATE_COLORS,
  PEER_STATE_LABELS,
  cycleLabel,
  peerError,
  peerState,
  type AssignmentWithAnswers,
} from '../../lib/peerReviews'
import type { DirectoryEntry, PeerReviewAnswer, PeerReviewCycle, PeerReviewQuestion } from '../../lib/types'
import { ConfirmDialog, PageHeader } from '../../components/common'

const RATING_HINT = '1 strongly disagree · 2 disagree · 3 neutral · 4 agree · 5 strongly agree'

const answerFields = (a: PeerReviewAnswer) => ({ rating: a.rating, comment: a.comment?.trim() ? a.comment : null })
const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b)
const blankToNull = (s: string | null) => (s?.trim() ? s : null)

// One peer review form: the reviewer fills it in while the cycle is open and
// submits it (final); HR reads it. RLS decides who gets it at all.
export default function PeerReview() {
  const { id } = useParams()
  const { employee } = useAuth()
  const me = employee!.id
  const [saved, setSaved] = useState<AssignmentWithAnswers | null>(null)
  const [draft, setDraft] = useState<AssignmentWithAnswers | null>(null)
  const [cycle, setCycle] = useState<PeerReviewCycle | null>(null)
  const [questions, setQuestions] = useState<PeerReviewQuestion[]>([])
  const [people, setPeople] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('peer_review_assignments')
      .select(ASSIGNMENT_WITH_ANSWERS)
      .eq('id', id!)
      .maybeSingle()
    if (loadError || !data) {
      setError(loadError ? loadError.message : 'Peer review not found.')
      setLoading(false)
      return
    }
    const assignment = data as unknown as AssignmentWithAnswers
    const [cycleRes, questionsRes, peopleRes] = await Promise.all([
      supabase.from('peer_review_cycles').select('*').eq('id', assignment.cycle_id).single(),
      supabase.from('peer_review_questions').select('*').eq('cycle_id', assignment.cycle_id).order('sort_order'),
      supabase
        .from('employee_directory')
        .select('id, full_name')
        .in('id', [assignment.subject_id, assignment.reviewer_id]),
    ])
    const failure = cycleRes.error ?? questionsRes.error ?? peopleRes.error
    if (failure) setError(failure.message)
    else {
      const order = new Map((questionsRes.data as PeerReviewQuestion[]).map((q) => [q.id, q.sort_order]))
      const sorted = {
        ...assignment,
        answers: [...assignment.answers].sort((a, b) => (order.get(a.question_id) ?? 0) - (order.get(b.question_id) ?? 0)),
      }
      setCycle(cycleRes.data as PeerReviewCycle)
      setQuestions(questionsRes.data as PeerReviewQuestion[])
      setPeople(new Map((peopleRes.data as Pick<DirectoryEntry, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name])))
      setSaved(sorted)
      setDraft(sorted)
      setError(null)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <LinearProgress />
  if (!draft || !saved || !cycle) return <Alert severity="error">{error}</Alert>

  const mine = draft.reviewer_id === me
  const editable = mine && cycle.status === 'open' && !draft.submitted_at
  const subject = people.get(draft.subject_id) ?? 'Employee'
  const firstName = subject.split(/\s+/)[0]
  const prompt = (questionId: string) => questions.find((q) => q.id === questionId)?.prompt ?? ''
  const dirty =
    blankToNull(draft.open_feedback) !== blankToNull(saved.open_feedback) ||
    draft.answers.some((a, i) => !same(answerFields(a), answerFields(saved.answers[i])))
  const setAnswer = (i: number, change: Partial<PeerReviewAnswer>) =>
    setDraft((d) => d && { ...d, answers: d.answers.map((a, j) => (j === i ? { ...a, ...change } : a)) })
  const state = peerState(draft, cycle)

  async function save() {
    const writes = []
    if (blankToNull(draft!.open_feedback) !== blankToNull(saved!.open_feedback))
      writes.push(() =>
        supabase.from('peer_review_assignments').update({ open_feedback: blankToNull(draft!.open_feedback) }).eq('id', draft!.id),
      )
    draft!.answers.forEach((a, i) => {
      if (!same(answerFields(a), answerFields(saved!.answers[i])))
        writes.push(() => supabase.from('peer_review_answers').update(answerFields(a)).eq('id', a.id))
    })
    for (const write of writes) {
      const { error: saveError } = await write()
      if (saveError) {
        setError(peerError(saveError))
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

  function askToSubmit() {
    setError(null)
    setNotice(null)
    const unrated = draft!.answers.some((a) => a.rating == null)
    setMissing(unrated)
    if (!unrated) setConfirming(true)
  }

  async function submit() {
    setConfirming(false)
    setBusy('submit')
    if (await save()) {
      const { error: submitError } = await supabase.rpc('peer_review_submit', { p_assignment_id: draft!.id })
      if (submitError) setError(peerError(submitError))
      else {
        setNotice('Submitted. Thank you.')
        await load()
      }
    }
    setBusy(null)
  }

  return (
    <>
      <PageHeader
        title={`Peer review of ${subject}`}
        subtitle={`${cycleLabel(cycle)} · Due ${formatDate(cycle.due_date)}${mine ? '' : ` · by ${people.get(draft.reviewer_id) ?? 'someone no longer here'}`}`}
        back={mine ? '/performance?tab=peer' : `/performance/cycles/${cycle.id}`}
        actions={<Chip size="small" label={PEER_STATE_LABELS[state]} color={PEER_STATE_COLORS[state]} variant="outlined" />}
      />

      <Stack spacing={3}>
        {mine && (
          <Alert severity="info" variant="outlined">
            {firstName} reads your answers without your name once the cycle closes, together with the others'. HR
            sees them with your name.
            {draft.submitted_at && ` You submitted this on ${formatDay(draft.submitted_at)}; it can't be changed.`}
            {!draft.submitted_at && cycle.status === 'closed' && ' The cycle closed before this was submitted.'}
          </Alert>
        )}

        <Paper variant="outlined" component="section" aria-label="Questions" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
            Questions
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            How much do you agree? {editable && RATING_HINT}
          </Typography>
          <Stack spacing={2.5} divider={<Divider flexItem />} sx={{ mt: 2 }}>
            {draft.answers.map((a, i) => (
              <Box key={a.id} component="section" aria-label={prompt(a.question_id)}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                  <Typography sx={{ flexGrow: 1, fontWeight: 500 }}>{prompt(a.question_id)}</Typography>
                  {editable ? (
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={a.rating}
                      onChange={(_, value: number | null) => value != null && setAnswer(i, { rating: value })}
                      aria-label={`Rating for ${prompt(a.question_id)}`}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <ToggleButton key={n} value={n} sx={{ width: 40 }}>
                          {n}
                        </ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                  ) : (
                    <Typography variant="h6" component="p" sx={{ flexShrink: 0 }}>
                      {a.rating ?? '—'}
                      <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
                        {' '}/ 5
                      </Typography>
                    </Typography>
                  )}
                </Stack>
                {editable ? (
                  <TextField
                    label="Comment"
                    fullWidth
                    multiline
                    value={a.comment ?? ''}
                    onChange={(e) => setAnswer(i, { comment: e.target.value })}
                    slotProps={{ htmlInput: { maxLength: 2000 } }}
                    sx={{ mt: 1.5 }}
                  />
                ) : (
                  a.comment && (
                    <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {a.comment}
                    </Typography>
                  )
                )}
              </Box>
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" component="section" aria-label="Open feedback" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: editable ? 2 : 1 }}>
            Open feedback
          </Typography>
          {editable ? (
            <TextField
              label="Anything else"
              fullWidth
              multiline
              minRows={4}
              helperText={`What ${firstName} does well, and what would help them grow`}
              value={draft.open_feedback ?? ''}
              onChange={(e) => setDraft((d) => d && { ...d, open_feedback: e.target.value })}
              slotProps={{ htmlInput: { maxLength: 5000 } }}
            />
          ) : (
            <Typography
              variant="body2"
              sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: draft.open_feedback ? undefined : 'text.secondary' }}
            >
              {draft.open_feedback || '—'}
            </Typography>
          )}
        </Paper>

        {missing && <Alert severity="warning">Rate every question before submitting.</Alert>}
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {notice && <Alert severity="success">{notice}</Alert>}

        {editable && (
          <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={saveDraft} loading={busy === 'save'} disabled={!dirty || !!busy}>
              Save draft
            </Button>
            <Button variant="contained" onClick={askToSubmit} loading={busy === 'submit'} disabled={!!busy}>
              Submit
            </Button>
          </Stack>
        )}
      </Stack>

      <ConfirmDialog
        open={confirming}
        title="Submit this peer review?"
        message={`Once submitted it can't be changed. ${firstName} reads it without your name after the cycle closes.`}
        confirmLabel="Submit"
        onConfirm={submit}
        onClose={() => setConfirming(false)}
      />
    </>
  )
}
