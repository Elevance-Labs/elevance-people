-- Business functions and the guides for each.
--
-- Departments get a business function: Production, Growth or Operations. It is
-- nullable so existing departments migrate as they are; a company admin sets
-- it when next editing them (the app asks for one on every save).
--
-- Guides are the per-function docs on the Resources page: each a Google Doc
-- (or Sheet or Slides) link, or none yet. An employee reads only the guides of
-- their own department's function; company admins read them all. They live in
-- the database rather than the app so that rule holds: the app's code is
-- public.

create type public.business_function as enum ('production', 'growth', 'operations');

alter table public.departments add column business_function public.business_function;

grant insert (business_function), update (business_function)
  on public.departments to authenticated;

create table public.guides (
  id                uuid primary key default gen_random_uuid(),
  -- Its address on the Resources page: /resources/guides/<slug>.
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title             text not null check (title = trim(title) and title <> ''),
  description       text,
  business_function public.business_function not null,
  -- A Google Docs, Sheets or Slides link. Null = coming soon.
  doc_url           text check (doc_url ~ '^https://docs\.google\.com/'),
  -- Order within the function.
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger guides_touch before update on public.guides
  for each row execute function public.touch_updated_at();

-- The caller's department's business function, if any.
create function public.current_business_function()
returns public.business_function language sql stable security definer set search_path = '' as $$
  select d.business_function
    from public.employees e
    join public.departments d on d.id = e.department_id
   where e.id = public.current_employee_id();
$$;

revoke execute on function public.current_business_function() from public, anon, authenticated;
grant execute on function public.current_business_function() to authenticated;

-- Read only from the app; the guides are kept from the Supabase dashboard.
revoke all on public.guides from anon, authenticated;
grant select on public.guides to authenticated;

alter table public.guides enable row level security;

create policy guides_select on public.guides for select to authenticated
  using ((select public.is_company_admin())
         or business_function = (select public.current_business_function()));

-- The guides we mean to write; each gets its link once the doc exists.
insert into public.guides (slug, title, description, business_function, sort_order) values
  ('product-development', 'Product development', 'From idea to roadmap: discovery, specs and prioritising.', 'production', 1),
  ('delivery', 'Delivery', 'Sprints, estimates, releases and keeping clients in the loop.', 'production', 2),
  ('quality-assurance', 'Quality assurance', 'Test plans, bug reporting and the bar for done.', 'production', 3),
  ('design', 'Design', 'Research, the design system and handing off to engineering.', 'production', 4),
  ('engineering', 'Engineering', 'Code standards, reviews, environments and deploys.', 'production', 5),
  ('sales', 'Sales', 'The pipeline, qualifying leads, proposals and closing.', 'growth', 1),
  ('marketing', 'Marketing', 'Brand, content, campaigns and measuring what works.', 'growth', 2),
  ('hr', 'HR', 'Hiring, onboarding, leave and looking after our people.', 'operations', 1),
  ('finance', 'Finance', 'Payroll, expenses, invoicing and budgets.', 'operations', 2);
