import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
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
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlineOutlined'
import { useAuth } from '../../auth/AuthProvider'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import { supabase } from '../../lib/supabase'
import {
  OFFBOARDING_REASON_LABELS,
  ONBOARDING_STATUS_COLORS,
  ONBOARDING_STATUS_LABELS,
  STATUS_LABELS,
  formatDate,
  formatDayTime,
} from '../../lib/constants'
import { bySection, progressOf } from '../../lib/onboarding'
import { offboardingError, signOffOf, type SignOffStep } from '../../lib/offboarding'
import type { DirectoryEntry, Offboarding, OffboardingReason, OffboardingTask } from '../../lib/types'

const ICONS: Record<SignOffStep, ReactElement> = {
  done: <CheckCircleIcon fontSize="small" color="success" />,
  waiting: <HourglassEmptyIcon fontSize="small" color="disabled" />,
  not_needed: <RemoveCircleOutlineIcon fontSize="small" color="disabled" />,
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2">{children}</Typography>
    </Box>
  )
}

// One person's offboarding (HR, and their manager): the checklist, ticked off
// by either; the reason and last working day, set by HR; and sign-off by HR
// and the manager once it's all done. The last sign-off completes it and marks
// the employee as left. Every change goes through an RPC.
export default function OffboardingDetail() {
  const { id = '' } = useParams()
  const { employee, isHr } = useAuth()
  const me = employee!.id
  const [offboarding, setOffboarding] = useState<Offboarding | null>(null)
  const [tasks, setTasks] = useState<OffboardingTask[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [managerId, setManagerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'details' | 'sign' | 'cancel' | null>(null)
  const [details, setDetails] = useState<{ reason: OffboardingReason | ''; lastDay: string }>({ reason: '', lastDay: '' })
  const [cancelReason, setCancelReason] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [offboardingRes, tasksRes] = await Promise.all([
      supabase.from('offboardings').select('*').eq('id', id).maybeSingle(),
      supabase.from('offboarding_tasks').select('*').eq('offboarding_id', id),
    ])
    const loadError = offboardingRes.error ?? tasksRes.error
    if (loadError) setError(loadError.message)
    else {
      const row = offboardingRes.data as Offboarding | null
      setOffboarding(row)
      setTasks(tasksRes.data as OffboardingTask[])
      if (row) {
        const { data } = await supabase
          .from('org_chart_nodes')
          .select('manager_id')
          .eq('employee_id', row.employee_id)
          .maybeSingle()
        setManagerId(data?.manager_id ?? null)
      }
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

  async function toggle(task: OffboardingTask) {
    setPending(task.id)
    setError(null)
    const { error: taskError } = await supabase.rpc('offboarding_task_set', { p_task_id: task.id, p_done: !task.done_at })
    if (taskError) setError(offboardingError(taskError))
    await load()
    setPending(null)
  }

  function open(next: 'details' | 'sign' | 'cancel') {
    if (next === 'details' && offboarding)
      setDetails({ reason: offboarding.reason ?? '', lastDay: offboarding.last_working_day ?? '' })
    if (next === 'cancel') setCancelReason('')
    setDialogError(null)
    setDialog(next)
  }

  async function submit() {
    if (!offboarding || !dialog) return
    if (dialog === 'details' && (!details.reason || !details.lastDay)) return
    if (dialog === 'cancel' && !cancelReason.trim()) return
    setBusy(true)
    setDialogError(null)
    const { error: rpcError } =
      dialog === 'details'
        ? await supabase.rpc('offboarding_set_details', {
            p_offboarding_id: offboarding.id,
            p_reason: details.reason,
            p_last_working_day: details.lastDay,
          })
        : dialog === 'sign'
          ? await supabase.rpc('offboarding_sign_off', { p_offboarding_id: offboarding.id })
          : await supabase.rpc('offboarding_cancel', { p_offboarding_id: offboarding.id, p_reason: cancelReason.trim() })
    setBusy(false)
    if (rpcError) return setDialogError(offboardingError(rpcError))
    setDialog(null)
    await load()
  }

  if (loading) return <LinearProgress />
  if (!offboarding) {
    return (
      <>
        <PageHeader title="Offboarding" back="/hr/offboarding" />
        <Alert severity={error ? 'error' : 'warning'}>{error ?? 'This offboarding doesn’t exist.'}</Alert>
      </>
    )
  }

  const person = people.find((p) => p.id === offboarding.employee_id)
  const name = person?.full_name ?? 'Unknown'
  const inProgress = offboarding.status === 'in_progress'
  const progress = progressOf(tasks)
  const signOff = signOffOf(offboarding, tasks, managerId, { id: me, isHr })
  const detailsSet = !!offboarding.reason && !!offboarding.last_working_day
  const leavingAs = offboarding.reason === 'terminated' ? STATUS_LABELS.terminated : STATUS_LABELS.left
  // This sign-off is the last one needed if the other side is done (or not needed) or it covers both.
  const completes =
    (signOff.asHr || signOff.hr === 'done') && (signOff.asManager || signOff.manager !== 'waiting')

  return (
    <>
      <PageHeader
        title={name}
        subtitle={
          <>
            {person?.designation ?? person?.company_email}
            {' · '}Put on notice {formatDate(offboarding.started_at)}
            {isHr && (
              <>
                {' · '}
                <MuiLink component={Link} to={`/employees/${offboarding.employee_id}`}>
                  Employee record
                </MuiLink>
              </>
            )}
          </>
        }
        back="/hr/offboarding"
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              label={ONBOARDING_STATUS_LABELS[offboarding.status]}
              color={ONBOARDING_STATUS_COLORS[offboarding.status]}
              variant="outlined"
            />
            {inProgress && isHr && (
              <Button color="error" onClick={() => open('cancel')}>
                Cancel offboarding
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
      {offboarding.status === 'completed' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Completed on {formatDayTime(offboarding.completed_at ?? '')}. {name} is marked {leavingAs.toLowerCase()} from{' '}
          {formatDate(offboarding.last_working_day)}.
        </Alert>
      )}
      {offboarding.status === 'cancelled' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Cancelled {offboarding.cancelled_by ? `by ${nameOf(offboarding.cancelled_by)} ` : ''}on{' '}
          {formatDayTime(offboarding.cancelled_at ?? '')}: {offboarding.cancel_reason}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, mb: 3 }}>
        <Paper variant="outlined" component="section" aria-label="Details" sx={{ p: 2 }}>
          <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, flexGrow: 1 }}>
              Details
            </Typography>
            {inProgress && isHr && (
              <Button size="small" onClick={() => open('details')}>
                {detailsSet ? 'Change' : 'Set details'}
              </Button>
            )}
          </Stack>
          <Stack direction="row" spacing={4}>
            <Detail label="Reason">{offboarding.reason ? OFFBOARDING_REASON_LABELS[offboarding.reason] : 'Not set'}</Detail>
            <Detail label="Last working day">
              {offboarding.last_working_day ? formatDate(offboarding.last_working_day) : 'Not set'}
            </Detail>
          </Stack>
        </Paper>

        <Paper variant="outlined" component="section" aria-label="Sign-off" sx={{ p: 2 }}>
          <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, flexGrow: 1 }}>
              Sign-off
            </Typography>
            {signOff.mine && (
              <Button size="small" variant="contained" onClick={() => open('sign')}>
                Sign off
              </Button>
            )}
          </Stack>
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              {ICONS[signOff.hr]}
              <Typography variant="body2">
                HR · {offboarding.hr_signed_by ? `${nameOf(offboarding.hr_signed_by)}, ${formatDayTime(offboarding.hr_signed_at ?? '')}` : 'Waiting'}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              {ICONS[signOff.manager]}
              <Typography variant="body2">
                Manager ·{' '}
                {offboarding.manager_signed_by
                  ? `${nameOf(offboarding.manager_signed_by)}, ${formatDayTime(offboarding.manager_signed_at ?? '')}`
                  : managerId
                    ? `Waiting for ${nameOf(managerId)}`
                    : 'Not needed (no manager in the org chart)'}
              </Typography>
            </Stack>
          </Stack>
          {inProgress && signOff.blocker && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
              {signOff.blocker} Unticking a task or changing the details clears sign-offs given.
            </Typography>
          )}
        </Paper>
      </Box>

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
          The offboarding checklist was empty when this offboarding started.
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

      <FormDialog
        open={dialog === 'details'}
        title="Offboarding details"
        submitLabel="Save"
        error={dialogError}
        busy={busy}
        onSubmit={submit}
        onClose={() => setDialog(null)}
      >
        <TextField
          select
          label="Reason"
          required
          fullWidth
          value={details.reason}
          onChange={(e) => setDetails((d) => ({ ...d, reason: e.target.value as OffboardingReason }))}
        >
          {(Object.keys(OFFBOARDING_REASON_LABELS) as OffboardingReason[]).map((r) => (
            <MenuItem key={r} value={r}>
              {OFFBOARDING_REASON_LABELS[r]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Last working day"
          type="date"
          required
          fullWidth
          value={details.lastDay}
          onChange={(e) => setDetails((d) => ({ ...d, lastDay: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          On completion {name} is marked {details.reason === 'terminated' ? 'terminated' : 'left'} from this day.
          {(offboarding.hr_signed_by || offboarding.manager_signed_by) && ' Changing these clears the sign-offs given.'}
        </Typography>
      </FormDialog>

      <ConfirmDialog
        open={dialog === 'sign'}
        title="Sign off this offboarding?"
        message={
          <>
            {dialogError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {dialogError}
              </Alert>
            )}
            {completes
              ? `This completes ${name}’s offboarding. They’ll be marked ${leavingAs.toLowerCase()} from ${formatDate(offboarding.last_working_day)} and can no longer sign in.`
              : `You sign off as ${signOff.asHr ? 'HR' : 'their manager'}. It then waits for ${signOff.asHr ? nameOf(managerId) : 'HR'}.`}
          </>
        }
        confirmLabel="Sign off"
        busy={busy}
        onConfirm={submit}
        onClose={() => setDialog(null)}
      />

      <FormDialog
        open={dialog === 'cancel'}
        title="Cancel offboarding?"
        submitLabel="Cancel offboarding"
        error={dialogError}
        busy={busy}
        onSubmit={submit}
        onClose={() => setDialog(null)}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {name}’s offboarding will be closed as cancelled, and their status stays as it is. If they’re staying, setting
          their status back on their record cancels the offboarding by itself.
        </Typography>
        <TextField
          label="Reason"
          required
          multiline
          minRows={2}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
          fullWidth
        />
      </FormDialog>
    </>
  )
}
