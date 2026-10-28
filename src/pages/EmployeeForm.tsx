import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  type TextFieldProps,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useAuth } from '../auth/AuthProvider'
import Documents from '../components/Documents'
import { ConfirmDialog, PageHeader, PersonAvatar, StatusChip } from '../components/common'
import { DOCS_BUCKET, supabase } from '../lib/supabase'
import {
  APP_ROLE_LABELS,
  COMPANY_DOMAIN,
  EMPLOYMENT_TYPE_LABELS,
  STATUS_LABELS,
  formatEmployeeNumber,
} from '../lib/constants'
import type { Department, Designation, Employee } from '../lib/types'

const EMPTY = {
  full_name: '',
  company_email: '',
  date_of_joining: '',
  date_of_separation: '',
  personal_email: '',
  phone: '',
  cnic_number: '',
  cnic_expiry: '',
  dob: '',
  department_id: '',
  designation_id: '',
  bank: '',
  iban: '',
  emergency_contact: '',
  employment_type: 'full_time',
  status: 'joining',
  app_role: 'member',
}
type FormState = typeof EMPTY
type FieldName = keyof FormState

function toForm(e: Employee): FormState {
  const form = { ...EMPTY }
  for (const key of Object.keys(EMPTY) as FieldName[]) form[key] = e[key] ?? ''
  return form
}

function toPayload(form: FormState) {
  const payload: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(form)) payload[key] = value.trim() || null
  payload.company_email = form.company_email.trim().toLowerCase()
  return payload
}

function friendlyError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'An employee with this company email already exists.'
  if (error.code === '23514' && error.message.includes('company_email'))
    return `Company email must be an @${COMPANY_DOMAIN} address.`
  if (error.message.includes('employees_designation')) return 'Pick a designation from the selected department.'
  return error.message
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>
        {description}
      </Typography>
      <Grid container spacing={2.5}>
        {children}
      </Grid>
    </Paper>
  )
}

function Cell({ wide, children }: { wide?: boolean; children: ReactNode }) {
  return <Grid size={wide ? 12 : { xs: 12, sm: 6, md: 4 }}>{children}</Grid>
}

// On an existing record the documents get their own tab, kept in the URL
// (?tab=documents) so it can be linked to.
const TABS = [
  { value: 'details', label: 'Details' },
  { value: 'documents', label: 'Documents' },
]

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => (
    <MenuItem key={value} value={value}>
      {label}
    </MenuItem>
  ))

export default function EmployeeForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((t) => t.value === params.get('tab')) ?? TABS[0]
  const { isCompanyAdmin } = useAuth()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [loading, setLoading] = useState(!!id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [departments, setDepartments] = useState<Department[]>([])
  const [designations, setDesignations] = useState<Designation[]>([])

  useEffect(() => {
    Promise.all([
      supabase.from('departments').select('id, name, description').order('name'),
      supabase.from('designations').select('id, department_id, title, description').order('title'),
    ]).then(([departmentsRes, designationsRes]) => {
      const loadError = departmentsRes.error ?? designationsRes.error
      if (loadError) setError(loadError.message)
      else {
        setDepartments(departmentsRes.data as Department[])
        setDesignations(designationsRes.data as Designation[])
      }
    })
  }, [])

  const departmentName = (departmentId: string | null) => departments.find((d) => d.id === departmentId)?.name
  const designationTitle = (designationId: string | null) => designations.find((d) => d.id === designationId)?.title
  const departmentDesignations = designations.filter((d) => d.department_id === form.department_id)

  useEffect(() => {
    if (!id) {
      setEmployee(null)
      setForm(EMPTY)
      return
    }
    setLoading(true)
    supabase
      .from('employees')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        else if (!data) setError('Employee not found.')
        else {
          setEmployee(data as Employee)
          setForm(toForm(data as Employee))
        }
        setLoading(false)
      })
  }, [id])

  const field = (name: FieldName, label: string, props: TextFieldProps = {}): TextFieldProps => ({
    label,
    fullWidth: true,
    value: form[name],
    onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })),
    ...(props.type === 'date' ? { slotProps: { inputLabel: { shrink: true } } } : {}),
    ...props,
  })

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const payload = toPayload(form)
    // Only company admins may set roles, or change a company email (it is the
    // login); leave those columns out so the DB guard isn't tripped.
    if (!isCompanyAdmin) {
      delete payload.app_role
      if (id) delete payload.company_email
    }

    const table = supabase.from('employees')
    const { data, error: saveError } = await (
      id ? table.update(payload).eq('id', id) : table.insert([payload])
    )
      .select()
      .single()
    setBusy(false)
    if (saveError) return setError(friendlyError(saveError))

    if (id) {
      setEmployee(data as Employee)
      setForm(toForm(data as Employee))
      setSaved(true)
    } else {
      navigate(`/employees/${(data as Employee).id}`, { replace: true })
    }
  }

  async function remove() {
    if (!employee) return
    setBusy(true)
    setError(null)

    const docs = await supabase
      .from('employee_documents')
      .select('storage_path')
      .eq('employee_id', employee.id)
    let failure = docs.error
    if (!failure) failure = (await supabase.from('employees').delete().eq('id', employee.id)).error
    setBusy(false)
    setConfirmDelete(false)
    if (failure) return setError(failure.message)
    // A file can only be removed once no document row points at it, so the
    // record (and its rows, by cascade) goes first. The record is gone either
    // way, so a failure here leaves only unreachable files behind.
    const paths = (docs.data ?? []).map((d) => d.storage_path as string)
    if (paths.length) await supabase.storage.from(DOCS_BUCKET).remove(paths)
    navigate('/employees', { replace: true })
  }

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (id && !employee) {
    return (
      <>
        <PageHeader title="Employee" back="/employees" />
        <Alert severity="error">{error}</Alert>
      </>
    )
  }

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <PageHeader
        back="/employees"
        title={
          employee ? (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }} component="span">
              <PersonAvatar name={employee.full_name} size={40} />
              <span>{employee.full_name}</span>
            </Stack>
          ) : (
            'New employee'
          )
        }
        subtitle={
          employee
            ? [
                formatEmployeeNumber(employee.employee_number),
                designationTitle(employee.designation_id),
                departmentName(employee.department_id),
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Create a new employee record'
        }
        actions={employee && <StatusChip status={employee.status} size="medium" />}
      />

      {employee && (
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
          <Tabs
            value={tab.value}
            onChange={(_e, value: string) => setParams(value === 'details' ? {} : { tab: value }, { replace: true })}
            variant="scrollable"
            allowScrollButtonsMobile
          >
            {TABS.map((t) => (
              <Tab key={t.value} value={t.value} label={t.label} />
            ))}
          </Tabs>
        </Box>
      )}

      {employee && tab.value === 'documents' ? (
        <Documents employeeId={employee.id} />
      ) : (
        <Stack spacing={3}>
          <Box component="form" onSubmit={save}>
            <Stack spacing={3}>
              <Section title="Employment" description="Role, status and access to Elevance People.">
                <Cell>
                  <TextField {...field('full_name', 'Full name', { required: true })} />
                </Cell>
                <Cell>
                  <TextField
                    {...field('company_email', 'Company email', {
                      required: true,
                      type: 'email',
                      placeholder: `name@${COMPANY_DOMAIN}`,
                      // It is the login, so once the record exists only a company admin changes it.
                      disabled: !!id && !isCompanyAdmin,
                      helperText: id && !isCompanyAdmin ? 'Only a company admin can change this' : undefined,
                      slotProps: {
                        htmlInput: {
                          pattern: `.+@${COMPANY_DOMAIN.replace('.', '\\.')}`,
                          title: `Must be an @${COMPANY_DOMAIN} address`,
                        },
                      },
                    })}
                  />
                </Cell>
                <Cell>
                  <TextField
                    {...field('department_id', 'Department', {
                      select: true,
                      // A designation only belongs to one department, so a department change clears it.
                      onChange: (e) => {
                        const value = e.target.value
                        setForm((f) => ({
                          ...f,
                          department_id: value,
                          designation_id: designations.some((d) => d.id === f.designation_id && d.department_id === value)
                            ? f.designation_id
                            : '',
                        }))
                      },
                      helperText: departments.length
                        ? undefined
                        : isCompanyAdmin
                          ? 'Add departments under Company → Departments'
                          : 'No departments set up yet. Ask a company admin.',
                    })}
                  >
                    <MenuItem value="">
                      <em>None</em>
                    </MenuItem>
                    {departments.map((d) => (
                      <MenuItem key={d.id} value={d.id}>
                        {d.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </Cell>
                <Cell>
                  <TextField
                    {...field('designation_id', 'Designation', {
                      select: true,
                      disabled: !form.department_id,
                      helperText: !form.department_id
                        ? 'Pick a department first'
                        : departmentDesignations.length
                          ? undefined
                          : 'This department has no designations yet',
                    })}
                  >
                    <MenuItem value="">
                      <em>None</em>
                    </MenuItem>
                    {departmentDesignations.map((d) => (
                      <MenuItem key={d.id} value={d.id}>
                        {d.title}
                      </MenuItem>
                    ))}
                  </TextField>
                </Cell>
                <Cell>
                  <TextField {...field('employment_type', 'Employment type', { select: true })}>
                    {options(EMPLOYMENT_TYPE_LABELS)}
                  </TextField>
                </Cell>
                <Cell>
                  <TextField
                    {...field('status', 'Status', {
                      select: true,
                      // Mirrors employees_offboarding.
                      helperText:
                        form.status === 'notice_period' && employee?.status !== 'notice_period'
                          ? 'Saving starts their offboarding'
                          : employee?.status === 'notice_period' && ['probation', 'active'].includes(form.status)
                            ? 'Saving cancels their offboarding'
                            : undefined,
                    })}
                  >
                    {options(STATUS_LABELS)}
                  </TextField>
                </Cell>
                <Cell>
                  <TextField {...field('date_of_joining', 'Date of joining', { type: 'date', required: true })} />
                </Cell>
                <Cell>
                  <TextField {...field('date_of_separation', 'Date of separation', { type: 'date' })} />
                </Cell>
                <Cell>
                  <TextField
                    {...field('app_role', 'Access role', {
                      select: true,
                      disabled: !isCompanyAdmin,
                      helperText: isCompanyAdmin ? undefined : 'Only a company admin can change this',
                    })}
                  >
                    {options(APP_ROLE_LABELS)}
                  </TextField>
                </Cell>
              </Section>

              <Section title="Personal" description="Contact and identity details.">
                <Cell>
                  <TextField {...field('personal_email', 'Personal email', { type: 'email' })} />
                </Cell>
                <Cell>
                  <TextField {...field('phone', 'Phone number', { type: 'tel' })} />
                </Cell>
                <Cell>
                  <TextField {...field('dob', 'Date of birth', { type: 'date' })} />
                </Cell>
                <Cell>
                  <TextField {...field('cnic_number', 'CNIC number', { placeholder: '00000-0000000-0' })} />
                </Cell>
                <Cell>
                  <TextField {...field('cnic_expiry', 'CNIC expiry', { type: 'date' })} />
                </Cell>
                <Cell wide>
                  <TextField
                    {...field('emergency_contact', 'Emergency contact details', {
                      multiline: true,
                      minRows: 3,
                      placeholder: 'Name, relationship, phone number',
                    })}
                  />
                </Cell>
              </Section>

              <Section title="Bank" description="Where salary is paid.">
                <Cell>
                  <TextField {...field('bank', 'Bank')} />
                </Cell>
                <Cell>
                  <TextField {...field('iban', 'IBAN')} />
                </Cell>
              </Section>

              {error && <Alert severity="error">{error}</Alert>}

              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                {employee && isCompanyAdmin && (
                  <Button
                    color="error"
                    startIcon={<DeleteOutlineIcon />}
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                  >
                    Delete employee
                  </Button>
                )}
                <Box sx={{ flexGrow: 1 }} />
                <Button component={Link} to="/employees" disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="contained" loading={busy}>
                  {employee ? 'Save changes' : 'Create employee'}
                </Button>
              </Stack>
            </Stack>
          </Box>

          {!employee && (
            <Alert severity="info" variant="outlined">
              Documents can be uploaded after the employee is created.
            </Alert>
          )}
        </Stack>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete employee?"
        message={`${employee?.full_name} and all their documents will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
      <Snackbar
        open={saved}
        autoHideDuration={3000}
        onClose={() => setSaved(false)}
        message="Changes saved"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  )
}
