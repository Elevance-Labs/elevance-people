import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Link,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { useAuth } from '../auth/AuthProvider'
import { ConfirmDialog, FormDialog, PageHeader, PersonAvatar } from '../components/common'
import { supabase } from '../lib/supabase'
import { SALARY_REVISION_STATUS_LABELS, formatDate } from '../lib/constants'
import { formatAmount } from '../lib/payroll'
import { trimOrNull } from '../lib/company'
import {
  byMonthDesc,
  changeOf,
  firstDayOf,
  latestOf,
  monthInput,
  monthOf,
  phaseOf,
  salaryError,
  totalOf,
} from '../lib/salary'
import type { DirectoryEntry, SalaryRevision, SalaryRevisionStatus } from '../lib/types'

const TABS: SalaryRevisionStatus[] = ['draft', 'review', 'approved']
const PHASE = {
  active: { label: 'Active', color: 'success' },
  upcoming: { label: 'Upcoming', color: 'info' },
  past: { label: 'Past', color: 'default' },
} as const

const EMPTY = { employeeId: '', month: '', basic: '', contractual: '', note: '' }
type Action = { kind: 'review' | 'approve' | 'reject' | 'delete'; revision: SalaryRevision }

// People → Appraisals (HR and company admins): salary revisions. HR writes a
// draft for an employee from a month and sends it for review; a company admin
// approves it or rejects it back to draft. One open per person, never your
// own (RLS hides it). Approved ones are the salary history (?status=…).
export default function Appraisals() {
  const { employee, isCompanyAdmin } = useAuth()
  const me = employee!.id
  const [params, setParams] = useSearchParams()
  const status = TABS.find((s) => s === params.get('status')) ?? 'draft'
  const [rows, setRows] = useState<SalaryRevision[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SalaryRevision | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [history, setHistory] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [revisionsRes, directoryRes] = await Promise.all([
      supabase.from('salary_revisions').select('*').order('effective_from', { ascending: false }),
      supabase.from('employee_directory').select('*').order('full_name'),
    ])
    const failure = revisionsRes.error ?? directoryRes.error
    if (failure) setError(failure.message)
    else {
      setRows(revisionsRes.data as SalaryRevision[])
      setPeople(directoryRes.data as DirectoryEntry[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? 'Someone'
  const approvedOf = useCallback(
    (employeeId: string) => rows.filter((r) => r.employee_id === employeeId && r.status === 'approved'),
    [rows],
  )
  // What a row is compared with: the approved salary before it (approved
  // rows), or the latest approved one (open rows).
  const before = (r: SalaryRevision) => {
    const approved = approvedOf(r.employee_id)
    return r.status === 'approved'
      ? (byMonthDesc(approved).find((x) => x.effective_from < r.effective_from) ?? null)
      : latestOf(approved)
  }
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((s) => [s, rows.filter((r) => r.status === s).length])),
    [rows],
  )
  const shown = rows
    .filter((r) => r.status === status)
    .sort((a, b) => nameOf(a.employee_id).localeCompare(nameOf(b.employee_id)) || b.effective_from.localeCompare(a.effective_from))

  // Who an appraisal can be written for: not yourself, not someone who has
  // left, and not someone with one open already.
  const open = new Set(rows.filter((r) => r.status !== 'approved').map((r) => r.employee_id))
  const candidates = people.filter((p) => p.id !== me && !['left', 'terminated'].includes(p.status) && !open.has(p.id))

  function openEditor(r: SalaryRevision | 'new') {
    setForm(
      r === 'new'
        ? EMPTY
        : {
            employeeId: r.employee_id,
            month: monthInput(r.effective_from),
            basic: String(r.basic_salary),
            contractual: String(r.contractual_amount),
            note: r.note ?? '',
          },
    )
    setDialogError(null)
    setEditing(r)
  }

  const current = form.employeeId ? latestOf(approvedOf(form.employeeId)) : null
  const draft = {
    effective_from: firstDayOf(form.month),
    basic_salary: Number(form.basic || 0),
    contractual_amount: Number(form.contractual || 0),
  }
  const tooEarly = !!current && !!form.month && draft.effective_from <= current.effective_from

  async function save() {
    if (!editing || !form.employeeId || !form.month || form.basic === '') return
    if (tooEarly) return setDialogError(`An appraisal must start after the current salary, from ${monthOf(current!.effective_from)}.`)
    setBusy(true)
    setDialogError(null)
    const figures = { ...draft, note: trimOrNull(form.note) }
    const { error: saveError } = await (editing === 'new'
      ? supabase.from('salary_revisions').insert({ employee_id: form.employeeId, ...figures })
      : supabase.from('salary_revisions').update(figures).eq('id', editing.id))
    setBusy(false)
    if (saveError) return setDialogError(salaryError(saveError))
    setEditing(null)
    if (status !== 'draft') setParams({}, { replace: true })
    load()
  }

  function startAction(next: Action) {
    setReason('')
    setDialogError(null)
    setAction(next)
  }

  async function act() {
    if (!action) return
    if (action.kind === 'reject' && !reason.trim()) return
    setBusy(true)
    setDialogError(null)
    const id = action.revision.id
    const { error: actError } =
      action.kind === 'delete'
        ? await supabase.from('salary_revisions').delete().eq('id', id)
        : await supabase.rpc('salary_revision_move', {
            p_revision_id: id,
            p_status: action.kind === 'review' ? 'review' : action.kind === 'approve' ? 'approved' : 'draft',
            p_reason: action.kind === 'reject' ? reason.trim() : null,
          })
    setBusy(false)
    if (actError) return setDialogError(salaryError(actError))
    setAction(null)
    load()
  }

  const who = action ? nameOf(action.revision.employee_id) : ''
  const historyRows = history ? byMonthDesc(approvedOf(history)) : []

  return (
    <>
      <PageHeader
        title="Appraisals"
        subtitle="Salary revisions: HR writes one from a month, a company admin approves it, and it becomes the person’s salary."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} disabled={loading} onClick={() => openEditor('new')}>
            New appraisal
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={status}
          onChange={(_e, value: SalaryRevisionStatus) => setParams(value === 'draft' ? {} : { status: value }, { replace: true })}
        >
          {TABS.map((s) => (
            <Tab key={s} value={s} label={`${SALARY_REVISION_STATUS_LABELS[s]} (${counts[s] ?? 0})`} />
          ))}
        </Tabs>
      </Box>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>From</TableCell>
                <TableCell align="right">Basic</TableCell>
                <TableCell align="right">Contractual</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Change</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r) => {
                const name = nameOf(r.employee_id)
                const phase = r.status === 'approved' ? PHASE[phaseOf(r, approvedOf(r.employee_id))] : null
                return (
                  <TableRow key={r.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <PersonAvatar name={name} size={32} />
                        <Box sx={{ minWidth: 0 }}>
                          <Link component="button" variant="body2" sx={{ fontWeight: 500 }} onClick={() => setHistory(r.employee_id)}>
                            {name}
                          </Link>
                          {r.note && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                              {r.note}
                            </Typography>
                          )}
                          {r.status === 'draft' && r.rejection_reason && (
                            <Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>
                              Rejected by {nameOf(r.rejected_by)}: {r.rejection_reason}
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{monthOf(r.effective_from)}</TableCell>
                    <TableCell align="right">{formatAmount(Number(r.basic_salary))}</TableCell>
                    <TableCell align="right">{formatAmount(Number(r.contractual_amount))}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 500 }}>
                      {formatAmount(totalOf(r))}
                    </TableCell>
                    <TableCell align="right">{changeOf(before(r), r) ?? '—'}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'draft' && (
                        <>
                          <Button size="small" color="inherit" onClick={() => openEditor(r)}>
                            Edit
                          </Button>
                          <Button size="small" color="inherit" onClick={() => startAction({ kind: 'delete', revision: r })}>
                            Delete
                          </Button>
                          <Button size="small" variant="outlined" onClick={() => startAction({ kind: 'review', revision: r })}>
                            Send for review
                          </Button>
                        </>
                      )}
                      {r.status === 'review' &&
                        (isCompanyAdmin ? (
                          <>
                            <Button size="small" color="error" onClick={() => startAction({ kind: 'reject', revision: r })}>
                              Reject
                            </Button>
                            <Button size="small" variant="contained" onClick={() => startAction({ kind: 'approve', revision: r })}>
                              Approve
                            </Button>
                          </>
                        ) : (
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Waiting for a company admin
                          </Typography>
                        ))}
                      {phase && (
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {nameOf(r.approved_by)}, {formatDate(r.approved_at)}
                          </Typography>
                          <Chip size="small" label={phase.label} color={phase.color} variant="outlined" />
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && !shown.length && (
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {status === 'draft'
                      ? 'No drafts. Start a new appraisal to record a raise or someone’s first salary.'
                      : status === 'review'
                        ? 'Nothing waiting for review.'
                        : 'No approved salaries yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? 'New appraisal' : 'Edit appraisal'}
        submitLabel={editing === 'new' ? 'Save draft' : 'Save'}
        error={dialogError}
        busy={busy}
        onSubmit={save}
        onClose={() => setEditing(null)}
      >
        {editing === 'new' ? (
          <Autocomplete
            options={candidates}
            value={candidates.find((p) => p.id === form.employeeId) ?? null}
            onChange={(_e, p) => setForm((f) => ({ ...f, employeeId: p?.id ?? '' }))}
            getOptionLabel={(p) => p.full_name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => (
              <TextField {...params} label="Employee" required autoFocus helperText="People with an appraisal open aren’t listed." />
            )}
          />
        ) : (
          <TextField label="Employee" value={nameOf(form.employeeId)} disabled fullWidth />
        )}
        {form.employeeId && (
          <Alert severity="info" variant="outlined">
            {current
              ? `Current salary: ${formatAmount(totalOf(current))} (${formatAmount(Number(current.basic_salary))} basic + ${formatAmount(Number(current.contractual_amount))} contractual) from ${monthOf(current.effective_from)}.`
              : 'No salary recorded yet. This will be their first.'}
          </Alert>
        )}
        <TextField
          label="Starting month"
          type="month"
          required
          fullWidth
          value={form.month}
          onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
          error={tooEarly}
          helperText={tooEarly ? `Must be after ${monthOf(current!.effective_from)}` : undefined}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Basic salary"
            type="number"
            required
            fullWidth
            value={form.basic}
            onChange={(e) => setForm((f) => ({ ...f, basic: e.target.value }))}
            slotProps={{ htmlInput: { min: 0, step: 'any' } }}
          />
          <TextField
            label="Contractual amount"
            type="number"
            fullWidth
            value={form.contractual}
            onChange={(e) => setForm((f) => ({ ...f, contractual: e.target.value }))}
            slotProps={{ htmlInput: { min: 0, step: 'any' } }}
          />
        </Stack>
        {form.basic !== '' && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Total {formatAmount(totalOf(draft))} a month{current && changeOf(current, draft) && ` · ${changeOf(current, draft)}`}
          </Typography>
        )}
        <TextField
          label="Note"
          multiline
          minRows={2}
          fullWidth
          helperText="For HR and admins only (e.g. annual appraisal, promotion)."
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
      </FormDialog>

      <ConfirmDialog
        open={!!action && action.kind !== 'reject'}
        title={
          action?.kind === 'delete' ? 'Delete draft?' : action?.kind === 'review' ? 'Send for review?' : 'Approve appraisal?'
        }
        message={
          <>
            {dialogError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {dialogError}
              </Alert>
            )}
            {action?.kind === 'delete'
              ? `${who}’s draft appraisal will be deleted.`
              : action?.kind === 'review'
                ? `A company admin will review ${who}’s appraisal. It can’t be edited while in review.`
                : action &&
                  `${who}’s salary becomes ${formatAmount(totalOf(action.revision))} a month from ${monthOf(action.revision.effective_from)}. Once approved it can’t be changed; a later appraisal replaces it.`}
          </>
        }
        confirmLabel={action?.kind === 'delete' ? 'Delete' : action?.kind === 'review' ? 'Send' : 'Approve'}
        destructive={action?.kind === 'delete'}
        busy={busy}
        onConfirm={act}
        onClose={() => setAction(null)}
      />

      <FormDialog
        open={action?.kind === 'reject'}
        title="Reject appraisal?"
        submitLabel="Reject"
        error={dialogError}
        busy={busy}
        onSubmit={act}
        onClose={() => setAction(null)}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {who}’s appraisal goes back to draft for HR, with your reason.
        </Typography>
        <TextField
          label="Reason"
          required
          multiline
          minRows={2}
          fullWidth
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
      </FormDialog>

      <Dialog open={!!history} onClose={() => setHistory(null)} fullWidth maxWidth="sm">
        <DialogTitle>Salary history · {history && nameOf(history)}</DialogTitle>
        <DialogContent>
          {historyRows.length ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>From</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right">Change</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {historyRows.map((r, i) => {
                  const phase = PHASE[phaseOf(r, historyRows)]
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{monthOf(r.effective_from)}</TableCell>
                      <TableCell align="right">{formatAmount(totalOf(r))}</TableCell>
                      <TableCell align="right">{changeOf(historyRows[i + 1] ?? null, r) ?? '—'}</TableCell>
                      <TableCell align="right">
                        <Chip size="small" label={phase.label} color={phase.color} variant="outlined" />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <Typography sx={{ color: 'text.secondary' }}>No approved salary yet.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistory(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
