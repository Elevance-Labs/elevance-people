import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  Link as MuiLink,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import UndoIcon from '@mui/icons-material/Undo'
import WorkOutlineIcon from '@mui/icons-material/WorkOutlined'
import { useAuth } from '../../auth/AuthProvider'
import { ConfirmDialog, FormDialog, PersonAvatar } from '../../components/common'
import { APPLICATIONS_BUCKET, TEST_FILES_BUCKET, supabase } from '../../lib/supabase'
import {
  COMPANY_DOMAIN,
  STAGE_COLORS,
  STAGE_LABELS,
  TEST_FILE_ACCEPT,
  formatDay,
  formatDayTime,
  formatPkr,
} from '../../lib/constants'
import {
  MAX_TEST_FILES,
  NEEDS_REASON,
  NEEDS_TEXT,
  NEXT_STAGES,
  attachTestFile,
  canMoveFrom,
  hireError,
  interviewScores,
  needsTestFile,
  passedTest,
  removeTestFile,
  scoresNeeded,
  testFileProblem,
  testScore,
  undoableMove,
  type ApplicationHrDetails,
  type BoardApplication,
} from '../../lib/hiring'
import type {
  ApplicationStage,
  ApplicationStageEvent,
  ApplicationTestFile,
  DirectoryEntry,
  Onboarding,
} from '../../lib/types'

// Long enough to read a CV without the viewer's link expiring.
const CV_URL_SECONDS = 60 * 60

function StageChip({ stage, size = 'small' }: { stage: ApplicationStage; size?: 'small' | 'medium' }) {
  return <Chip label={STAGE_LABELS[stage]} color={STAGE_COLORS[stage]} size={size} />
}

// 1 to 5, for the test score and each interview question.
function RatingPicker({ label, value, onChange }: { label: string; value: number | null; onChange: (n: number) => void }) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_, n: number | null) => n != null && onChange(n)}
      aria-label={label}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <ToggleButton key={n} value={n} sx={{ width: 40 }}>
          {n}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

const pct = (n: number) => `${Math.round(n)}%`

function Fact({ icon, children }: { icon: ReactElement; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'text.secondary', minWidth: 0 }}>
      {icon}
      <Typography variant="body2" component="span" noWrap>
        {children}
      </Typography>
    </Stack>
  )
}

export default function ApplicationDialog({
  application: a,
  jobTitle,
  interviewQuestions,
  people,
  canAttachTests,
  onMoved,
  onClose,
}: {
  application: BoardApplication
  jobTitle: string
  // The job's questions, each rated on a move on from an interview.
  interviewQuestions: string[]
  people: DirectoryEntry[]
  // HR or the job's hiring manager: may attach and remove test files.
  canAttachTests: boolean
  onMoved: (stage: ApplicationStage) => Promise<void>
  onClose: () => void
}) {
  const { isHr } = useAuth()
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('md'))
  const [cvUrl, setCvUrl] = useState<string | null>(null)
  // Null unless the viewer is HR or the job's hiring manager.
  const [details, setDetails] = useState<ApplicationHrDetails | null>(null)
  // HR's edits to the current salary and notes.
  const [currentSalary, setCurrentSalary] = useState('')
  const [hrNotes, setHrNotes] = useState('')
  const [savingDetails, setSavingDetails] = useState(false)
  const [events, setEvents] = useState<ApplicationStageEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [to, setTo] = useState<ApplicationStage | ''>('')
  const [reason, setReason] = useState('')
  const [score, setScore] = useState<number | null>(null)
  const [ratings, setRatings] = useState<(number | null)[]>([])
  const [busy, setBusy] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [undoReason, setUndoReason] = useState('')
  // Hiring creates the employee record, which needs these.
  const [companyEmail, setCompanyEmail] = useState('')
  const [joining, setJoining] = useState('')
  // The onboarding a hire started; undefined until known.
  const [hire, setHire] = useState<Pick<Onboarding, 'id' | 'employee_id'> | null | undefined>(undefined)
  // The submitted test, each with a signed link to open it.
  const [testFiles, setTestFiles] = useState<(ApplicationTestFile & { url: string | null })[]>([])
  const [attaching, setAttaching] = useState(false)
  const [removing, setRemoving] = useState<ApplicationTestFile | null>(null)
  const testInput = useRef<HTMLInputElement>(null)

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? 'Someone'

  const loadEvents = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('application_stage_events')
      .select('*')
      .eq('application_id', a.id)
      .order('id')
    if (loadError) setError(loadError.message)
    else setEvents(data as ApplicationStageEvent[])
  }, [a.id])

  const loadTestFiles = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('application_test_files')
      .select('*')
      .eq('application_id', a.id)
      .order('created_at')
    if (loadError) return setError(loadError.message)
    const files = data as ApplicationTestFile[]
    const urls = await Promise.all(
      files.map((f) => supabase.storage.from(TEST_FILES_BUCKET).createSignedUrl(f.storage_path, CV_URL_SECONDS)),
    )
    setTestFiles(files.map((f, i) => ({ ...f, url: urls[i].data?.signedUrl ?? null })))
  }, [a.id])

  useEffect(() => {
    setTestFiles([])
    loadTestFiles()
  }, [loadTestFiles])

  useEffect(() => {
    setCvUrl(null)
    setDetails(null)
    supabase.storage
      .from(APPLICATIONS_BUCKET)
      .createSignedUrl(a.resume_path, CV_URL_SECONDS)
      .then(({ data, error: urlError }) => {
        if (urlError || !data) setError(urlError?.message ?? 'Could not open the CV.')
        else setCvUrl(data.signedUrl)
      })
    // No row unless the viewer is HR or the job's hiring manager.
    supabase
      .rpc('application_hr_details', { p_application_id: a.id })
      .maybeSingle<ApplicationHrDetails>()
      .then(({ data }) => {
        setDetails(data ?? null)
        setCurrentSalary(data?.current_salary?.toString() ?? '')
        setHrNotes(data?.hr_notes ?? '')
      })
  }, [a.id, a.resume_path])

  // Reloads when the stage changes, whoever moved it.
  useEffect(() => {
    loadEvents()
    setTo('')
    setReason('')
    setScore(null)
    setRatings(interviewQuestions.map(() => null))
  }, [loadEvents, a.stage, interviewQuestions])

  useEffect(() => {
    setHire(undefined)
    if (!isHr || a.stage !== 'hired') return
    supabase
      .from('onboardings')
      .select('id, employee_id')
      .eq('application_id', a.id)
      .maybeSingle()
      .then(({ data }) => setHire((data as Pick<Onboarding, 'id' | 'employee_id'> | null) ?? null))
  }, [isHr, a.id, a.stage])

  const canMove = canMoveFrom(a.stage, isHr)
  // A hire can't be undone while the employee record it created exists.
  const undo = isHr && !(a.stage === 'hired' && hire !== null) ? undoableMove(events, a.stage) : null
  const textRequired = !!to && NEEDS_TEXT.includes(to)
  const isReason = !!to && NEEDS_REASON.includes(to)
  const needs = scoresNeeded(a.stage, to)
  const currentTest = testScore(events)
  const interviews = interviewScores(events)
  const testFileNeeded = needsTestFile(a.stage, to)
  // Once moved on from the test, the last file stays.
  const keepsLastFile = passedTest(events) && testFiles.length <= 1

  async function attachTests(files: File[]) {
    const problem = files.map(testFileProblem).find(Boolean)
    if (problem) return setError(problem)
    if (testFiles.length + files.length > MAX_TEST_FILES) {
      return setError(`An application takes up to ${MAX_TEST_FILES} test files.`)
    }
    setAttaching(true)
    setError(null)
    for (const file of files) {
      const attachError = await attachTestFile(a.id, file)
      if (attachError) {
        setError(`${file.name} couldn’t be attached: ${attachError.message}`)
        break
      }
    }
    await loadTestFiles()
    setAttaching(false)
  }

  async function removeTest() {
    if (!removing) return
    setBusy(true)
    setError(null)
    const removeError = await removeTestFile(removing.id)
    setBusy(false)
    setRemoving(null)
    if (removeError) return setError(removeError.message)
    await loadTestFiles()
  }

  async function move() {
    if (!to) return
    if (textRequired && !reason.trim()) {
      return setError(`${isReason ? 'Give a reason' : 'Add remarks'} for moving to ${STAGE_LABELS[to]}.`)
    }
    if (testFileNeeded && !testFiles.length) {
      return setError(`Attach the submitted test before moving on to ${STAGE_LABELS[to]}.`)
    }
    if (needs === 'test' && score == null) return setError('Give the test a score from 1 to 5.')
    if (needs === 'interview' && ratings.some((r) => r == null)) {
      return setError('Rate every interview question from 1 to 5.')
    }
    setBusy(true)
    setError(null)
    const { error: moveError } =
      to === 'hired'
        ? await supabase.rpc('application_hire', {
            p_application_id: a.id,
            p_company_email: companyEmail.trim().toLowerCase(),
            p_date_of_joining: joining,
            p_reason: reason.trim() || null,
          })
        : await supabase.rpc('application_move', {
            p_application_id: a.id,
            p_stage: to,
            p_reason: reason.trim() || null,
            ...(needs === 'test' && { p_test_score: score }),
            ...(needs === 'interview' && { p_ratings: ratings }),
          })
    setBusy(false)
    if (moveError) {
      // The job's questions changed since this page loaded.
      if (needs === 'interview' && moveError.message.includes('Rate every interview question')) {
        return setError('The job’s interview questions have changed. Reload the page and rate them again.')
      }
      return setError(to === 'hired' ? hireError(moveError) : moveError.message)
    }
    await onMoved(to)
  }

  const detailsChanged =
    !!details &&
    (currentSalary.trim() !== (details.current_salary?.toString() ?? '') ||
      hrNotes.trim() !== (details.hr_notes ?? ''))

  async function saveDetails() {
    const salary = currentSalary.trim()
    if (salary && !/^\d+$/.test(salary)) return setError('Enter the current salary as a whole number of rupees.')
    setSavingDetails(true)
    setError(null)
    const next = { current_salary: salary ? Number(salary) : null, hr_notes: hrNotes.trim() || null }
    const { error: saveError } = await supabase.rpc('application_set_hr_details', {
      p_application_id: a.id,
      p_current_salary: next.current_salary,
      p_hr_notes: next.hr_notes,
    })
    setSavingDetails(false)
    if (saveError) return setError(saveError.message)
    setDetails((d) => d && { ...d, ...next })
    setHrNotes(next.hr_notes ?? '')
  }

  async function undoMove() {
    if (!undo) return
    setBusy(true)
    setError(null)
    const { error: undoError } = await supabase.rpc('application_undo', {
      p_application_id: a.id,
      p_reason: undoReason.trim() || null,
    })
    setBusy(false)
    setUndoing(false)
    setUndoReason('')
    if (undoError) return setError(undoError.message)
    await onMoved(undo.from_stage)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      fullScreen={narrow}
      maxWidth={false}
      aria-labelledby="application-title"
      slotProps={{
        paper: { sx: narrow ? {} : { width: 'min(1440px, 96vw)', height: '92vh', maxHeight: 'none' } },
      }}
    >
      {/* Candidate */}
      <Stack
        direction="row"
        spacing={2}
        sx={{ px: { xs: 2, sm: 3 }, py: 2, borderBottom: 1, borderColor: 'divider', alignItems: 'flex-start' }}
      >
        <PersonAvatar name={a.full_name} size={48} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography id="application-title" variant="h6" component="h2">
              {a.full_name}
            </Typography>
            <StageChip stage={a.stage} />
          </Stack>
          <Stack
            direction="row"
            sx={{ mt: 0.75, flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.5 }}
          >
            <Fact icon={<EmailOutlinedIcon fontSize="small" />}>
              <MuiLink href={`mailto:${a.email}`}>{a.email}</MuiLink>
            </Fact>
            <Fact icon={<PhoneOutlinedIcon fontSize="small" />}>
              <MuiLink href={`tel:${a.phone}`}>{a.phone}</MuiLink>
            </Fact>
            {details?.current_salary != null && (
              <Fact icon={<PaymentsOutlinedIcon fontSize="small" />}>
                <span aria-label="Current salary">{formatPkr(details.current_salary)}</span> / month current
              </Fact>
            )}
            {details?.expected_salary != null && (
              <Fact icon={<PaymentsOutlinedIcon fontSize="small" />}>
                <span aria-label="Expected salary">{formatPkr(details.expected_salary)}</span> / month expected
              </Fact>
            )}
            <Fact icon={<WorkOutlineIcon fontSize="small" />}>{jobTitle}</Fact>
            <Fact icon={<EventOutlinedIcon fontSize="small" />}>Applied {formatDay(a.created_at)}</Fact>
          </Stack>
        </Box>
        <IconButton aria-label="Close" onClick={onClose} edge="end">
          <CloseIcon />
        </IconButton>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ flexGrow: 1, minHeight: 0, overflow: { xs: 'auto', md: 'hidden' } }}>
        {/* CV */}
        <Box
          sx={{
            flexGrow: 1,
            minWidth: 0,
            minHeight: { xs: '70vh', md: 0 },
            bgcolor: 'grey.100',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Stack
            direction="row"
            sx={{ px: 2, py: 1, alignItems: 'center', borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
          >
            <Typography variant="body2" noWrap sx={{ flexGrow: 1, color: 'text.secondary' }}>
              {a.resume_name}
            </Typography>
            {cvUrl && (
              <Button size="small" startIcon={<OpenInNewIcon />} href={cvUrl} target="_blank" rel="noopener">
                Open in new tab
              </Button>
            )}
          </Stack>
          {cvUrl ? (
            <Box component="iframe" src={cvUrl} title={`CV of ${a.full_name}`} sx={{ flexGrow: 1, border: 0, width: '100%' }} />
          ) : (
            <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center' }}>
              <CircularProgress />
            </Box>
          )}
        </Box>

        {/* Stage and timeline */}
        <Box
          sx={{
            width: { md: 380 },
            flexShrink: 0,
            borderLeft: { md: 1 },
            borderTop: { xs: 1, md: 0 },
            borderColor: 'divider',
            overflowY: { md: 'auto' },
            p: { xs: 2, sm: 3 },
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Stage
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {STAGE_LABELS[a.stage]} since {formatDay(a.stage_changed_at)}
          </Typography>

          {canMove ? (
            <Stack
              component="form"
              spacing={2}
              onSubmit={(e) => {
                e.preventDefault()
                move()
              }}
            >
              <TextField
                select
                label="Move to"
                value={to}
                onChange={(e) => setTo(e.target.value as ApplicationStage)}
                fullWidth
              >
                {NEXT_STAGES[a.stage].map((s) => (
                  <MenuItem key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </MenuItem>
                ))}
              </TextField>
              {to === 'hired' && (
                <>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Hiring creates {a.full_name}’s employee record (status Joining) and their onboarding,
                    due the day after they join.
                  </Typography>
                  <TextField
                    label="Company email"
                    required
                    type="email"
                    placeholder={`name@${COMPANY_DOMAIN}`}
                    value={companyEmail}
                    onChange={(e) => setCompanyEmail(e.target.value)}
                    slotProps={{
                      htmlInput: {
                        pattern: `.+@${COMPANY_DOMAIN.replace('.', '\\.')}`,
                        title: `Must be an @${COMPANY_DOMAIN} address`,
                      },
                    }}
                    fullWidth
                  />
                  <TextField
                    label="Date of joining"
                    required
                    type="date"
                    value={joining}
                    onChange={(e) => setJoining(e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                    fullWidth
                  />
                </>
              )}
              {testFileNeeded && !testFiles.length && (
                <Alert severity="warning" variant="outlined">
                  Attach the submitted test below before moving on.
                </Alert>
              )}
              {needs === 'test' && (
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.75 }}>
                    Test score
                  </Typography>
                  <RatingPicker label="Test score" value={score} onChange={setScore} />
                </Box>
              )}
              {needs === 'interview' && (
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    Interview ratings
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    1 is poor, 5 is excellent.
                  </Typography>
                  <Stack spacing={1.5} sx={{ mt: 1 }}>
                    {interviewQuestions.map((q, i) => (
                      <Box key={q}>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                          {q}
                        </Typography>
                        <RatingPicker
                          label={`Rating for ${q}`}
                          value={ratings[i] ?? null}
                          onChange={(n) => setRatings((r) => r.map((x, j) => (j === i ? n : x)))}
                        />
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
              <TextField
                label={isReason ? 'Reason' : 'Remarks'}
                required={textRequired}
                placeholder={textRequired ? undefined : 'Optional'}
                multiline
                minRows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 2000 } }}
                fullWidth
              />
              <Button type="submit" variant="contained" disabled={!to} loading={busy}>
                {to === 'hired' ? 'Hire' : 'Move'}
              </Button>
            </Stack>
          ) : hire ? (
            <Alert severity="success" variant="outlined">
              Hired. Their employee record and onboarding have been created.
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button size="small" variant="outlined" component={Link} to={`/hr/onboarding/${hire.id}`}>
                  Open onboarding
                </Button>
                <Button size="small" component={Link} to={`/employees/${hire.employee_id}`}>
                  Employee record
                </Button>
              </Stack>
            </Alert>
          ) : (
            <Alert severity="info" variant="outlined">
              {NEXT_STAGES[a.stage].length
                ? `Only HR can move an application on from ${STAGE_LABELS[a.stage]}.`
                : `${STAGE_LABELS[a.stage]} is a final stage.`}
            </Alert>
          )}

          {undo && (
            <Button
              startIcon={<UndoIcon />}
              onClick={() => setUndoing(true)}
              disabled={busy}
              sx={{ mt: 1.5 }}
            >
              Undo: back to {STAGE_LABELS[undo.from_stage]}
            </Button>
          )}

          {error && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {(canAttachTests || testFiles.length > 0) && (
            <Box aria-label="Test files" role="region">
              <Divider sx={{ my: 3 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Test files
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
                {canAttachTests
                  ? `The submitted test: up to ${MAX_TEST_FILES} PDFs or images, 5 MB each. Needed to move on from the test.`
                  : 'The submitted test.'}
              </Typography>
              {testFiles.length > 0 ? (
                <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
                  {testFiles.map((f) => (
                    <Stack component="li" key={f.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        {f.url ? (
                          <MuiLink href={f.url} target="_blank" rel="noopener" variant="body2" noWrap sx={{ display: 'block' }}>
                            {f.file_name}
                          </MuiLink>
                        ) : (
                          <Typography variant="body2" noWrap>
                            {f.file_name}
                          </Typography>
                        )}
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {nameOf(f.uploaded_by)} · {formatDayTime(f.created_at)}
                        </Typography>
                      </Box>
                      {canAttachTests && (
                        <IconButton
                          size="small"
                          aria-label={`Remove ${f.file_name}`}
                          disabled={keepsLastFile || busy || attaching}
                          title={keepsLastFile ? 'The application has moved on from the test, so it keeps this file.' : undefined}
                          onClick={() => setRemoving(f)}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  None attached yet.
                </Typography>
              )}
              {canAttachTests && testFiles.length < MAX_TEST_FILES && (
                <>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AttachFileIcon />}
                    loading={attaching}
                    onClick={() => testInput.current?.click()}
                    sx={{ mt: 1.5 }}
                  >
                    Attach test
                  </Button>
                  <input
                    ref={testInput}
                    type="file"
                    hidden
                    multiple
                    accept={TEST_FILE_ACCEPT}
                    aria-label="Test file"
                    onChange={(e) => {
                      attachTests([...(e.target.files ?? [])])
                      e.target.value = ''
                    }}
                  />
                </>
              )}
            </Box>
          )}

          {(currentTest != null || interviews.interviews > 0) && (
            <Box aria-label="Scores" role="region">
              <Divider sx={{ my: 3 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
                Scores
              </Typography>
              {currentTest != null && (
                <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1.5 }}>
                  <Typography variant="body2">Test score</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} aria-label="Test score">
                    {currentTest}/5
                  </Typography>
                </Stack>
              )}
              {interviews.combined != null && (
                <>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Typography variant="body2">
                      Interviews{' '}
                      <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
                        ({interviews.interviews === 1 ? '1 interview' : `${interviews.interviews} interviews`}, test
                        not included)
                      </Typography>
                    </Typography>
                    <Typography variant="h6" component="p" aria-label="Combined interview score">
                      {pct(interviews.combined)}
                    </Typography>
                  </Stack>
                  <Stack component="ul" spacing={1.25} sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }}>
                    {interviews.questions.map((q) => (
                      <Box component="li" key={q.question}>
                        <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            {q.question}
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 500 }} aria-label={`Score for ${q.question}`}>
                            {pct(q.percent)}
                          </Typography>
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={q.percent}
                          aria-hidden
                          sx={{ mt: 0.5, height: 6, borderRadius: 3 }}
                        />
                      </Box>
                    ))}
                  </Stack>
                </>
              )}
            </Box>
          )}

          {details && isHr && (
            <>
              <Divider sx={{ my: 3 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0 }}>
                HR notes
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                Seen by HR and the hiring manager only.
              </Typography>
              <Stack
                component="form"
                spacing={2}
                onSubmit={(e) => {
                  e.preventDefault()
                  saveDetails()
                }}
              >
                <TextField
                  label="Current salary"
                  type="number"
                  helperText="Per month"
                  value={currentSalary}
                  onChange={(e) => setCurrentSalary(e.target.value)}
                  slotProps={{
                    input: { startAdornment: <InputAdornment position="start">PKR</InputAdornment> },
                    htmlInput: { min: 0, step: 1, inputMode: 'numeric' },
                  }}
                  fullWidth
                />
                <TextField
                  label="Notes"
                  multiline
                  minRows={3}
                  value={hrNotes}
                  onChange={(e) => setHrNotes(e.target.value)}
                  slotProps={{ htmlInput: { maxLength: 5000 } }}
                  fullWidth
                />
                <Button type="submit" variant="outlined" disabled={!detailsChanged} loading={savingDetails}>
                  Save
                </Button>
              </Stack>
            </>
          )}

          {details?.hr_notes && !isHr && (
            <>
              <Divider sx={{ my: 3 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                HR notes
              </Typography>
              <Typography variant="body2" aria-label="HR notes" sx={{ whiteSpace: 'pre-wrap' }}>
                {details.hr_notes}
              </Typography>
            </>
          )}

          {a.note && (
            <>
              <Divider sx={{ my: 3 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                Note from the applicant
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {a.note}
              </Typography>
            </>
          )}

          <Divider sx={{ my: 3 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
            Timeline
          </Typography>
          <Stack component="ol" aria-label="Timeline" spacing={2} sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {[...events].reverse().map((e) => (
              <Box component="li" key={e.id} sx={{ borderLeft: 2, borderColor: 'divider', pl: 1.5 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                  {e.kind === 'undo' && <UndoIcon fontSize="small" sx={{ color: 'text.secondary' }} />}
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 500, textDecoration: e.undone_at ? 'line-through' : undefined }}
                  >
                    {e.kind === 'undo' ? 'Moved back to' : 'Moved to'} {STAGE_LABELS[e.to_stage]}
                  </Typography>
                  {e.undone_at && <Chip label="Undone" size="small" variant="outlined" />}
                </Stack>
                <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
                  From {STAGE_LABELS[e.from_stage]} · {nameOf(e.created_by)} · {formatDayTime(e.created_at)}
                </Typography>
                {e.test_score != null && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    Test score {e.test_score}/5
                  </Typography>
                )}
                {e.interview_questions && e.interview_ratings && (
                  <Box component="dl" sx={{ mt: 0.5, mb: 0 }}>
                    {e.interview_questions.map((q, i) => (
                      <Stack key={q} direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                        <Typography component="dt" variant="caption" sx={{ color: 'text.secondary' }}>
                          {q.split(':')[0]}
                        </Typography>
                        <Typography component="dd" variant="caption" sx={{ m: 0, fontWeight: 500 }}>
                          {e.interview_ratings![i]}/5
                        </Typography>
                      </Stack>
                    ))}
                  </Box>
                )}
                {e.reason && (
                  <Typography
                    variant="body2"
                    sx={{ mt: 0.75, p: 1, bgcolor: 'grey.50', borderRadius: 1, whiteSpace: 'pre-wrap' }}
                  >
                    {e.reason}
                  </Typography>
                )}
              </Box>
            ))}
            <Box component="li" sx={{ borderLeft: 2, borderColor: 'divider', pl: 1.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                Applied
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {formatDayTime(a.created_at)}
              </Typography>
            </Box>
          </Stack>
        </Box>
      </Stack>

      <ConfirmDialog
        open={!!removing}
        title="Remove test file?"
        message={`${removing?.file_name ?? 'The file'} will be deleted.`}
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={removeTest}
        onClose={() => setRemoving(null)}
      />

      <FormDialog
        open={undoing}
        title={undo ? `Move back to ${STAGE_LABELS[undo.from_stage]}?` : 'Undo'}
        submitLabel="Undo move"
        busy={busy}
        onSubmit={undoMove}
        onClose={() => setUndoing(false)}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          The move to {undo && STAGE_LABELS[undo.to_stage]} stays in the timeline, marked undone.
        </Typography>
        <TextField
          label="Comment"
          placeholder="Optional"
          multiline
          minRows={2}
          value={undoReason}
          onChange={(e) => setUndoReason(e.target.value)}
          fullWidth
        />
      </FormDialog>
    </Dialog>
  )
}
