// The suite: the switcher that leads to the sibling apps, and arriving from
// one. Each app keeps its own session, so the hand-over is a link carrying the
// person's company email, which the receiving app gives Google as a hint.
import { setupDom, reporter, text, click, settle } from './setup'
// Arriving from a sibling app, signed out here, at a deep link.
setupDom('http://localhost/elevance-people/?sso=Sara@ElevanceLabs.com#/dashboard')

const { suiteLinks, switchUrl, ssoHint, isCompanyEmail } = await import('../src/lib/suite')
const { mountApp } = await import('./app')
const { reset, signInAs, captured, PEOPLE } = await import('./mockSupabase')

const { check, done } = reporter()
const DOMAIN = 'elevancelabs.com'

// ---------------- where the apps are ----------------
const links = suiteLinks('people', 'https://elevance-labs.github.io/elevance-people/')
check('the suite is Work, Support and People', links.map((l) => l.name).join() === 'Work,Support,People')
check('each app is the sibling folder beside this one',
  links.map((l) => l.url).join() ===
    'https://elevance-labs.github.io/elevance-work/,https://elevance-labs.github.io/elevance-support/,https://elevance-labs.github.io/elevance-people/',
  links.map((l) => l.url).join())
check('only this app is marked current', links.filter((l) => l.current).map((l) => l.id).join() === 'people')
check('an address given without its closing slash is still the folder',
  suiteLinks('people', 'http://localhost:5173/', { support: 'https://x.test/elevance-support' }).find((l) => l.id === 'support')?.url ===
    'https://x.test/elevance-support/')
check('a build can place an app elsewhere',
  suiteLinks('people', 'http://localhost:5173/', { support: ' http://localhost:5174/ ' }).find((l) => l.id === 'support')?.url ===
    'http://localhost:5174/')

// ---------------- the hand-over link ----------------
check('a link carries who is asking',
  switchUrl('https://x.test/elevance-people/', 'Sara@ElevanceLabs.com', DOMAIN) ===
    'https://x.test/elevance-people/?sso=sara%40elevancelabs.com')
check('an outside address is not handed over', switchUrl('https://x.test/a/', 'sara@gmail.com', DOMAIN) === 'https://x.test/a/')
check('nor is a missing one', switchUrl('https://x.test/a/', null, DOMAIN) === 'https://x.test/a/')
check('the hint is read back, lower-cased', ssoHint('?sso=Sara%40ElevanceLabs.com', DOMAIN) === 'sara@elevancelabs.com')
check('an outside address in the link is ignored', ssoHint('?sso=mallory%40evil.test', DOMAIN) === null)
check('so is anything that is not an address', ssoHint('?sso=1', DOMAIN) === null && ssoHint('', DOMAIN) === null)
check('a look-alike domain is not the company', !isCompanyEmail('sara@notelevancelabs.com.evil.test', DOMAIN) && !isCompanyEmail('sara@xelevancelabs.com', DOMAIN))

// ---------------- arriving from a sibling, signed out ----------------
reset()
await mountApp('/dashboard')
const oauth = captured.auth.find((a) => a.call === 'signInWithOAuth')?.options as
  | { provider: string; options: { redirectTo: string; queryParams: Record<string, string> } }
  | undefined
check('it goes straight to Google, without a click', oauth?.provider === 'google', JSON.stringify(captured.auth))
check('naming the account that was handed over', oauth?.options.queryParams.login_hint === 'sara@elevancelabs.com',
  JSON.stringify(oauth?.options.queryParams))
check('and asking for no account chooser', oauth !== undefined && !('prompt' in oauth.options.queryParams))
check('still narrowed to the company domain', oauth?.options.queryParams.hd === DOMAIN)
check('the login page is not flashed on the way', !text().includes('Sign in with Google'), text().slice(0, 120))
check('the hint is taken out of the address', !window.location.search.includes('sso'), window.location.href)
check('and Google is asked to come back without it', oauth?.options.redirectTo === 'http://localhost/elevance-people/', oauth?.options.redirectTo)
check('the place they were going is kept', window.location.hash === '#/dashboard', window.location.hash)

// A second mount in the same page load does not go round again.
await mountApp('/dashboard')
check('it is tried once per page load', captured.auth.filter((a) => a.call === 'signInWithOAuth').length === 1)

// ---------------- the switcher ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
check('already signed in, nothing is asked of Google', !captured.auth.some((a) => a.call === 'signInWithOAuth'))
const opener = document.querySelector('[aria-label="Switch app"]')
check('the switcher sits in the header', opener !== null)
const banner = [...(opener?.closest('.MuiToolbar-root')?.children ?? [])]
check('before the app\'s own icon', banner.indexOf(opener as Element) >= 0 &&
  banner.indexOf(opener as Element) < banner.findIndex((el) => el.querySelector('.MuiAvatar-root') || el.matches('.MuiAvatar-root')),
  banner.map((el) => el.className.slice(0, 30)).join(' | '))
await click(opener)
await settle()
const entries = [...document.querySelectorAll('[aria-label="Elevance apps"] > *')]
check('it lists the three apps', entries.map((e) => e.querySelector('.MuiListItemText-primary')?.textContent).join() === 'Work,Support,People',
  entries.map((e) => e.textContent).join(' | '))
const here = entries.find((e) => e.getAttribute('aria-current') === 'page')
check('this app is marked, and is not a link', here?.textContent?.includes('PeopleYou are here') === true && !here.hasAttribute('href'),
  here?.outerHTML.slice(0, 160))
const others = entries.filter((e) => e !== here).map((e) => e.getAttribute('href') ?? '')
const mine = encodeURIComponent(PEOPLE.member.company_email)
// Where this run's build places the siblings: their folders, unless it names addresses.
const placed = suiteLinks('people', 'http://localhost/elevance-people/', { work: import.meta.env.VITE_SUITE_WORK_URL, support: import.meta.env.VITE_SUITE_SUPPORT_URL, people: import.meta.env.VITE_SUITE_PEOPLE_URL })
  .filter((l) => !l.current)
  .map((l) => `${l.url}?sso=${mine}`)
check('the others are links to the sibling apps, carrying the signed-in email',
  others.join() === placed.join() && others.length === 2, `${others.join(' | ')} vs ${placed.join(' | ')}`)
check('by default those are the folders beside this one',
  suiteLinks('people', 'http://localhost/elevance-people/').filter((l) => !l.current).every((l) => /^http:\/\/localhost\/elevance-(work|support|people)\/$/.test(l.url)))

done()
