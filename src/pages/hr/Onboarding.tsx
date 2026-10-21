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
import { PageHeader, PersonAvatar } from '../../components/common'
import { supabase } from '../../lib/supabase'
import { ONBOARDING_STATUS_COLORS, ONBOARDING_STATUS_LABELS, formatDate } from '../../lib/constants'
import { ONBOARDING_LIST, isOverdue, progressOf, type OnboardingListRow } from '../../lib/onboarding'
import type { OnboardingStatus } from '../../lib/types'

const TABS: OnboardingStatus[] = ['in_progress', 'completed', 'cancelled']

// Human Resources → Onboarding (HR): every new hire's onboarding, one tab per
// status (?status=…, in progress by default). Onboardings are started by
// hiring an applicant; a row opens its checklist.
export default function Onboarding() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = TABS.find((s) => s === params.get('status')) ?? 'in_progress'
  const [rows, setRows] = useState<OnboardingListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('onboardings')
      .select(ONBOARDING_LIST)
      .order('due_date')
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        else setRows(data as unknown as OnboardingListRow[])
        setLoading(false)
      })
  }, [])

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((s) => [s, rows.filter((r) => r.status === s).length])),
    [rows],
  )
  // Soonest due first while in progress; most recent first once closed.
  const shown = rows.filter((r) => r.status === status)
  if (status !== 'in_progress') shown.reverse()

  return (
    <>
      <PageHeader title="Onboarding" subtitle="New hires get an onboarding when they’re hired from an application." />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={status}
          onChange={(_e, value: OnboardingStatus) =>
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
                <TableCell>Joining</TableCell>
                <TableCell>Due</TableCell>
                <TableCell sx={{ width: 220 }}>Progress</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r) => {
                const progress = progressOf(r.tasks)
                const name = r.employee?.full_name ?? 'Unknown'
                return (
                  <TableRow
                    key={r.id}
                    hover
                    onClick={() => navigate(`/hr/onboarding/${r.id}`)}
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
                            {r.employee?.company_email}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>{formatDate(r.employee?.date_of_joining ?? null)}</TableCell>
                    <TableCell>
                      {formatDate(r.due_date)}
                      {isOverdue(r) && <Chip label="Overdue" color="error" size="small" sx={{ ml: 1 }} />}
                    </TableCell>
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
                      <Chip
                        label={ONBOARDING_STATUS_LABELS[r.status]}
                        color={ONBOARDING_STATUS_COLORS[r.status]}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && !shown.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {status === 'in_progress'
                      ? 'No onboardings in progress. Hiring an applicant starts one.'
                      : `No ${ONBOARDING_STATUS_LABELS[status].toLowerCase()} onboardings.`}
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
