import { supabase } from './supabase'

// Mirrors MIN_LENGTH in supabase/functions/set-password; Supabase Auth's own
// minimum (dashboard) should be at least this.
export const PASSWORD_MIN_LENGTH = 10

// No look-alikes (0/O, 1/l/I), so it can be read out or typed from a screenshot.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

export function generatePassword(length = 16) {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % ALPHABET.length)
  let out = ''
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length]
    }
  }
  return out
}

/**
 * Company admins: set a password login's password, creating their auth user
 * if need be (the set-password Edge Function). Returns an error message, or
 * null once it is set.
 */
export async function setEmployeePassword(employeeId: string, password: string) {
  const { error } = await supabase.functions.invoke('set-password', {
    body: { employee_id: employeeId, password },
  })
  if (!error) return null
  // A non-2xx reply carries the function's own message in its body.
  const context = (error as { context?: unknown }).context
  if (context instanceof Response) {
    try {
      const body = (await context.json()) as { error?: string }
      if (body.error) return body.error
    } catch {
      // Not JSON: fall back to the generic message.
    }
  }
  return error.message
}
