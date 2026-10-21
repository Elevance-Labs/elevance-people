import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { formatDateRange, formatDays } from '../../lib/constants'
import {
  HOLIDAY_COLUMNS,
  LEAVE_WITH_TYPE,
  leaveError,
  thisYear,
  todayIso,
  yearBounds,
  yearOptions,
  type LeaveWithType,
} from '../../lib/leaves'
import type { DirectoryEntry, Holiday, LeaveBalance, LeaveType } from '../../lib/types'
import { ConfirmDialog, PageHeader } from '../../components/common'
import { BalanceCards, HolidayList, LeaveDialog, LeaveProgress, LeaveStatusChip } from '../../components/Leaves'

export default function MyLeaves() {
  const { employee } = useAuth()
  const me = employee!.id
  const [year, setYear] = useState(thisYear)
  const [leaves, setLeaves] = useState<LeaveWithType[]>([])
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [types, setTypes] = useState<LeaveType[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [managerId, setManagerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [cancelling, setCancelling] = useState<LeaveWithType | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [from, to] = yearBounds(year)
    const [leavesRes, balancesRes, typesRes, directoryRes, nodeRes, holidaysRes] = await Promise.all([
      supabase
        .from('leaves')
        .select(LEAVE_WITH_TYPE)
        .eq('employee_id', me)
        .gte('start_date', `${year}-01-01`)
        .lte('start_date', `${year}-12-31`)
        .order('start_date', { ascending: false }),
      supabase.rpc('leave_balances', { p_employee_id: me, p_year: year }),
      supabase.from('leave_types').select('*').eq('is_active', true).order('name'),
      supabase.from('employee_directory').select('*'),
      supabase.from('org_chart_nodes').select('manager_id').eq('employee_id', me).maybeSingle(),
      supabase.from('holidays').select(HOLIDAY_COLUMNS).gte('start_date', from).lte('start_date', to).order('start_date'),
    ])
    const failure =
      leavesRes.error ?? balancesRes.error ?? typesRes.error ?? directoryRes.error ?? nodeRes.error ?? holidaysRes.error
    if (failure) setError(failure.message)
    else {
      setLeaves(leavesRes.data as unknown as LeaveWithType[])
      setBalances(balancesRes.data as LeaveBalance[])
      setTypes(typesRes.data as LeaveType[])
      setPeople(directoryRes.data as DirectoryEntry[])
      setManagerId(nodeRes.data?.manager_id ?? null)
      setHolidays(holidaysRes.data as Holiday[])
    }
    setLoading(false)
  }, [me, year])

  useEffect(() => {
    load()
  }, [load])

  const names = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people])
  const nameOf = (id: string | null) => (id && names.get(id)) || 'a former employee'

  const today = todayIso()
  const canCancel = (l: LeaveWithType) =>
    l.status === 'pending' || (l.status === 'approved' && l.start_date > today)

  async function cancel() {
    if (!cancelling) return
    setBusy(true)
    setError(null)
    const { error: cancelError } = await supabase.rpc('leave_cancel', { p_leave_id: cancelling.id })
    setBusy(false)
    setCancelling(null)
    if (cancelError) return setError(leaveError(cancelError))
    load()
  }

  return (
    <>
      <PageHeader
        title="My leaves"
        subtitle={
          managerId
            ? `Leave is granted once HR and ${nameOf(managerId)} have both approved.`
            : 'Leave is granted once HR has approved.'
        }
        actions={
          <>
            <TextField
              select
              label="Year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              sx={{ minWidth: 110 }}
            >
              {yearOptions().map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              disabled={!types.length}
              onClick={() => setApplying(true)}
            >
              Apply for leave
            </Button>
          </>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {!loading && !types.length && (
        <Alert severity="info" sx={{ mb: 2 }}>
          HR hasn't set up any leave types yet.
        </Alert>
      )}

      <BalanceCards balances={balances} />

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Leave</TableCell>
                <TableCell>Dates</TableCell>
                <TableCell align="right">Days</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Approvals</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {leaves.map((l) => (
                <TableRow key={l.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {l.leave_type?.name}
                    </Typography>
                    {l.reason && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {l.reason}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatDateRange(l.start_date, l.end_date)}
                    {l.half_day && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                        Half day
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{l.days}</TableCell>
                  <TableCell>
                    <LeaveStatusChip status={l.status} />
                  </TableCell>
                  <TableCell>
                    <LeaveProgress leave={l} nameOf={nameOf} managerId={managerId} />
                  </TableCell>
                  <TableCell align="right">
                    {canCancel(l) && (
                      <Button size="small" color="inherit" onClick={() => setCancelling(l)}>
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !leaves.length && (
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    No leaves in {year}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Typography variant="h6" component="h2" sx={{ mt: 4, mb: 1.5 }}>
        Holidays in {year}
      </Typography>
      <HolidayList holidays={holidays} empty={`No holidays set for ${year}.`} />
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
        Holidays aren't counted as leave days.
      </Typography>

      <LeaveDialog
        open={applying}
        mode="apply"
        employeeId={me}
        types={types}
        onClose={() => setApplying(false)}
        onSaved={() => {
          setApplying(false)
          load()
        }}
      />

      <ConfirmDialog
        open={!!cancelling}
        title="Cancel this leave?"
        message={
          cancelling &&
          `${cancelling.leave_type?.name}, ${formatDateRange(cancelling.start_date, cancelling.end_date)} (${formatDays(cancelling.days)}). The days go back to your balance.`
        }
        confirmLabel="Cancel leave"
        destructive
        busy={busy}
        onConfirm={cancel}
        onClose={() => setCancelling(null)}
      />
    </>
  )
}
