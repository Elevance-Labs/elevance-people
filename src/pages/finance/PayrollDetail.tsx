import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import DownloadIcon from '@mui/icons-material/Download'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import {
  PAYROLL_STATUS_COLORS,
  PAYROLL_STATUS_LABELS,
  formatDayTime,
  formatEmployeeNumber,
} from '../../lib/constants'
import {
  AMOUNT_COLUMNS,
  FINANCE_FIELDS,
  HR_FIELDS,
  PAYABLE_STATUSES,
  csvFileName,
  downloadCsv,
  formatAmount,
  grossOf,
  netOf,
  payrollCsv,
  payrollError,
  periodLabel,
  totalOf,
} from '../../lib/payroll'
import type { BonusType, DirectoryEntry, Payroll, PayrollItem, PayrollStatus } from '../../lib/types'

type Field = (typeof HR_FIELDS)[number] | (typeof FINANCE_FIELDS)[number]
type Form = Record<Field, string>

const REMARKS: Field[] = ['hr_remarks', 'finance_remarks']

const toForm = (item: PayrollItem) =>
  Object.fromEntries([...HR_FIELDS, ...FINANCE_FIELDS].map((f) => [f, String(item[f] ?? '')])) as Form

// Blank counts as 0.
const amount = (value: string) => (value.trim() === '' ? 0 : Number(value))

const MOVES: Record<PayrollStatus, { label: string; message: (period: string) => string }> = {
  review: {
    label: 'Send for review',
    message: (p) =>
      `The ${p} payroll goes to review. Nothing on it can be changed while it’s in review; a company admin approves it or sends it back to draft.`,
  },
  approved: {
    label: 'Approve',
    message: (p) => `The ${p} payroll will be approved. Finance can then mark it processed.`,
  },
  draft: {
    label: 'Back to draft',
    message: (p) =>
      `The ${p} payroll goes back to draft, so HR and finance can change it again. It will need to be reviewed and approved again.`,
  },
  processed: {
    label: 'Mark processed',
    message: (p) => `The ${p} payroll will be marked processed. This is final: it can’t be changed or reopened.`,
  },
}

// One month's payroll (HR, finance admins, company admins): a line per
// person. While it's a draft, HR edits basic salary, contractual amount,
// absent days and HR remarks, finance the rest, and anyone here adds or
// removes people. Then it goes to review, a company admin approves it (or
// sends it back to draft), and finance marks it processed. Every rule is
// enforced by the database; this page only offers what it would allow.
export default function PayrollDetail() {
  const { id = '' } = useParams()
  const { isHr, isFinance, isCompanyAdmin } = useAuth()
  const [payroll, setPayroll] = useState<Payroll | null>(null)
  const [items, setItems] = useState<PayrollItem[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PayrollItem | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addId, setAddId] = useState('')
  const [removing, setRemoving] = useState<PayrollItem | null>(null)
  const [moving, setMoving] = useState<PayrollStatus | null>(null)
  const [busy, setBusy] = useState(false)
  // The Name column is pinned right after Emp #, at Emp #'s real width: the
  // browser sizes table columns itself, so a fixed offset leaves a gap or an
  // overlap when scrolling sideways.
  const numberHeader = useRef<HTMLTableCellElement>(null)
  const [nameLeft, setNameLeft] = useState(0)

  useLayoutEffect(() => {
    const cell = numberHeader.current
    if (!cell) return
    const measure = () => setNameLeft(cell.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(cell)
    return () => observer.disconnect()
  }, [loading, payroll])

  const load = useCallback(async () => {
    const [payrollRes, itemsRes] = await Promise.all([
      supabase.from('payrolls').select('*').eq('id', id).maybeSingle(),
      supabase.from('payroll_items').select('*').eq('payroll_id', id),
    ])
    const loadError = payrollRes.error ?? itemsRes.error
    if (loadError) setError(loadError.message)
    else {
      setPayroll(payrollRes.data as Payroll | null)
      setItems((itemsRes.data as PayrollItem[]).sort((a, b) => a.employee_number - b.employee_number))
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

  function openEditor(item: PayrollItem) {
    setEditing(item)
    setForm(toForm(item))
    setFormError(null)
  }

  async function save() {
    if (!editing || !form) return
    const fields: Field[] = [...(isHr ? HR_FIELDS : []), ...(isFinance ? FINANCE_FIELDS : [])]
    const values: Record<string, string | number | null> = {}
    for (const f of fields) {
      if (REMARKS.includes(f)) values[f] = form[f].trim() || null
      else if (f === 'bonus_type') values[f] = form[f]
      else {
        const n = amount(form[f])
        if (!Number.isFinite(n) || n < 0) return setFormError('Amounts must be 0 or more.')
        values[f] = n
      }
    }
    if ('absent_days' in values) {
      const days = values.absent_days as number
      if (days > 31 || days % 0.5 !== 0)
        return setFormError('Absent days must be between 0 and 31, in steps of half a day.')
    }
    setBusy(true)
    setFormError(null)
    const { error: saveError } = await supabase.from('payroll_items').update(values).eq('id', editing.id)
    setBusy(false)
    if (saveError) return setFormError(payrollError(saveError))
    setEditing(null)
    load()
  }

  async function add() {
    if (!addId) return
    setBusy(true)
    setFormError(null)
    const { error: addError } = await supabase.from('payroll_items').insert({ payroll_id: id, employee_id: addId })
    setBusy(false)
    if (addError) return setFormError(payrollError(addError))
    setAdding(false)
    setAddId('')
    load()
  }

  async function remove() {
    if (!removing) return
    setBusy(true)
    setError(null)
    const { error: removeError } = await supabase.from('payroll_items').delete().eq('id', removing.id)
    setBusy(false)
    setRemoving(null)
    if (removeError) setError(payrollError(removeError))
    load()
  }

  async function move() {
    if (!moving) return
    setBusy(true)
    setError(null)
    const { error: moveError } = await supabase.rpc('payroll_move', { p_payroll_id: id, p_status: moving })
    setBusy(false)
    setMoving(null)
    if (moveError) setError(payrollError(moveError))
    load()
  }

  if (loading) return <LinearProgress />
  if (!payroll) {
    return (
      <>
        <PageHeader title="Payroll" back="/finance/payroll" />
        <Alert severity={error ? 'error' : 'warning'}>{error ?? 'This payroll doesn’t exist.'}</Alert>
      </>
    )
  }

  const period = periodLabel(payroll)
  const draft = payroll.status === 'draft'
  // Draft → review by anyone here; approving and reopening by a company
  // admin; processing by finance.
  const moves: PayrollStatus[] = {
    draft: ['review'] as PayrollStatus[],
    review: isCompanyAdmin ? ['draft', 'approved'] : [],
    approved: [...(isCompanyAdmin ? ['draft'] : []), ...(isFinance ? ['processed'] : [])],
    processed: [],
  }[payroll.status] as PayrollStatus[]
  const onPayroll = new Set(items.map((i) => i.employee_id))
  const candidates = people
    .filter((p) => PAYABLE_STATUSES.includes(p.status) && !onPayroll.has(p.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))

  const field = (f: Field, label: string, editable: boolean, extra: object = {}) =>
    form && (
      <TextField
        label={label}
        value={form[f]}
        onChange={(e) => setForm((v) => v && { ...v, [f]: e.target.value })}
        disabled={!editable}
        fullWidth
        {...(REMARKS.includes(f)
          ? { multiline: true, minRows: 2, slotProps: { htmlInput: { maxLength: 1000 } } }
          : { type: 'number', slotProps: { htmlInput: { min: 0, step: f === 'absent_days' ? 0.5 : 'any' } } })}
        {...extra}
      />
    )
  const preview = form && {
    basic_salary: amount(form.basic_salary) || 0,
    contractual_amount: amount(form.contractual_amount) || 0,
    bonus_type: form.bonus_type as BonusType,
    bonus_value: amount(form.bonus_value) || 0,
    absent_deduction: amount(form.absent_deduction) || 0,
    allowance: amount(form.allowance) || 0,
    arrears: amount(form.arrears) || 0,
    advance_salary: amount(form.advance_salary) || 0,
    loan_deduction: amount(form.loan_deduction) || 0,
    tax_amount: amount(form.tax_amount) || 0,
  }
  // Pinned cells are opaque, so they take the row's hover tint as an overlay.
  const pinned = { position: 'sticky', bgcolor: 'background.paper', zIndex: 1 } as const
  const numberCol = { ...pinned, left: 0, width: 80 } as const
  const nameCol = { ...pinned, left: nameLeft, borderRight: 1, borderRightColor: 'divider' } as const

  return (
    <>
      <PageHeader
        title={`${period} payroll`}
        subtitle={`Created by ${nameOf(payroll.created_by)} on ${formatDayTime(payroll.created_at)} · ${items.length} ${
          items.length === 1 ? 'employee' : 'employees'
        }`}
        back="/finance/payroll"
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              label={PAYROLL_STATUS_LABELS[payroll.status]}
              color={PAYROLL_STATUS_COLORS[payroll.status]}
              variant={payroll.status === 'processed' ? 'filled' : 'outlined'}
            />
            {moves.map((to) => (
              <Button
                key={to}
                variant={to === 'draft' ? 'text' : 'contained'}
                onClick={() => setMoving(to)}
              >
                {MOVES[to].label}
              </Button>
            ))}
          </Stack>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {payroll.status === 'review' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Sent for review by {nameOf(payroll.submitted_by)} on {formatDayTime(payroll.submitted_at ?? '')}. Nothing
          can be changed while it’s in review.{' '}
          {isCompanyAdmin
            ? 'Approve it, or send it back to draft for changes.'
            : 'A company admin approves it or sends it back to draft.'}
        </Alert>
      )}
      {payroll.status === 'approved' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Approved by {nameOf(payroll.approved_by)} on {formatDayTime(payroll.approved_at ?? '')}.{' '}
          {isFinance ? 'Mark it processed once salaries are paid.' : 'Finance marks it processed once salaries are paid.'}
        </Alert>
      )}
      {payroll.status === 'processed' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Processed by {nameOf(payroll.processed_by)} on {formatDayTime(payroll.processed_at ?? '')}.
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2, justifyContent: 'flex-end' }}>
        {draft && (
          <Button
            startIcon={<AddIcon />}
            onClick={() => {
              setAddId('')
              setFormError(null)
              setAdding(true)
            }}
          >
            Add employee
          </Button>
        )}
        <Button startIcon={<DownloadIcon />} onClick={() => downloadCsv(csvFileName(payroll), payrollCsv(items))}>
          Download CSV
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <TableContainer>
          <Table
            size="small"
            sx={{
              minWidth: 1700,
              '& td, & th': { whiteSpace: 'nowrap' },
              '& .MuiTableRow-hover:hover > [data-pinned]': {
                backgroundImage: (t) => `linear-gradient(${t.palette.action.hover}, ${t.palette.action.hover})`,
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell ref={numberHeader} data-pinned sx={numberCol}>
                  Emp #
                </TableCell>
                <TableCell data-pinned sx={nameCol}>
                  Name
                </TableCell>
                {AMOUNT_COLUMNS.map(([key, label]) => (
                  <TableCell key={key} align="right">
                    {label}
                  </TableCell>
                ))}
                <TableCell>HR remarks</TableCell>
                <TableCell>Finance remarks</TableCell>
                {draft && <TableCell sx={{ width: 96 }} />}
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((i) => (
                <TableRow
                  key={i.id}
                  hover
                  // While a draft, the whole row opens the editor, like its Edit button.
                  onClick={draft ? () => openEditor(i) : undefined}
                  sx={draft ? { cursor: 'pointer' } : undefined}
                >
                  <TableCell data-pinned sx={numberCol}>
                    {formatEmployeeNumber(i.employee_number)}
                  </TableCell>
                  <TableCell data-pinned sx={{ ...nameCol, fontWeight: 500 }}>
                    {i.full_name}
                  </TableCell>
                  {AMOUNT_COLUMNS.map(([key]) => (
                    <TableCell
                      key={key}
                      align="right"
                      sx={key === 'net_salary' || key === 'gross_salary' ? { fontWeight: 600 } : undefined}
                    >
                      {key === 'absent_days' ? i.absent_days : formatAmount(i[key])}
                      {key === 'bonus' && i.bonus_type === 'percent' && (
                        <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 0.5 }}>
                          ({i.bonus_value}%)
                        </Typography>
                      )}
                    </TableCell>
                  ))}
                  {[i.hr_remarks, i.finance_remarks].map((remarks, n) => (
                    <TableCell key={n} title={remarks ?? undefined} sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {remarks}
                    </TableCell>
                  ))}
                  {draft && (
                    <TableCell align="right">
                      <IconButton
                        aria-label={`Edit ${i.full_name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          openEditor(i)
                        }}
                      >
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        aria-label={`Remove ${i.full_name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRemoving(i)
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {!items.length && (
                <TableRow>
                  <TableCell colSpan={AMOUNT_COLUMNS.length + 5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    Nobody is on this payroll.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {!!items.length && (
              <TableFooter>
                <TableRow sx={{ '& td': { fontWeight: 600, color: 'text.primary', fontSize: 'inherit' } }}>
                  <TableCell data-pinned sx={numberCol} />
                  <TableCell data-pinned sx={nameCol}>
                    Total
                  </TableCell>
                  {AMOUNT_COLUMNS.map(([key]) => (
                    <TableCell key={key} align="right">
                      {key === 'absent_days' ? totalOf(items, key) : formatAmount(totalOf(items, key))}
                    </TableCell>
                  ))}
                  <TableCell colSpan={draft ? 3 : 2} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={!!editing}
        title={editing ? `${editing.full_name} · ${period}` : ''}
        error={formError}
        busy={busy}
        closeButton
        onSubmit={save}
        onClose={() => setEditing(null)}
      >
        <Typography variant="subtitle2">HR</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          {field('basic_salary', 'Basic salary', isHr, { autoFocus: isHr })}
          {field('contractual_amount', 'Contractual amount', isHr)}
          {field('absent_days', 'Absent days', isHr, { helperText: 'Half days allowed, e.g. 1.5' })}
        </Box>
        {field('hr_remarks', 'HR remarks', isHr)}

        <Typography variant="subtitle2">Finance</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          {form && (
            <TextField
              select
              label="Bonus as"
              value={form.bonus_type}
              onChange={(e) => setForm((v) => v && { ...v, bonus_type: e.target.value })}
              disabled={!isFinance}
              fullWidth
            >
              <MenuItem value="amount">Amount</MenuItem>
              <MenuItem value="percent">% of basic salary</MenuItem>
            </TextField>
          )}
          {field('bonus_value', form?.bonus_type === 'percent' ? 'Bonus %' : 'Bonus', isFinance, {
            autoFocus: !isHr && isFinance,
          })}
          {field('absent_deduction', 'Absent deduction', isFinance)}
          {field('allowance', 'Allowance', isFinance)}
          {field('arrears', 'Arrears', isFinance)}
          {field('advance_salary', 'Advance salary', isFinance)}
          {field('loan_deduction', 'Loan deduction', isFinance)}
          {field('tax_amount', 'Tax amount', isFinance)}
        </Box>
        {field('finance_remarks', 'Finance remarks', isFinance)}

        {preview && (
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover' }} aria-label="Worked out">
            <Typography variant="body2">
              Gross salary <strong>PKR {formatAmount(grossOf(preview))}</strong> · Net payable{' '}
              <strong>PKR {formatAmount(netOf(preview))}</strong>
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Gross = basic + contractual + bonus + allowance + arrears − absent deduction. Net = gross − advance − loan − tax.
            </Typography>
          </Paper>
        )}
      </FormDialog>

      <FormDialog
        open={adding}
        title={`Add to the ${period} payroll`}
        submitLabel="Add"
        error={formError}
        busy={busy}
        onSubmit={add}
        onClose={() => setAdding(false)}
      >
        {candidates.length ? (
          <TextField
            select
            label="Employee"
            required
            fullWidth
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            helperText="Only people on probation, active or on their notice period can be added."
          >
            {candidates.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.full_name} ({formatEmployeeNumber(p.employee_number)})
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Everyone on probation, active or on their notice period is already on this payroll.
          </Typography>
        )}
      </FormDialog>

      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.full_name ?? ''}?`}
        message={`They’ll be taken off the ${period} payroll, with their figures. They can be added again while it’s a draft.`}
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={!!moving}
        title={moving ? `${MOVES[moving].label}?` : ''}
        message={moving ? MOVES[moving].message(period) : ''}
        confirmLabel={moving ? MOVES[moving].label : ''}
        busy={busy}
        onConfirm={move}
        onClose={() => setMoving(null)}
      />
    </>
  )
}
