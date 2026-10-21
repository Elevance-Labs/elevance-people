import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  ButtonBase,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../../auth/AuthProvider'
import { PageHeader, PersonAvatar } from '../../components/common'
import { supabase } from '../../lib/supabase'
import { JOB_STATUS_LABELS, STAGE_LABELS, formatDay } from '../../lib/constants'
import { APPLICATION_COLUMNS, STAGES, TEAM_STAGES, type BoardApplication } from '../../lib/hiring'
import type { ApplicationStage, DirectoryEntry, JobOpeningStatus } from '../../lib/types'
import ApplicationDialog from './ApplicationDialog'

type Job = { id: string; title: string; status: JobOpeningStatus }

const COLUMN_WIDTH = 272

// The viewport less the app bar (theme toolbar heights) and the layout's
// padding above and below, so the board fills the page and only the columns
// scroll.
const PAGE_HEIGHT = {
  xs: 'calc(100dvh - 56px - 32px)',
  sm: 'calc(100dvh - 64px - 32px)',
  md: 'calc(100dvh - 64px - 64px)',
}

// Hiring → Applications: one job's applications as a board, a column per
// stage. HR sees every stage; a job's hiring team (manager, interviewers)
// sees shortlisted through cleared — RLS returns nothing else to them.
// The job and the open application live in the URL (?job=…&application=…).
export default function Applications() {
  const { isHr } = useAuth()
  const [params, setParams] = useSearchParams()
  const jobId = params.get('job') ?? ''
  const openId = params.get('application')
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [rows, setRows] = useState<BoardApplication[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const setQuery = useCallback(
    (job: string, application: string | null) =>
      setParams(application ? { job, application } : { job }, { replace: true }),
    [setParams],
  )

  useEffect(() => {
    Promise.all([
      supabase.from('job_openings').select('id, title, status').order('created_at', { ascending: false }),
      supabase.from('employee_directory').select('*'),
    ]).then(([jobsRes, peopleRes]) => {
      const loadError = jobsRes.error ?? peopleRes.error
      if (loadError) return setError(loadError.message)
      // Open jobs first, then the rest, newest first within each.
      const list = (jobsRes.data as Job[]).sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'))
      setJobs(list)
      setPeople(peopleRes.data as DirectoryEntry[])
    })
  }, [])

  // A job is always selected: the one in the URL, or the first.
  useEffect(() => {
    if (jobs?.length && !jobs.some((j) => j.id === jobId)) setQuery(jobs[0].id, null)
  }, [jobs, jobId, setQuery])

  const load = useCallback(async (job: string) => {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('job_applications')
      .select(APPLICATION_COLUMNS)
      .eq('job_opening_id', job)
      .order('stage_changed_at', { ascending: false })
    if (loadError) setError(loadError.message)
    else setRows(data as unknown as BoardApplication[])
    setLoading(false)
    return (data ?? []) as unknown as BoardApplication[]
  }, [])

  useEffect(() => {
    if (jobId && jobs?.some((j) => j.id === jobId)) load(jobId)
  }, [jobId, jobs, load])

  const columns = isHr ? STAGES : TEAM_STAGES
  const byStage = useMemo(() => {
    const map = new Map<ApplicationStage, BoardApplication[]>(columns.map((s) => [s, []]))
    for (const r of rows) map.get(r.stage)?.push(r)
    return map
  }, [rows, columns])
  const open = rows.find((r) => r.id === openId) ?? null

  // After a move, reload; if the application has left what this person can
  // see (e.g. an interviewer rejected it), close it.
  async function moved(stage: ApplicationStage) {
    const fresh = await load(jobId)
    if (!fresh.some((r) => r.id === openId)) {
      setQuery(jobId, null)
      setNotice(`Moved to ${STAGE_LABELS[stage]}`)
    }
  }

  const job = jobs?.find((j) => j.id === jobId)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: PAGE_HEIGHT, minHeight: 420 }}>
      <PageHeader
        title="Applications"
        subtitle={
          job
            ? `${rows.length} ${rows.length === 1 ? 'application' : 'applications'}${isHr ? '' : ' from shortlisted to cleared'}`
            : undefined
        }
        actions={
          !!jobs?.length && (
            <TextField
              select
              label="Job"
              required
              value={job ? jobId : ''}
              onChange={(e) => setQuery(e.target.value, null)}
              sx={{ minWidth: 280 }}
            >
              {jobs.map((j) => (
                <MenuItem key={j.id} value={j.id}>
                  {j.title}
                  {j.status !== 'open' && (
                    <Typography component="span" variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'pre' }}>
                      {` · ${JOB_STATUS_LABELS[j.status]}`}
                    </Typography>
                  )}
                </MenuItem>
              ))}
            </TextField>
          )
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {jobs && !jobs.length ? (
        <Paper variant="outlined" sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
          {isHr ? 'No job openings yet.' : 'You’re not on the hiring team of any job.'}
        </Paper>
      ) : (
        <Box sx={{ position: 'relative', flexGrow: 1, minHeight: 0 }}>
          {(loading || !jobs) && <LinearProgress sx={{ position: 'absolute', top: -8, left: 0, right: 0 }} />}
          <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', height: '100%', pb: 1 }}>
            {columns.map((stage) => {
              const cards = byStage.get(stage) ?? []
              return (
                <Paper
                  key={stage}
                  variant="outlined"
                  role="region"
                  aria-label={STAGE_LABELS[stage]}
                  sx={{
                    width: COLUMN_WIDTH,
                    flexShrink: 0,
                    bgcolor: 'grey.50',
                    p: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                  }}
                >
                  <Stack direction="row" sx={{ alignItems: 'center', px: 0.75, py: 0.5, mb: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                      {STAGE_LABELS[stage]}
                    </Typography>
                    <Chip label={cards.length} size="small" />
                  </Stack>
                  <Stack spacing={1} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
                    {cards.map((a) => (
                      <ButtonBase
                        key={a.id}
                        onClick={() => setQuery(jobId, a.id)}
                        sx={{
                          display: 'block',
                          flexShrink: 0,
                          textAlign: 'left',
                          bgcolor: 'background.paper',
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 1,
                          p: 1.25,
                          '&:hover': { borderColor: 'primary.main' },
                        }}
                      >
                        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                          <PersonAvatar name={a.full_name} size={30} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                              {a.full_name}
                            </Typography>
                            <Typography variant="caption" noWrap component="div" sx={{ color: 'text.secondary' }}>
                              {a.email}
                            </Typography>
                          </Box>
                        </Stack>
                        <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mt: 0.75 }}>
                          Applied {formatDay(a.created_at)}
                        </Typography>
                      </ButtonBase>
                    ))}
                    {!cards.length && (
                      <Typography variant="caption" sx={{ color: 'text.disabled', px: 0.75, py: 1 }}>
                        None
                      </Typography>
                    )}
                  </Stack>
                </Paper>
              )
            })}
          </Stack>
        </Box>
      )}

      {open && job && (
        <ApplicationDialog
          application={open}
          jobTitle={job.title}
          people={people}
          onMoved={moved}
          onClose={() => setQuery(jobId, null)}
        />
      )}
      <Snackbar
        open={!!notice}
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        message={notice}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  )
}
