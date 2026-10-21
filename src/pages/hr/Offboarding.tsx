import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Chip,
  LinearProgress,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material'
import { useAuth } from '../../auth/AuthProvider'
import { PageHeader, PersonAvatar } from '../../components/common'
import { supabase } from '../../lib/supabase'
import {
  OFFBOARDING_REASON_LABELS,
  ONBOARDING_STATUS_COLORS,
  ONBOARDING_STATUS_LABELS,
  formatDate,
} from '../../lib/constants'
import { progressOf } from '../../lib/onboarding'
import { OFFBOARDING_LIST, signOffOf, type OffboardingListRow } from '../../lib/offboarding'
import type { DirectoryEntry, OffboardingStatus, OrgNode } from '../../lib/types'

const TABS: OffboardingStatus[] = ['in_progress', 'completed', 'cancelled']

// Human Resources → Offboarding (HR, and managers for their direct reports;
// RLS decides which): one tab per status (?status=…, in progress by default).
// An offboarding starts when someone is put on notice; a row opens it.
export default function Offboarding() {
  const { employee, isHr } = useAuth()
  const me = employee!.id
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = TABS.find((s) => s === params.get('status')) ?? 'in_progress'
  const [rows, setRows] = useState<OffboardingListRow[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [nodes, setNodes] = useState<OrgNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('offboardings').select(OFFBOARDING_LIST).order('last_working_day'),
      supabase.from('employee_directory').select('*'),
      supabase.from('org_chart_nodes').select('employee_id, manager_id'),
    ]).then(([offboardingsRes, directoryRes, nodesRes]) => {
      const failure = offboardingsRes.error ?? directoryRes.error ?? nodesRes.error
      if (failure) setError(failure.message)
      else {
        setRows(offboardingsRes.data as unknown as OffboardingListRow[])
        setPeople(directoryRes.data as DirectoryEntry[])
        setNodes(nodesRes.data as OrgNode[])
      }
      setLoading(false)
    })
  }, [])

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((s) => [s, rows.filter((r) => r.status === s).length])),
    [rows],
  )
  const personOf = (id: string) => people.find((p) => p.id === id)
  const managerOf = (id: string) => nodes.find((n) => n.employee_id === id)?.manager_id ?? null
  // Soonest last day first while in progress (not set yet last); most recent first once closed.
  const shown = rows.filter((r) => r.status === status)
  if (status === 'in_progress')
    shown.sort((a, b) => (a.last_working_day ?? '9999').localeCompare(b.last_working_day ?? '9999'))
  else shown.sort((a, b) => (b.completed_at ?? b.cancelled_at ?? '').localeCompare(a.completed_at ?? a.cancelled_at ?? ''))

  return (
    <>
      <PageHeader
        title="Offboarding"
        subtitle={
          isHr
            ? 'An offboarding starts when someone’s status is set to Notice period.'
            : 'Offboardings of the people who report to you.'
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={status}
          onChange={(_e, value: OffboardingStatus) =>
            setParams(value === 'in_progress' ? {} : { status: value }, { replace: true })
          }
        >
          {TABS.map((s) => (
            <Tab key={s} value={s} label={`${ONBOARDING_STATUS_LABELS[s]} (${counts[s] ?? 0})`} />
          ))}
        </Tabs>
      </Box>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Last working day</TableCell>
                <TableCell sx={{ width: 200 }}>Progress</TableCell>
                <TableCell>{status === 'in_progress' ? 'Sign-off' : 'Status'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r) => {
                const progress = progressOf(r.tasks)
                const person = personOf(r.employee_id)
                const name = person?.full_name ?? 'Unknown'
                const signOff = signOffOf(r, r.tasks, managerOf(r.employee_id), { id: me, isHr })
                const signed = [signOff.hr, signOff.manager].filter((s) => s === 'done').length
                const needed = signOff.manager === 'not_needed' ? 1 : 2
                return (
                  <TableRow
                    key={r.id}
                    hover
                    onClick={() => navigate(`/hr/offboarding/${r.id}`)}
                    sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <PersonAvatar name={name} size={32} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {name}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {person?.designation ?? person?.company_email}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>{r.reason ? OFFBOARDING_REASON_LABELS[r.reason] : '—'}</TableCell>
                    <TableCell>{r.last_working_day ? formatDate(r.last_working_day) : 'Not set'}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <LinearProgress
                          variant="determinate"
                          value={progress.percent}
                          aria-label={`Progress of ${name}`}
                          sx={{ flexGrow: 1, height: 6, borderRadius: 3 }}
                        />
                        <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                          {progress.done} / {progress.total}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      {status === 'in_progress' ? (
                        signOff.mine ? (
                          <Chip label="Waiting for you" color="warning" size="small" />
                        ) : (
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            {signed} of {needed} signed
                          </Typography>
                        )
                      ) : (
                        <Chip
                          label={ONBOARDING_STATUS_LABELS[r.status]}
                          color={ONBOARDING_STATUS_COLORS[r.status]}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && !shown.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {status === 'in_progress'
                      ? 'No offboardings in progress. Setting someone’s status to Notice period starts one.'
                      : `No ${ONBOARDING_STATUS_LABELS[status].toLowerCase()} offboardings.`}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </>
  )
}
