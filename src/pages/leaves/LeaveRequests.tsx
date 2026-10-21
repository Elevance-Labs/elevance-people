import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import EditCalendarOutlinedIcon from '@mui/icons-material/EditCalendarOutlined'
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined'
import SearchIcon from '@mui/icons-material/Search'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { LEAVE_STATUS_LABELS, formatDateRange, formatDays } from '../../lib/constants'
import {
  LEAVE_WITH_TYPE,
  leaveError,
  remainingOf,
  thisYear,
  yearOf,
  yearOptions,
  type LeaveWithType,
} from '../../lib/leaves'
import type { DirectoryEntry, LeaveBalance, LeaveStatus, LeaveType, OrgNode } from '../../lib/types'
import { ConfirmDialog, FormDialog, PageHeader, PersonAvatar } from '../../components/common'
import { LeaveDialog, LeaveProgress, LeaveStatusChip } from '../../components/Leaves'

type View = 'mine' | LeaveStatus | 'all'

export default function LeaveRequests() {
  const { employee, isHr } = useAuth()
  const me = employee!.id
  const [year, setYear] = useState(thisYear)
  const [view, setView] = useState<View>('mine')
  const [search, setSearch] = useState('')
  const [leaves, setLeaves] = useState<LeaveWithType[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [nodes, setNodes] = useState<OrgNode[]>([])
  const [types, setTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [approving, setApproving] = useState<LeaveWithType | null>(null)
  const [approvingBalance, setApprovingBalance] = useState<LeaveBalance | null>(null)
  const [rejecting, setRejecting] = useState<LeaveWithType | null>(null)
  const [reason, setReason] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<LeaveWithType | null>(null)
  const [editing, setEditing] = useState<LeaveWithType | null>(null)
  const [recording, setRecording] = useState(false)

  // RLS returns what the caller may see: everyone's for HR, direct reports' for managers.
  const load = useCallback(async () => {
    setLoading(true)
    const [leavesRes, directoryRes, chartRes, typesRes] = await Promise.all([
      supabase
        .from('leaves')
        .select(LEAVE_WITH_TYPE)
        .neq('employee_id', me)
        .gte('start_date', `${year}-01-01`)
        .lte('start_date', `${year}-12-31`)
        .order('start_date', { ascending: false }),
      supabase.from('employee_directory').select('*').order('full_name'),
      supabase.from('org_chart_nodes').select('employee_id, manager_id'),
      supabase.from('leave_types').select('*').eq('is_active', true).order('name'),
    ])
    const failure = leavesRes.error ?? directoryRes.error ?? chartRes.error ?? typesRes.error
    if (failure) setError(failure.message)
    else {
      setLeaves(leavesRes.data as unknown as LeaveWithType[])
      setPeople(directoryRes.data as DirectoryEntry[])
      setNodes(chartRes.data as OrgNode[])
      setTypes(typesRes.data as LeaveType[])
    }
    setLoading(false)
  }, [me, year])

  useEffect(() => {
    load()
  }, [load])

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const managerOf = useMemo(() => new Map(nodes.map((n) => [n.employee_id, n.manager_id])), [nodes])
  const nameOf = (id: string | null) => (id && byId.get(id)?.full_name) || 'a former employee'

  // Mirrors leave_decide: what the caller's approval would add to a pending leave.
  function approvalAs(l: LeaveWithType) {
    if (l.status !== 'pending') return { hr: false, manager: false }
    const managerId = managerOf.get(l.employee_id) ?? null
    return {
      // HR may also re-approve to finish a leave whose employee no longer has a manager.
      hr: isHr && (!l.hr_approved_by || !managerId),
      manager: managerId === me && !l.manager_approved_by,
    }
  }
  const canApprove = (l: LeaveWithType) => {
    const as = approvalAs(l)
    return as.hr || as.manager
  }
  const canReject = (l: LeaveWithType) =>
    l.status === 'pending' && (isHr || managerOf.get(l.employee_id) === me)
  const isOpen = (l: LeaveWithType) => l.status === 'pending' || l.status === 'approved'

  const awaitingMe = leaves.filter(canApprove).length
  const q = search.trim().toLowerCase()
  const filtered = leaves.filter(
    (l) =>
      (view === 'all' || (view === 'mine' ? canApprove(l) : l.status === view)) &&
      (!q ||
        [byId.get(l.employee_id)?.full_name, l.leave_type?.name]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))),
  )

  async function openApprove(l: LeaveWithType) {
    setDialogError(null)
    setApprovingBalance(null)
    setApproving(l)
    const { data } = await supabase.rpc('leave_balances', {
      p_employee_id: l.employee_id,
      p_year: yearOf(l.start_date),
    })
    setApprovingBalance(((data ?? []) as LeaveBalance[]).find((b) => b.leave_type_id === l.leave_type_id) ?? null)
  }

  async function decide(leave: LeaveWithType, approve: boolean) {
    setBusy(true)
    setDialogError(null)
    const { error: decideError } = await supabase.rpc('leave_decide', {
      p_leave_id: leave.id,
      p_approve: approve,
      p_reason: approve ? null : reason,
    })
    setBusy(false)
    if (decideError) return setDialogError(leaveError(decideError))
    setApproving(null)
    setRejecting(null)
    load()
  }

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

  function approveOutcome(l: LeaveWithType) {
    const as = approvalAs(l)
    const managerId = managerOf.get(l.employee_id) ?? null
    const hrDone = !!l.hr_approved_by || as.hr
    const managerDone = !!l.manager_approved_by || as.manager || !managerId
    const role = as.hr && as.manager ? 'HR and as their manager' : as.hr ? 'HR' : 'their manager'
    const next = !hrDone
      ? 'It still needs HR approval.'
      : !managerDone
        ? `It still needs approval from ${nameOf(managerId)}, their manager.`
        : 'This grants the leave.'
    return `You approve as ${role}. ${next}`
  }

  const summary = (l: LeaveWithType) =>
    `${nameOf(l.employee_id)} · ${l.leave_type?.name} · ${formatDateRange(l.start_date, l.end_date)} (${formatDays(l.days)})`

  return (
    <>
      <PageHeader
        title="Leave requests"
        subtitle={
          loading
            ? 'Loading…'
            : isHr
              ? `${awaitingMe} waiting for you · everyone's leave`
              : `${awaitingMe} waiting for you · your team's leave`
        }
        actions={
          isHr && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setRecording(true)}>
              Record leave
            </Button>
          )
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ p: 2 }}>
          <TextField
            placeholder="Search name or leave type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flex: 1, maxWidth: { sm: 340 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            select
            label="Show"
            value={view}
            onChange={(e) => setView(e.target.value as View)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="mine">Waiting for me ({awaitingMe})</MenuItem>
            {Object.entries(LEAVE_STATUS_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
            <MenuItem value="all">All</MenuItem>
          </TextField>
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
        </Stack>

        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Leave</TableCell>
                <TableCell>Dates</TableCell>
                <TableCell align="right">Days</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Approvals</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((l) => {
                const person = byId.get(l.employee_id)
                return (
                  <TableRow key={l.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <PersonAvatar name={nameOf(l.employee_id)} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                            {nameOf(l.employee_id)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                            {person?.designation ?? person?.company_email}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{l.leave_type?.name}</Typography>
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
                      <LeaveProgress leave={l} nameOf={nameOf} managerId={managerOf.get(l.employee_id) ?? null} />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {canApprove(l) && (
                        <Tooltip title="Approve">
                          <IconButton color="success" aria-label="Approve" onClick={() => openApprove(l)}>
                            <CheckIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {canReject(l) && (
                        <Tooltip title="Reject">
                          <IconButton
                            color="error"
                            aria-label="Reject"
                            onClick={() => {
                              setReason('')
                              setDialogError(null)
                              setRejecting(l)
                            }}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {isHr && isOpen(l) && (
                        <>
                          <Tooltip title="Change dates">
                            <IconButton aria-label="Change dates" onClick={() => setEditing(l)}>
                              <EditCalendarOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Cancel leave">
                            <IconButton aria-label="Cancel leave" onClick={() => setCancelling(l)}>
                              <EventBusyOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && !filtered.length && (
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {view === 'mine' ? 'Nothing is waiting for you.' : `No leaves to show for ${year}.`}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={!!approving} onClose={busy ? undefined : () => setApproving(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Approve leave?</DialogTitle>
        {approving && (
          <DialogContent>
            <Stack spacing={1.5}>
              <Typography variant="body2">{summary(approving)}</Typography>
              {approving.reason && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  “{approving.reason}”
                </Typography>
              )}
              {approvingBalance && approvingBalance.quota !== null && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {approvingBalance.name} in {yearOf(approving.start_date)}: {approvingBalance.approved} taken,{' '}
                  {approvingBalance.pending} pending (including this one), {formatDays(remainingOf(approvingBalance)!)}{' '}
                  left of {approvingBalance.quota}.
                </Typography>
              )}
              <Typography variant="body2">{approveOutcome(approving)}</Typography>
              {dialogError && <Alert severity="error">{dialogError}</Alert>}
            </Stack>
          </DialogContent>
        )}
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setApproving(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" color="success" loading={busy} onClick={() => approving && decide(approving, true)}>
            Approve
          </Button>
        </DialogActions>
      </Dialog>

      <FormDialog
        open={!!rejecting}
        title="Reject leave?"
        submitLabel="Reject"
        error={dialogError}
        busy={busy}
        onSubmit={() => rejecting && decide(rejecting, false)}
        onClose={() => setRejecting(null)}
      >
        <Typography variant="body2">{rejecting && summary(rejecting)}</Typography>
        <TextField
          label="Reason"
          helperText="Shown to the employee"
          multiline
          minRows={2}
          fullWidth
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormDialog>

      <ConfirmDialog
        open={!!cancelling}
        title="Cancel this leave?"
        message={cancelling && `${summary(cancelling)}. The days go back to their balance.`}
        confirmLabel="Cancel leave"
        destructive
        busy={busy}
        onConfirm={cancel}
        onClose={() => setCancelling(null)}
      />

      {isHr && (
        <>
          <LeaveDialog
            open={recording}
            mode="record"
            people={people.filter((p) => p.id !== me && p.status !== 'left' && p.status !== 'terminated')}
            types={types}
            onClose={() => setRecording(false)}
            onSaved={() => {
              setRecording(false)
              load()
            }}
          />
          <LeaveDialog
            open={!!editing}
            mode="edit"
            leave={editing}
            types={types}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              load()
            }}
          />
        </>
      )}
    </>
  )
}
