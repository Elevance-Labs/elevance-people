import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.')
}

export const supabase = createClient(url, anonKey, {
  // PKCE returns ?code= in the query string, leaving the URL hash free for HashRouter.
  auth: { flowType: 'pkce' },
})

export const DOCS_BUCKET = 'employee-docs'
export const APPLICATIONS_BUCKET = 'job-applications'
// Public: the logo is shown on the public job page.
export const BRANDING_BUCKET = 'branding'
// Private: equipment invoices and photos, for whoever manages equipment.
export const EQUIPMENT_BUCKET = 'equipment'
// Private: reimbursement receipts and proof of payment, at <employee_id>/<uuid>.<ext>.
export const REIMBURSEMENTS_BUCKET = 'reimbursements'
