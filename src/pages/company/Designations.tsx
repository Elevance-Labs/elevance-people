import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  IconButton,
  LinearProgress,
  Link as MuiLink,
  MenuItem,
  Paper,
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { supabase } from '../../lib/supabase'
import {
  DESIGNATION_WITH_DEPARTMENT,
  byDepartmentThenTitle,
  configError,
  countOf,
  trimOrNull,
  type Count,
  type DesignationWithDepartment,
} from '../../lib/company'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import type { Department } from '../../lib/types'

type Row = DesignationWithDepartment & { kpis: Count; employees: Count }

const EMPTY = { department_id: '', title: '', description: '' }

export default function Designations() {
  const [params, setParams] = useSearchParams()
  const departmentFilter = params.get('department') ?? ''
  const [rows, setRows] = useState<Row[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [designationsRes, departmentsRes] = await Promise.all([
      supabase
        .from('designations')
        .select(`${DESIGNATION_WITH_DEPARTMENT}, kpis(count), employees!employees_designation_fkey(count)`),
      supabase.from('departments').select('id, name, description').order('name'),
    ])
    const loadError = designationsRes.error ?? departmentsRes.error
    if (loadError) setError(loadError.message)
    else {
      setRows((designationsRes.data as unknown as Row[]).sort(byDepartmentThenTitle))
      setDepartments(departmentsRes.data as Department[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(
    () => rows.filter((r) => !departmentFilter || r.department_id === departmentFilter),
    [rows, departmentFilter],
  )

  function openEditor(row: Row | 'new') {
    setForm(
      row === 'new'
        ? { ...EMPTY, department_id: departmentFilter }
        : { department_id: row.department_id, title: row.title, description: row.description ?? '' },
    )
    setFormError(null)
    setEditing(row)
  }

  async function save() {
    if (!editing) return
    setBusy(true)
    setFormError(null)
    const payload = {
      department_id: form.department_id,
      title: form.title.trim(),
      description: trimOrNull(form.description),
    }
    const table = supabase.from('designations')
    const { error: saveError } = await (editing === 'new'
      ? table.insert(payload)
      : table.update(payload).eq('id', editing.id))
    setBusy(false)
    if (saveError) {
      return setFormError(
        configError(saveError, 'This department already has a designation with that title.', saveError.message),
      )
    }
    setEditing(null)
    load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('designations').delete().eq('id', deleting.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) {
      return setError(configError(deleteError, deleteError.message, 'Employees or job openings are still linked to this designation.'))
    }
    load()
  }

  const moving = editing && editing !== 'new' && form.department_id !== editing.department_id
  const movingEmployees = moving ? countOf(editing.employees) : 0

  return (
    <>
      <PageHeader
        title="Designations"
        subtitle={loading ? 'Loading…' : `${visible.length} ${visible.length === 1 ? 'designation' : 'designations'}`}
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openEditor('new')}
            disabled={!departments.length}
          >
            Add designation
          </Button>
        }
      />

      {!loading && !departments.length && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Designations belong to a department. <MuiLink component={Link} to="/company/departments">Add a department</MuiLink>{' '}
          first.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack direction="row" sx={{ p: 2 }}>
          <TextField
            select
            label="Department"
            value={departmentFilter}
            onChange={(e) => setParams(e.target.value ? { department: e.target.value } : {}, { replace: true })}
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="">All departments</MenuItem>
            {departments.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {d.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Designation</TableCell>
                <TableCell>Department</TableCell>
                <TableCell align="right">KPIs</TableCell>
                <TableCell align="right">Employees</TableCell>
                <TableCell align="right" sx={{ width: 112 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((r) => {
                const employees = countOf(r.employees)
                return (
                  <TableRow key={r.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {r.title}
                      </Typography>
                      {r.description && (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {r.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{r.department?.name}</TableCell>
                    <TableCell align="right">
                      <MuiLink component={Link} to={`/company/kpis?designation=${r.id}`}>
                        {countOf(r.kpis)}
                      </MuiLink>
                    </TableCell>
                    <TableCell align="right">{employees}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton aria-label={`Edit ${r.title}`} onClick={() => openEditor(r)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      <Tooltip title={employees ? 'Give its employees another designation first' : ''}>
                        <span>
                          <IconButton
                            aria-label={`Delete ${r.title}`}
                            disabled={employees > 0}
                            onClick={() => setDeleting(r)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && !visible.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {rows.length ? 'No designations in this department.' : 'No designations yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? 'Add designation' : 'Edit designation'}
        submitLabel={editing === 'new' ? 'Add' : 'Save'}
        error={formError}
        busy={busy}
        onSubmit={save}
        onClose={() => setEditing(null)}
      >
        <TextField
          select
          label="Department"
          required
          fullWidth
          value={form.department_id}
          onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}
          helperText={
            movingEmployees
              ? `The ${movingEmployees} employee(s) with this designation will move to the new department.`
              : undefined
          }
        >
          {departments.map((d) => (
            <MenuItem key={d.id} value={d.id}>
              {d.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Title"
          required
          autoFocus
          fullWidth
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <TextField
          label="Description"
          multiline
          minRows={2}
          fullWidth
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title="Delete designation?"
        message={
          deleting && countOf(deleting.kpis)
            ? `${deleting.title} and its ${countOf(deleting.kpis)} KPI(s) will be deleted.`
            : `${deleting?.title} will be deleted.`
        }
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
