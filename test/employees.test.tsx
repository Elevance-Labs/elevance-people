// Employee records: the list, the form (who may set roles, what is sent, how a
// delete is ordered) and documents (upload rules, signed links, soft delete).
import {
  setupDom, reporter, text, button, checkbox, click, type, choose, dialog, row, field, valueOf, options, pickFile, settle, waitFor,
} from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, FINANCE } = await import('./mockSupabase')

const { check, done } = reporter()

const tab = (label: string) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === label)
const keys = (o: object | undefined) => JSON.stringify(Object.keys(o ?? {}).sort())

// ============================== the list ==============================

reset()
signInAs(PEOPLE.hr)
await mountApp('/employees')
check('the list shows everyone, with their designation and department',
  row('Sara Iqbal')?.textContent?.includes('Software Engineer') && row('Sara Iqbal')?.textContent?.includes('Engineering'))
check('employee numbers are shown padded', row('Sara Iqbal')?.textContent?.includes('#0003'))
const SEARCH = 'Search name, email, department…'
await type(SEARCH, 'people ops')
check('search matches department names', !!row('Bilal Ahmed') && !row('Sara Iqbal'), text().slice(0, 300))
await type(SEARCH, '')
await choose('Status', 'Left')
check('the status filter keeps only that status', !!row('Omar Farooq') && !row('Sara Iqbal'))
await click(row('Omar Farooq'))
check('a row opens that employee', location.pathname === '/employees/e-omar', location.pathname)

// ============================== the form, as HR ==============================

reset()
signInAs(PEOPLE.hr)
await mountApp('/employees/e-sara')
check('the record loads', valueOf('Full name') === 'Sara Iqbal', valueOf('Full name'))
check('HR cannot change the access role', field('Access role')?.textContent?.includes('Only a company admin can change this'))
check('…nor the company email, which is the login',
  field('Company email')?.querySelector('input')?.disabled === true &&
  !!field('Company email')?.textContent?.includes('Only a company admin can change this'))
check('HR is not offered delete', !button('Delete employee'))
check('the record opens on its details', tab('Details')?.getAttribute('aria-selected') === 'true' &&
  !text().includes('cnic.pdf'))
await click(tab('Documents'))
check('documents have their own tab, kept in the URL', location.search === '?tab=documents', location.search)
// The documents panel has no spinner of its own.
check('her documents are listed, but not the deleted one',
  (await waitFor(() => text().includes('cnic.pdf'))) && !text().includes('old-photo.png'))
await click(tab('Details'))
check('…and back to the details', !!valueOf('Full name') && location.search === '', location.search)

await type('Phone number', ' 0300 1234567 ')
await click(button('Save changes'))
const hrSave = captured.updates.find((u) => u.table === 'employees')
check('HR\'s save leaves the role out, so the database guard is not tripped',
  !!hrSave && !('app_role' in hrSave.values), JSON.stringify(hrSave?.values))
check('…and the company email too', !!hrSave && !('company_email' in hrSave.values))
check('…sends the edit trimmed', hrSave?.values.phone === '0300 1234567')
check('…turns empty fields into nulls', hrSave?.values.cnic_number === null && hrSave?.values.bank === null)
check('…and updates only that record',
  JSON.stringify(hrSave?.filters) === JSON.stringify([['id', 'eq', 'e-sara']]), JSON.stringify(hrSave?.filters))
check('saving says so', text().includes('Changes saved'))

// A designation belongs to one department: changing department clears it.
await choose('Department', 'People Ops')
check('changing department clears the designation', valueOf('Designation') === '', valueOf('Designation'))
const combo = field('Designation')!.querySelector('[role="combobox"]')!
combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
await settle()
check('only the new department\'s designations are offered',
  options().map((o) => o.textContent).join() === 'None,HR Generalist', options().map((o) => o.textContent).join())

// ---------------- a new employee ----------------
reset()
signInAs(PEOPLE.hr)
await mountApp('/employees/new')
check('documents wait until the record exists',
  text().includes('Documents can be uploaded after the employee is created') && !tab('Documents'))
await type('Full name', '  Zara Ali ')
await type('Company email', 'zara@elevancelabs.com')
await type('Date of joining', '2026-07-01')
await click(button('Create employee'))
const created = captured.inserts.find((i) => i.table === 'employees')?.rows[0]
check('creating sends the record trimmed', created?.full_name === 'Zara Ali' && created?.company_email === 'zara@elevancelabs.com',
  JSON.stringify(created))
check('HR creating sends no role', !!created && !('app_role' in created), keys(created))
check('…nor a sign-in method, so it is Google', !!created && !('login_method' in created), keys(created))
check('…and never the login or the number', !!created && !('user_id' in created) && !('employee_number' in created))
check('after creating, the new record opens', await waitFor(() => location.pathname.startsWith('/employees/new-')),
  location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/employees/new')
await type('Full name', 'Zara Ali')
await type('Company email', 'Zara.Ali@elevancelabs.com')
await type('Date of joining', '2026-07-01')
failNext('employees.insert', { code: '23505', message: 'duplicate key value violates unique constraint "employees_company_email_key"' })
await click(button('Create employee'))
check('the email is lower-cased before sending',
  captured.inserts.find((i) => i.table === 'employees')?.rows[0]?.company_email === 'zara.ali@elevancelabs.com')
check('a duplicate email is explained', text().includes('An employee with this company email already exists.'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/employees/new')
await type('Full name', 'Zara Ali')
await type('Company email', 'zara@gmail.com')
await type('Date of joining', '2026-07-01')
await click(button('Create employee'))
check('the form refuses an email outside the company domain', !captured.inserts.some((i) => i.table === 'employees'))
check('HR cannot set up a password login', field('Sign-in')?.querySelector('[role="combobox"]')?.getAttribute('aria-disabled') === 'true')

// ============================== the form, as company admin ==============================

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/employees/e-sara')
check('a company admin can change the access role', !field('Access role')?.textContent?.includes('Only a company admin'))
check('…and the company email', field('Company email')?.querySelector('input')?.disabled === false)
await choose('Access role', 'HR Admin')
await type('Company email', 'Sara.Iqbal@elevancelabs.com')
await click(button('Save changes'))
check('a company admin\'s save sends the role',
  captured.updates.find((u) => u.table === 'employees')?.values.app_role === 'hr_admin')
check('…and the new email, lower-cased',
  captured.updates.find((u) => u.table === 'employees')?.values.company_email === 'sara.iqbal@elevancelabs.com')

captured.calls.length = 0
await click(button('Delete employee'))
check('delete asks first', dialog()?.textContent?.includes('Sara Iqbal and all their documents will be permanently deleted'))
await click(button('Delete', dialog()!))
// (The list it goes back to then reads its own data.)
// A file can only be removed once no document row points at it (storage policy).
check('delete removes the record first, then its files',
  captured.calls.slice(0, 3).join() === 'employee_documents.select,employees.delete,storage.remove', captured.calls.join())
check('…every file, the hidden ones too',
  JSON.stringify(captured.removals) === JSON.stringify([{ bucket: 'employee-docs', paths: ['e-sara/1111.pdf', 'e-sara/2222.png'] }]),
  JSON.stringify(captured.removals))
check('…and goes back to the list', await waitFor(() => location.pathname === '/employees'), location.pathname)

// ---------------- a password login ----------------
reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/employees/new')
check('a new record signs in with Google by default', valueOf('Sign-in') === 'google', valueOf('Sign-in'))
await choose('Sign-in', 'Email and password')
check('a password login asks for a login email instead', !!field('Login email') && !field('Company email'))
await type('Full name', 'Hina Raza')
await type('Login email', 'Hina@Gmail.com')
await type('Date of joining', '2026-07-01')
failNext('employees.insert', { code: '23514', message: 'new row for relation "employees" violates check constraint "employees_company_email_check"' })
await click(button('Create employee'))
const passwordRow = captured.inserts.find((i) => i.table === 'employees')?.rows[0]
check('an outside address is accepted for it, and sent with the method',
  passwordRow?.company_email === 'hina@gmail.com' && passwordRow?.login_method === 'password', JSON.stringify(passwordRow))
check('the email check is explained for a password login',
  text().includes('A password login needs an address outside @elevancelabs.com.'), text().slice(0, 300))

// ---------------- setting a password login's password ----------------
const withPasswordLogin = () =>
  table('employees').push({ ...FINANCE, company_email: 'hina@gmail.com', login_method: 'password' })
const passwordInput = () => field('New password', dialog()!)?.querySelector('input')

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/employees/e-sara')
check('a Google login has no password to set', !button('Set password'))

reset()
withPasswordLogin()
signInAs(PEOPLE.hr)
await mountApp('/employees/e-hina')
check('HR cannot set a password', valueOf('Full name') === 'Hina Raza' && !button('Set password'))

reset()
withPasswordLogin()
signInAs(PEOPLE.companyAdmin)
await mountApp('/employees/e-hina')
check('a company admin can set a password login\'s password', !!button('Set password') && text().includes('hina@gmail.com'))
await click(button('Set password'))
const first = passwordInput()?.value ?? ''
check('the dialog starts with a strong generated password', /^[A-Za-z2-9]{16}$/.test(first) && !/[0O1lI]/.test(first), first)
await click(button('Generate', dialog()!))
check('…and Generate makes another', !!passwordInput()?.value && passwordInput()?.value !== first)
await type('New password', 'short', dialog()!)
await click(button('Set password', dialog()!))
check('a short password is refused before anything is sent',
  dialog()?.textContent?.includes('Use at least 10 characters.') && !captured.functions.length)
await type('New password', 'a-long-enough-one', dialog()!)
failNext('functions.set-password', { message: 'Only a company admin can set passwords.' })
await click(button('Set password', dialog()!))
check('a refusal from the function is shown as it says',
  dialog()?.textContent?.includes('Only a company admin can set passwords.'), dialog()?.textContent ?? '')
await click(button('Set password', dialog()!))
check('it sends only the employee and the password, to the set-password function',
  JSON.stringify(captured.functions.at(-1)) ===
    JSON.stringify({ name: 'set-password', body: { employee_id: 'e-hina', password: 'a-long-enough-one' } }),
  JSON.stringify(captured.functions))
check('…then closes and says to send it another way',
  (await waitFor(() => !dialog())) && text().includes('Password set. Send it to them through a different channel'))

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/employees/e-sara')
failNext('employees.delete', { message: 'Permission denied' })
await click(button('Delete employee'))
await click(button('Delete', dialog()!))
check('if the record cannot be deleted, its files are kept', !captured.removals.length)
check('…and the error is shown', text().includes('Permission denied'))

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/employees/e-sara')
failNext('storage.remove', { message: 'Storage is unavailable' })
await click(button('Delete employee'))
await click(button('Delete', dialog()!))
check('once the record is gone, a failed file removal still goes back to the list',
  !table('employees').some((e) => e.id === 'e-sara') && (await waitFor(() => location.pathname === '/employees')),
  location.pathname)

// ============================== documents ==============================

reset()
signInAs(PEOPLE.hr)
await mountApp('/employees/e-sara?tab=documents')
check('a link straight to the Documents tab opens it', tab('Documents')?.getAttribute('aria-selected') === 'true')
const docRead = captured.selects.find((s) => s.table === 'employee_documents')
check('documents are read for this employee, hiding deleted ones',
  JSON.stringify(docRead?.filters) === JSON.stringify([['employee_id', 'eq', 'e-sara'], ['deleted_at', 'is', null]]),
  JSON.stringify(docRead?.filters))

const fileOf = (name: string, type: string, size: number) => {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}
await pickFile(fileOf('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000))
check('only images and PDFs may be picked', text().includes('Only images (JPEG, PNG, WebP, GIF) and PDF files are allowed.'))
await pickFile(fileOf('scan.pdf', 'application/pdf', 11 * 1024 * 1024))
check('files over 10 MB are refused', text().includes('File is larger than 10 MB.'))
check('a refused file cannot be uploaded', (button('Upload') as HTMLButtonElement | undefined)?.disabled === true)

await choose('Document type', 'Offer letter')
await pickFile(fileOf('Offer.PDF', 'application/pdf', 50_000))
await click(button('Upload'))
const upload = captured.uploads[0]
check('the file goes to the private bucket under the employee\'s folder',
  upload?.bucket === 'employee-docs' && /^e-sara\/[0-9a-f-]{36}\.pdf$/.test(upload.path), JSON.stringify(upload))
check('…with its content type', upload?.contentType === 'application/pdf')
const docRow = captured.inserts.find((i) => i.table === 'employee_documents')?.rows[0]
check('the document row carries only what the client may write',
  keys(docRow) === keys({ employee_id: 0, doc_type: 0, file_name: 0, storage_path: 0, mime_type: 0, size_bytes: 0 }),
  keys(docRow))
check('…pointing at the uploaded file', docRow?.storage_path === upload?.path && docRow?.doc_type === 'Offer letter')
check('the list reloads with it', await waitFor(() => text().includes('Offer.PDF')))

reset()
signInAs(PEOPLE.hr)
await mountApp('/employees/e-sara?tab=documents')
failNext('storage.upload', { message: 'Bucket quota exceeded' } as never)
await pickFile(fileOf('scan.pdf', 'application/pdf', 1000))
await click(button('Upload'))
check('a failed upload writes no document row', !captured.inserts.some((i) => i.table === 'employee_documents'))
check('…and says why', text().includes('Bucket quota exceeded'))

// Viewing opens a short-lived signed link.
const opened: { url?: string } = {}
window.open = (() => ({ close() {}, location: { set href(v: string) { opened.url = v } } })) as never
await click(button('View', row('cnic.pdf')))
check('viewing signs a link that lasts a minute',
  JSON.stringify(captured.signedUrls) === JSON.stringify([{ bucket: 'employee-docs', path: 'e-sara/1111.pdf', expiresIn: 60 }]))
check('…and opens it', opened.url === 'https://signed.example/employee-docs/e-sara/1111.pdf', opened.url)

await click(button('Delete', row('cnic.pdf')))
await click(button('Delete', dialog()!))
const softDelete = captured.updates.find((u) => u.table === 'employee_documents')
check('deleting a document only hides it', keys(softDelete?.values) === '["deleted_at"]' && !captured.removals.length,
  JSON.stringify(softDelete))
check('…that document', JSON.stringify(softDelete?.filters) === JSON.stringify([['id', 'eq', 'doc-1']]))
check('…and it leaves the list', await waitFor(() => !text().includes('cnic.pdf')))
check('there is no way to delete a document for good',
  !captured.deletes.some((d) => d.table === 'employee_documents') && !captured.removals.length)

// ---------------- show deleted ----------------
reset()
signInAs(PEOPLE.hr)
await mountApp('/employees/e-sara?tab=documents')
await waitFor(() => text().includes('cnic.pdf'))
const showDeleted = () => checkbox('Show deleted') as HTMLInputElement | undefined
const item = (name: string) => [...document.querySelectorAll('li')].find((li) => li.textContent?.includes(name))
check('deleted documents are hidden by default', showDeleted()?.checked === false && !text().includes('old-photo.png'))
captured.selects.length = 0
await click(showDeleted())
const allRead = captured.selects.find((s) => s.table === 'employee_documents')
check('Show deleted reads them all for this employee',
  JSON.stringify(allRead?.filters) === JSON.stringify([['employee_id', 'eq', 'e-sara']]), JSON.stringify(allRead?.filters))
check('…and lists the deleted one, marked as such',
  (await waitFor(() => text().includes('old-photo.png'))) && !!item('old-photo.png')?.textContent?.includes('Deleted'))
check('a deleted document can still be viewed', !!button('View', item('old-photo.png')!))
check('…but not deleted again', !button('Delete', item('old-photo.png')!) && !!button('Delete', item('cnic.pdf')!))
await click(showDeleted())
check('turning it off hides it again', await waitFor(() => !text().includes('old-photo.png')))

done()
