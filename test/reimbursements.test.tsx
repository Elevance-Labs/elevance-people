// Home → My reimbursements and Finance → Reimbursements: who may claim,
// making a claim with its receipts, and the moves HR and finance make. The
// database decides who may do what (RLS, grants, reimbursements_guard,
// reimbursement_move / reimbursement_disburse, the bucket's policies); these
// checks prove the app offers only that and sends exactly what it should.
import { setupDom, reporter, text, button, click, type, choose, dialog, row, settle, navLabels, waitFor, freezeToday } from './setup'
setupDom()
freezeToday('2026-06-10')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, FINANCE, REIMBURSEMENTS_BUCKET } = await import('./mockSupabase')

const { check, done } = reporter()

const opened = { url: '' }
window.open = (() => ({ close() {}, location: { set href(v: string) { opened.url = v } } })) as never

const d = () => dialog()!
const rpcArgs = (name: string) => captured.rpcs.filter((r) => r.name === name).map((r) => JSON.stringify(r.args))
const listRows = () => [...document.querySelectorAll('main tbody tr')].map((r) => r.textContent ?? '')
const lastInsert = () => captured.inserts.filter((i) => i.table === 'reimbursements').at(-1)?.rows[0]
const sara = () => ({ ...PEOPLE.member, can_claim_reimbursements: true })
// Signs Sara in as someone HR allows to claim (the flag on her row).
function allowSara() {
  Object.assign(table('employees').find((e) => e.id === 'e-sara')!, { can_claim_reimbursements: true })
  signInAs(sara())
}
const file = (name: string, mime: string, size = 1000) => new File(['x'.repeat(size)], name, { type: mime })
async function pick(label: string, files: File[]) {
  const input = document.querySelector<HTMLInputElement>(`input[type="file"][aria-label="${label} file"]`)
  if (!input) throw new Error(`pick: no ${label} file input`)
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
  await settle()
}

// ============================== who sees it ==============================
reset()
signInAs(PEOPLE.member)
await mountApp('/reimbursements')
check('someone HR hasn’t allowed isn’t offered My reimbursements and can’t reach it',
  !navLabels().includes('My reimbursements') && location.pathname === '/dashboard', location.pathname)

reset()
// Off the hiring team she's on in the fixtures, so the nav is a plain member's.
table('job_opening_interviewers').splice(0)
allowSara()
await mountApp('/reimbursements')
check('someone HR allows is offered My reimbursements on Home, after Profile and My leaves, and nothing of finance',
  navLabels().join() === 'Dashboard,Handbook,Resources,Profile,My leaves,My reimbursements,Org chart,Performance' &&
    location.pathname === '/reimbursements', `${navLabels().join()} @ ${location.pathname}`)

// ============================== the employee's claims ==============================
check('only their own claims are asked for',
  JSON.stringify(captured.selects.find((s) => s.table === 'reimbursements')?.filters) === JSON.stringify([['employee_id', 'eq', 'e-sara']]))
check('…newest first, with date, amount and status',
  listRows().map((r) => r.split('2026')[0]).join('|') === 'Client lunchJun 5, |Taxi to clientMay 20, |Gym membershipApr 15, |Conference ticketApr 2, ' &&
    listRows()[0].includes('PKR 4,500') && listRows()[0].includes('In review') && listRows()[3].includes('Disbursed'),
  listRows().join(' / '))
check('…and what is still to be paid (in review, approved or processed)', text().includes('PKR 5,700 still to be paid'))

await click(row('Gym membership'))
check('a rejected claim shows who rejected it and why, and offers nothing',
  d().textContent?.includes('Rejected by Bilal Ahmed: Not a work expense') && !button('Withdraw', d()))
await click(button('Close', d()))
await waitFor(() => !dialog())

await click(row('Conference ticket'))
check('a disbursed claim shows when and how it was paid',
  d().textContent?.includes('Paid on Apr 20, 2026 · Reference IBFT-778812') && !!button('Proof of payment', d()))
await click(button('Proof of payment', d()))
check('…and opens the proof through a short-lived link',
  opened.url === `https://signed.example/${REIMBURSEMENTS_BUCKET}/e-sara/proof-1.pdf`, opened.url)
await click(button('Close', d()))
await waitFor(() => !dialog())

await click(row('Taxi to client'))
check('an approved claim can no longer be withdrawn', !button('Withdraw', d()) && d().textContent?.includes('Approved by Bilal Ahmed'))
await click(button('Close', d()))
await waitFor(() => !dialog())

await click(row('Client lunch'))
check('a claim in review lists its receipts', !!button('Receipt 1', d()) && !!button('Receipt 2', d()))
await click(button('Receipt 2', d()))
check('…each opened through a short-lived link', opened.url === `https://signed.example/${REIMBURSEMENTS_BUCKET}/e-sara/rb-review-2.pdf`, opened.url)
await click(button('Withdraw', d()))
check('withdrawing asks first', d().textContent?.includes('Withdraw this claim?') && !rpcArgs('reimbursement_move').length)
await click(button('Withdraw claim', d()))
check('…then goes through reimbursement_move',
  rpcArgs('reimbursement_move').at(-1) === JSON.stringify({ p_reimbursement_id: 'rb-review', p_status: 'withdrawn', p_reason: null }),
  rpcArgs('reimbursement_move').join())
check('…and the list shows it withdrawn', await waitFor(() => !dialog() && !!row('Client lunch')?.textContent?.includes('Withdrawn')))

// ============================== a new claim ==============================
reset()
allowSara()
await mountApp('/reimbursements')
await click(button('New claim'))
await type('Description', '  Train to Lahore for the client workshop  ', d())
await type('Expense date', '2026-06-08', d())
await type('Amount (PKR)', '3250.5', d())
await click(button('Submit', d()))
check('a claim needs a receipt, and nothing is sent without one',
  d().textContent?.includes('Attach at least one receipt.') && !captured.uploads.length && !lastInsert())
await pick('Receipt', [file('ticket.gif', 'image/gif')])
check('a receipt must be an image or a PDF', d().textContent?.includes('Files must be JPEG, PNG or WebP images, or PDFs.'))
await pick('Receipt', [file('huge.pdf', 'application/pdf', 11 * 1024 * 1024)])
check('…of 10 MB or less', d().textContent?.includes('Files must be 10 MB or smaller.'))
await pick('Receipt', [file('a.jpg', 'image/jpeg'), file('b.png', 'image/png'), file('c.pdf', 'application/pdf'), file('d.pdf', 'application/pdf')])
check('no more than three receipts', d().textContent?.includes('Attach up to 3 receipts.') && !d().textContent?.includes('a.jpg'))
await pick('Receipt', [file('a.jpg', 'image/jpeg'), file('b.pdf', 'application/pdf')])
await pick('Receipt', [file('c.png', 'image/png')])
check('three receipts are listed, and no more can be added',
  ['a.jpg', 'b.pdf', 'c.png'].every((n) => d().textContent?.includes(n)) && !button('Add receipt', d()))
await click(button('Remove c.png', d()))
check('a receipt can be taken off again', !d().textContent?.includes('c.png') && !!button('Add receipt', d()))

await type('Expense date', '2026-06-11', d())
await click(button('Submit', d()))
// The field's max stops it in the browser; the page checks again before sending.
check('a date in the future is refused before anything is sent', !captured.uploads.length && !lastInsert())
await type('Expense date', '2026-06-08', d())

failNext('reimbursements.insert', { code: '42501', message: 'new row violates row-level security policy for table "reimbursements"' })
await click(button('Submit', d()))
const firstUploads = captured.uploads.map((u) => u.path)
check('the receipts are uploaded into the employee’s own folder first',
  captured.uploads.length === 2 && captured.uploads.every((u) => u.bucket === REIMBURSEMENTS_BUCKET) &&
    /^e-sara\/[0-9a-f-]{36}\.jpg$/.test(firstUploads[0]) && /^e-sara\/[0-9a-f-]{36}\.pdf$/.test(firstUploads[1]) &&
    captured.uploads[1].contentType === 'application/pdf', JSON.stringify(captured.uploads))
check('a refusal is explained, and the uploads are removed again',
  d().textContent?.includes('You can’t claim reimbursements. Ask HR if you think you should.') &&
    JSON.stringify(captured.removals) === JSON.stringify([{ bucket: REIMBURSEMENTS_BUCKET, paths: firstUploads }]),
  JSON.stringify(captured.removals))

captured.uploads.length = 0
await click(button('Submit', d()))
check('submitting sends the claim with the trimmed description, the amount and the uploaded receipts — nothing else',
  JSON.stringify(lastInsert()) === JSON.stringify({
    employee_id: 'e-sara', description: 'Train to Lahore for the client workshop', expense_date: '2026-06-08', amount: 3250.5,
    receipt_paths: captured.uploads.map((u) => u.path),
  }), JSON.stringify(lastInsert()))
check('…and it is listed in review', await waitFor(() => !dialog() && !!row('Train to Lahore')?.textContent?.includes('In review')))

reset()
allowSara()
await mountApp('/reimbursements')
await click(button('New claim'))
await type('Description', 'Cab', d())
await type('Expense date', '2026-06-01', d())
await type('Amount (PKR)', '500', d())
await pick('Receipt', [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')])
failNext('storage.upload', { message: 'The object exceeded the maximum allowed size' })
captured.uploads.length = 0
// The first upload fails: nothing more is uploaded, and nothing inserted.
await click(button('Submit', d()))
check('if a receipt can’t be uploaded, the claim isn’t sent',
  d().textContent?.includes('A receipt couldn’t be uploaded: The object exceeded the maximum allowed size') &&
    captured.uploads.length === 1 && !lastInsert(), JSON.stringify(captured.uploads))

// ============================== HR and finance claiming ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/reimbursements')
check('HR may claim without HR’s flag, and sees their own claims and those they made for others',
  location.pathname === '/reimbursements' && text().includes('For') &&
    listRows().length === 1 && listRows()[0].includes('Team offsite snacks') && listRows()[0].startsWith('You'),
  listRows().join(' / '))
check('…asking for both', JSON.stringify(captured.selects.filter((q) => q.table === 'reimbursements').map((q) => q.filters)) ===
  JSON.stringify([[['employee_id', 'eq', 'e-bilal']], [['created_by', 'eq', 'e-bilal']]]))
await click(button('New claim'))
check('a claim is for themselves by default', d().querySelector('[role="combobox"]')?.textContent === 'Me (Bilal Ahmed)')
await (async () => {
  d().querySelector('[role="combobox"]')!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }))
  await settle()
})()
const forOptions = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)
check('…or for anyone who may sign in, but not someone who has left',
  forOptions.join() === 'Me (Bilal Ahmed),Amna Khan,Sara Iqbal', forOptions.join())
await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === 'Sara Iqbal'))
await type('Description', 'Courier for Sara’s laptop', d())
await type('Expense date', '2026-06-09', d())
await type('Amount (PKR)', '900', d())
await pick('Receipt', [file('courier.jpg', 'image/jpeg')])
await click(button('Submit', d()))
check('the receipts go into that person’s folder',
  /^e-sara\/[0-9a-f-]{36}\.jpg$/.test(captured.uploads.at(-1)?.path ?? ''), captured.uploads.at(-1)?.path)
check('…and the claim is for them',
  JSON.stringify(lastInsert()) === JSON.stringify({
    employee_id: 'e-sara', description: 'Courier for Sara’s laptop', expense_date: '2026-06-09', amount: 900,
    receipt_paths: [captured.uploads.at(-1)?.path],
  }), JSON.stringify(lastInsert()))
check('…listed as made for them', await waitFor(() => !dialog() && !!row('Courier for Sara')?.textContent?.startsWith('Sara Iqbal')))
await click(row('Courier for Sara'))
check('whoever made a claim may withdraw it, but not approve it',
  !!button('Withdraw', d()) && !button('Approve', d()) && d().textContent?.includes('Claimed byYou, for Sara Iqbal'),
  d().textContent)
await click(button('Close', d()))
await waitFor(() => !dialog())

reset()
table('reimbursements').push({ ...table('reimbursements').find((r) => r.id === 'rb-review')!, id: 'rb-for-sara',
  description: 'Courier', receipt_paths: ['e-sara/courier.jpg'], created_by: 'e-bilal' })
signInAs(PEOPLE.hr)
await mountApp('/finance/reimbursements')
await click(row('Courier'))
check('…nor from the list of everyone’s claims', !button('Approve', d()) && !!button('Withdraw', d()))
await click(button('Close', d()))
await waitFor(() => !dialog())

reset()
table('reimbursements').push({ ...table('reimbursements').find((r) => r.id === 'rb-review')!, id: 'rb-for-sara',
  description: 'Courier', receipt_paths: ['e-sara/courier.jpg'], created_by: 'e-bilal' })
allowSara()
await mountApp('/reimbursements')
await click(row('Courier'))
check('the employee sees who claimed for them, and may withdraw it',
  d().textContent?.includes('Claimed byBilal Ahmed, for you') && d().textContent?.includes('Submitted by Bilal Ahmed') &&
    !!button('Withdraw', d()), d().textContent)
check('…and a member has no For column or Claim for choice', !document.querySelector('main thead')?.textContent?.includes('For'))
await click(button('Close', d()))
await waitFor(() => !dialog())
await click(button('New claim'))
check('…nor a Claim for choice', !d().querySelector('[role="combobox"]'))

// ============================== HR ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/finance/reimbursements')
check('HR sees claims in review by default, naming the employee from the directory',
  listRows().length === 1 && listRows()[0].includes('Sara Iqbal') && listRows()[0].includes('Client lunch') &&
    text().includes('1 claim · PKR 4,500') && captured.reads.includes('employee_directory'), listRows().join(' / '))
await choose('Status', 'All statuses')
check('…and every claim on request', listRows().length === 5 && location.search === '?status=all', location.search)
await choose('Status', 'In review')

await click(row('Client lunch'))
check('HR approves or rejects a claim in review',
  !!button('Approve', d()) && !!button('Reject', d()) && !button('Mark processed', d()))
await click(button('Reject', d()))
await click(button('Reject claim', d()))
check('rejecting needs a reason, and nothing is sent without one',
  d().textContent?.includes('Give a reason for rejecting the claim.') && !rpcArgs('reimbursement_move').length)
await type('Reason for rejecting', '  Lunch isn’t covered  ', d())
failNext('rpc.reimbursement_move', { code: '42501', message: 'Someone else has to decide your own claim.' })
await click(button('Reject claim', d()))
check('a refusal is shown in the dialog', d().textContent?.includes('Someone else has to decide your own claim.'))
await click(button('Reject claim', d()))
check('…rejecting sends the trimmed reason',
  rpcArgs('reimbursement_move').at(-1) ===
    JSON.stringify({ p_reimbursement_id: 'rb-review', p_status: 'rejected', p_reason: 'Lunch isn’t covered' }),
  rpcArgs('reimbursement_move').join())
check('…and it leaves the in-review list', await waitFor(() => !dialog() && !row('Client lunch')))

await choose('Status', 'Approved')
await click(row('Taxi to client'))
check('HR can’t process an approved claim; that’s finance', !button('Mark processed', d()) && !button('Reject', d()))
await click(button('Close', d()))
await waitFor(() => !dialog())

reset()
table('reimbursements').push({ ...table('reimbursements').find((r) => r.id === 'rb-review')!, id: 'rb-bilal', employee_id: 'e-bilal',
  description: 'Printer ink', receipt_paths: ['e-bilal/ink.jpg'] })
signInAs(PEOPLE.hr)
await mountApp('/finance/reimbursements')
await click(row('Printer ink'))
check('HR can’t approve their own claim', !button('Approve', d()) && !button('Reject', d()) && d().textContent?.includes('Your claim'))
await click(button('Close', d()))
await waitFor(() => !dialog())

reset()
signInAs(PEOPLE.hr)
await mountApp('/finance/reimbursements')
await click(row('Client lunch'))
await click(button('Approve', d()))
check('approving goes through reimbursement_move',
  rpcArgs('reimbursement_move').at(-1) === JSON.stringify({ p_reimbursement_id: 'rb-review', p_status: 'approved', p_reason: null }))

// ---------------- who can claim ----------------
reset()
signInAs(PEOPLE.hr)
await mountApp('/finance/reimbursements?tab=claimants')
const claimants = () => [...document.querySelectorAll('[aria-label="Who can claim"] tbody tr')].map((r) => r.textContent ?? '')
check('HR lists everyone who may log in, to pick who can claim',
  claimants().length === 3 && ['Amna Khan', 'Bilal Ahmed', 'Sara Iqbal'].every((n, i) => claimants()[i].includes(n)) &&
    text().includes('0 of 3 can claim'), claimants().join(' / '))
const saraSwitch = () => document.querySelector<HTMLInputElement>('input[aria-label="Sara Iqbal can claim"]')
await click(saraSwitch())
check('switching someone on sets only their flag',
  JSON.stringify(captured.updates.at(-1)) === JSON.stringify({
    table: 'employees', values: { can_claim_reimbursements: true }, filters: [['id', 'eq', 'e-sara']],
  }) && saraSwitch()?.checked === true && text().includes('1 of 3 can claim'), JSON.stringify(captured.updates))
failNext('employees.update', { code: '42501', message: 'permission denied for table employees' })
await click(saraSwitch())
check('a refused change is shown and the switch stays as it was',
  text().includes('permission denied for table employees') && saraSwitch()?.checked === true)

// ============================== finance ==============================
reset()
table('employees').push({ ...FINANCE })
signInAs(FINANCE)
await mountApp('/finance/reimbursements?tab=claimants')
check('a finance admin isn’t offered who can claim',
  !text().includes('Who can claim') && !captured.reads.includes('employees'), captured.reads.join())
check('…and sees approved claims by default', listRows().length === 1 && listRows()[0].includes('Taxi to client'),
  listRows().join(' / '))
await click(row('Taxi to client'))
check('finance processes or rejects an approved claim', !!button('Mark processed', d()) && !!button('Reject', d()))
await click(button('Mark processed', d()))
check('…processing goes through reimbursement_move',
  rpcArgs('reimbursement_move').at(-1) === JSON.stringify({ p_reimbursement_id: 'rb-approved', p_status: 'processed', p_reason: null }))

await choose('Status', 'Processed')
check('…and it is processed now', await waitFor(() => listRows().length === 2 && !!row('Taxi to client')), listRows().join(' / '))
await click(row('Team offsite snacks'))
await click(button('Mark disbursed', d()))
check('disbursing asks for the transaction date (today by default), a reference and proof',
  (d().querySelector('input[type="date"]') as HTMLInputElement)?.value === '2026-06-10' && !!button('Upload proof of payment', d()))
await type('Transaction date', '', d())
await click(button('Mark disbursed', d()))
check('the date is needed', d().textContent?.includes('Enter the transaction date.') && !rpcArgs('reimbursement_disburse').length)
await type('Transaction date', '2026-06-09', d())
await click(button('Mark disbursed', d()))
check('…and a reference or proof of payment',
  d().textContent?.includes('Enter the transaction reference or upload proof of payment.') && !rpcArgs('reimbursement_disburse').length)

await pick('Proof of payment', [file('receipt.png', 'image/png')])
failNext('rpc.reimbursement_disburse', { message: 'Only a processed claim can be disbursed.' })
await click(button('Mark disbursed', d()))
const proofPath = captured.uploads.at(-1)?.path ?? ''
check('the proof is uploaded into the employee’s folder', /^e-bilal\/[0-9a-f-]{36}\.png$/.test(proofPath), proofPath)
check('…and removed again if the claim can’t be disbursed',
  d().textContent?.includes('Only a processed claim can be disbursed.') &&
    JSON.stringify(captured.removals.at(-1)) === JSON.stringify({ bucket: REIMBURSEMENTS_BUCKET, paths: [proofPath] }))
await type('Transaction reference', '  FT-2026-0042  ', d())
await click(button('Mark disbursed', d()))
const secondProof = captured.uploads.at(-1)?.path
check('disbursing sends the date, the trimmed reference and the proof',
  rpcArgs('reimbursement_disburse').at(-1) === JSON.stringify({
    p_reimbursement_id: 'rb-processed', p_transaction_date: '2026-06-09', p_reference: 'FT-2026-0042', p_proof_path: secondProof,
  }), rpcArgs('reimbursement_disburse').join())
check('…and it leaves the processed list', await waitFor(() => !dialog() && !row('Team offsite snacks')))

reset()
table('employees').push({ ...FINANCE })
signInAs(FINANCE)
await mountApp('/finance/reimbursements?status=processed')
await click(row('Team offsite snacks'))
await click(button('Mark disbursed', d()))
await type('Transaction reference', 'IBFT-1', d())
await click(button('Mark disbursed', d()))
check('a reference alone is enough, with no upload',
  rpcArgs('reimbursement_disburse').at(-1) === JSON.stringify({
    p_reimbursement_id: 'rb-processed', p_transaction_date: '2026-06-10', p_reference: 'IBFT-1', p_proof_path: null,
  }) && !captured.uploads.length, rpcArgs('reimbursement_disburse').join())

reset()
table('employees').push({ ...FINANCE })
signInAs(FINANCE)
await mountApp('/finance/reimbursements?status=review')
await click(row('Client lunch'))
check('finance can’t approve a claim in review; that’s HR', !button('Approve', d()) && !button('Reject', d()))

done()
