// Starting up after a fresh sign-in: back from Google with a code to exchange.
// The employee row may be bound only now, so the roles (direct reports,
// hiring team) are asked after bind_employee, by the person's own id, never
// beside it. A session restored from the device asks beside it: see
// access.test.tsx.
import { setupDom, reporter } from './setup'
setupDom('http://localhost/elevance-people/?code=abc#/dashboard')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, PEOPLE } = await import('./mockSupabase')

const { check, done } = reporter()

reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
check('a fresh sign-in asks about direct reports by their own id, once bound',
  captured.selects.find((s) => s.table === 'org_chart_nodes')?.filters.some((f) => f[0] === 'manager_id' && f[2] === 'e-sara'))
check('…and the app opens', location.pathname === '/dashboard', location.pathname)

done()
