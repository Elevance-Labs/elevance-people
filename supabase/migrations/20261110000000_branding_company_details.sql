-- ---------------------------------------------------------------------------
-- Branding gains the company's details: short and long business names,
-- address, internal and external emails and phone numbers (free text, one or
-- more per field), and the incorporation and NTN numbers. Company admins set
-- them on Company → Branding; payslips show the logo, long name, INC and NTN
-- numbers, and in the footer the address, internal emails and numbers.
-- Every employee already reads branding; public_branding is unchanged, so
-- none of this reaches anon.
-- ---------------------------------------------------------------------------

alter table public.branding
  add column business_name_short text
    check (business_name_short is null or (btrim(business_name_short) <> '' and length(business_name_short) <= 100)),
  add column business_name_long text
    check (business_name_long is null or (btrim(business_name_long) <> '' and length(business_name_long) <= 200)),
  add column address text
    check (address is null or (btrim(address) <> '' and length(address) <= 500)),
  add column internal_emails text
    check (internal_emails is null or (btrim(internal_emails) <> '' and length(internal_emails) <= 500)),
  add column external_emails text
    check (external_emails is null or (btrim(external_emails) <> '' and length(external_emails) <= 500)),
  add column internal_numbers text
    check (internal_numbers is null or (btrim(internal_numbers) <> '' and length(internal_numbers) <= 500)),
  add column external_numbers text
    check (external_numbers is null or (btrim(external_numbers) <> '' and length(external_numbers) <= 500)),
  add column inc_number text
    check (inc_number is null or (btrim(inc_number) <> '' and length(inc_number) <= 50)),
  add column ntn_number text
    check (ntn_number is null or (btrim(ntn_number) <> '' and length(ntn_number) <= 50));

grant update (business_name_short, business_name_long, address, internal_emails, external_emails,
              internal_numbers, external_numbers, inc_number, ntn_number)
  on public.branding to authenticated;
