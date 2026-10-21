// Onboarding: hiring an applicant (which creates their employee record and
// onboarding), HR's Human Resources → Onboarding list and checklist, and the
// company admins' Configuration → Onboarding checklist. The database decides
// who may do what (application_hire, the onboarding RPCs, RLS and grants);
// these checks prove the app asks for the right things.
import {
  setupDom, reporter, text, button, click, type, dialog, field, options, checkbox, row, waitFor,
  freezeToday,
} from './setup'
setupDom()
freezeToday('2026-06-10')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE } = await import('./mockSupabase')

const { check, done } = reporter()

const rpcArgs = (name: string) => captured.rpcs.filter((r) => r.name === name).map((r) => JSON.stringify(r.args))
const sectionNames = () => [...document.querySelectorAll('main section h2')].map((h) => h.textContent)
const section = (name: string) => document.querySelector<HTMLElement>(`main section[aria-label="${name}"]`)
// The checklist's tasks (Configuration) and an onboarding's (checkboxes).
const tasksIn = (name: string) => [...(section(name)?.querySelectorAll('li') ?? [])].map((li) => li.textContent)
const ticks = (name: string) => [...(section(name)?.querySelectorAll('.MuiFormControlLabel-root') ?? [])].map((l) => l.textContent)

// ============================== hiring starts an onboarding ==============================
const column = (label: string) => document.querySelector<HTMLElement>(`[role="region"][aria-label="${label}"]`)
const openMoveTo = async () => {
  dialog()!.querySelector('[role="combobox"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  await waitFor(() => options().length > 0)
}

reset()
Object.assign(table('job_applications').find((a) => a.id === 'a-cleared')!, { stage: 'offer_sent' })
signInAs(PEOPLE.hr)
await mountApp('/applications?job=j-open&application=a-cleared')
const d = () => dialog()!
await openMoveTo()
check('from Offer sent, HR can hire', options().some((o) => o.textContent === 'Hired'), options().map((o) => o.textContent).join())
await click(options().find((o) => o.textContent === 'Hired'))
check('hiring asks for the company email and date of joining, and says what it creates',
  !!field('Company email', d()) && !!field('Date of joining', d()) && !!button('Hire', d()) &&
  d().textContent?.includes('employee record (status Joining) and their onboarding'))
await click(button('Hire', d()))
check('…and won’t hire without them', !captured.rpcs.some((r) => r.name === 'application_hire'))

await type('Company email', 'fatima@gmail.com', d())
await type('Date of joining', '2026-07-01', d())
await click(button('Hire', d()))
check('…nor with an email outside the company domain', !captured.rpcs.some((r) => r.name === 'application_hire'))

await type('Company email', 'fatima@elevancelabs.com', d())
await type('Remarks', 'Signed the offer', d())
failNext('rpc.application_hire', { code: '23505', message: 'duplicate key value violates unique constraint "employees_company_email_key"' })
await click(button('Hire', d()))
check('a taken company email is explained', d().textContent?.includes('An employee with this company email already exists.'))

await click(button('Hire', d()))
check('hiring goes through application_hire, never application_move',
  rpcArgs('application_hire').at(-1) === JSON.stringify({
    p_application_id: 'a-cleared', p_company_email: 'fatima@elevancelabs.com', p_date_of_joining: '2026-07-01',
    p_reason: 'Signed the offer',
  }) && !captured.rpcs.some((r) => r.name === 'application_move'), rpcArgs('application_hire').join(' | '))
check('…the card moves to Hired', await waitFor(() => column('Hired')?.textContent?.includes('Fatima Shah')))
check('…and the application links to the new onboarding and employee record, with no undo',
  await waitFor(() => !!button('Open onboarding', d())) && !!button('Employee record', d()) &&
    !d().textContent?.includes('Undo'), d().textContent)

const hired = table('employees').find((e) => e.full_name === 'Fatima Shah')
check('the employee record is prefilled from the application, status Joining (mock stand-in)',
  hired?.status === 'joining' && hired?.personal_email === 'a-cleared@example.com' && hired?.phone === '0300 1234567',
  JSON.stringify(hired))

await click(button('Open onboarding', d()))
check('the onboarding opens', location.pathname.startsWith('/hr/onboarding/new-'), location.pathname)
check('…due the day after joining', await waitFor(() => text().includes('Due Jul 2, 2026')), text().slice(0, 300))
check('…with the checklist copied in, in order',
  sectionNames().join() === 'Paperwork,IT setup' &&
    ticks('IT setup').join() === 'Issue a laptop,Create email account,Add to Slack', ticks('IT setup').join())

// A hired application whose employee record was deleted can be undone again.
reset()
Object.assign(table('job_applications').find((a) => a.id === 'a-cleared')!, { stage: 'hired' })
table('application_stage_events').push({
  id: 9, application_id: 'a-cleared', kind: 'move', from_stage: 'offer_sent', to_stage: 'hired', reason: null,
  created_by: 'e-bilal', created_at: '2026-06-01T09:00:00Z', undone_by: null, undone_at: null,
})
signInAs(PEOPLE.hr)
await mountApp('/applications?job=j-open&application=a-cleared')
check('a hire with no employee record left can be undone',
  await waitFor(() => !!button('Undo: back to Offer sent', dialog()!)) && !button('Open onboarding', dialog()!))

// ============================== HR: the list ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/hr/onboarding')
check('in progress is the default tab, with a count on each',
  text().includes('In progress (1)') && text().includes('Completed (1)') && text().includes('Cancelled (0)'))
check('each onboarding shows the person, joining and due dates, and progress',
  row('Sara Iqbal')?.textContent?.includes('sara@elevancelabs.com') && row('Sara Iqbal')?.textContent?.includes('Jun 5, 2026') &&
  row('Sara Iqbal')?.textContent?.includes('1 / 3'), row('Sara Iqbal')?.textContent)
check('…flagged when overdue', row('Sara Iqbal')?.textContent?.includes('Overdue'))
check('…and closed ones are on their own tab', !row('Omar Farooq'))
const listSelect = captured.selects.find((s) => s.table === 'onboardings')
check('the list names the employee FK it embeds', listSelect?.columns.includes('employees!onboardings_employee_id_fkey'),
  listSelect?.columns)

await click([...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith('Completed')))
check('the tab is kept in the URL', location.search === '?status=completed', location.search)
check('completed onboardings aren’t flagged overdue', !!row('Omar Farooq') && !row('Omar Farooq')?.textContent?.includes('Overdue'))
await click([...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith('Cancelled')))
check('an empty tab says so', text().includes('No cancelled onboardings.'))
await click([...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith('In progress')))
await click(row('Sara Iqbal'))
check('a row opens the onboarding', location.pathname === '/hr/onboarding/ob-sara', location.pathname)

// ============================== HR: one onboarding ==============================
check('its tasks are grouped by section, in order',
  sectionNames().join() === 'Paperwork,IT setup' &&
    ticks('Paperwork').join() === 'Sign the contract,Collect CNIC copy' && ticks('IT setup').join() === 'Issue a laptop',
  sectionNames().join())
check('a ticked task shows who ticked it', checkbox('Sign the contract')?.checked === true &&
  section('Paperwork')?.textContent?.includes('Bilal Ahmed'))

await click(checkbox('Collect CNIC copy'))
check('ticking a task goes through onboarding_task_set',
  rpcArgs('onboarding_task_set').at(-1) === JSON.stringify({ p_task_id: 't-sara-2', p_done: true }), rpcArgs('onboarding_task_set').join())
check('…and it shows ticked', await waitFor(() => checkbox('Collect CNIC copy')?.checked === true))
await click(checkbox('Sign the contract'))
check('unticking sends done: false',
  rpcArgs('onboarding_task_set').at(-1) === JSON.stringify({ p_task_id: 't-sara-1', p_done: false }))
await waitFor(() => checkbox('Sign the contract')?.checked === false)

await click(button('Complete onboarding'))
check('completing asks first, and says how much is left',
  dialog()?.textContent?.includes('Complete onboarding?') && dialog()?.textContent?.includes('2 of 3 tasks aren’t ticked off'),
  dialog()?.textContent)
await click(button('Cancel', dialog()!))
check('…and backing out sends nothing', !captured.rpcs.some((r) => r.name === 'onboarding_complete'))
await waitFor(() => !dialog())

failNext('rpc.onboarding_complete', { message: 'This onboarding is already cancelled.' })
await click(button('Complete onboarding'))
await click(button('Complete', dialog()!))
check('a refusal is shown', await waitFor(() => text().includes('This onboarding is already cancelled.')))

await click(button('Complete onboarding'))
await click(button('Complete', dialog()!))
check('completing goes through onboarding_complete',
  rpcArgs('onboarding_complete').at(-1) === JSON.stringify({ p_onboarding_id: 'ob-sara' }))
check('…then it reads as completed, by whom', await waitFor(() => text().includes('Completed by Bilal Ahmed')))
check('…and is read-only', !button('Complete onboarding') && !button('Cancel onboarding') &&
  checkbox('Issue a laptop')?.disabled === true && !text().includes('Overdue'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/hr/onboarding/ob-sara')
await click(button('Cancel onboarding'))
check('cancelling asks for a reason', dialog()?.textContent?.includes('Cancel onboarding?') && !!field('Reason', dialog()!))
await click(button('Cancel onboarding', dialog()!))
check('…and won’t cancel without one', !captured.rpcs.some((r) => r.name === 'onboarding_cancel'))
await type('Reason', '  Didn’t join  ', dialog()!)
await click(button('Cancel onboarding', dialog()!))
check('cancelling goes through onboarding_cancel with the reason',
  rpcArgs('onboarding_cancel').at(-1) === JSON.stringify({ p_onboarding_id: 'ob-sara', p_reason: 'Didn’t join' }),
  rpcArgs('onboarding_cancel').join())
check('…then shows who cancelled it and why', await waitFor(() =>
  text().includes('Cancelled by Bilal Ahmed') && text().includes('Didn’t join')) && !button('Complete onboarding'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/hr/onboarding/nope')
check('an unknown onboarding says so', text().includes('This onboarding doesn’t exist.'))

// ============================== Configuration: the checklist ==============================
reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/configuration/onboarding')
check('a company admin sees the sections and their tasks, in order',
  sectionNames().join() === 'Paperwork,IT setup' &&
    tasksIn('Paperwork').join() === 'Sign the contract,Collect CNIC copy' &&
    tasksIn('IT setup').join() === 'Issue a laptop,Create email account,Add to Slack', sectionNames().join())
check('the first can’t move up, the last can’t move down',
  button('Move Paperwork up')?.hasAttribute('disabled') && button('Move IT setup down')?.hasAttribute('disabled') &&
  button('Move Add to Slack down')?.hasAttribute('disabled'))

await click(button('Move Paperwork down'))
check('moving a section sends the whole new order',
  rpcArgs('onboarding_reorder_sections').at(-1) === JSON.stringify({ p_ids: ['os-it', 'os-paper'] }))
check('…and the page shows it', await waitFor(() => sectionNames().join() === 'IT setup,Paperwork'), sectionNames().join())
await click(button('Move Add to Slack up'))
check('moving a task sends its section’s new order',
  rpcArgs('onboarding_reorder_tasks').at(-1) ===
    JSON.stringify({ p_section_id: 'os-it', p_ids: ['ot-laptop', 'ot-slack', 'ot-email'] }))
check('…and the page shows it',
  await waitFor(() => tasksIn('IT setup').join() === 'Issue a laptop,Add to Slack,Create email account'))
check('order is never written directly', !captured.updates.some((u) => 'sort_order' in u.values))

await click(button('Add section'))
await type('Name', '  First day ')
await click(button('Add', dialog()!))
check('adding a section sends only its name',
  JSON.stringify(captured.inserts.find((i) => i.table === 'onboarding_template_sections')?.rows) ===
    JSON.stringify([{ name: 'First day' }]))
check('…and it goes last', await waitFor(() => sectionNames().join() === 'IT setup,Paperwork,First day'), sectionNames().join())

await click(button('Add task to First day'))
await type('Task', 'Meet the team')
await click(button('Add', dialog()!))
const newSection = table('onboarding_template_sections').find((s) => s.name === 'First day')
check('adding a task sends its section and title',
  JSON.stringify(captured.inserts.find((i) => i.table === 'onboarding_template_tasks')?.rows) ===
    JSON.stringify([{ section_id: newSection?.id, title: 'Meet the team' }]))
check('…and it shows', await waitFor(() => tasksIn('First day').join() === 'Meet the team'))

await click(button('Rename IT setup'))
await type('Name', 'IT')
await click(button('Save', dialog()!))
const renamed = captured.updates.find((u) => u.table === 'onboarding_template_sections')
check('renaming updates only the name',
  JSON.stringify(renamed?.values) === '{"name":"IT"}' && JSON.stringify(renamed?.filters) === '[["id","eq","os-it"]]')

await click(button('Edit Issue a laptop'))
await type('Task', 'Issue a laptop and charger')
await click(button('Save', dialog()!))
const edited = captured.updates.find((u) => u.table === 'onboarding_template_tasks')
check('editing a task updates only its title',
  JSON.stringify(edited?.values) === '{"title":"Issue a laptop and charger"}' &&
    JSON.stringify(edited?.filters) === '[["id","eq","ot-laptop"]]')

await click(button('Add section'))
await type('Name', 'paperwork')
failNext('onboarding_template_sections.insert', { code: '23505', message: 'duplicate key value' })
await click(button('Add', dialog()!))
check('a duplicate section name is explained', dialog()?.textContent?.includes('A section with this name already exists.'))
await click(button('Cancel', dialog()!))
await waitFor(() => !dialog())

await click(button('Delete Paperwork'))
check('deleting a section asks first, counting its tasks',
  dialog()?.textContent?.includes('Paperwork and its 2 task(s) will be deleted'), dialog()?.textContent)
await click(button('Delete', dialog()!))
check('…then deletes it', JSON.stringify(captured.deletes.find((x) => x.table === 'onboarding_template_sections')?.filters) ===
  '[["id","eq","os-paper"]]')
check('…and it’s gone', await waitFor(() => !section('Paperwork')))

const meetId = table('onboarding_template_tasks').find((t) => t.title === 'Meet the team')?.id
await click(button('Delete Meet the team'))
await click(button('Delete', dialog()!))
check('deleting a task deletes just it',
  JSON.stringify(captured.deletes.find((x) => x.table === 'onboarding_template_tasks')?.filters) ===
    JSON.stringify([['id', 'eq', meetId]]) && await waitFor(() => !tasksIn('First day').length))

done()
