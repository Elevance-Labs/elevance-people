export type AppRole = 'company_admin' | 'hr_admin' | 'finance_admin' | 'member'
export type EmploymentType = 'full_time' | 'part_time' | 'freelance' | 'contract'
export type EmployeeStatus =
  | 'joining'
  | 'probation'
  | 'active'
  | 'notice_period'
  | 'left'
  | 'terminated'

export interface Employee {
  id: string
  employee_number: number
  user_id: string | null
  full_name: string
  company_email: string
  date_of_joining: string
  date_of_separation: string | null
  personal_email: string | null
  phone: string | null
  cnic_number: string | null
  cnic_expiry: string | null
  dob: string | null
  department_id: string | null
  designation_id: string | null
  bank: string | null
  iban: string | null
  emergency_contact: string | null
  employment_type: EmploymentType
  status: EmployeeStatus
  app_role: AppRole
  created_at: string
  updated_at: string
}

export type BusinessFunction = 'production' | 'growth' | 'operations'

export interface Department {
  id: string
  name: string
  description: string | null
  // Null only for departments made before functions existed.
  business_function: BusinessFunction | null
}

// A per-function doc on the Resources page. RLS: the reader's own function
// only, or all for company admins.
export interface Guide {
  id: string
  slug: string
  title: string
  description: string | null
  business_function: BusinessFunction
  // Null until the doc exists.
  doc_url: string | null
  sort_order: number
}

export interface Designation {
  id: string
  department_id: string
  title: string
  description: string | null
}

export interface Kpi {
  id: string
  designation_id: string
  name: string
  description: string | null
  target: string | null
  weight: number | null
}

// What a designation is expected to do; marked met or not in each monthly review.
export interface Expectation {
  id: string
  designation_id: string
  title: string
}

export interface EmployeeDocument {
  id: string
  employee_id: string
  doc_type: string
  file_name: string
  storage_path: string
  mime_type: string
  size_bytes: number
  created_at: string
  deleted_at: string | null
}

export interface DirectoryEntry {
  id: string
  employee_number: number
  full_name: string
  company_email: string
  designation: string | null
  department: string | null
  status: EmployeeStatus
}

export interface OrgNode {
  employee_id: string
  manager_id: string | null
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface LeaveType {
  id: string
  name: string
  description: string | null
  annual_quota: number | null
  is_active: boolean
}

export interface LeaveQuota {
  employee_id: string
  leave_type_id: string
  year: number
  days: number
}

export interface Leave {
  id: string
  employee_id: string
  leave_type_id: string
  start_date: string
  end_date: string
  half_day: boolean
  // Working days, counted by the database (weekends and holidays left out).
  days: number
  reason: string | null
  status: LeaveStatus
  created_by: string | null
  hr_approved_by: string | null
  hr_approved_at: string | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  edited_by: string | null
  edited_at: string | null
  created_at: string
  updated_at: string
}

// A public holiday: a date range within one year. Leaves don't count it.
export interface Holiday {
  id: string
  name: string
  start_date: string
  end_date: string
}

// A row of the leave_balances RPC.
export interface LeaveBalance {
  leave_type_id: string
  name: string
  quota: number | null
  approved: number
  pending: number
}

export type JobOpeningStatus = 'draft' | 'open' | 'on_hold' | 'closed'

export interface JobOpening {
  id: string
  title: string
  department_id: string
  designation_id: string
  status: JobOpeningStatus
  // Last day applications are accepted; null = until the job is closed.
  due_date: string | null
  // Sanitised HTML.
  description: string | null
  manager_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface JobOpeningInterviewer {
  job_opening_id: string
  employee_id: string
}

export type ApplicationStage =
  | 'new'
  | 'screened'
  | 'shortlisted'
  | 'test'
  | 'interview_1'
  | 'interview_2'
  | 'interview_3'
  | 'cleared'
  | 'shelf'
  | 'offer_sent'
  | 'hired'
  | 'rejected'
  | 'abandoned'
  | 'declined'

export interface JobApplication {
  id: string
  job_opening_id: string
  full_name: string
  email: string
  phone: string
  // Monthly, in PKR. Null only on applications sent before it was asked.
  expected_salary: number | null
  // HR's: monthly, in PKR, and one block of notes.
  current_salary: number | null
  hr_notes: string | null
  // Clients can't select these three: read them through application_hr_details.
  stage: ApplicationStage
  stage_changed_at: string
  note: string | null
  resume_path: string
  resume_name: string
  created_at: string
}

export interface ApplicationStageEvent {
  id: number
  application_id: string
  kind: 'move' | 'undo'
  from_stage: ApplicationStage
  to_stage: ApplicationStage
  reason: string | null
  created_by: string | null
  created_at: string
  undone_by: string | null
  undone_at: string | null
}

// A row of the job_posting RPC: an open job as the public page shows it.
export interface JobPosting {
  id: string
  title: string
  department: string
  designation: string
  due_date: string | null
  description: string | null
  accepting: boolean
}

export interface Perk {
  title: string
  description: string | null
}

export interface Branding {
  logo_path: string | null
  primary_color: string
  perks: Perk[]
}

export interface Announcement {
  id: string
  // Rich text (HTML); sanitise before showing it.
  body: string
  // On dashboards through this date. Null = not pinned.
  pinned_until: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// Configuration → Onboarding / Offboarding: the checklist every new
// onboarding (or offboarding) copies. Both have this shape.
export interface OnboardingTemplateSection {
  id: string
  name: string
  // Set by the database (new ones go last); changed only by the reorder RPCs.
  sort_order: number
}

export interface OnboardingTemplateTask {
  id: string
  section_id: string
  title: string
  // Within the section; changed only by the reorder RPCs.
  sort_order: number
}

export type OnboardingStatus = 'in_progress' | 'completed' | 'cancelled'

// Created by application_hire; changed only by the onboarding RPCs.
export interface Onboarding {
  id: string
  employee_id: string
  application_id: string | null
  due_date: string
  status: OnboardingStatus
  created_by: string | null
  created_at: string
  completed_by: string | null
  completed_at: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
}

// A copy of a checklist task, made when the onboarding started.
export interface OnboardingTask {
  id: string
  onboarding_id: string
  section: string
  section_order: number
  title: string
  sort_order: number
  done_by: string | null
  done_at: string | null
}

export type OffboardingStatus = 'in_progress' | 'completed' | 'cancelled'
export type OffboardingReason = 'resigned' | 'terminated' | 'contract_ended' | 'other'

// Started when the employee is put on notice; changed only by the
// offboarding RPCs. Completed by the last sign-off (HR, and their manager).
export interface Offboarding {
  id: string
  employee_id: string
  status: OffboardingStatus
  reason: OffboardingReason | null
  last_working_day: string | null
  started_by: string | null
  started_at: string
  hr_signed_by: string | null
  hr_signed_at: string | null
  manager_signed_by: string | null
  manager_signed_at: string | null
  completed_at: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
}

// A copy of a checklist task, made when the offboarding started.
export interface OffboardingTask {
  id: string
  offboarding_id: string
  section: string
  section_order: number
  title: string
  sort_order: number
  done_by: string | null
  done_at: string | null
}

export type SalaryRevisionStatus = 'draft' | 'review' | 'approved'

// An appraisal: an employee's salary from a month. Written by HR as a draft;
// status and stamps change only through salary_revision_move. Approved ones
// are the salary history.
export interface SalaryRevision {
  id: string
  employee_id: string
  // The first day of the month it applies from.
  effective_from: string
  basic_salary: number
  contractual_amount: number
  note: string | null
  status: SalaryRevisionStatus
  created_by: string | null
  created_at: string
  updated_at: string
  submitted_by: string | null
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
}

// A row of the my_salaries RPC: the caller's own approved salaries.
export type MySalary = Pick<SalaryRevision, 'id' | 'effective_from' | 'basic_salary' | 'contractual_amount' | 'approved_at'>

export type PayrollStatus = 'draft' | 'review' | 'approved' | 'processed'

// One month's payroll. Created by payroll_create; status changes only through
// payroll_move. Never deleted.
export interface Payroll {
  id: string
  year: number
  // 1–12.
  month: number
  status: PayrollStatus
  created_by: string | null
  created_at: string
  // The last move to review, approved and processed; back to draft clears
  // the first two.
  submitted_by: string | null
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  processed_by: string | null
  processed_at: string | null
  updated_at: string
}

export type BonusType = 'amount' | 'percent'

// One person on a payroll. Money is PKR.
export interface PayrollItem {
  id: string
  payroll_id: string
  // Null once the employee record is deleted; name and number stay.
  employee_id: string | null
  // Copied from the employee when added.
  employee_number: number
  full_name: string
  // HR's.
  basic_salary: number
  contractual_amount: number
  // Half days allowed.
  absent_days: number
  hr_remarks: string | null
  // Finance's. bonus_value is an amount, or a percentage of basic salary.
  bonus_type: BonusType
  bonus_value: number
  absent_deduction: number
  allowance: number
  // Pay owed from earlier months.
  arrears: number
  advance_salary: number
  loan_deduction: number
  tax_amount: number
  finance_remarks: string | null
  // Worked out by the database (mirrored in lib/payroll.ts).
  bonus: number
  gross_salary: number
  net_salary: number
  created_at: string
  updated_at: string
}

// A row of the my_payslips RPC: the caller's own line on a processed
// payroll, without the remarks.
export type Payslip = Omit<
  PayrollItem,
  'id' | 'employee_id' | 'hr_remarks' | 'finance_remarks' | 'created_at' | 'updated_at'
> &
  Pick<Payroll, 'year' | 'month' | 'processed_at'>

// Configuration → Vendors.
export interface Vendor {
  id: string
  name: string
  description: string | null
  bank_name: string | null
  // Upper case, without spaces.
  iban: string | null
  created_at: string
  updated_at: string
}

export type EquipmentStatus = 'requested' | 'active' | 'faulty' | 'retired' | 'sold'

// Operations → Equipment.
export interface Equipment {
  id: string
  name: string
  // Typed in by hand; unique, ignoring case.
  identifier: string
  status: EquipmentStatus
  purchase_date: string | null
  vendor_id: string | null
  // Files in the equipment bucket.
  invoice_path: string | null
  photo_path: string | null
  // Changed only by equipment_assign / equipment_unassign.
  assigned_to: string | null
  assigned_on: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// Who had a piece of equipment, when. Written only by the equipment RPCs.
export interface EquipmentAssignment {
  id: string
  equipment_id: string
  employee_id: string
  assigned_on: string
  assigned_by: string | null
  // Null while they still have it.
  unassigned_on: string | null
  unassigned_by: string | null
  created_at: string
}

// A row of the my_equipment RPC: what the profile shows.
export interface MyEquipment {
  name: string
  identifier: string
  assigned_on: string
}

export type ReviewStatus = 'draft' | 'submitted'

// One employee's review of one month. Created and moved only by the review
// RPCs; while a draft, their manager writes evaluation, feedback, goal_set
// and goal_progress.
export interface PerformanceReview {
  id: string
  employee_id: string
  // The month reviewed, as its first day (YYYY-MM-01).
  period: string
  // The 10th of the month after.
  due_date: string
  status: ReviewStatus
  evaluation: string | null
  feedback: string | null
  // The goal this review sets for the quarter it is held in.
  goal_set: string | null
  // The goal of the reviewed month's quarter, copied in on submit, and its progress out of 10.
  goal_rated: string | null
  goal_progress: number | null
  created_by: string | null
  created_at: string
  updated_at: string
  submitted_by: string | null
  submitted_at: string | null
  late: boolean
  acknowledged_at: string | null
}

// A KPI as it was when the review started; the manager writes rating and note.
export interface ReviewKpi {
  id: string
  review_id: string
  kpi_id: string | null
  name: string
  description: string | null
  target: string | null
  weight: number | null
  sort_order: number
  rating: number | null
  note: string | null
}

// An expectation as it was when the review started; the manager writes met and note.
export interface ReviewExpectation {
  id: string
  review_id: string
  expectation_id: string | null
  title: string
  sort_order: number
  met: boolean | null
  note: string | null
}

// A row of the performance_due RPC: someone due a review that month.
export interface ReviewDue {
  employee_id: string
  full_name: string
  designation: string | null
  manager_id: string | null
  manager_name: string | null
  review_id: string | null
  status: ReviewStatus | null
  due_date: string
  submitted_at: string | null
  late: boolean | null
  acknowledged_at: string | null
}

// A manager's one running note about a direct report, for their 1:1s. Only
// its author reads or writes it; author_id is stamped by the database.
export interface ManagerNote {
  id: string
  employee_id: string
  author_id: string
  body: string
  created_at: string
  updated_at: string
}

export type FeedbackKind = 'appreciation' | 'improvement' | 'general'

// Feedback from HR to one employee. Only HR and that employee read it; it
// isn't edited once sent. author_id and acknowledged_at are set by the database.
export interface HrFeedback {
  id: string
  employee_id: string
  kind: FeedbackKind
  body: string
  author_id: string | null
  created_at: string
  acknowledged_at: string | null
}

export type PeerCycleStatus = 'draft' | 'open' | 'closed'

// A quarter's peer reviews. Created and moved only by the peer_cycle_* RPCs;
// HR changes the due date.
export interface PeerReviewCycle {
  id: string
  year: number
  quarter: number
  status: PeerCycleStatus
  due_date: string
  created_by: string | null
  created_at: string
  opened_at: string | null
  closed_at: string | null
  updated_at: string
}

// sort_order is set by the database (last).
export interface PeerReviewQuestion {
  id: string
  cycle_id: string
  prompt: string
  sort_order: number
}

// One reviewer writing about one subject. submitted_at is set by peer_review_submit.
export interface PeerReviewAssignment {
  id: string
  cycle_id: string
  subject_id: string
  reviewer_id: string
  open_feedback: string | null
  created_at: string
  submitted_at: string | null
}

// Made by the database when the cycle opens; the reviewer writes rating and comment.
export interface PeerReviewAnswer {
  id: string
  assignment_id: string
  question_id: string
  rating: number | null
  comment: string | null
}

// A row of my_peer_feedback: one anonymous response about the caller.
export interface MyPeerFeedback {
  cycle_id: string
  year: number
  quarter: number
  response: number
  open_feedback: string | null
  answers: { prompt: string; sort_order: number; rating: number; comment: string | null }[]
}

// HR's questions, copied into each quarter's manager feedback form when it
// starts. 3 to 5 of them; sort_order set by the database.
export interface ManagerFeedbackQuestion {
  id: string
  prompt: string
  sort_order: number
}

// One employee's feedback on their manager for a quarter. Made by
// manager_feedback_start and submitted by manager_feedback_submit; the
// employee writes body (and the answers' ratings) while unsubmitted.
export interface ManagerFeedback {
  id: string
  employee_id: string
  manager_id: string | null
  year: number
  quarter: number
  // The 10th of the quarter's last month.
  due_date: string
  body: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  late: boolean
}

export interface ManagerFeedbackAnswer {
  id: string
  feedback_id: string
  prompt: string
  sort_order: number
  rating: number | null
}

// A row of manager_feedback_due: someone who owes feedback that quarter.
export interface ManagerFeedbackDue {
  employee_id: string
  full_name: string
  manager_id: string | null
  manager_name: string | null
  feedback_id: string | null
  due_date: string
  submitted_at: string | null
  late: boolean | null
}
