// The Home section (dashboard, handbook, profile) and Company → Announcements.
// The database decides who reads which announcement (RLS: HR all, everyone
// else only those pinned today); these checks prove the dashboard asks only
// for pinned bodies and that HR's page sends exactly what it should.
import { setupDom, reporter, text, button, click, dialog, settle, valueOf, waitFor, freezeToday, navLabels } from './setup'
setupDom()
freezeToday('2026-06-10')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE } = await import('./mockSupabase')
const { HANDBOOK_EMBED_URL, HANDBOOK_URL } = await import('../src/lib/constants')
const { guideUrls } = await import('../src/lib/guides')

const { check, done } = reporter()

const section = (title: string) =>
  [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === title) ?? null
const articles = () => [...document.querySelectorAll('article')]
const article = (contains: string) => articles().find((a) => a.textContent?.includes(contains))

// The rich text editor in the open dialog, driven the way TipTap exposes it.
async function write(html: string) {
  const el = dialog()?.querySelector('.ProseMirror') as (Element & { editor?: { commands: { setContent(c: string): void } } }) | null
  if (!el?.editor) throw new Error('write: no editor in the dialog')
  el.editor.commands.setContent(html)
  await settle(0)
}
const pinBox = () =>
  [...(dialog()?.querySelectorAll('label') ?? [])]
    .find((l) => l.textContent?.includes('Pin to everyone'))
    ?.querySelector('input') ?? null

// ============================== dashboard ==============================
reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
check('the dashboard greets the person', text().includes('Welcome, Sara'))

const annRead = captured.selects.find((s) => s.table === 'announcements')
check('it asks only for the body of announcements pinned today',
  annRead?.columns === 'id, body' &&
  JSON.stringify(annRead.filters) === JSON.stringify([['pinned_until', 'gte', '2026-06-10']]),
  JSON.stringify(annRead))
const shown = section('Announcements')
check('only the pinned announcement shows', !!shown && shown.textContent?.includes('Office closed on Friday') &&
  !text().includes('Town hall') && !text().includes('New coffee machine'), shown?.textContent)
check('…as the body alone: no author or date',
  shown?.querySelector('.MuiPaper-root')?.textContent === 'Office closed on Friday.' &&
  !shown?.textContent?.includes('Bilal') && !shown?.textContent?.includes('2026'),
  shown?.querySelector('.MuiPaper-root')?.textContent)
check('…keeping its formatting', !!shown?.querySelector('strong'))

check('the leave balance is this year\'s, for this person',
  captured.rpcs.some((r) => r.name === 'leave_balances' &&
    JSON.stringify(r.args) === JSON.stringify({ p_employee_id: 'e-sara', p_year: 2026 })),
  JSON.stringify(captured.rpcs))
const balance = section('Leave balance 2026')
check('…shown per type', !!balance && balance.textContent?.includes('Annual') &&
  balance.textContent?.includes('2 taken · 5 pending · 14 this year'), balance?.textContent)
const leaveRead = captured.selects.find((s) => s.table === 'leaves')
check('upcoming leave is my pending and approved leave that hasn\'t ended',
  JSON.stringify(leaveRead?.filters) === JSON.stringify([
    ['employee_id', 'eq', 'e-sara'], ['status', 'in', ['pending', 'approved']], ['end_date', 'gte', '2026-06-10'],
  ]), JSON.stringify(leaveRead?.filters))
const upcoming = balance?.textContent ?? ''
check('…soonest first, without past or rejected leave',
  upcoming.indexOf('Jun 15') < upcoming.indexOf('Jul 1') && upcoming.indexOf('Jul 1') < upcoming.indexOf('Aug 3') &&
  !upcoming.includes('Mar 2') && !upcoming.includes('Feb 10'), upcoming)
check('…and links to My leaves', button('My leaves', balance!)?.getAttribute('href')?.endsWith('/leaves'))

reset()
signInAs(PEOPLE.member)
table('announcements').length = 0
table('leaves').length = 0
await mountApp('/dashboard')
check('with nothing pinned, the section says so and still offers them all',
  section('Announcements')?.textContent?.includes('Nothing pinned right now.') && !!button('View all', section('Announcements')!),
  section('Announcements')?.textContent)
check('with no leave coming up, it says so', text().includes('No upcoming leave.'))

reset()
signInAs(PEOPLE.member)
table('announcements')[0].body = '<p>Hi</p><script>alert(1)</script><img src=x onerror="alert(1)">'
await mountApp('/dashboard')
check('a stored body is sanitised when shown',
  section('Announcements')?.querySelector('.MuiPaper-root')?.textContent === 'Hi' &&
  !section('Announcements')?.querySelector('script, img'), section('Announcements')?.innerHTML)

reset()
signInAs(PEOPLE.hr)
await mountApp('/dashboard')
check('HR\'s dashboard shows pinned announcements only, too',
  text().includes('Office closed on Friday') && !text().includes('Town hall') && !text().includes('New coffee machine'))

reset()
signInAs(PEOPLE.member)
failNext('announcements.select', { message: 'network down' })
await mountApp('/dashboard')
check('a failed load says so', text().includes('network down'))

// ---------------- all announcements, in a drawer ----------------
reset()
signInAs(PEOPLE.member)
table('announcements').push({
  id: 'an-old', body: '<p>Holiday party photos.</p>', pinned_until: null,
  created_by: 'e-bilal', created_at: '2026-01-20T09:00:00Z', updated_at: '2026-01-20T09:00:00Z',
})
await mountApp('/dashboard')
check('the dashboard doesn\'t read the rest until asked',
  captured.selects.filter((s) => s.table === 'announcements').length === 1)
await click(button('View all', section('Announcements')!))
const drawer = () => document.querySelector<HTMLElement>('[aria-label="All announcements"]')
await waitFor(() => drawer()?.querySelectorAll('article').length === 3)
const allRead = captured.selects.filter((s) => s.table === 'announcements').at(-1)
check('"View all" opens a drawer that reads the last 4 months\' announcements, with no author',
  !!drawer() && allRead?.columns === 'id, body, pinned_until, created_at' &&
  JSON.stringify(allRead.filters) === JSON.stringify([['created_at', 'gte', '2026-02-10']]),
  JSON.stringify(allRead))
const drawerItems = [...(drawer()?.querySelectorAll('article') ?? [])].map((a) => a.textContent ?? '')
check('…newest first, pinned and unpinned, each with its date',
  drawerItems[0].includes('Office closed') && drawerItems[1].includes('Town hall') && drawerItems[2].includes('New coffee') &&
  drawerItems[2].includes('May 1, 2026'), drawerItems.join(' | '))
check('…marking only the one pinned today',
  drawerItems[0].includes('Pinned') && !drawerItems[1].includes('Pinned') && !drawerItems[2].includes('Pinned'),
  drawerItems.join(' | '))
check('…not older ones', !drawerItems.some((t) => t.includes('Holiday party')), drawerItems.join(' | '))
check('…without saying who wrote them', !drawerItems.some((t) => t.includes('Bilal') || t.includes('Amna')))
await click(button('Close announcements'))
check('…and closes', await waitFor(() => !drawer()))

reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
failNext('announcements.select', { message: 'drawer down' })
await click(button('View all', section('Announcements')!))
check('a failed drawer load says so', await waitFor(() => !!drawer()?.textContent?.includes('drawer down')))

// ---------------- company values ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
const sections = [...document.querySelectorAll('main section')].map((s) => s.querySelector('h2')?.textContent)
check('the values come last on the dashboard', sections.at(-1) === 'Our values', sections.join())
check('…and the working guidelines are not on it', !text().includes('Remote Work & Collaboration Guidelines'))
const values = section('Our values')!
const cards = [...values.querySelectorAll<HTMLElement>('button[aria-expanded]')]
const visible = (el: Element) => !el.closest('[aria-hidden="true"]')
const shownText = (card: Element) =>
  [...card.querySelectorAll('p, h3, span')].filter((n) => visible(n) && !n.children.length).map((n) => n.textContent).join(' ')
check('all five values show, by title',
  cards.length === 5 && ['Integrity First', 'Continuous Learning', 'Excellence in Work', 'Collaborative Spirit',
    'Customer-Focus'].every((t, i) => cards[i].querySelector('h3')?.textContent === t),
  cards.map((c) => c.querySelector('h3')?.textContent).join())
check('…closed, with the descriptions hidden',
  cards.every((c) => c.getAttribute('aria-expanded') === 'false') && !shownText(cards[0]).includes('honest communication'),
  shownText(cards[0]))
await click(cards[0])
check('tapping one opens its description',
  cards[0].getAttribute('aria-expanded') === 'true' && shownText(cards[0]).includes("We do what's right, even when no one is watching."),
  shownText(cards[0]))
check('…and leaves the others closed', cards.slice(1).every((c) => c.getAttribute('aria-expanded') === 'false'))
await click(cards[0])
check('tapping it again closes it', cards[0].getAttribute('aria-expanded') === 'false')

// ============================== resources ==============================
reset()
signInAs(PEOPLE.member)
await mountApp('/resources')
check('everyone has a Resources page, between Handbook and Profile',
  document.querySelector('main h1')?.textContent === 'Resources' &&
  navLabels().join().includes('Handbook,Resources,Profile'), navLabels().join())
const pageTabs = () => [...document.querySelectorAll('main [role="tab"]')].filter((t) => !t.closest('section'))
const pageTab = (label: string) => pageTabs().find((t) => t.textContent === label)
check('it opens on Work ethics, with a tab for my own function\'s guides only',
  pageTabs().map((t) => t.textContent).join() === 'Work ethics,Production guides' &&
  pageTab('Work ethics')?.getAttribute('aria-selected') === 'true', pageTabs().map((t) => t.textContent).join())
const guide = () => section('Remote Work & Collaboration Guidelines')!
const cheatRows = () => [...guide().querySelectorAll('article')].map((a) => a.querySelector('h4')?.textContent)
const selectedNorms = () => guide().querySelector('[role="tab"][aria-selected="true"]')?.textContent
const panel = () => guide().querySelector('[role="tabpanel"]')?.textContent ?? ''
check('the guidelines lead with focus, transparency and async clarity',
  guide().textContent?.includes('Respect for focus, transparency, and async clarity'))
check('the cheat sheet has a golden rule and an anti-pattern for each of the five tools',
  cheatRows().join() === 'Google Chat,Google Calendar,Google Docs & Workspace,Jira,Google Meet' &&
  [...guide().querySelectorAll('article')].every((a) =>
    a.textContent?.includes('Golden rule:') && a.textContent?.includes('Anti-pattern:')),
  cheatRows().join())
check('the detailed norms open on Google Chat, with its rule of thumb and examples',
  selectedNorms() === 'Google Chat' && panel().includes('Rule of thumb') &&
  panel().includes('Avoid the isolated "Hi"') && panel().includes('Do:') && panel().includes("Don't:"), panel())
check('…in four areas',
  [...guide().querySelectorAll('[role="tab"]')].map((t) => t.textContent).join() ===
    'Google Chat,Calendar & Meet,Docs & Workspace,Jira & async')

await click(button('Jira', guide()))
check('filtering by a tool shows only its cheat-sheet row', cheatRows().join() === 'Jira', cheatRows().join())
check('…marks the filter on', button('Jira', guide())?.getAttribute('aria-pressed') === 'true')
check('…and opens its detailed norms', selectedNorms() === 'Jira & async' && panel().includes('To DoIn ProgressIn ReviewDone'),
  selectedNorms())
await click(button('Meet', guide()))
check('Meet opens the Calendar & Meet norms', cheatRows().join() === 'Google Meet' && selectedNorms() === 'Calendar & Meet' &&
  panel().includes('Instant Meets for quick blockers'), selectedNorms())
await click(button('All tools', guide()))
check('All tools brings every row back, leaving the tab where it was',
  cheatRows().length === 5 && selectedNorms() === 'Calendar & Meet')
await click([...guide().querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Docs & Workspace'))
check('a tab can be picked directly; sharing names the company',
  selectedNorms() === 'Docs & Workspace' && panel().includes('Anyone in Elevance Labs with the link can comment'), panel())
await click(button('Detailed norms', guide()))
check('the jump to the norms stays on the page', location.pathname === '/resources', location.pathname)
const fnRead = captured.selects.find((s) => s.table === 'departments')
check('my function is read from my department',
  fnRead?.columns === 'business_function' && JSON.stringify(fnRead.filters) === JSON.stringify([['id', 'eq', 'd-eng']]),
  JSON.stringify(fnRead))
const guidesRead = captured.selects.find((s) => s.table === 'guides')
check('the guides are read unfiltered: the database decides which come back',
  !!guidesRead && !guidesRead.filters.length && !guidesRead.columns.includes('*'), JSON.stringify(guidesRead))

await click(pageTab('Production guides'))
const guideCards = () => [...document.querySelectorAll('main article')].map((a) => a.querySelector('h3')?.textContent)
check('my function\'s tab lists its guides in order, and is kept in the URL',
  location.search === '?tab=production' && guideCards().join() === 'Design,Engineering', guideCards().join())
check('…marked as my function', text().includes('Production guides') && text().includes('Your function'))
const card = (title: string) => [...document.querySelectorAll('main article')].find((a) => a.querySelector('h3')?.textContent === title)
check('a guide with no doc yet is coming soon, not a link',
  card('Design')?.textContent?.includes('Coming soon') && !card('Design')?.querySelector('a'))
check('…and one with a doc links to its page',
  card('Engineering')?.querySelector('a')?.getAttribute('href')?.endsWith('/resources/guides/engineering') &&
  !card('Engineering')?.textContent?.includes('Coming soon'), card('Engineering')?.innerHTML)
check('other functions\' guides are never shown', !text().includes('Sales') && !text().includes('About hr.'))
await click(pageTab('Work ethics'))
check('back to Work ethics clears the tab',
  await waitFor(() => location.search === '' && !!section('Remote Work & Collaboration Guidelines')), location.search)

reset()
signInAs(PEOPLE.member)
await mountApp('/resources?tab=growth')
check('another function\'s tab can\'t be linked to: it opens Work ethics',
  pageTab('Work ethics')?.getAttribute('aria-selected') === 'true' && !pageTab('Growth guides') && !text().includes('Sales'))

reset()
signInAs(PEOPLE.hr)
await mountApp('/resources?tab=operations')
check('HR in People Ops gets the Operations guides, linked to directly',
  pageTabs().map((t) => t.textContent).join() === 'Work ethics,Operations guides' &&
  pageTab('Operations guides')?.getAttribute('aria-selected') === 'true' && guideCards().join() === 'HR', guideCards().join())

reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/resources')
check('a company admin gets a tab per function, their own marked',
  pageTabs().map((t) => t.textContent).join() === 'Work ethics,Production,Growth,Operations' &&
  pageTab('Production')?.getAttribute('aria-label') === 'Production (your function)' &&
  !pageTab('Growth')?.getAttribute('aria-label'), pageTabs().map((t) => t.textContent).join())
await click(pageTab('Growth'))
check('…and sees the other functions\' guides', guideCards().join() === 'Sales' && !text().includes('Your function'))

reset()
signInAs(PEOPLE.member)
table('departments').find((d) => d.id === 'd-eng')!.business_function = null
await mountApp('/resources')
check('without a function, there are only the work ethics, and it says why',
  pageTabs().map((t) => t.textContent).join() === 'Work ethics' &&
  text().includes("Your department hasn't been given a business function yet"), pageTabs().map((t) => t.textContent).join())

reset()
signInAs(PEOPLE.member)
failNext('guides.select', { message: 'network down' })
await mountApp('/resources')
check('a failed load says so, and the work ethics still show',
  text().includes('network down') && !!section('Remote Work & Collaboration Guidelines'))

// ---------------- a guide ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/resources?tab=production')
await click(card('Engineering')?.querySelector('a'))
await waitFor(() => document.querySelector('main iframe'))
const guideFrame = document.querySelector('main iframe')
const guideRead = captured.selects.filter((s) => s.table === 'guides').at(-1)
check('a guide\'s page reads it by slug',
  JSON.stringify(guideRead?.filters) === JSON.stringify([['slug', 'eq', 'engineering']]), JSON.stringify(guideRead))
check('…and embeds the doc\'s read-only view',
  location.pathname === '/resources/guides/engineering' &&
  guideFrame?.getAttribute('src') === 'https://docs.google.com/document/d/abc-123_X/preview' &&
  guideFrame?.getAttribute('title') === 'Engineering', guideFrame?.getAttribute('src'))
const openDoc = button('Open in Google Docs')
check('…links to the doc in a new tab, and back to its function',
  openDoc?.getAttribute('href') === 'https://docs.google.com/document/d/abc-123_X/edit?usp=sharing' &&
  openDoc?.getAttribute('target') === '_blank' &&
  button('Resources', document.querySelector('main')!)?.getAttribute('href')?.endsWith('/resources?tab=production'))

reset()
signInAs(PEOPLE.member)
await mountApp('/resources/guides/design')
check('a guide with no doc yet sends you back to Resources', await waitFor(() => location.pathname === '/resources'), location.pathname)
reset()
signInAs(PEOPLE.member)
table('guides').length = 0
await mountApp('/resources/guides/engineering')
check('…as does one the database doesn\'t return', await waitFor(() => location.pathname === '/resources'), location.pathname)

check('a doc published to the web is framed embedded',
  JSON.stringify(guideUrls('https://docs.google.com/document/d/e/2PACX-1v/pub')) ===
    JSON.stringify({ open: 'https://docs.google.com/document/d/e/2PACX-1v/pub', embed: 'https://docs.google.com/document/d/e/2PACX-1v/pub?embedded=true' }))
check('a Sheet or Slides shared by link is framed through /preview',
  guideUrls('https://docs.google.com/spreadsheets/d/s1/edit#gid=0').embed === 'https://docs.google.com/spreadsheets/d/s1/preview' &&
  guideUrls('https://docs.google.com/presentation/d/p1/edit').embed === 'https://docs.google.com/presentation/d/p1/preview')
check('a published Sheet, or any other link, is framed as it is',
  guideUrls('https://docs.google.com/spreadsheets/d/e/2PACX/pubhtml').embed === 'https://docs.google.com/spreadsheets/d/e/2PACX/pubhtml' &&
  guideUrls('https://example.com/guide').embed === 'https://example.com/guide')

// ============================== handbook and profile ==============================
reset()
signInAs(PEOPLE.member)
await mountApp('/handbook')
const frame = document.querySelector('iframe')
check('the handbook embeds the Google Doc\'s read-only view',
  frame?.getAttribute('src') === HANDBOOK_EMBED_URL && HANDBOOK_EMBED_URL.endsWith('/preview') &&
  frame?.getAttribute('title') === 'Employee handbook', frame?.getAttribute('src'))
const open = button('Open in Google Docs')
check('…and links to the doc in a new tab',
  open?.getAttribute('href') === HANDBOOK_URL && open?.getAttribute('target') === '_blank' &&
  open?.getAttribute('rel')?.includes('noopener'), open?.outerHTML)
// Sign-in and the app bar read the org chart (am I a manager?), whether I'm on
// a hiring team, and my designation.
check('…reading nothing else from the database',
  captured.reads.every((t) => t === 'org_chart_nodes' || t === 'designations') &&
  captured.rpcs.every((r) => r.name === 'bind_employee' || r.name === 'on_hiring_team'), captured.reads.join())

// ---------------- profile ----------------
const tabs = () => [...document.querySelectorAll('[role="tab"]')]
const selectedTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent
const detail = (label: string) =>
  [...document.querySelectorAll('main dt')].find((dt) => dt.textContent === label)?.nextElementSibling?.textContent

reset()
signInAs(PEOPLE.member)
Object.assign(table('employees').find((e) => e.id === 'e-sara')!, {
  phone: '0300 1234567', cnic_number: '35202-1234567-1', cnic_expiry: '2030-05-01', dob: '1996-03-14',
  bank: 'Meezan Bank', iban: 'PK36MEZN0001234567890', emergency_contact: 'Ali Iqbal, brother\n0321 7654321',
  // Changed by HR after sign-in: the page reads the record fresh.
  designation_id: 'g-lead',
})
await mountApp('/profile')
const ownRead = captured.selects.find((s) => s.table === 'employees')
check('the profile reads my own record by id',
  JSON.stringify(ownRead?.filters) === JSON.stringify([['id', 'eq', 'e-sara']]), JSON.stringify(ownRead))
check('…naming its columns, without the login binding, access role or timestamps',
  !!ownRead && !ownRead.columns.includes('*') && !ownRead.columns.includes('user_id') &&
  !ownRead.columns.includes('app_role') && !ownRead.columns.includes('created_at'), ownRead?.columns)
check('it has Profile, Equipment, Salary and Payslips tabs, Profile first',
  tabs().map((t) => t.textContent).join() === 'Profile,Equipment,Salary,Payslips' && selectedTab() === 'Profile',
  tabs().map((t) => t.textContent).join())
// The name is the innermost heading; the number line sits right under it.
const nameHeading = [...document.querySelectorAll('main h1')].at(-1)
check('the header shows who I am, as on record now',
  nameHeading?.textContent === 'Sara Iqbal' &&
  nameHeading.nextElementSibling?.textContent === '#0003 · Engineering Lead · Engineering' &&
  text().includes('Probation'),
  document.querySelector('main')?.textContent)
check('…and my details, read from the record',
  detail('Company email') === 'sara@elevancelabs.com' && detail('Department') === 'Engineering' &&
  detail('Designation') === 'Engineering Lead' && detail('Employment type') === 'Full-time' &&
  detail('Date of joining') === 'Jan 15, 2024' &&
  detail('Phone number') === '0300 1234567' && detail('CNIC number') === '35202-1234567-1' &&
  detail('CNIC expiry') === 'May 1, 2030' && detail('Date of birth') === 'Mar 14, 1996' &&
  detail('Bank') === 'Meezan Bank' && detail('IBAN') === 'PK36MEZN0001234567890' &&
  detail('Emergency contact') === 'Ali Iqbal, brother\n0321 7654321',
  [...document.querySelectorAll('main dt')].map((dt) => `${dt.textContent}=${dt.nextElementSibling?.textContent}`).join(' | '))
check('…with a dash for what isn\'t on record, and no separation date while there is none',
  detail('Personal email') === '—' && detail('Date of separation') === undefined)
check('…and no access role', detail('Access role') === undefined && !document.querySelector('main')?.textContent?.includes('Member'))
check('it is read-only: nothing to edit or save, and it says to ask HR',
  !document.querySelector('main input, main textarea') && !button('Save changes') &&
  text().includes('ask HR to update it'))

await click(tabs().find((t) => t.textContent === 'Salary'))
check('a tab is kept in the URL', location.search === '?tab=salary' && selectedTab() === 'Salary' && !detail('IBAN'),
  location.search)
await click(tabs().find((t) => t.textContent === 'Profile'))
check('…back to Profile clears it', location.search === '' && detail('IBAN') === 'PK36MEZN0001234567890', location.search)
check('…and nothing is ever written',
  !captured.inserts.length && !captured.updates.length && !captured.deletes.length)

reset()
signInAs(PEOPLE.member)
await mountApp('/profile?tab=salary')
check('a tab can be linked to', selectedTab() === 'Salary' && text().includes('Current salary'))

reset()
signInAs(PEOPLE.member)
await mountApp('/profile?tab=nonsense')
check('an unknown tab opens Profile', selectedTab() === 'Profile' && detail('Company email') === 'sara@elevancelabs.com')

reset()
signInAs(PEOPLE.hr)
await mountApp('/profile')
check('HR sees their own record on the profile, too',
  detail('Company email') === 'bilal@elevancelabs.com' && !document.querySelector('main')?.textContent?.includes('HR Admin') &&
  JSON.stringify(captured.selects.find((s) => s.table === 'employees')?.filters) ===
    JSON.stringify([['id', 'eq', 'e-bilal']]))

reset()
signInAs(PEOPLE.member)
failNext('employees.select', { message: 'network down' })
await mountApp('/profile')
check('a failed profile load says so', text().includes('network down'))

// ============================== Company → Announcements (HR) ==============================
reset()
signInAs(PEOPLE.hr)
await mountApp('/company/announcements')
await waitFor(() => articles().length === 3)
check('HR sees every announcement, newest first',
  articles().map((a) => a.textContent).every((t, i) => t?.includes(['Office closed', 'Town hall', 'New coffee'][i])),
  articles().map((a) => a.textContent).join(' | '))
check('…with who wrote it and when', article('Office closed')?.textContent?.includes('Bilal Ahmed · Jun 8, 2026'),
  article('Office closed')?.textContent)
check('…and its pin', article('Office closed')?.textContent?.includes('Pinned until Jun 30, 2026') &&
  article('Town hall')?.textContent?.includes('Pin ended Jun 1, 2026') &&
  !article('New coffee')?.textContent?.includes('Pin'), articles().map((a) => a.textContent).join(' | '))
check('only a live pin can be unpinned',
  !!button('Unpin', article('Office closed')!) && !button('Unpin', article('Town hall')!))

// ---------------- add ----------------
await click(button('Add announcement'))
await click(button('Add', dialog()!))
check('an empty message is refused before anything is sent',
  dialog()?.textContent?.includes('Write the announcement first.') && !captured.inserts.length)

await write('<p>Payroll runs <em>early</em> this month.</p><script>alert(1)</script>')
await click(pinBox())
check('pinning offers a date, a week out by default', valueOf('Pinned until') === '2026-06-17', valueOf('Pinned until'))
await click(button('Add', dialog()!))
const added = captured.inserts.find((i) => i.table === 'announcements')?.rows[0]
check('adding sends only the sanitised body and the pin date',
  JSON.stringify(added) === JSON.stringify({ body: '<p>Payroll runs <em>early</em> this month.</p>', pinned_until: '2026-06-17' }),
  JSON.stringify(added))
check('…and lists it', await waitFor(() => !!article('Payroll runs')))

reset()
signInAs(PEOPLE.hr)
await mountApp('/company/announcements')
await waitFor(() => articles().length === 3)
await click(button('Add announcement'))
await write('<p>Welcome our new hires.</p>')
await click(button('Add', dialog()!))
check('without a pin, it is saved unpinned',
  captured.inserts.find((i) => i.table === 'announcements')?.rows[0].pinned_until === null,
  JSON.stringify(captured.inserts))

// ---------------- edit, unpin, delete ----------------
reset()
signInAs(PEOPLE.hr)
await mountApp('/company/announcements')
await waitFor(() => articles().length === 3)
await click(button('Edit', article('Town hall')!))
check('editing loads the body; an ended pin starts unticked',
  dialog()?.querySelector('.ProseMirror')?.textContent === 'Town hall at 4pm.' && pinBox()?.checked === false)
await write('<p>Town hall moved to 5pm.</p>')
await click(pinBox())
await click(button('Save', dialog()!))
const edited = captured.updates.find((u) => u.table === 'announcements')
check('saving updates it by id, with only body and pin',
  JSON.stringify(edited?.values) === JSON.stringify({ body: '<p>Town hall moved to 5pm.</p>', pinned_until: '2026-06-17' }) &&
  JSON.stringify(edited?.filters) === JSON.stringify([['id', 'eq', 'an-ended']]), JSON.stringify(edited))

reset()
signInAs(PEOPLE.hr)
await mountApp('/company/announcements')
await waitFor(() => articles().length === 3)
await click(button('Unpin', article('Office closed')!))
const unpinned = captured.updates.find((u) => u.table === 'announcements')
check('unpinning clears only the pin date',
  JSON.stringify(unpinned?.values) === JSON.stringify({ pinned_until: null }) &&
  JSON.stringify(unpinned?.filters) === JSON.stringify([['id', 'eq', 'an-pinned']]), JSON.stringify(unpinned))
check('…and the list shows it unpinned', await waitFor(() => !article('Office closed')?.textContent?.includes('Pinned')))

await click(button('Delete', article('New coffee')!))
await click(button('Delete', dialog()!))
check('deleting asks first, then deletes by id',
  JSON.stringify(captured.deletes.find((d) => d.table === 'announcements')?.filters) ===
    JSON.stringify([['id', 'eq', 'an-plain']]), JSON.stringify(captured.deletes))
check('…and it\'s gone', await waitFor(() => !article('New coffee')))

// ---------------- refused ----------------
reset()
signInAs(PEOPLE.hr)
await mountApp('/company/announcements')
await waitFor(() => articles().length === 3)
await click(button('Add announcement'))
await write('<p>Hello</p>')
failNext('announcements.insert', { code: '42501', message: 'new row violates row-level security policy' })
await click(button('Add', dialog()!))
check('a refusal is explained and the dialog stays open',
  dialog()?.textContent?.includes('Only HR can manage announcements.'), dialog()?.textContent)

done()
