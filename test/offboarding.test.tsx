// Offboarding: Human Resources → Offboarding (HR, and managers for their
// reports), one offboarding's checklist, details and sign-off, the dashboard's
// reminders, the employee form's hint, and the company admins' Configuration →
// Offboarding checklist. The database decides who may do what (the
// employees_offboarding trigger, the offboarding RPCs, RLS and grants); these
// checks prove the app offers only what that allows and sends exactly what it
// should.
import { setupDom, reporter, text, button, click, type, choose, dialog, row, waitFor, freezeToday, field } from './setup'
setupDom()
freezeToday('2026-06-10')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, table, PEOPLE } = await import('./mockSupabase')

const { check, done } = reporter()

const rpcArgs = (name: string) => captured.rpcs.filter((r) => r.name === name).map((r) => JSON.stringify(r.args))
const section = (name: string) => document.querySelector<HTMLElement>(`main section[aria-label="${name}"]`)
const sectionNames = () => [...document.querySelectorAll('main section h2')].map((h) => h.textContent)
const tick = (title: string) =>
  [...document.querySelectorAll('main .MuiFormControlLabel-root')]
    .find((l) => l.textContent === title)
    ?.querySelector<HTMLInputElement>('input') ?? null
const tab = (label: string) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith(label))

// ============================== the list (HR) ==============================

reset()
signInAs(PEOPLE.hr)
await mountApp('/hr/offboarding')
check('HR sees offboardings in progress', !!row('Sara Iqbal') && !row('Omar Farooq'))
check('…with the reason, last day, progress and sign-off',
  row('Sara Iqbal')?.textContent?.includes('Resigned') && row('Sara Iqbal')?.textContent?.includes('2 / 3') &&
    row('Sara Iqbal')?.textContent?.includes('0 of 2 signed'), row('Sara Iqbal')?.textContent)
await click(tab('Completed'))
check('closed ones are under their tab', location.search === '?status=completed' && !!row('Omar Farooq'), location.search)
await click(row('Omar Farooq'))
check('a row opens the offboarding', location.pathname === '/hr/offboarding/off-omar', location.pathname)
check('a completed one says who it marked as left', text().includes('Omar Farooq is marked left from'), text().slice(0, 400))
check('…and its checklist is read-only', tick('Agree a handover plan')?.disabled === true)

// ============================== one offboarding (HR) ==============================

reset()
signInAs(PEOPLE.hr)
await mountApp('/hr/offboarding/off-sara')
check('the checklist is shown by section', sectionNames().slice(2).join() === 'Handover,Equipment', sectionNames().join())
check('sign-off waits for the last task', !button('Sign off') &&
  section('Sign-off')?.textContent?.includes('Every task has to be ticked off.'), section('Sign-off')?.textContent)
check('…and shows the manager it will need', section('Sign-off')?.textContent?.includes('Waiting for Amna Khan'))

await click(tick('Collect the laptop'))
check('ticking calls offboarding_task_set for that task',
  rpcArgs('offboarding_task_set').at(-1) === JSON.stringify({ p_task_id: 'ft-sara-3', p_done: true }),
  rpcArgs('offboarding_task_set').join())
check('with everything ticked, HR is offered sign-off', !!button('Sign off'))
await click(button('Sign off'))
check('the dialog says it still waits for the manager',
  dialog()?.textContent?.includes('You sign off as HR. It then waits for Amna Khan.'), dialog()?.textContent)
await click(button('Sign off', dialog()!))
check('signing off calls offboarding_sign_off with just the offboarding',
  JSON.stringify(rpcArgs('offboarding_sign_off')) === JSON.stringify([JSON.stringify({ p_offboarding_id: 'off-sara' })]))
check('…and shows HR as signed, with no second offer', section('Sign-off')?.textContent?.includes('HR · Bilal Ahmed') &&
  (await waitFor(() => !dialog() && !button('Sign off'))), section('Sign-off')?.textContent)

await click(tick('Collect the laptop'))
check('unticking a task clears the sign-off', section('Sign-off')?.textContent?.includes('HR · Waiting'),
  section('Sign-off')?.textContent)

await click(button('Change', section('Details')!))
await choose('Reason', 'Contract ended')
await type('Last working day', '2026-06-30')
check('the dialog says what they will be marked', dialog()?.textContent?.includes('marked left from this day'))
await click(button('Save', dialog()!))
check('saving the details sends the reason and day',
  rpcArgs('offboarding_set_details').at(-1) ===
    JSON.stringify({ p_offboarding_id: 'off-sara', p_reason: 'contract_ended', p_last_working_day: '2026-06-30' }),
  rpcArgs('offboarding_set_details').join())
check('…and shows them', section('Details')?.textContent?.includes('Contract ended'))

await click(tick('Collect the laptop'))
check('a last day still to come keeps sign-off closed', !button('Sign off') &&
  section('Sign-off')?.textContent?.includes('Sign-off opens on the last working day.'), section('Sign-off')?.textContent)

await click(button('Cancel offboarding'))
await click(button('Cancel offboarding', dialog()!))
check('cancelling needs a reason', !rpcArgs('offboarding_cancel').length)
await type('Reason', '  Staying on after all ', dialog()!)
await click(button('Cancel offboarding', dialog()!))
check('cancelling sends the reason, trimmed',
  rpcArgs('offboarding_cancel').at(-1) === JSON.stringify({ p_offboarding_id: 'off-sara', p_reason: 'Staying on after all' }))
check('…and the offboarding is closed', text().includes('Cancelled by Bilal Ahmed') &&
  (await waitFor(() => !dialog() && !button('Cancel offboarding'))), text().slice(0, 400))

// ---------------- the last sign-off completes it ----------------
reset()
for (const t of table('offboarding_tasks')) t.done_at ??= '2026-06-09T09:00:00Z'
signInAs(PEOPLE.companyAdmin)
await mountApp('/hr/offboarding/off-sara')
await click(button('Sign off'))
check('signing as HR and manager at once says it completes',
  dialog()?.textContent?.includes('This completes Sara Iqbal’s offboarding') &&
    dialog()?.textContent?.includes('can no longer sign in'), dialog()?.textContent)
await click(button('Sign off', dialog()!))
check('…and it is completed', text().includes('Sara Iqbal is marked left from'), text().slice(0, 400))
check('…with Sara marked as left', table('employees').find((e) => e.id === 'e-sara')?.status === 'left')

// ============================== a manager who isn't HR ==============================

// Sara manages Omar, who is leaving. (The mock doesn't apply RLS, so her own
// offboarding is taken out of the fixtures.)
function saraManagesOmar() {
  reset()
  table('org_chart_nodes').push({ employee_id: 'e-omar', manager_id: 'e-sara' })
  const own = table('offboardings')
  own.splice(0, own.length, { ...own.find((o) => o.id === 'off-omar')!, id: 'off-omar-2', status: 'in_progress',
    hr_signed_by: null, hr_signed_at: null, completed_at: null, last_working_day: '2026-06-09' })
  table('offboarding_tasks').push({ id: 'ft-omar-2', offboarding_id: 'off-omar-2', section: 'Handover', section_order: 0,
    title: 'Hand over open work', sort_order: 0, done_by: null, done_at: null })
  signInAs(PEOPLE.member)
}

saraManagesOmar()
await mountApp('/dashboard')
check('a manager is told someone on their team is leaving',
  text().includes('Someone on your team is leaving'), text().slice(0, 400))
await mountApp('/hr/offboarding/off-omar-2')
check('a manager can open their report\'s offboarding', location.pathname === '/hr/offboarding/off-omar-2')
check('…but not change the details or cancel it', !button('Set details') && !button('Change') && !button('Cancel offboarding'))
check('…nor see a link to the employee record', !document.querySelector('a[href*="/employees/"]'))
await click(tick('Hand over open work'))
check('a manager can tick tasks', rpcArgs('offboarding_task_set').at(-1) ===
  JSON.stringify({ p_task_id: 'ft-omar-2', p_done: true }))
await click(button('Sign off'))
check('a manager signs off as manager, then waits for HR',
  dialog()?.textContent?.includes('You sign off as their manager. It then waits for HR.'), dialog()?.textContent)

// ============================== dashboard (HR) ==============================

reset()
for (const t of table('offboarding_tasks')) t.done_at ??= '2026-06-09T09:00:00Z'
signInAs(PEOPLE.hr)
await mountApp('/dashboard')
check('HR is told an offboarding waits for their sign-off',
  text().includes('1 offboarding is waiting for your sign-off.'), text().slice(0, 400))
check('…linking to it', !!document.querySelector('a[href*="/hr/offboarding/off-sara"]'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/dashboard')
check('with a task left, there is nothing to sign', !text().includes('waiting for your sign-off'))

// ============================== the employee form ==============================

reset()
signInAs(PEOPLE.hr)
await mountApp('/employees/e-sara')
await choose('Status', 'Notice period')
check('putting someone on notice says it starts their offboarding',
  field('Status')?.textContent?.includes('Saving starts their offboarding'), field('Status')?.textContent)

// ============================== Configuration → Offboarding ==============================

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/configuration/offboarding')
check('a company admin sees the offboarding checklist', text().includes('Offboarding checklist') &&
  sectionNames().join() === 'Handover,Equipment', sectionNames().join())
await click(button('Move Handover down'))
check('moving a section calls the offboarding reorder',
  rpcArgs('offboarding_reorder_sections').at(-1) === JSON.stringify({ p_ids: ['fs-kit', 'fs-handover'] }) &&
    !rpcArgs('onboarding_reorder_sections').length)
await click(button('Add section'))
await type('Name', ' Exit ')
await click(button('Add', dialog()!))
check('adding a section writes to the offboarding checklist',
  JSON.stringify(captured.inserts.find((i) => i.table === 'offboarding_template_sections')?.rows) ===
    JSON.stringify([{ name: 'Exit' }]) && !captured.inserts.some((i) => i.table === 'onboarding_template_sections'))
check('…and it goes last', await waitFor(() => sectionNames().join() === 'Equipment,Handover,Exit'), sectionNames().join())

await mountApp('/configuration/onboarding')
check('the onboarding checklist is still its own', sectionNames().join() === 'Paperwork,IT setup', sectionNames().join())

done()
