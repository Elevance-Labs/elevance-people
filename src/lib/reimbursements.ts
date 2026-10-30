import { REIMBURSEMENT_FILE_ACCEPT, REIMBURSEMENT_FILE_MAX_BYTES } from './constants'
import { REIMBURSEMENTS_BUCKET, supabase } from './supabase'
import type { Reimbursement, ReimbursementStatus } from './types'

export const REIMBURSEMENT_SELECT =
  'id, employee_id, description, expense_date, amount, receipt_paths, status, created_at, updated_at, ' +
  'approved_by, approved_at, processed_by, processed_at, disbursed_by, disbursed_at, rejected_by, rejected_at, ' +
  'rejection_reason, withdrawn_at, transaction_date, transaction_reference, transaction_proof_path, created_by'

// Mirrors of the table's checks.
export const MAX_RECEIPTS = 3
export const DESCRIPTION_MAX = 2000
export const REFERENCE_MAX = 200

// What the viewer may do to a claim now. Mirrors reimbursement_move and
// reimbursement_disburse: the employee, or whoever made the claim, withdraws
// it while in review; HR approves or rejects one in review; finance
// processes or rejects an approved one and disburses a processed one. Nobody
// decides a claim that is theirs or that they made.
export type ReimbursementAction = 'withdraw' | 'approve' | 'reject' | 'process' | 'disburse'

export function reimbursementActions(
  claim: Pick<Reimbursement, 'employee_id' | 'created_by' | 'status'>,
  viewer: { id: string; isHr: boolean; isFinance: boolean },
): ReimbursementAction[] {
  if (claim.employee_id === viewer.id || claim.created_by === viewer.id) return claim.status === 'review' ? ['withdraw'] : []
  if (claim.status === 'review' && viewer.isHr) return ['approve', 'reject']
  if (claim.status === 'approved' && viewer.isFinance) return ['process', 'reject']
  if (claim.status === 'processed' && viewer.isFinance) return ['disburse']
  return []
}

// Still to be paid out.
export const OPEN_STATUSES: ReimbursementStatus[] = ['review', 'approved', 'processed']

export function fileProblem(file: File) {
  if (!REIMBURSEMENT_FILE_ACCEPT.split(',').includes(file.type)) return 'Files must be JPEG, PNG or WebP images, or PDFs.'
  if (file.size > REIMBURSEMENT_FILE_MAX_BYTES) return 'Files must be 10 MB or smaller.'
  return null
}

// Upload a receipt or proof of payment into the employee's folder under a
// fresh name; returns its path.
export async function uploadReimbursementFile(employeeId: string, file: File) {
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1].replace('jpeg', 'jpg')
  const path = `${employeeId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(REIMBURSEMENTS_BUCKET).upload(path, file, { contentType: file.type })
  return { path, error }
}

// Only files no claim points at can go (the bucket's policy).
export const removeReimbursementFiles = (paths: (string | null | undefined)[]) => {
  const list = paths.filter((p): p is string => !!p)
  return list.length ? supabase.storage.from(REIMBURSEMENTS_BUCKET).remove(list) : Promise.resolve({ error: null })
}

export function reimbursementError(error: { code?: string; message: string }) {
  if (error.code === '42501' && /permission denied|row-level security/.test(error.message))
    return 'You can’t claim reimbursements. Ask HR if you think you should.'
  return error.message
}
