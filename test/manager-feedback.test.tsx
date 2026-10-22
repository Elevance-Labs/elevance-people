// Feedback on one's manager: the quarter's window (lib mirrors of the SQL),
// an employee starting, saving and submitting theirs, and HR's tab — who owes
// it, each manager's averages with names, and the questions. The database
// decides who may do what (manager_feedback_* RPCs, triggers, RLS); these
// checks prove the app asks for the right things.
import {
  setupDom, reporter, text, button, click, type, choose, dialog, field, row, waitFor, freezeToday,
} from './setup'
setupDom()
// The first week of June: Q2's feedback is open, due on the 10th.
freezeToday('2026-06-05')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, PEOPLE } = await import('./mockSupabase')
const mf = await import('../src/lib/managerFeedback')

const { check, done } = reporter()

const rpcArgs = (name: string) => captured.rpcs.filter((r) => r.name === name).map((r) => JSON.stringify(r.args))
const section = (name: string) => document.querySelector<HTMLElement>(`main section[aria-label="${name}"]`)
const tabLabels = () => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent).join()

// ============================== the window ==============================
check('a quarter’s window is its last month: opens the 1st, due the 10th, closes the last day',
  JSON.stringify(mf.feedbackWindow(2026, 2)) ===
    JSON.stringify({ year: 2026, quarter: 2, opens: '2026-06-01', due: '2026-06-10', closes: '2026-06-30' }) &&
    mf.feedbackWindow(2026, 4).closes === '2026-12-31' && mf.feedbackWindow(2026, 1).closes === '2026-03-31')
check('it is open only in that month',
  mf.isOpen(mf.windowOf('2026-06-30'), '2026-06-30') && !mf.isOpen(mf.windowOf('2026-05-31'), '2026-05-31'))
const q2 = mf.feedbackWindow(2026, 2)
check('a form is to do, then overdue after the 10th, then missed once the quarter ends',
  mf.feedbackState(null, q2, '2026-06-10') === 'to_do' && mf.feedbackState(null, q2, '2026-06-11') === 'overdue' &&
    mf.feedbackState({ submitted_at: null, late: false }, q2, '2026-07-01') === 'missed' &&
    mf.feedbackState({ submitted_at: 'x', late: true }, q2, '2026-07-01') === 'submitted_late')
check('before it opens, the window to come is this quarter’s', mf.upcomingWindow('2026-05-20').opens === '2026-06-01')
check('HR looks back over the last four quarters',
  mf.recentQuarters(4, '2026-06-05').map(mf.quarterName).join() === 'Q2 2026,Q1 2026,Q4 2025,Q3 2025')

// ============================== the employee ==============================
reset()
signInAs(PEOPLE.member) // Sara, who reports to Amna
await mountApp('/dashboard')
check('the dashboard reminds the employee while the window is open',
  await waitFor(() => text().includes('Your Q2 2026 feedback on your manager is due by Jun 10, 2026.')), text().slice(0, 500))

await mountApp('/performance')
const card = () => section('Feedback on your manager')
check('their Performance page says it’s due, on whom, and who reads it',
  await waitFor(() => !!card()) && card()!.textContent!.includes('Your Q2 2026 feedback on Amna Khan is due Jun 10, 2026. Only HR reads it.'),
  card()?.textContent)
check('…and no member gets HR’s Manager feedback tab', !tabLabels().includes('Manager feedback'), tabLabels())
await click(button('Give feedback', card()!))
const starts = captured.rpcs.filter((r) => r.name === 'manager_feedback_start')
check('starting goes through manager_feedback_start, with nothing to choose',
  starts.length === 1 && starts[0].args === undefined, JSON.stringify(starts))
check('…and opens the form', await waitFor(() => location.pathname.startsWith('/performance/manager-feedback/new-')), location.pathname)
const formId = location.pathname.split('/').at(-1)!
check('the form has HR’s questions and says only HR reads it',
  await waitFor(() => !!section('Gives me clear goals and priorities.')) &&
    !!section('Supports my growth and career development.') &&
    text().includes('Only HR reads this, with your name. Amna Khan never sees it.'), text().slice(0, 600))

await click(button('Submit'))
check('every question must be rated first', text().includes('Rate every question before submitting.') && !dialog() &&
  !captured.rpcs.some((r) => r.name === 'manager_feedback_submit'))
const PROMPTS = ['Gives me clear goals and priorities.', 'Gives me useful, timely feedback.',
  'Is available and supportive when I need help.', 'Recognises my work and treats me fairly.',
  'Supports my growth and career development.']
for (const [i, prompt] of PROMPTS.entries()) await click(button(String(5 - (i % 3)), section(prompt)!))
await type('Your feedback', 'More 1:1 time would help.')
await click(button('Save draft'))
check('saving writes each rating',
  captured.updates.filter((u) => u.table === 'manager_feedback_answers').map((u) => JSON.stringify(u.values)).join() ===
    [5, 4, 3, 5, 4].map((rating) => JSON.stringify({ rating })).join(),
  JSON.stringify(captured.updates.filter((u) => u.table === 'manager_feedback_answers')))
check('…and the feedback text', JSON.stringify(captured.updates.find((u) => u.table === 'manager_feedback')) ===
  JSON.stringify({ table: 'manager_feedback', values: { body: 'More 1:1 time would help.' }, filters: [['id', 'eq', formId]] }))
await click(button('Submit'))
check('submitting asks first, saying it is final and the manager never sees it',
  dialog()!.textContent!.includes("Once submitted it can't be changed") && dialog()!.textContent!.includes('Amna Khan never sees it'))
await click(button('Submit', dialog()!))
check('submitting goes through manager_feedback_submit', rpcArgs('manager_feedback_submit').join() === JSON.stringify({ p_feedback_id: formId }))
check('…and the form turns read-only', await waitFor(() => text().includes("it can't be changed") && !dialog()) &&
  !button('Save draft') && !button('Submit', document.querySelector('main')!))

await mountApp('/performance')
check('afterwards their page says it’s in', await waitFor(() => !!card()) && card()!.textContent!.includes('is in. Thank you.') &&
  !!button('View', card()!))
await mountApp('/dashboard')
check('…and the dashboard stops reminding them', await waitFor(() => text().includes('Welcome')) &&
  !text().includes('feedback on your manager is due'))

// ============================== HR ==============================
reset()
signInAs(PEOPLE.hr) // Bilal: HR, with no manager of his own
await mountApp('/performance')
check('someone without a manager owes none', await waitFor(() => text().includes('Reviews')) && !card())

await mountApp('/performance?tab=manager')
check('HR has a Manager feedback tab', tabLabels().endsWith('Manager feedback'), tabLabels())
check('…listing this quarter’s, asked of the database',
  rpcArgs('manager_feedback_due').at(-1) === JSON.stringify({ p_year: 2026, p_quarter: 2 }) &&
    await waitFor(() => !!row('Sara Iqbal')) && row('Sara Iqbal')!.textContent!.includes('Amna Khan') &&
    row('Sara Iqbal')!.textContent!.includes('To do'), row('Sara Iqbal')?.textContent)
await choose('Quarter', 'Q1 2026')
check('an earlier quarter can be picked', rpcArgs('manager_feedback_due').at(-1) === JSON.stringify({ p_year: 2026, p_quarter: 1 }) &&
  await waitFor(() => row('Sara Iqbal')?.textContent?.includes('Submitted')), row('Sara Iqbal')?.textContent)
const amna = () => section('Amna Khan')
check('each manager’s averages, and every response with who wrote it',
  !!amna() && amna()!.textContent!.includes('Amna Khan · 1 response') &&
    amna()!.textContent!.includes('Gives me clear goals and priorities.5.0 / 5') &&
    amna()!.textContent!.includes('Sara Iqbal: Clear priorities every sprint.'), amna()?.textContent)
await click(row('Sara Iqbal'))
check('a submitted form opens, read-only for HR', location.pathname === '/performance/manager-feedback/mf-q1' &&
  await waitFor(() => text().includes("Sara Iqbal's feedback on Amna Khan")) && !button('Save draft'), text().slice(0, 300))

await mountApp('/performance?tab=manager')
const questions = () => section('Questions')!
check('HR keeps the questions: five, so none can be added', await waitFor(() => questions().querySelectorAll('li').length === 5) &&
  !field('New question', questions()))
await click(button('Delete Supports my growth and career development.', questions()))
check('deleting one deletes it', JSON.stringify(captured.deletes.find((d) => d.table === 'manager_feedback_questions')?.filters) ===
  JSON.stringify([['id', 'eq', 'mq-5']]))
await type('New question', '  Shares context on decisions.  ', questions())
await click(button('Add', questions()))
check('…and a new one can then be added, trimmed',
  JSON.stringify(captured.inserts.find((i) => i.table === 'manager_feedback_questions')?.rows) ===
    JSON.stringify([{ prompt: 'Shares context on decisions.' }]))

reset()
signInAs(PEOPLE.companyAdmin) // Amna: HR, and Sara's manager
await mountApp('/performance?tab=manager')
await waitFor(() => !captured.rpcs.every((r) => r.name !== 'manager_feedback_due'))
check('HR who manage people don’t see who owes feedback about them', await waitFor(() => !!section('Questions')) && !row('Sara Iqbal'))

done()
