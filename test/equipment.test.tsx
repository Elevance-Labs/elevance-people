// Operations → Equipment, Configuration → Vendors, and the profile's
// Equipment tab with its requests. The database decides who may do what (RLS,
// grants, equipment_guard, equipment_assign / equipment_unassign,
// my_equipment, equipment_request, my_equipment_requests);
// these checks prove the app offers only that and sends exactly what it should.
import {
  setupDom, reporter, text, button, buttons, click, type, choose, dialog, field, options, row, settle, valueOf,
  waitFor, freezeToday,
} from './setup'
setupDom()
freezeToday('2026-06-10')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, FINANCE, EQUIPMENT_BUCKET } = await import('./mockSupabase')

const { check, done } = reporter()

URL.createObjectURL = () => 'blob:picked-photo'
URL.revokeObjectURL = () => {}
const opened = { url: '' }
window.open = (() => ({ close() {}, location: { set href(v: string) { opened.url = v } } })) as never

const d = () => dialog()!
const rpcArgs = (name: string) => captured.rpcs.filter((r) => r.name === name).map((r) => JSON.stringify(r.args))
const lastInsert = (t: string) => captured.inserts.filter((i) => i.table === t).at(-1)?.rows[0]
const lastUpdate = (t: string) => captured.updates.filter((u) => u.table === t).at(-1)
const cells = (contains: string) => [...(row(contains)?.querySelectorAll('td') ?? [])].map((c) => c.textContent)
const listRows = (root = 'main') => [...document.querySelectorAll(`${root} tbody tr`)].map((r) => r.textContent ?? '')
const historyRows = () =>
  [...document.querySelectorAll('[aria-label="Assignment history"] tbody tr')].map((r) =>
    [...r.querySelectorAll('td')].map((c) => c.textContent).join(' | '))

async function pickInto(label: string, file: File) {
  const input = document.querySelector<HTMLInputElement>(`input[type="file"][aria-label="${label} file"]`)
  if (!input) throw new Error(`pickInto: no ${label} file input`)
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
  await settle()
}
async function openSelect(label: string, root?: ParentNode) {
  field(label, root)?.querySelector('[role="combobox"]')
    ?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }))
  await settle()
}

// ============================== vendors ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/configuration/vendors')
check('vendors are listed by name, with bank, IBAN and how much equipment each has',
  listRows()[0].startsWith('PrintCo') && cells('TechHub').join('|') === 'TechHubLaptops and accessories|Meezan Bank|PK36MEZN0001234567890|3|',
  `${listRows().join(' / ')} :: ${cells('TechHub').join('|')}`)
check('HR adds and edits vendors, but can’t delete them',
  !!button('Add vendor') && !!button('Edit TechHub') && !button('Delete TechHub') && !button('Delete PrintCo'))

await click(button('Add vendor'))
await type('Name', '  Dell Pakistan  ', d())
await type('Bank name', ' HBL ', d())
await type('Account IBAN', 'PK12', d())
await click(button('Add', d()))
check('an IBAN that can’t be one is refused before anything is sent',
  d().textContent?.includes('Enter a valid IBAN') && !lastInsert('vendors'), d().textContent)
await type('Account IBAN', 'pk12 hbl0 0001 1112 2223 3', d())
failNext('vendors.insert', { code: '23505', message: 'duplicate key value violates unique constraint "vendors_name_key"' })
await click(button('Add', d()))
check('a duplicate name is explained', d().textContent?.includes('A vendor with this name already exists.'))
await click(button('Add', d()))
check('adding sends the trimmed name and bank, and the IBAN without spaces in upper case',
  JSON.stringify(lastInsert('vendors')) ===
    JSON.stringify({ name: 'Dell Pakistan', description: null, bank_name: 'HBL', iban: 'PK12HBL00001111222233' }),
  JSON.stringify(lastInsert('vendors')))
check('…and it is listed', await waitFor(() => !dialog() && !!row('Dell Pakistan')))

await click(button('Edit TechHub'))
check('editing starts from what is saved',
  valueOf('Name') === 'TechHub' && valueOf('Bank name') === 'Meezan Bank' && valueOf('Account IBAN') === 'PK36MEZN0001234567890')
await type('Description', '', d())
await click(button('Save', d()))
check('…and saves that vendor, a blank description as none',
  JSON.stringify(lastUpdate('vendors')) === JSON.stringify({
    table: 'vendors',
    values: { name: 'TechHub', description: null, bank_name: 'Meezan Bank', iban: 'PK36MEZN0001234567890' },
    filters: [['id', 'eq', 'v-tech']],
  }), JSON.stringify(lastUpdate('vendors')))

reset()
table('employees').push({ ...FINANCE })
signInAs(FINANCE)
await mountApp('/configuration/vendors')
check('a finance admin reaches vendors, adds and edits, but doesn’t delete',
  location.pathname === '/configuration/vendors' && !!button('Add vendor') && !!button('Edit PrintCo') &&
    !button('Delete PrintCo'), location.pathname)

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/configuration/vendors')
check('a company admin can delete a vendor, but not one equipment is linked to',
  button('Delete PrintCo')?.hasAttribute('disabled') === false && button('Delete TechHub')?.hasAttribute('disabled') === true)
failNext('vendors.delete', { code: '23503', message: 'violates foreign key constraint "equipment_vendor_id_fkey"' })
await click(button('Delete PrintCo'))
await click(button('Delete', d()))
check('a refusal because equipment is linked is explained', text().includes('Equipment is still linked to this vendor.'))
await click(button('Delete PrintCo'))
await click(button('Delete', d()))
check('deleting deletes that vendor',
  JSON.stringify(captured.deletes.at(-1)) === JSON.stringify({ table: 'vendors', filters: [['id', 'eq', 'v-print']] }) &&
    (await waitFor(() => !row('PrintCo'))), JSON.stringify(captured.deletes))

// ============================== the equipment list ==============================
reset()
table('employees').push({ ...FINANCE })
signInAs(FINANCE)
await mountApp('/operations/equipment')
const headlines = () => [...document.querySelectorAll('main tbody tr td:first-child p')].map((p) => p.textContent).join()
check('equipment is listed by identifier, requests without one first',
  headlines() === 'No identifier yet,LT-0042,MON-7,MS-3,PR-1', headlines())
check('…with identifier and description, status, holder and since when, vendor and purchase date',
  cells('LT-0042').join('|') === 'LT-0042Laptop|Active|Sara IqbalSince Jan 10, 2026|TechHub|Nov 3, 2025' &&
    cells('MON-7').join('|') === 'MON-7Monitor|Faulty|Unassigned|—|Dec 1, 2025', `${cells('LT-0042').join('|')} :: ${cells('MON-7').join('|')}`)
check('…and a request says who asked for it, when',
  cells('Standing desk').join('|') === 'No identifier yetStanding desk|Requested|Requested by Sara IqbalOn Jun 5, 2026|—|—',
  cells('Standing desk').join('|'))
check('…naming holders from the directory, as a finance admin can’t read employee records',
  captured.reads.includes('employee_directory') && !captured.reads.includes('employees'), captured.reads.join())
await type('Search by identifier, description or person', 'sara')
check('search finds by who has it or asked for it',
  listRows().length === 3 && !!row('LT-0042') && !!row('MS-3') && !!row('Standing desk'), listRows().join(' / '))
await type('Search by identifier, description or person', 'pr-1')
check('…by identifier', listRows().length === 1 && !!row('PR-1'))
await type('Search by identifier, description or person', 'MONITOR')
check('…and by description', listRows().length === 1 && !!row('MON-7'))
await type('Search by identifier, description or person', '')
await choose('Status', 'Faulty')
check('the status filter is kept in the URL', location.search === '?status=faulty' && listRows().length === 1 && !!row('MON-7'),
  location.search)
await choose('Status', 'All statuses')
await click(row('LT-0042'))
check('a row opens the equipment', location.pathname === '/operations/equipment/eq-laptop', location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment?status=sold')
check('a filter with nothing in it says so', text().includes('Nothing matches.'))

// ============================== adding ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment/new')
check('new equipment can’t be assigned until it is added',
  text().includes('Equipment can be assigned to someone once it is added.') && !button('Assign'))
check('the description is one line of up to 150 characters',
  field('Description')?.querySelector('input')?.getAttribute('maxlength') === '150')
check('…and the identifier and purchase date may wait until it is assigned',
  !field('Identifier')?.querySelector('input')?.required && !field('Purchase date')?.querySelector('input')?.required)
await type('Description', '  Monitor  ')
await type('Identifier', ' MON-8 ')
await choose('Vendor', 'TechHub')
await type('Purchase date', '2026-06-01')
await pickInto('Photo', new File(['gif'], 'monitor.gif', { type: 'image/gif' }))
check('a photo must be a JPEG, PNG or WebP image', text().includes('The photo must be a JPEG, PNG or WebP image.'))
await pickInto('Invoice', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' }))
check('…and files 10 MB or smaller', text().includes('Files must be 10 MB or smaller.'))
await pickInto('Photo', new File(['png'], 'monitor.png', { type: 'image/png' }))
await pickInto('Invoice', new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' }))
check('picked files are shown, the photo previewed',
  text().includes('monitor.png') && text().includes('invoice.pdf') &&
    document.querySelector('img[alt="Photo"]')?.getAttribute('src') === 'blob:picked-photo')
check('nothing is uploaded before saving', !captured.uploads.length)

failNext('equipment.insert', { code: '23505', message: 'duplicate key value violates unique constraint "equipment_identifier_key"' })
await click(button('Add equipment'))
check('a duplicate identifier is explained', text().includes('Other equipment already has this identifier.'))
check('…and the files uploaded for it are removed again',
  JSON.stringify(captured.removals) ===
    JSON.stringify([{ bucket: EQUIPMENT_BUCKET, paths: captured.uploads.map((u) => u.path) }]),
  JSON.stringify(captured.removals))

await click(button('Add equipment'))
const [invoiceUp, photoUp] = captured.uploads.slice(-2)
check('saving uploads the invoice and photo to the equipment bucket, under fresh names',
  invoiceUp?.bucket === EQUIPMENT_BUCKET && /^[\w-]+\.pdf$/.test(invoiceUp.path) && invoiceUp.contentType === 'application/pdf' &&
    photoUp?.bucket === EQUIPMENT_BUCKET && /^[\w-]+\.png$/.test(photoUp.path) && photoUp.contentType === 'image/png',
  JSON.stringify(captured.uploads))
check('…then adds it with the trimmed identifier and description, no request date, and the files’ paths',
  JSON.stringify(lastInsert('equipment')) === JSON.stringify({
    identifier: 'MON-8', description: 'Monitor', status: 'active', purchase_date: '2026-06-01', request_date: null,
    vendor_id: 'v-tech', invoice_path: invoiceUp?.path, photo_path: photoUp?.path,
  }), JSON.stringify(lastInsert('equipment')))
check('…and opens it, ready to assign',
  (await waitFor(() => location.pathname.startsWith('/operations/equipment/new-'))) &&
    (await waitFor(() => text().includes('Not assigned to anyone.'))), location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment/nope')
check('unknown equipment says so', text().includes('This equipment doesn’t exist.'))

// ============================== editing ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment/eq-laptop')
check('the equipment opens with what is saved, titled by its identifier',
  document.querySelector('main h1')?.textContent === 'LT-0042' && text().includes('Laptop') &&
    valueOf('Description') === 'Laptop' && valueOf('Purchase date') === '2025-11-03')
check('…and, as someone has it, its identifier and purchase date can’t be cleared',
  !!field('Identifier')?.querySelector('input')?.required && !!field('Purchase date')?.querySelector('input')?.required)
check('the saved photo is shown through a signed link from the private bucket',
  captured.signedUrls.some((s) => s.bucket === EQUIPMENT_BUCKET && s.path === 'photo-laptop.jpg') &&
    document.querySelector('img[alt="Photo"]')?.getAttribute('src') === 'https://signed.example/equipment/photo-laptop.jpg')
await click(buttons('Open')[0])
check('the invoice opens through a short-lived signed link',
  opened.url === 'https://signed.example/equipment/inv-laptop.pdf' &&
    captured.signedUrls.some((s) => s.path === 'inv-laptop.pdf' && s.expiresIn === 60), opened.url)

await openSelect('Status')
check('while someone has it, it can’t be marked requested, retired or sold',
  options().filter((o) => o.getAttribute('aria-disabled') === 'true').map((o) => o.textContent).join() === 'Requested,Retired,Sold',
  options().map((o) => `${o.textContent}:${o.getAttribute('aria-disabled')}`).join())
await click(options().find((o) => o.textContent === 'Faulty'))

await pickInto('Invoice', new File(['%PDF'], 'new-invoice.pdf', { type: 'application/pdf' }))
await click(buttons('Remove')[1])
check('a removed photo says it goes on save', text().includes('Removed when you save'))
await type('Description', 'Laptop 14"')
await click(button('Save changes'))
const newInvoice = captured.uploads.at(-1)?.path
check('saving uploads only the new invoice, and sends the details with the new paths',
  captured.uploads.length === 1 &&
    JSON.stringify(lastUpdate('equipment')) === JSON.stringify({
      table: 'equipment',
      values: {
        identifier: 'LT-0042', description: 'Laptop 14"', status: 'faulty', purchase_date: '2025-11-03', request_date: null,
        vendor_id: 'v-tech', invoice_path: newInvoice, photo_path: null,
      },
      filters: [['id', 'eq', 'eq-laptop']],
    }), JSON.stringify(lastUpdate('equipment')))
check('…then removes the replaced invoice and the removed photo',
  JSON.stringify(captured.removals) === JSON.stringify([{ bucket: EQUIPMENT_BUCKET, paths: ['inv-laptop.pdf', 'photo-laptop.jpg'] }]) &&
    captured.calls.indexOf('equipment.update') < captured.calls.lastIndexOf('storage.remove'),
  JSON.stringify(captured.removals))
check('…and says so', await waitFor(() => text().includes('Changes saved')))

reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment/eq-monitor')
failNext('equipment.update', { code: '23514', message: 'Unassign it before marking it retired.' })
await click(button('Save changes'))
check('a refusal from the database is shown', text().includes('Unassign it before marking it retired.'))

// ============================== assigning ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment/eq-laptop')
check('it shows who has it, since when',
  text().includes('Assigned to Sara Iqbal since Jan 10, 2026') && !!button('Reassign') && !!button('Unassign'))
check('…and who had it before, newest first',
  historyRows().join(' / ') === 'Sara Iqbal | Jan 10, 2026 | Now / Bilal Ahmed | Nov 5, 2025 | Jan 10, 2026',
  historyRows().join(' / '))

await click(button('Reassign'))
check('reassigning says the current holder’s assignment ends that day',
  d().textContent?.includes('Sara Iqbal’s assignment ends on the date you pick.'))
check('…and is from today, by default', valueOf('Assigned on') === '2026-06-10', valueOf('Assigned on'))
await openSelect('Employee', d())
check('only current employees are offered, not whoever has it now',
  options().map((o) => o.textContent).join() === 'Amna Khan (#0001),Bilal Ahmed (#0002)', options().map((o) => o.textContent).join())
await click(options().find((o) => o.textContent === 'Bilal Ahmed (#0002)'))
failNext('rpc.equipment_assign', { code: '23514', message: 'Its assignment history runs to 10 Jan 2026. Pick that day or later.' })
await click(button('Assign', d()))
check('a refusal is shown in the dialog', d().textContent?.includes('Its assignment history runs to 10 Jan 2026.'))
await click(button('Assign', d()))
check('assigning goes through equipment_assign with the person and date',
  rpcArgs('equipment_assign').at(-1) ===
    JSON.stringify({ p_equipment_id: 'eq-laptop', p_employee_id: 'e-bilal', p_assigned_on: '2026-06-10' }),
  rpcArgs('equipment_assign').join())
check('…and the page shows the new holder, with Sara’s assignment ended',
  (await waitFor(() => text().includes('Assigned to Bilal Ahmed since Jun 10, 2026'))) &&
    historyRows()[1] === 'Sara Iqbal | Jan 10, 2026 | Jun 10, 2026', historyRows().join(' / '))
check('…and nothing else is written', !captured.updates.length && !captured.inserts.length)

await click(button('Unassign'))
check('unassigning asks when it was returned, today by default',
  d().textContent?.includes('Bilal Ahmed had it from Jun 10, 2026.') && valueOf('Unassigned on') === '2026-06-10')
await click(button('Unassign', d()))
check('unassigning goes through equipment_unassign with the date',
  rpcArgs('equipment_unassign').at(-1) === JSON.stringify({ p_equipment_id: 'eq-laptop', p_unassigned_on: '2026-06-10' }),
  rpcArgs('equipment_unassign').join())
check('…and it is with nobody', await waitFor(() => text().includes('Not assigned to anyone.') && !button('Unassign')) &&
  button('Assign')?.hasAttribute('disabled') === false)

reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment/eq-printer')
check('retired equipment can’t be assigned, and the page says why',
  button('Assign')?.hasAttribute('disabled') === true && text().includes('Retired equipment can’t be assigned.') &&
    text().includes('It hasn’t been assigned yet.'))

// ============================== requests ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment/eq-desk')
check('a request is titled by its description, and says who asked for it, when',
  document.querySelector('main h1')?.textContent === 'Standing desk' && text().includes('No identifier yet') &&
    text().includes('Sara Iqbal asked for this on Jun 5, 2026.') && valueOf('Request date') === '2026-06-05')
check('…and can’t be assigned before its identifier and purchase date are saved',
  button('Assign')?.hasAttribute('disabled') === true &&
    text().includes('Save its identifier and purchase date before assigning it.'))
check('…but can be declined', !!button('Decline request') && !button('Delete equipment'))
await type('Identifier', 'DESK-1')
await type('Purchase date', '2026-06-08')
check('typing them in isn’t enough: they must be saved', button('Assign')?.hasAttribute('disabled') === true)
await click(button('Save changes'))
check('saving sends them with the request date kept',
  JSON.stringify(lastUpdate('equipment')?.values) === JSON.stringify({
    identifier: 'DESK-1', description: 'Standing desk', status: 'requested', purchase_date: '2026-06-08',
    request_date: '2026-06-05', vendor_id: null, invoice_path: null, photo_path: null,
  }), JSON.stringify(lastUpdate('equipment')))
check('…and then it can be assigned', await waitFor(() => button('Assign')?.hasAttribute('disabled') === false))
await click(button('Assign'))
await click(button('Assign', d()))
check('assigning a request goes to whoever asked for it, by default',
  rpcArgs('equipment_assign').at(-1) ===
    JSON.stringify({ p_equipment_id: 'eq-desk', p_employee_id: 'e-sara', p_assigned_on: '2026-06-10' }),
  rpcArgs('equipment_assign').join())
check('…after which it is active and no longer a request',
  (await waitFor(() => text().includes('Assigned to Sara Iqbal since Jun 10, 2026'))) &&
    !text().includes('asked for this') && !button('Decline request') && !!button('Delete equipment') &&
    text().includes('Active') && !text().includes('Requested'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment/eq-desk')
await click(button('Decline request'))
check('declining asks first, naming whose request it is',
  d().textContent?.includes('Decline request?') && d().textContent?.includes('Sara Iqbal’s request for “Standing desk” will be removed.'))
await click(button('Decline', d()))
check('…and deletes it: there is no declined status',
  JSON.stringify(captured.deletes) === JSON.stringify([{ table: 'equipment', filters: [['id', 'eq', 'eq-desk']] }]) &&
    !captured.updates.length && !captured.removals.length,
  `${JSON.stringify(captured.deletes)} ${JSON.stringify(captured.removals)}`)
check('…then goes back to the list', await waitFor(() => location.pathname === '/operations/equipment') && !row('Standing desk'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/dashboard')
check('HR’s dashboard nudges about requests waiting, linking to them',
  await waitFor(() =>
    document.querySelector('[data-todo="equipment-requests"]')?.textContent?.includes('1 equipment request is waiting.') === true &&
      !!document.querySelector('[data-todo="equipment-requests"] a[href$="/operations/equipment?status=requested"]')),
  document.querySelector('[data-todo="equipment-requests"]')?.innerHTML)

reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
await settle()
check('…a member’s doesn’t, and reads no equipment',
  !document.querySelector('[data-todo="equipment-requests"]') && !captured.reads.includes('equipment'), captured.reads.join())

// ============================== deleting ==============================
reset()
table('employees').push({ ...FINANCE })
signInAs(FINANCE)
await mountApp('/operations/equipment/eq-laptop')
await click(button('Delete equipment'))
check('deleting asks first, naming what goes with it',
  d().textContent?.includes('Laptop (LT-0042), its invoice, photo and assignment history will be permanently deleted.'))
await click(button('Delete', d()))
check('a finance admin deletes it: the row, then its files',
  JSON.stringify(captured.deletes) === JSON.stringify([{ table: 'equipment', filters: [['id', 'eq', 'eq-laptop']] }]) &&
    JSON.stringify(captured.removals) === JSON.stringify([{ bucket: EQUIPMENT_BUCKET, paths: ['inv-laptop.pdf', 'photo-laptop.jpg'] }]) &&
    captured.calls.indexOf('equipment.delete') < captured.calls.indexOf('storage.remove'),
  `${JSON.stringify(captured.deletes)} ${JSON.stringify(captured.removals)}`)
check('…and goes back to the list', await waitFor(() => location.pathname === '/operations/equipment') && !row('LT-0042'),
  location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment/eq-monitor')
failNext('equipment.delete', { code: '42501', message: 'permission denied' })
await click(button('Delete equipment'))
await click(button('Delete', d()))
check('a refused delete keeps the files and the page',
  text().includes('Only HR, finance and company admins can change equipment.') && !captured.removals.length &&
    location.pathname === '/operations/equipment/eq-monitor')

// ============================== the profile ==============================
reset()
signInAs(PEOPLE.member)
await mountApp('/profile?tab=equipment')
const mine = '[aria-label="Your equipment"]'
const asked = '[aria-label="Your requests"]'
check('my equipment comes from my_equipment, newest first',
  captured.rpcs.some((r) => r.name === 'my_equipment') &&
    listRows(mine).join(' / ') === 'MS-3MouseMar 2, 2026 / LT-0042LaptopJan 10, 2026', listRows(mine).join(' / '))
check('…showing only the identifier, description and assignment date',
  [...document.querySelectorAll(`${mine} thead th`)].map((th) => th.textContent).join() === 'Identifier,Description,Assigned on' &&
    !text().includes('TechHub'))
check('my requests still waiting come from my_equipment_requests',
  captured.rpcs.some((r) => r.name === 'my_equipment_requests') &&
    listRows(asked).join(' / ') === 'Standing deskJun 5, 2026Waiting', listRows(asked).join(' / '))

await click(button('Request equipment'))
check('a request is one line of up to 150 characters',
  field('What do you need?', d())?.querySelector('input')?.getAttribute('maxlength') === '150')
await type('What do you need?', '   ', d())
await click(button('Send request', d()))
check('…and can’t be blank', d().textContent?.includes('Describe what you need.') && !rpcArgs('equipment_request').length)
await type('What do you need?', '  Ergonomic chair  ', d())
failNext('rpc.equipment_request', { code: '23514', message: 'Describe what you need in one line, up to 150 characters.' })
await click(button('Send request', d()))
check('a refusal is shown in the dialog', d().textContent?.includes('Describe what you need in one line, up to 150 characters.'))
await click(button('Send request', d()))
check('sending goes through equipment_request with the trimmed description, and nothing else',
  rpcArgs('equipment_request').at(-1) === JSON.stringify({ p_description: 'Ergonomic chair' }) &&
    !captured.inserts.length && !captured.updates.length, rpcArgs('equipment_request').join())
check('…then says so and lists it as waiting',
  (await waitFor(() => !dialog() && text().includes('Your request has been sent.'))) &&
    (await waitFor(() => listRows(asked).some((r) => r.startsWith('Ergonomic chairJun 10, 2026')))), listRows(asked).join(' / '))
check('…without reading the equipment tables', !captured.reads.some((r) => r.startsWith('equipment') || r === 'vendors'),
  captured.reads.join())

reset()
signInAs(PEOPLE.hr)
await mountApp('/profile?tab=equipment')
check('with nothing assigned or asked for, the tab says so, and still offers a request',
  text().includes('No equipment is assigned to you.') && !document.querySelector(asked) && !!button('Request equipment'))

reset()
signInAs(PEOPLE.member)
failNext('rpc.my_equipment', { message: 'network down' })
await mountApp('/profile?tab=equipment')
check('a failed load shows the error', text().includes('network down'))

done()
