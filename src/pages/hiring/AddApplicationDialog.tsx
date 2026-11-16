import { useRef, useState } from 'react'
import { Box, Button, Divider, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import { FormDialog } from '../../components/common'
import { APPLICATIONS_BUCKET, supabase } from '../../lib/supabase'
import { CV_MAX_BYTES, SALARY_CURRENCIES, STAGE_LABELS } from '../../lib/constants'
import { ADD_STAGES, MAX_NOTICE_DAYS, NEEDS_TEXT, addApplicationError } from '../../lib/hiring'
import type { ApplicationStage, SalaryCurrency } from '../../lib/types'

const EMPTY = {
  reason: '',
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

const wholeOrBlank = (v: string) => !v || /^\d+$/.test(v)

// HR adds an application received outside the public page (email, a
// referral, a job board) to an open job, straight into one of the early
// stages. The CV is uploaded into the job's folder first, then
// application_add writes the application and its first move; a failed add
// removes the upload.
export default function AddApplicationDialog({
  jobs,
  defaultJobId,
  onAdded,
  onClose,
}: {
  // Open jobs only: the database refuses any other.
  jobs: { id: string; title: string }[]
  defaultJobId: string
  onAdded: (jobId: string, applicationId: string, stage: ApplicationStage, name: string) => void
  onClose: () => void
}) {
  const [jobId, setJobId] = useState(jobs.some((j) => j.id === defaultJobId) ? defaultJobId : (jobs[0]?.id ?? ''))
  const [stage, setStage] = useState<ApplicationStage>('screened')
  const [form, setForm] = useState(EMPTY)
  const [currency, setCurrency] = useState<SalaryCurrency>('PKR')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const needsRemarks = NEEDS_TEXT.includes(stage)
  const field = (name: keyof typeof EMPTY) => ({
    value: form[name],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [name]: e.target.value })),
    fullWidth: true,
  })

  function pick(picked: File | undefined) {
    setError(null)
    if (picked && picked.type !== 'application/pdf') setError('The CV must be a PDF.')
    else if (picked && picked.size > CV_MAX_BYTES) setError('The CV is larger than 6 MB.')
    else return setFile(picked ?? null)
    setFile(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function submit() {
    const current = form.current_salary.trim()
    const expected = form.expected_salary.trim()
    const notice = form.notice_period_days.trim()
    if (!jobId) return setError('Pick the job.')
    if (needsRemarks && !form.reason.trim()) return setError(`Give remarks for adding at ${STAGE_LABELS[stage]}.`)
    if (!wholeOrBlank(current) || !wholeOrBlank(expected)) return setError('Enter salaries as whole numbers.')
    if (!wholeOrBlank(notice) || Number(notice) > MAX_NOTICE_DAYS) {
      return setError(`Enter the notice period as a whole number of days, up to ${MAX_NOTICE_DAYS}.`)
    }
    if (!file) return setError('Attach the CV as a PDF.')
    setBusy(true)
    setError(null)
    const path = `${jobId}/${crypto.randomUUID()}.pdf`
    const bucket = supabase.storage.from(APPLICATIONS_BUCKET)
    const uploaded = await bucket.upload(path, file, { contentType: 'application/pdf' })
    if (uploaded.error) {
      setBusy(false)
      return setError(`The CV couldn’t be uploaded. ${uploaded.error.message}`)
    }
    const { data, error: addError } = await supabase.rpc('application_add', {
      p_job_opening_id: jobId,
      p_stage: stage,
      p_reason: form.reason.trim() || null,
      p_full_name: form.full_name,
      p_email: form.email,
      p_phone: form.phone,
      p_current_salary: current ? Number(current) : null,
      p_current_salary_currency: currency,
      p_expected_salary: expected ? Number(expected) : null,
      p_current_benefits: form.current_benefits,
      p_switch_reason: form.switch_reason,
      p_notice_period_days: notice ? Number(notice) : null,
      p_note: form.note,
      p_resume_path: path,
      p_resume_name: file.name,
    })
    if (addError) {
      await bucket.remove([path])
      setBusy(false)
      return setError(addApplicationError(addError))
    }
    setBusy(false)
    onAdded(jobId, data as string, stage, form.full_name.trim())
  }

  return (
    <FormDialog
      open
      title="Add application"
      submitLabel="Add application"
      closeButton
      error={error}
      busy={busy}
      onSubmit={submit}
      onClose={onClose}
    >
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        For a CV received outside the job’s public page. It goes straight into the stage you pick.
      </Typography>
      <TextField select label="Job" required value={jobId} onChange={(e) => setJobId(e.target.value)} fullWidth>
        {jobs.map((j) => (
          <MenuItem key={j.id} value={j.id}>
            {j.title}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Stage"
        required
        value={stage}
        onChange={(e) => setStage(e.target.value as ApplicationStage)}
        fullWidth
      >
        {ADD_STAGES.map((s) => (
          <MenuItem key={s} value={s}>
            {STAGE_LABELS[s]}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Remarks"
        required={needsRemarks}
        placeholder={needsRemarks ? undefined : 'Optional'}
        multiline
        minRows={2}
        slotProps={{ htmlInput: { maxLength: 2000 } }}
        {...field('reason')}
      />

      <Divider />
      <TextField label="Full name" required autoComplete="off" slotProps={{ htmlInput: { maxLength: 200 } }} {...field('full_name')} />
      <TextField label="Email address" required type="email" autoComplete="off" {...field('email')} />
      <TextField label="Phone number" required type="tel" autoComplete="off" {...field('phone')} />
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
          type="number"
          placeholder="Optional"
          helperText="Per month"
          slotProps={{ htmlInput: { min: 0, step: 1, inputMode: 'numeric' } }}
          {...field('current_salary')}
        />
      </Stack>
      <TextField
        label="Expected salary"
        type="number"
        placeholder="Optional"
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
            {file ? file.name : 'Attach CV *'}
          </Box>
          <input ref={fileInput} hidden type="file" accept="application/pdf" onChange={(e) => pick(e.target.files?.[0])} />
        </Button>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, ml: 1.75 }}>
          One PDF, up to 6 MB
        </Typography>
      </Box>
      <TextField
        label="Current employer benefits"
        multiline
        minRows={2}
        placeholder="Optional"
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
        minRows={2}
        placeholder="From the applicant (optional)"
        slotProps={{ htmlInput: { maxLength: 5000 } }}
        {...field('note')}
      />
    </FormDialog>
  )
}
