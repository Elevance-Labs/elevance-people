import type { ChipProps } from '@mui/material'
import type {
  AppRole,
  ApplicationStage,
  BusinessFunction,
  EmployeeStatus,
  EmploymentType,
  EquipmentStatus,
  LoginMethod,
  JobOpeningStatus,
  LeaveStatus,
  OffboardingReason,
  OnboardingStatus,
  PayrollStatus,
  ReimbursementStatus,
  SalaryRevisionStatus,
} from './types'

export const COMPANY_NAME = 'Elevance Labs'
export const COMPANY_DOMAIN = 'elevancelabs.com'

// The employee handbook: a Google Doc shared as "anyone with the link can
// view". /preview is the read-only view Google lets other sites frame.
const HANDBOOK_DOC = 'https://docs.google.com/document/d/1oaRIkwBnbl4CmCAvxiSf4NYrsNzrOPK1fylNSZvfBus'
export const HANDBOOK_URL = `${HANDBOOK_DOC}/edit?usp=sharing`
export const HANDBOOK_EMBED_URL = `${HANDBOOK_DOC}/preview`

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  member: 'Member',
  hr_admin: 'HR Admin',
  finance_admin: 'Finance Admin',
  company_admin: 'Company Admin',
}

export const LOGIN_METHOD_LABELS: Record<LoginMethod, string> = {
  google: `Google (@${COMPANY_DOMAIN})`,
  password: 'Email and password',
}

export const BUSINESS_FUNCTION_LABELS: Record<BusinessFunction, string> = {
  production: 'Production',
  growth: 'Growth',
  operations: 'Operations',
}

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  freelance: 'Freelance',
  contract: 'Contract',
}

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  joining: 'Joining',
  probation: 'Probation',
  active: 'Active',
  notice_period: 'Notice period',
  left: 'Left',
  terminated: 'Terminated',
}

export const STATUS_COLORS: Record<EmployeeStatus, ChipProps['color']> = {
  joining: 'info',
  probation: 'warning',
  active: 'success',
  notice_period: 'secondary',
  left: 'default',
  terminated: 'error',
}

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export const LEAVE_STATUS_COLORS: Record<LeaveStatus, ChipProps['color']> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  cancelled: 'default',
}

export const JOB_STATUS_LABELS: Record<JobOpeningStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  on_hold: 'On hold',
  closed: 'Closed',
}

export const JOB_STATUS_COLORS: Record<JobOpeningStatus, ChipProps['color']> = {
  draft: 'default',
  open: 'success',
  on_hold: 'warning',
  closed: 'default',
}

// In board order.
export const STAGE_LABELS: Record<ApplicationStage, string> = {
  new: 'New',
  screened: 'Screened',
  shortlisted: 'Shortlisted',
  test: 'Test',
  interview_1: 'Interview 1',
  interview_2: 'Interview 2',
  interview_3: 'Interview 3',
  cleared: 'Cleared',
  shelf: 'Shelf',
  offer_sent: 'Offer sent',
  hired: 'Hired',
  rejected: 'Rejected',
  abandoned: 'Abandoned',
  declined: 'Declined',
}

export const STAGE_COLORS: Record<ApplicationStage, ChipProps['color']> = {
  new: 'default',
  screened: 'info',
  shortlisted: 'info',
  test: 'secondary',
  interview_1: 'primary',
  interview_2: 'primary',
  interview_3: 'primary',
  cleared: 'success',
  shelf: 'warning',
  offer_sent: 'success',
  hired: 'success',
  rejected: 'error',
  abandoned: 'default',
  declined: 'default',
}

export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const ONBOARDING_STATUS_COLORS: Record<OnboardingStatus, ChipProps['color']> = {
  in_progress: 'info',
  completed: 'success',
  cancelled: 'default',
}

export const OFFBOARDING_REASON_LABELS: Record<OffboardingReason, string> = {
  resigned: 'Resigned',
  terminated: 'Terminated',
  contract_ended: 'Contract ended',
  other: 'Other',
}

export const SALARY_REVISION_STATUS_LABELS: Record<SalaryRevisionStatus, string> = {
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
}

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
  processed: 'Processed',
  disbursed: 'Disbursed',
}

export const PAYROLL_STATUS_COLORS: Record<PayrollStatus, ChipProps['color']> = {
  draft: 'default',
  review: 'warning',
  approved: 'info',
  processed: 'primary',
  disbursed: 'success',
}

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  requested: 'Requested',
  active: 'Active',
  faulty: 'Faulty',
  retired: 'Retired',
  sold: 'Sold',
}

export const EQUIPMENT_STATUS_COLORS: Record<EquipmentStatus, ChipProps['color']> = {
  requested: 'info',
  active: 'success',
  faulty: 'warning',
  retired: 'default',
  sold: 'default',
}

export const REIMBURSEMENT_STATUS_LABELS: Record<ReimbursementStatus, string> = {
  review: 'In review',
  approved: 'Approved',
  processed: 'Processed',
  disbursed: 'Disbursed',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export const REIMBURSEMENT_STATUS_COLORS: Record<ReimbursementStatus, ChipProps['color']> = {
  review: 'warning',
  approved: 'info',
  processed: 'primary',
  disbursed: 'success',
  rejected: 'error',
  withdrawn: 'default',
}

export function formatPkr(amount: number) {
  return `PKR ${amount.toLocaleString('en-PK')}`
}

export const DOC_TYPES = [
  'CNIC',
  'Passport',
  'Photo',
  'Resume / CV',
  'Offer letter',
  'Contract',
  'Educational certificate',
  'Experience letter',
  'Other',
]

export const DOC_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf'
export const DOC_MAX_BYTES = 10 * 1024 * 1024

// Mirrored by the job-applications and branding buckets' limits.
export const CV_MAX_BYTES = 6 * 1024 * 1024
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp'
export const LOGO_MAX_BYTES = 2 * 1024 * 1024

// Mirrored by the equipment bucket's limits. An invoice may be a PDF; the
// equipment photo is an image.
export const EQUIPMENT_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'
export const EQUIPMENT_INVOICE_ACCEPT = `${EQUIPMENT_PHOTO_ACCEPT},application/pdf`
export const EQUIPMENT_FILE_MAX_BYTES = 10 * 1024 * 1024

// Mirrored by the reimbursements bucket's limits: receipts and proof of
// payment are images or PDFs.
export const REIMBURSEMENT_FILE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'
export const REIMBURSEMENT_FILE_MAX_BYTES = 10 * 1024 * 1024

export function formatEmployeeNumber(n: number) {
  return `#${String(n).padStart(4, '0')}`
}

// Dates are stored as plain YYYY-MM-DD; parse as local time so they don't shift a day.
export function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// A timestamptz (e.g. created_at), as the day it was in the viewer's time zone.
export function formatDay(timestamp: string) {
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// A timestamptz with its time, e.g. for a timeline.
export function formatDayTime(timestamp: string) {
  return new Date(timestamp).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDateRange(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`
}

export function formatDays(n: number) {
  return `${n} ${n === 1 || n === 0.5 ? 'day' : 'days'}`
}
