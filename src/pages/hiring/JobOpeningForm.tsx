import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Grid,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutlined'
import { ConfirmDialog, JobStatusChip, PageHeader, PersonAvatar } from '../../components/common'
import { RichTextEditor } from '../../components/RichText'
import { supabase } from '../../lib/supabase'
import { JOB_STATUS_LABELS } from '../../lib/constants'
import {
  JOB_OPENING_WITH_NAMES,
  canHire,
  copyText,
  jobOpeningError,
  publicJobUrl,
  type JobOpeningWithNames,
} from '../../lib/hiring'
import { isBlankHtml, sanitizeHtml } from '../../lib/richText'
import type { Department, Designation, DirectoryEntry, JobOpeningStatus } from '../../lib/types'

const EMPTY = {
  title: '',
  department_id: '',
  designation_id: '',
  status: 'draft' as JobOpeningStatus,
  due_date: '',
  description: '',
  manager_id: '',
}
type FormState = typeof EMPTY

function toForm(j: JobOpeningWithNames): FormState {
  return {
    title: j.title,
    department_id: j.department_id,
    designation_id: j.designation_id,
    status: j.status,
    due_date: j.due_date ?? '',
    description: j.description ?? '',
    manager_id: j.manager_id ?? '',
  }
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {description}
        </Typography>
      )}
      <Stack spacing={2.5} sx={{ mt: 2.5 }}>
        {children}
      </Stack>
    </Paper>
  )
}

function PersonOption({ person }: { person: DirectoryEntry }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <PersonAvatar name={person.full_name} size={28} />
      <Box>
        <Typography variant="body2">{person.full_name}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {person.designation ?? person.company_email}
        </Typography>
      </Box>
    </Stack>
  )
}

export default function JobOpeningForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState<JobOpeningWithNames | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  // Interviewers as saved, to work out what to add and remove on save.
  const [savedInterviewers, setSavedInterviewers] = useState<string[]>([])
  const [interviewers, setInterviewers] = useState<string[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [designations, setDesignations] = useState<Designation[]>([])
  const [directory, setDirectory] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('departments').select('id, name, description').order('name'),
      supabase.from('designations').select('id, department_id, title, description').order('title'),
      supabase.from('employee_directory').select('*').order('full_name'),
    ]).then(([departmentsRes, designationsRes, directoryRes]) => {
      const loadError = departmentsRes.error ?? designationsRes.error ?? directoryRes.error
      if (loadError) setError(loadError.message)
      else {
        setDepartments(departmentsRes.data as Department[])
        setDesignations(designationsRes.data as Designation[])
        setDirectory(directoryRes.data as DirectoryEntry[])
      }
    })
  }, [])

  const load = useCallback(async (jobId: string) => {
    const [jobRes, interviewersRes] = await Promise.all([
      supabase.from('job_openings').select(JOB_OPENING_WITH_NAMES).eq('id', jobId).maybeSingle(),
      supabase.from('job_opening_interviewers').select('employee_id').eq('job_opening_id', jobId),
    ])
    const loadError = jobRes.error ?? interviewersRes.error
    if (loadError) setError(loadError.message)
    else if (!jobRes.data) setError('Job opening not found.')
    else {
      const loaded = jobRes.data as unknown as JobOpeningWithNames
      const ids = (interviewersRes.data ?? []).map((r) => r.employee_id as string)
      setJob(loaded)
      setForm(toForm(loaded))
      setSavedInterviewers(ids)
      setInterviewers(ids)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!id) {
      setJob(null)
      setForm(EMPTY)
      setSavedInterviewers([])
      setInterviewers([])
      setLoading(false)
      return
    }
    setLoading(true)
    load(id)
  }, [id, load])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const departmentDesignations = designations.filter((d) => d.department_id === form.department_id)
  const byId = new Map(directory.map((p) => [p.id, p]))
  // People who have left aren't offered, but stay listed if already chosen.
  const people = directory.filter(
    (p) => canHire(p) || p.id === form.manager_id || interviewers.includes(p.id),
  )
  const applications = job?.application_count ?? 0

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form.department_id || !form.designation_id) return setError('Pick a department and a designation.')
    setBusy(true)
    setError(null)
    const payload = {
      title: form.title.trim(),
      department_id: form.department_id,
      designation_id: form.designation_id,
      status: form.status,
      due_date: form.due_date || null,
      description: isBlankHtml(form.description) ? null : sanitizeHtml(form.description),
      manager_id: form.manager_id || null,
    }
    const table = supabase.from('job_openings')
    const { data, error: saveError } = await (id ? table.update(payload).eq('id', id) : table.insert([payload]))
      .select('id')
      .single()
    if (saveError) {
      setBusy(false)
      return setError(jobOpeningError(saveError))
    }

    const jobId = (data as { id: string }).id
    const removed = savedInterviewers.filter((p) => !interviewers.includes(p))
    const added = interviewers.filter((p) => !savedInterviewers.includes(p))
    let failure: { message: string } | null = null
    if (removed.length) {
      failure = (
        await supabase.from('job_opening_interviewers').delete().eq('job_opening_id', jobId).in('employee_id', removed)
      ).error
    }
    if (!failure && added.length) {
      failure = (
        await supabase
          .from('job_opening_interviewers')
          .insert(added.map((employee_id) => ({ job_opening_id: jobId, employee_id })))
      ).error
    }
    setBusy(false)

    if (failure) setError(`The job was saved, but its interviewers weren’t: ${failure.message}`)
    if (!id) return navigate(`/jobs/${jobId}`, { replace: true })
    await load(jobId)
    if (!failure) setNotice('Changes saved')
  }

  async function remove() {
    if (!job) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('job_openings').delete().eq('id', job.id)
    setBusy(false)
    setConfirmDelete(false)
    if (deleteError) return setError(jobOpeningError(deleteError))
    navigate('/jobs', { replace: true })
  }

  async function copyLink() {
    if (!job) return
    const url = publicJobUrl(job.id)
    setNotice((await copyText(url)) ? 'Public link copied' : url)
  }

  // Also while a just-created job's id has arrived but its record hasn't.
  if (loading || (id && job?.id !== id && !error)) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (id && !job) {
    return (
      <>
        <PageHeader title="Job opening" back="/jobs" />
        <Alert severity="error">{error}</Alert>
      </>
    )
  }

  return (
    <Box sx={{ maxWidth: 1200 }}>
      <PageHeader
        back="/jobs"
        title={job ? job.title : 'New job opening'}
        subtitle={
          job
            ? [job.designation?.title, job.department?.name].filter(Boolean).join(' · ')
            : 'Describe the role. Set it to Open to publish its application page.'
        }
        actions={job && <JobStatusChip status={job.status} size="medium" />}
      />

      <Box component="form" onSubmit={save}>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Stack spacing={3}>
              <Section title="Role">
                <TextField
                  label="Job title"
                  required
                  fullWidth
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="e.g. Senior Frontend Engineer"
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5}>
                  <TextField
                    select
                    label="Department"
                    required
                    fullWidth
                    value={form.department_id}
                    // A designation belongs to one department, so a department change clears it.
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        department_id: e.target.value,
                        designation_id: designations.some(
                          (d) => d.id === f.designation_id && d.department_id === e.target.value,
                        )
                          ? f.designation_id
                          : '',
                      }))
                    }
                    helperText={departments.length ? undefined : 'Add departments under Company → Departments'}
                  >
                    {departments.map((d) => (
                      <MenuItem key={d.id} value={d.id}>
                        {d.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="Designation"
                    required
                    fullWidth
                    disabled={!form.department_id}
                    value={form.designation_id}
                    onChange={(e) => set('designation_id', e.target.value)}
                    helperText={
                      !form.department_id
                        ? 'Pick a department first'
                        : departmentDesignations.length
                          ? undefined
                          : 'This department has no designations yet'
                    }
                  >
                    {departmentDesignations.map((d) => (
                      <MenuItem key={d.id} value={d.id}>
                        {d.title}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5}>
                  <TextField
                    select
                    label="Status"
                    fullWidth
                    value={form.status}
                    onChange={(e) => set('status', e.target.value as JobOpeningStatus)}
                    helperText="Only an open job has a public page"
                  >
                    {Object.entries(JOB_STATUS_LABELS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Due date"
                    type="date"
                    fullWidth
                    value={form.due_date}
                    onChange={(e) => set('due_date', e.target.value)}
                    helperText="Last day to apply. Leave empty to take applications until closed."
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </Stack>
              </Section>

              <Section title="Job description" description="Shown on the public application page.">
                <RichTextEditor
                  key={job?.id ?? 'new'}
                  label="Description"
                  value={form.description}
                  onChange={(html) => set('description', html)}
                  placeholder="About the role, responsibilities, requirements…"
                />
              </Section>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <Stack spacing={3}>
              <Section title="Hiring team">
                <Autocomplete
                  options={people}
                  value={byId.get(form.manager_id) ?? null}
                  onChange={(_e, value) => set('manager_id', value?.id ?? '')}
                  getOptionLabel={(p) => p.full_name}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderOption={({ key, ...props }, p) => (
                    <li key={key} {...props}>
                      <PersonOption person={p} />
                    </li>
                  )}
                  renderInput={(params) => <TextField {...params} label="Hiring manager" />}
                />
                <Autocomplete
                  multiple
                  options={people}
                  value={interviewers.map((p) => byId.get(p)).filter((p): p is DirectoryEntry => !!p)}
                  onChange={(_e, value) => setInterviewers(value.map((p) => p.id))}
                  getOptionLabel={(p) => p.full_name}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  filterSelectedOptions
                  renderOption={({ key, ...props }, p) => (
                    <li key={key} {...props}>
                      <PersonOption person={p} />
                    </li>
                  )}
                  renderInput={(params) => <TextField {...params} label="Interviewers" />}
                />
              </Section>

              {job && (
                <Section title="Public page">
                  {job.status === 'open' ? (
                    <>
                      <TextField
                        label="Link"
                        fullWidth
                        value={publicJobUrl(job.id)}
                        slotProps={{ htmlInput: { readOnly: true }, inputLabel: { shrink: true } }}
                        onFocus={(e) => e.target.select()}
                      />
                      <Stack direction="row" spacing={1}>
                        <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copyLink}>
                          Copy link
                        </Button>
                        <Button startIcon={<OpenInNewIcon />} href={publicJobUrl(job.id)} target="_blank" rel="noopener">
                          Open
                        </Button>
                      </Stack>
                    </>
                  ) : (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Not public while the job is {JOB_STATUS_LABELS[job.status].toLowerCase()}. Set it to Open and
                      save to publish its application page.
                    </Typography>
                  )}
                  <Button
                    component={Link}
                    to={`/applications?job=${job.id}`}
                    startIcon={<PeopleOutlineIcon />}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {applications === 1 ? '1 application' : `${applications} applications`}
                  </Button>
                </Section>
              )}
            </Stack>
          </Grid>
        </Grid>

        {error && (
          <Alert severity="error" sx={{ mt: 3 }}>
            {error}
          </Alert>
        )}

        <Stack direction="row" spacing={1.5} sx={{ mt: 3, alignItems: 'center' }}>
          {job && (
            <Tooltip title={applications ? 'Jobs with applications can’t be deleted. Close it instead.' : ''}>
              <span>
                <Button
                  color="error"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy || applications > 0}
                >
                  Delete job
                </Button>
              </span>
            </Tooltip>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Button component={Link} to="/jobs" disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={busy}>
            {job ? 'Save changes' : 'Create job opening'}
          </Button>
        </Stack>
      </Box>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete job opening?"
        message={`“${job?.title}” will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
      <Snackbar
        open={!!notice}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        message={notice}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  )
}
