import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  IconButton,
  LinearProgress,
  Link as MuiLink,
  MenuItem,
  Paper,
  Snackbar,
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
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { JobStatusChip, PageHeader } from '../../components/common'
import { supabase } from '../../lib/supabase'
import { JOB_STATUS_LABELS, formatDate } from '../../lib/constants'
import { JOB_OPENING_WITH_NAMES, copyText, publicJobUrl, type JobOpeningWithNames } from '../../lib/hiring'
import type { JobOpeningStatus } from '../../lib/types'

// The job list's order: open first, closed last.
const STATUS_ORDER: JobOpeningStatus[] = ['open', 'on_hold', 'draft', 'closed']

export default function JobOpenings() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<JobOpeningWithNames[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<JobOpeningStatus | ''>('')
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('job_openings')
      .select(JOB_OPENING_WITH_NAMES)
      .order('created_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        else setRows(data as unknown as JobOpeningWithNames[])
        setLoading(false)
      })
  }, [])

  const shown = rows
    .filter((r) => !status || r.status === status)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))

  async function copyLink(id: string) {
    const url = publicJobUrl(id)
    setCopied((await copyText(url)) ? 'Public link copied' : url)
  }

  return (
    <>
      <PageHeader
        title="Job openings"
        subtitle={loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'job' : 'jobs'}`}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} component={Link} to="/jobs/new">
            New job opening
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as JobOpeningStatus | '')}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {STATUS_ORDER.map((s) => (
            <MenuItem key={s} value={s}>
              {JOB_STATUS_LABELS[s]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Job</TableCell>
                <TableCell>Status</TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Hiring manager</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Closes</TableCell>
                <TableCell align="right">Applications</TableCell>
                <TableCell align="right" sx={{ width: 96 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r) => {
                const applications = r.application_count
                return (
                  <TableRow
                    key={r.id}
                    hover
                    onClick={() => navigate(`/jobs/${r.id}`)}
                    sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {r.title}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {[r.designation?.title, r.department?.name].filter(Boolean).join(' · ')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <JobStatusChip status={r.status} />
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      {r.manager?.full_name ?? '—'}
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' }, whiteSpace: 'nowrap' }}>
                      {r.due_date ? formatDate(r.due_date) : 'No date'}
                    </TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      {applications ? (
                        <MuiLink component={Link} to={`/applications?job=${r.id}`}>
                          {applications}
                        </MuiLink>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      <Tooltip title={r.status === 'open' ? 'Copy public link' : 'Only open jobs are public'}>
                        <span>
                          <IconButton
                            aria-label={`Copy public link for ${r.title}`}
                            disabled={r.status !== 'open'}
                            onClick={() => copyLink(r.id)}
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={r.status === 'open' ? 'Open public page' : ''}>
                        <span>
                          <IconButton
                            aria-label={`Open public page for ${r.title}`}
                            disabled={r.status !== 'open'}
                            href={publicJobUrl(r.id)}
                            target="_blank"
                            rel="noopener"
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && !shown.length && (
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {rows.length ? 'No jobs with this status.' : 'No job openings yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Snackbar
        open={!!copied}
        autoHideDuration={4000}
        onClose={() => setCopied(null)}
        message={copied}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  )
}
