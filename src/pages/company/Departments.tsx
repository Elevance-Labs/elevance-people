import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Button,
  IconButton,
  LinearProgress,
  Link as MuiLink,
  MenuItem,
  Paper,
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
import { configError, countOf, trimOrNull, type Count } from '../../lib/company'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import { BUSINESS_FUNCTION_LABELS } from '../../lib/constants'
import type { BusinessFunction, Department } from '../../lib/types'

type Row = Department & { designations: Count; employees: Count }

const EMPTY = { name: '', description: '', business_function: '' as BusinessFunction | '' }

export default function Departments() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('departments')
      .select(
        'id, name, description, business_function, designations!designations_department_id_fkey(count), employees!employees_department_id_fkey(count)',
      )
      .order('name')
    if (loadError) setError(loadError.message)
    else setRows(data as unknown as Row[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openEditor(row: Row | 'new') {
    setForm(
      row === 'new'
        ? EMPTY
        : { name: row.name, description: row.description ?? '', business_function: row.business_function ?? '' },
    )
    setFormError(null)
    setEditing(row)
  }

  async function save() {
    if (!editing) return
    // Older departments may have none; every save sets one.
    if (!form.business_function) return setFormError('Choose the business function.')
    setBusy(true)
    setFormError(null)
    const payload = {
      name: form.name.trim(),
      description: trimOrNull(form.description),
      business_function: form.business_function,
    }
    const table = supabase.from('departments')
    const { error: saveError } = await (editing === 'new'
      ? table.insert(payload)
      : table.update(payload).eq('id', editing.id))
    setBusy(false)
    if (saveError) {
      return setFormError(configError(saveError, 'A department with this name already exists.', saveError.message))
    }
    setEditing(null)
    load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('departments').delete().eq('id', deleting.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) {
      return setError(
        configError(deleteError, deleteError.message, 'Employees or job openings are still linked to this department or its designations.'),
      )
    }
    load()
  }

  return (
    <>
      <PageHeader
        title="Departments"
        subtitle={loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'department' : 'departments'}`}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEditor('new')}>
            Add department
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Department</TableCell>
                <TableCell>Function</TableCell>
                <TableCell align="right">Designations</TableCell>
                <TableCell align="right">Employees</TableCell>
                <TableCell align="right" sx={{ width: 112 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const employees = countOf(r.employees)
                return (
                  <TableRow key={r.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {r.name}
                      </Typography>
                      {r.description && (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {r.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ color: r.business_function ? undefined : 'text.secondary' }}>
                      {r.business_function ? BUSINESS_FUNCTION_LABELS[r.business_function] : 'Not set'}
                    </TableCell>
                    <TableCell align="right">
                      <MuiLink component={Link} to={`/company/designations?department=${r.id}`}>
                        {countOf(r.designations)}
                      </MuiLink>
                    </TableCell>
                    <TableCell align="right">{employees}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton aria-label={`Edit ${r.name}`} onClick={() => openEditor(r)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      <Tooltip title={employees ? 'Move its employees to another department first' : ''}>
                        <span>
                          <IconButton
                            aria-label={`Delete ${r.name}`}
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
              {!loading && !rows.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    No departments yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? 'Add department' : 'Edit department'}
        submitLabel={editing === 'new' ? 'Add' : 'Save'}
        error={formError}
        busy={busy}
        onSubmit={save}
        onClose={() => setEditing(null)}
      >
        <TextField
          label="Name"
          required
          autoFocus
          fullWidth
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <TextField
          select
          label="Business function"
          required
          fullWidth
          value={form.business_function}
          onChange={(e) => setForm((f) => ({ ...f, business_function: e.target.value as BusinessFunction }))}
          helperText="Decides which guides its people see under Resources."
        >
          {(Object.keys(BUSINESS_FUNCTION_LABELS) as BusinessFunction[]).map((v) => (
            <MenuItem key={v} value={v}>
              {BUSINESS_FUNCTION_LABELS[v]}
            </MenuItem>
          ))}
        </TextField>
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
        title="Delete department?"
        message={
          deleting && countOf(deleting.designations)
            ? `${deleting.name} and its ${countOf(deleting.designations)} designation(s), including their KPIs, will be deleted.`
            : `${deleting?.name} will be deleted.`
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
