// Performance: monthly reviews. The lib's mirrors of the SQL rules (goal,
// score, state), an employee's own report and acknowledging a review, a
// manager starting, saving and submitting one (final once submitted), HR's
// People tab, feedback from HR,
// the dashboard's reminders, and the company admins' Expectations page. The
// database decides who may do what (review_* RPCs, RLS, column grants); these
// checks prove the app asks for the right things.
import {
  setupDom, reporter, text, button, click, type, choose, dialog, row, waitFor, freezeToday, settle,
} from './setup'
setupDom()
// The first week of June: the 1:1s reviewing May are due by the 10th.
freezeToday('2026-06-05')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE } = await import('./mockSupabase')
const perf = await import('../src/lib/performance')

const { check, done } = reporter()

const rpcArgs = (name: string) => captured.rpcs.filter((r) => r.name === name).map((r) => JSON.stringify(r.args))
const section = (name: string) => document.querySelector<HTMLElement>(`main section[aria-label="${name}"]`)
const tabLabels = () => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent).join()
const updatesOf = (t: string) => captured.updates.filter((u) => u.table === t)

// ============================== the rules, mirrored ==============================
const others = table('performance_reviews') as unknown as Parameters<typeof perf.goalPlan>[1]
check('the cycle is last month, due on the 10th of this one',
  perf.currentCycle() === '2026-05-01' && perf.dueDateOf('2026-05-01') === '2026-06-10' &&
  perf.dueDateOf('2026-12-01') === '2027-01-10', perf.currentCycle())
check('a review sets the goal of the quarter it is held in',
  perf.goalQuarterOf('2026-03-01') === '2026-04-01' && perf.goalQuarterOf('2026-05-01') === '2026-04-01' &&
  perf.goalQuarterOf('2026-12-01') === '2027-01-01')
check('mid-quarter, a review rates the quarter’s goal and sets none',
  JSON.stringify(perf.goalPlan({ id: 'x', period: '2026-05-01' }, others)) ===
    JSON.stringify({ rated: { goal: 'Ship the onboarding flow', quarter: 'Q2 2026' }, sets: null }),
  JSON.stringify(perf.goalPlan({ id: 'x', period: '2026-05-01' }, others)))
check('at a quarter’s end, it rates the outgoing goal and sets the next',
  JSON.stringify(perf.goalPlan({ id: 'x', period: '2026-06-01' }, others)) ===
    JSON.stringify({ rated: { goal: 'Ship the onboarding flow', quarter: 'Q2 2026' }, sets: 'Q3 2026' }))
check('with no goal yet (a new joiner), it rates nothing and sets this quarter’s',
  JSON.stringify(perf.goalPlan({ id: 'x', period: '2026-05-01' }, [])) === JSON.stringify({ rated: null, sets: 'Q2 2026' }))
check('a draft or the review itself never counts as setting a goal',
  perf.goalPlan({ id: 'r-mar', period: '2026-03-01' }, others).sets === 'Q2 2026' &&
  perf.goalPlan({ id: 'x', period: '2026-05-01' }, [{ id: 'd', period: '2026-03-01', status: 'draft', goal_set: 'G' }]).rated === null)
check('the overall score is weighted by the KPI weights',
  perf.overallScore([{ rating: 4, weight: 40 }, { rating: 3, weight: 60 }]) === 3.4)
check('…and a plain average when a weight is missing',
  perf.overallScore([{ rating: 4, weight: 40 }, { rating: 3, weight: null }]) === 3.5 &&
  perf.overallScore([{ rating: null, weight: 40 }]) === null)
check('where a review stands, before and after its due date',
  perf.reviewState({ status: null, due_date: '2026-06-10', late: null }, '2026-06-10') === 'not_started' &&
  perf.reviewState({ status: null, due_date: '2026-06-10', late: null }, '2026-06-11') === 'overdue' &&
  perf.reviewState({ status: 'draft', due_date: '2026-06-10', late: false }, '2026-06-11') === 'draft_overdue' &&
  perf.reviewState({ status: 'submitted', due_date: '2026-06-10', late: true }, '2026-06-01') === 'submitted_late')

// ============================== an employee's own reviews ==============================
reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
check('the dashboard says a review is ready to read', text().includes('Your April 2026 review is ready to read.'), text().slice(0, 400))
check('…and a member, who manages no one, isn’t asked for the reviews due',
  !captured.rpcs.some((r) => r.name === 'performance_due'))

await mountApp('/performance')
check('a member sees only their own performance, without tabs', !tabLabels() && text().includes('Performance'), tabLabels())
const mine = captured.selects.find((s) => s.table === 'performance_reviews' && s.columns.includes('performance_review_kpis'))
check('…reading only their submitted reviews, with their lines',
  JSON.stringify(mine?.filters) === JSON.stringify([['employee_id', 'eq', 'e-sara'], ['status', 'eq', 'submitted']]),
  JSON.stringify(mine))
check('the latest month leads: overall by weight, its change, expectations met and the goal',
  text().includes('Overall, April 2026') && text().includes('2.4 / 5') && text().includes('−1.0 on March 2026') &&
  text().includes('50%') && text().includes('1 of 2 in April 2026') && text().includes('Goal, Q2 2026') &&
  text().includes('6 / 10') && text().includes('Ship the onboarding flow'), text())
check('the overall score is charted by month', !!section('Overall score')?.querySelector('svg[role="img"]') &&
  section('Overall score')!.querySelectorAll('g[role="button"]').length === 2)
const byMonth = section('By month')
check('…and every rating is tabulated month by month',
  !!byMonth && [...byMonth.querySelectorAll('tbody tr')].map((r) => r.textContent).join('|') ===
    'Overall3.42.4|Code review turnaround43|Escaped defects32|Joins standup|Updates tickets daily|Goal progress—6/10',
  [...(byMonth?.querySelectorAll('tbody tr') ?? [])].map((r) => r.textContent).join('|'))
check('…with not-met expectations shown as such',
  !!byMonth?.querySelector('[aria-label="Not met"]') && byMonth.querySelectorAll('[aria-label="Met"]').length === 3)
check('an unacknowledged review is called out', text().includes('A review is waiting for you to read and acknowledge.'))

await click([...document.querySelectorAll('main a')].find((a) => a.textContent?.startsWith('April 2026')))
check('a review opens on its own page', location.pathname === '/performance/reviews/r-apr', location.pathname)
check('…read-only for the employee, late and not yet acknowledged',
  await waitFor(() => text().includes('Your April 2026 review')) && !button('Submit review') && !button('Save draft') &&
    text().includes('Submitted by Amna Khan') && text().includes('after the due date') && text().includes('Missed three') &&
    text().includes('Progress 6 / 10'), text().slice(0, 600))
check('…with no way to reopen it', !button('Reopen'))
await click(button('Acknowledge'))
check('acknowledging goes through review_acknowledge', rpcArgs('review_acknowledge').join() === JSON.stringify({ p_review_id: 'r-apr' }),
  rpcArgs('review_acknowledge').join())
check('…and then says so', await waitFor(() => text().includes('Acknowledged on')) && !button('Acknowledge'))

// ============================== a manager's review ==============================
reset()
signInAs(PEOPLE.companyAdmin) // Amna: Sara's manager in the org chart
await mountApp('/dashboard')
check('a manager is reminded of the reviews due', await waitFor(() => text().includes('1 monthly review of May 2026 to submit by Jun 10, 2026.')),
  text().slice(0, 400))
check('…asked of the database for last month',
  rpcArgs('performance_due').join() === JSON.stringify({ p_period: '2026-05-01' }), rpcArgs('performance_due').join())

await mountApp('/performance?tab=team')
check('a manager who is also HR gets Me, My team and People (and the peer review tabs)',
  tabLabels() === 'Me,My team,Peer reviews,People,Peer cycles', tabLabels())
check('My team lists only their own reports, with last month’s state',
  !!row('Sara Iqbal') && !row('Bilal Ahmed') && row('Sara Iqbal')!.textContent!.includes('Not started') &&
    text().includes('Due Jun 10, 2026 · 0 of 1 submitted'), text())
await click(button('Start review', row('Sara Iqbal')))
check('starting goes through review_start for that month',
  rpcArgs('review_start').join() === JSON.stringify({ p_employee_id: 'e-sara', p_period: '2026-05-01' }),
  rpcArgs('review_start').join())
check('…and opens the new draft', await waitFor(() => location.pathname.startsWith('/performance/reviews/new-')), location.pathname)
const reviewId = location.pathname.split('/').at(-1)!
check('the form has the designation’s KPIs and expectations, copied in',
  await waitFor(() => !!section('Code review turnaround')) && !!section('Escaped defects') &&
    !!section('Joins standup') && !!section('Updates tickets daily'), text().slice(0, 500))
check('mid-quarter, it rates progress on the Q2 goal and sets no new one',
  text().includes('Q2 2026 goal') && text().includes('Ship the onboarding flow') && !text().includes('Goal for '), text())

await click(button('Submit review'))
check('submitting an empty draft lists what is missing, without asking the database',
  text().includes('Rate every KPI.') && text().includes('Mark every expectation met or not met.') &&
    text().includes('Write the evaluation.') && text().includes('Rate progress on the goal out of 10.') &&
    !captured.rpcs.some((r) => r.name === 'review_submit'), text())

await click(button('4', section('Code review turnaround')!))
await click(button('2', section('Escaped defects')!))
check('a rating of 2 asks for a note', section('Escaped defects')!.textContent!.includes('Needed for a rating of 1 or 2'))
await click(button('Met', section('Joins standup')!))
await click(button('Not met', section('Updates tickets daily')!))
await type('Note', 'Twice behind', section('Updates tickets daily')!)
await choose('Progress', '7 / 10')
await type('Evaluation', 'Solid month.')
await type('Feedback', 'Keep pairing.')
await click(button('Save draft'))
check('saving writes the draft’s text and its progress',
  JSON.stringify(updatesOf('performance_reviews').at(-1)) === JSON.stringify({
    table: 'performance_reviews',
    values: { evaluation: 'Solid month.', feedback: 'Keep pairing.', goal_set: null, goal_progress: 7 },
    filters: [['id', 'eq', reviewId]],
  }), JSON.stringify(updatesOf('performance_reviews')))
check('…each rating and its note',
  updatesOf('performance_review_kpis').map((u) => JSON.stringify(u.values)).sort().join() ===
    [{ rating: 2, note: null }, { rating: 4, note: null }].map((v) => JSON.stringify(v)).sort().join(),
  JSON.stringify(updatesOf('performance_review_kpis')))
check('…and each expectation',
  updatesOf('performance_review_expectations').map((u) => JSON.stringify(u.values)).sort().join() ===
    [{ met: true, note: null }, { met: false, note: 'Twice behind' }].map((v) => JSON.stringify(v)).sort().join(),
  JSON.stringify(updatesOf('performance_review_expectations')))
check('…and says it saved', text().includes('Draft saved.') && (button('Save draft') as HTMLButtonElement).disabled)
const writesSoFar = captured.updates.length
await click(button('Save draft'))
check('with nothing changed, nothing is written again', captured.updates.length === writesSoFar)

await click(button('Submit review'))
check('a 2 with no note still stops the submit', text().includes('Add a note to every KPI rated 1 or 2.') &&
  !captured.rpcs.some((r) => r.name === 'review_submit'))
await type('Note', 'Two escaped bugs', section('Escaped defects')!)
await click(button('Submit review'))
check('a complete draft asks for confirmation first, saying it is final',
  !!dialog() && dialog()!.textContent!.includes('Submit this review?') &&
    dialog()!.textContent!.includes("can't be changed or reopened") && !captured.rpcs.some((r) => r.name === 'review_submit'),
  dialog()?.textContent)
await click(button('Cancel', dialog()!))
check('…and cancelling submits nothing', await waitFor(() => !dialog()) && !captured.rpcs.some((r) => r.name === 'review_submit'))
failNext('rpc.review_submit', { message: 'Submit the April 2026 review first.' })
await click(button('Submit review'))
await click(button('Submit', dialog()!))
check('the database’s refusal is shown', text().includes('Submit the April 2026 review first.'))
check('…after the pending note was saved first',
  JSON.stringify(updatesOf('performance_review_kpis').at(-1)?.values) === JSON.stringify({ rating: 2, note: 'Two escaped bugs' }) &&
  captured.calls.lastIndexOf('performance_review_kpis.update') < captured.calls.lastIndexOf('rpc.review_submit'))
await click(button('Submit review'))
await click(button('Submit', dialog()!))
check('submitting goes through review_submit', rpcArgs('review_submit').at(-1) === JSON.stringify({ p_review_id: reviewId }))
check('…and the review turns read-only, submitted',
  await waitFor(() => text().includes('Submitted by Amna Khan')) && !button('Submit review') &&
    text().includes('Sara Iqbal can now read it.'), text().slice(0, 500))

// ============================== HR ==============================
reset()
signInAs(PEOPLE.hr) // Bilal: HR, manages no one
await mountApp('/performance?tab=people')
check('HR without reports gets Me and People (and the peer review tabs)',
  tabLabels() === 'Me,Peer reviews,People,Peer cycles', tabLabels())
check('People lists everyone due a review, with their manager',
  row('Sara Iqbal')!.textContent!.includes('Amna Khan') && row('Sara Iqbal')!.textContent!.includes('Not started') &&
    row('Bilal Ahmed')!.textContent!.includes('No manager') && !row('Omar Farooq'), text())
check('…and how many have no manager to review them', text().includes('2 without a manager'))
await choose('Month reviewed', 'April 2026')
check('another month can be picked', rpcArgs('performance_due').at(-1) === JSON.stringify({ p_period: '2026-04-01' }) &&
  row('Sara Iqbal')!.textContent!.includes('Submitted late'), row('Sara Iqbal')?.textContent)
await click(row('Sara Iqbal'))
check('a person opens to their performance', location.pathname === '/performance/people/e-sara' &&
  await waitFor(() => text().includes('Overall, April 2026')) && text().includes('Software Engineer'), location.pathname)

await mountApp('/performance/reviews/r-apr')
check('HR reads a submitted review but can neither change nor reopen it',
  await waitFor(() => text().includes('Submitted by Amna Khan')) && !button('Reopen') && !button('Save draft') &&
    !button('Submit review') && !button('Acknowledge'))

// ============================== private notes ==============================
const notes = () => section('Private notes')
const noteBox = () => notes()?.querySelector<HTMLTextAreaElement>('textarea:not([aria-hidden])') ?? null
const noteStatus = () => notes()?.querySelector('[role="status"]')?.textContent
const leaveNoteBox = async () => {
  noteBox()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  await settle()
  await waitFor(() => !noteStatus()?.startsWith('Saving'))
}

// Amna has no note on Sara yet: the first save starts it.
reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/performance/reviews/r-apr')
check('the manager has a private note beside a review, said to be theirs alone',
  await waitFor(() => !!noteBox()) && notes()!.textContent!.includes('Only you can see this') &&
    noteBox()!.value === '' && noteStatus() === 'Saves when you click away', notes()?.textContent)
const noteRead = captured.selects.find((s) => s.table === 'manager_notes')
check('…read as one note about that person', JSON.stringify(noteRead?.filters) === JSON.stringify([['employee_id', 'eq', 'e-sara']]),
  JSON.stringify(noteRead))
await type('Your notes', '- Late to two standups', notes()!)
check('typing marks it unsaved, without writing yet', noteStatus() === 'Unsaved changes' &&
  !captured.inserts.some((i) => i.table === 'manager_notes'))
await leaveNoteBox()
check('clicking away starts the note: who it is about and the text, never an author',
  JSON.stringify(captured.inserts.filter((i) => i.table === 'manager_notes').map((i) => i.rows)) ===
    JSON.stringify([[{ employee_id: 'e-sara', body: '- Late to two standups' }]]) &&
    noteStatus()!.startsWith('Saved '), JSON.stringify(captured.inserts))

await type('Your notes', '- Late to two standups\n- Great review of the API PR', notes()!)
await click(button('Save', notes()!))
const noteId = table('manager_notes')[0].id
check('later saves change that note’s text, by id',
  JSON.stringify(updatesOf('manager_notes')) === JSON.stringify([{
    table: 'manager_notes', values: { body: '- Late to two standups\n- Great review of the API PR' },
    filters: [['id', 'eq', noteId]],
  }]) && captured.inserts.filter((i) => i.table === 'manager_notes').length === 1, JSON.stringify(updatesOf('manager_notes')))
const writes = captured.calls.length
await leaveNoteBox()
check('nothing is written when nothing changed', captured.calls.length === writes)

await type('Your notes', 'x'.repeat(5), notes()!)
failNext('manager_notes.update', { code: '42501', message: 'new row violates row-level security policy for table "manager_notes"' })
await leaveNoteBox()
check('a refused save is explained and the text kept', notes()!.textContent!.includes('only keep notes about your direct reports') &&
  noteBox()!.value === 'xxxxx' && noteStatus() === 'Unsaved changes')

await mountApp('/performance/people/e-sara')
check('the same note is on the person’s page, for their manager',
  await waitFor(() => noteBox()?.value === '- Late to two standups\n- Great review of the API PR'), noteBox()?.value)
await mountApp('/performance?tab=team')
check('My team marks who they have notes about', row('Sara Iqbal')!.textContent!.includes('Has private notes'),
  row('Sara Iqbal')?.textContent)
check('…asking only for notes with something in them',
  JSON.stringify(captured.selects.filter((s) => s.table === 'manager_notes').at(-1)?.filters) === JSON.stringify([['body', 'neq', '']]))

reset()
signInAs(PEOPLE.member)
await mountApp('/performance/reviews/r-apr')
await waitFor(() => text().includes('Your April 2026 review'))
check('the employee never gets private notes, nor asks for them', !notes() && !captured.reads.includes('manager_notes'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/performance/people/e-sara')
await waitFor(() => text().includes('Overall, April 2026'))
check('nor does HR, who isn’t their manager', !notes() && !captured.reads.includes('manager_notes'))
await mountApp('/performance/reviews/r-apr')
await waitFor(() => text().includes('Submitted by Amna Khan'))
check('…on a review either', !notes() && !captured.reads.includes('manager_notes'))

// ============================== feedback from HR ==============================
const feedback = () => section('Feedback from HR')

reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
check('the dashboard tells the employee about new feedback from HR', await waitFor(() => text().includes('You have new feedback from HR.')))
const feedbackRead = captured.selects.find((s) => s.table === 'hr_feedback')
check('…asking only for their own, not yet acknowledged',
  JSON.stringify(feedbackRead?.filters) === JSON.stringify([['employee_id', 'eq', 'e-sara'], ['acknowledged_at', 'is', null]]),
  JSON.stringify(feedbackRead))

await mountApp('/performance')
check('the employee reads HR’s feedback on their own page, with its label, author and date',
  await waitFor(() => !!feedback()?.textContent?.includes('Thanks for covering the release.')) &&
    feedback()!.textContent!.includes('Appreciation') && feedback()!.textContent!.includes('Bilal Ahmed') &&
    feedback()!.textContent!.includes('Not yet acknowledged'), feedback()?.textContent)
check('…but can’t write or delete any', !button('Write feedback') && !button('Delete feedback'))
await click(button('Acknowledge', feedback()!))
check('acknowledging goes through hr_feedback_acknowledge',
  rpcArgs('hr_feedback_acknowledge').join() === JSON.stringify({ p_feedback_id: 'f-1' }), rpcArgs('hr_feedback_acknowledge').join())
check('…and then says so', await waitFor(() => feedback()!.textContent!.includes('Acknowledged')) &&
  !button('Acknowledge', feedback()!))

reset()
signInAs(PEOPLE.hr)
await mountApp('/performance/people/e-sara')
check('HR sees the feedback sent to someone, and can write more',
  await waitFor(() => !!feedback()?.textContent?.includes('Thanks for covering the release.')) && !!button('Write feedback', feedback()!))
await click(button('Write feedback', feedback()!))
check('writing says who reads it, that their manager doesn’t, and that it can’t be edited',
  !!dialog() && dialog()!.textContent!.includes('Feedback for Sara Iqbal') &&
    dialog()!.textContent!.includes("Their manager doesn't see it") && dialog()!.textContent!.includes("can't be edited once sent"),
  dialog()?.textContent)
await click(button('Send', dialog()!))
check('empty feedback isn’t sent', !captured.inserts.some((i) => i.table === 'hr_feedback'))
await choose('Label', 'Improvement', dialog()!)
await type('Feedback', '  Share blockers in standup earlier.  ', dialog()!)
failNext('hr_feedback.insert', { code: '42501', message: 'new row violates row-level security policy for table "hr_feedback"' })
await click(button('Send', dialog()!))
check('a refusal is explained', dialog()!.textContent!.includes('Only HR can send feedback, and not to themselves.'))
await click(button('Send', dialog()!))
check('sending gives the person, the label and the trimmed text, never an author',
  JSON.stringify(captured.inserts.filter((i) => i.table === 'hr_feedback').at(-1)?.rows) ===
    JSON.stringify([{ employee_id: 'e-sara', kind: 'improvement', body: 'Share blockers in standup earlier.' }]),
  JSON.stringify(captured.inserts))
check('…and it shows, newest first', await waitFor(() => !dialog()) &&
  feedback()!.textContent!.indexOf('Share blockers') < feedback()!.textContent!.indexOf('Thanks for covering'), feedback()?.textContent)
await click(button('Delete feedback', [...feedback()!.querySelectorAll('[aria-label="Thanks for covering the release."]')][0] as HTMLElement))
await click(button('Delete', dialog()!))
check('deleting asks first, then deletes that one',
  JSON.stringify(captured.deletes.find((d) => d.table === 'hr_feedback')?.filters) === JSON.stringify([['id', 'eq', 'f-1']]) &&
    await waitFor(() => !feedback()!.textContent!.includes('Thanks for covering')))
check('sent feedback is never edited', !captured.updates.some((u) => u.table === 'hr_feedback'))

await mountApp('/performance/people/e-bilal')
await waitFor(() => text().includes('Bilal Ahmed'))
check('HR can’t write feedback to themselves', !feedback() && !button('Write feedback'))

// ============================== Expectations ==============================
reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/company/expectations')
check('company admins see each designation’s expectations',
  !!row('Updates tickets daily') && row('Joins standup')!.textContent!.includes('Software Engineer'))
await click(button('Add expectation'))
await choose('Designation', 'Engineering Lead', dialog()!)
await type('Expectation', '  Reviews the roadmap  ', dialog()!)
await click(button('Add', dialog()!))
check('adding one sends the designation and the trimmed text',
  JSON.stringify(captured.inserts.find((i) => i.table === 'expectations')?.rows) ===
    JSON.stringify([{ designation_id: 'g-lead', title: 'Reviews the roadmap' }]),
  JSON.stringify(captured.inserts))
await click(button('Add expectation'))
await choose('Designation', 'Software Engineer', dialog()!)
await type('Expectation', 'Joins standup', dialog()!)
failNext('expectations.insert', { code: '23505', message: 'duplicate key value violates unique constraint "expectations_title_key"' })
await click(button('Add', dialog()!))
check('a duplicate is explained', dialog()!.textContent!.includes('This designation already has that expectation.'))

done()
