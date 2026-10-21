// Leaves in the app: My leaves (balance, apply, cancel), Leave requests
// (approve, reject, HR's extra powers) and Company → Leaves (HR's set-up of
// types and quotas, one tab each). The rules themselves — quotas,
// overlaps, who may decide — are enforced by triggers and leave_decide in SQL;
// these checks prove the app offers only what that allows and sends exactly
// what it should.
import {
  setupDom, freezeToday, reporter, text, button, buttons, click, type, choose, dialog, row, checkbox, valueOf, waitFor,
} from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, TODAY } = await import('./mockSupabase')
freezeToday(TODAY)

const { check, done } = reporter()

const rpcCalls = (name: string) => captured.rpcs.filter((r) => r.name === name)
const leaveReads = () => captured.selects.filter((s) => s.table === 'leaves')
const has = (filters: unknown[][], col: string, op: string, value: unknown) =>
  filters.some(([c, o, v]) => c === col && o === op && v === value)

// ============================== My leaves ==============================

reset()
signInAs(PEOPLE.member)
await mountApp('/leaves')

check('the balance is asked for me, for this year',
  rpcCalls('leave_balances').some((r) => r.args?.p_employee_id === 'e-sara' && r.args?.p_year === 2026),
  JSON.stringify(rpcCalls('leave_balances')))
check('only my leaves are read', leaveReads().some((s) => has(s.filters, 'employee_id', 'eq', 'e-sara')),
  JSON.stringify(leaveReads()))
check('only this year\'s leaves are shown', text().includes('Family wedding') && !text().includes('Last year trip'))
check('the page says who has to approve', text().includes('once HR and Amna Khan have both approved'))

// Annual: 14 days, 2 taken (Spring break), 3 + 2 pending → 7 left.
const annualCard = [...document.querySelectorAll('.MuiPaper-root')].find((p) => p.textContent?.startsWith('Annual'))
check('the Annual balance subtracts taken and pending days', annualCard?.textContent?.includes('7days left'),
  annualCard?.textContent)
check('…and says how it got there', annualCard?.textContent?.includes('2 taken · 5 pending · 14 this year'))
check('a type without a quota shows no limit',
  [...document.querySelectorAll('.MuiPaper-root')].some((p) => p.textContent?.startsWith('UnpaidNo limit')))

check('a pending leave can be cancelled', !!button('Cancel', row('Family wedding')))
check('an approved leave that has not started can be cancelled', !!button('Cancel', row('Surgery')))
check('an approved leave that has started cannot', !button('Cancel', row('Spring break')))
check('a rejected leave cannot', !button('Cancel', row('Concert')))
check('a rejected leave shows who rejected it and why',
  row('Concert')?.textContent?.includes('Rejected by Bilal Ahmed') && row('Concert')?.textContent?.includes('Release week'))
check('a half-approved leave shows who it still waits on',
  row('Moving house')?.textContent?.includes('Waiting for Amna Khan'), row('Moving house')?.textContent)

await click(button('Cancel', row('Family wedding')))
await click(button('Cancel leave', dialog()!))
check('cancelling calls leave_cancel with just the leave',
  JSON.stringify(rpcCalls('leave_cancel').map((r) => r.args)) === JSON.stringify([{ p_leave_id: 'l-pending' }]),
  JSON.stringify(rpcCalls('leave_cancel')))
check('the list reloads with the leave cancelled', row('Family wedding')?.textContent?.includes('Cancelled'))

// ---------------- applying ----------------
async function openApply() {
  await click(button('Apply for leave'))
  return dialog()
}

reset()
signInAs(PEOPLE.member)
await mountApp('/leaves')
await openApply()
await choose('Leave type', 'Annual7 days left')
await type('From', '2026-06-24')
check('picking a start fills the end with the same day', valueOf('To') === '2026-06-24', valueOf('To'))
check('a single day can be a half day', checkbox('Half day')?.disabled === false)
await click(checkbox('Half day'))
await type('Reason', '  Bank appointment  ')
check('the dialog counts the days against the balance', dialog()?.textContent?.includes('0.5 day of leave · 7 days of Annual left in 2026'),
  dialog()?.textContent)
await click(button('Apply', dialog()!))

const applied = captured.inserts.find((i) => i.table === 'leaves')?.rows[0]
check('applying inserts exactly the request columns — never a status or an approver',
  JSON.stringify(Object.keys(applied ?? {}).sort()) ===
    JSON.stringify(['employee_id', 'end_date', 'half_day', 'leave_type_id', 'reason', 'start_date']),
  JSON.stringify(applied))
check('…for me, with what I entered',
  applied?.employee_id === 'e-sara' && applied?.leave_type_id === 't-annual' && applied?.start_date === '2026-06-24' &&
    applied?.end_date === '2026-06-24' && applied?.half_day === true && applied?.reason === 'Bank appointment',
  JSON.stringify(applied))
check('the dialog closes after applying', await waitFor(() => !dialog()))

reset()
signInAs(PEOPLE.member)
await mountApp('/leaves')
await openApply()
const typeOptions = async () => {
  const combo = dialog()!.querySelector('[role="combobox"]')!
  combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  await new Promise((r) => setTimeout(r, 30))
  const names = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  ;(document.activeElement as HTMLElement | null)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 30))
  return names
}
const offered = await typeOptions()
check('only active leave types are offered', offered.length === 3 && !offered.some((o) => o?.startsWith('Retired')),
  offered.join(' | '))
check('each type shows what is left of it', offered.includes('Unpaid' + 'No limit') && offered.includes('Sick' + '7 days left'),
  offered.join(' | '))

await type('From', '2026-06-15')
await type('To', '2026-06-16')
check('a range cannot be a half day', checkbox('Half day')?.disabled === true)

await type('To', '2026-06-12')
check('an end before the start is caught before sending', dialog()?.textContent?.includes('The end date is before the start date.'))
await type('From', '2026-12-30')
await type('To', '2027-01-04')
check('a leave into next year is caught', dialog()?.textContent?.includes("can't run into the next year"))
await type('From', '2026-06-13')
await type('To', '2026-06-14')
check('weekend-only dates are caught', dialog()?.textContent?.includes('no working days'))
await choose('Leave type', 'Annual7 days left')
await click(button('Apply', dialog()!))
check('a caught problem is never sent', !captured.inserts.some((i) => i.table === 'leaves'))

await type('From', '2026-06-15')
await type('To', '2026-06-15')
failNext('leaves.insert', { code: '42501', message: 'new row violates row-level security policy for table "leaves"' })
await click(button('Apply', dialog()!))
check('a refusal from the database is shown in words', dialog()?.textContent?.includes("You don't have permission to do that."),
  dialog()?.textContent)

// ============================== Leave requests ==============================

// Amna is a company admin (so HR) and Sara's manager.
reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/leaves/requests')
check('requests never include my own leave', leaveReads().some((s) => has(s.filters, 'employee_id', 'neq', 'e-amna')),
  JSON.stringify(leaveReads()))
check('HR can record a leave for someone', !!button('Record leave'))
check('as HR and Sara\'s manager, Amna can approve Sara\'s untouched leave', !!button('Approve', row('Family wedding')))
check('…and the one HR already approved, as her manager', !!button('Approve', row('Moving house')))
check('…and Bilal\'s, as HR (he has no manager)', !!button('Approve', row('Dentist')))
check('the waiting count matches', text().includes('3 waiting for you'), text().slice(0, 300))

await click(button('Approve', row('Family wedding')))
check('the approve dialog says the approval completes it',
  dialog()?.textContent?.includes('You approve as HR and as their manager. This grants the leave.'), dialog()?.textContent)
check('…and shows the balance it draws on', dialog()?.textContent?.includes('Annual in 2026: 2 taken, 5 pending'), dialog()?.textContent)
await click(button('Approve', dialog()!))
check('approving calls leave_decide with approve and no reason',
  JSON.stringify(rpcCalls('leave_decide').map((r) => r.args)) ===
    JSON.stringify([{ p_leave_id: 'l-pending', p_approve: true, p_reason: null }]),
  JSON.stringify(rpcCalls('leave_decide')))

// Bilal is HR but nobody's manager.
reset()
signInAs(PEOPLE.hr)
await mountApp('/leaves/requests')
check('HR approves what still needs HR', !!button('Approve', row('Family wedding')))
check('HR is not offered approval it has already given', !row('Moving house'),
  'the HR-approved leave should not be waiting for Bilal')
await click(button('Approve', row('Family wedding')))
check('HR is told the manager still has to approve',
  dialog()?.textContent?.includes('You approve as HR. It still needs approval from Amna Khan, their manager.'),
  dialog()?.textContent)
await click(button('Cancel', dialog()!))

await choose('Show', 'All')
check('HR can change dates and cancel open leaves',
  !!button('Change dates', row('Surgery')) && !!button('Cancel leave', row('Surgery')))
check('…but not closed ones', !!row('Concert') && !button('Change dates', row('Concert')) && !button('Cancel leave', row('Concert')))
await click(button('Change dates', row('Surgery')))
await type('To', '2026-07-02')
await click(button('Save', dialog()!))
const edit = captured.updates.find((u) => u.table === 'leaves')
check('changing dates updates only the dates',
  JSON.stringify(Object.keys(edit?.values ?? {}).sort()) === JSON.stringify(['end_date', 'half_day', 'start_date']),
  JSON.stringify(edit?.values))
check('…of that leave', has(edit?.filters ?? [], 'id', 'eq', 'l-future'), JSON.stringify(edit?.filters))

// Sara manages Omar, who has a pending leave. She is not HR.
reset()
table('org_chart_nodes').push({ employee_id: 'e-omar', manager_id: 'e-sara' })
table('leaves').push({ ...table('leaves').find((l) => l.id === 'l-bilal')!, id: 'l-omar', employee_id: 'e-omar', reason: 'Exams' })
signInAs(PEOPLE.member)
await mountApp('/leaves/requests')
check('a manager can approve a direct report\'s leave', !!button('Approve', row('Exams')))
check('a manager cannot record leave', !button('Record leave'))
await choose('Show', 'All')
check('a manager cannot change dates or cancel', !buttons('Change dates').length && !buttons('Cancel leave').length)
await click(button('Reject', row('Exams')))
await type('Reason', 'Team offsite that week')
await click(button('Reject', dialog()!))
check('rejecting calls leave_decide with the reason',
  JSON.stringify(rpcCalls('leave_decide').map((r) => r.args)) ===
    JSON.stringify([{ p_leave_id: 'l-omar', p_approve: false, p_reason: 'Team offsite that week' }]),
  JSON.stringify(rpcCalls('leave_decide')))


// ========================= Company → Leaves (HR) =========================

const tab = (label: string) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === label)
const reads = (name: string) => captured.selects.filter((s) => s.table === name).length

reset()
signInAs(PEOPLE.hr)
await mountApp('/company/leaves')
check('the set-up opens on the Types tab', tab('Types')?.getAttribute('aria-selected') === 'true')
check('…listing every type, inactive ones marked', !!row('Annual') && row('Retired')?.textContent?.includes('Inactive'),
  row('Retired')?.textContent)
check('…and quotas are not read until their tab is opened', reads('leave_types') > 0 && reads('leave_quotas') === 0)

await click(tab('Quotas'))
check('the Quotas tab is put in the URL', location.search === '?tab=quotas', location.search)
check('…and shows the per-person quotas', reads('leave_quotas') > 0 && text().includes('20 days'), text().slice(0, 300))

await click(tab('Types'))
check('going back to Types clears the URL', location.search === '' && !!row('Annual'), location.search)

await click(document.querySelector('a[href*="tab=quotas"]'))
check('the link under the types opens the Quotas tab', tab('Quotas')?.getAttribute('aria-selected') === 'true')

reset()
signInAs(PEOPLE.hr)
await mountApp('/company/leaves?tab=quotas')
check('a link straight to the Quotas tab opens it', tab('Quotas')?.getAttribute('aria-selected') === 'true' &&
  text().includes('20 days'))

done()
