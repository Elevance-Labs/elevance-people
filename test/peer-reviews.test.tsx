// Peer reviews: HR setting up a quarter (questions, who reviews whom, open,
// close) and reading every response with names; a reviewer writing and
// submitting their form; the subject reading what was written about them,
// anonymised. The database decides who may do what (peer_* RPCs, triggers,
// RLS); these checks prove the app asks for the right things.
import {
  setupDom, reporter, text, button, click, type, dialog, field, options, waitFor, freezeToday, settle,
} from './setup'
setupDom()
// Q2 2026 has no peer reviews yet; Q1's are closed.
freezeToday('2026-06-05')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE } = await import('./mockSupabase')

const { check, done } = reporter()

const rpcArgs = (name: string) => captured.rpcs.filter((r) => r.name === name).map((r) => JSON.stringify(r.args))
const section = (name: string) => document.querySelector<HTMLElement>(`main section[aria-label="${name}"]`)
const tabLabels = () => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent).join()
const tab = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === label)
const insertsOf = (t: string) => captured.inserts.filter((i) => i.table === t).map((i) => JSON.stringify(i.rows))

// Open a person picker (MUI Autocomplete) and list its options.
async function openPicker(label: string, root: ParentNode = document) {
  field(label, root)!.querySelector('input')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  await settle()
  return options().map((o) => o.textContent ?? '')
}

// ============================== the subject: anonymised ==============================
reset()
signInAs(PEOPLE.member) // Sara: reviewed by Amna and Bilal in Q1, reviews nobody
await mountApp('/performance')
const peer = () => section('Peer feedback')
check('someone asked for no peer reviews gets no Peer reviews tab', !tabLabels(), tabLabels())
check('the employee reads what colleagues wrote, through my_peer_feedback only',
  await waitFor(() => !!peer()) && captured.rpcs.some((r) => r.name === 'my_peer_feedback') &&
    !captured.reads.includes('peer_review_answers'), captured.reads.join())
check('…each question with its average, and the comments',
  peer()!.textContent!.includes('Q1 2026 · 2 responses') &&
    peer()!.textContent!.includes('Collaborates well and is easy to work with.3.5 / 5') &&
    peer()!.textContent!.includes('Communicates clearly and keeps others informed.4.5 / 5') &&
    peer()!.textContent!.includes('“Great pairing”') && peer()!.textContent!.includes('“Clear standups”') &&
    peer()!.textContent!.includes('“Always helpful in code reviews.”'), peer()?.textContent)
check('…and never who wrote them', !peer()!.textContent!.includes('Amna') && !peer()!.textContent!.includes('Bilal'))

await mountApp('/performance/cycles/pc-q1')
check('a member can’t open a peer review cycle', location.pathname === '/dashboard', location.pathname)

// ============================== HR sets up the quarter ==============================
reset()
signInAs(PEOPLE.hr) // Bilal
await mountApp('/dashboard')
check('HR is reminded when the quarter has no peer reviews', await waitFor(() => text().includes('No peer reviews set up for Q2 2026 yet.')))

await mountApp('/performance?tab=cycles')
check('HR has a Peer cycles tab (and Peer reviews, having reviewed Sara in Q1)',
  tabLabels() === 'Me,Peer reviews,People,Peer cycles', tabLabels())
check('…listing each quarter with how many reviews are in',
  await waitFor(() => text().includes('Q1 2026')) && text().includes('Closed') && text().includes('2 of 2'), text())
check('…and saying this quarter still needs one', text().includes('No peer reviews set up for Q2 2026 yet.'))

await click(button('Set up peer reviews'))
check('only quarters without peer reviews are offered', await (async () => {
  dialog()!.querySelector('[role="combobox"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  await settle()
  const offered = options().map((o) => o.textContent).join()
  await click(options()[0])
  return offered === 'Q2 2026,Q3 2026'
})(), options().map((o) => o.textContent).join())
await type('Due date', '2026-06-20', dialog()!)
await click(button('Set up', dialog()!))
check('setting up goes through peer_cycle_create',
  rpcArgs('peer_cycle_create').join() === JSON.stringify({ p_year: 2026, p_quarter: 2, p_due_date: '2026-06-20' }),
  rpcArgs('peer_cycle_create').join())
check('…and opens the new draft', await waitFor(() => location.pathname.startsWith('/performance/cycles/new-')), location.pathname)
const cycleId = location.pathname.split('/').at(-1)!
const questions = () => [...(section('Questions')?.querySelectorAll('li') ?? [])].map((li) => li.textContent)
check('…with last quarter’s questions', await waitFor(() => questions().length === 3) &&
  questions()[0] === 'Collaborates well and is easy to work with.' && text().includes('Draft'), questions().join('|'))

await type('New question', '  Shares knowledge with the team.  ', section('Questions')!)
await click(button('Add', section('Questions')!))
check('a question can be added while a draft, trimmed',
  insertsOf('peer_review_questions').at(-1) === JSON.stringify([{ cycle_id: cycleId, prompt: 'Shares knowledge with the team.' }]) &&
    questions().length === 4, insertsOf('peer_review_questions').join())

const people = await openPicker('Add a person to review')
check('anyone who may log in can be reviewed, but not HR themselves',
  people.some((p) => p.includes('Amna Khan')) && people.some((p) => p.includes('Sara Iqbal')) &&
    !people.some((p) => p.includes('Bilal Ahmed')) && !people.some((p) => p.includes('Omar Farooq')), people.join())
await click(options().find((o) => o.textContent?.includes('Amna Khan')))
const amna = () => section('Amna Khan')
check('a picked person waits for a reviewer, unsaved', !!amna() && amna()!.textContent!.includes('Add at least one reviewer') &&
  !captured.inserts.some((i) => i.table === 'peer_review_assignments'))
const reviewers = await openPicker('Add reviewer', amna()!)
check('…who can’t review themselves', !reviewers.some((p) => p.includes('Amna Khan')) && reviewers.some((p) => p.includes('Sara Iqbal')),
  reviewers.join())
await click(options().find((o) => o.textContent?.includes('Sara Iqbal')))
check('adding a reviewer saves who reviews whom',
  insertsOf('peer_review_assignments').join() === JSON.stringify([{ cycle_id: cycleId, subject_id: 'e-amna', reviewer_id: 'e-sara' }]),
  insertsOf('peer_review_assignments').join())
check('…and shows them as to do', await waitFor(() => amna()!.textContent!.includes('Sara Iqbal · To do')), amna()?.textContent)

await click(button('Open cycle'))
check('opening asks first, saying the questions then lock', dialog()!.textContent!.includes("The questions can't change after this"))
failNext('rpc.peer_cycle_open', { code: '23514', message: 'A cycle needs 3 to 5 questions; this one has 6.' })
await click(button('Open', dialog()!))
check('the database’s refusal is shown', text().includes('A cycle needs 3 to 5 questions; this one has 6.'))
await click(button('Open cycle'))
await click(button('Open', dialog()!))
check('opening goes through peer_cycle_open', rpcArgs('peer_cycle_open').at(-1) === JSON.stringify({ p_cycle_id: cycleId }))
check('…after which the questions can’t be changed, but reviewers can still be added',
  await waitFor(() => text().includes('Open') && !button('Delete Shares knowledge with the team.')) &&
    !field('New question') && !!field('Add reviewer', amna()!) && !!button('Close cycle'))

// ============================== the reviewer ==============================
reset()
signInAs(PEOPLE.hr)
// Q2 as above, opened, with Sara reviewing Amna.
table('peer_review_cycles').push({
  id: 'pc-q2', year: 2026, quarter: 2, status: 'open', due_date: '2026-06-20', created_by: 'e-bilal',
  created_at: '2026-06-01T09:00:00Z', opened_at: '2026-06-02T09:00:00Z', closed_at: null, updated_at: '2026-06-02T09:00:00Z',
})
const PROMPTS = ['Collaborates well.', 'Communicates clearly.', 'Delivers reliable work.']
PROMPTS.forEach((prompt, i) => table('peer_review_questions').push({ id: `q2-${i}`, cycle_id: 'pc-q2', prompt, sort_order: i }))
table('peer_review_assignments').push({
  id: 'pa-q2', cycle_id: 'pc-q2', subject_id: 'e-amna', reviewer_id: 'e-sara', open_feedback: null,
  created_at: '2026-06-02T09:00:00Z', submitted_at: null,
})
PROMPTS.forEach((_, i) => table('peer_review_answers').push({ id: `a2-${i}`, assignment_id: 'pa-q2', question_id: `q2-${i}`, rating: null, comment: null }))
signInAs(PEOPLE.member)

await mountApp('/dashboard')
check('the reviewer is reminded of peer reviews to write', await waitFor(() => text().includes('1 peer review to write, due by Jun 20, 2026.')),
  text().slice(0, 400))
await mountApp('/performance')
check('a reviewer gets a Peer reviews tab', await waitFor(() => tabLabels() === 'Me,Peer reviews'), tabLabels())
await click(tab('Peer reviews'))
check('…listing who they review, the quarter, due date and state',
  location.search === '?tab=peer' && text().includes('Amna Khan') && text().includes('Q2 2026') && text().includes('Jun 20, 2026') &&
    text().includes('To do'), text())
await click(button('Write'))
check('the form opens', location.pathname === '/performance/peer/pa-q2' &&
  await waitFor(() => text().includes('Peer review of Amna Khan')), location.pathname)
check('…saying who reads it, and how',
  text().includes('Amna reads your answers without your name once the cycle closes') && text().includes('HR sees them with your name'))

await click(button('Submit'))
check('every question must be rated first', text().includes('Rate every question before submitting.') && !dialog() &&
  !captured.rpcs.some((r) => r.name === 'peer_review_submit'))
for (const [i, prompt] of PROMPTS.entries()) await click(button(String(4 - (i % 2)), section(prompt)!))
await type('Comment', 'Unblocks everyone', section('Collaborates well.')!)
await type('Anything else', 'A great mentor.')
await click(button('Save draft'))
check('saving writes each rating and comment',
  captured.updates.filter((u) => u.table === 'peer_review_answers').map((u) => JSON.stringify(u.values)).join() ===
    [{ rating: 4, comment: 'Unblocks everyone' }, { rating: 3, comment: null }, { rating: 4, comment: null }]
      .map((v) => JSON.stringify(v)).join(),
  JSON.stringify(captured.updates.filter((u) => u.table === 'peer_review_answers')))
check('…and the open feedback', JSON.stringify(captured.updates.find((u) => u.table === 'peer_review_assignments')?.values) ===
  JSON.stringify({ open_feedback: 'A great mentor.' }) && text().includes('Draft saved.'))
await click(button('Submit'))
check('submitting asks first, saying it is final', dialog()!.textContent!.includes("Once submitted it can't be changed"))
await click(button('Submit', dialog()!))
check('submitting goes through peer_review_submit', rpcArgs('peer_review_submit').join() === JSON.stringify({ p_assignment_id: 'pa-q2' }))
check('…and the form turns read-only', await waitFor(() => text().includes("it can't be changed") && !dialog()) &&
  !button('Save draft') && !button('Submit', document.querySelector('main')!), text().slice(0, 600))

// ============================== HR reads and closes ==============================
signInAs(PEOPLE.hr)
await mountApp('/performance/cycles/pc-q2')
check('HR sees each reviewer’s state', await waitFor(() => !!section('Amna Khan')) &&
  section('Amna Khan')!.textContent!.includes('Sara Iqbal · Submitted') && section('Amna Khan')!.textContent!.includes('1 of 1 submitted'),
  section('Amna Khan')?.textContent)
await click(button('Show responses (1)', section('Amna Khan')!))
check('…and every response, with the reviewer’s name',
  section('Amna Khan')!.textContent!.includes('Sara Iqbal (4): Unblocks everyone') &&
    section('Amna Khan')!.textContent!.includes('Sara Iqbal: A great mentor.') &&
    section('Amna Khan')!.textContent!.includes('Communicates clearly.3.0 / 5'), section('Amna Khan')?.textContent)
check('…and can’t remove a submitted reviewer', !section('Amna Khan')!.querySelector('.MuiChip-deleteIcon'))
await click(button('Close cycle'))
check('closing asks first, saying what the subjects then see', dialog()!.textContent!.includes('if at least two reviewers submitted'))
await click(button('Close', dialog()!))
check('closing goes through peer_cycle_close', rpcArgs('peer_cycle_close').join() === JSON.stringify({ p_cycle_id: 'pc-q2' }))
check('…after which nothing can be added', await waitFor(() => text().includes('Closed')) && !field('Add a person to review') &&
  !field('Add reviewer', section('Amna Khan')!))

done()
