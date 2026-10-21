import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  CssBaseline,
  Grid,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
} from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import WorkOutlineIcon from '@mui/icons-material/WorkOutlined'
import { Logo } from '../../components/common'
import { RichTextView } from '../../components/RichTextView'
import { APPLICATIONS_BUCKET, supabase } from '../../lib/supabase'
import { COMPANY_NAME, CV_MAX_BYTES, formatDate } from '../../lib/constants'
import { applicationError, logoUrl } from '../../lib/hiring'
import { brandedTheme, DEFAULT_PRIMARY } from '../../theme'
import type { Branding, JobPosting as Posting } from '../../lib/types'

const EMPTY = { full_name: '', email: '', phone: '', expected_salary: '', note: '' }

// Public: reached without signing in (see App.tsx). It reads only through
// the job_posting and public_branding functions, and applies through
// submit_application after uploading the CV into the job's folder.
export default function JobPosting() {
  const { id = '' } = useParams()
  const [job, setJob] = useState<Posting | null>(null)
  const [branding, setBranding] = useState<Branding | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.rpc('job_posting', { p_id: id }).maybeSingle(),
      supabase.rpc('public_branding').maybeSingle(),
    ]).then(([jobRes, brandingRes]) => {
      // A malformed id is just a job that doesn't exist.
      setJob((jobRes.data as Posting | null) ?? null)
      setBranding((brandingRes.data as Branding | null) ?? null)
      setLoading(false)
    })
  }, [id])

  const color = branding?.primary_color ?? DEFAULT_PRIMARY
  const theme = useMemo(() => brandedTheme(color), [color])

  useEffect(() => {
    const previous = document.title
    document.title = job ? `${job.title} · ${COMPANY_NAME}` : `Careers · ${COMPANY_NAME}`
    return () => {
      document.title = previous
    }
  }, [job])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Box component="header" sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <Container maxWidth="lg" sx={{ py: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {branding?.logo_path ? (
              <Box
                component="img"
                src={logoUrl(branding.logo_path) ?? undefined}
                alt={COMPANY_NAME}
                sx={{ height: 36, maxWidth: 200, objectFit: 'contain' }}
              />
            ) : (
              <>
                <Logo />
                <Typography variant="h6" component="div">
                  {COMPANY_NAME}
                </Typography>
              </>
            )}
          </Container>
        </Box>

        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 12 }}>
            <CircularProgress />
          </Box>
        ) : !job ? (
          <Container maxWidth="sm" sx={{ py: 10, textAlign: 'center' }}>
            <WorkOutlineIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
            <Typography variant="h5" component="h1" sx={{ mt: 2 }}>
              This job isn’t open
            </Typography>
            <Typography sx={{ color: 'text.secondary', mt: 1 }}>
              It may have been filled or closed, or the link may be wrong.
            </Typography>
          </Container>
        ) : (
          <>
            <Box sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}>
              <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
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
      </Box>
    </ThemeProvider>
  )
}

function Perks({ perks }: { perks: Branding['perks'] }) {
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
        Perks and benefits
      </Typography>
      <Grid container spacing={2}>
        {perks.map((perk, i) => (
          <Grid key={i} size={{ xs: 12, sm: 6 }}>
            <Paper variant="outlined" sx={{ p: 2.5, height: '100%', borderLeft: 3, borderLeftColor: 'primary.main' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {perk.title}
              </Typography>
              {perk.description && (
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                  {perk.description}
                </Typography>
              )}
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  )
}

function ApplyForm({ job }: { job: Posting }) {
  const [form, setForm] = useState(EMPTY)
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
    const salary = form.expected_salary.trim()
    if (!/^\d+$/.test(salary)) return setError('Enter your expected salary as a whole number of rupees.')
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
      p_expected_salary: Number(salary),
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
            <TextField label="Full name" required autoComplete="name" {...field('full_name')} />
            <TextField label="Email address" required type="email" autoComplete="email" {...field('email')} />
            <TextField label="Phone number" required type="tel" autoComplete="tel" {...field('phone')} />
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
              label="Note"
              multiline
              minRows={3}
              placeholder="Anything you’d like us to know (optional)"
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
