// Appraisals (salary history): People → Appraisals (HR writes drafts and
// sends them for review; company admins approve or reject), the dashboard's
// reminder, and each person's Profile → Salary tab. The rules — one open per
// person, never your own, drafts only, months moving forward, who may approve
// — are the database's (salary_revisions_guard, salary_revision_move, RLS);
// these checks prove the app offers only what that allows and sends exactly
// what it should.
import { setupDom, reporter, text, button, buttons, click, type, dialog, row, waitFor, freezeToday } from './setup'
setupDom()
freezeToday('2026-06-10')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, FINANCE } = await import('./mockSupabase')

const { check, done } = reporter()

const rpcArgs = (name: string) => captured.rpcs.filter((r) => r.name === name).map((r) => JSON.stringify(r.args))
const tab = (label: string) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith(label))
const optionNames = async () => {
  const input = dialog()!.querySelector<HTMLInputElement>('input[role="combobox"]')!
  input.focus()
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 50))
  return [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)
}
const pick = async (name: string) => {
  await type('Employee', name, dialog()!)
  await waitFor(() => document.querySelector('[role="option"]'))
  await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === name))
}

// ============================== HR ==============================

reset()
table('employees').push({ ...FINANCE })
signInAs(PEOPLE.hr)
await mountApp('/appraisals')
check('HR opens appraisals on the drafts', tab('Draft')?.getAttribute('aria-selected') === 'true' && !!row('Amna Khan'))
check('a rejected draft shows who rejected it and why',
  row('Amna Khan')?.textContent?.includes('Rejected by Amna Khan: Wait for the board'), row('Amna Khan')?.textContent)
check('a draft can be edited, deleted or sent for review',
  !!button('Edit', row('Amna Khan')) && !!button('Delete', row('Amna Khan')) && !!button('Send for review', row('Amna Khan')))

await click(tab('In review'))
check('the tab is kept in the URL', location.search === '?status=review', location.search)
check('HR can\'t approve: it waits for a company admin',
  row('Sara Iqbal')?.textContent?.includes('Waiting for a company admin') && !button('Approve'), row('Sara Iqbal')?.textContent)
check('…and shows the change from the current salary', row('Sara Iqbal')?.textContent?.includes('+13%'), row('Sara Iqbal')?.textContent)

await click(tab('Approved'))
const jun = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('June 2026'))
const jan = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('January 2026'))
check('approved salaries are the history: the one in force is active, the one it replaced past',
  jun?.textContent?.includes('Active') && jan?.textContent?.includes('Past'), jun?.textContent)
check('…with totals and the change', jun?.textContent?.includes('115,000') && jun?.textContent?.includes('+21.1%'),
  jun?.textContent)
check('…and nothing to edit', !buttons('Edit').length && !buttons('Delete').length)

await click(button('Sara Iqbal'))
check('a name opens the person\'s salary history', dialog()?.textContent?.includes('Salary history · Sara Iqbal') &&
  dialog()?.textContent?.includes('June 2026') && !dialog()?.textContent?.includes('September 2026'), dialog()?.textContent)
await click(button('Close', dialog()!))

// ---------------- a new appraisal ----------------
await click(button('New appraisal'))
const offered = await optionNames()
check('only people without one open, still here and not yourself are offered',
  JSON.stringify(offered) === JSON.stringify(['Hina Raza']), offered.join())
await pick('Hina Raza')
check('someone with no salary is told it will be their first', dialog()?.textContent?.includes('This will be their first.'))
await type('Starting month', '2026-07')
await type('Basic salary', '80000')
await type('Contractual amount', '2500')
await type('Note', '  Joining salary ')
check('the dialog totals it', dialog()?.textContent?.includes('Total 82,500 a month'), dialog()?.textContent)
await click(button('Save draft', dialog()!))
const inserted = captured.inserts.find((i) => i.table === 'salary_revisions')?.rows[0]
check('saving inserts exactly the person, month, figures and note — never a status',
  JSON.stringify(inserted) === JSON.stringify({
    employee_id: 'e-hina', effective_from: '2026-07-01', basic_salary: 80000, contractual_amount: 2500, note: 'Joining salary',
  }), JSON.stringify(inserted))
check('…and it lands among the drafts', await waitFor(() => !!row('Hina Raza') && tab('Draft')?.getAttribute('aria-selected') === 'true'))

// ---------------- editing, sending, deleting ----------------
await click(button('Edit', row('Amna Khan')))
await type('Basic salary', '360000')
await click(button('Save', dialog()!))
const updated = captured.updates.find((u) => u.table === 'salary_revisions')
check('editing updates only the month, figures and note of that draft',
  JSON.stringify(Object.keys(updated?.values ?? {}).sort()) ===
    JSON.stringify(['basic_salary', 'contractual_amount', 'effective_from', 'note']) &&
    updated?.values.basic_salary === 360000 && JSON.stringify(updated?.filters) === JSON.stringify([['id', 'eq', 'sr-amna-jul']]),
  JSON.stringify(updated))

await click(button('Send for review', row('Amna Khan')))
await click(button('Send', dialog()!))
check('sending for review calls salary_revision_move',
  rpcArgs('salary_revision_move').at(-1) === JSON.stringify({ p_revision_id: 'sr-amna-jul', p_status: 'review', p_reason: null }))

await click(button('Delete', row('Hina Raza')))
await click(button('Delete', dialog()!))
const removed = captured.deletes.find((d) => d.table === 'salary_revisions')
check('deleting removes only that draft', removed?.filters.length === 1 && removed.filters[0][0] === 'id' &&
  String(removed.filters[0][2]).startsWith('new-') && (await waitFor(() => !row('Hina Raza'))), JSON.stringify(removed))

// ---------------- the month must come after the current salary ----------------
reset()
table('salary_revisions').splice(table('salary_revisions').findIndex((r) => r.id === 'sr-sara-sep'), 1)
signInAs(PEOPLE.hr)
await mountApp('/appraisals')
await click(button('New appraisal'))
await pick('Sara Iqbal')
check('the dialog shows the current salary', dialog()?.textContent?.includes('Current salary: 115,000') &&
  dialog()?.textContent?.includes('from June 2026'), dialog()?.textContent)
await type('Starting month', '2026-06')
await type('Basic salary', '120000')
check('a month not after it is caught', dialog()?.textContent?.includes('Must be after June 2026'))
await click(button('Save draft', dialog()!))
check('…and never sent', !captured.inserts.some((i) => i.table === 'salary_revisions'))
await type('Starting month', '2026-08')
failNext('salary_revisions.insert', {
  code: '23505', message: 'duplicate key value violates unique constraint "salary_revisions_one_open_key"',
})
await click(button('Save draft', dialog()!))
check('a second open appraisal is explained', dialog()?.textContent?.includes('already has an appraisal open'),
  dialog()?.textContent)

// ============================== company admin ==============================

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/dashboard')
check('a company admin is told what waits for approval', text().includes('1 appraisal is waiting for your approval.'),
  text().slice(0, 400))
await click(button('Appraisals'))
check('…linking to the review tab', location.pathname === '/appraisals' && location.search === '?status=review')

await click(button('Approve', row('Sara Iqbal')))
check('approving says what the salary becomes, from when',
  dialog()?.textContent?.includes('Sara Iqbal’s salary becomes 130,000 a month from September 2026'), dialog()?.textContent)
await click(button('Approve', dialog()!))
check('approving calls salary_revision_move',
  rpcArgs('salary_revision_move').at(-1) === JSON.stringify({ p_revision_id: 'sr-sara-sep', p_status: 'approved', p_reason: null }))
await click(tab('Approved'))
check('…and it is upcoming until its month', [...document.querySelectorAll('tbody tr')]
  .find((r) => r.textContent?.includes('September 2026'))?.textContent?.includes('Upcoming'))

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/appraisals?status=review')
await click(button('Reject', row('Sara Iqbal')))
await click(button('Reject', dialog()!))
check('rejecting needs a reason', !rpcArgs('salary_revision_move').length)
await type('Reason', '  Wait for the review cycle ')
await click(button('Reject', dialog()!))
check('rejecting sends it back to draft with the reason',
  rpcArgs('salary_revision_move').at(-1) ===
    JSON.stringify({ p_revision_id: 'sr-sara-sep', p_status: 'draft', p_reason: 'Wait for the review cycle' }))

reset()
signInAs(PEOPLE.hr)
await mountApp('/dashboard')
check('HR admins are not asked to approve', !text().includes('waiting for your approval'))

// ============================== the employee ==============================

reset()
signInAs(PEOPLE.member)
await mountApp('/profile?tab=salary')
check('the Salary tab reads only my_salaries', rpcArgs('my_salaries').length === 1 &&
  !captured.reads.includes('salary_revisions'), captured.reads.join())
check('it shows the salary in force now', text().includes('Current salary, since June 2026') &&
  text().includes('PKR 115,000') && text().includes('110,000 basic + 5,000 contractual'), text().slice(0, 500))
const history = document.querySelector('table[aria-label="Salary history"]')
check('…then the history, without what is still in review',
  history?.textContent?.includes('June 2026') && history?.textContent?.includes('January 2026') &&
    !history?.textContent?.includes('September 2026') && history?.textContent?.includes('Past'), history?.textContent)

reset()
table('salary_revisions').length = 0
signInAs(PEOPLE.member)
await mountApp('/profile?tab=salary')
check('with nothing approved, it says HR adds it', text().includes('No salary recorded yet'))

done()
