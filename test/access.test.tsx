// Sign-in and who reaches what: the AuthProvider's binding step, and the
// route and nav gating in App/Layout for each role. The database enforces the
// same rules with RLS; this proves the app does not offer what it would refuse.
import { setupDom, reporter, text, button, click, type, field, dialog, navLabels, waitFor } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, authState, failNext, table, PEOPLE, FINANCE } = await import('./mockSupabase')

const { check, done } = reporter()

// ---------------- signed out ----------------
reset()
await mountApp('/employees')
check('signed out, the login page shows', text().includes('Sign in with Google'))
check('signed out, no data is read', captured.reads.length === 0, captured.reads.join())

await click(button('Sign in with Google'))
const oauth = captured.auth.find((a) => a.call === 'signInWithOAuth')?.options as
  | { provider: string; options: { queryParams: Record<string, string> } }
  | undefined
check('sign-in goes to Google', oauth?.provider === 'google', JSON.stringify(oauth))
check('the Google picker is narrowed to the company domain', oauth?.options.queryParams.hd === 'elevancelabs.com')

// ---------------- the public job page ----------------
reset()
await mountApp('/careers/j-open')
check('signed out, an open job\'s public page shows, not the login page',
  text().includes('Frontend Engineer') && text().includes('Apply for this job') && !text().includes('Sign in with Google'),
  text().slice(0, 200))
check('…and it reads only through the public functions',
  captured.reads.length === 0 && captured.rpcs.map((r) => r.name).sort().join() === 'job_posting,public_branding',
  `${captured.reads.join()} | ${captured.rpcs.map((r) => r.name).join()}`)

reset()
signInAs(PEOPLE.member)
await mountApp('/careers/j-open')
check('a signed-in employee sees the public page too, without the app shell',
  text().includes('Apply for this job') && !navLabels().length, navLabels().join())

// ---------------- a session without an employee record ----------------
reset()
signInAs(null)
await mountApp('/')
check('a session alone is not a login: bind_employee is asked', captured.rpcs.some((r) => r.name === 'bind_employee'))
check('refused, the user is signed out again', captured.auth.some((a) => a.call === 'signOut') && authState.session === null)
check('refused, the login page says why', text().includes('Sign-in refused') && text().includes('Sign in with Google'),
  text().slice(0, 200))

reset()
signInAs(PEOPLE.member)
failNext('rpc.bind_employee', { message: 'network down' })
await mountApp('/')
check('a failed check also signs out, and shows the error',
  authState.session === null && text().includes('Could not verify your account: network down'), text().slice(0, 200))

// ---------------- an OAuth error in the return URL ----------------
reset()
window.history.replaceState(null, '', '/?error_description=Signups+not+allowed')
await mountApp('/')
check('an error Supabase put in the URL is shown on the login page', text().includes('Signups not allowed'))
window.history.replaceState(null, '', '/')

// ---------------- a password login ----------------
// Someone without a company Google account: an outside address, email and password.
const OUTSIDER = { ...FINANCE, company_email: 'hina@gmail.com', login_method: 'password' as const }
const authCall = (call: string) => captured.auth.filter((a) => a.call === call).at(-1)?.options as
  Record<string, unknown> | undefined

reset()
await mountApp('/')
check('the password form is folded away behind a link', !field('Password') && !!button('Sign in with email and password'))
await click(button('Sign in with email and password'))
await type('Email', ' Hina@Gmail.com ')
await type('Password', 'not-it')
failNext('auth.signInWithPassword', { message: 'Invalid login credentials' })
await click(button('Sign in'))
check('a password sign-in sends the email trimmed and lower-cased, and the password as typed',
  authCall('signInWithPassword')?.email === 'hina@gmail.com' && authCall('signInWithPassword')?.password === 'not-it',
  JSON.stringify(authCall('signInWithPassword')))
check('a wrong password is shown, still signed out',
  text().includes('Invalid login credentials') && authState.session === null, text().slice(0, 300))

authState.bound = OUTSIDER
await type('Password', 'right-one')
await click(button('Sign in'))
check('signed in by password, the session is still bound like any other',
  captured.rpcs.some((r) => r.name === 'bind_employee') && (await waitFor(() => location.pathname === '/dashboard')),
  location.pathname)
check('…and the app shows them with their role', text().includes('Hina Raza') && text().includes('Finance Admin'))

await click(button('Account menu'))
await click([...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent?.includes('Change password')))
check('a password login can change their password', dialog()?.textContent?.includes('Change password'))
await type('New password', 'longer-secret')
await type('Confirm new password', 'longer-secreT')
await click(button('Save', dialog()!))
check('…the two must match', dialog()?.textContent?.includes('The passwords do not match.') && !authCall('updateUser'))
await type('Confirm new password', 'longer-secret')
await click(button('Save', dialog()!))
check('…and the new one is sent', authCall('updateUser')?.password === 'longer-secret', JSON.stringify(authCall('updateUser')))
check('…then the dialog closes', await waitFor(() => !dialog()))

reset()
signInAs(PEOPLE.member)
await mountApp('/')
await click(button('Account menu'))
check('a Google login has no password to change',
  ![...document.querySelectorAll('[role="menuitem"]')].some((m) => m.textContent?.includes('Change password')))

reset()
await mountApp('/')
await click(button('Sign in with email and password'))
await click(button('Forgot password?'))
check('a reset needs the email first', text().includes('Enter your email first.') && !authCall('resetPasswordForEmail'))
await type('Email', 'Hina@gmail.com')
await click(button('Forgot password?'))
check('a reset link is asked for that address, back to this page',
  authCall('resetPasswordForEmail')?.email === 'hina@gmail.com' &&
  authCall('resetPasswordForEmail')?.redirectTo === window.location.origin + window.location.pathname,
  JSON.stringify(authCall('resetPasswordForEmail')))
check('…without saying whether the address has a login', text().includes('If that address has a password login'))

reset()
signInAs(OUTSIDER)
authState.recovery = true
await mountApp('/')
check('opened from a reset link, they are asked for a new password straight away',
  dialog()?.textContent?.includes('Set a new password'), text().slice(0, 200))

// ---------------- member ----------------
// Sara interviews for Frontend Engineer in the fixtures; take her off that
// hiring team to see a member who is on none.
const offHiringTeam = () => table('job_opening_interviewers').splice(0)

reset()
offHiringTeam()
signInAs(PEOPLE.member)
await mountApp('/')
check('a member lands on the dashboard', location.pathname === '/dashboard', location.pathname)
check('a member is offered the home pages, the org chart, performance and their own leaves',
  navLabels().join() === 'Dashboard,Handbook,Resources,Profile,Org chart,Performance,My leaves', navLabels().join())
check('the header shows who is signed in and their role', text().includes('Sara Iqbal') && text().includes('Member'))

for (const path of [
  '/employees', '/employees/e-amna', '/employees/new', '/leaves/requests', '/company/leaves', '/company/holidays', '/appraisals',
  '/company/departments', '/company/kpis', '/jobs', '/jobs/new', '/jobs/j-open', '/company/branding',
  '/company/announcements', '/applications', '/hr/onboarding', '/hr/onboarding/ob-sara', '/hr/offboarding',
  '/configuration/onboarding', '/configuration/offboarding', '/hr/offboarding/off-sara', '/finance/payroll', '/finance/payroll/pr-may',
  '/operations/equipment', '/operations/equipment/new', '/operations/equipment/eq-laptop', '/configuration/vendors',
  '/company/expectations', '/performance/people/e-amna',
]) {
  reset()
  offHiringTeam()
  signInAs(PEOPLE.member)
  await mountApp(path)
  check(`a member sent to ${path} ends up on the dashboard`, location.pathname === '/dashboard', location.pathname)
  check(`…and nothing from employees is read for ${path}`, !captured.reads.includes('employees'), captured.reads.join())
  check(`…nor job openings for ${path}`, !captured.reads.includes('job_openings'), captured.reads.join())
  check(`…nor onboarding for ${path}`, !captured.reads.some((r) => r.startsWith('onboarding')), captured.reads.join())
  check(`…nor payroll for ${path}`, !captured.reads.some((r) => r.startsWith('payroll')), captured.reads.join())
  check(`…nor equipment or vendors for ${path}`,
    !captured.reads.some((r) => r.startsWith('equipment') || r === 'vendors'), captured.reads.join())
}

// ---------------- a member who manages someone ----------------
reset()
offHiringTeam()
table('org_chart_nodes').push({ employee_id: 'e-omar', manager_id: 'e-sara' })
signInAs(PEOPLE.member)
await mountApp('/leaves/requests')
check('having a direct report is checked at sign-in',
  captured.reads.includes('org_chart_nodes'), captured.reads.join())
check('a member with a direct report reaches leave requests', location.pathname === '/leaves/requests', location.pathname)
check('…and is offered it and their reports\' offboarding, but not HR\'s leave set-up',
  navLabels().join() === 'Dashboard,Handbook,Resources,Profile,Org chart,Performance,My leaves,Leave requests,Offboarding',
  navLabels().join())

// ---------------- a member on a job's hiring team ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/applications')
check('being on a hiring team is asked of the database at sign-in',
  captured.rpcs.some((r) => r.name === 'on_hiring_team'))
check('an interviewer reaches applications, and is offered it but not job openings',
  location.pathname === '/applications' &&
    navLabels().join() === 'Dashboard,Handbook,Resources,Profile,Org chart,Performance,My leaves,Applications', navLabels().join())

reset()
signInAs(PEOPLE.member)
await mountApp('/jobs/j-open')
check('…but still can’t open a job opening', location.pathname === '/dashboard', location.pathname)

// ---------------- HR admin ----------------
reset()
signInAs(PEOPLE.hr)
await mountApp('/')
check('HR lands on the dashboard', location.pathname === '/dashboard', location.pathname)
check('HR is offered people, leave, HR, payroll and equipment pages, only Leaves, Holidays and Announcements under company settings, and only Vendors under configuration',
  navLabels().join() ===
    'Dashboard,Handbook,Resources,Profile,Employees,Org chart,Performance,Appraisals,My leaves,Leave requests,Job openings,' +
      'Applications,Onboarding,Offboarding,Payroll,Equipment,Leaves,Holidays,Announcements,Vendors',
  navLabels().join())

reset()
signInAs(PEOPLE.hr)
await mountApp('/company/leaves')
check('HR reaches the company leave set-up', location.pathname === '/company/leaves', location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/company/announcements')
check('HR reaches announcements', await waitFor(() => text().includes('Add announcement')), location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/company/departments')
check('HR sent to company settings ends up on the dashboard', location.pathname === '/dashboard', location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/company/branding')
check('HR sent to branding ends up on the dashboard', location.pathname === '/dashboard', location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/hr/onboarding')
check('HR reaches onboarding', location.pathname === '/hr/onboarding' && text().includes('Sara Iqbal'), location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/hr/offboarding')
check('HR reaches offboarding', location.pathname === '/hr/offboarding' && text().includes('Sara Iqbal'), location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/configuration/onboarding')
check('HR sent to the onboarding checklist ends up on the dashboard', location.pathname === '/dashboard',
  location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/finance/payroll')
check('HR reaches payroll', location.pathname === '/finance/payroll' && text().includes('May 2026'), location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/operations/equipment')
check('HR reaches equipment', location.pathname === '/operations/equipment' && text().includes('LT-0042'), location.pathname)

reset()
signInAs(PEOPLE.hr)
await mountApp('/jobs')
check('HR reaches job openings', location.pathname === '/jobs' && text().includes('Frontend Engineer'), location.pathname)

// ---------------- company admin ----------------
reset()
signInAs(PEOPLE.companyAdmin)
await mountApp('/company/departments')
check('a company admin reaches company settings', location.pathname === '/company/departments', location.pathname)
check('a company admin is offered everything',
  navLabels().join() ===
    'Dashboard,Handbook,Resources,Profile,Employees,Org chart,Performance,Appraisals,My leaves,Leave requests,Job openings,' +
      'Applications,Onboarding,Offboarding,Payroll,Equipment,Departments,Designations,KPIs,Expectations,Leaves,Holidays,Announcements,Branding,' +
      'Onboarding,Offboarding,Vendors',
  navLabels().join())

// ---------------- finance admin ----------------
reset()
offHiringTeam()
signInAs(FINANCE)
await mountApp('/')
check('a finance admin is offered what a member is, plus payroll, equipment and vendors',
  navLabels().join() === 'Dashboard,Handbook,Resources,Profile,Org chart,Performance,My leaves,Payroll,Equipment,Vendors', navLabels().join())
check('…and the header names the role', text().includes('Finance Admin'))

reset()
offHiringTeam()
signInAs(FINANCE)
await mountApp('/finance/payroll/pr-may')
check('a finance admin reaches a payroll', location.pathname === '/finance/payroll/pr-may' && text().includes('Sara Iqbal'),
  location.pathname)

for (const path of ['/employees', '/employees/e-sara', '/leaves/requests', '/company/leaves', '/company/holidays', '/appraisals', '/hr/onboarding']) {
  reset()
  offHiringTeam()
  signInAs(FINANCE)
  await mountApp(path)
  check(`a finance admin sent to ${path} ends up on the dashboard`, location.pathname === '/dashboard', location.pathname)
  check(`…and nothing from employees is read for ${path}`, !captured.reads.includes('employees'), captured.reads.join())
}

// ---------------- signing out ----------------
await click(button('Account menu'))
await click([...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent?.includes('Sign out')))
check('signing out returns to the login page', text().includes('Sign in with Google'))

done()
