// Holidays: Company → Holidays (HR keeps them, by year), and where everyone
// else sees them — the dashboard, My leaves and the leave dialog's count. Who
// may write them, the one-year rule and recounting leaves over a holiday are
// the database's (RLS, checks, holidays_recount); these checks prove the app
// offers only what that allows and sends exactly what it should.
import { setupDom, freezeToday, reporter, text, button, click, type, choose, dialog, row, navLabels } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, TODAY } = await import('./mockSupabase')
freezeToday(TODAY)

const { check, done } = reporter()

const holidayReads = () => captured.selects.filter((s) => s.table === 'holidays')
const section = (title: string) =>
  [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === title) ?? null

// ============================== Company → Holidays (HR) ==============================

reset()
signInAs(PEOPLE.hr)
await mountApp('/company/holidays')
check('HR reaches the holidays page', location.pathname === '/company/holidays', location.pathname)
check('…from the Company section of the nav', navLabels().includes('Holidays'))
check('it reads the holidays starting this year',
  JSON.stringify(holidayReads()[0]?.filters) ===
    JSON.stringify([['start_date', 'gte', '2026-01-01'], ['start_date', 'lte', '2026-12-31']]),
  JSON.stringify(holidayReads()))
check('…and lists them, not last year\'s', !!row('Eid ul Adha') && !!row('Ashura') && !row('Quaid Day'))
check('each shows its working days', row('Eid ul Adha')?.textContent?.includes('3') && row('Ashura')?.textContent?.includes('2'),
  row('Eid ul Adha')?.textContent)

await choose('Year', '2025')
check('picking a year reads that year', holidayReads().some((s) =>
  JSON.stringify(s.filters) === JSON.stringify([['start_date', 'gte', '2025-01-01'], ['start_date', 'lte', '2025-12-31']])))
check('…and shows its holidays', !!row('Quaid Day') && !row('Ashura'))

// ---------------- adding ----------------
reset()
signInAs(PEOPLE.hr)
await mountApp('/company/holidays')
await click(button('Add holiday'))
await type('Name', '  Eid ul Fitr  ')
await type('From', '2026-12-30')
await type('To', '2027-01-01')
check('a holiday into next year is caught', dialog()?.textContent?.includes("can't run into the next year"))
await click(button('Add', dialog()!))
check('…and never sent', !captured.inserts.some((i) => i.table === 'holidays'))

await type('From', '2026-03-20')
await type('To', '2026-03-23')
check('the dialog counts the weekdays off', dialog()?.textContent?.includes('2 days off work'), dialog()?.textContent)
check('…and says leaves are recounted', dialog()?.textContent?.includes('Leaves over these dates are recounted'))
await click(button('Add', dialog()!))
const added = captured.inserts.find((i) => i.table === 'holidays')?.rows[0]
check('adding inserts exactly the name and dates, the name trimmed',
  JSON.stringify(added) === JSON.stringify({ name: 'Eid ul Fitr', start_date: '2026-03-20', end_date: '2026-03-23' }),
  JSON.stringify(added))
check('the list reloads with it', !!row('Eid ul Fitr'))

await click(button('Add holiday'))
await type('Name', 'Ashura')
await type('From', '2026-07-01')
failNext('holidays.insert', { code: '23505', message: 'duplicate key value violates unique constraint "holidays_name_key"' })
await click(button('Add', dialog()!))
check('a duplicate name is explained', dialog()?.textContent?.includes('already a holiday with this name that year'),
  dialog()?.textContent)
await click(button('Cancel', dialog()!))

await click(button('Add holiday'))
await type('Name', 'New Year')
await type('From', '2027-01-01')
await click(button('Add', dialog()!))
check('saving a holiday in another year switches to that year', !!row('New Year') && !row('Ashura'), text().slice(0, 300))

// ---------------- editing and deleting ----------------
reset()
signInAs(PEOPLE.hr)
await mountApp('/company/holidays')
await click(button('Edit Ashura'))
await type('To', '2026-06-25')
await click(button('Save', dialog()!))
const edited = captured.updates.find((u) => u.table === 'holidays')
check('editing updates exactly the name and dates of that holiday',
  JSON.stringify(edited?.values) === JSON.stringify({ name: 'Ashura', start_date: '2026-06-25', end_date: '2026-06-25' }) &&
    JSON.stringify(edited?.filters) === JSON.stringify([['id', 'eq', 'h-ashura']]),
  JSON.stringify(edited))

await click(button('Delete Independence Day'))
check('deleting asks first, saying leaves count the days again', dialog()?.textContent?.includes('count them as working days again'))
await click(button('Delete', dialog()!))
const deleted = captured.deletes.find((d) => d.table === 'holidays')
check('…and deletes only that holiday', JSON.stringify(deleted?.filters) === JSON.stringify([['id', 'eq', 'h-azadi']]),
  JSON.stringify(deleted))
check('…which leaves the list', !row('Independence Day'))

// ============================== everyone else ==============================

reset()
signInAs(PEOPLE.member)
await mountApp('/company/holidays')
check('a member is sent away from the holidays page', location.pathname === '/dashboard', location.pathname)
check('…and not offered it', !navLabels().includes('Holidays'))

const upcoming = section('Upcoming holidays')
check('the dashboard asks for holidays not yet over',
  holidayReads().some((s) => JSON.stringify(s.filters) === JSON.stringify([['end_date', 'gte', TODAY]])),
  JSON.stringify(holidayReads()))
check('…and lists the ones to come, not those past', !!upcoming && upcoming.textContent?.includes('Ashura') &&
  upcoming.textContent?.includes('Independence Day') && !upcoming.textContent?.includes('Eid ul Adha'), upcoming?.textContent)
check('…read-only', !upcoming?.querySelector('button'))

reset()
table('holidays').length = 0
signInAs(PEOPLE.member)
await mountApp('/dashboard')
check('with no holidays to come, the dashboard has no holidays section', !section('Upcoming holidays'))

reset()
signInAs(PEOPLE.member)
await mountApp('/leaves')
check('My leaves lists the year\'s holidays', text().includes('Holidays in 2026') && text().includes('Eid ul Adha') &&
  text().includes('Independence Day') && !text().includes('Quaid Day'))

// ---------------- the leave dialog leaves holidays out ----------------
await click(button('Apply for leave'))
await choose('Leave type', 'Annual7 days left')
await type('From', '2026-06-24')
await type('To', '2026-06-26')
check('a leave over a holiday counts only the other days, and says which it left out',
  dialog()?.textContent?.includes('1 day of leave') && dialog()?.textContent?.includes('Not counted: Ashura (holiday).'),
  dialog()?.textContent)

await type('From', '2026-06-25')
await type('To', '2026-06-26')
check('dates that are only a holiday are caught',
  dialog()?.textContent?.includes('These dates have no working days: Ashura is a holiday.'), dialog()?.textContent)
await click(button('Apply', dialog()!))
check('…and never sent', !captured.inserts.some((i) => i.table === 'leaves'))

done()
