// The dashboard's To do list: one nudge per thing waiting on the viewer, each
// linking to where it's done. The mock doesn't enforce RLS, so these checks
// prove the app itself decides whose step it is: leave approvals, claims,
// onboarding and offboarding sections (a department's to the employee's
// manager when they can tick it, everyone's to HR), and payroll steps.
import { setupDom, reporter, text, waitFor, freezeToday } from './setup'
setupDom()
freezeToday('2026-06-10')

const { mountApp } = await import('./app')
const { reset, signInAs, table, PEOPLE, FINANCE } = await import('./mockSupabase')
const { payrollTodos, sortTodos, dueCaption } = await import('../src/lib/todos')

const { check, done } = reporter()

const items = () =>
  [...document.querySelectorAll<HTMLElement>('[data-todo]')].map((el) => ({
    key: el.dataset.todo!,
    text: el.textContent ?? '',
    href: el.querySelector('a')?.getAttribute('href') ?? '',
  }))
const item = (key: string) => items().find((i) => i.key === key)
const keys = () => items().map((i) => i.key).join()
const loaded = () => waitFor(() => text().includes('Welcome') && items().length > 0)

// ============================== HR ==============================

reset()
signInAs(PEOPLE.hr) // Bilal: HR admin, People Ops
await mountApp('/dashboard')
await loaded()
await waitFor(() => !!item('payroll') && !!item('leaves'))

check('HR is asked to approve Sara’s leave, not the one already approved as HR, nor their own',
  item('leaves')?.text.includes('1 leave request is waiting for your approval.') &&
  item('leaves')?.text.includes('Starts Jun 15, 2026'), item('leaves')?.text)
check('…linking to Leave requests', item('leaves')?.href.endsWith('/leaves/requests'), item('leaves')?.href)
check('HR is asked to approve the claim in review, and nothing finance does',
  item('reimbursements-approve')?.text.includes('1 reimbursement claim to approve.') &&
  !item('reimbursements-process') && !item('reimbursements-disburse'), keys())
check('…linking to claims in review', item('reimbursements-approve')?.href.endsWith('/finance/reimbursements?status=review'))
check('the draft payroll asks to be sent for review',
  item('payroll')?.text.includes('The May 2026 payroll is a draft.') && item('payroll')?.href.endsWith('/finance/payroll/pr-may'),
  item('payroll')?.text)
check('each onboarding section with tasks left is one nudge (everyone’s sections are HR’s)',
  !!item('onboarding-ob-sara-Paperwork')?.text.includes('Sara Iqbal’s onboarding: Paperwork (1 task left).') &&
  !!item('onboarding-ob-sara-IT setup'), keys())
check('…overdue, since it was due Jun 5', item('onboarding-ob-sara-Paperwork')?.text.includes('Overdue · due Jun 5, 2026'),
  item('onboarding-ob-sara-Paperwork')?.text)
check('…linking to the onboarding', item('onboarding-ob-sara-Paperwork')?.href.endsWith('/hr/onboarding/ob-sara'))
check('the offboarding’s section left is HR’s too, and it can’t be signed yet',
  !!item('offboarding-off-sara-Equipment')?.text.includes('Sara Iqbal’s offboarding: Equipment (1 task left).') &&
  !item('offboarding-off-sara-sign-off'), keys())
check('overdue to-dos come first', items()[0]?.text.includes('Overdue'), keys())
check('HR admins aren’t asked about appraisals', !item('appraisals'))

// A department's section goes to the employee's manager when it's their
// department: Sara's manager is Amna, in Engineering.
reset()
table('onboarding_tasks').find((t) => t.id === 't-sara-3')!.department_id = 'd-eng'
signInAs(PEOPLE.hr)
await mountApp('/dashboard')
await loaded()
await waitFor(() => !!item('onboarding-ob-sara-Paperwork'))
check('an Engineering section of Sara’s onboarding isn’t HR’s: her manager ticks it',
  !item('onboarding-ob-sara-IT setup'), keys())

reset()
table('onboarding_tasks').find((t) => t.id === 't-sara-3')!.department_id = 'd-new'
signInAs(PEOPLE.hr)
await mountApp('/dashboard')
await loaded()
check('…but one for a department her manager isn’t in falls to HR, the only ones who can tick it',
  await waitFor(() => !!item('onboarding-ob-sara-IT setup')), keys())

reset()
table('offboarding_tasks').forEach((t) => (t.done_at ??= '2026-06-09T09:00:00Z'))
table('offboardings').find((o) => o.id === 'off-sara')!.reason = null
signInAs(PEOPLE.hr)
await mountApp('/dashboard')
await loaded()
check('HR is asked to set a missing reason and last working day',
  await waitFor(() => !!item('offboarding-off-sara-details')?.text.includes('Set the reason and last working day for Sara Iqbal’s offboarding.')),
  keys())

reset()
table('onboarding_tasks').forEach((t) => (t.done_at ??= '2026-06-09T09:00:00Z'))
signInAs(PEOPLE.hr)
await mountApp('/dashboard')
await loaded()
check('an onboarding with every task ticked asks HR to complete it',
  await waitFor(() => !!item('onboarding-ob-sara-complete')?.text.includes('Sara Iqbal’s onboarding is ready to complete.')), keys())

// ============================== a manager ==============================

reset()
table('org_chart_nodes').push({ employee_id: 'e-omar', manager_id: 'e-sara' })
table('onboardings').push({ ...table('onboardings').find((o) => o.id === 'ob-omar')!, id: 'ob-omar-2', status: 'in_progress',
  completed_by: null, completed_at: null, due_date: '2026-06-20' })
table('onboarding_tasks').push(
  { id: 'm-1', onboarding_id: 'ob-omar-2', section: 'Paperwork', section_order: 0, title: 'Sign the contract',
    sort_order: 0, done_by: null, done_at: null, department_id: null },
  { id: 'm-2', onboarding_id: 'ob-omar-2', section: 'Dev tools', section_order: 2, title: 'Add to GitHub',
    sort_order: 0, done_by: null, done_at: null, department_id: 'd-eng' },
  { id: 'm-3', onboarding_id: 'ob-omar-2', section: 'Dev tools', section_order: 2, title: 'Add to Jira',
    sort_order: 1, done_by: null, done_at: null, department_id: 'd-eng' },
)
table('leaves').push({ ...table('leaves').find((l) => l.id === 'l-bilal')!, id: 'l-omar', employee_id: 'e-omar',
  start_date: '2026-06-12', end_date: '2026-06-12' })
signInAs(PEOPLE.member) // Sara: Engineering, Omar's manager
await mountApp('/dashboard')
await loaded()
await waitFor(() => !!item('onboarding-ob-omar-2-Dev tools'))
check('a manager is nudged once for their department’s section, with how many tasks are left',
  item('onboarding-ob-omar-2-Dev tools')?.text.includes('Omar Farooq’s onboarding: Dev tools (2 tasks left).'), keys())
check('…not for everyone’s sections, which are HR’s', !item('onboarding-ob-omar-2-Paperwork'), keys())
check('…nor for an onboarding of someone they don’t manage', !items().some((i) => i.key.startsWith('onboarding-ob-sara')))
check('a manager is asked to approve their report’s leave, and not their own',
  await waitFor(() => !!item('leaves')?.text.includes('1 leave request is waiting for your approval.')), item('leaves')?.text)
check('a member sees no claims or payroll',
  !items().some((i) => i.key.startsWith('reimbursements') || i.key.startsWith('payroll')), keys())

// ============================== finance ==============================

reset()
table('employees').push({ ...FINANCE } as never)
table('payrolls').find((p) => p.id === 'pr-may')!.status = 'approved'
signInAs(FINANCE)
await mountApp('/dashboard')
await loaded()
await waitFor(() => !!item('payroll'))
check('finance is asked to process the approved claim and disburse the processed one',
  item('reimbursements-process')?.text.includes('1 reimbursement claim to process.') &&
  item('reimbursements-disburse')?.text.includes('1 reimbursement claim to disburse.') && !item('reimbursements-approve'), keys())
check('…linking to each status', item('reimbursements-process')?.href.endsWith('?status=approved') &&
  item('reimbursements-disburse')?.href.endsWith('?status=processed'))
check('an approved payroll asks finance to mark it processed',
  item('payroll')?.text.includes('The May 2026 payroll is approved. Mark it processed.'), item('payroll')?.text)
check('finance isn’t asked about leave or onboarding', !item('leaves') && !items().some((i) => i.key.startsWith('onboarding')))

// ============================== company admin ==============================

reset()
table('payrolls').find((p) => p.id === 'pr-may')!.status = 'review'
// A claim Amna made for Sara: not hers to decide.
table('reimbursements').push({ ...table('reimbursements').find((r) => r.id === 'rb-review')!, id: 'rb-amna', created_by: 'e-amna' })
signInAs(PEOPLE.companyAdmin)
await mountApp('/dashboard')
await loaded()
await waitFor(() => !!item('payroll') && !!item('appraisals'))
check('a payroll in review asks a company admin to approve it',
  item('payroll')?.text.includes('The May 2026 payroll is waiting for your approval.'), item('payroll')?.text)
check('a company admin works claims as HR and finance, but not one they made',
  item('reimbursements-approve')?.text.includes('1 reimbursement claim to approve.') && !!item('reimbursements-process') &&
  !!item('reimbursements-disburse'), item('reimbursements-approve')?.text)
check('the appraisal reminder is a to-do too', item('appraisals')?.text.includes('1 appraisal is waiting for your approval.'))

// ============================== nothing to do ==============================

reset()
table('performance_reviews').length = 0
table('hr_feedback').length = 0
// No manager, so no 1:1 to give feedback at.
table('org_chart_nodes').splice(0, table('org_chart_nodes').length)
signInAs(PEOPLE.member)
await mountApp('/dashboard')
await waitFor(() => text().includes('Upcoming leave'))
check('with nothing waiting, there is no To do list', !text().includes('To do') && !items().length, keys())

// ============================== the builders ==============================

const hr = { id: 'e-bilal', isHr: true, isFinance: false, isCompanyAdmin: false, canManagePayroll: true, departmentId: 'd-ops' }
const disbursedMay = [{ id: 'p', year: 2026, month: 5, status: 'disbursed' as const }]
check('no payroll nudge before the 25th', payrollTodos(disbursedMay, hr, '2026-06-24').length === 0)
const start = payrollTodos(disbursedMay, hr, '2026-06-25')[0]
check('from the 25th, with none open, start this month’s, due by its last day',
  start?.text === `Start the ${new Date(2026, 5, 1).toLocaleDateString(undefined, { month: 'long' })} 2026 payroll.` &&
  start.due === '2026-06-30' && start.to === '/finance/payroll', JSON.stringify(start))
check('…not once this month’s exists',
  payrollTodos([...disbursedMay, { id: 'q', year: 2026, month: 6, status: 'disbursed' }], hr, '2026-06-26').length === 0)
check('…and not for someone outside payroll', payrollTodos(disbursedMay, { ...hr, canManagePayroll: false }, '2026-06-26').length === 0)
check('a payroll in review isn’t HR’s step', payrollTodos([{ id: 'r', year: 2026, month: 6, status: 'review' }], hr).length === 0)

const t = (key: string, due?: string) => ({ key, area: 'leaves' as const, text: key, due, to: '/', action: 'Go' })
check('sorted overdue first, then soonest, then undated',
  sortTodos([t('none'), t('later', '2026-07-01'), t('late', '2026-06-01'), t('soon', '2026-06-12')], '2026-06-10')
    .map((x) => x.key).join() === 'late,soon,later,none')
check('the caption says when, and when it’s overdue',
  dueCaption(t('a', '2026-06-12'), '2026-06-10') === 'Due Jun 12, 2026' &&
  dueCaption(t('b', '2026-06-01'), '2026-06-10') === 'Overdue · due Jun 1, 2026' && dueCaption(t('c'), '2026-06-10') === null)

done()
