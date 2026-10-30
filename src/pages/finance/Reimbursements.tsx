import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../../auth/AuthProvider'
import { PageHeader, StatusChip } from '../../components/common'
import { ReimbursementDialog, ReimbursementStatusChip } from '../../components/Reimbursements'
import { supabase } from '../../lib/supabase'
import { REIMBURSEMENT_STATUS_LABELS, formatDate, formatDay, formatEmployeeNumber, formatPkr } from '../../lib/constants'
import { REIMBURSEMENT_SELECT } from '../../lib/reimbursements'
import type { DirectoryEntry, Employee, Reimbursement, ReimbursementStatus } from '../../lib/types'

const STATUSES = Object.keys(REIMBURSEMENT_STATUS_LABELS) as ReimbursementStatus[]
// Statuses that may log in (is_login_status): the people who can be allowed to claim.
const LOGIN_STATUSES = ['probation', 'active', 'notice_period']

type Claimant = Pick<Employee, 'id' | 'full_name' | 'employee_number' | 'status' | 'can_claim_reimbursements'>

// Finance → Reimbursements (HR, finance admins, company admins). Tab *Claims*:
// everyone's claims by status (?status=; by default what the viewer acts on:
// in review for HR, approved for finance). A row opens the claim and its
// actions. Tab *Who can claim* (HR): who may claim. Tab in ?tab=.
export default function Reimbursements() {
  const { isHr } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = isHr && params.get('tab') === 'claimants' ? 'claimants' : 'claims'

  return (
    <>
      <PageHeader title="Reimbursements" subtitle="Claims for money spent for work." />
      {isHr && (
        <Tabs
          value={tab}
          onChange={(_, value) => setParams(value === 'claims' ? {} : { tab: value }, { replace: true })}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="claims" label="Claims" />
          <Tab value="claimants" label="Who can claim" />
        </Tabs>
      )}
      {tab === 'claims' ? <Claims /> : <Claimants />}
    </>
  )
}

function Claims() {
  const { employee, isHr, isFinance } = useAuth()
  const [params, setParams] = useSearchParams()
  const chosen = params.get('status')
  const status = chosen === 'all' ? '' : (STATUSES.find((s) => s === chosen) ?? (isHr ? 'review' : 'approved'))
  const [claims, setClaims] = useState<Reimbursement[]>([])
  // Names come from the directory: finance admins can't read employee records.
  const [people, setPeople] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [claimsRes, directoryRes] = await Promise.all([
      supabase.from('reimbursements').select(REIMBURSEMENT_SELECT).order('created_at', { ascending: false }),
      supabase.from('employee_directory').select('id, full_name'),
    ])
    const loadError = claimsRes.error ?? directoryRes.error
    if (loadError) setError(loadError.message)
    else {
      setClaims(claimsRes.data as unknown as Reimbursement[])
      setPeople(new Map((directoryRes.data as Pick<DirectoryEntry, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name])))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const nameOf = (id: string | null) => (id ? (people.get(id) ?? '—') : '—')
  const shown = useMemo(() => claims.filter((c) => !status || c.status === status), [claims, status])
  const total = shown.reduce((sum, c) => sum + Number(c.amount), 0)
  const openClaim = claims.find((c) => c.id === openId) ?? null

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <TextField
          select
          label="Status"
          size="small"
          value={status || 'all'}
          onChange={(e) => setParams({ status: e.target.value }, { replace: true })}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="all">All statuses</MenuItem>
          {STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {REIMBURSEMENT_STATUS_LABELS[s]}
            </MenuItem>
          ))}
        </TextField>
        {!loading && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {shown.length} {shown.length === 1 ? 'claim' : 'claims'} · {formatPkr(total)}
          </Typography>
        )}
      </Stack>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Expense</TableCell>
                <TableCell>Date</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Submitted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((c) => (
                <TableRow
                  key={c.id}
                  hover
                  onClick={() => setOpenId(c.id)}
                  sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                >
                  <TableCell>{nameOf(c.employee_id)}</TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>
                    <Typography variant="body2" noWrap>
                      {c.description}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatDate(c.expense_date)}</TableCell>
                  <TableCell align="right">{formatPkr(Number(c.amount))}</TableCell>
                  <TableCell>
                    <ReimbursementStatusChip status={c.status} />
                  </TableCell>
                  <TableCell>{formatDay(c.created_at)}</TableCell>
                </TableRow>
              ))}
              {!loading && !shown.length && (
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {status ? `No claims ${REIMBURSEMENT_STATUS_LABELS[status].toLowerCase()}.` : 'No claims yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {openClaim && (
        <ReimbursementDialog
          claim={openClaim}
          viewer={{ id: employee!.id, isHr, isFinance }}
          nameOf={nameOf}
          onChanged={() => {
            setOpenId(null)
            load()
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  )
}

// HR: everyone who may log in, with a switch for whether they may claim.
// Takes effect at their next sign-in.
function Claimants() {
  const [people, setPeople] = useState<Claimant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('employees')
      .select('id, full_name, employee_number, status, can_claim_reimbursements')
      .in('status', LOGIN_STATUSES)
      .order('full_name')
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        else setPeople(data as Claimant[])
        setLoading(false)
      })
  }, [])

  async function toggle(person: Claimant, allowed: boolean) {
    setSaving(person.id)
    setError(null)
    const { error: saveError } = await supabase
      .from('employees')
      .update({ can_claim_reimbursements: allowed })
      .eq('id', person.id)
    setSaving(null)
    if (saveError) return setError(saveError.message)
    setPeople((list) => list.map((p) => (p.id === person.id ? { ...p, can_claim_reimbursements: allowed } : p)))
  }

  const allowed = people.filter((p) => p.can_claim_reimbursements).length

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {loading
          ? 'Loading…'
          : `${allowed} of ${people.length} can claim. They see My reimbursements from their next sign-in. ` +
            'HR, finance and company admins can always claim, for themselves or anyone here.'}
      </Typography>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table aria-label="Who can claim">
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Can claim</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {people.map((p) => (
                <TableRow key={p.id} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {p.full_name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {formatEmployeeNumber(p.employee_number)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusChip status={p.status} />
                  </TableCell>
                  <TableCell align="right">
                    <Switch
                      checked={p.can_claim_reimbursements}
                      disabled={saving === p.id}
                      onChange={(e) => toggle(p, e.target.checked)}
                      slotProps={{ input: { 'aria-label': `${p.full_name} can claim` } }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </>
  )
}
