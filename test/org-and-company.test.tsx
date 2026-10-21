// The org chart (who may edit it, adding, removing, moving) and the company
// settings pages (departments, designations, KPIs). The database refuses cycles
// and deletes of departments still in use; these checks prove the app does not
// offer them, and sends what it should when it does.
import { setupDom, reporter, text, button, click, type, choose, dialog, row, options, valueOf, waitFor } from './setup'
setupDom()

const { mountApp } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE } = await import('./mockSupabase')

const { check, done } = reporter()

// The chart is nested <li>s: a person's card, then their reports' list.
const card = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('li > .MuiPaper-root')].find((p) =>
    p.querySelector('h6, .MuiTypography-subtitle2')?.textContent === name)
const managerInChart = (name: string) =>
  card(name)?.parentElement?.parentElement?.closest('li')?.querySelector(':scope > .MuiPaper-root .MuiTypography-subtitle2')
    ?.textContent ?? null

// React reads dataTransfer off the native event; jsdom has none, so give it one.
function drag(type: string, el: Element | null | undefined) {
  if (!el) throw new Error(`drag ${type}: element not found`)
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { setData() {}, effectAllowed: '', dropEffect: '' } })
  el.dispatchEvent(event)
}
const pause = () => new Promise((r) => setTimeout(r, 30))

// ============================== org chart ==============================

reset()
signInAs(PEOPLE.member)
await mountApp('/org-chart')
check('the chart is drawn from the directory', !!card('Amna Khan') && !!card('Sara Iqbal'))
check('reporting lines are nested', managerInChart('Sara Iqbal') === 'Amna Khan', managerInChart('Sara Iqbal'))
check('a card shows designation and department', card('Sara Iqbal')?.textContent?.includes('Software EngineerEngineering'))
check('a member reads the directory, never employees', captured.reads.includes('employee_directory') &&
  !captured.reads.includes('employees'), captured.reads.join())
check('a member cannot add, remove or drag',
  !button('Add person') && !button('Add report') && card('Sara Iqbal')?.getAttribute('draggable') === 'false')

reset()
signInAs(PEOPLE.hr)
await mountApp('/org-chart')
check('HR can add and drag', !!button('Add person') && card('Sara Iqbal')?.getAttribute('draggable') === 'true')

await click(button('Add person'))
await click(button('Open', dialog()!))
const offered = options().map((o) => o.textContent)
check('only people not yet in the chart, and still here, are offered',
  offered.length === 1 && offered[0]?.includes('Bilal Ahmed'), offered.join(' | '))
await click(options()[0])
// "Reports to" left empty: top level.
await click(button('Add', dialog()!))
check('adding inserts the person at the top level',
  JSON.stringify(captured.inserts.find((i) => i.table === 'org_chart_nodes')?.rows) ===
    JSON.stringify([{ employee_id: 'e-bilal', manager_id: null }]),
  JSON.stringify(captured.inserts))
check('…and they appear', await waitFor(() => !!card('Bilal Ahmed')))

// Dragging Amna onto Sara would make a cycle: the app must not even try.
drag('dragstart', card('Amna Khan'))
await pause()
drag('dragover', card('Sara Iqbal'))
drag('drop', card('Sara Iqbal'))
await pause()
check('a person cannot be dropped onto their own report', !captured.updates.some((u) => u.table === 'org_chart_nodes'))

drag('dragstart', card('Sara Iqbal'))
await pause()
drag('dragover', card('Bilal Ahmed'))
drag('drop', card('Bilal Ahmed'))
await waitFor(() => captured.updates.length > 0)
const moved = captured.updates.find((u) => u.table === 'org_chart_nodes')
check('dropping a person onto someone makes them report to them',
  JSON.stringify(moved?.values) === '{"manager_id":"e-bilal"}' &&
    JSON.stringify(moved?.filters) === JSON.stringify([['employee_id', 'eq', 'e-sara']]),
  JSON.stringify(moved))
check('…and the chart redraws', await waitFor(() => managerInChart('Sara Iqbal') === 'Bilal Ahmed'), managerInChart('Sara Iqbal'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/org-chart')
await click(button('Remove from chart', card('Amna Khan')!))
check('removing a manager says their reports move up',
  dialog()?.textContent?.includes('Their 1 direct report(s) will move up one level.'), dialog()?.textContent)
check('…and that the record is untouched', dialog()?.textContent?.includes('Their employee record is not affected.'))
await click(button('Remove', dialog()!))
check('removing goes through org_chart_remove',
  JSON.stringify(captured.rpcs.filter((r) => r.name === 'org_chart_remove').map((r) => r.args)) ===
    JSON.stringify([{ p_employee_id: 'e-amna' }]))
check('…and the report is now at the top', await waitFor(() => !card('Amna Khan') && managerInChart('Sara Iqbal') === null))

reset()
signInAs(PEOPLE.hr)
await mountApp('/org-chart')
failNext('rpc.org_chart_remove', { message: 'permission denied for function org_chart_remove' })
await click(button('Remove from chart', card('Sara Iqbal')!))
await click(button('Remove', dialog()!))
check('a refused change is shown', await waitFor(() => text().includes('permission denied for function org_chart_remove')))

// ============================== departments ==============================

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/company/departments')
check('departments show their counts', row('Engineering')?.textContent?.includes('Engineering'))
check('a department with employees cannot be deleted',
  (button('Delete Engineering') as HTMLButtonElement | undefined)?.disabled === true)
check('an empty one can', (button('Delete Design') as HTMLButtonElement | undefined)?.disabled === false)
check('each shows its business function, or that it has none yet',
  row('Engineering')?.textContent?.includes('Production') && row('People Ops')?.textContent?.includes('Operations') &&
  row('Design')?.textContent?.includes('Not set'), row('Design')?.textContent)

await click(button('Edit Design'))
await click(button('Save', dialog()!))
check('a department without a function can\'t be saved until one is chosen',
  !!dialog() && !captured.updates.length, JSON.stringify(captured.updates))
await choose('Business function', 'Growth', dialog()!)
await click(button('Save', dialog()!))
const deptUpdate = captured.updates.find((u) => u.table === 'departments')
check('…then it is sent with the rest, by id',
  JSON.stringify(deptUpdate?.values) === JSON.stringify({ name: 'Design', description: null, business_function: 'growth' }) &&
  JSON.stringify(deptUpdate?.filters) === JSON.stringify([['id', 'eq', 'd-new']]), JSON.stringify(deptUpdate))
check('…and the list shows it', await waitFor(() => row('Design')?.textContent?.includes('Growth')))
await click(button('Edit Engineering'))
check('editing loads the function it has', valueOf('Business function') === 'production', valueOf('Business function'))
await click(button('Cancel', dialog()!))
await waitFor(() => !dialog())
await click(button('Delete Design'))
await click(button('Delete', dialog()!))
check('deleting deletes that department',
  JSON.stringify(captured.deletes.find((d) => d.table === 'departments')?.filters) === JSON.stringify([['id', 'eq', 'd-new']]))
check('…and it leaves the list', await waitFor(() => !row('Design')))

await click(button('Add department'))
await type('Name', '  Finance  ')
await click(button('Add', dialog()!))
check('a new department needs a business function', !!dialog() && !captured.inserts.length, JSON.stringify(captured.inserts))
await choose('Business function', 'Operations', dialog()!)
await click(button('Add', dialog()!))
check('a new department is sent trimmed, with its function and no description as null',
  JSON.stringify(captured.inserts.find((i) => i.table === 'departments')?.rows) ===
    JSON.stringify([{ name: 'Finance', description: null, business_function: 'operations' }]),
  JSON.stringify(captured.inserts))

await click(button('Add department'))
await type('Name', 'engineering')
await choose('Business function', 'Production', dialog()!)
failNext('departments.insert', { code: '23505', message: 'duplicate key value violates unique constraint "departments_name_key"' })
await click(button('Add', dialog()!))
check('a duplicate name is explained in the dialog', dialog()?.textContent?.includes('A department with this name already exists.'))
await click(button('Cancel', dialog()!))

await waitFor(() => !dialog())
// The database has the last word on "in use" (an employee may have been linked since the page loaded).
failNext('departments.delete', { code: '23503', message: 'update or delete on table "departments" violates foreign key constraint' })
await click(button('Delete Finance'))
await click(button('Delete', dialog()!))
check('a department the database says is in use is explained',
  await waitFor(() => text().includes('Employees or job openings are still linked to this department or its designations.')))

// ============================== designations ==============================

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/company/designations?department=d-ops')
check('a department link filters designations', !!row('HR Generalist') && !row('Software Engineer'))
await click(button('Edit HR Generalist'))
await choose('Department', 'Engineering', dialog()!)
check('moving a designation warns that its people move too',
  dialog()?.textContent?.includes('The 1 employee(s) with this designation will move to the new department.'),
  dialog()?.textContent)
await click(button('Save', dialog()!))
const movedDesignation = captured.updates.find((u) => u.table === 'designations')
check('the move is one update of that designation',
  movedDesignation?.values.department_id === 'd-eng' &&
    JSON.stringify(movedDesignation.filters) === JSON.stringify([['id', 'eq', 'g-hr']]),
  JSON.stringify(movedDesignation))

// ============================== KPIs ==============================

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/company/kpis?designation=g-dev')
check('KPIs for a designation show their total weight', text().includes('Total weight 100%'))
table('kpis').push({ id: 'k-3', designation_id: 'g-dev', name: 'Docs written', description: null, target: null, weight: 10 })
await mountApp('/company/kpis?designation=g-dev')
check('a total that is not 100 still shows, so it can be fixed', text().includes('Total weight 110%'))
await click(button('Add KPI'))
await type('Name', 'Uptime')
await type('Weight', '12.5')
await click(button('Add', dialog()!))
const kpi = captured.inserts.find((i) => i.table === 'kpis')?.rows[0]
check('a new KPI starts on the filtered designation, with its weight as a number',
  kpi?.designation_id === 'g-dev' && kpi?.weight === 12.5 && kpi?.target === null, JSON.stringify(kpi))

done()
