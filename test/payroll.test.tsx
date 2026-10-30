// Finance → Payroll: the list and starting a month's payroll, who edits which
// columns, adding and removing people, the status moves, and the CSV. The
// database decides who may do what (payroll_items_guard, payroll_create,
// payroll_move, RLS and grants); these checks prove the app offers only that
// and sends exactly what it should.
import { setupDom, reporter, text, button, click, type, dialog, field, options, choose, row, waitFor, freezeToday } from './setup'
setupDom()
freezeToday('2026-06-10')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, FINANCE } = await import('./mockSupabase')

const { check, done } = reporter()

const rpcArgs = (name: string) => captured.rpcs.filter((r) => r.name === name).map((r) => JSON.stringify(r.args))
const d = () => dialog()!
const combo = (label: string) => field(label, d())?.querySelector('[role="combobox"]')
// A text field in the open dialog that can't be edited.
const locked = (label: string) =>
  field(label, d())?.querySelector('input, textarea')?.hasAttribute('disabled') ?? false
const HR_LABELS = ['Basic salary', 'Contractual amount', 'Absent days', 'HR remarks']
const FINANCE_LABELS = ['Absent deduction', 'Allowance', 'Arrears', 'Advance salary', 'Loan deduction', 'Tax amount', 'Finance remarks']
const lastUpdate = () => captured.updates.filter((u) => u.table === 'payroll_items').at(-1)

// The browser's file download, caught.
const blobs: Blob[] = []
const downloads: string[] = []
URL.createObjectURL = ((blob: Blob) => (blobs.push(blob), 'blob:test')) as typeof URL.createObjectURL
URL.revokeObjectURL = () => {}
window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  downloads.push(this.download)
}

// ============================== the list ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/finance/payroll')
const listRows = () => [...document.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '')
check('payrolls are listed newest first, with status, head count and net payable',
  listRows()[0].includes('May 2026') && listRows()[0].includes('Draft') && listRows()[0].includes('3') &&
    listRows()[0].includes('586,500') && listRows()[1].includes('April 2026') && listRows()[1].includes('Disbursed'),
  listRows().join(' | '))
check('a new payroll can’t be started while one is open, and the page says why',
  button('New payroll')?.hasAttribute('disabled') &&
    text().includes('The May 2026 payroll is a draft. It must be disbursed before another is started.'))
await click(row('May 2026'))
check('a row opens the payroll', location.pathname === '/finance/payroll/pr-may', location.pathname)

// ============================== starting one ==============================
reset()
Object.assign(table('payrolls').find((p) => p.id === 'pr-may')!, { status: 'processed' })
signInAs(PEOPLE.hr)
await mountApp('/finance/payroll')
check('a processed payroll is still open until it’s disbursed',
  button('New payroll')?.hasAttribute('disabled') &&
    text().includes('The May 2026 payroll is processed. It must be disbursed before another is started.'))
Object.assign(table('payrolls').find((p) => p.id === 'pr-may')!, { status: 'disbursed' })
await mountApp('/finance/payroll')
check('with every payroll disbursed, a new one can be started', button('New payroll')?.hasAttribute('disabled') === false)
await click(button('New payroll'))
check('…for the month after the latest, by default',
  combo('Month')?.textContent === 'June' && combo('Year')?.textContent === '2026',
  `${combo('Month')?.textContent} ${combo('Year')?.textContent}`)
failNext('rpc.payroll_create', { code: '23505', message: 'There is already a payroll for June 2026.' })
await click(button('Create', d()))
check('a refusal is shown in the dialog', d().textContent?.includes('There is already a payroll for June 2026.'))
await choose('Month', 'July', d())
await click(button('Create', d()))
check('creating goes through payroll_create with the month and year',
  rpcArgs('payroll_create').at(-1) === JSON.stringify({ p_year: 2026, p_month: 7 }), rpcArgs('payroll_create').join())
check('…then opens the new payroll', await waitFor(() => location.pathname.startsWith('/finance/payroll/new-')),
  location.pathname)
check('…which has everyone on probation, active or on notice, and nobody who left',
  await waitFor(() => text().includes('July 2026 payroll')) &&
    !!row('Amna Khan') && !!row('Bilal Ahmed') && !!row('Sara Iqbal') && !row('Omar Farooq'))
check('…and is a draft', text().includes('Draft') && !!button('Send for review'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/finance/payroll/nope')
check('an unknown payroll says so', text().includes('This payroll doesn’t exist.'))

// ============================== HR edits HR's columns ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/finance/payroll/pr-may')
const sara = () => row('Sara Iqbal')?.textContent ?? ''
check('each person shows with their number and figures; bonus, gross and net are the database’s',
  ['#0003', '100,000', '10,000(10%)', '1.5', '113,000', '105,500', 'Two sick days unpaid'].every((s) => sara().includes(s)),
  sara())
const footer = () => document.querySelector('tfoot')?.textContent ?? ''
check('…with a total under each column', footer().includes('643,000') && footer().includes('586,500'), footer())
check('HR can send it for review but not approve it', !!button('Send for review') && !button('Approve'))

// A click anywhere on a draft's row opens its editor, like the Edit button.
await click(row('Bilal Ahmed')?.querySelector('td:nth-child(5)'))
check('clicking a person’s row opens their line to edit', d()?.querySelector('h2')?.textContent === 'Bilal Ahmed · May 2026',
  dialog()?.querySelector('h2')?.textContent)
check('…closed only by its × button: there’s no Cancel', !!button('Close', d()) && !button('Cancel', d()))
const backdrop = document.querySelector('.MuiDialog-container')!
backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
await click(backdrop)
check('…clicking outside it leaves it open', !!dialog() && !(await waitFor(() => !dialog(), 400)))
d().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
check('…and so does Escape', !(await waitFor(() => !dialog(), 400)))
await click(button('Close', d()))
check('…the × closes it, sending nothing', await waitFor(() => !dialog()) && !lastUpdate())

await click(button('Edit Sara Iqbal'))
check('HR edits basic salary, contractual amount, absent days and HR remarks', HR_LABELS.every((l) => !locked(l)))
check('…but not finance’s columns',
  [...FINANCE_LABELS, 'Bonus %'].every(locked) && combo('Bonus as')?.getAttribute('aria-disabled') === 'true')
await type('Absent days', '1.25', d())
await click(button('Save', d()))
const absentInput = () => field('Absent days', d())!.querySelector('input')!
check('absent days go in half days only: the browser holds the form back',
  absentInput().validity.stepMismatch && !lastUpdate())
await type('Absent days', '2.5', d())
await type('Basic salary', '120000', d())
check('the dialog works out gross and net as figures change',
  d().textContent?.includes('Gross salary PKR 135,000') && d().textContent?.includes('Net payable PKR 127,500'),
  d().textContent)
await type('HR remarks', '  Unpaid half day  ', d())
await click(button('Save', d()))
check('HR’s save sends only HR’s columns, for that line',
  JSON.stringify(lastUpdate()?.values) ===
    JSON.stringify({ basic_salary: 120000, contractual_amount: 0, absent_days: 2.5, hr_remarks: 'Unpaid half day' }) &&
    JSON.stringify(lastUpdate()?.filters) === '[["id","eq","pi-may-sara"]]',
  JSON.stringify(lastUpdate()))
check('…and the table shows the new figures', await waitFor(() => sara().includes('127,500') && sara().includes('2.5')))

// ============================== finance edits the rest ==============================
reset()
table('employees').push({ ...FINANCE })
signInAs(FINANCE)
await mountApp('/finance/payroll/pr-may')
check('finance can send it for review too, but not approve it', !!button('Send for review') && !button('Approve'))
await click(button('Edit Sara Iqbal'))
check('finance edits bonus, deductions, allowance, tax and finance remarks',
  [...FINANCE_LABELS, 'Bonus %'].every((l) => !locked(l)) && combo('Bonus as')?.getAttribute('aria-disabled') !== 'true')
check('…but not HR’s columns', HR_LABELS.every(locked))
await choose('Bonus as', 'Amount', d())
await type('Bonus', '15000', d())
await type('Arrears', '3000', d())
await type('Tax amount', '', d())
check('…and arrears count towards gross and net as they’re typed',
  d().textContent?.includes('Gross salary PKR 121,000') && d().textContent?.includes('Net payable PKR 118,000'),
  d().textContent)
await type('Finance remarks', '=HYPERLINK("x")', d())
await click(button('Save', d()))
check('finance’s save sends only finance’s columns, a blank amount as 0',
  JSON.stringify(lastUpdate()?.values) === JSON.stringify({
    bonus_type: 'amount', bonus_value: 15000, absent_deduction: 5000, allowance: 8000, arrears: 3000, advance_salary: 2000,
    loan_deduction: 1000, tax_amount: 0, finance_remarks: '=HYPERLINK("x")',
  }), JSON.stringify(lastUpdate()?.values))
check('…and the table shows the new figures', await waitFor(() => sara().includes('118,000') && !sara().includes('(10%)')))

await click(button('Edit Bilal Ahmed'))
failNext('payroll_items.update', { message: 'This payroll is in review. Only a draft payroll can be changed.' })
await click(button('Save', d()))
check('a refusal is shown in the dialog', d().textContent?.includes('Only a draft payroll can be changed.'))
await click(button('Close', d()))
await waitFor(() => !dialog())

// ============================== the CSV ==============================
await click(button('Download CSV'))
const csv = await blobs.at(-1)!.text()
const lines = csv.split('\r\n')
check('the CSV is named for the month', downloads.at(-1) === 'payroll-2026-05.csv', downloads.join())
check('…has every column',
  lines[0] === 'Employee number,Name,Basic salary,Contractual amount,Bonus % of basic,Bonus,Absent days,' +
    'Absent deduction,Allowance,Arrears,Gross salary,Advance salary,Loan deduction,Tax amount,Net payable salary,' +
    'HR remarks,Finance remarks', lines[0])
check('…a line per person, by employee number',
  lines.length === 4 && lines[1].startsWith('1,Amna Khan,') && lines[2].startsWith('2,Bilal Ahmed,'), lines.join(' | '))
check('…with plain numbers, and text a spreadsheet would run as a formula kept as text',
  lines[3] === '3,Sara Iqbal,100000,0,,15000,1.5,5000,8000,3000,121000,2000,1000,0,118000,Two sick days unpaid,' +
    '"\'=HYPERLINK(""x"")"', lines[3])

// ============================== adding and removing people ==============================
reset()
table('employees').push({ ...FINANCE })
signInAs(PEOPLE.hr)
await mountApp('/finance/payroll/pr-may')
await click(button('Remove Bilal Ahmed'))
check('removing someone asks first, without also opening their line',
  d().textContent?.includes('Remove Bilal Ahmed?') && document.querySelectorAll('[role="dialog"]').length === 1)
await click(button('Remove', d()))
check('…then deletes just their line',
  JSON.stringify(captured.deletes.at(-1)) === JSON.stringify({ table: 'payroll_items', filters: [['id', 'eq', 'pi-may-bilal']] }))
check('…and they’re gone', await waitFor(() => !row('Bilal Ahmed')))

await click(button('Add employee'))
combo('Employee')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
await waitFor(() => options().length > 0)
check('only people who can be paid and aren’t on it are offered',
  options().map((o) => o.textContent).join() === 'Bilal Ahmed (#0002),Hina Raza (#0005)',
  options().map((o) => o.textContent).join())
await click(options().find((o) => o.textContent?.startsWith('Bilal')))
failNext('payroll_items.insert', { code: '23505', message: 'duplicate key value violates unique constraint "payroll_items_employee_key"' })
await click(button('Add', d()))
check('someone already on it is explained', d().textContent?.includes('This person is already on the payroll.'))
await click(button('Add', d()))
check('adding sends only the payroll and the person',
  JSON.stringify(captured.inserts.at(-1)) ===
    JSON.stringify({ table: 'payroll_items', rows: [{ payroll_id: 'pr-may', employee_id: 'e-bilal' }] }),
  JSON.stringify(captured.inserts.at(-1)))
check('…and they’re back, with their number', await waitFor(() => row('Bilal Ahmed')?.textContent?.includes('#0002')))

// ============================== review, approval, processing ==============================
await click(button('Send for review'))
check('sending for review asks first', d().textContent?.includes('goes to review'))
await click(button('Send for review', d()))
check('…and goes through payroll_move',
  rpcArgs('payroll_move').at(-1) === JSON.stringify({ p_payroll_id: 'pr-may', p_status: 'review' }))
check('…then nothing can be changed, and HR can’t approve it',
  await waitFor(() => text().includes('Sent for review by Bilal Ahmed')) && !button('Add employee') &&
    !button('Edit Sara Iqbal') && !button('Remove Sara Iqbal') && !button('Approve') && !button('Back to draft'))
check('…though it can still be downloaded', !!button('Download CSV'))
await waitFor(() => !dialog())
await click(row('Sara Iqbal'))
check('…and clicking a row opens nothing', !dialog())

signInAs(PEOPLE.companyAdmin)
await mountApp('/finance/payroll/pr-may')
check('a company admin can approve it or send it back to draft',
  !!button('Approve') && !!button('Back to draft') && !button('Mark processed'))
await click(button('Back to draft'))
await click(button('Back to draft', d()))
check('back to draft goes through payroll_move',
  rpcArgs('payroll_move').at(-1) === JSON.stringify({ p_payroll_id: 'pr-may', p_status: 'draft' }))
check('…and it can be changed again', await waitFor(() => !!button('Edit Sara Iqbal')) && !!button('Send for review'))
await click(button('Send for review'))
await click(button('Send for review', d()))
await waitFor(() => !!button('Approve'))
await click(button('Approve'))
await click(button('Approve', d()))
check('approving goes through payroll_move',
  rpcArgs('payroll_move').at(-1) === JSON.stringify({ p_payroll_id: 'pr-may', p_status: 'approved' }))
check('…then a company admin can still reopen it, or mark it processed',
  await waitFor(() => !!button('Mark processed')) && !!button('Back to draft') && !button('Edit Sara Iqbal'))

signInAs(PEOPLE.hr)
await mountApp('/finance/payroll/pr-may')
check('HR can’t move an approved payroll',
  text().includes('Approved by Amna Khan') && !button('Mark processed') && !button('Back to draft') &&
    !button('Send for review'))

signInAs(FINANCE)
await mountApp('/finance/payroll/pr-may')
check('finance can mark it processed, but not reopen it', !!button('Mark processed') && !button('Back to draft'))
failNext('rpc.payroll_move', { code: '42501', message: 'Only finance can mark a payroll processed.' })
await click(button('Mark processed'))
check('processing asks first, and says the lines are then fixed', d().textContent?.includes('can’t be changed or reopened'))
await click(button('Mark processed', d()))
check('a refusal is shown', await waitFor(() => text().includes('Only finance can mark a payroll processed.')))
await click(button('Mark processed'))
await click(button('Mark processed', d()))
check('processing goes through payroll_move',
  rpcArgs('payroll_move').at(-1) === JSON.stringify({ p_payroll_id: 'pr-may', p_status: 'processed' }))
check('…then its lines are fixed, and finance can mark it disbursed',
  await waitFor(() => text().includes('Processed by Hina Raza')) && !button('Back to draft') &&
    !button('Mark processed') && !button('Edit Sara Iqbal') && !button('Add employee') && !!button('Mark disbursed'))

signInAs(PEOPLE.hr)
await mountApp('/finance/payroll/pr-may')
check('HR can’t disburse a processed payroll', text().includes('Processed by Hina Raza') && !button('Mark disbursed'))

signInAs(FINANCE)
await mountApp('/finance/payroll/pr-may')
failNext('rpc.payroll_move', { code: '42501', message: 'Only finance can mark a payroll disbursed.' })
await click(button('Mark disbursed'))
check('disbursing asks first, says payslips go out, and that it’s final',
  d().textContent?.includes('gets their payslip') && d().textContent?.includes('This is final'))
await click(button('Mark disbursed', d()))
check('a refusal to disburse is shown', await waitFor(() => text().includes('Only finance can mark a payroll disbursed.')))
await click(button('Mark disbursed'))
await click(button('Mark disbursed', d()))
check('disbursing goes through payroll_move',
  rpcArgs('payroll_move').at(-1) === JSON.stringify({ p_payroll_id: 'pr-may', p_status: 'disbursed' }))
check('…then it’s final', await waitFor(() => text().includes('Disbursed by Hina Raza')) &&
  !button('Back to draft') && !button('Mark processed') && !button('Mark disbursed') && !button('Edit Sara Iqbal') &&
  !button('Add employee'))
check('no payroll or line is ever written directly',
  !captured.updates.some((u) => u.table === 'payrolls') && !captured.inserts.some((i) => i.table === 'payrolls') &&
    !captured.deletes.some((x) => x.table === 'payrolls'))

// ============================== payslips ==============================
reset()
signInAs(PEOPLE.member)
await mountApp('/profile?tab=payslips')
const slipRows = () => [...document.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '')
check('an employee’s disbursed payslips are listed by month, year and net amount',
  await waitFor(() => slipRows().length === 1) && slipRows()[0].includes('April') && slipRows()[0].includes('2026') &&
    slipRows()[0].includes('113,000'), slipRows().join(' | '))
check('…read only through my_payslips, never the payroll tables',
  captured.rpcs.some((r) => r.name === 'my_payslips') && !captured.reads.some((r) => r.startsWith('payroll')),
  captured.reads.join())

await click(row('April'))
const slip = () => d().textContent ?? ''
check('a payslip opens to its breakdown',
  ['Payslip · April 2026', 'Basic salary100,000', 'Bonus (5% of basic)5,000', 'Allowance8,000', 'Arrears6,000',
    'Absent deduction (0.5 day)-2,000', 'Gross salary117,000', 'Tax4,000', 'Total deductions4,000',
    'Net payable salaryPKR 113,000'].every((t) => slip().includes(t)), slip())
check('…without the internal remarks', !slip().includes('Internal'))
check('…and says when it was disbursed', slip().includes('· Disbursed '), slip())

await click(button('Download PDF', d()))
const pdf = await blobs.at(-1)!.text()
check('…and downloads as a PDF named for the month',
  downloads.at(-1) === 'payslip-2026-04.pdf' && pdf.startsWith('%PDF'), downloads.at(-1))
check('…with the person, their designation, the figures and net pay in it',
  ['(Sara Iqbal)', '(#0003)', '(Software Engineer)', '(Engineering)', '(April 2026)', '(Arrears)', '(6,000)',
    '(Gross salary)', '(117,000)', '(PKR 113,000)', '(DISBURSED ON)'].every((t) => pdf.includes(t)),
  pdf.match(/\((?:[^()\\]|\\.)*\) Tj/g)?.slice(0, 40).join(' '))
await click(button('Close', d()))
await waitFor(() => !dialog())

const before = downloads.length
await click(button('Download April 2026 payslip'))
check('a payslip downloads from its row too', await waitFor(() => downloads.length === before + 1) &&
  downloads.at(-1) === 'payslip-2026-04.pdf' && !dialog())

reset()
signInAs(PEOPLE.hr)
await mountApp('/profile?tab=payslips')
check('someone with no disbursed payslip is told so', await waitFor(() => text().includes('No payslips yet.')))

reset()
Object.assign(table('payrolls').find((p) => p.id === 'pr-apr')!, { status: 'processed' })
signInAs(PEOPLE.member)
await mountApp('/profile?tab=payslips')
check('a payroll that’s processed but not yet disbursed gives no payslip',
  await waitFor(() => text().includes('No payslips yet.')) && !slipRows().some((r) => r.includes('April')))

reset()
signInAs(PEOPLE.member)
failNext('rpc.my_payslips', { message: 'network down' })
await mountApp('/profile?tab=payslips')
check('a failed load is shown', await waitFor(() => text().includes('network down')))

done()
