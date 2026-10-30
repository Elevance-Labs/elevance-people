// Stands in for src/lib/supabase in every test (see test/vite.config.ts).
//
// An in-memory database the pages read and write like the real one: filters
// are applied, writes change the rows, and a reload sees them. Every call is
// recorded in `captured` — failed ones too — so a test can assert what the
// app asked for, and
// `failNext` makes the next matching call fail the way Postgres would, so the
// error paths can be driven too.
//
// What it cannot do is enforce RLS, grants or triggers. Those are the
// database's job (see `yarn check:schema` and the SQL itself); these tests
// prove the app asks for the right things and handles the answers.
import type { AppRole, Employee, EmployeeStatus } from '../src/lib/types'

type Row = Record<string, unknown>
export interface PgError {
  code?: string
  message: string
}
interface Result {
  data: unknown
  error: PgError | null
  count?: number
}

export const DOCS_BUCKET = 'employee-docs'
export const APPLICATIONS_BUCKET = 'job-applications'
export const BRANDING_BUCKET = 'branding'
export const EQUIPMENT_BUCKET = 'equipment'
export const REIMBURSEMENTS_BUCKET = 'reimbursements'

// The leave fixtures are written for this year; leave tests freeze "today"
// to it with `freezeToday(TODAY)` from setup.ts.
export const TODAY = '2026-06-10' // a Wednesday

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Engineering has people in it, so it cannot be deleted; People Ops is empty
// of designations-in-use apart from HR.
const DEPARTMENTS: Row[] = [
  { id: 'd-eng', name: 'Engineering', description: 'Builds the product', business_function: 'production' },
  { id: 'd-ops', name: 'People Ops', description: null, business_function: 'operations' },
  // Made before business functions existed.
  { id: 'd-new', name: 'Design', description: null, business_function: null },
]

const DESIGNATIONS: Row[] = [
  { id: 'g-lead', department_id: 'd-eng', title: 'Engineering Lead', description: null },
  { id: 'g-dev', department_id: 'd-eng', title: 'Software Engineer', description: null },
  { id: 'g-hr', department_id: 'd-ops', title: 'HR Generalist', description: null },
]

const KPIS: Row[] = [
  { id: 'k-1', designation_id: 'g-dev', name: 'Code review turnaround', description: null, target: '< 1 day', weight: 40 },
  { id: 'k-2', designation_id: 'g-dev', name: 'Escaped defects', description: null, target: null, weight: 60 },
]

function employee(
  id: string,
  n: number,
  full_name: string,
  email: string,
  app_role: AppRole,
  status: EmployeeStatus,
  department_id: string | null,
  designation_id: string | null,
): Employee {
  return {
    id,
    employee_number: n,
    user_id: null,
    full_name,
    company_email: email,
    date_of_joining: '2024-01-15',
    date_of_separation: null,
    personal_email: null,
    phone: null,
    cnic_number: null,
    cnic_expiry: null,
    dob: null,
    department_id,
    designation_id,
    bank: null,
    iban: null,
    emergency_contact: null,
    employment_type: 'full_time',
    status,
    app_role,
    login_method: 'google',
    can_claim_reimbursements: false,
    created_at: '2024-01-15T09:00:00Z',
    updated_at: '2024-01-15T09:00:00Z',
  }
}

// One person per role, plus someone who has left — so "who may log in" and
// "who is offered for the chart" both have a case to say no to.
export const PEOPLE = {
  companyAdmin: employee('e-amna', 1, 'Amna Khan', 'amna@elevancelabs.com', 'company_admin', 'active', 'd-eng', 'g-lead'),
  hr: employee('e-bilal', 2, 'Bilal Ahmed', 'bilal@elevancelabs.com', 'hr_admin', 'active', 'd-ops', 'g-hr'),
  member: employee('e-sara', 3, 'Sara Iqbal', 'sara@elevancelabs.com', 'member', 'probation', 'd-eng', 'g-dev'),
  leaver: employee('e-omar', 4, 'Omar Farooq', 'omar@elevancelabs.com', 'member', 'left', 'd-eng', 'g-dev'),
}

// Payroll's finance admin. Not in the employees table by default, so the
// other tests' lists are unchanged; push her in where a test needs her there.
export const FINANCE = employee('e-hina', 5, 'Hina Raza', 'hina@elevancelabs.com', 'finance_admin', 'active', 'd-ops', null)

// Sara has one live document and one soft-deleted one.
const DOCUMENTS: Row[] = [
  {
    id: 'doc-1', employee_id: 'e-sara', doc_type: 'CNIC', file_name: 'cnic.pdf',
    storage_path: 'e-sara/1111.pdf', mime_type: 'application/pdf', size_bytes: 204800,
    created_at: '2024-02-01T10:00:00Z', deleted_at: null,
  },
  {
    id: 'doc-2', employee_id: 'e-sara', doc_type: 'Photo', file_name: 'old-photo.png',
    storage_path: 'e-sara/2222.png', mime_type: 'image/png', size_bytes: 1024,
    created_at: '2024-01-20T10:00:00Z', deleted_at: '2024-01-21T10:00:00Z',
  },
]

// Amna at the top, Sara reporting to her. Bilal and Omar are not in the chart,
// so Bilal's leave needs HR alone.
const ORG_CHART: Row[] = [
  { employee_id: 'e-amna', manager_id: null },
  { employee_id: 'e-sara', manager_id: 'e-amna' },
]

// Annual has a quota, Unpaid has none, Retired can no longer be applied for.
const LEAVE_TYPES: Row[] = [
  { id: 't-annual', name: 'Annual', description: null, annual_quota: 14, is_active: true },
  { id: 't-sick', name: 'Sick', description: null, annual_quota: 8, is_active: true },
  { id: 't-unpaid', name: 'Unpaid', description: null, annual_quota: null, is_active: true },
  { id: 't-retired', name: 'Retired', description: null, annual_quota: 5, is_active: false },
]

// Bilal has been given 20 Annual days this year.
const LEAVE_QUOTAS: Row[] = [{ employee_id: 'e-bilal', leave_type_id: 't-annual', year: 2026, days: 20 }]

function leave(id: string, employee_id: string, leave_type_id: string, start: string, end: string, days: number,
  status: string, reason: string, extra: Row = {}): Row {
  return {
    id, employee_id, leave_type_id, start_date: start, end_date: end, half_day: false, days, reason, status,
    created_by: employee_id, hr_approved_by: null, hr_approved_at: null, manager_approved_by: null,
    manager_approved_at: null, rejected_by: null, rejected_at: null, rejection_reason: null, cancelled_by: null,
    cancelled_at: null, edited_by: null, edited_at: null, created_at: '2026-01-01T09:00:00Z',
    updated_at: '2026-01-01T09:00:00Z', ...extra,
  }
}

// Each reason is unique, so a test can find a leave's row by it.
const LEAVES: Row[] = [
  leave('l-pending', 'e-sara', 't-annual', '2026-06-15', '2026-06-17', 3, 'pending', 'Family wedding'),
  leave('l-hr-done', 'e-sara', 't-annual', '2026-08-03', '2026-08-04', 2, 'pending', 'Moving house',
    { hr_approved_by: 'e-bilal', hr_approved_at: '2026-06-01T09:00:00Z' }),
  leave('l-future', 'e-sara', 't-sick', '2026-07-01', '2026-07-01', 1, 'approved', 'Surgery',
    { hr_approved_by: 'e-bilal', manager_approved_by: 'e-amna' }),
  leave('l-past', 'e-sara', 't-annual', '2026-03-02', '2026-03-03', 2, 'approved', 'Spring break',
    { hr_approved_by: 'e-bilal', manager_approved_by: 'e-amna' }),
  leave('l-rejected', 'e-sara', 't-annual', '2026-02-10', '2026-02-10', 1, 'rejected', 'Concert',
    { rejected_by: 'e-bilal', rejection_reason: 'Release week' }),
  leave('l-last-year', 'e-sara', 't-annual', '2025-12-01', '2025-12-02', 2, 'approved', 'Last year trip'),
  leave('l-bilal', 'e-bilal', 't-annual', '2026-06-22', '2026-06-22', 1, 'pending', 'Dentist'),
]

// One holiday already past this year, two to come, and one from last year.
// Ashura is a Thursday and Friday, the week after Sara's pending leave.
const HOLIDAYS: Row[] = [
  { id: 'h-eid', name: 'Eid ul Adha', start_date: '2026-05-27', end_date: '2026-05-29' },
  { id: 'h-ashura', name: 'Ashura', start_date: '2026-06-25', end_date: '2026-06-26' },
  { id: 'h-azadi', name: 'Independence Day', start_date: '2026-08-14', end_date: '2026-08-14' },
  { id: 'h-quaid', name: 'Quaid Day', start_date: '2025-12-25', end_date: '2025-12-25' },
]

// Hiring: one open job (Sara interviews, Amna manages) and one draft.
const JOB_OPENINGS: Row[] = [
  {
    id: 'j-open', title: 'Frontend Engineer', department_id: 'd-eng', designation_id: 'g-dev', status: 'open',
    due_date: '2026-12-31', description: '<p>Build <strong>great</strong> things.</p>', manager_id: 'e-amna',
    created_by: 'e-bilal', created_at: '2026-05-01T09:00:00Z', updated_at: '2026-05-01T09:00:00Z',
  },
  {
    id: 'j-draft', title: 'HR Intern', department_id: 'd-ops', designation_id: 'g-hr', status: 'draft',
    due_date: null, description: null, manager_id: null,
    created_by: 'e-bilal', created_at: '2026-05-02T09:00:00Z', updated_at: '2026-05-02T09:00:00Z',
  },
]

const JOB_OPENING_INTERVIEWERS: Row[] = [{ job_opening_id: 'j-open', employee_id: 'e-sara' }]

function application(id: string, full_name: string, stage: string, expected_salary: number, extra: Row = {}): Row {
  return {
    id, job_opening_id: 'j-open', full_name, email: `${id}@example.com`, phone: '0300 1234567',
    expected_salary, current_salary: null, hr_notes: null, note: null, resume_path: `j-open/${id}.pdf`, resume_name: `${full_name} CV.pdf`,
    created_at: '2026-05-10T09:00:00Z', stage, stage_changed_at: '2026-05-20T09:00:00Z', ...extra,
  }
}

// One application per kind of case for the Frontend Engineer board. Sara
// (interviewer) and Amna (hiring manager) are its hiring team.
const JOB_APPLICATIONS: Row[] = [
  application('a-new', 'Zara Malik', 'new', 180000),
  application('a-short', 'Hamza Ali', 'shortlisted', 250000, { note: 'Available from July.' }),
  application('a-int', 'Ayesha Noor', 'interview_1', 300000, {
    current_salary: 260000, hr_notes: 'Notice period of one month.',
  }),
  application('a-cleared', 'Fatima Shah', 'cleared', 320000),
  application('a-rej', 'Usman Tariq', 'rejected', 150000),
]

const APPLICATION_STAGE_EVENTS: Row[] = [
  { id: 1, application_id: 'a-short', kind: 'move', from_stage: 'new', to_stage: 'screened', reason: 'Good CV',
    created_by: 'e-bilal', created_at: '2026-05-12T09:00:00Z', undone_by: null, undone_at: null },
  { id: 2, application_id: 'a-short', kind: 'move', from_stage: 'screened', to_stage: 'shortlisted', reason: null,
    created_by: 'e-bilal', created_at: '2026-05-20T09:00:00Z', undone_by: null, undone_at: null },
]

const BRANDING: Row[] = [
  {
    id: true, logo_path: 'logo-old.png', primary_color: '#0a7d5a',
    perks: [{ title: 'Health insurance', description: 'For you and your family' }, { title: 'Remote Fridays', description: null }],
  },
]

// One pinned through the end of the month (on dashboards), one whose pin has
// ended and one never pinned. Newest first by created_at.
// Resources guides, as the database holds them. The mock returns every row;
// in the database RLS shows each employee only their own function's.
const guide = (id: string, slug: string, title: string, fn: string, sort: number, doc_url: string | null = null): Row => ({
  id, slug, title, description: `About ${title.toLowerCase()}.`, business_function: fn, doc_url, sort_order: sort,
})
const GUIDES: Row[] = [
  guide('gd-eng', 'engineering', 'Engineering', 'production', 2, 'https://docs.google.com/document/d/abc-123_X/edit?usp=sharing'),
  guide('gd-design', 'design', 'Design', 'production', 1),
  guide('gd-sales', 'sales', 'Sales', 'growth', 1),
  guide('gd-hr', 'hr', 'HR', 'operations', 1),
]

const ANNOUNCEMENTS: Row[] = [
  {
    id: 'an-pinned', body: '<p>Office closed on <strong>Friday</strong>.</p>', pinned_until: '2026-06-30',
    created_by: 'e-bilal', created_at: '2026-06-08T09:00:00Z', updated_at: '2026-06-08T09:00:00Z',
  },
  {
    id: 'an-ended', body: '<p>Town hall at 4pm.</p>', pinned_until: '2026-06-01',
    created_by: 'e-amna', created_at: '2026-05-20T09:00:00Z', updated_at: '2026-05-20T09:00:00Z',
  },
  {
    id: 'an-plain', body: '<p>New coffee machine.</p>', pinned_until: null,
    created_by: 'e-bilal', created_at: '2026-05-01T09:00:00Z', updated_at: '2026-05-01T09:00:00Z',
  },
]

// The onboarding checklist: Paperwork first, then IT setup.
const ONBOARDING_TEMPLATE_SECTIONS: Row[] = [
  { id: 'os-paper', name: 'Paperwork', sort_order: 0 },
  { id: 'os-it', name: 'IT setup', sort_order: 1 },
]

const ONBOARDING_TEMPLATE_TASKS: Row[] = [
  { id: 'ot-contract', section_id: 'os-paper', title: 'Sign the contract', sort_order: 0 },
  { id: 'ot-cnic', section_id: 'os-paper', title: 'Collect CNIC copy', sort_order: 1 },
  { id: 'ot-laptop', section_id: 'os-it', title: 'Issue a laptop', sort_order: 0 },
  { id: 'ot-email', section_id: 'os-it', title: 'Create email account', sort_order: 1 },
  { id: 'ot-slack', section_id: 'os-it', title: 'Add to Slack', sort_order: 2 },
]

function onboarding(id: string, employee_id: string, due_date: string, status: string, extra: Row = {}): Row {
  return {
    id, employee_id, application_id: null, due_date, status, created_by: 'e-bilal',
    created_at: '2026-05-01T09:00:00Z', completed_by: null, completed_at: null, cancelled_by: null,
    cancelled_at: null, cancel_reason: null, ...extra,
  }
}

// Sara's is in progress and overdue (one task done); Omar's was completed.
const ONBOARDINGS: Row[] = [
  onboarding('ob-sara', 'e-sara', '2026-06-05', 'in_progress'),
  onboarding('ob-omar', 'e-omar', '2024-01-16', 'completed',
    { completed_by: 'e-bilal', completed_at: '2024-01-20T09:00:00Z' }),
]

function onboardingTask(id: string, onboarding_id: string, section: string, section_order: number, title: string,
  sort_order: number, done = false): Row {
  return {
    id, onboarding_id, section, section_order, title, sort_order,
    done_by: done ? 'e-bilal' : null, done_at: done ? '2026-06-01T09:00:00Z' : null,
  }
}

const ONBOARDING_TASKS: Row[] = [
  onboardingTask('t-sara-1', 'ob-sara', 'Paperwork', 0, 'Sign the contract', 0, true),
  onboardingTask('t-sara-2', 'ob-sara', 'Paperwork', 0, 'Collect CNIC copy', 1),
  onboardingTask('t-sara-3', 'ob-sara', 'IT setup', 1, 'Issue a laptop', 0),
  onboardingTask('t-omar-1', 'ob-omar', 'Paperwork', 0, 'Sign the contract', 0, true),
]

// The offboarding checklist: Handover, then Equipment.
const OFFBOARDING_TEMPLATE_SECTIONS: Row[] = [
  { id: 'fs-handover', name: 'Handover', sort_order: 0 },
  { id: 'fs-kit', name: 'Equipment', sort_order: 1 },
]

const OFFBOARDING_TEMPLATE_TASKS: Row[] = [
  { id: 'ft-plan', section_id: 'fs-handover', title: 'Agree a handover plan', sort_order: 0 },
  { id: 'ft-laptop', section_id: 'fs-kit', title: 'Collect the laptop', sort_order: 0 },
]

const NO_SIGN_OFFS = { hr_signed_by: null, hr_signed_at: null, manager_signed_by: null, manager_signed_at: null }

function offboarding(id: string, employee_id: string, status: string, extra: Row = {}): Row {
  return {
    id, employee_id, status, reason: null, last_working_day: null, started_by: 'e-bilal',
    started_at: '2026-05-15T09:00:00Z', hr_signed_by: null, hr_signed_at: null, manager_signed_by: null,
    manager_signed_at: null, completed_at: null, cancelled_by: null, cancelled_at: null, cancel_reason: null, ...extra,
  }
}

// Sara's is in progress (she reports to Amna): her last day has passed and one
// of three tasks is left. Omar's was completed by HR alone (no manager).
const OFFBOARDINGS: Row[] = [
  offboarding('off-sara', 'e-sara', 'in_progress', { reason: 'resigned', last_working_day: '2026-06-05' }),
  offboarding('off-omar', 'e-omar', 'completed', {
    reason: 'resigned', last_working_day: '2026-03-31', hr_signed_by: 'e-bilal', hr_signed_at: '2026-03-31T12:00:00Z',
    completed_at: '2026-03-31T12:00:00Z',
  }),
]

function offboardingTask(id: string, offboarding_id: string, section: string, section_order: number, title: string,
  sort_order: number, done = false): Row {
  return {
    id, offboarding_id, section, section_order, title, sort_order,
    done_by: done ? 'e-amna' : null, done_at: done ? '2026-06-01T09:00:00Z' : null,
  }
}

const OFFBOARDING_TASKS: Row[] = [
  offboardingTask('ft-sara-1', 'off-sara', 'Handover', 0, 'Agree a handover plan', 0, true),
  offboardingTask('ft-sara-2', 'off-sara', 'Handover', 0, 'Hand over open work', 1, true),
  offboardingTask('ft-sara-3', 'off-sara', 'Equipment', 1, 'Collect the laptop', 0),
  offboardingTask('ft-omar-1', 'off-omar', 'Handover', 0, 'Agree a handover plan', 0, true),
]

function payroll(id: string, year: number, month: number, status: string, extra: Row = {}): Row {
  return {
    id, year, month, status, created_by: 'e-bilal', created_at: '2026-05-25T09:00:00Z', submitted_by: null,
    submitted_at: null, approved_by: null, approved_at: null, processed_by: null, processed_at: null,
    disbursed_by: null, disbursed_at: null, updated_at: '2026-05-25T09:00:00Z', ...extra,
  }
}

// April was disbursed; May is the open draft.
const PAYROLLS: Row[] = [
  payroll('pr-apr', 2026, 4, 'disbursed', {
    created_at: '2026-04-25T09:00:00Z', submitted_by: 'e-bilal', submitted_at: '2026-04-26T09:00:00Z',
    approved_by: 'e-amna', approved_at: '2026-04-27T09:00:00Z', processed_by: 'e-amna', processed_at: '2026-04-30T09:00:00Z',
    disbursed_by: 'e-amna', disbursed_at: '2026-05-01T09:00:00Z',
  }),
  payroll('pr-may', 2026, 5, 'draft'),
]

function salaryRevision(id: string, employee_id: string, effective_from: string, basic_salary: number,
  contractual_amount: number, status: string, extra: Row = {}): Row {
  return {
    id, employee_id, effective_from, basic_salary, contractual_amount, note: null, status, created_by: 'e-bilal',
    created_at: '2026-01-05T09:00:00Z', updated_at: '2026-01-05T09:00:00Z', submitted_by: null, submitted_at: null,
    approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, rejection_reason: null, ...extra,
  }
}

// Appraisals. Sara: her first salary (January), a raise from June (active on
// TODAY), and one from September in review. Omar's was rejected back to draft.
const SALARY_REVISIONS: Row[] = [
  salaryRevision('sr-sara-jan', 'e-sara', '2026-01-01', 90000, 5000, 'approved',
    { approved_by: 'e-amna', approved_at: '2026-01-06T09:00:00Z' }),
  salaryRevision('sr-sara-jun', 'e-sara', '2026-06-01', 110000, 5000, 'approved',
    { approved_by: 'e-amna', approved_at: '2026-05-20T09:00:00Z', note: 'Confirmed after probation' }),
  salaryRevision('sr-sara-sep', 'e-sara', '2026-09-01', 125000, 5000, 'review',
    { submitted_by: 'e-bilal', submitted_at: '2026-06-01T09:00:00Z', note: 'Annual appraisal' }),
  salaryRevision('sr-amna-jul', 'e-amna', '2026-07-01', 350000, 0, 'draft',
    { rejected_by: 'e-amna', rejection_reason: 'Wait for the board' }),
]

const NO_FIGURES = {
  basic_salary: 0, contractual_amount: 0, bonus_type: 'amount', bonus_value: 0, absent_days: 0, absent_deduction: 0,
  allowance: 0, arrears: 0, advance_salary: 0, loan_deduction: 0, tax_amount: 0, hr_remarks: null,
  finance_remarks: null,
}

function payrollItem(id: string, payroll_id: string, who: Employee, figures: Row = {}): Row {
  return {
    id, payroll_id, employee_id: who.id, employee_number: who.employee_number, full_name: who.full_name, ...NO_FIGURES,
    created_at: '2026-05-25T09:00:00Z', updated_at: '2026-05-25T09:00:00Z', ...figures,
  }
}

// Sara's May line uses every column: a 10% bonus, a day and a half absent.
const SARA_MAY = {
  basic_salary: 100000, bonus_type: 'percent', bonus_value: 10, absent_days: 1.5, absent_deduction: 5000,
  allowance: 8000, advance_salary: 2000, loan_deduction: 1000, tax_amount: 4500, hr_remarks: 'Two sick days unpaid',
  finance_remarks: 'Advance, 2 of 4',
}
const PAYROLL_ITEMS: Row[] = [
  payrollItem('pi-apr-amna', 'pr-apr', PEOPLE.companyAdmin, { basic_salary: 300000, tax_amount: 40000 }),
  // Sara's April payslip: a 5% bonus, arrears and tax.
  payrollItem('pi-apr-sara', 'pr-apr', PEOPLE.member, {
    basic_salary: 100000, bonus_type: 'percent', bonus_value: 5, absent_days: 0.5, absent_deduction: 2000,
    allowance: 8000, arrears: 6000, tax_amount: 4000, hr_remarks: 'Internal: HR note', finance_remarks: 'Internal: finance note',
  }),
  payrollItem('pi-may-amna', 'pr-may', PEOPLE.companyAdmin,
    { basic_salary: 300000, contractual_amount: 50000, bonus_value: 20000, tax_amount: 40000 }),
  payrollItem('pi-may-bilal', 'pr-may', PEOPLE.hr, { basic_salary: 150000, allowance: 10000, tax_amount: 9000 }),
  payrollItem('pi-may-sara', 'pr-may', PEOPLE.member, SARA_MAY),
]

// The generated columns of payroll_items, worked out independently of the
// app's own mirror (src/lib/payroll.ts) so a slip in either shows.
function payrollFigures(r: Row) {
  const n = (k: string) => Number(r[k] ?? 0)
  const bonus = r.bonus_type === 'percent' ? Math.round(n('basic_salary') * n('bonus_value')) / 100 : n('bonus_value')
  const gross = n('basic_salary') + n('contractual_amount') + bonus + n('allowance') + n('arrears') - n('absent_deduction')
  return { bonus, gross_salary: gross, net_salary: gross - n('advance_salary') - n('loan_deduction') - n('tax_amount') }
}

// TechHub supplies equipment, so only PrintCo can be deleted.
const VENDORS: Row[] = [
  {
    id: 'v-tech', name: 'TechHub', description: 'Laptops and accessories', bank_name: 'Meezan Bank',
    iban: 'PK36MEZN0001234567890', created_at: '2025-01-01T09:00:00Z', updated_at: '2025-01-01T09:00:00Z',
  },
  {
    id: 'v-print', name: 'PrintCo', description: null, bank_name: null, iban: null,
    created_at: '2025-01-02T09:00:00Z', updated_at: '2025-01-02T09:00:00Z',
  },
]

function equipmentItem(id: string, name: string, identifier: string, status: string, extra: Row = {}): Row {
  return {
    id, name, identifier, status, purchase_date: null, vendor_id: null, invoice_path: null, photo_path: null,
    assigned_to: null, assigned_on: null, created_by: 'e-bilal', created_at: '2025-11-03T09:00:00Z',
    updated_at: '2025-11-03T09:00:00Z', ...extra,
  }
}

// Sara has the laptop (Bilal had it before her) and a mouse; the monitor is
// faulty and with nobody; the printer is retired.
const EQUIPMENT: Row[] = [
  equipmentItem('eq-laptop', 'Laptop', 'LT-0042', 'active', {
    purchase_date: '2025-11-03', vendor_id: 'v-tech', invoice_path: 'inv-laptop.pdf', photo_path: 'photo-laptop.jpg',
    assigned_to: 'e-sara', assigned_on: '2026-01-10',
  }),
  equipmentItem('eq-mouse', 'Mouse', 'MS-3', 'active', { vendor_id: 'v-tech', assigned_to: 'e-sara', assigned_on: '2026-03-02' }),
  equipmentItem('eq-monitor', 'Monitor', 'MON-7', 'faulty'),
  equipmentItem('eq-printer', 'Printer', 'PR-1', 'retired', { vendor_id: 'v-tech' }),
]

const EQUIPMENT_ASSIGNMENTS: Row[] = [
  { id: 'ea-1', equipment_id: 'eq-laptop', employee_id: 'e-bilal', assigned_on: '2025-11-05', assigned_by: 'e-amna',
    unassigned_on: '2026-01-10', unassigned_by: 'e-amna', created_at: '2025-11-05T09:00:00Z' },
  { id: 'ea-2', equipment_id: 'eq-laptop', employee_id: 'e-sara', assigned_on: '2026-01-10', assigned_by: 'e-amna',
    unassigned_on: null, unassigned_by: null, created_at: '2026-01-10T09:00:00Z' },
  { id: 'ea-3', equipment_id: 'eq-mouse', employee_id: 'e-sara', assigned_on: '2026-03-02', assigned_by: 'e-bilal',
    unassigned_on: null, unassigned_by: null, created_at: '2026-03-02T09:00:00Z' },
]

function reimbursement(id: string, employee_id: string, description: string, expense_date: string, amount: number,
  status: string, extra: Row = {}): Row {
  return {
    id, employee_id, description, expense_date, amount, receipt_paths: [`${employee_id}/${id}-1.jpg`], status,
    created_at: `${expense_date}T10:00:00Z`, updated_at: `${expense_date}T10:00:00Z`, approved_by: null,
    approved_at: null, processed_by: null, processed_at: null, disbursed_by: null, disbursed_at: null, rejected_by: null,
    rejected_at: null, rejection_reason: null, withdrawn_at: null, transaction_date: null, transaction_reference: null,
    transaction_proof_path: null, created_by: employee_id, ...extra,
  }
}

// One claim at each step: Sara's are in review (two receipts), approved,
// disbursed and rejected; Bilal's is processed. Nobody may claim by default
// (can_claim_reimbursements), so other tests' navs are unchanged.
const REIMBURSEMENTS: Row[] = [
  reimbursement('rb-review', 'e-sara', 'Client lunch', '2026-06-05', 4500, 'review',
    { receipt_paths: ['e-sara/rb-review-1.jpg', 'e-sara/rb-review-2.pdf'] }),
  reimbursement('rb-approved', 'e-sara', 'Taxi to client', '2026-05-20', 1200, 'approved',
    { approved_by: 'e-bilal', approved_at: '2026-05-21T09:00:00Z' }),
  reimbursement('rb-processed', 'e-bilal', 'Team offsite snacks', '2026-05-10', 8000, 'processed',
    { approved_by: 'e-amna', approved_at: '2026-05-11T09:00:00Z', processed_by: 'e-amna', processed_at: '2026-05-12T09:00:00Z' }),
  reimbursement('rb-disbursed', 'e-sara', 'Conference ticket', '2026-04-02', 15000, 'disbursed', {
    approved_by: 'e-bilal', approved_at: '2026-04-03T09:00:00Z', processed_by: 'e-amna', processed_at: '2026-04-05T09:00:00Z',
    disbursed_by: 'e-amna', disbursed_at: '2026-04-20T09:00:00Z', transaction_date: '2026-04-20',
    transaction_reference: 'IBFT-778812', transaction_proof_path: 'e-sara/proof-1.pdf',
  }),
  reimbursement('rb-rejected', 'e-sara', 'Gym membership', '2026-04-15', 6000, 'rejected',
    { rejected_by: 'e-bilal', rejected_at: '2026-04-16T09:00:00Z', rejection_reason: 'Not a work expense' }),
]

// Sara's designation (Software Engineer) has two expectations besides its KPIs.
const EXPECTATIONS: Row[] = [
  { id: 'x-tickets', designation_id: 'g-dev', title: 'Updates tickets daily' },
  { id: 'x-standup', designation_id: 'g-dev', title: 'Joins standup' },
]

// The 10th of the month after, as the generated due_date.
const dueOf = (period: string) => {
  const [y, m] = period.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-10` : `${y}-${String(m + 1).padStart(2, '0')}-10`
}

function review(id: string, employee_id: string, period: string, status: string, extra: Row = {}): Row {
  return {
    id, employee_id, period, due_date: dueOf(period), status, evaluation: null, feedback: null, goal_set: null,
    goal_rated: null, goal_progress: null, created_by: 'e-amna', created_at: `${period}T09:00:00Z`,
    updated_at: `${period}T09:00:00Z`, submitted_by: null, submitted_at: null, late: false, acknowledged_at: null, ...extra,
  }
}

// Amna (Sara's manager) reviewed Sara's March, which set the Q2 goal, and
// her April, late, which Sara hasn't acknowledged yet.
const PERFORMANCE_REVIEWS: Row[] = [
  review('r-mar', 'e-sara', '2026-03-01', 'submitted', {
    evaluation: 'Strong start.', feedback: 'Take on reviews.', goal_set: 'Ship the onboarding flow',
    submitted_by: 'e-amna', submitted_at: '2026-04-08T09:00:00Z', acknowledged_at: '2026-04-09T09:00:00Z',
  }),
  review('r-apr', 'e-sara', '2026-04-01', 'submitted', {
    evaluation: 'Slower month.', feedback: 'Ask for help sooner.', goal_rated: 'Ship the onboarding flow',
    goal_progress: 6, submitted_by: 'e-amna', submitted_at: '2026-05-12T09:00:00Z', late: true,
  }),
]

const kpiLine = (id: string, review_id: string, kpi: Row, sort_order: number, rating: number, note: string | null = null): Row => ({
  id, review_id, kpi_id: kpi.id, name: kpi.name, description: kpi.description, target: kpi.target, weight: kpi.weight,
  sort_order, rating, note,
})
const expectationLine = (id: string, review_id: string, x: Row, sort_order: number, met: boolean, note: string | null = null): Row => ({
  id, review_id, expectation_id: x.id, title: x.title, sort_order, met, note,
})

// March: 4 and 3 (overall 3.4 by weight 40/60), both expectations met.
// April: 3 and 2, standup not met.
const PERFORMANCE_REVIEW_KPIS: Row[] = [
  kpiLine('rk-mar-1', 'r-mar', KPIS[0], 0, 4),
  kpiLine('rk-mar-2', 'r-mar', KPIS[1], 1, 3),
  kpiLine('rk-apr-1', 'r-apr', KPIS[0], 0, 3),
  kpiLine('rk-apr-2', 'r-apr', KPIS[1], 1, 2, 'Two hotfixes'),
]
const PERFORMANCE_REVIEW_EXPECTATIONS: Row[] = [
  expectationLine('rx-mar-1', 'r-mar', EXPECTATIONS[1], 0, true),
  expectationLine('rx-mar-2', 'r-mar', EXPECTATIONS[0], 1, true),
  expectationLine('rx-apr-1', 'r-apr', EXPECTATIONS[1], 0, false, 'Missed three'),
  expectationLine('rx-apr-2', 'r-apr', EXPECTATIONS[0], 1, true),
]

// Bilal (HR) thanked Sara; she hasn't acknowledged it yet.
const HR_FEEDBACK: Row[] = [
  { id: 'f-1', employee_id: 'e-sara', kind: 'appreciation', body: 'Thanks for covering the release.', author_id: 'e-bilal',
    created_at: '2026-05-25T09:00:00Z', acknowledged_at: null },
]

// Q1 2026's peer reviews are closed: Amna and Bilal both reviewed Sara.
const PEER_REVIEW_CYCLES: Row[] = [
  { id: 'pc-q1', year: 2026, quarter: 1, status: 'closed', due_date: '2026-03-20', created_by: 'e-bilal',
    created_at: '2026-03-01T09:00:00Z', opened_at: '2026-03-02T09:00:00Z', closed_at: '2026-03-25T09:00:00Z',
    updated_at: '2026-03-25T09:00:00Z' },
]
const PEER_REVIEW_QUESTIONS: Row[] = [
  { id: 'pq-1', cycle_id: 'pc-q1', prompt: 'Collaborates well and is easy to work with.', sort_order: 0 },
  { id: 'pq-2', cycle_id: 'pc-q1', prompt: 'Communicates clearly and keeps others informed.', sort_order: 1 },
  { id: 'pq-3', cycle_id: 'pc-q1', prompt: 'Delivers reliable, high-quality work.', sort_order: 2 },
]
const PEER_REVIEW_ASSIGNMENTS: Row[] = [
  { id: 'pa-1', cycle_id: 'pc-q1', subject_id: 'e-sara', reviewer_id: 'e-amna', open_feedback: 'Always helpful in code reviews.',
    created_at: '2026-03-01T09:00:00Z', submitted_at: '2026-03-10T09:00:00Z' },
  { id: 'pa-2', cycle_id: 'pc-q1', subject_id: 'e-sara', reviewer_id: 'e-bilal', open_feedback: null,
    created_at: '2026-03-01T09:00:00Z', submitted_at: '2026-03-12T09:00:00Z' },
]
// Averages per question: 3.5, 4.5, 4.0.
const PEER_REVIEW_ANSWERS: Row[] = [
  { id: 'pr-1', assignment_id: 'pa-1', question_id: 'pq-1', rating: 4, comment: 'Great pairing' },
  { id: 'pr-2', assignment_id: 'pa-1', question_id: 'pq-2', rating: 5, comment: null },
  { id: 'pr-3', assignment_id: 'pa-1', question_id: 'pq-3', rating: 4, comment: null },
  { id: 'pr-4', assignment_id: 'pa-2', question_id: 'pq-1', rating: 3, comment: null },
  { id: 'pr-5', assignment_id: 'pa-2', question_id: 'pq-2', rating: 4, comment: 'Clear standups' },
  { id: 'pr-6', assignment_id: 'pa-2', question_id: 'pq-3', rating: 4, comment: null },
]

// The seeded questions; Sara gave her Q1 2026 feedback on Amna.
const MANAGER_FEEDBACK_QUESTIONS: Row[] = [
  'Gives me clear goals and priorities.', 'Gives me useful, timely feedback.',
  'Is available and supportive when I need help.', 'Recognises my work and treats me fairly.',
  'Supports my growth and career development.',
].map((prompt, i) => ({ id: `mq-${i + 1}`, prompt, sort_order: i }))
const MANAGER_FEEDBACK: Row[] = [
  { id: 'mf-q1', employee_id: 'e-sara', manager_id: 'e-amna', year: 2026, quarter: 1, due_date: '2026-03-10',
    body: 'Clear priorities every sprint.', created_at: '2026-03-02T09:00:00Z', updated_at: '2026-03-04T09:00:00Z',
    submitted_at: '2026-03-04T09:00:00Z', late: false },
]
const MANAGER_FEEDBACK_ANSWERS: Row[] = MANAGER_FEEDBACK_QUESTIONS.map((q, i) => ({
  id: `ma-q1-${i}`, feedback_id: 'mf-q1', prompt: q.prompt, sort_order: i, rating: [5, 4, 4, 3, 4][i],
}))

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

type Table =
  | 'employees'
  | 'departments'
  | 'designations'
  | 'kpis'
  | 'employee_documents'
  | 'org_chart_nodes'
  | 'employee_directory'
  | 'leave_types'
  | 'leave_quotas'
  | 'leaves'
  // Tables without fixtures read as empty and accept writes.
  | (string & {})

let db: Record<string, Row[]>
const rowsIn = (name: Table) => (db[name] ??= [])

const find = (table: Table, id: unknown) => rowsIn(table).find((r) => r.id === id)
const count = (table: Table, col: string, id: unknown) => [
  { count: rowsIn(table).filter((r) => r[col] === id).length },
]

// PostgREST embeds (`department:departments!…(name)`, `kpis(count)`) are
// derived on read from whatever the tables hold now.
function withEmbeds(table: Table, row: Row): Row {
  switch (table) {
    case 'employees':
      return {
        ...row,
        department: row.department_id ? { name: find('departments', row.department_id)?.name } : null,
        designation: row.designation_id ? { title: find('designations', row.designation_id)?.title } : null,
      }
    case 'departments':
      return {
        ...row,
        designations: count('designations', 'department_id', row.id),
        employees: count('employees', 'department_id', row.id),
      }
    case 'designations':
      return {
        ...row,
        department: { name: find('departments', row.department_id)?.name },
        kpis: count('kpis', 'designation_id', row.id),
        employees: count('employees', 'designation_id', row.id),
      }
    case 'leaves':
      return { ...row, leave_type: { name: find('leave_types', row.leave_type_id)?.name } }
    case 'leave_types':
      return { ...row, leaves: count('leaves', 'leave_type_id', row.id) }
    case 'job_openings':
      return {
        ...row,
        department: { name: find('departments', row.department_id)?.name },
        designation: { title: find('designations', row.designation_id)?.title },
        manager: row.manager_id ? { full_name: find('employees', row.manager_id)?.full_name } : null,
        application_count: rowsIn('job_applications').filter((a) => a.job_opening_id === row.id).length,
      }
    case 'onboardings': {
      const e = find('employees', row.employee_id)
      return {
        ...row,
        employee: e ? { full_name: e.full_name, company_email: e.company_email, date_of_joining: e.date_of_joining } : null,
        tasks: rowsIn('onboarding_tasks').filter((t) => t.onboarding_id === row.id).map((t) => ({ done_at: t.done_at })),
      }
    }
    case 'offboardings':
      return {
        ...row,
        tasks: rowsIn('offboarding_tasks').filter((t) => t.offboarding_id === row.id).map((t) => ({ done_at: t.done_at })),
      }
    case 'announcements':
      return { ...row, author: row.created_by ? { full_name: find('employees', row.created_by)?.full_name } : null }
    case 'payroll_items':
      return { ...row, ...payrollFigures(row) }
    case 'payrolls':
      return {
        ...row,
        items: rowsIn('payroll_items').filter((i) => i.payroll_id === row.id)
          .map((i) => ({ net_salary: payrollFigures(i).net_salary })),
      }
    case 'leave_quotas': {
      const type = find('leave_types', row.leave_type_id)
      return { ...row, leave_type: { name: type?.name, annual_quota: type?.annual_quota } }
    }
    case 'equipment':
      return { ...row, vendor: row.vendor_id ? { name: find('vendors', row.vendor_id)?.name } : null }
    case 'vendors':
      return { ...row, equipment: count('equipment', 'vendor_id', row.id) }
    case 'peer_review_assignments': {
      const c = find('peer_review_cycles', row.cycle_id)
      return {
        ...row,
        cycle: c ? { year: c.year, quarter: c.quarter, status: c.status, due_date: c.due_date } : null,
        answers: rowsIn('peer_review_answers').filter((a) => a.assignment_id === row.id).map((a) => ({ ...a })),
      }
    }
    case 'manager_feedback':
      return {
        ...row,
        answers: rowsIn('manager_feedback_answers').filter((a) => a.feedback_id === row.id).map((a) => ({ ...a })),
      }
    case 'peer_review_cycles':
      return {
        ...row,
        assignments: rowsIn('peer_review_assignments').filter((a) => a.cycle_id === row.id)
          .map((a) => ({ submitted_at: a.submitted_at })),
      }
    case 'performance_reviews':
      return {
        ...row,
        kpis: rowsIn('performance_review_kpis').filter((k) => k.review_id === row.id).map((k) => ({ ...k })),
        expectations: rowsIn('performance_review_expectations').filter((x) => x.review_id === row.id).map((x) => ({ ...x })),
      }
    default:
      return row
  }
}

function rowsOf(table: Table): Row[] {
  if (table === 'employee_directory') {
    // A view over employees, as in the schema: names, not ids.
    return rowsIn('employees').map((e) => ({
      id: e.id,
      employee_number: e.employee_number,
      full_name: e.full_name,
      company_email: e.company_email,
      designation: find('designations', e.designation_id)?.title ?? null,
      department: find('departments', e.department_id)?.name ?? null,
      status: e.status,
    }))
  }
  return rowsIn(table)
}

let nextId = 1

// One unrated answer per question of the cycle (peer_cycle_open and the
// assignments trigger).
function blankAnswers(assignmentId: string, cycleId: string) {
  for (const q of rowsIn('peer_review_questions').filter((x) => x.cycle_id === cycleId))
    rowsIn('peer_review_answers').push({
      id: `new-${nextId++}`, assignment_id: assignmentId, question_id: q.id, rating: null, comment: null,
    })
}

// Column defaults the database's triggers would set on insert.
function insertDefaults(table: Table, row: Row): Row {
  const last = (rows: Row[]) => Math.max(-1, ...rows.map((r) => Number(r.sort_order))) + 1
  if (table === 'onboarding_template_sections' || table === 'offboarding_template_sections')
    return { sort_order: last(rowsIn(table)), ...row }
  if (table === 'offboarding_template_tasks')
    return { sort_order: last(rowsIn(table).filter((t) => t.section_id === row.section_id)), ...row }
  if (table === 'onboarding_template_tasks')
    return { sort_order: last(rowsIn(table).filter((t) => t.section_id === row.section_id)), ...row }
  // payroll_items_guard: name and number from the employee; figures carry
  // over from their latest earlier payroll.
  if (table === 'payroll_items') {
    const e = find('employees', row.employee_id)
    const target = find('payrolls', row.payroll_id)
    const period = (p: Row | undefined) => Number(p?.year) * 12 + Number(p?.month)
    const previous = rowsIn('payroll_items')
      .filter((i) => i.employee_id === row.employee_id && period(find('payrolls', i.payroll_id)) < period(target))
      .sort((a, b) => period(find('payrolls', b.payroll_id)) - period(find('payrolls', a.payroll_id)))[0]
    // …and basic salary and contractual amount from their salary for the month (salary_on), if any.
    const month = `${target?.year}-${String(target?.month).padStart(2, '0')}-01`
    const salary = rowsIn('salary_revisions')
      .filter((r) => r.employee_id === row.employee_id && r.status === 'approved' && String(r.effective_from) <= month)
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0]
    return {
      ...NO_FIGURES, employee_number: e?.employee_number, full_name: e?.full_name, updated_at: new Date().toISOString(),
      ...(previous && {
        basic_salary: previous.basic_salary, contractual_amount: previous.contractual_amount, allowance: previous.allowance,
      }),
      ...(salary && { basic_salary: salary.basic_salary, contractual_amount: salary.contractual_amount }),
      ...row,
    }
  }
  // manager_feedback_questions_guard: a new question goes last.
  if (table === 'manager_feedback_questions') return { sort_order: last(rowsIn(table)), ...row }
  // peer_review_questions_guard: a new question goes last.
  if (table === 'peer_review_questions')
    return { sort_order: last(rowsIn(table).filter((q) => q.cycle_id === row.cycle_id)), ...row }
  // An assignment added to an open cycle gets its blank answers at once.
  if (table === 'peer_review_assignments') {
    const id = `new-${nextId++}`
    if (find('peer_review_cycles', row.cycle_id)?.status === 'open') blankAnswers(id, String(row.cycle_id))
    return { id, open_feedback: null, submitted_at: null, ...row }
  }
  // salary_revisions_guard: a draft, created by whoever is signed in.
  if (table === 'salary_revisions')
    return {
      contractual_amount: 0, note: null, status: 'draft', updated_at: new Date().toISOString(), submitted_by: null,
      submitted_at: null, approved_by: null, approved_at: null, rejected_by: null, rejected_at: null,
      rejection_reason: null, ...row, created_by: authState.bound?.id,
    }
  // hr_feedback_stamp: the author is whoever is signed in.
  if (table === 'hr_feedback') return { acknowledged_at: null, ...row, author_id: authState.bound?.id }
  // manager_notes_stamp: the author is whoever is signed in.
  if (table === 'manager_notes')
    return { body: '', updated_at: new Date().toISOString(), ...row, author_id: authState.bound?.id }
  // A new claim is in review, with nothing decided yet; reimbursements_guard
  // stamps who made it.
  if (table === 'reimbursements')
    return {
      status: 'review', updated_at: new Date().toISOString(), approved_by: null, approved_at: null, processed_by: null,
      processed_at: null, disbursed_by: null, disbursed_at: null, rejected_by: null, rejected_at: null,
      rejection_reason: null, withdrawn_at: null, transaction_date: null, transaction_reference: null,
      transaction_proof_path: null, ...row, created_by: authState.bound?.id,
    }
  // equipment_guard stamps the creator; nobody has it yet.
  if (table === 'equipment')
    return { assigned_to: null, assigned_on: null, created_by: authState.bound?.id, updated_at: new Date().toISOString(), ...row }
  return row
}

// ---------------------------------------------------------------------------
// Recording and failure injection
// ---------------------------------------------------------------------------

type Op = 'select' | 'insert' | 'update' | 'delete'
type FilterOp = 'eq' | 'neq' | 'gte' | 'lte' | 'is' | 'in'
export type Filter = [col: string, op: FilterOp, value: unknown]

export const captured = {
  reads: [] as string[],
  selects: [] as { table: string; columns: string; filters: Filter[] }[],
  inserts: [] as { table: string; rows: Row[] }[],
  updates: [] as { table: string; values: Row; filters: Filter[] }[],
  deletes: [] as { table: string; filters: Filter[] }[],
  rpcs: [] as { name: string; args: Row | undefined }[],
  uploads: [] as { bucket: string; path: string; contentType?: string }[],
  removals: [] as { bucket: string; paths: string[] }[],
  signedUrls: [] as { bucket: string; path: string; expiresIn: number }[],
  auth: [] as { call: string; options?: unknown }[],
  functions: [] as { name: string; body: unknown }[],
  // Every database or storage call, in order — for asserting sequence.
  calls: [] as string[],
}

const failures = new Map<string, PgError>()

/**
 * Make the next call matching `key` fail with `error`. Keys look like
 * `employees.insert`, `departments.delete`, `rpc.org_chart_remove`,
 * `storage.upload`, `storage.remove`.
 */
export function failNext(key: string, error: PgError) {
  failures.set(key, error)
}

function takeFailure(key: string) {
  const error = failures.get(key)
  if (error) failures.delete(key)
  return error ?? null
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

type Session = { user: { id: string } } | null
type Listener = (event: string, session: Session) => void

export const authState = {
  session: null as Session,
  // What `bind_employee` hands back: the employee row, or null to refuse.
  bound: null as Employee | null,
  // The page was opened from a password reset link: PASSWORD_RECOVERY follows the initial session.
  recovery: false,
}
const listeners = new Set<Listener>()

/** Sign in as this employee, before mounting. `null` = signed in but refused. */
export function signInAs(person: Employee | null) {
  authState.session = { user: { id: `auth-${person?.id ?? 'stranger'}` } }
  authState.bound = person
}

/** Reset every table, recording and auth to the fixtures. Call before each test. */
export function reset() {
  const copy = (rows: Row[]) => rows.map((r) => ({ ...r }))
  db = {
    employees: copy(Object.values(PEOPLE) as unknown as Row[]),
    departments: copy(DEPARTMENTS),
    designations: copy(DESIGNATIONS),
    kpis: copy(KPIS),
    employee_documents: copy(DOCUMENTS),
    org_chart_nodes: copy(ORG_CHART),
    leave_types: copy(LEAVE_TYPES),
    leave_quotas: copy(LEAVE_QUOTAS),
    leaves: copy(LEAVES),
    holidays: copy(HOLIDAYS),
    job_openings: copy(JOB_OPENINGS),
    job_opening_interviewers: copy(JOB_OPENING_INTERVIEWERS),
    job_applications: copy(JOB_APPLICATIONS),
    application_stage_events: copy(APPLICATION_STAGE_EVENTS),
    branding: copy(BRANDING),
    announcements: copy(ANNOUNCEMENTS),
    guides: copy(GUIDES),
    onboarding_template_sections: copy(ONBOARDING_TEMPLATE_SECTIONS),
    onboarding_template_tasks: copy(ONBOARDING_TEMPLATE_TASKS),
    onboardings: copy(ONBOARDINGS),
    onboarding_tasks: copy(ONBOARDING_TASKS),
    offboarding_template_sections: copy(OFFBOARDING_TEMPLATE_SECTIONS),
    offboarding_template_tasks: copy(OFFBOARDING_TEMPLATE_TASKS),
    offboardings: copy(OFFBOARDINGS),
    offboarding_tasks: copy(OFFBOARDING_TASKS),
    salary_revisions: copy(SALARY_REVISIONS),
    payrolls: copy(PAYROLLS),
    payroll_items: copy(PAYROLL_ITEMS),
    vendors: copy(VENDORS),
    equipment: copy(EQUIPMENT),
    equipment_assignments: copy(EQUIPMENT_ASSIGNMENTS),
    expectations: copy(EXPECTATIONS),
    performance_reviews: copy(PERFORMANCE_REVIEWS),
    performance_review_kpis: copy(PERFORMANCE_REVIEW_KPIS),
    performance_review_expectations: copy(PERFORMANCE_REVIEW_EXPECTATIONS),
    hr_feedback: copy(HR_FEEDBACK),
    peer_review_cycles: copy(PEER_REVIEW_CYCLES),
    peer_review_questions: copy(PEER_REVIEW_QUESTIONS),
    peer_review_assignments: copy(PEER_REVIEW_ASSIGNMENTS),
    peer_review_answers: copy(PEER_REVIEW_ANSWERS),
    manager_feedback_questions: copy(MANAGER_FEEDBACK_QUESTIONS),
    manager_feedback: copy(MANAGER_FEEDBACK),
    manager_feedback_answers: copy(MANAGER_FEEDBACK_ANSWERS),
    reimbursements: copy(REIMBURSEMENTS),
  }
  for (const list of Object.values(captured)) list.length = 0
  failures.clear()
  authState.session = null
  authState.bound = null
  authState.recovery = false
  listeners.clear()
}
reset()

/** A table as it now stands, after the app's writes. Push to it to add rows. */
export const table = (name: Table) => rowsOf(name)

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

const test = (row: Row, [col, op, value]: Filter) => {
  const v = (row[col] ?? null) as string | number | null
  switch (op) {
    case 'eq':
    case 'is':
      return v === value
    case 'neq':
      return v !== value
    case 'gte':
      return v !== null && v >= (value as string | number)
    case 'lte':
      return v !== null && v <= (value as string | number)
    case 'in':
      return (value as unknown[]).includes(v)
  }
}

class Query implements PromiseLike<Result> {
  private filters: Filter[] = []
  private columns = '*'
  private sort: { col: string; ascending: boolean } | null = null
  private mode: 'many' | 'single' | 'maybeSingle' = 'many'
  private returning = false
  private counting = false
  private head = false

  constructor(
    private readonly name: Table,
    private readonly op: Op,
    private readonly payload?: Row | Row[],
  ) {}

  select(columns = '*', opts?: { count?: 'exact'; head?: boolean }) {
    this.columns = columns
    this.returning = true
    this.counting = !!opts?.count
    this.head = !!opts?.head
    return this
  }
  private where(col: string, op: FilterOp, value: unknown) {
    this.filters.push([col, op, value])
    return this
  }
  eq = (col: string, value: unknown) => this.where(col, 'eq', value)
  neq = (col: string, value: unknown) => this.where(col, 'neq', value)
  gte = (col: string, value: unknown) => this.where(col, 'gte', value)
  lte = (col: string, value: unknown) => this.where(col, 'lte', value)
  is = (col: string, value: null) => this.where(col, 'is', value)
  'in' = (col: string, values: unknown[]) => this.where(col, 'in', values)
  order(col: string, { ascending = true } = {}) {
    this.sort = { col, ascending }
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybeSingle'
    return this
  }

  private matches = (row: Row) => this.filters.every((f) => test(row, f))

  private execute(): Result {
    const key = `${this.name}.${this.op}`
    const input = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]
    // Recorded before any injected failure: a refused request was still sent.
    captured.calls.push(key)
    if (this.op === 'select') {
      captured.reads.push(this.name)
      captured.selects.push({ table: this.name, columns: this.columns, filters: this.filters })
    }
    if (this.op === 'insert') captured.inserts.push({ table: this.name, rows: input })
    if (this.op === 'update') captured.updates.push({ table: this.name, values: input[0], filters: this.filters })
    if (this.op === 'delete') captured.deletes.push({ table: this.name, filters: this.filters })
    const error = takeFailure(key)
    if (error) return { data: null, error }

    let rows: Row[]
    switch (this.op) {
      case 'select':
        rows = rowsOf(this.name).filter(this.matches).map((r) => withEmbeds(this.name, r))
        break
      case 'insert':
        rows = input.map((r) => ({ id: `new-${nextId++}`, created_at: new Date().toISOString(), ...insertDefaults(this.name, r) }))
        rowsIn(this.name).push(...rows)
        break
      case 'update':
        rows = rowsIn(this.name).filter(this.matches)
        for (const r of rows) Object.assign(r, input[0])
        break
      case 'delete':
        rows = rowsIn(this.name).filter(this.matches)
        db[this.name] = rowsIn(this.name).filter((r) => !this.matches(r))
        break
    }

    if (this.sort) {
      const { col, ascending } = this.sort
      rows = [...rows].sort((a, b) => {
        const x = a[col] as string | number, y = b[col] as string | number
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1)
      })
    }
    const data = this.head ? null : this.op === 'select' || this.returning ? rows : null
    if (this.mode === 'many') return { data, error: null, ...(this.counting ? { count: rows.length } : {}) }
    if (this.mode === 'maybeSingle') return { data: rows[0] ?? null, error: null }
    return rows.length === 1
      ? { data: rows[0], error: null }
      : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected)
  }
}

// ---------------------------------------------------------------------------
// Database functions
// ---------------------------------------------------------------------------

// Simplified stand-ins for the SQL functions: enough for the pages to show the
// result of a call. The real rules (who may, quotas, overlaps) live in SQL.
const RPCS: Record<string, (args: Row) => unknown> = {
  bind_employee: () => (authState.bound ? { ...authState.bound } : null),

  // Reports move up to the removed person's manager.
  org_chart_remove: ({ p_employee_id: id }) => {
    const node = rowsIn('org_chart_nodes').find((n) => n.employee_id === id)
    if (node) {
      for (const n of rowsIn('org_chart_nodes')) if (n.manager_id === id) n.manager_id = node.manager_id
      db.org_chart_nodes = rowsIn('org_chart_nodes').filter((n) => n !== node)
    }
    return null
  },

  // Quota (personal override, else the type's default), approved and pending days.
  leave_balances: ({ p_employee_id: who, p_year: year }) =>
    rowsIn('leave_types')
      .filter((t) => t.is_active)
      .map((t) => {
        const mine = rowsIn('leaves').filter(
          (l) => l.employee_id === who && l.leave_type_id === t.id && Number(String(l.start_date).slice(0, 4)) === year,
        )
        const sum = (status: string) =>
          mine.filter((l) => l.status === status).reduce((n, l) => n + Number(l.days), 0)
        const override = rowsIn('leave_quotas').find(
          (q) => q.employee_id === who && q.leave_type_id === t.id && q.year === year,
        )
        return {
          leave_type_id: t.id, name: t.name, quota: override ? override.days : t.annual_quota,
          approved: sum('approved'), pending: sum('pending'),
        }
      }),

  leave_decide: ({ p_leave_id: id, p_approve: approve, p_reason: reason }) => {
    const l = find('leaves', id)
    if (l && !approve) Object.assign(l, { status: 'rejected', rejected_by: authState.bound?.id, rejection_reason: reason })
    if (l && approve) Object.assign(l, { status: 'approved' })
    return null
  },

  // An open job, with names for department and designation; nothing otherwise.
  job_posting: ({ p_id: id }) => {
    const j = find('job_openings', id)
    if (!j || j.status !== 'open') return null
    return {
      id: j.id, title: j.title, department: find('departments', j.department_id)?.name,
      designation: find('designations', j.designation_id)?.title, due_date: j.due_date, description: j.description,
      accepting: !j.due_date || String(j.due_date) >= new Date().toISOString().slice(0, 10),
    }
  },

  on_hiring_team: () => {
    const me = authState.bound?.id
    return rowsIn('job_openings').some((j) => j.manager_id === me) ||
      rowsIn('job_opening_interviewers').some((i) => i.employee_id === me)
  },

  // HR, or the job's hiring manager; no row for anyone else.
  application_hr_details: ({ p_application_id: id }) => {
    const a = find('job_applications', id)
    const me = authState.bound
    const hr = me?.app_role === 'hr_admin' || me?.app_role === 'company_admin'
    return a && (hr || find('job_openings', a.job_opening_id)?.manager_id === me?.id)
      ? { current_salary: a.current_salary, expected_salary: a.expected_salary, hr_notes: a.hr_notes }
      : null
  },

  application_set_hr_details: ({ p_application_id: id, p_current_salary, p_hr_notes }) => {
    const a = find('job_applications', id)
    if (a) Object.assign(a, { current_salary: p_current_salary, hr_notes: p_hr_notes })
    return null
  },

  application_move: ({ p_application_id: id, p_stage: stage, p_reason: reason }) => {
    const a = find('job_applications', id)
    if (!a) return null
    rowsIn('application_stage_events').push({
      id: nextId++, application_id: id, kind: 'move', from_stage: a.stage, to_stage: stage, reason,
      created_by: authState.bound?.id, created_at: new Date().toISOString(), undone_by: null, undone_at: null,
    })
    Object.assign(a, { stage, stage_changed_at: new Date().toISOString() })
    return null
  },

  // Back to where the last move not yet undone came from.
  application_undo: ({ p_application_id: id, p_reason: reason }) => {
    const a = find('job_applications', id)
    const last = rowsIn('application_stage_events')
      .filter((e) => e.application_id === id && e.kind === 'move' && !e.undone_at).at(-1)
    if (!a || !last) return null
    Object.assign(last, { undone_by: authState.bound?.id, undone_at: new Date().toISOString() })
    rowsIn('application_stage_events').push({
      id: nextId++, application_id: id, kind: 'undo', from_stage: a.stage, to_stage: last.from_stage, reason,
      created_by: authState.bound?.id, created_at: new Date().toISOString(), undone_by: null, undone_at: null,
    })
    Object.assign(a, { stage: last.from_stage })
    return null
  },

  // Creates the employee (status joining), their onboarding with the checklist
  // copied in, and moves the application to hired. Returns the onboarding id.
  application_hire: ({ p_application_id: id, p_company_email: email, p_date_of_joining: joining, p_reason: reason }) => {
    const a = find('job_applications', id)
    if (!a) return null
    const job = find('job_openings', a.job_opening_id)
    const employeeId = `new-${nextId++}`
    rowsIn('employees').push({
      ...employee(employeeId, nextId++, String(a.full_name), String(email), 'member', 'joining',
        (job?.department_id ?? null) as string | null, (job?.designation_id ?? null) as string | null),
      date_of_joining: joining, personal_email: a.email, phone: a.phone,
    } as unknown as Row)
    const due = new Date(`${joining}T00:00:00`)
    due.setDate(due.getDate() + 1)
    const onboardingId = `new-${nextId++}`
    rowsIn('onboardings').push(onboarding(onboardingId, employeeId,
      `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`,
      'in_progress', { application_id: id, created_by: authState.bound?.id, created_at: new Date().toISOString() }))
    for (const s of rowsIn('onboarding_template_sections')) {
      for (const t of rowsIn('onboarding_template_tasks').filter((x) => x.section_id === s.id)) {
        rowsIn('onboarding_tasks').push(onboardingTask(`new-${nextId++}`, onboardingId, String(s.name),
          Number(s.sort_order), String(t.title), Number(t.sort_order)))
      }
    }
    RPCS.application_move({ p_application_id: id, p_stage: 'hired', p_reason: reason })
    return onboardingId
  },

  onboarding_task_set: ({ p_task_id: id, p_done: done }) => {
    const t = find('onboarding_tasks', id)
    if (t) Object.assign(t, { done_by: done ? authState.bound?.id : null, done_at: done ? new Date().toISOString() : null })
    return null
  },

  onboarding_complete: ({ p_onboarding_id: id }) => {
    const o = find('onboardings', id)
    if (o) Object.assign(o, { status: 'completed', completed_by: authState.bound?.id, completed_at: new Date().toISOString() })
    return null
  },

  onboarding_cancel: ({ p_onboarding_id: id, p_reason: reason }) => {
    const o = find('onboardings', id)
    if (o) Object.assign(o, {
      status: 'cancelled', cancelled_by: authState.bound?.id, cancelled_at: new Date().toISOString(), cancel_reason: reason,
    })
    return null
  },

  // Each id's position in the list becomes its sort_order.
  onboarding_reorder_sections: ({ p_ids: ids }) => {
    ;(ids as string[]).forEach((id, i) => Object.assign(find('onboarding_template_sections', id) ?? {}, { sort_order: i }))
    return null
  },
  onboarding_reorder_tasks: ({ p_ids: ids }) => {
    ;(ids as string[]).forEach((id, i) => Object.assign(find('onboarding_template_tasks', id) ?? {}, { sort_order: i }))
    return null
  },

  // Appraisals: draft → review → approved, or rejected back to draft.
  salary_revision_move: ({ p_revision_id: id, p_status: status, p_reason: reason }) => {
    const r = find('salary_revisions', id)
    const me = authState.bound?.id
    const now = new Date().toISOString()
    if (r && status === 'review') Object.assign(r, { status, submitted_by: me, submitted_at: now })
    if (r && status === 'approved') Object.assign(r, { status, approved_by: me, approved_at: now })
    if (r && status === 'draft') Object.assign(r, { status, rejected_by: me, rejected_at: now, rejection_reason: reason })
    return null
  },

  // The signed-in employee's approved salaries, newest first.
  my_salaries: () =>
    rowsIn('salary_revisions')
      .filter((r) => r.employee_id === authState.bound?.id && r.status === 'approved')
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))
      .map(({ id, effective_from, basic_salary, contractual_amount, approved_at }) =>
        ({ id, effective_from, basic_salary, contractual_amount, approved_at })),

  // Offboarding: unticking a task, or changing the details, clears sign-offs.
  offboarding_task_set: ({ p_task_id: id, p_done: done }) => {
    const t = find('offboarding_tasks', id)
    if (t) Object.assign(t, { done_by: done ? authState.bound?.id : null, done_at: done ? new Date().toISOString() : null })
    if (t && !done) Object.assign(find('offboardings', t.offboarding_id) ?? {}, NO_SIGN_OFFS)
    return null
  },

  offboarding_set_details: ({ p_offboarding_id: id, p_reason: reason, p_last_working_day: day }) => {
    Object.assign(find('offboardings', id) ?? {}, { reason, last_working_day: day, ...NO_SIGN_OFFS })
    return null
  },

  // Signs as HR and/or the manager; the last sign-off completes it and marks
  // the employee as left (or terminated).
  offboarding_sign_off: ({ p_offboarding_id: id }) => {
    const o = find('offboardings', id)
    const me = authState.bound
    if (!o || !me) return null
    const now = new Date().toISOString()
    const manager = rowsIn('org_chart_nodes').find((n) => n.employee_id === o.employee_id)?.manager_id ?? null
    if (['hr_admin', 'company_admin'].includes(me.app_role) && !o.hr_signed_by)
      Object.assign(o, { hr_signed_by: me.id, hr_signed_at: now })
    if (manager === me.id && !o.manager_signed_by) Object.assign(o, { manager_signed_by: me.id, manager_signed_at: now })
    if (o.hr_signed_by && (o.manager_signed_by || !manager)) {
      Object.assign(o, { status: 'completed', completed_at: now })
      Object.assign(find('employees', o.employee_id) ?? {}, {
        status: o.reason === 'terminated' ? 'terminated' : 'left', date_of_separation: o.last_working_day,
      })
    }
    return null
  },

  offboarding_cancel: ({ p_offboarding_id: id, p_reason: reason }) => {
    Object.assign(find('offboardings', id) ?? {}, {
      status: 'cancelled', cancelled_by: authState.bound?.id, cancelled_at: new Date().toISOString(), cancel_reason: reason,
    })
    return null
  },

  offboarding_reorder_sections: ({ p_ids: ids }) => {
    ;(ids as string[]).forEach((id, i) => Object.assign(find('offboarding_template_sections', id) ?? {}, { sort_order: i }))
    return null
  },
  offboarding_reorder_tasks: ({ p_ids: ids }) => {
    ;(ids as string[]).forEach((id, i) => Object.assign(find('offboarding_template_tasks', id) ?? {}, { sort_order: i }))
    return null
  },

  // A draft with everyone who may log in. Returns the payroll's id.
  payroll_create: ({ p_year: year, p_month: month }) => {
    const id = `new-${nextId++}`
    rowsIn('payrolls').push(payroll(id, Number(year), Number(month), 'draft',
      { created_by: authState.bound?.id, created_at: new Date().toISOString() }))
    for (const e of rowsIn('employees').filter((x) => ['probation', 'active', 'notice_period'].includes(String(x.status)))) {
      rowsIn('payroll_items').push({ id: `new-${nextId++}`, ...insertDefaults('payroll_items', { payroll_id: id, employee_id: e.id }) })
    }
    return id
  },

  // The caller's lines on disbursed payrolls, newest first, without remarks.
  my_payslips: () =>
    rowsIn('payroll_items')
      .filter((i) => i.employee_id === authState.bound?.id && find('payrolls', i.payroll_id)?.status === 'disbursed')
      .map((i) => {
        const p = find('payrolls', i.payroll_id)!
        const { id: _id, employee_id: _e, hr_remarks: _h, finance_remarks: _f, created_at: _c, updated_at: _u, ...line } = i
        return { ...line, ...payrollFigures(i), year: p.year, month: p.month, disbursed_at: p.disbursed_at }
      })
      .sort((a, b) => Number(b.year) * 12 + Number(b.month) - (Number(a.year) * 12 + Number(a.month))),

  // Sets the status and stamps who moved it; back to draft clears review and approval.
  payroll_move: ({ p_payroll_id: id, p_status: status }) => {
    const p = find('payrolls', id)
    const now = new Date().toISOString()
    const me = authState.bound?.id
    if (!p) return null
    if (status === 'review') Object.assign(p, { status, submitted_by: me, submitted_at: now })
    if (status === 'approved') Object.assign(p, { status, approved_by: me, approved_at: now })
    if (status === 'processed') Object.assign(p, { status, processed_by: me, processed_at: now })
    if (status === 'disbursed') Object.assign(p, { status, disbursed_by: me, disbursed_at: now })
    if (status === 'draft')
      Object.assign(p, { status, submitted_by: null, submitted_at: null, approved_by: null, approved_at: null })
    return null
  },

  // Ends the current holder's assignment that day and opens a new one.
  equipment_assign: ({ p_equipment_id: id, p_employee_id: who, p_assigned_on: on }) => {
    const item = find('equipment', id)
    if (!item) return null
    const me = authState.bound?.id
    for (const a of rowsIn('equipment_assignments'))
      if (a.equipment_id === id && !a.unassigned_on) Object.assign(a, { unassigned_on: on, unassigned_by: me })
    rowsIn('equipment_assignments').push({
      id: `new-${nextId++}`, equipment_id: id, employee_id: who, assigned_on: on, assigned_by: me,
      unassigned_on: null, unassigned_by: null, created_at: new Date().toISOString(),
    })
    Object.assign(item, { assigned_to: who, assigned_on: on })
    return null
  },

  equipment_unassign: ({ p_equipment_id: id, p_unassigned_on: on }) => {
    const item = find('equipment', id)
    if (!item) return null
    for (const a of rowsIn('equipment_assignments'))
      if (a.equipment_id === id && !a.unassigned_on) Object.assign(a, { unassigned_on: on, unassigned_by: authState.bound?.id })
    Object.assign(item, { assigned_to: null, assigned_on: null })
    return null
  },

  // Sets the status and stamps who moved it (a rejection keeps its reason).
  reimbursement_move: ({ p_reimbursement_id: id, p_status: status, p_reason: reason }) => {
    const r = find('reimbursements', id)
    const now = new Date().toISOString()
    const me = authState.bound?.id
    if (!r) return null
    if (status === 'approved') Object.assign(r, { status, approved_by: me, approved_at: now })
    if (status === 'processed') Object.assign(r, { status, processed_by: me, processed_at: now })
    if (status === 'rejected') Object.assign(r, { status, rejected_by: me, rejected_at: now, rejection_reason: reason })
    if (status === 'withdrawn') Object.assign(r, { status, withdrawn_at: now })
    return null
  },

  reimbursement_disburse: ({ p_reimbursement_id: id, p_transaction_date: date, p_reference: ref, p_proof_path: proof }) => {
    const r = find('reimbursements', id)
    if (r)
      Object.assign(r, {
        status: 'disbursed', disbursed_by: authState.bound?.id, disbursed_at: new Date().toISOString(),
        transaction_date: date, transaction_reference: ref, transaction_proof_path: proof,
      })
    return null
  },

  // The caller's equipment: name, identifier and date only, newest first.
  my_equipment: () =>
    rowsIn('equipment')
      .filter((e) => e.assigned_to === authState.bound?.id)
      .sort((a, b) => String(b.assigned_on).localeCompare(String(a.assigned_on)))
      .map((e) => ({ name: e.name, identifier: e.identifier, assigned_on: e.assigned_on })),

  public_branding: () => {
    const b = rowsIn('branding')[0]
    return b ? { logo_path: b.logo_path, primary_color: b.primary_color, perks: b.perks } : null
  },

  submit_application: (a) => {
    rowsIn('job_applications').push({
      id: `new-${nextId++}`, job_opening_id: a.p_job_opening_id, full_name: a.p_full_name, email: a.p_email,
      phone: a.p_phone, expected_salary: a.p_expected_salary, note: a.p_note, resume_path: a.p_resume_path, resume_name: a.p_resume_name,
    })
    return null
  },

  // Everyone who may log in and had joined by the month's first day, with
  // their manager and review. HR sees all; a manager their direct reports.
  performance_due: ({ p_period: period }) => {
    const me = authState.bound
    const hr = me?.app_role === 'hr_admin' || me?.app_role === 'company_admin'
    return rowsIn('employees')
      .filter((e) => ['probation', 'active', 'notice_period'].includes(String(e.status)) &&
        String(e.date_of_joining) <= String(period))
      .map((e) => {
        const managerId = (rowsIn('org_chart_nodes').find((n) => n.employee_id === e.id)?.manager_id ?? null) as string | null
        const r = rowsIn('performance_reviews').find((x) => x.employee_id === e.id && x.period === period)
        return {
          employee_id: e.id, full_name: e.full_name, designation: find('designations', e.designation_id)?.title ?? null,
          manager_id: managerId, manager_name: managerId ? find('employees', managerId)?.full_name : null,
          review_id: r?.id ?? null, status: r?.status ?? null, due_date: dueOf(String(period)),
          submitted_at: r?.submitted_at ?? null, late: r?.late ?? null, acknowledged_at: r?.acknowledged_at ?? null,
        }
      })
      .filter((r) => hr || r.manager_id === me?.id)
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
  },

  // A draft with the designation's KPIs and expectations copied in. Returns its id.
  review_start: ({ p_employee_id: who, p_period: period }) => {
    const id = `new-${nextId++}`
    const designation = find('employees', who)?.designation_id
    rowsIn('performance_reviews').push(review(id, String(who), String(period), 'draft', {
      created_by: authState.bound?.id, created_at: new Date().toISOString(),
    }))
    rowsIn('kpis').filter((k) => k.designation_id === designation)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .forEach((k, i) => rowsIn('performance_review_kpis').push({
        id: `new-${nextId++}`, review_id: id, kpi_id: k.id, name: k.name, description: k.description, target: k.target,
        weight: k.weight, sort_order: i, rating: null, note: null,
      }))
    rowsIn('expectations').filter((x) => x.designation_id === designation)
      .sort((a, b) => String(a.title).localeCompare(String(b.title)))
      .forEach((x, i) => rowsIn('performance_review_expectations').push({
        id: `new-${nextId++}`, review_id: id, expectation_id: x.id, title: x.title, sort_order: i, met: null, note: null,
      }))
    return id
  },

  // Submitted, stamped, late if after the due date; the goal as the SQL keeps it is not worked out here.
  review_submit: ({ p_review_id: id }) => {
    const r = find('performance_reviews', id)
    const today = new Date().toISOString().slice(0, 10)
    if (r) Object.assign(r, {
      status: 'submitted', submitted_by: authState.bound?.id, submitted_at: new Date().toISOString(),
      late: r.submitted_at ? r.late : today > String(r.due_date),
    })
    return null
  },

  hr_feedback_acknowledge: ({ p_feedback_id: id }) => {
    const f = find('hr_feedback', id)
    if (f) Object.assign(f, { acknowledged_at: new Date().toISOString() })
    return null
  },

  // The caller's form for this quarter, made the first time (in the quarter's
  // last month, with a manager); the same one after that. Returns its id.
  manager_feedback_start: () => {
    const me = authState.bound?.id
    const today = new Date().toISOString().slice(0, 10)
    const year = Number(today.slice(0, 4))
    const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1
    const existing = rowsIn('manager_feedback').find((f) => f.employee_id === me && f.year === year && f.quarter === quarter)
    if (existing) return existing.id
    const id = `new-${nextId++}`
    rowsIn('manager_feedback').push({
      id, employee_id: me, manager_id: rowsIn('org_chart_nodes').find((n) => n.employee_id === me)?.manager_id ?? null,
      year, quarter, due_date: `${year}-${String(quarter * 3).padStart(2, '0')}-10`, body: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), submitted_at: null, late: false,
    })
    ;[...rowsIn('manager_feedback_questions')].sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
      .forEach((q, i) => rowsIn('manager_feedback_answers').push({ id: `new-${nextId++}`, feedback_id: id, prompt: q.prompt, sort_order: i, rating: null }))
    return id
  },

  manager_feedback_submit: ({ p_feedback_id: id }) => {
    const f = find('manager_feedback', id)
    const today = new Date().toISOString().slice(0, 10)
    if (f) Object.assign(f, { submitted_at: new Date().toISOString(), late: today > String(f.due_date) })
    return null
  },

  // Who owes feedback that quarter (login status, a manager, joined by the
  // first of its last month), with their form; never rows about the caller.
  manager_feedback_due: ({ p_year: year, p_quarter: quarter }) => {
    const me = authState.bound?.id
    const opens = `${year}-${String(Number(quarter) * 3).padStart(2, '0')}-01`
    return rowsIn('employees')
      .map((e) => {
        const f = rowsIn('manager_feedback').find((x) => x.employee_id === e.id && x.year === year && x.quarter === quarter)
        const managerId = (f?.manager_id ?? rowsIn('org_chart_nodes').find((n) => n.employee_id === e.id)?.manager_id ?? null) as string | null
        const owes = ['probation', 'active', 'notice_period'].includes(String(e.status)) && !!managerId && String(e.date_of_joining) <= opens
        return (f || owes) && managerId !== me ? {
          employee_id: e.id, full_name: e.full_name, manager_id: managerId, manager_name: managerId ? find('employees', managerId)?.full_name : null,
          feedback_id: f?.id ?? null, due_date: `${year}-${String(Number(quarter) * 3).padStart(2, '0')}-10`,
          submitted_at: f?.submitted_at ?? null, late: f?.late ?? null,
        } : null
      })
      .filter(Boolean)
      .sort((a, b) => String(a!.full_name).localeCompare(String(b!.full_name)))
  },

  // A draft with the latest earlier cycle's questions, or the starter ones.
  peer_cycle_create: ({ p_year: year, p_quarter: quarter, p_due_date: due }) => {
    const id = `new-${nextId++}`
    const cycles = rowsIn('peer_review_cycles')
    const previous = cycles
      .filter((c) => Number(c.year) * 4 + Number(c.quarter) < Number(year) * 4 + Number(quarter))
      .sort((a, b) => Number(b.year) * 4 + Number(b.quarter) - (Number(a.year) * 4 + Number(a.quarter)))[0]
    cycles.push({
      id, year, quarter, status: 'draft', due_date: due, created_by: authState.bound?.id, created_at: new Date().toISOString(),
      opened_at: null, closed_at: null, updated_at: new Date().toISOString(),
    })
    const prompts = previous
      ? rowsIn('peer_review_questions').filter((q) => q.cycle_id === previous.id)
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order)).map((q) => q.prompt)
      : ['Collaborates well and is easy to work with.', 'Communicates clearly and keeps others informed.',
        'Delivers reliable, high-quality work.', 'Takes ownership and follows through.']
    prompts.forEach((prompt, i) => rowsIn('peer_review_questions').push({ id: `new-${nextId++}`, cycle_id: id, prompt, sort_order: i }))
    return id
  },

  peer_cycle_open: ({ p_cycle_id: id }) => {
    const c = find('peer_review_cycles', id)
    if (!c) return null
    Object.assign(c, { status: 'open', opened_at: new Date().toISOString() })
    for (const a of rowsIn('peer_review_assignments').filter((x) => x.cycle_id === id)) blankAnswers(String(a.id), String(id))
    return null
  },

  peer_cycle_close: ({ p_cycle_id: id }) => {
    const c = find('peer_review_cycles', id)
    if (c) Object.assign(c, { status: 'closed', closed_at: new Date().toISOString() })
    return null
  },

  peer_review_submit: ({ p_assignment_id: id }) => {
    const a = find('peer_review_assignments', id)
    if (a) Object.assign(a, { submitted_at: new Date().toISOString() })
    return null
  },

  // The caller's responses in closed cycles with two or more: no reviewer, a
  // fixed order that isn't who submitted first.
  my_peer_feedback: () => {
    const me = authState.bound?.id
    const out: Row[] = []
    for (const c of rowsIn('peer_review_cycles').filter((x) => x.status === 'closed')) {
      const done = rowsIn('peer_review_assignments')
        .filter((a) => a.cycle_id === c.id && a.subject_id === me && a.submitted_at)
        .sort((a, b) => String(b.id).localeCompare(String(a.id)))
      if (done.length < 2) continue
      done.forEach((a, i) => out.push({
        cycle_id: c.id, year: c.year, quarter: c.quarter, response: i + 1, open_feedback: a.open_feedback,
        answers: rowsIn('peer_review_answers').filter((r) => r.assignment_id === a.id).map((r) => {
          const q = find('peer_review_questions', r.question_id)!
          return { prompt: q.prompt, sort_order: q.sort_order, rating: r.rating, comment: r.comment }
        }),
      }))
    }
    return out
  },

  review_acknowledge: ({ p_review_id: id }) => {
    const r = find('performance_reviews', id)
    if (r) Object.assign(r, { acknowledged_at: new Date().toISOString() })
    return null
  },

  leave_cancel: ({ p_leave_id: id }) => {
    const l = find('leaves', id)
    if (l) Object.assign(l, { status: 'cancelled', cancelled_by: authState.bound?.id })
    return null
  },
}

function rpc(name: string, args?: Row) {
  const run = (): Result => {
    captured.rpcs.push({ name, args })
    captured.calls.push(`rpc.${name}`)
    const error = takeFailure(`rpc.${name}`)
    if (error) return { data: null, error }
    const fn = RPCS[name]
    return fn ? { data: fn(args ?? {}), error: null } : { data: null, error: { message: `unknown rpc ${name}` } }
  }
  const promise = Promise.resolve().then(run)
  return Object.assign(promise, { maybeSingle: () => promise })
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export const supabase = {
  from: (name: Table) => ({
    select: (columns?: string, opts?: { count?: 'exact'; head?: boolean }) =>
      new Query(name, 'select').select(columns, opts),
    insert: (payload: Row | Row[]) => new Query(name, 'insert', payload),
    update: (payload: Row) => new Query(name, 'update', payload),
    delete: () => new Query(name, 'delete'),
  }),
  rpc,
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, _file: File, opts?: { contentType?: string }) => {
        captured.calls.push('storage.upload')
        captured.uploads.push({ bucket, path, contentType: opts?.contentType })
        const error = takeFailure('storage.upload')
        return { data: error ? null : { path }, error }
      },
      remove: async (paths: string[]) => {
        captured.calls.push('storage.remove')
        captured.removals.push({ bucket, paths })
        const error = takeFailure('storage.remove')
        return { data: error ? null : paths.map((name) => ({ name })), error }
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://public.example/${bucket}/${path}` } }),
      createSignedUrl: async (path: string, expiresIn: number) => {
        captured.signedUrls.push({ bucket, path, expiresIn })
        return { data: { signedUrl: `https://signed.example/${bucket}/${path}` }, error: null }
      },
    }),
  },
  // Edge Functions. `failNext('functions.<name>', …)` fails one the way
  // supabase-js does: a generic error whose context is the function's reply.
  functions: {
    async invoke(name: string, options?: { body?: unknown }) {
      captured.calls.push(`functions.${name}`)
      captured.functions.push({ name, body: options?.body })
      const error = takeFailure(`functions.${name}`)
      if (!error) return { data: { ok: true }, error: null }
      const context = new Response(JSON.stringify({ error: error.message }), { status: 400 })
      return { data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context }) }
    },
  },
  auth: {
    onAuthStateChange(listener: Listener) {
      listeners.add(listener)
      setTimeout(() => {
        listener('INITIAL_SESSION', authState.session)
        if (authState.recovery) listener('PASSWORD_RECOVERY', authState.session)
      }, 0)
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
    },
    async signInWithOAuth(options: unknown) {
      captured.auth.push({ call: 'signInWithOAuth', options })
      return { data: {}, error: null }
    },
    // Signs in whoever `authState.bound` is; `failNext('auth.signInWithPassword')` refuses.
    async signInWithPassword(options: unknown) {
      captured.auth.push({ call: 'signInWithPassword', options })
      const error = takeFailure('auth.signInWithPassword')
      if (error) return { data: { session: null }, error }
      authState.session = { user: { id: `auth-${authState.bound?.id ?? 'stranger'}` } }
      for (const l of listeners) l('SIGNED_IN', authState.session)
      return { data: { session: authState.session }, error: null }
    },
    async resetPasswordForEmail(email: string, options: unknown) {
      captured.auth.push({ call: 'resetPasswordForEmail', options: { email, ...(options as object) } })
      return { data: {}, error: takeFailure('auth.resetPasswordForEmail') }
    },
    async updateUser(attributes: unknown) {
      captured.auth.push({ call: 'updateUser', options: attributes })
      const error = takeFailure('auth.updateUser')
      return { data: { user: error ? null : authState.session?.user }, error }
    },
    async signOut() {
      captured.auth.push({ call: 'signOut' })
      authState.session = null
      for (const l of listeners) l('SIGNED_OUT', null)
      return { error: null }
    },
  },
}
