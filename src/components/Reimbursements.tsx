import { useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
  type ChipProps,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { REIMBURSEMENTS_BUCKET, supabase } from '../lib/supabase'
import {
  REIMBURSEMENT_FILE_ACCEPT,
  REIMBURSEMENT_STATUS_COLORS,
  REIMBURSEMENT_STATUS_LABELS,
  formatDate,
  formatDayTime,
  formatPkr,
} from '../lib/constants'
import { todayIso } from '../lib/leaves'
import {
  REFERENCE_MAX,
  fileProblem,
  reimbursementActions,
  removeReimbursementFiles,
  uploadReimbursementFile,
} from '../lib/reimbursements'
import type { Reimbursement, ReimbursementStatus } from '../lib/types'

export function ReimbursementStatusChip({
  status,
  size = 'small',
}: {
  status: ReimbursementStatus
  size?: ChipProps['size']
}) {
  return (
    <Chip
      label={REIMBURSEMENT_STATUS_LABELS[status]}
      color={REIMBURSEMENT_STATUS_COLORS[status]}
      size={size}
      variant={status === 'disbursed' ? 'filled' : 'outlined'}
    />
  )
}

// Opens a receipt or proof in a new tab through a short-lived link (the
// bucket is private). Returns an error message, if any.
async function openFile(path: string) {
  // Open the tab synchronously so popup blockers allow it, then point it at the signed URL.
  const tab = window.open('', '_blank')
  // The opened file gets no handle back to this page.
  if (tab) tab.opener = null
  const { data, error } = await supabase.storage.from(REIMBURSEMENTS_BUCKET).createSignedUrl(path, 60)
  if (error || !data) {
    tab?.close()
    return error?.message ?? 'Could not open the file.'
  }
  if (tab) tab.location.href = data.signedUrl
  else window.location.href = data.signedUrl
  return null
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div">
        {children}
      </Typography>
    </Box>
  )
}

type Mode = 'view' | 'reject' | 'disburse' | 'withdraw'

// One claim: its details, receipts and history, and whatever the viewer may
// do to it now (reimbursementActions). Status moves go through
// reimbursement_move / reimbursement_disburse; `onChanged` reloads.
export function ReimbursementDialog({
  claim,
  viewer,
  nameOf,
  onChanged,
  onClose,
}: {
  claim: Reimbursement
  viewer: { id: string; isHr: boolean; isFinance: boolean }
  nameOf: (id: string | null) => string
  onChanged: () => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('view')
  const [reason, setReason] = useState('')
  const [txDate, setTxDate] = useState(todayIso())
  const [reference, setReference] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const proofInput = useRef<HTMLInputElement>(null)
  const actions = reimbursementActions(claim, viewer)
  const own = claim.employee_id === viewer.id

  async function open(path: string) {
    setError(await openFile(path))
  }

  async function move(status: ReimbursementStatus, why: string | null = null) {
    setBusy(true)
    setError(null)
    const { error: moveError } = await supabase.rpc('reimbursement_move', {
      p_reimbursement_id: claim.id,
      p_status: status,
      p_reason: why,
    })
    setBusy(false)
    if (moveError) return setError(moveError.message)
    onChanged()
  }

  async function reject() {
    if (!reason.trim()) return setError('Give a reason for rejecting the claim.')
    await move('rejected', reason.trim())
  }

  async function disburse() {
    if (!txDate) return setError('Enter the transaction date.')
    if (txDate > todayIso()) return setError('The transaction date can’t be in the future.')
    if (!reference.trim() && !proof) return setError('Enter the transaction reference or upload proof of payment.')
    setBusy(true)
    setError(null)
    let proofPath: string | null = null
    if (proof) {
      const uploaded = await uploadReimbursementFile(claim.employee_id, proof)
      if (uploaded.error) {
        setBusy(false)
        return setError(`The proof couldn’t be uploaded: ${uploaded.error.message}`)
      }
      proofPath = uploaded.path
    }
    const { error: disburseError } = await supabase.rpc('reimbursement_disburse', {
      p_reimbursement_id: claim.id,
      p_transaction_date: txDate,
      p_reference: reference.trim() || null,
      p_proof_path: proofPath,
    })
    if (disburseError) {
      await removeReimbursementFiles([proofPath])
      setBusy(false)
      return setError(disburseError.message)
    }
    setBusy(false)
    onChanged()
  }

  function pickProof(file: File | undefined) {
    if (!file) return
    const problem = fileProblem(file)
    setError(problem)
    if (!problem) setProof(file)
  }

  const history: [string, string | null, string | null][] = [
    ['Submitted', claim.created_by ?? claim.employee_id, claim.created_at],
    ['Approved', claim.approved_by, claim.approved_at],
    ['Processed', claim.processed_by, claim.processed_at],
    ['Disbursed', claim.disbursed_by, claim.disbursed_at],
    ['Rejected', claim.rejected_by, claim.rejected_at],
    ['Withdrawn', claim.employee_id, claim.withdrawn_at],
  ]

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 7 }}>
        {own ? 'Your claim' : `${nameOf(claim.employee_id)}’s claim`}
      </DialogTitle>
      <IconButton aria-label="Close" onClick={onClose} disabled={busy} sx={{ position: 'absolute', top: 12, right: 12 }}>
        <CloseIcon />
      </IconButton>
      <DialogContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="h6">{formatPkr(Number(claim.amount))}</Typography>
            <ReimbursementStatusChip status={claim.status} />
          </Stack>
          <Detail label="Description">
            <Box sx={{ whiteSpace: 'pre-wrap' }}>{claim.description}</Box>
          </Detail>
          {claim.created_by && claim.created_by !== claim.employee_id && (
            <Detail label="Claimed by">
              {claim.created_by === viewer.id ? 'You' : nameOf(claim.created_by)}, for{' '}
              {own ? 'you' : nameOf(claim.employee_id)}
            </Detail>
          )}
          <Detail label="Expense date">{formatDate(claim.expense_date)}</Detail>
          <Detail label="Receipts">
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mt: 0.5 }}>
              {claim.receipt_paths.map((path, i) => (
                <Button key={path} size="small" variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => open(path)}>
                  Receipt {i + 1}
                </Button>
              ))}
            </Stack>
          </Detail>
          {claim.status === 'rejected' && (
            <Alert severity="error">
              Rejected by {nameOf(claim.rejected_by)}: {claim.rejection_reason}
            </Alert>
          )}
          {claim.status === 'disbursed' && (
            <Detail label="Payment">
              Paid on {formatDate(claim.transaction_date)}
              {claim.transaction_reference && <> · Reference {claim.transaction_reference}</>}
              {claim.transaction_proof_path && (
                <Box sx={{ mt: 0.5 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<OpenInNewIcon />}
                    onClick={() => open(claim.transaction_proof_path!)}
                  >
                    Proof of payment
                  </Button>
                </Box>
              )}
            </Detail>
          )}
          <Detail label="History">
            {history
              .filter(([, , at]) => at)
              .map(([what, who, at]) => (
                <Box key={what}>
                  {what} by {nameOf(who)}, {formatDayTime(at!)}
                </Box>
              ))}
          </Detail>

          {mode === 'reject' && (
            <TextField
              label="Reason for rejecting"
              required
              multiline
              minRows={2}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              helperText="The employee sees this."
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
          )}
          {mode === 'disburse' && (
            <Stack spacing={2}>
              <TextField
                label="Transaction date"
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIso() } }}
              />
              <TextField
                label="Transaction reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                helperText="Or upload proof of payment, or both."
                slotProps={{ htmlInput: { maxLength: REFERENCE_MAX } }}
              />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button size="small" variant="outlined" onClick={() => proofInput.current?.click()}>
                  {proof ? 'Replace proof' : 'Upload proof of payment'}
                </Button>
                {proof && (
                  <>
                    <Typography variant="body2" noWrap>
                      {proof.name}
                    </Typography>
                    <Button size="small" color="error" onClick={() => setProof(null)}>
                      Remove
                    </Button>
                  </>
                )}
              </Stack>
              <input
                ref={proofInput}
                type="file"
                hidden
                accept={REIMBURSEMENT_FILE_ACCEPT}
                aria-label="Proof of payment file"
                onChange={(e) => {
                  pickProof(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </Stack>
          )}
          {mode === 'withdraw' && (
            <Alert severity="warning">Withdraw this claim? It can’t be submitted again; you can make a new one.</Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      {actions.length > 0 && (
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {mode === 'view' ? (
            <>
              {actions.includes('withdraw') && (
                <Button color="error" onClick={() => setMode('withdraw')}>
                  Withdraw
                </Button>
              )}
              {actions.includes('reject') && (
                <Button color="error" onClick={() => setMode('reject')}>
                  Reject
                </Button>
              )}
              {actions.includes('approve') && (
                <Button variant="contained" loading={busy} onClick={() => move('approved')}>
                  Approve
                </Button>
              )}
              {actions.includes('process') && (
                <Button variant="contained" loading={busy} onClick={() => move('processed')}>
                  Mark processed
                </Button>
              )}
              {actions.includes('disburse') && (
                <Button variant="contained" onClick={() => setMode('disburse')}>
                  Mark disbursed
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                disabled={busy}
                onClick={() => {
                  setMode('view')
                  setError(null)
                }}
              >
                Back
              </Button>
              {mode === 'reject' && (
                <Button variant="contained" color="error" loading={busy} onClick={reject}>
                  Reject claim
                </Button>
              )}
              {mode === 'withdraw' && (
                <Button variant="contained" color="error" loading={busy} onClick={() => move('withdrawn')}>
                  Withdraw claim
                </Button>
              )}
              {mode === 'disburse' && (
                <Button variant="contained" loading={busy} onClick={disburse}>
                  Mark disbursed
                </Button>
              )}
            </>
          )}
        </DialogActions>
      )}
    </Dialog>
  )
}
