import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { COMPANY_DOMAIN } from '../lib/constants'
import type { Employee } from '../lib/types'

interface AuthState {
  loading: boolean
  employee: Employee | null
  error: string | null
  isHr: boolean
  isCompanyAdmin: boolean
  // Finance admin or company admin, as isHr is HR admin or company admin.
  isFinance: boolean
  // HR or finance: sees and works on payroll.
  canManagePayroll: boolean
  // HR or finance: manages equipment and vendors.
  canManageOperations: boolean
  // Has direct reports in the org chart, so approves their leaves. Read at sign-in.
  isManager: boolean
  // Hiring manager or interviewer on any job, so sees its applications. Read at sign-in.
  isHiringTeam: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const NOT_ALLOWED = `Sign-in refused. You need an @${COMPANY_DOMAIN} Google account with an active employee record. Contact HR if you think this is a mistake.`

// Supabase reports OAuth failures as error_description in the query string or hash.
function readOAuthError(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('error_description')
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#\/?/, '')).get(
    'error_description',
  )
  return fromQuery ?? fromHash
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionReady, setSessionReady] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [isManager, setIsManager] = useState(false)
  const [isHiringTeam, setIsHiringTeam] = useState(false)
  const [binding, setBinding] = useState(false)
  const [error, setError] = useState<string | null>(readOAuthError)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
      setSessionReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // A session alone is not enough: the user must match a login-eligible employee record.
  useEffect(() => {
    if (!sessionReady) return
    if (!userId) {
      setEmployee(null)
      setIsManager(false)
      setIsHiringTeam(false)
      return
    }
    let cancelled = false
    setBinding(true)
    supabase
      .rpc('bind_employee')
      .maybeSingle()
      .then(async ({ data, error: rpcError }) => {
        if (cancelled) return
        if (rpcError || !data) {
          setError(rpcError ? `Could not verify your account: ${rpcError.message}` : NOT_ALLOWED)
          await supabase.auth.signOut()
        } else {
          const [reports, hiring] = await Promise.all([
            supabase
              .from('org_chart_nodes')
              .select('employee_id', { count: 'exact', head: true })
              .eq('manager_id', (data as Employee).id),
            supabase.rpc('on_hiring_team'),
          ])
          if (cancelled) return
          setIsManager(!!reports.count)
          setIsHiringTeam(hiring.data === true)
          setEmployee(data as Employee)
        }
        setBinding(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionReady, userId])

  const role = employee?.app_role
  const value = useMemo<AuthState>(
    () => ({
      loading: !sessionReady || binding || (!!userId && !employee),
      employee,
      error,
      isHr: role === 'hr_admin' || role === 'company_admin',
      isCompanyAdmin: role === 'company_admin',
      isFinance: role === 'finance_admin' || role === 'company_admin',
      canManagePayroll: role === 'hr_admin' || role === 'finance_admin' || role === 'company_admin',
      canManageOperations: role === 'hr_admin' || role === 'finance_admin' || role === 'company_admin',
      isManager,
      isHiringTeam,
      signIn: async () => {
        setError(null)
        const { error: signInError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin + window.location.pathname,
            // hd only pre-filters the Google account picker; the database enforces the domain.
            queryParams: { hd: COMPANY_DOMAIN, prompt: 'select_account' },
          },
        })
        if (signInError) setError(signInError.message)
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [sessionReady, binding, userId, employee, role, isManager, isHiringTeam, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
