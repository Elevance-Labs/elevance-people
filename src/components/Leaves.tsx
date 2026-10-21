import { useEffect, useState, type ReactElement } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlineOutlined'
import { supabase } from '../lib/supabase'
import { LEAVE_STATUS_COLORS, LEAVE_STATUS_LABELS, formatDateRange, formatDays } from '../lib/constants'
import { trimOrNull } from '../lib/company'
import {
  HOLIDAY_COLUMNS,
  holidaysIn,
  leaveDays,
  leaveError,
  remainingOf,
  thisYear,
  yearBounds,
  yearOf,
  type LeaveWithType,
} from '../lib/leaves'
import type { DirectoryEntry, Holiday, Leave, LeaveBalance, LeaveStatus, LeaveType } from '../lib/types'
import { FormDialog, PersonAvatar } from './common'

export function LeaveStatusChip({ status }: { status: LeaveStatus }) {
  return (
    <Chip
      label={LEAVE_STATUS_LABELS[status]}
      color={LEAVE_STATUS_COLORS[status]}
      size="small"
      variant={status === 'approved' ? 'filled' : 'outlined'}
    />
  )
}

function Step({ icon, label, text }: { icon: ReactElement; label: string; text: string }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      {icon}
      <Typography variant="body2" noWrap>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {label} ·{' '}
        </Box>
        {text}
      </Typography>
    </Stack>
  )
}

const DONE = <CheckCircleIcon fontSize="small" color="success" />
const WAITING = <HourglassEmptyIcon fontSize="small" color="disabled" />
const SKIPPED = <RemoveCircleOutlineIcon fontSize="small" color="disabled" />

// Who has approved, rejected or cancelled a leave, and who it's still waiting on.
// managerId is the employee's current manager in the org chart.
export function LeaveProgress({
  leave,
  nameOf,
  managerId,
}: {
  leave: Leave
  nameOf: (id: string | null) => string
  managerId: string | null
}) {
  const edited = leave.edited_by && (
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
      Dates changed by {nameOf(leave.edited_by)}
    </Typography>
  )

  if (leave.status === 'rejected' || leave.status === 'cancelled') {
    const rejected = leave.status === 'rejected'
    return (
      <Box>
        <Typography variant="body2">
          {rejected ? 'Rejected' : 'Cancelled'} by {nameOf(rejected ? leave.rejected_by : leave.cancelled_by)}
        </Typography>
        {rejected && leave.rejection_reason && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            “{leave.rejection_reason}”
          </Typography>
        )}
        {edited}
      </Box>
    )
  }

  const pending = leave.status === 'pending'
  return (
    <Stack spacing={0.25}>
      {leave.hr_approved_by || !pending ? (
        <Step icon={DONE} label="HR" text={nameOf(leave.hr_approved_by)} />
      ) : (
        <Step icon={WAITING} label="HR" text="Waiting" />
      )}
      {leave.manager_approved_by ? (
        <Step icon={DONE} label="Manager" text={nameOf(leave.manager_approved_by)} />
      ) : pending && managerId ? (
        <Step icon={WAITING} label="Manager" text={`Waiting for ${nameOf(managerId)}`} />
      ) : (
        <Step icon={SKIPPED} label="Manager" text="Not needed" />
      )}
      {edited}
    </Stack>
  )
}

export function BalanceCards({ balances }: { balances: LeaveBalance[] }) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', mb: 3 }}>
      {balances.map((b) => {
        const left = remainingOf(b)
        return (
          <Paper key={b.leave_type_id} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
              {b.name}
            </Typography>
            <Typography variant="h5" sx={{ mt: 0.5 }}>
              {left === null ? 'No limit' : left}
              {left !== null && (
                <Typography component="span" variant="body2" sx={{ color: 'text.secondary', ml: 0.75 }}>
                  {left === 1 || left === 0.5 ? 'day' : 'days'} left
                </Typography>
              )}
            </Typography>
            {b.quota !== null && (
              <LinearProgress
                variant="determinate"
                value={b.quota ? Math.min(100, ((b.approved + b.pending) / b.quota) * 100) : 100}
                sx={{ my: 1, borderRadius: 1 }}
              />
            )}
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: b.quota === null ? 1 : 0 }}>
              {b.approved} taken · {b.pending} pending{b.quota !== null && ` · ${b.quota} this year`}
            </Typography>
          </Paper>
        )
      })}
    </Box>
  )
}

// Holidays as a list: name, dates and the weekday they start on.
export function HolidayList({ holidays, empty }: { holidays: Holiday[]; empty: string }) {
  return (
    <Paper variant="outlined">
      {holidays.map((h, i) => (
        <Box key={h.id}>
          {i > 0 && <Divider />}
          <Stack direction="row" spacing={2} sx={{ px: 2, py: 1.5, alignItems: 'center' }}>
            <Typography variant="body2" sx={{ fontWeight: 500, flexGrow: 1, minWidth: 0 }}>
              {h.name}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
              {new Date(`${h.start_date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })},{' '}
              {formatDateRange(h.start_date, h.end_date)}
            </Typography>
          </Stack>
        </Box>
      ))}
      {!holidays.length && (
        <Typography variant="body2" sx={{ px: 2, py: 3, color: 'text.secondary', textAlign: 'center' }}>
          {empty}
        </Typography>
      )}
    </Paper>
  )
}

export type LeaveDialogMode = 'apply' | 'record' | 'edit'

const TITLES: Record<LeaveDialogMode, string> = {
  apply: 'Apply for leave',
  record: 'Record leave',
  edit: 'Change leave dates',
}

const EMPTY = { employeeId: '', typeId: '', start: '', end: '', halfDay: false, reason: '' }

// apply: the signed-in employee applies (employeeId).
// record: HR records a leave for someone in `people`; it carries HR's approval.
// edit: HR changes the dates of `leave`.
export function LeaveDialog({
  open,
  mode,
  employeeId,
  leave,
  people = [],
  types,
  onClose,
  onSaved,
}: {
  open: boolean
  mode: LeaveDialogMode
  employeeId?: string
  leave?: LeaveWithType | null
  people?: DirectoryEntry[]
  types: LeaveType[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(EMPTY)
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setForm(
      leave
        ? {
            employeeId: leave.employee_id,
            typeId: leave.leave_type_id,
            start: leave.start_date,
            end: leave.end_date,
            halfDay: leave.half_day,
            reason: '',
          }
        : { ...EMPTY, employeeId: employeeId ?? '' },
    )
  }, [open, leave, employeeId])

  const year = form.start ? yearOf(form.start) : thisYear()
  useEffect(() => {
    if (!open || !form.employeeId) return setBalances([])
    supabase
      .rpc('leave_balances', { p_employee_id: form.employeeId, p_year: year })
      .then(({ data }) => setBalances((data ?? []) as LeaveBalance[]))
  }, [open, form.employeeId, year])

  // A leave stays within one year, so that year's holidays are all it can meet.
  useEffect(() => {
    if (!open) return
    const [from, to] = yearBounds(year)
    supabase
      .from('holidays')
      .select(HOLIDAY_COLUMNS)
      .gte('start_date', from)
      .lte('start_date', to)
      .then(({ data }) => setHolidays((data ?? []) as Holiday[]))
  }, [open, year])

  // Days left for a type, not counting the leave being edited.
  function remainingFor(typeId: string) {
    const b = balances.find((x) => x.leave_type_id === typeId)
    if (!b) return undefined
    const left = remainingOf(b)
    const own = leave && leave.leave_type_id === typeId && yearOf(leave.start_date) === year ? leave.days : 0
    return left === null ? null : left + own
  }

  const singleDay = !!form.start && form.start === form.end
  const days = leaveDays(form.start, form.end, form.halfDay && singleDay, holidays)
  const skipped = form.start && form.end ? holidaysIn(holidays, form.start, form.end) : []
  const remaining = form.typeId ? remainingFor(form.typeId) : undefined
  const typeName = types.find((t) => t.id === form.typeId)?.name ?? leave?.leave_type?.name

  let problem: string | null = null
  if (form.start && form.end && form.end < form.start) problem = 'The end date is before the start date.'
  else if (form.start && form.end && yearOf(form.start) !== yearOf(form.end))
    problem = "A leave can't run into the next year. Split it into two requests."
  else if (form.start && form.end && !days)
    problem = skipped.length
      ? `These dates have no working days: ${skipped.map((h) => h.name).join(', ')} is a holiday.`
      : 'These dates have no working days (Monday to Friday).'

  async function save() {
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const dates = { start_date: form.start, end_date: form.end, half_day: form.halfDay && singleDay }
    const { error: saveError } = await (mode === 'edit' && leave
      ? supabase.from('leaves').update(dates).eq('id', leave.id)
      : supabase.from('leaves').insert({
          ...dates,
          employee_id: form.employeeId,
          leave_type_id: form.typeId,
          reason: trimOrNull(form.reason),
        }))
    setBusy(false)
    if (saveError) return setError(leaveError(saveError))
    onSaved()
  }

  return (
    <FormDialog
      open={open}
      title={TITLES[mode]}
      submitLabel={mode === 'apply' ? 'Apply' : 'Save'}
      error={error}
      busy={busy}
      onSubmit={save}
      onClose={onClose}
    >
      {mode === 'record' && (
        <Autocomplete
          options={people}
          value={people.find((p) => p.id === form.employeeId) ?? null}
          onChange={(_e, p) => setForm((f) => ({ ...f, employeeId: p?.id ?? '' }))}
          getOptionLabel={(p) => p.full_name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderOption={({ key, ...props }, p) => (
            <li key={key} {...props}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <PersonAvatar name={p.full_name} size={28} />
                <Box>
                  <Typography variant="body2">{p.full_name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {p.designation ?? p.company_email}
                  </Typography>
                </Box>
              </Stack>
            </li>
          )}
          renderInput={(params) => <TextField {...params} label="Employee" required autoFocus />}
        />
      )}

      {mode === 'edit' ? (
        <TextField label="Leave type" value={typeName ?? ''} disabled fullWidth />
      ) : (
        <TextField
          select
          label="Leave type"
          required
          fullWidth
          value={form.typeId}
          onChange={(e) => setForm((f) => ({ ...f, typeId: e.target.value }))}
        >
          {types.map((t) => {
            const left = remainingFor(t.id)
            return (
              <MenuItem key={t.id} value={t.id}>
                <Box sx={{ display: 'flex', width: '100%', gap: 2 }}>
                  <Box sx={{ flexGrow: 1 }}>{t.name}</Box>
                  {left !== undefined && (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {left === null ? 'No limit' : `${formatDays(left)} left`}
                    </Typography>
                  )}
                </Box>
              </MenuItem>
            )
          })}
        </TextField>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="From"
          type="date"
          required
          fullWidth
          value={form.start}
          onChange={(e) => {
            const start = e.target.value
            setForm((f) => ({ ...f, start, end: !f.end || f.end < start ? start : f.end }))
          }}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label="To"
          type="date"
          required
          fullWidth
          value={form.end}
          onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: form.start || undefined } }}
        />
      </Stack>

      <FormControlLabel
        control={
          <Checkbox
            checked={form.halfDay && singleDay}
            disabled={!singleDay}
            onChange={(e) => setForm((f) => ({ ...f, halfDay: e.target.checked }))}
          />
        }
        label="Half day"
        sx={{ mt: -1 }}
      />

      {mode !== 'edit' && (
        <TextField
          label="Reason"
          multiline
          minRows={2}
          fullWidth
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
        />
      )}

      {problem ? (
        <Alert severity="warning">{problem}</Alert>
      ) : (
        days > 0 && (
          <Alert severity={typeof remaining === 'number' && days > remaining ? 'warning' : 'info'}>
            {formatDays(days)} of leave
            {typeName && typeof remaining === 'number' && (
              <>
                {' '}
                · {formatDays(remaining)} of {typeName} left in {year}
                {days > remaining && '. HR can raise the quota if needed.'}
              </>
            )}
            {skipped.length > 0 && (
              <Box component="span" sx={{ display: 'block' }}>
                Not counted: {skipped.map((h) => h.name).join(', ')} (holiday).
              </Box>
            )}
          </Alert>
        )
      )}

      {mode === 'record' && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Recording a leave gives it your HR approval. It still needs the employee's manager, if they have one.
        </Typography>
      )}
      {mode === 'edit' && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Approvals already given are kept. The change is recorded under your name.
        </Typography>
      )}
    </FormDialog>
  )
}
