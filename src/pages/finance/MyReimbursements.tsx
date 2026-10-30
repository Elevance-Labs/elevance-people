import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
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
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import { useAuth } from '../../auth/AuthProvider'
import { FormDialog, PageHeader } from '../../components/common'
import { ReimbursementDialog, ReimbursementStatusChip } from '../../components/Reimbursements'
import { supabase } from '../../lib/supabase'
import { REIMBURSEMENT_FILE_ACCEPT, formatDate, formatDay, formatPkr } from '../../lib/constants'
import { todayIso } from '../../lib/leaves'
import {
  DESCRIPTION_MAX,
  MAX_RECEIPTS,
  OPEN_STATUSES,
  REIMBURSEMENT_SELECT,
  fileProblem,
  reimbursementError,
  removeReimbursementFiles,
  uploadReimbursementFile,
} from '../../lib/reimbursements'
import type { DirectoryEntry, Reimbursement } from '../../lib/types'

const EMPTY = { employee_id: '', description: '', expense_date: '', amount: '' }
// Statuses that may log in (is_login_status): who a claim can be made for.
const LOGIN_STATUSES = ['probation', 'active', 'notice_period']

type Person = Pick<DirectoryEntry, 'id' | 'full_name' | 'status'>

// Home → My reimbursements: for people HR allows to claim, and HR / finance.
// Their own claims, and (HR / finance) those they made for others, newest
// first; a new claim goes straight into review. HR and finance pick who a
// claim is for, themselves by default. A row opens the claim, where one in
// review can be withdrawn.
export default function MyReimbursements() {
  const { employee, isHr, isFinance, canManagePayroll } = useAuth()
  const me = employee!.id
  const [claims, setClaims] = useState<Reimbursement[]>([])
  const [directory, setDirectory] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [receipts, setReceipts] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const receiptInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const [mineRes, madeRes, directoryRes] = await Promise.all([
      supabase.from('reimbursements').select(REIMBURSEMENT_SELECT).eq('employee_id', me),
      canManagePayroll
        ? supabase.from('reimbursements').select(REIMBURSEMENT_SELECT).eq('created_by', me)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('employee_directory').select('id, full_name, status').order('full_name'),
    ])
    const loadError = mineRes.error ?? madeRes.error ?? directoryRes.error
    if (loadError) setError(loadError.message)
    else {
      const all = [...(mineRes.data as unknown as Reimbursement[]), ...(madeRes.data as unknown as Reimbursement[])]
      setClaims(
        all
          .filter((c, i) => all.findIndex((x) => x.id === c.id) === i)
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      )
      setDirectory(directoryRes.data as Person[])
    }
    setLoading(false)
  }, [me, canManagePayroll])

  useEffect(() => {
    load()
  }, [load])

  const nameOf = (id: string | null) => (id ? (directory.find((p) => p.id === id)?.full_name ?? '—') : '—')
  // Still to be paid to the viewer, not to people they claimed for.
  const pending = claims
    .filter((c) => c.employee_id === me && OPEN_STATUSES.includes(c.status))
    .reduce((sum, c) => sum + Number(c.amount), 0)
  // Who HR / finance can claim for: themselves first, then everyone who may log in.
  const claimable = [
    { id: me, full_name: `Me (${employee!.full_name})` },
    ...directory.filter((p) => p.id !== me && LOGIN_STATUSES.includes(p.status)),
  ]
  const openClaim = claims.find((c) => c.id === openId) ?? null

  function startClaim() {
    setForm({ ...EMPTY, employee_id: me })
    setReceipts([])
    setFormError(null)
    setAdding(true)
  }

  function addReceipts(files: File[]) {
    const problem = files.map(fileProblem).find(Boolean)
    if (problem) return setFormError(problem)
    if (receipts.length + files.length > MAX_RECEIPTS) return setFormError(`Attach up to ${MAX_RECEIPTS} receipts.`)
    setFormError(null)
    setReceipts([...receipts, ...files])
  }

  async function submit() {
    const amount = Number(form.amount)
    if (!form.description.trim()) return setFormError('Describe the expense.')
    if (!form.expense_date) return setFormError('Enter the expense date.')
    if (form.expense_date > todayIso()) return setFormError('The expense date can’t be in the future.')
    if (!(amount > 0)) return setFormError('Enter the amount spent.')
    if (!receipts.length) return setFormError('Attach at least one receipt.')
    setBusy(true)
    setFormError(null)

    // Upload the receipts first; undo the uploads if the claim isn't saved.
    const paths: string[] = []
    for (const file of receipts) {
      const { path, error: uploadError } = await uploadReimbursementFile(form.employee_id, file)
      if (uploadError) {
        await removeReimbursementFiles(paths)
        setBusy(false)
        return setFormError(`A receipt couldn’t be uploaded: ${uploadError.message}`)
      }
      paths.push(path)
    }
    const { error: saveError } = await supabase.from('reimbursements').insert({
      employee_id: form.employee_id,
      description: form.description.trim(),
      expense_date: form.expense_date,
      amount: Math.round(amount * 100) / 100,
      receipt_paths: paths,
    })
    if (saveError) {
      await removeReimbursementFiles(paths)
      setBusy(false)
      return setFormError(reimbursementError(saveError))
    }
    setBusy(false)
    setAdding(false)
    load()
  }

  return (
    <>
      <PageHeader
        title="My reimbursements"
        subtitle={loading ? 'Loading…' : pending ? `${formatPkr(pending)} still to be paid` : 'Claim back what you spend for work.'}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={startClaim}>
            New claim
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {canManagePayroll && <TableCell>For</TableCell>}
                <TableCell>Expense</TableCell>
                <TableCell>Date</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Submitted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {claims.map((c) => (
                <TableRow
                  key={c.id}
                  hover
                  onClick={() => setOpenId(c.id)}
                  sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                >
                  {canManagePayroll && <TableCell>{c.employee_id === me ? 'You' : nameOf(c.employee_id)}</TableCell>}
                  <TableCell sx={{ maxWidth: 360 }}>
                    <Typography variant="body2" noWrap>
                      {c.description}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatDate(c.expense_date)}</TableCell>
                  <TableCell align="right">{formatPkr(Number(c.amount))}</TableCell>
                  <TableCell>
                    <ReimbursementStatusChip status={c.status} />
                  </TableCell>
                  <TableCell>{formatDay(c.created_at)}</TableCell>
                </TableRow>
              ))}
              {!loading && !claims.length && (
                <TableRow>
                  <TableCell colSpan={canManagePayroll ? 6 : 5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    No claims yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {openClaim && (
        <ReimbursementDialog
          claim={openClaim}
          viewer={{ id: me, isHr, isFinance }}
          nameOf={nameOf}
          onChanged={() => {
            setOpenId(null)
            load()
          }}
          onClose={() => setOpenId(null)}
        />
      )}

      <FormDialog
        open={adding}
        title="New claim"
        submitLabel="Submit"
        error={formError}
        busy={busy}
        onSubmit={submit}
        onClose={() => setAdding(false)}
      >
        {canManagePayroll && (
          <TextField
            select
            label="Claim for"
            required
            value={form.employee_id}
            onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            helperText={form.employee_id === me ? undefined : 'They see it in My reimbursements if HR lets them claim.'}
          >
            {claimable.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.full_name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          label="Description"
          required
          multiline
          minRows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          helperText="What it was for."
          slotProps={{ htmlInput: { maxLength: DESCRIPTION_MAX } }}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Expense date"
            type="date"
            required
            fullWidth
            value={form.expense_date}
            onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIso() } }}
          />
          <TextField
            label="Amount (PKR)"
            type="number"
            required
            fullWidth
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
          />
        </Stack>
        <Stack spacing={1}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Receipts: photos or PDFs, 1 to {MAX_RECEIPTS}
          </Typography>
          {receipts.map((file, i) => (
            <Stack key={`${file.name}-${i}`} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>
                {file.name}
              </Typography>
              <IconButton
                size="small"
                aria-label={`Remove ${file.name}`}
                onClick={() => setReceipts(receipts.filter((_, j) => j !== i))}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          {receipts.length < MAX_RECEIPTS && (
            <Button size="small" variant="outlined" sx={{ alignSelf: 'flex-start' }} onClick={() => receiptInput.current?.click()}>
              Add receipt
            </Button>
          )}
          <input
            ref={receiptInput}
            type="file"
            hidden
            multiple
            accept={REIMBURSEMENT_FILE_ACCEPT}
            aria-label="Receipt file"
            onChange={(e) => {
              addReceipts([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </Stack>
      </FormDialog>
    </>
  )
}
