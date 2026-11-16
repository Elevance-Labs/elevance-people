import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Grid,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import WorkOutlineIcon from '@mui/icons-material/WorkOutlined'
import { CareersFrame, Perks } from '../../components/Careers'
import { useBrandingParam, usePageTitle, usePublicBranding } from '../../components/useCareers'
import { RichTextView } from '../../components/RichTextView'
import { APPLICATIONS_BUCKET, supabase } from '../../lib/supabase'
import { COMPANY_NAME, CV_MAX_BYTES, formatDate, SALARY_CURRENCIES } from '../../lib/constants'
import { applicationError, MAX_NOTICE_DAYS } from '../../lib/hiring'
import type { JobPosting as Posting, SalaryCurrency } from '../../lib/types'

const EMPTY = {
  full_name: '',
  email: '',
  phone: '',
  current_salary: '',
  expected_salary: '',
  current_benefits: '',
  switch_reason: '',
  notice_period_days: '',
  note: '',
}

// Public: reached without signing in (see App.tsx). It reads only through
// the job_posting and public_branding functions, and applies through
// submit_application after uploading the CV into the job's folder.
export default function JobPosting() {
  const { id = '' } = useParams()
  const { branding, loaded } = usePublicBranding()
  const { branded, query } = useBrandingParam()
  const [job, setJob] = useState<Posting | null>(null)
  const [jobLoaded, setJobLoaded] = useState(false)

  useEffect(() => {
    setJobLoaded(false)
    supabase
      .rpc('job_posting', { p_id: id })
      .maybeSingle()
      .then(({ data }) => {
        // A malformed id is just a job that doesn't exist.
        setJob((data as Posting | null) ?? null)
        setJobLoaded(true)
      })
  }, [id])

  usePageTitle(job ? `${job.title} · ${COMPANY_NAME}` : `Careers · ${COMPANY_NAME}`)
  const allJobs = (
    <Button component={Link} to={`/careers${query}`} color="inherit" startIcon={<ArrowBackIcon />} sx={{ ml: -1 }}>
      All open positions
    </Button>
  )

  return (
    <CareersFrame branding={branding} branded={branded}>
      {!loaded || !jobLoaded ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 12 }}>
          <CircularProgress />
        </Box>
      ) : !job ? (
        <Container maxWidth="sm" sx={{ py: 10, textAlign: 'center' }}>
          <WorkOutlineIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
          <Typography variant="h5" component="h1" sx={{ mt: 2 }}>
            This job isn’t open
          </Typography>
          <Typography sx={{ color: 'text.secondary', mt: 1, mb: 3 }}>
            It may have been filled or closed, or the link may be wrong.
          </Typography>
          <Button component={Link} to={`/careers${query}`} variant="outlined">
            See open positions
          </Button>
        </Container>
      ) : (
        <>
          <Box sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}>
            <Container maxWidth="lg" sx={{ pt: { xs: 2, md: 3 }, pb: { xs: 4, md: 6 } }}>
              <Box sx={{ mb: { xs: 1.5, md: 2 }, opacity: 0.9 }}>{allJobs}</Box>
              <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
                {job.title}
              </Typography>
              <Stack
                direction="row"
                spacing={2.5}
                sx={{ mt: 1.5, opacity: 0.9, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}
              >
                <Typography>{[job.designation, job.department].join(' · ')}</Typography>
                {job.due_date && (
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <EventOutlinedIcon fontSize="small" />
                    <Typography>Apply by {formatDate(job.due_date)}</Typography>
                  </Stack>
                )}
              </Stack>
            </Container>
          </Box>

          <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
            <Grid container spacing={{ xs: 3, md: 4 }}>
              <Grid size={{ xs: 12, md: 7, lg: 8 }}>
                <Stack spacing={3}>
                  <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 } }}>
                    {job.description ? (
                      <RichTextView html={job.description} />
                    ) : (
                      <Typography sx={{ color: 'text.secondary' }}>No description yet.</Typography>
                    )}
                  </Paper>
                  {!!branding?.perks.length && <Perks perks={branding.perks} />}
                </Stack>
              </Grid>
              <Grid size={{ xs: 12, md: 5, lg: 4 }}>
                <Box sx={{ position: { md: 'sticky' }, top: { md: 24 } }}>
                  <ApplyForm job={job} />
                </Box>
              </Grid>
            </Grid>
          </Container>
        </>
      )}
    </CareersFrame>
  )
}

function ApplyForm({ job }: { job: Posting }) {
  const [form, setForm] = useState(EMPTY)
  const [currency, setCurrency] = useState<SalaryCurrency>('PKR')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const field = (name: keyof typeof EMPTY) => ({
    value: form[name],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [name]: e.target.value })),
    fullWidth: true,
  })

  function pick(picked: File | undefined) {
    setError(null)
    if (picked && picked.type !== 'application/pdf') setError('Your CV must be a PDF.')
    else if (picked && picked.size > CV_MAX_BYTES) setError('Your CV is larger than 6 MB.')
    else return setFile(picked ?? null)
    setFile(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const current = form.current_salary.trim()
    if (!/^\d+$/.test(current)) return setError('Enter your current salary as a whole number.')
    const salary = form.expected_salary.trim()
    if (!/^\d+$/.test(salary)) return setError('Enter your expected salary as a whole number of rupees.')
    const notice = form.notice_period_days.trim()
    if (notice && (!/^\d+$/.test(notice) || Number(notice) > MAX_NOTICE_DAYS)) {
      return setError(`Enter your notice period as a whole number of days, up to ${MAX_NOTICE_DAYS}.`)
    }
    if (!file) return setError('Attach your CV as a PDF.')
    setBusy(true)
    setError(null)
    // The storage policy only accepts files in the folder of a job that's taking applications.
    const path = `${job.id}/${crypto.randomUUID()}.pdf`
    const uploaded = await supabase.storage
      .from(APPLICATIONS_BUCKET)
      .upload(path, file, { contentType: 'application/pdf' })
    if (uploaded.error) {
      setBusy(false)
      return setError(`Your CV couldn’t be uploaded. ${uploaded.error.message}`)
    }
    const { error: submitError } = await supabase.rpc('submit_application', {
      p_job_opening_id: job.id,
      p_full_name: form.full_name,
      p_email: form.email,
      p_phone: form.phone,
      p_current_salary: Number(current),
      p_current_salary_currency: currency,
      p_expected_salary: Number(salary),
      p_current_benefits: form.current_benefits,
      p_switch_reason: form.switch_reason,
      p_notice_period_days: notice ? Number(notice) : null,
      p_note: form.note,
      p_resume_path: path,
      p_resume_name: file.name,
    })
    setBusy(false)
    if (submitError) return setError(applicationError(submitError))
    setDone(true)
  }

  if (done) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, sm: 4 }, textAlign: 'center' }}>
          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48 }} />
          <Typography variant="h6" component="h2" sx={{ mt: 1 }}>
            Application sent
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
            Thanks, {form.full_name.trim().split(/\s+/)[0]}. We’ve received your application for {job.title} and will
            be in touch.
          </Typography>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Typography variant="h6" component="h2">
          Apply for this job
        </Typography>
        {!job.accepting ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            Applications for this job closed on {formatDate(job.due_date)}.
          </Alert>
        ) : (
          <Stack component="form" spacing={2} sx={{ mt: 2 }} onSubmit={submit}>
            <TextField label="Full name (as per CNIC)" required autoComplete="name" {...field('full_name')} />
            <TextField label="Email address" required type="email" autoComplete="email" {...field('email')} />
            <TextField label="Phone number" required type="tel" autoComplete="tel" {...field('phone')} />
            <Stack direction="row" spacing={1.5}>
              <TextField
                select
                label="Currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as SalaryCurrency)}
                sx={{ width: 104, flexShrink: 0 }}
              >
                {SALARY_CURRENCIES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Current salary"
                required
                type="number"
                helperText="Per month"
                slotProps={{ htmlInput: { min: 0, step: 1, inputMode: 'numeric' } }}
                {...field('current_salary')}
              />
            </Stack>
            <TextField
              label="Expected salary"
              required
              type="number"
              helperText="Per month, in Pakistani rupees"
              slotProps={{
                input: { startAdornment: <InputAdornment position="start">PKR</InputAdornment> },
                htmlInput: { min: 0, step: 1, inputMode: 'numeric' },
              }}
              {...field('expected_salary')}
            />
            <Box>
              <Button
                component="label"
                variant="outlined"
                fullWidth
                startIcon={<AttachFileIcon />}
                sx={{ justifyContent: 'flex-start', py: 1 }}
              >
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file ? file.name : 'Attach CV / resume *'}
                </Box>
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
              </Button>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, ml: 1.75 }}>
                One PDF, up to 6 MB
              </Typography>
            </Box>
            <TextField
              label="Current employer benefits"
              multiline
              minRows={2}
              placeholder="Health cover, bonuses, allowances… (optional)"
              slotProps={{ htmlInput: { maxLength: 2000 } }}
              {...field('current_benefits')}
            />
            <TextField
              label="Reason for switching"
              multiline
              minRows={2}
              placeholder="Optional"
              slotProps={{ htmlInput: { maxLength: 2000 } }}
              {...field('switch_reason')}
            />
            <TextField
              label="Notice period"
              type="number"
              placeholder="Optional"
              slotProps={{
                input: { endAdornment: <InputAdornment position="end">days</InputAdornment> },
                htmlInput: { min: 0, max: MAX_NOTICE_DAYS, step: 1, inputMode: 'numeric' },
              }}
              {...field('notice_period_days')}
            />
            <TextField
              label="Notes"
              multiline
              minRows={3}
              placeholder="Anything else you’d like us to know (optional)"
              slotProps={{ htmlInput: { maxLength: 5000 } }}
              {...field('note')}
            />
            {error && <Alert severity="error">{error}</Alert>}
            <Button type="submit" variant="contained" size="large" loading={busy}>
              Submit application
            </Button>
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
