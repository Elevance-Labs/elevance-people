// The service worker vite.pwa builds: how it answers a page load. The
// installed app opens from its stored copy, without waiting on the host;
// a deploy arrives as a new worker and the "new version" prompt.
import vm from 'node:vm'
import { reporter } from './setup'
import { pwa } from '../vite.pwa'

const { check, done } = reporter()

const plugin = pwa({ id: 'el-people', name: 'Elevance People', shortName: 'People', description: 'x', themeColor: '#000', backgroundColor: '#fff' })
;(plugin.configResolved as (c: { base: string }) => void)({ base: '/people/' })
const emitted: Record<string, string> = {}
;(plugin.generateBundle as (this: unknown, o: unknown, b: unknown) => void).call(
  { emitFile: (f: { fileName: string; source: string }) => { emitted[f.fileName] = f.source } },
  {}, { 'index.html': { source: '<html></html>' }, 'assets/app.js': {} })
const sw = emitted['sw.js']
check('the worker is built', typeof sw === 'string' && sw.includes("addEventListener('fetch'"))

const SCOPE = 'https://app.example/people/'
function boot({ stored = null as string | null, network = 'fresh page' as string | null } = {}) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const fetched: string[] = []
  // This version's cache: the shell (the scope's page), when one is stored.
  const caches = { open: async () => ({ match: async (key: string) => (key === SCOPE && stored !== null ? new Response(stored) : undefined) }) }
  const fetch = async (url: string) => {
    fetched.push(url)
    if (network === null) throw new TypeError('offline')
    return new Response(network)
  }
  const self = {
    registration: { scope: SCOPE },
    clients: { matchAll: async () => [], claim: async () => {} },
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn },
    skipWaiting: () => {},
  }
  vm.runInNewContext(sw, { self, caches, URL, Response, Request, fetch, Promise, JSON, Date, console })
  // A page load: what the worker answers with, as text (null: no answer).
  const navigate = async (url: string) => {
    let answer: Promise<Response> | null = null
    handlers.fetch({ request: { method: 'GET', url, mode: 'navigate' }, respondWith: (p: Promise<Response>) => { answer = p } })
    if (!answer) return null
    const response: Response = await answer
    return response.type === 'error' ? 'error' : response.text()
  }
  return { fetched, navigate }
}

{
  const { fetched, navigate } = boot({ stored: 'stored page' })
  check('an installed app opens from its stored page, not the host', await navigate(SCOPE) === 'stored page' && fetched.length === 0)
  check('…so does the return from Google (?code=)', await navigate(`${SCOPE}?code=abc`) === 'stored page' && fetched.length === 0)
}
{
  const { fetched, navigate } = boot()
  check('with nothing stored, the page comes from the network', await navigate(SCOPE) === 'fresh page' && fetched[0] === SCOPE)
}
{
  const { navigate } = boot({ network: null })
  check('nothing stored and no network: an error, not a hang', await navigate(SCOPE) === 'error')
}
{
  const { fetched, navigate } = boot({ stored: 'stored page' })
  check('a page outside its folder is left alone (a sibling app)', await navigate('https://app.example/work/') === null && fetched.length === 0)
}

done()
