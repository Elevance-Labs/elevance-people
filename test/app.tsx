// Mounts the real app — AuthProvider, routes, layout — at a path, the way
// main.tsx does but with an in-memory history. Sign in first with `signInAs`
// from the mock. Import this only after `setupDom()`.
import { useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  UNSAFE_createMemoryHistory as createMemoryHistory,
  unstable_HistoryRouter as HistoryRouter,
  useLocation,
} from 'react-router-dom'
import { CssBaseline, ThemeProvider } from '@mui/material'
import App from '../src/App'
import { AuthProvider } from '../src/auth/AuthProvider'
import { theme } from '../src/theme'
import { settle, trackNavigation } from './setup'

let root: Root | null = null

/** Where the router is now, so a test can see a redirect land. */
export const location = { pathname: '', search: '' }

// The location last committed to the DOM; settle() waits until the history's
// matches it.
let committed = ''

function LocationProbe() {
  const { pathname, search } = useLocation()
  location.pathname = pathname
  location.search = search
  useLayoutEffect(() => {
    committed = pathname + search
  }, [pathname, search])
  return null
}

export async function mountApp(path = '/') {
  root?.unmount()
  document.body.innerHTML = '<div id="root"></div>'
  // v5Compat, as MemoryRouter does: otherwise a push doesn't tell the router.
  const history = createMemoryHistory({ initialEntries: [path], v5Compat: true })
  committed = ''
  trackNavigation(() => history.location.pathname + history.location.search !== committed)
  root = createRoot(document.getElementById('root')!)
  root.render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <HistoryRouter history={history}>
          <LocationProbe />
          <App />
        </HistoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  )
  await settle(80)
  // Once the sign-in spinner goes there is a commit with no spinner before a
  // <Navigate> redirect lands; on a cold run settle() can stop right there.
  await settle()
}
