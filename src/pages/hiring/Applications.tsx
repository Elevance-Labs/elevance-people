import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
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
import AddIcon from '@mui/icons-material/Add'
import { useAuth } from '../../auth/AuthProvider'
import { PageHeader, PersonAvatar } from '../../components/common'
import { supabase } from '../../lib/supabase'
import { JOB_STATUS_LABELS, STAGE_LABELS, formatDay } from '../../lib/constants'
import { APPLICATION_COLUMNS, STAGES, TEAM_STAGES, type BoardApplication } from '../../lib/hiring'
import type { ApplicationStage, DirectoryEntry, JobOpeningStatus } from '../../lib/types'
import AddApplicationDialog from './AddApplicationDialog'
import ApplicationDialog from './ApplicationDialog'

type Job = {
  id: string
  title: string
  status: JobOpeningStatus
  interview_questions: string[]
  manager_id: string | null
}

const COLUMN_WIDTH = 272

// The job last shown on the board, kept in this browser only. Storage can be
// refused (private windows); the board then starts on the first job.
const LAST_JOB = 'el-people:applications-job'
function readLastJob() {
  try {
    return window.localStorage.getItem(LAST_JOB)
  } catch {
    return null
  }
}
function writeLastJob(id: string) {
  try {
    window.localStorage.setItem(LAST_JOB, id)
  } catch {
    // Not remembered this time.
  }
}

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
  const { isHr, employee } = useAuth()
  const [params, setParams] = useSearchParams()
  const jobId = params.get('job') ?? ''
  const openId = params.get('application')
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [rows, setRows] = useState<BoardApplication[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const setQuery = useCallback(
    (job: string, application: string | null) =>
      setParams(application ? { job, application } : { job }, { replace: true }),
    [setParams],
  )

  useEffect(() => {
    Promise.all([
      supabase.from('job_openings').select('id, title, status, interview_questions, manager_id').order('created_at', { ascending: false }),
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

  // A job is always selected: the one in the URL, else the one last picked on
  // this device, else the first.
  useEffect(() => {
    if (!jobs?.length || jobs.some((j) => j.id === jobId)) return
    const last = readLastJob()
    setQuery(jobs.some((j) => j.id === last) ? last! : jobs[0].id, null)
  }, [jobs, jobId, setQuery])

  // Remember the job on show for next time.
  useEffect(() => {
    if (jobId && jobs?.some((j) => j.id === jobId)) writeLastJob(jobId)
  }, [jobId, jobs])

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
  // HR adds applications received elsewhere, to open jobs only.
  const openJobs = jobs?.filter((j) => j.status === 'open') ?? []

  // Show the job it was added to, with the new application open.
  async function added(job: string, id: string, stage: ApplicationStage, name: string) {
    setAdding(false)
    if (job === jobId) await load(jobId)
    setQuery(job, id)
    setNotice(`Added ${name} to ${STAGE_LABELS[stage]}`)
  }

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
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
              {isHr && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  disabled={!openJobs.length}
                  onClick={() => setAdding(true)}
                >
                  Add application
                </Button>
              )}
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
            </Stack>
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
                    bgcolor: 'background.subtle',
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
          interviewQuestions={job.interview_questions}
          // HR and the job's hiring manager attach the submitted test.
          canAttachTests={isHr || (!!employee && job.manager_id === employee.id)}
          people={people}
          onMoved={moved}
          onChanged={async () => {
            await load(jobId)
          }}
          onClose={() => setQuery(jobId, null)}
        />
      )}
      {adding && (
        <AddApplicationDialog
          jobs={openJobs}
          defaultJobId={jobId}
          onAdded={added}
          onClose={() => setAdding(false)}
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
