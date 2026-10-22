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
  FEEDBACK_STATE_COLORS,
  FEEDBACK_STATE_LABELS,
  FEEDBACK_WITH_ANSWERS,
  feedbackState,
  feedbackWindow,
  managerFeedbackError,
  quarterName,
  type FeedbackWithAnswers,
} from '../../lib/managerFeedback'
import type { DirectoryEntry, ManagerFeedbackAnswer } from '../../lib/types'
import { ConfirmDialog, PageHeader } from '../../components/common'

const RATING_HINT = '1 strongly disagree · 2 disagree · 3 neutral · 4 agree · 5 strongly agree'
const blankToNull = (s: string | null) => (s?.trim() ? s : null)

// One quarter's feedback on a manager: the employee fills it in until the
// quarter ends and submits it (final); HR reads it. RLS decides who gets it.
export default function ManagerFeedbackForm() {
  const { id } = useParams()
  const { employee } = useAuth()
  const me = employee!.id
  const [saved, setSaved] = useState<FeedbackWithAnswers | null>(null)
  const [draft, setDraft] = useState<FeedbackWithAnswers | null>(null)
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('manager_feedback')
      .select(FEEDBACK_WITH_ANSWERS)
      .eq('id', id!)
      .maybeSingle()
    if (loadError || !data) {
      setError(loadError ? loadError.message : 'Feedback not found.')
      setLoading(false)
      return
    }
    const form = data as unknown as FeedbackWithAnswers
    const sorted = { ...form, answers: [...form.answers].sort((a, b) => a.sort_order - b.sort_order) }
    const ids = [form.employee_id, form.manager_id].filter((x): x is string => !!x)
    const { data: people } = await supabase.from('employee_directory').select('id, full_name').in('id', ids)
    setNames(new Map(((people ?? []) as Pick<DirectoryEntry, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name])))
    setSaved(sorted)
    setDraft(sorted)
    setError(null)
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <LinearProgress />
  if (!draft || !saved) return <Alert severity="error">{error}</Alert>

  const period = feedbackWindow(draft.year, draft.quarter)
  const state = feedbackState(draft, period)
  const mine = draft.employee_id === me
  const editable = mine && !draft.submitted_at && state !== 'missed'
  const manager = (draft.manager_id && names.get(draft.manager_id)) || 'your manager'
  const dirty =
    blankToNull(draft.body) !== blankToNull(saved.body) ||
    draft.answers.some((a, i) => a.rating !== saved.answers[i].rating)
  const setRating = (i: number, rating: number) =>
    setDraft((d) => d && { ...d, answers: d.answers.map((a, j) => (j === i ? { ...a, rating } : a)) })

  async function save() {
    const writes = []
    if (blankToNull(draft!.body) !== blankToNull(saved!.body))
      writes.push(() => supabase.from('manager_feedback').update({ body: blankToNull(draft!.body) }).eq('id', draft!.id))
    draft!.answers.forEach((a: ManagerFeedbackAnswer, i) => {
      if (a.rating !== saved!.answers[i].rating)
        writes.push(() => supabase.from('manager_feedback_answers').update({ rating: a.rating }).eq('id', a.id))
    })
    for (const write of writes) {
      const { error: saveError } = await write()
      if (saveError) {
        setError(managerFeedbackError(saveError))
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
      const { error: submitError } = await supabase.rpc('manager_feedback_submit', { p_feedback_id: draft!.id })
      if (submitError) setError(managerFeedbackError(submitError))
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
        title={mine ? `Feedback on ${manager}` : `${names.get(draft.employee_id) ?? 'Employee'}'s feedback on ${manager}`}
        subtitle={`${quarterName(draft)} · Due ${formatDate(period.due)}`}
        back={mine ? '/performance' : '/performance?tab=manager'}
        actions={<Chip size="small" label={FEEDBACK_STATE_LABELS[state]} color={FEEDBACK_STATE_COLORS[state]} variant="outlined" />}
      />

      <Stack spacing={3}>
        {mine && (
          <Alert severity="info" variant="outlined">
            Only HR reads this, with your name. {manager === 'your manager' ? 'Your manager' : manager} never sees it.
            {draft.submitted_at && ` You submitted it on ${formatDay(draft.submitted_at)}; it can't be changed.`}
            {!draft.submitted_at && state === 'missed' && ` ${quarterName(draft)} ended before it was submitted.`}
            {editable && ` It's due ${formatDate(period.due)}, and can be submitted late until ${formatDate(period.closes)}.`}
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
              <Stack
                key={a.id}
                component="section"
                aria-label={a.prompt}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                sx={{ alignItems: { sm: 'center' } }}
              >
                <Typography sx={{ flexGrow: 1, fontWeight: 500 }}>{a.prompt}</Typography>
                {editable ? (
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={a.rating}
                    onChange={(_, value: number | null) => value != null && setRating(i, value)}
                    aria-label={`Rating for ${a.prompt}`}
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
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" component="section" aria-label="Feedback" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: editable ? 2 : 1 }}>
            Feedback
          </Typography>
          {editable ? (
            <TextField
              label="Your feedback"
              fullWidth
              multiline
              minRows={4}
              helperText="What your manager does well, and what would help you more"
              value={draft.body ?? ''}
              onChange={(e) => setDraft((d) => d && { ...d, body: e.target.value })}
              slotProps={{ htmlInput: { maxLength: 5000 } }}
            />
          ) : (
            <Box>
              <Typography
                variant="body2"
                sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: draft.body ? undefined : 'text.secondary' }}
              >
                {draft.body || '—'}
              </Typography>
            </Box>
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
        title="Submit your feedback?"
        message={`Once submitted it can't be changed. Only HR reads it; ${manager} never sees it.`}
        confirmLabel="Submit"
        onConfirm={submit}
        onClose={() => setConfirming(false)}
      />
    </>
  )
}
