# CLAUDE.md — Project Map for AI Agents

Orientation for an agent planning work in this repo. **Read this first; read code
second.** It is deliberately high-level: modules, roles, boundaries and rules —
never line-level detail. Anything granular belongs in the code or `README.md`
(the human-facing product and setup doc, which stays the source of truth for
behaviour).

---

## 1. What this is

- In-house **HR / people management** for Elevance Labs.
- Modules so far: **home** (dashboard, handbook, resources, own profile),
  **employee records** (with documents), **org chart**, **appraisals**
  (salary history), **performance**
  (monthly 1:1 reviews: KPIs, expectations, quarterly goal; HR feedback;
  quarterly peer reviews; quarterly feedback on one's manager),
  **leaves** (types,
  quotas, requests, two-step approval, public holidays), **hiring** (job openings, each with a
  public application page; an applications board with stages), **human
  resources** (onboarding, offboarding with HR and manager sign-off), **finance** (payroll),
  **operations** (equipment and its assignments), **company settings**
  (departments, designations, KPIs, expectations, holidays, announcements, branding), and
  **configuration** (the onboarding and offboarding checklists, vendors).
- Stack: **React 19 + Vite + MUI + TypeScript** on the front, **Supabase**
  (Postgres + RLS, Auth, Storage) behind it. No backend of our own; one Edge
  Function (`set-password`, deployed by hand).
- Deployed as a static SPA to **GitHub Pages**; `HashRouter` so no rewrites are
  needed.

## 2. Ground rules an agent must not break

- **Security is enforced in the database, not the UI.** Every role check in the
  app (`isHr`, `isCompanyAdmin`, nav and route gating) is mirrored by RLS,
  column grants or a trigger. A UI change that grants access is not a feature
  until the SQL agrees.
- **The anon key is public.** Nothing private may be reachable by `anon`; every
  table revokes it. The only ways in for `anon` are the public job functions
  (`job_posting`, `public_branding`, `submit_application`) and adding a PDF to
  an open job's CV folder; keep them that narrow. Employee data is sensitive (CNIC, bank, IBAN, DOB) — only
  HR sees full records; everyone else goes through `employee_directory`.
- **Login is bound by company email and sign-in method.** An auth user is
  linked to the employee row whose `company_email` matches and whose
  `login_method` matches the session's provider (Google on the company domain,
  or a confirmed email/password user on an outside address), and only while
  that row's status may log in. Anything that changes emails, methods,
  statuses or roles must keep that binding safe (see the `employees_guard`
  trigger).
- **Business rules live in triggers too** (role changes, document stamping, org
  chart cycles, leave quotas/overlaps/approval). Client-side checks are a
  convenience, never the only guard.
- **Some state changes only through RPCs.** A leave's status and approvals are
  not client-writable; `leave_decide` / `leave_cancel` are the only way in.
  Job applications are written only by `submit_application` (HR's current
  salary and notes by `application_set_hr_details`); their stage
  moves only through `application_move` / `application_undo`, and to hired
  only through `application_hire`. Onboardings change only through
  `onboarding_task_set` / `_complete` / `_cancel`; checklist order only
  through `onboarding_reorder_sections` / `_tasks`. Offboardings are started
  and auto-cancelled only by the `employees_offboarding` trigger (status to /
  from notice period) and change only through `offboarding_set_details` /
  `_task_set` / `_sign_off` / `_cancel`; the last sign-off is what marks the
  employee left. An appraisal's status moves only through
  `salary_revision_move`; clients write only a draft's month, figures and
  note. Payrolls are created and
  change status only through `payroll_create` / `payroll_move`. Equipment
  changes hands only through `equipment_assign` / `equipment_unassign`, which
  keep its history. A monthly review is created and changes status only
  through `review_start` / `_submit` / `_acknowledge` and is final once
  submitted (no reopen, by design); clients
  write only a draft's text and ratings, as the employee's current manager.
  A peer review cycle is created and moves only through `peer_cycle_create`
  / `_open` / `_close`, a peer review is submitted only through
  `peer_review_submit` (final), and a subject reads responses about them
  only through `my_peer_feedback` (anonymised). Feedback on one's manager is
  made only by `manager_feedback_start` and submitted only by
  `manager_feedback_submit` (final); nothing sets a quarter up.
- **Column grants also hide.** Clients can't select
  `job_applications.expected_salary`, `current_salary` or `hr_notes`; HR and
  the hiring manager read them via `application_hr_details`, and only HR
  writes the last two, via `application_set_hr_details`. Never select `*` from that table, nor embed
  `job_applications(count)` (PostgREST makes that a whole-row reference, which
  is refused); count with the `application_count` computed field.
- **Stored HTML is untrusted.** Job descriptions and announcements are
  sanitised on save and again on render (`lib/richText.ts`); never render one
  any other way.
- **The built page locks itself down.** A Content Security Policy is added at
  build time (`vite.config.ts`) and the app refuses to run framed
  (`main.tsx`). A new external host (API, iframe, image, font) is added to
  that policy; `script-src` is never widened. No `console` in `src/` (lint).
- **Column-level grants are the write allow-list.** A new column on a writable
  table is not writable from the app until it is added to the `grant insert /
  update (...)` list — and should not be, if clients must not set it.

## 3. Layout

| Path | Role |
|---|---|
| `src/pages/` | One file per route. Fetches its own data, owns page state. |
| `src/pages/home/` | Dashboard, handbook, resources, profile — everyone. |
| `src/pages/company/` | Company settings pages (company admins; the Leaves, Holidays and Announcements pages also HR). |
| `src/pages/leaves/` | Leaves pages: own leaves, requests to approve. |
| `src/pages/hiring/` | Job openings list and form (HR); applications board and its dialog. |
| `src/pages/hr/` | Human Resources pages: onboarding list and detail (HR); offboarding list and detail (HR, and managers). |
| `src/pages/finance/` | Finance pages (HR, finance admins, company admins): payroll list and one payroll. |
| `src/pages/operations/` | Operations pages (HR, finance admins, company admins): equipment list and one item. |
| `src/pages/performance/` | Performance: the tabbed page (Me, My team, People), one review, one person's history. |
| `src/pages/configuration/` | Configuration pages: the onboarding and offboarding checklists (one page, by kind; company admins); vendors (HR, finance admins, company admins). |
| `src/pages/public/` | Pages served without sign-in (the public job page). |
| `src/components/` | Shared UI: app shell, documents panel, rich text, small common pieces. |
| `src/theme.ts` | MUI theme, and the branded variant the public page uses. |
| `src/auth/` | `AuthProvider` — session, employee binding, role flags. |
| `src/lib/` | Supabase client, domain types, constants/formatters, company-config helpers. |
| `supabase/migrations/` | Ordered, timestamped changes, applied by `supabase db push`. |
| `supabase/functions/` | Edge Functions (Deno), deployed by hand with `supabase functions deploy`; the only code that holds the service role key. |
| `supabase/schema.sql` | The **whole current database** in one file. Kept in step with the migrations. |
| `scripts/check-schema.sh` | Proves `schema.sql` equals the migrations (`yarn check:schema`). |
| `test/` | Behaviour tests: plain scripts run by `vite-node` in jsdom against an in-memory Supabase mock. |
| `.github/workflows/deploy.yml` | Lint, typecheck, test, build, then deploy to GitHub Pages on push to `main`. |

## 4. Routes and pages

- `/careers/:id` — **public**, matched in `src/App.tsx` before the sign-in
  gate: an open job, the application form and branding. Uses no session.
- Otherwise no session → `Login` (Google; email and password, with a reset
  link, for password logins); no other routes exist until signed in.
- `/dashboard` — everyone; the landing page. Performance reminders (reviews
  to submit, own reviews and HR feedback to acknowledge, peer reviews to
  write, feedback on one's manager while open, HR: a quarter with no peer
  reviews), pinned announcements (body
  only; *View all* opens the drawer in `components/Announcements.tsx` with the
  last 4 months'), offboarding reminders (HR and managers: to sign off; managers: a
  report leaving), appraisals to approve (company admins), own leave balance and upcoming leave, upcoming holidays, then the company values
  (static, in `components/CompanyValues.tsx`).
- `/resources` — everyone: tab *Work ethics* (the remote work &
  collaboration guidelines, static, in `components/WorkingGuidelines.tsx`),
  then the viewer's own business function's guides (company admins: a tab
  per function); tab in `?tab=`. `/resources/guides/:slug` — one guide's doc
  in an iframe; back to Resources if RLS hides it or it has no link.
- `/handbook` — everyone: the Google Doc handbook in an iframe (its `/preview`
  URL, from `constants.ts`). `/profile` — everyone: own record, read-only (RLS: a member reads only their own row); tabs *Profile*, *Equipment* (own equipment via `my_equipment`: name, identifier, date), *Salary* (own approved salaries via `my_salaries`: current, then history), *Payslips* (own disbursed payroll lines via `my_payslips`; breakdown dialog and PDF), tab kept in `?tab=`.
- `/employees` — HR list of employee records. HR only.
- `/appraisals` — HR: salary revisions by status (`?status=`, drafts by
  default); write drafts, send for review; company admins approve / reject.
  A name opens that person's salary history. Never your own (RLS).
- `/employees/new`, `/employees/:id` — `EmployeeForm`: create/edit a record;
  on edit, tabs *Details* and *Documents* (tab in `?tab=`; deleted documents
  behind *Show deleted*). Roles, and on edit the company email, are only sent
  by company admins, as is the sign-in method; delete and, for a password
  login, *Set password* are company-admin only.
- `/org-chart` — everyone. Reads `employee_directory`; HR can place, move and
  remove people.
- `/performance` — everyone; tabs in `?tab=`: *Me* (own submitted reviews as
  a report, HR feedback, anonymised peer feedback), *My team* (managers:
  reports' reviews for a month, `?month=`, start one), *Peer reviews*
  (anyone asked for one: their forms), *People* (HR: everyone due a review),
  *Peer cycles* (HR: each quarter's peer reviews, set one up), *Manager
  feedback* (HR: a quarter's feedback on managers, `?tab=manager`, and its
  questions). The *Me* tab also asks for this quarter's feedback on one's
  manager while it's open. `/performance/reviews/:id`
  — everyone (RLS decides): the form for the current manager while a draft,
  read-only otherwise (submit asks to confirm); acknowledge (the employee).
  `/performance/people/:id` — HR and managers: one person's report and reviews,
  plus private notes for their current manager and (HR, not their own) HR
  feedback. The *Me* tab also shows the employee's HR feedback.
  `/performance/peer/:id` — everyone (RLS decides): one peer review form,
  editable by its reviewer while open and unsubmitted. `/performance/cycles/:id`
  — HR: a cycle's due date, questions (draft only), who reviews whom, open /
  close / delete, responses with names. `/performance/manager-feedback/:id` —
  everyone (RLS decides): one feedback-on-manager form, editable by its
  author until submitted or the quarter ends; read-only for HR.
- `/leaves` — everyone: own balance and requests; apply and cancel; the year's holidays.
- `/leaves/requests` — HR, and managers (direct reports in the org chart):
  approve/reject; HR also records leave, changes dates, cancels.
- `/jobs`, `/jobs/new`, `/jobs/:id` — HR: job openings; the form (with the
  rich text editor) is lazy-loaded.
- `/applications` — HR and hiring teams: one job's board (`?job=` required,
  defaults to the first), open application in `?application=`.
- `/hr/onboarding` — HR: onboardings by status (`?status=`, in progress by
  default). `/hr/onboarding/:id` — one onboarding's checklist; tick, complete
  or cancel. `/hr/offboarding` — HR and managers (RLS: never their own):
  offboardings by status (`?status=`). `/hr/offboarding/:id` — details
  (HR), tick tasks, sign off, cancel (HR).
- `/finance/payroll` — HR, finance admins, company admins: payrolls by month,
  start a new one. `/finance/payroll/:id` — one payroll's lines: edit, add,
  remove (draft only), status moves, CSV download (built in the browser).
- `/operations/equipment` — HR, finance admins, company admins: equipment
  (`?status=` filter, search). `/operations/equipment/new`, `/:id` — details,
  invoice and photo, delete; assign / reassign / unassign, history.
- `/configuration/vendors` — HR, finance admins, company admins: add, edit;
  delete is company-admin only.
- `/company/departments`, `/company/designations`, `/company/kpis`,
  `/company/expectations`, `/company/branding`, `/configuration/onboarding`,
  `/configuration/offboarding` —
  company admins only.
- `/company/leaves` — HR: tabs *Types* (default yearly quota per type) and
  *Quotas* (per-person overrides for a year); tab kept in `?tab=`.
- `/company/holidays` — HR: a year's holidays (year picker); add, edit, delete.
- `/company/announcements` — HR: write, pin, unpin, delete; lazy-loaded (rich
  text editor).
- Unknown paths redirect to `/dashboard`.
- Gating is by **not registering** routes in `src/App.tsx`; the nav in
  `components/Layout.tsx` hides the same items (`hrOnly`, `approversOnly`,
  `hiringTeamOnly`, `companyAdminOnly`, `payrollOnly`, `operationsOnly`, per item; a section with no visible items is hidden).

## 5. Shared state

| Provider | Supplies | Scope |
|---|---|---|
| `AuthProvider` | `loading`, `employee`, `error`, `isHr`, `isCompanyAdmin`, `isFinance`, `canManagePayroll`, `canManageOperations`, `isManager`, `isHiringTeam`, `recovering`, `endRecovery`, `signIn`, `signInWithPassword`, `signOut` | Whole app |

- A Supabase session alone is not a login: after sign-in the provider calls
  `bind_employee`; no row back → error shown and the user is signed out.
- `isManager` (has direct reports in the org chart) is read once at sign-in;
  it only gates the leave requests page, the *My team* tab, the person
  page and the offboarding pages — RLS decides what a manager sees.
- `isHiringTeam` (hiring manager or interviewer on any job, RPC
  `on_hiring_team`) is read the same way and only gates the applications page.
- There is no other global state; pages load what they need.

## 6. Modules (`src/lib/`, `src/components/`)

- `supabase.ts` — the shared client (PKCE, so the hash stays free for the
  router) and the bucket names.
- `types.ts` — row shapes for the tables and the directory view. Update it with
  any column change.
- `constants.ts` — company domain, handbook doc URLs, enum labels/colours (role, status,
  employment type), document types and upload limits, number/date formatting.
  Dates are plain `YYYY-MM-DD`, parsed as local time.
- `leaves.ts` — leave select with its type, client mirror of the working-day
  count (weekends and holidays out), holiday columns and helpers, year
  helpers, balance maths, leave and holiday error messages.
- `hiring.ts` — job select (named FKs), public job URL, logo URL, job and
  application error messages; application stages: transitions, reason and
  hiring-team rules (mirrors of the SQL), board columns, hire error messages.
- `onboarding.ts` — onboarding selects (named employee FK), progress, overdue,
  grouping tasks by section (also offboarding's), reorder helper, error messages.
- `salary.ts` — appraisal totals, months, the salary in force (mirror of
  `salary_on`), active / upcoming / past, change %, error messages.
- `offboarding.ts` — offboarding list select (names from the directory), the
  sign-off state (mirror of `offboarding_sign_off`), error messages.
- `payroll.ts` — payroll selects, which columns HR vs finance edit, client
  mirror of bonus / gross / net, totals, CSV building, file download, the
  payslip breakdown, error messages.
- `performance.ts` — review select with its lines, months and quarters,
  client mirrors of the goal rule (`review_goal_quarter`, what a draft rates
  and sets), the submit checks and the due date, the weighted overall score,
  review states and error messages.
- `peerReviews.ts` — peer review selects, quarters and labels, a form's
  state (to do, overdue, submitted, missed), per-question averages, the
  question and response limits (mirrors of the SQL), error messages.
- `managerFeedback.ts` — feedback-on-manager select, a quarter's window
  (opens, due, closes — mirrors of the SQL), a form's state, recent
  quarters, the question limits, error messages.
- `payslip.ts` — the payslip PDF (jsPDF, imported dynamically so it loads
  only on download).
- `equipment.ts` — equipment select (named vendor FK), vendor select with
  equipment count, IBAN normalising, equipment-bucket upload / remove, error
  messages.
- `passwordLogin.ts` — password minimum (mirror of the function's), the
  password generator, and calling `set-password` with its error message.
- `guides.ts` — guide select, function summaries, and turning a Google
  Docs / Sheets / Slides link into its embeddable address.
- `richText.ts` — DOMPurify allow-list sanitiser and styles shared by the
  editor and the view.
- `company.tsx` — helpers for the config pages: embedded-count reading, the
  designation-with-department select (names the FK explicitly), sorting, the
  designation picker's options, and mapping Postgres error codes to messages.
- `components/Layout.tsx` — app bar, role-filtered nav drawer, account menu
  (password logins: change password, also opened by a reset link).
- `components/Documents.tsx` — an employee's document list: upload to the
  private bucket, open via signed URL, soft delete, *Show deleted* toggle.
- `components/Leaves.tsx` — leave status chip, approval progress, balance
  cards, holiday list, and the apply / record / change-dates dialog (reads
  the year's holidays for its count).
- `components/Performance.tsx` — review state chip, the performance report
  (stat tiles, overall-score chart, month-by-month table) and review list;
  shared by the Me tab and the person page.
- `components/PrivateNotes.tsx` — a manager's one private note about a report
  (a text block, saved on blur or Save); on the review form and the person
  page, for the current manager only.
- `components/HrFeedback.tsx` — feedback from HR to one employee: their
  own to read and acknowledge (Me tab), or HR writing and deleting it
  (person page).
- `components/PeerReviews.tsx` — a reviewer's forms list, HR's cycles list
  and set-up dialog, and the subject's anonymised peer feedback (Me tab).
- `components/ManagerFeedback.tsx` — the employee's card for this quarter's
  feedback on their manager (Me tab), and HR's tab: who owes it, averages
  per manager with names, the questions.
- `components/RichText.tsx` — TipTap editor with toolbar (heavy: only the
  lazy job form and announcements pages import it). `components/RichTextView.tsx` — sanitised read-only HTML.
- `components/common.tsx` — logo, avatar, status chips, page header, confirm and
  form dialogs.

## 7. Data model (conceptual)

Full detail in `supabase/schema.sql`.

- **Roles** — `app_role` enum on the employee row: `member`, `hr_admin`,
  `finance_admin`, `company_admin`. HR = HR admin or company admin
  (`is_hr`); Finance = finance admin or company admin (`is_finance`); payroll
  = either (`can_manage_payroll`), and so are equipment and vendors
  (`can_manage_operations`). A finance admin is otherwise a member.
  Only a company admin may assign or change a role, change a company
  email, or set or change the sign-in method (trigger).
- `employees` — the person and their login. `employee_number` from a sequence,
  `user_id` set only by `bind_employee`; neither is client-writable.
  `login_method` (`google`, the default: company domain only; `password`:
  an outside address only, check constraint). Statuses
  `probation` / `active` / `notice_period` may log in (`is_login_status`).
  Linked to a department and a designation (both optional; a designation needs
  its department, and the FK keeps them consistent). HR reads/writes all; a
  member reads only their own row.
- `employee_documents` — metadata for files in the private `employee-docs`
  bucket at `<employee_id>/…`. Soft delete only: no client delete grant (rows
  go only by cascade with the employee), and the storage policy removes a
  file only once no row points at it. HR reads deleted rows; the employee
  doesn't.
- `org_chart_nodes` — one row per placed person with an optional manager;
  trigger refuses cycles. `org_chart_remove` lifts a person's reports to their
  manager.
- `leave_types` (default yearly quota, null = no limit; inactive = can't apply)
  and `leave_quotas` (per employee, type and year override). Everyone reads
  types; HR writes both; employees read their own quotas.
- `holidays` — name and date range within one year (name unique per year).
  Everyone signed in reads; HR writes. `holidays_recount` trigger recounts
  the days of leaves over a changed holiday's old and new dates.
- `leaves` — one request. Working days from `leave_days` (Mon–Fri, not a
  holiday, half days), set by `leaves_guard` on every write, not
  client-writable. `leaves_guard` trigger stamps creator, approvals when HR records
  for someone, and date edits; refuses overlaps, over-quota, inactive types,
  self-edits; flips `pending` → `approved` once HR and the org-chart manager
  (if any) have approved. Visible to the employee, their manager
  (`is_manager_of`) and HR. Clients insert and HR updates dates only; status
  moves via `leave_decide` (approve/reject) and `leave_cancel`.
  `leave_balances` returns quota/approved/pending per type for one person-year.
- `departments` → `designations` → `kpis` and `expectations` — company
  config. A department has a `business_function` enum (production, growth,
  operations; null only for departments made before it). Names unique case-insensitively within their parent. Deleting cascades down the config
  but is refused while employees or job openings are linked.
- `job_openings` (+ `job_opening_interviewers`, `manager_id`) — HR manages;
  the job's hiring team (manager, interviewers; `is_hiring_team`) reads it. Department and designation required, kept consistent by the same
  composite FK as employees. Public only while `open`; takes applications
  until `due_date`. `created_by` stamped by trigger.
- `job_applications` — written only by `submit_application` (security
  definer, callable by anon); HR's current salary and notes only by
  `application_set_hr_details`, read with the expected salary through
  `application_hr_details` (HR and the hiring manager). `stage` (enum, starts `new`) changes only via
  `application_move` (allowed steps in `application_next_stages`; text
  required per `application_stage_needs_reason`), `application_hire` (to
  hired) and HR's `application_undo`. Visible to HR, and to the hiring team from shortlisted
  through cleared (`can_see_application`); the team moves only out of
  shortlisted, test and interviews. `application_stage_events` is the
  timeline (moves and undos, undone moves kept). CV in the private
  `job-applications` bucket at `<job_opening_id>/…`, where the storage policy
  only lets anyone upload while that job takes applications, and reads follow
  who can see the application. A job with
  applications can't be deleted.
- `onboarding_template_sections` → `onboarding_template_tasks` — the
  checklist. HR reads, company admins write; `sort_order` set by trigger
  (last) and changed only by the reorder RPCs, which take every id.
- `onboardings` (+ `onboarding_tasks`) — one per employee, created only by
  `application_hire` with a copy of the checklist (later checklist edits
  don't reach it); due the day after joining. Status `in_progress` →
  `completed` / `cancelled` (reason required). HR only; no client writes.
  Cascades away with the employee.
- `offboarding_template_sections` → `offboarding_template_tasks` — the
  offboarding checklist; same rules as onboarding's (migration seeds a
  starter one).
- `offboardings` (+ `offboarding_tasks`) — at most one in progress per
  employee (partial unique index), closed ones kept; started with a copy of
  the checklist by `employees_offboarding`. Reason and last working day set
  by HR. Tasks ticked by HR or the org-chart manager; sign-off (HR, and the
  manager resolved at the time, if any) needs every task, both details and
  the last day reached; unticking or changing details clears sign-offs. The
  last sign-off completes it and sets the employee's status (left /
  terminated) and date of separation. Visible via `can_work_offboarding`:
  HR and the manager, never the employee. No client writes. Cascades away
  with the employee.
- `payrolls` — one per month and year, never deleted (no grant), at most one
  not yet disbursed (partial unique index). Status `draft` → `review` →
  `approved` → `processed` → `disbursed` only via `payroll_move` (approve
  and back to draft: company admin; processed and disbursed: finance);
  `payroll_create` adds everyone
  who may log in. `payroll_items` — one line per person; name and number
  copied in, bonus / gross / net are generated columns, kept (employee id
  nulled) if the employee is deleted. `payroll_items_guard`: changes only
  while draft, HR's columns vs finance's, only login statuses added,
  basic and contractual from the salary in force that month (`salary_on`),
  else carried from the latest earlier payroll, as the allowance always is. Payroll roles
  only (RLS). `my_payslips` — the caller's own lines on disbursed payrolls,
  without remarks; the only way an employee reads payroll data.
- `salary_revisions` — appraisals: employee, starting month (first day),
  basic, contractual, note. `draft` → `review` → `approved`, or rejected
  back to draft (reason kept), only via `salary_revision_move` (review: HR;
  approve / reject: company admin). One open per employee (partial unique
  index); approved ones are final and the history, and the one in force is
  the latest approved whose month has come (`salary_on`, derived — no job).
  `salary_revisions_guard`: drafts only, never your own, not someone who
  has left, month after the latest approved; creator stamped. HR reads all
  but their own (RLS); `my_salaries` — the caller's own approved ones,
  without notes. Cascades away with the employee.
- `vendors` — name (unique case-insensitively), description, bank, IBAN
  (format checked). Operations roles read and write; only company admins
  delete, refused while equipment is linked.
- `equipment` — name, identifier (unique case-insensitively), status enum,
  purchase date, vendor, invoice and photo in the private `equipment` bucket.
  `assigned_to` / `assigned_on` not client-writable. `equipment_guard` stamps
  `created_by`, refuses retired / sold with a holder. Operations roles only
  (RLS). `equipment_assignments` — the history, one open row per item;
  written only by `equipment_assign` / `_unassign`. Deleting the employee
  unassigns (FK set null) and drops their history rows. `my_equipment` — the
  caller's items (name, identifier, date); the only way an employee reads
  equipment.
- `performance_reviews` (+ `performance_review_kpis`,
  `performance_review_expectations`) — one per employee and reviewed month
  (`period`, first day), due the 10th of the next month (generated).
  `review_start` (the org-chart manager, a month that is over, someone who
  may log in and had joined) copies the designation's KPIs and expectations
  in. While a draft, the current manager updates evaluation, feedback, goal
  and ratings (RLS + column grants). `review_submit` checks completeness and
  order (earlier drafts first), keeps or clears the goal fields by the goal
  rule (`review_goal_quarter`; one goal per person and quarter, partial
  unique index) and stamps `late` on the first submit. HR reads all but
  their own drafts, the manager all of their report's, the employee their
  own once submitted. `performance_due` lists who is due a review for a
  month (HR everyone, a manager their reports). Days follow
  `company_today` (Pakistan time). Cascades away with the employee.
- `manager_notes` — one private note per manager and report (unique), for
  1:1s. Author stamped by trigger, not client-writable; every policy is
  author only (not the employee, not HR); insert also needs
  `is_manager_of`. Only the text is editable. Never joined into reviews.
- `hr_feedback` — HR's feedback to one employee, with a `feedback_kind`
  label. HR inserts (not to themselves) and deletes; no update grant, so
  never edited; author stamped by trigger. HR and the employee read it, not
  the manager. `hr_feedback_acknowledge` is the employee's only write.
- `peer_review_cycles` (one per year and quarter, `draft` → `open` →
  `closed`) → `peer_review_questions` (3–5 to open; changed only while
  draft, by trigger) and `peer_review_assignments` (subject, reviewer, open
  feedback; HR adds and removes until closed, not submitted ones; never
  self, never HR as subject) → `peer_review_answers` (made by the database
  on open, or on adding to an open cycle; the reviewer writes rating and
  comment while open and unsubmitted). HR reads all but responses about
  themselves; a reviewer their own forms once opened. `my_peer_feedback` —
  the subject's responses from closed cycles with two or more, no reviewer,
  shuffled. `is_peer_reviewer_in` / `peer_cycle_status_of` let the policies
  refer to each other without recursion.
- `manager_feedback_questions` (HR only; 3–5 kept by trigger; seeded) →
  `manager_feedback` (one per employee and quarter, with the manager at the
  time; due the 10th of the quarter's last month, generated) +
  `manager_feedback_answers` (the questions copied in). Made only by
  `manager_feedback_start` in the quarter's last month (login status, a
  manager, joined by its 1st); the author writes the text and ratings until
  submitted or `quarter_end`, by trigger; `manager_feedback_submit` stamps
  `late` after the 10th. RLS: the author their own; HR all but feedback
  about themselves; never the manager. `manager_feedback_due` — HR: who
  owes it that quarter, not rows about the caller.
- `branding` — one row: logo path, primary colour, perks (jsonb checked by
  `valid_perks`). Everyone signed in reads, company admins update; anon gets
  it via `public_branding`. Logo in the public `branding` bucket.
- `guides` — one per doc: slug, title, function, optional Google link,
  order. Read only from the app (no write grants; kept from the Supabase
  dashboard); RLS: company admins all, everyone else only
  `current_business_function()` — their department's.
- `announcements` — rich-text body, optional `pinned_until` date, author
  stamped by trigger. Everyone signed in reads all (RLS); HR writes. The
  dashboard shows pinned ones (body only) and the drawer the rest.
- `employee_directory` — view of non-sensitive columns (names, not ids, for
  department/designation) for every logged-in employee. Bypasses employee RLS
  on purpose and gates on the caller being bound.
- `hook_before_user_created` — optional auth hook that refuses sign-up without
  a matching login-eligible record (any domain; `bind_employee` checks the
  method).
- `auth_user_ids_by_email` — service role only: lets `set-password` find an
  address's auth users.
- `set-password` (Edge Function) — company admins (`is_company_admin` as the
  caller) set a password-method employee's password: any auth user with that
  address is deleted and made again, confirmed, with the new password (ends
  its sessions; the row rebinds at next sign-in).

## 8. How things connect

- Sign-in: Google OAuth (PKCE), or email and password for a password login
  (user made by a company admin's *Set password*, via `set-password`) →
  `AuthProvider` sees a
  session → RPC `bind_employee` links auth user ↔ employee by company email
  and method → app renders with role flags. A reset link (PKCE, same
  browser) signs in and fires `PASSWORD_RECOVERY` → set a new password.
- Document upload: storage upload → `employee_documents` insert (trigger stamps
  `uploaded_by`). Delete in the app = set `deleted_at` (trigger stamps
  `deleted_by`).
- Employee delete (company admin): delete row → cascades to documents and org
  chart node → remove storage files (only then allowed).
- Leave: insert (`leaves_guard` validates) → `leave_decide` by HR and the
  manager, in either order → approved. Approvers are resolved from the org
  chart at decision time, not stored at application.
- Public application: `job_posting` + `public_branding` → CV upload into the
  job's folder → `submit_application`, which re-checks the job and that the
  file is there.
- Branding save: upload new logo → update the row → remove the old file.
- Application stage: board reloads after `application_move` / `_undo`; if the
  application left what the viewer can see, the dialog closes.
- Hire (HR, from offer sent): `application_hire` with company email and
  joining date → employee (status joining, prefilled from the application and
  job) + onboarding + tasks + stage event, in one transaction. Its undo is
  refused while that employee exists (a company admin deletes it first).
- Offboarding: HR sets status to notice period → `employees_offboarding`
  starts it (tasks copied) → HR sets details, HR and manager tick tasks →
  `offboarding_sign_off` by each → completed, employee left. Status back to
  probation / active cancels it.
- Peer reviews: `peer_cycle_create` (HR) → questions edited, assignments
  added → `peer_cycle_open` (answers made) → reviewers save and
  `peer_review_submit` → `peer_cycle_close` → subjects read
  `my_peer_feedback`.
- Feedback on one's manager: the quarter's last month opens it (no job) →
  *Give feedback* → `manager_feedback_start` → saved as the author goes →
  `manager_feedback_submit` → HR reads it.
- Monthly review: `review_start` (manager, from *My team*) → draft saved as
  the lines and review row are updated → `review_submit` → the employee reads
  it and `review_acknowledge`s. Nothing reopens a submitted review.
- Payroll: `payroll_create` → lines edited / added / removed while draft
  (`payroll_items_guard`) → `payroll_move` to review, approved, processed,
  disbursed (only then do payslips show).
- Equipment save: upload picked invoice / photo → insert or update the row
  (uploads removed if it fails) → remove the replaced files. Delete: row,
  then files. Holder names come from `employee_directory` (finance admins
  can't read `employees`).
- Pages talk to Supabase directly. The company config pages turn `23505` /
  `23503` / `42501` into user-facing messages via `company.tsx`.

## 9. Working in the repo

- **yarn** (v1) only — `yarn.lock` is the lockfile; never add a
  `package-lock.json`. CI runs `yarn install --frozen-lockfile`.
- `yarn dev` (5173) · `yarn build` (runs `tsc --noEmit` first) · `yarn lint`
  (oxlint, warnings fail) · `yarn typecheck` (app and tests) · `yarn test` ·
  `yarn check:schema` (needs local Postgres binaries on `PATH`).
- CI runs lint, typecheck, test and build; any failure stops the deploy.
  `check:schema` is local only.
- Tests (`test/`):
  - Each `*.test.ts(x)` is a script with a tiny reporter; exits non-zero on
    any failed check. `TZ` is pinned west of UTC so date bugs show.
  - `test/vite.config.ts` swaps `src/lib/supabase` for `test/mockSupabase.ts`:
    fixtures, real filtering, writes that stick, every call recorded,
    `failNext` to inject database errors. It does **not** enforce RLS,
    grants or triggers — the SQL does.
  - `test/app.tsx` mounts the real app (AuthProvider + routes) at a path as a
    signed-in fixture person; `test/setup.ts` has jsdom and the
    click/type/choose helpers. Leave tests freeze today to the mock's date.
  - Tests are **behavioural**: who is offered what, and exactly what is sent.
    Add to them when changing a rule, a role boundary or a write.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — see `.env.example`. CI
  reads them from repository Variables.
- Vite `base: './'` so the build works under any Pages sub-path.

## 10. Changing the database

Every schema change is **three edits in the same change**:

1. A **new migration** in `supabase/migrations/`, named
   `YYYYMMDDHHMMSS_<what>.sql`, opening with a comment that says what changes
   and why. Never edit a migration that has shipped.
2. The **same end state folded into `supabase/schema.sql`** — edit the table,
   function, grant or policy where it lives, as if it had always been that
   way. One-off data moves (backfills, renames of values) stay in the
   migration only.
3. `src/lib/types.ts` updated for any column change.

Then run `yarn check:schema`; it must pass before the change is done. If
Postgres is not available locally, say so rather than claiming it passed. If
the change adds a table or function the app calls, give the mock fixtures or
a stand-in for it and cover the app's use of it in `test/`.

Per migration, remember: grants for new columns, RLS on new tables (and
`revoke all … from anon, authenticated` first), `set search_path = ''` and
schema-qualified names in functions, revoke `execute` on functions clients
must not call.

---

## 11. Keeping the docs current

**`CLAUDE.md`, `README.md`, `supabase/schema.sql` and the tests ship in the
same change as the code they describe.** Treat them as code. Before calling a
change done: `yarn lint`, `yarn typecheck`, `yarn test` and, for a database
change, `yarn check:schema`.

Update **`README.md`** when a change alters anything a person using, setting
up or deploying the app would notice: modules and pages, the access model
table, setup steps, env vars, deploy steps, or the behaviour notes at the end.

Update **`CLAUDE.md`** when a change:

- adds, removes or renames a **route, page, provider, lib module or component
  shared across pages**;
- changes the **role matrix**, a permission boundary, or where a rule is
  enforced;
- adds or reshapes a **table, view, function or bucket**;
- changes the **build, check or deploy** commands or required env vars;
- changes **how modules connect** (a new provider, a new data flow).

Do **not** update `CLAUDE.md` for bug fixes, styling, copy, refactors inside a
module, or other implementation detail.

Rules for edits to this file:

- Keep it **pointers, not prose**. Bullets and tables only.
- Keep it **short** — if a section needs paragraphs, it belongs in `README.md`.
- Never paste code, signatures, column lists or line numbers into this file.
- Prefer editing an existing bullet over adding a new section.
