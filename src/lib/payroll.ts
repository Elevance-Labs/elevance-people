import type { EmployeeStatus, Payroll, PayrollItem, Payslip } from './types'

// The list also needs each payroll's lines, for the head count and total.
export type PayrollListRow = Payroll & { items: Pick<PayrollItem, 'net_salary'>[] }
export const PAYROLL_LIST = '*, items:payroll_items(net_salary)'

// Who can be on a payroll. Mirrors public.is_login_status.
export const PAYABLE_STATUSES: EmployeeStatus[] = ['probation', 'active', 'notice_period']

// The columns each side edits. payroll_items_guard refuses the other side's.
export const HR_FIELDS = ['basic_salary', 'contractual_amount', 'absent_days', 'hr_remarks'] as const
export const FINANCE_FIELDS = [
  'bonus_type',
  'bonus_value',
  'absent_deduction',
  'allowance',
  'arrears',
  'advance_salary',
  'loan_deduction',
  'tax_amount',
  'finance_remarks',
] as const

export const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'long' }),
)

export const periodLabel = (p: Pick<Payroll, 'year' | 'month'>) => `${MONTHS[p.month - 1]} ${p.year}`

// Newest month first.
export const byPeriodDesc = (a: Pick<Payroll, 'year' | 'month'>, b: Pick<Payroll, 'year' | 'month'>) =>
  b.year - a.year || b.month - a.month

export const formatAmount = (n: number) =>
  n.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

// ---------------------------------------------------------------------------
// The worked-out columns. Mirror the generated columns of payroll_items, so
// the edit dialog can show them before saving.
// ---------------------------------------------------------------------------

type Figures = Pick<
  PayrollItem,
  | 'basic_salary'
  | 'contractual_amount'
  | 'bonus_type'
  | 'bonus_value'
  | 'absent_deduction'
  | 'allowance'
  | 'arrears'
  | 'advance_salary'
  | 'loan_deduction'
  | 'tax_amount'
>

const round2 = (n: number) => Math.round(n * 100) / 100

export const bonusOf = (f: Figures) =>
  f.bonus_type === 'percent' ? round2((f.basic_salary * f.bonus_value) / 100) : f.bonus_value

export const grossOf = (f: Figures) =>
  round2(f.basic_salary + f.contractual_amount + bonusOf(f) + f.allowance + f.arrears - f.absent_deduction)

export const netOf = (f: Figures) => round2(grossOf(f) - f.advance_salary - f.loan_deduction - f.tax_amount)

// ---------------------------------------------------------------------------
// Table columns and CSV
// ---------------------------------------------------------------------------

// The money columns, in sheet order, with a total under each.
export const AMOUNT_COLUMNS = [
  ['basic_salary', 'Basic salary'],
  ['contractual_amount', 'Contractual amount'],
  ['bonus', 'Bonus'],
  ['absent_days', 'Absent days'],
  ['absent_deduction', 'Absent deduction'],
  ['allowance', 'Allowance'],
  ['arrears', 'Arrears'],
  ['gross_salary', 'Gross salary'],
  ['advance_salary', 'Advance salary'],
  ['loan_deduction', 'Loan deduction'],
  ['tax_amount', 'Tax amount'],
  ['net_salary', 'Net payable salary'],
] as const satisfies readonly (readonly [keyof PayrollItem, string])[]

export const totalOf = (items: PayrollItem[], key: (typeof AMOUNT_COLUMNS)[number][0]) =>
  round2(items.reduce((sum, i) => sum + Number(i[key]), 0))

const CSV_COLUMNS: [string, (i: PayrollItem) => string | number | null][] = [
  ['Employee number', (i) => i.employee_number],
  ['Name', (i) => i.full_name],
  ['Basic salary', (i) => i.basic_salary],
  ['Contractual amount', (i) => i.contractual_amount],
  ['Bonus % of basic', (i) => (i.bonus_type === 'percent' ? i.bonus_value : null)],
  ['Bonus', (i) => i.bonus],
  ['Absent days', (i) => i.absent_days],
  ['Absent deduction', (i) => i.absent_deduction],
  ['Allowance', (i) => i.allowance],
  ['Arrears', (i) => i.arrears],
  ['Gross salary', (i) => i.gross_salary],
  ['Advance salary', (i) => i.advance_salary],
  ['Loan deduction', (i) => i.loan_deduction],
  ['Tax amount', (i) => i.tax_amount],
  ['Net payable salary', (i) => i.net_salary],
  ['HR remarks', (i) => i.hr_remarks],
  ['Finance remarks', (i) => i.finance_remarks],
]

function csvCell(value: string | number | null) {
  if (value === null) return ''
  let s = String(value)
  // Text a spreadsheet would run as a formula is kept as text.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function payrollCsv(items: PayrollItem[]) {
  return [CSV_COLUMNS.map(([header]) => header), ...items.map((i) => CSV_COLUMNS.map(([, get]) => get(i)))]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\r\n')
}

export const csvFileName = (p: Pick<Payroll, 'year' | 'month'>) =>
  `payroll-${p.year}-${String(p.month).padStart(2, '0')}.csv`

// Hands the browser a file to save.
export function downloadFile(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// A byte order mark first makes Excel read the file as UTF-8.
const BOM = String.fromCharCode(0xfeff)
export const downloadCsv = (fileName: string, csv: string) =>
  downloadFile(fileName, new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }))

// ---------------------------------------------------------------------------
// Payslips
// ---------------------------------------------------------------------------

export type PayslipLine = [label: string, amount: number]

// A payslip as the dialog and the PDF both lay it out: earnings less the
// absent deduction make gross; gross less deductions is net.
export function payslipBreakdown(p: Payslip) {
  const days = `${p.absent_days} ${p.absent_days === 1 || p.absent_days === 0.5 ? 'day' : 'days'}`
  const earnings: PayslipLine[] = [
    ['Basic salary', p.basic_salary],
    ['Contractual amount', p.contractual_amount],
    [p.bonus_type === 'percent' ? `Bonus (${p.bonus_value}% of basic)` : 'Bonus', p.bonus],
    ['Allowance', p.allowance],
    ['Arrears', p.arrears],
    [`Absent deduction (${days})`, -p.absent_deduction],
  ]
  const deductions: PayslipLine[] = [
    ['Advance salary', p.advance_salary],
    ['Loan deduction', p.loan_deduction],
    ['Tax', p.tax_amount],
  ]
  return {
    earnings,
    gross: p.gross_salary,
    deductions,
    totalDeductions: round2(p.advance_salary + p.loan_deduction + p.tax_amount),
    net: p.net_salary,
  }
}

export const payslipFileName = (p: Pick<Payroll, 'year' | 'month'>) =>
  `payslip-${p.year}-${String(p.month).padStart(2, '0')}.pdf`

export function payrollError(error: { code?: string; message: string }) {
  if (error.message.includes('payroll_items_employee_key')) return 'This person is already on the payroll.'
  if (error.message.includes('payrolls_one_open'))
    return 'Another payroll is still open. It must be processed before another is started.'
  if (error.message.includes('payroll_items_absent_days_check'))
    return 'Absent days must be between 0 and 31, in steps of half a day.'
  if (error.message.includes('remarks_check')) return 'Remarks can be up to 1,000 characters.'
  if (error.code === '23514' && error.message.includes('payroll_items_')) return 'Amounts must be 0 or more.'
  if (error.code === '42501' && error.message.includes('row-level security'))
    return "You don't have permission to do that."
  return error.message
}
