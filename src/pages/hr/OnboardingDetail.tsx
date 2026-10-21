import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  LinearProgress,
  Link as MuiLink,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import { supabase } from '../../lib/supabase'
import {
  ONBOARDING_STATUS_COLORS,
  ONBOARDING_STATUS_LABELS,
  formatDate,
  formatDayTime,
} from '../../lib/constants'
import {
  ONBOARDING_WITH_EMPLOYEE,
  bySection,
  isOverdue,
  onboardingError,
  progressOf,
  type OnboardingWithEmployee,
} from '../../lib/onboarding'
import type { DirectoryEntry, OnboardingTask } from '../../lib/types'

// One new hire's onboarding (HR): their checklist, ticked off task by task,
// then completed or cancelled (with a reason). No task is required. Every
// change goes through an RPC; once closed, the checklist is read-only.
export default function OnboardingDetail() {
  const { id = '' } = useParams()
  const [onboarding, setOnboarding] = useState<OnboardingWithEmployee | null>(null)
  const [tasks, setTasks] = useState<OnboardingTask[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [closing, setClosing] = useState<'complete' | 'cancel' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [onboardingRes, tasksRes] = await Promise.all([
      supabase.from('onboardings').select(ONBOARDING_WITH_EMPLOYEE).eq('id', id).maybeSingle(),
      supabase.from('onboarding_tasks').select('*').eq('onboarding_id', id),
    ])
    const loadError = onboardingRes.error ?? tasksRes.error
    if (loadError) setError(loadError.message)
    else {
      setOnboarding(onboardingRes.data as unknown as OnboardingWithEmployee | null)
      setTasks(tasksRes.data as OnboardingTask[])
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
    supabase
      .from('employee_directory')
      .select('*')
      .then(({ data }) => setPeople((data ?? []) as DirectoryEntry[]))
  }, [load])

  const nameOf = (who: string | null) => people.find((p) => p.id === who)?.full_name ?? 'Someone'

  async function toggle(task: OnboardingTask) {
    setPending(task.id)
    setError(null)
    const { error: taskError } = await supabase.rpc('onboarding_task_set', {
      p_task_id: task.id,
      p_done: !task.done_at,
    })
    if (taskError) setError(onboardingError(taskError))
    await load()
    setPending(null)
  }

  async function close() {
    if (!onboarding || !closing) return
    if (closing === 'cancel' && !reason.trim()) return
    setBusy(true)
    setError(null)
    const { error: closeError } =
      closing === 'complete'
        ? await supabase.rpc('onboarding_complete', { p_onboarding_id: onboarding.id })
        : await supabase.rpc('onboarding_cancel', { p_onboarding_id: onboarding.id, p_reason: reason.trim() })
    setBusy(false)
    setClosing(null)
    setReason('')
    if (closeError) setError(onboardingError(closeError))
    await load()
  }

  if (loading) return <LinearProgress />
  if (!onboarding) {
    return (
      <>
        <PageHeader title="Onboarding" back="/hr/onboarding" />
        <Alert severity={error ? 'error' : 'warning'}>{error ?? 'This onboarding doesn’t exist.'}</Alert>
      </>
    )
  }

  const name = onboarding.employee?.full_name ?? 'Unknown'
  const inProgress = onboarding.status === 'in_progress'
  const progress = progressOf(tasks)
  const left = progress.total - progress.done

  return (
    <>
      <PageHeader
        title={name}
        subtitle={
          <>
            Joining {formatDate(onboarding.employee?.date_of_joining ?? null)} · Due {formatDate(onboarding.due_date)}
            {' · '}
            <MuiLink component={Link} to={`/employees/${onboarding.employee_id}`}>
              Employee record
            </MuiLink>
          </>
        }
        back="/hr/onboarding"
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {isOverdue(onboarding) && <Chip label="Overdue" color="error" size="small" />}
            <Chip
              label={ONBOARDING_STATUS_LABELS[onboarding.status]}
              color={ONBOARDING_STATUS_COLORS[onboarding.status]}
              variant="outlined"
            />
            {inProgress && (
              <>
                <Button color="error" onClick={() => setClosing('cancel')}>
                  Cancel onboarding
                </Button>
                <Button variant="contained" onClick={() => setClosing('complete')}>
                  Complete onboarding
                </Button>
              </>
            )}
          </Stack>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {onboarding.status === 'completed' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Completed by {nameOf(onboarding.completed_by)} on {formatDayTime(onboarding.completed_at ?? '')}.
        </Alert>
      )}
      {onboarding.status === 'cancelled' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Cancelled by {nameOf(onboarding.cancelled_by)} on {formatDayTime(onboarding.cancelled_at ?? '')}:{' '}
          {onboarding.cancel_reason}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
          <LinearProgress
            variant="determinate"
            value={progress.percent}
            aria-label="Progress"
            sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
          />
          <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
            {progress.done} of {progress.total} done
          </Typography>
        </Stack>
      </Paper>

      {!tasks.length && (
        <Paper variant="outlined" sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
          The onboarding checklist was empty when this onboarding started.
        </Paper>
      )}

      <Stack spacing={2}>
        {bySection(tasks).map((section) => (
          <Paper key={section.name} variant="outlined" component="section" aria-label={section.name} sx={{ p: 2 }}>
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>
              {section.name}
            </Typography>
            <Stack>
              {section.tasks.map((t) => (
                <Box key={t.id}>
                  <FormControlLabel
                    label={t.title}
                    disabled={!inProgress || pending !== null}
                    control={<Checkbox checked={!!t.done_at} onChange={() => toggle(t)} />}
                    sx={{ '& .MuiFormControlLabel-label': { textDecoration: t.done_at ? 'line-through' : undefined } }}
                  />
                  {t.done_at && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                      {nameOf(t.done_by)} · {formatDayTime(t.done_at)}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </Paper>
        ))}
      </Stack>

      <ConfirmDialog
        open={closing === 'complete'}
        title="Complete onboarding?"
        message={
          left
            ? `${left} of ${progress.total} tasks aren’t ticked off. ${name}’s onboarding will be marked complete anyway, and its checklist can’t be changed after.`
            : `${name}’s onboarding will be marked complete, and its checklist can’t be changed after.`
        }
        confirmLabel="Complete"
        busy={busy}
        onConfirm={close}
        onClose={() => setClosing(null)}
      />
      <FormDialog
        open={closing === 'cancel'}
        title="Cancel onboarding?"
        submitLabel="Cancel onboarding"
        busy={busy}
        onSubmit={close}
        onClose={() => setClosing(null)}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {name}’s onboarding will be closed as cancelled, and its checklist can’t be changed after. Their employee
          record stays as it is.
        </Typography>
        <TextField
          label="Reason"
          required
          multiline
          minRows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
          fullWidth
        />
      </FormDialog>
    </>
  )
}
