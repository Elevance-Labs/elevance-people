// Sets the password of a password login (an employee without a company Google
// account), creating their auth user if need be. Company admins only.
//
// The admin API needs the service role key, which must never reach the
// browser; Supabase gives it to Edge Functions as an environment variable.
// The caller's own token decides whether they may do this, and which record
// they're setting it for (read through RLS, as them).
//
// Any auth user already holding the address is deleted and made again with
// the new password, already confirmed. That also ends every session it had,
// and drops anything someone else may have set up on that address. The
// employee row is unbound (FK on delete set null) and binds again at the
// next sign-in.
//
// Deploy: supabase functions deploy set-password
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'

// Bearer-token auth, no cookies, so any origin may call it; the token is the gate.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Mirrors PASSWORD_MIN_LENGTH in src/lib/passwordLogin.ts; bcrypt reads at most 72 bytes.
const MIN_LENGTH = 10
const MAX_LENGTH = 72

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Bound, may log in, and a company admin: the same check as the database's.
  const { data: isCompanyAdmin, error: roleError } = await caller.rpc('is_company_admin')
  if (roleError || isCompanyAdmin !== true) return reply(403, { error: 'Only a company admin can set passwords.' })

  let body: { employee_id?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Send employee_id and password as JSON.' })
  }
  const { employee_id: employeeId, password } = body
  if (typeof employeeId !== 'string' || typeof password !== 'string') {
    return reply(400, { error: 'Send employee_id and password.' })
  }
  if (password.length < MIN_LENGTH || new TextEncoder().encode(password).length > MAX_LENGTH) {
    return reply(400, { error: `The password must be ${MIN_LENGTH} to ${MAX_LENGTH} characters.` })
  }

  const { data: employee, error: readError } = await caller
    .from('employees')
    .select('id, company_email, login_method, user_id')
    .eq('id', employeeId)
    .maybeSingle()
  if (readError) return reply(500, { error: readError.message })
  if (!employee) return reply(404, { error: 'No such employee.' })
  if (employee.login_method !== 'password') {
    return reply(400, { error: 'Only a password login has a password to set. This person signs in with Google.' })
  }

  const { data: found, error: lookupError } = await admin.rpc('auth_user_ids_by_email', {
    p_email: employee.company_email,
  })
  if (lookupError) return reply(500, { error: lookupError.message })
  const existing = new Set<string>((found as string[] | null) ?? [])
  if (employee.user_id) existing.add(employee.user_id)
  for (const id of existing) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) return reply(500, { error: `Could not replace the old login: ${error.message}` })
  }

  const { error: createError } = await admin.auth.admin.createUser({
    email: employee.company_email,
    password,
    email_confirm: true,
  })
  if (createError) return reply(400, { error: createError.message })

  return reply(200, { ok: true, replaced: existing.size > 0 })
})
