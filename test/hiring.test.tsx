// Hiring and branding: HR's job openings (list, create, edit, delete), the
// public job page and its application form, and Company → Branding. The
// database decides who may do what (RLS, grants, the storage policy and
// submit_application); these checks prove the app asks for the right things.
import {
  setupDom, reporter, text, button, buttons, click, type, choose, dialog, field, options, pickFile, row, waitFor,
  freezeToday,
} from './setup'
setupDom()
freezeToday('2026-06-10')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE } = await import('./mockSupabase')

const { check, done } = reporter()

// jsdom's File isn't a Blob to Node's URL, which the logo preview uses.
URL.createObjectURL = () => 'blob:picked-logo'
URL.revokeObjectURL = () => {}

const pdf = (name = 'cv.pdf', type = 'application/pdf') => new File(['%PDF-1.4'], name, { type })

// ============================== job openings (HR) ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/jobs')
check('HR sees every job opening, open first', !!row('Frontend Engineer') && !!row('HR Intern') &&
  document.querySelector('tbody tr')?.textContent?.includes('Frontend Engineer'))
check('…with department, designation and hiring manager',
  row('Frontend Engineer')?.textContent?.includes('Software Engineer · Engineering') &&
  row('Frontend Engineer')?.textContent?.includes('Amna Khan'), row('Frontend Engineer')?.textContent)
check('only an open job offers its public link',
  !button('Copy public link for Frontend Engineer')?.hasAttribute('disabled') &&
  button('Copy public link for HR Intern')?.hasAttribute('disabled'))
const publicLink = document.querySelector('[aria-label="Open public page for Frontend Engineer"]')
check('the public link is the hash route of this app',
  publicLink?.getAttribute('href') === 'http://localhost/#/careers/j-open', publicLink?.getAttribute('href'))

const jobsSelect = captured.selects.find((x) => x.table === 'job_openings')?.columns ?? ''
// PostgREST turns job_applications(count) into a whole-row reference, which the
// hidden expected_salary column makes the database refuse.
check('applications are counted with the computed field, not an embedded count',
  jobsSelect.includes('application_count') && !jobsSelect.includes('job_applications('), jobsSelect)

await choose('Status', 'Draft')
check('filtering by status', !row('Frontend Engineer') && !!row('HR Intern'))

// ---------------- create ----------------
reset()
signInAs(PEOPLE.hr)
await mountApp('/jobs/new')
check('the new job form shows the rich text editor', !!document.querySelector('.ProseMirror') && !!button('Bold'))
await type('Job title', '  Backend Engineer ')
check('designation waits for a department', field('Designation')?.querySelector('.Mui-disabled') !== null)
await choose('Department', 'Engineering')
await choose('Designation', 'Software Engineer')
await choose('Status', 'Open')
await type('Due date', '2026-07-31')

await click(button('Open', field('Hiring manager')!))
const managers = options().map((o) => o.textContent ?? '')
check('people who have left are not offered for the hiring team',
  managers.some((m) => m.includes('Sara Iqbal')) && !managers.some((m) => m.includes('Omar Farooq')), managers.join(' | '))
await click(options().find((o) => o.textContent?.includes('Amna Khan')))
await click(button('Open', field('Interviewers')!))
await click(options().find((o) => o.textContent?.includes('Sara Iqbal')))
await click(button('Open', field('Interviewers')!))
await click(options().find((o) => o.textContent?.includes('Bilal Ahmed')))

await click(button('Create job opening'))
const created = captured.inserts.find((i) => i.table === 'job_openings')?.rows[0]
check('creating sends only the editable columns, trimmed, with no description when blank',
  JSON.stringify(created) === JSON.stringify({
    title: 'Backend Engineer', department_id: 'd-eng', designation_id: 'g-dev', status: 'open',
    due_date: '2026-07-31', description: null, manager_id: 'e-amna',
  }), JSON.stringify(created))
const newId = table('job_openings').find((j) => j.title === 'Backend Engineer')?.id
check('…then adds the interviewers to the new job',
  JSON.stringify(captured.inserts.find((i) => i.table === 'job_opening_interviewers')?.rows) ===
    JSON.stringify([{ job_opening_id: newId, employee_id: 'e-sara' }, { job_opening_id: newId, employee_id: 'e-bilal' }]),
  JSON.stringify(captured.inserts))
check('…and opens the saved job, with its public link',
  await waitFor(() => location.pathname === `/jobs/${newId}` &&
    [...document.querySelectorAll('input')].some((i) => i.value === `http://localhost/#/careers/${newId}`)),
  location.pathname)

// ---------------- edit ----------------
reset()
signInAs(PEOPLE.hr)
table('job_openings')[0].description = '<p>Hi</p><script>alert(1)</script><img src=x onerror="alert(1)">'
await mountApp('/jobs/j-open')
check('editing loads the job, its interviewers and the stored description',
  text().includes('Frontend Engineer') && !!document.querySelector('.MuiChip-root') &&
  document.querySelector('.ProseMirror')?.textContent === 'Hi')
// Swap Sara for Bilal.
const saraChip = [...document.querySelectorAll('.MuiChip-root')].find((c) => c.textContent === 'Sara Iqbal')
await click(saraChip?.querySelector('.MuiChip-deleteIcon'))
await click(button('Open', field('Interviewers')!))
await click(options().find((o) => o.textContent?.includes('Bilal Ahmed')))
await type('Job title', 'Senior Frontend Engineer')
await click(button('Save changes'))
const updated = captured.updates.find((u) => u.table === 'job_openings')
check('saving updates the job by id, never with created_by',
  updated?.values.title === 'Senior Frontend Engineer' && !('created_by' in (updated?.values ?? {})) &&
  JSON.stringify(updated?.filters) === JSON.stringify([['id', 'eq', 'j-open']]), JSON.stringify(updated))
check('…with a sanitised description (no script, no image)',
  !/script|img|onerror/.test(String(updated?.values.description)), String(updated?.values.description))
check('…removes only the interviewer taken off',
  JSON.stringify(captured.deletes.find((d) => d.table === 'job_opening_interviewers')?.filters) ===
    JSON.stringify([['job_opening_id', 'eq', 'j-open'], ['employee_id', 'in', ['e-sara']]]),
  JSON.stringify(captured.deletes))
check('…and adds only the one put on',
  JSON.stringify(captured.inserts.find((i) => i.table === 'job_opening_interviewers')?.rows) ===
    JSON.stringify([{ job_opening_id: 'j-open', employee_id: 'e-bilal' }]), JSON.stringify(captured.inserts))
check('…and says so', await waitFor(() => text().includes('Changes saved')))

// ---------------- delete ----------------
reset()
signInAs(PEOPLE.hr)
table('job_applications').push({ id: 'a-1', job_opening_id: 'j-open' })
await mountApp('/jobs/j-open')
check('a job with applications can’t be deleted', button('Delete job')?.hasAttribute('disabled'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/jobs/j-draft')
check('a draft job says it isn’t public', text().includes('Not public while the job is draft'))
await click(button('Delete job'))
await click(button('Delete', dialog()!))
check('deleting a job without applications deletes it and returns to the list',
  JSON.stringify(captured.deletes.find((d) => d.table === 'job_openings')?.filters) ===
    JSON.stringify([['id', 'eq', 'j-draft']]) && (await waitFor(() => location.pathname === '/jobs')),
  JSON.stringify(captured.deletes))

reset()
signInAs(PEOPLE.hr)
await mountApp('/jobs/j-draft')
failNext('job_openings.delete', { code: '23503', message: 'violates foreign key constraint' })
await click(button('Delete job'))
await click(button('Delete', dialog()!))
check('if the database says it has applications, that is explained',
  await waitFor(() => text().includes('This job has applications, so it can’t be deleted. Close it instead.')))

// ============================== the public job page ==============================
reset()
table('job_openings')[0].description = '<h2>Role</h2><p>Hi</p><script>window.hacked = 1</script><img src=x onerror="alert(1)">'
await mountApp('/careers/j-open')
check('the job shows with its department, designation and due date',
  text().includes('Frontend Engineer') && text().includes('Software Engineer · Engineering') &&
  text().includes('Apply by'), text().slice(0, 300))
check('the description is rendered without scripts or images',
  text().includes('Role') && !document.querySelector('script, img:not([alt="Elevance Labs"])'),
  document.querySelector('main, body')?.innerHTML.slice(0, 300))
check('the branded logo and perks show',
  document.querySelector('img')?.getAttribute('src') === 'https://public.example/branding/logo-old.png' &&
  text().includes('Health insurance') && text().includes('For you and your family'))
// The header band behind the title is painted in the primary colour.
const band = document.querySelector('h1')?.parentElement?.parentElement
check('the page takes the branded primary colour',
  band && getComputedStyle(band).backgroundColor === 'rgb(10, 125, 90)', band && getComputedStyle(band).backgroundColor)

await pickFile(pdf('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
check('only a PDF is accepted as the CV', text().includes('Your CV must be a PDF.'))
await pickFile(new File([new Uint8Array(6 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' }))
check('a CV over 6 MB is refused', text().includes('Your CV is larger than 6 MB.'))
check('the form asks for expected salary in PKR, before the CV',
  !!field('Expected salary') && text().includes('PKR') &&
  text().indexOf('Expected salary') < text().indexOf('Attach CV / resume'))
await type('Full name', 'Zara Malik')
await type('Email address', 'zara@example.com')
await type('Phone number', '+92 300 1234567')
await type('Note', 'Available from July.')
await click(button('Submit application'))
// The browser's own validation stops these (required, step 1); the form re-checks before sending.
const salaryInput = () => field('Expected salary')!.querySelector('input')!
check('submitting without an expected salary is stopped, and sends nothing',
  salaryInput().validity.valueMissing && !captured.uploads.length &&
  !captured.rpcs.some((r) => r.name === 'submit_application'))
await type('Expected salary', '1.5')
await click(button('Submit application'))
check('…as is a salary that isn’t whole rupees', salaryInput().validity.stepMismatch && !captured.uploads.length)
await type('Expected salary', '250000')
await click(button('Submit application'))
check('submitting without a CV asks for one, and sends nothing',
  text().includes('Attach your CV as a PDF.') && !captured.uploads.length && !captured.rpcs.some((r) => r.name === 'submit_application'))

await pickFile(pdf('Zara CV.pdf'))
await click(button('Submit application'))
const upload = captured.uploads[0]
check('the CV goes to the private bucket, inside the job’s folder, as a PDF',
  upload?.bucket === 'job-applications' && /^j-open\/[0-9a-f-]{36}\.pdf$/.test(upload.path) &&
  upload.contentType === 'application/pdf', JSON.stringify(upload))
const submitted = captured.rpcs.find((r) => r.name === 'submit_application')?.args
check('…then the application is submitted through the function, pointing at that file',
  JSON.stringify(submitted) === JSON.stringify({
    p_job_opening_id: 'j-open', p_full_name: 'Zara Malik', p_email: 'zara@example.com', p_phone: '+92 300 1234567',
    p_expected_salary: 250000, p_note: 'Available from July.', p_resume_path: upload?.path, p_resume_name: 'Zara CV.pdf',
  }), JSON.stringify(submitted))
check('…and only after the upload', captured.calls.indexOf('storage.upload') < captured.calls.indexOf('rpc.submit_application'))
check('the applicant is thanked', await waitFor(() => text().includes('Application sent') && text().includes('Thanks, Zara')))
check('the application lands in the database', table('job_applications').some((a) => a.full_name === 'Zara Malik' && a.expected_salary === 250000))

reset()
await mountApp('/careers/j-open')
failNext('rpc.submit_application', { code: '23505', message: 'duplicate key value violates unique constraint' })
await type('Full name', 'Zara Malik')
await type('Email address', 'zara@example.com')
await type('Phone number', '0300')
await type('Expected salary', '200000')
await pickFile(pdf())
await click(button('Submit application'))
check('applying twice with the same email is explained',
  await waitFor(() => text().includes('You’ve already applied for this job with this email address.')))

reset()
await mountApp('/careers/j-open')
failNext('storage.upload', { message: 'new row violates row-level security policy' })
await type('Full name', 'Zara Malik')
await type('Email address', 'zara@example.com')
await type('Phone number', '0300')
await type('Expected salary', '200000')
await pickFile(pdf())
await click(button('Submit application'))
check('a refused upload stops before submitting',
  text().includes('Your CV couldn’t be uploaded.') && !captured.rpcs.some((r) => r.name === 'submit_application'))

reset()
table('job_openings')[0].due_date = '2026-06-01'
await mountApp('/careers/j-open')
check('past its due date the job still shows, but takes no applications',
  text().includes('Frontend Engineer') && text().includes('Applications for this job closed on') &&
  !button('Submit application'))

for (const id of ['j-draft', 'nope']) {
  reset()
  await mountApp(`/careers/${id}`)
  check(`a job that isn’t open (${id}) shows nothing of it`,
    text().includes('This job isn’t open') && !text().includes('HR Intern'), text().slice(0, 200))
}

// ============================== branding (company admins) ==============================
reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/company/branding')
check('branding loads the logo, colour and perks',
  document.querySelector('img[alt="Logo"]')?.getAttribute('src') === 'https://public.example/branding/logo-old.png' &&
  (field('Hex')?.querySelector('input') as HTMLInputElement | null)?.value === '#0a7d5a' &&
  [...document.querySelectorAll('input')].some((i) => i.value === 'Remote Fridays'))

await type('Hex', 'teal')
await click(button('Save branding'))
check('an invalid colour is refused before saving',
  text().includes('Enter the colour as a hex code') && !captured.updates.length)

await type('Hex', '#1E88E5')
await click(button('Remove Remote Fridays'))
await click(button('Add perk'))
const perkFields = [...document.querySelectorAll<HTMLElement>('.MuiFormControl-root')].filter((f) =>
  f.querySelector('label')?.textContent?.startsWith('Perk'))
await type('Perk', 'Gym membership', perkFields.at(-1)!.parentElement!)
await click(button('Move Gym membership up'))
await click(button('Add perk')) // left blank: dropped on save
await click(button('Save branding'))
const brandingUpdate = captured.updates.find((u) => u.table === 'branding')
check('saving sends colour (lower case) and perks in their new order, blank rows dropped',
  JSON.stringify(brandingUpdate?.values) === JSON.stringify({
    logo_path: 'logo-old.png', primary_color: '#1e88e5',
    perks: [{ title: 'Gym membership', description: null }, { title: 'Health insurance', description: 'For you and your family' }],
  }), JSON.stringify(brandingUpdate?.values))
check('…to the single branding row, and no logo is touched', JSON.stringify(brandingUpdate?.filters) ===
  JSON.stringify([['id', 'eq', true]]) && !captured.uploads.length && !captured.removals.length)

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/company/branding')
await pickFile(new File(['png'], 'logo.png', { type: 'image/png' }))
await click(button('Save branding'))
const logoUpload = captured.uploads[0]
check('a new logo is uploaded to the branding bucket on save',
  logoUpload?.bucket === 'branding' && /^logo-[0-9a-f-]{36}\.png$/.test(logoUpload.path), JSON.stringify(logoUpload))
check('…saved as the logo, and the old file removed afterwards',
  captured.updates.find((u) => u.table === 'branding')?.values.logo_path === logoUpload?.path &&
  JSON.stringify(captured.removals) === JSON.stringify([{ bucket: 'branding', paths: ['logo-old.png'] }]) &&
  captured.calls.join() .indexOf('branding.update') < captured.calls.join().indexOf('storage.remove'),
  JSON.stringify(captured.removals))

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/company/branding')
await pickFile(new File(['gif'], 'logo.gif', { type: 'image/gif' }))
check('a logo that isn’t PNG, JPEG or WebP is refused', text().includes('The logo must be a PNG, JPEG or WebP image.'))
await click(button('Remove'))
await click(button('Save branding'))
check('removing the logo clears it and deletes the file',
  captured.updates.find((u) => u.table === 'branding')?.values.logo_path === null &&
  JSON.stringify(captured.removals) === JSON.stringify([{ bucket: 'branding', paths: ['logo-old.png'] }]))

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/company/branding')
await pickFile(new File(['png'], 'logo.png', { type: 'image/png' }))
failNext('branding.update', { code: '23514', message: 'violates check constraint "branding_perks_check"' })
await click(button('Save branding'))
check('if saving fails, the logo just uploaded is removed again',
  captured.removals.length === 1 && captured.removals[0].paths[0] === captured.uploads[0]?.path &&
  text().includes('branding_perks_check'), JSON.stringify(captured.removals))

// ============================== applications board ==============================
const column = (label: string) => document.querySelector<HTMLElement>(`[role="region"][aria-label="${label}"]`)
const columnLabels = () => [...document.querySelectorAll('[role="region"]')].map((r) => r.getAttribute('aria-label'))
const openCard = async (name: string) =>
  click([...document.querySelectorAll<HTMLElement>('[role="region"] button')].find((b) => b.textContent?.includes(name)))

reset()
signInAs(PEOPLE.hr)
await mountApp('/applications')
check('a job is always selected: the open one first', location.search === '?job=j-open', location.search)
check('HR sees a column for every stage, in order', columnLabels().join() ===
  'New,Screened,Shortlisted,Test,Interview 1,Interview 2,Interview 3,Cleared,Shelf,Offer sent,Hired,Rejected,Abandoned,Declined',
  columnLabels().join())
check('…with each application in its stage',
  column('New')?.textContent?.includes('Zara Malik') && column('Shortlisted')?.textContent?.includes('Hamza Ali') &&
  column('Rejected')?.textContent?.includes('Usman Tariq'))
const boardSelect = captured.selects.find((x) => x.table === 'job_applications')
check('the board asks for one job’s applications, never the expected salary',
  JSON.stringify(boardSelect?.filters) === JSON.stringify([['job_opening_id', 'eq', 'j-open']]) &&
  !boardSelect?.columns.includes('expected_salary') && !boardSelect?.columns.includes('*'), JSON.stringify(boardSelect))

await openCard('Hamza Ali')
const d = () => dialog()!
check('a card opens the application, linkable by URL', location.search === '?job=j-open&application=a-short', location.search)
check('the header shows the candidate, their contact details and the job',
  d().textContent?.includes('Hamza Ali') && d().textContent?.includes('a-short@example.com') &&
  d().textContent?.includes('0300 1234567') && d().textContent?.includes('Frontend Engineer'))
check('HR sees the expected salary', d().querySelector('[aria-label="Expected salary"]')?.textContent === 'PKR 250,000',
  d().querySelector('[aria-label="Expected salary"]')?.textContent)
check('the CV is shown in a viewer from a signed URL',
  d().querySelector('iframe')?.getAttribute('src') === 'https://signed.example/job-applications/j-open/a-short.pdf')
const timeline = () => d().querySelector('[aria-label="Timeline"]')?.textContent ?? ''
check('the timeline shows each move with who made it and the reason, and the application',
  timeline().includes('Moved to Shortlisted') && timeline().includes('Moved to Screened') &&
  timeline().includes('Good CV') && timeline().includes('Bilal Ahmed') && timeline().includes('Applied'), timeline())
check('the applicant’s note is shown', d().textContent?.includes('Available from July.'))

const openMoveTo = async () => {
  dialog()!.querySelector('[role="combobox"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  await waitFor(() => options().length > 0)
}
await openMoveTo()
check('only the allowed next stages are offered',
  options().map((o) => o.textContent).join() === 'Test,Interview 1,Rejected,Abandoned', options().map((o) => o.textContent).join())
await click(options().find((o) => o.textContent === 'Rejected'))
check('rejecting asks for a reason', !!field('Reason', d()))
await click(button('Move', d()))
check('…and won’t move without one', !captured.rpcs.some((r) => r.name === 'application_move') &&
  !!field('Reason', d())?.querySelector('textarea:not([aria-hidden])')?.matches(':invalid'))
await type('Reason', 'Salary expectations too high', d())
await click(button('Move', d()))
check('moving goes through application_move with the reason',
  JSON.stringify(captured.rpcs.find((r) => r.name === 'application_move')?.args) ===
    JSON.stringify({ p_application_id: 'a-short', p_stage: 'rejected', p_reason: 'Salary expectations too high' }),
  JSON.stringify(captured.rpcs.filter((r) => r.name === 'application_move')))
check('…the card moves column', await waitFor(() => column('Rejected')?.textContent?.includes('Hamza Ali') &&
  !column('Shortlisted')?.textContent?.includes('Hamza Ali')))
check('…and the timeline shows it', await waitFor(() => timeline().includes('Salary expectations too high')))
check('rejected is final: no more moves', !field('Move to', d()) && d().textContent?.includes('Rejected is a final stage.'))

await click(button('Undo: back to Shortlisted', d()))
await type('Comment', 'Rejected by mistake')
await click(button('Undo move'))
check('HR can undo the last move, with a comment',
  JSON.stringify(captured.rpcs.find((r) => r.name === 'application_undo')?.args) ===
    JSON.stringify({ p_application_id: 'a-short', p_reason: 'Rejected by mistake' }),
  JSON.stringify(captured.rpcs.filter((r) => r.name === 'application_undo')))
check('…which puts it back and keeps the undone move in the timeline',
  await waitFor(() => column('Shortlisted')?.textContent?.includes('Hamza Ali') &&
    timeline().includes('Moved back to Shortlisted') && timeline().includes('Undone')), timeline())
check('…and HR can keep walking back', !!button('Undo: back to Screened', d()))

await click(button('Close', d()))
check('closing drops the application from the URL', location.search === '?job=j-open', location.search)
await choose('Job', 'HR Intern · Draft')
check('switching job loads that job’s board', location.search === '?job=j-draft' &&
  captured.selects.filter((x) => x.table === 'job_applications').at(-1)?.filters[0]?.[2] === 'j-draft')

// ---------------- an interviewer ----------------
reset()
signInAs(PEOPLE.member) // Sara interviews for Frontend Engineer
await mountApp('/applications?job=j-open')
check('an interviewer sees only shortlisted through cleared', columnLabels().join() ===
  'Shortlisted,Test,Interview 1,Interview 2,Interview 3,Cleared', columnLabels().join())
await openCard('Ayesha Noor')
await waitFor(() => captured.rpcs.some((r) => r.name === 'application_salary'))
check('an interviewer doesn’t see the expected salary', !dialog()?.querySelector('[aria-label="Expected salary"]') &&
  !dialog()?.textContent?.includes('300,000'))
check('…can’t undo', !buttons('Undo: back to Test', dialog()!).length && !dialog()?.textContent?.includes('Undo'))
await openMoveTo()
check('…and can move an interview on',
  options().map((o) => o.textContent).join() === 'Interview 2,Cleared,Shelf,Rejected,Abandoned',
  options().map((o) => o.textContent).join())
await click(options().find((o) => o.textContent === 'Interview 2'))
const remarks = () => field('Remarks', dialog()!)?.querySelector<HTMLTextAreaElement>('textarea:not([aria-hidden])')
check('moving to an interview needs remarks', !!remarks()?.required && !field('Reason', dialog()!))
await click(button('Move', dialog()!))
check('…and won’t move without them', !captured.rpcs.some((r) => r.name === 'application_move') &&
  !!remarks()?.matches(':invalid'))
await type('Remarks', 'Strong system design round', dialog()!)
await click(button('Move', dialog()!))
check('…then moves with them',
  JSON.stringify(captured.rpcs.find((r) => r.name === 'application_move')?.args) ===
    JSON.stringify({ p_application_id: 'a-int', p_stage: 'interview_2', p_reason: 'Strong system design round' }),
  JSON.stringify(captured.rpcs.filter((r) => r.name === 'application_move')))
await click(button('Close', dialog()!))
await waitFor(() => !dialog())
await openCard('Fatima Shah')
check('from cleared only HR moves it on', !field('Move to', dialog()!) &&
  dialog()!.textContent!.includes('Only HR can move an application on from Cleared.'))

reset()
table('job_openings')[0].manager_id = 'e-sara'
signInAs(PEOPLE.member)
await mountApp('/applications?job=j-open&application=a-int')
check('the hiring manager sees the expected salary',
  await waitFor(() => dialog()?.querySelector('[aria-label="Expected salary"]')?.textContent === 'PKR 300,000'))

done()
