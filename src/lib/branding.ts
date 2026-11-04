import type { CompanyDetails } from './types'

// The company's details on Company → Branding, in form order, with the
// database's length limits (mirrors of the branding check constraints).
export const COMPANY_DETAIL_FIELDS: {
  key: keyof CompanyDetails
  label: string
  max: number
  multiline?: boolean
  helper?: string
}[] = [
  { key: 'business_name_short', label: 'Business name (short)', max: 100, helper: 'e.g. Elevance Labs' },
  { key: 'business_name_long', label: 'Business name (long)', max: 200, helper: 'The registered name, on payslips' },
  { key: 'inc_number', label: 'INC number', max: 50 },
  { key: 'ntn_number', label: 'NTN number', max: 50 },
  { key: 'address', label: 'Address', max: 500, multiline: true },
  { key: 'internal_emails', label: 'Internal emails', max: 500, multiline: true, helper: 'On payslips' },
  { key: 'internal_numbers', label: 'Internal numbers', max: 500, multiline: true, helper: 'On payslips' },
  { key: 'external_emails', label: 'External emails', max: 500, multiline: true },
  { key: 'external_numbers', label: 'External numbers', max: 500, multiline: true },
]

export const COMPANY_DETAIL_COLUMNS = COMPANY_DETAIL_FIELDS.map((f) => f.key).join(', ')

export const EMPTY_COMPANY_DETAILS = Object.fromEntries(
  COMPANY_DETAIL_FIELDS.map((f) => [f.key, null]),
) as unknown as CompanyDetails

// A field's lines, blank ones dropped.
export const detailLines = (value: string | null) =>
  (value ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
