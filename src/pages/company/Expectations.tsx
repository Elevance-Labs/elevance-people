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
  designationOptions,
  type DesignationWithDepartment,
} from '../../lib/company'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import type { Expectation } from '../../lib/types'

const EMPTY = { designation_id: '', title: '' }

// What each designation is expected to do. Every monthly review marks each
// one met or not, copied in when the review starts, so edits here reach only
// reviews started later.
export default function Expectations() {
  const [params, setParams] = useSearchParams()
  const designationFilter = params.get('designation') ?? ''
  const [rows, setRows] = useState<Expectation[]>([])
  const [designations, setDesignations] = useState<DesignationWithDepartment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Expectation | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Expectation | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [expectationsRes, designationsRes] = await Promise.all([
      supabase.from('expectations').select('id, designation_id, title').order('title'),
      supabase.from('designations').select(DESIGNATION_WITH_DEPARTMENT),
    ])
    const loadError = expectationsRes.error ?? designationsRes.error
    if (loadError) setError(loadError.message)
    else {
      setRows(expectationsRes.data as Expectation[])
      setDesignations((designationsRes.data as unknown as DesignationWithDepartment[]).sort(byDepartmentThenTitle))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const designationById = useMemo(() => new Map(designations.map((d) => [d.id, d])), [designations])

  // Grouped by designation in the same order as the picker.
  const visible = useMemo(() => {
    const order = new Map(designations.map((d, i) => [d.id, i]))
    return rows
      .filter((r) => !designationFilter || r.designation_id === designationFilter)
      .sort((a, b) => (order.get(a.designation_id) ?? 0) - (order.get(b.designation_id) ?? 0))
  }, [rows, designations, designationFilter])

  function openEditor(row: Expectation | 'new') {
    setForm(row === 'new' ? { ...EMPTY, designation_id: designationFilter } : { designation_id: row.designation_id, title: row.title })
    setFormError(null)
    setEditing(row)
  }

  async function save() {
    if (!editing) return
    if (!form.designation_id || !form.title.trim()) return setFormError('Pick a designation and write the expectation.')
    setBusy(true)
    setFormError(null)
    const payload = { designation_id: form.designation_id, title: form.title.trim() }
    const table = supabase.from('expectations')
    const { error: saveError } = await (editing === 'new'
      ? table.insert(payload)
      : table.update(payload).eq('id', editing.id))
    setBusy(false)
    if (saveError) {
      return setFormError(
        configError(saveError, 'This designation already has that expectation.', saveError.message),
      )
    }
    setEditing(null)
    load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('expectations').delete().eq('id', deleting.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) return setError(configError(deleteError, deleteError.message, deleteError.message))
    load()
  }

  return (
    <>
      <PageHeader
        title="Expectations"
        subtitle={loading ? 'Loading…' : `${visible.length} ${visible.length === 1 ? 'expectation' : 'expectations'}`}
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openEditor('new')}
            disabled={!designations.length}
          >
            Add expectation
          </Button>
        }
      />

      {!loading && !designations.length && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Expectations belong to a designation.{' '}
          <MuiLink component={Link} to="/company/designations">
            Add a designation
          </MuiLink>{' '}
          first.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack direction="row" spacing={2} sx={{ p: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
          <TextField
            select
            label="Designation"
            value={designationById.has(designationFilter) ? designationFilter : ''}
            onChange={(e) => setParams(e.target.value ? { designation: e.target.value } : {}, { replace: true })}
            sx={{ minWidth: 260 }}
          >
            <MenuItem value="">All designations</MenuItem>
            {designationOptions(designations)}
          </TextField>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Each monthly review marks every expectation met or not met.
          </Typography>
        </Stack>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Expectation</TableCell>
                <TableCell>Designation</TableCell>
                <TableCell align="right" sx={{ width: 112 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((r) => {
                const designation = designationById.get(r.designation_id)
                return (
                  <TableRow key={r.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {r.title}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{designation?.title}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {designation?.department?.name}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton aria-label={`Edit ${r.title}`} onClick={() => openEditor(r)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      <IconButton aria-label={`Delete ${r.title}`} onClick={() => setDeleting(r)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && !visible.length && (
                <TableRow>
                  <TableCell colSpan={3} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {rows.length ? 'No expectations for this designation yet.' : 'No expectations yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? 'Add expectation' : 'Edit expectation'}
        submitLabel={editing === 'new' ? 'Add' : 'Save'}
        error={formError}
        busy={busy}
        onSubmit={save}
        onClose={() => setEditing(null)}
      >
        <TextField
          select
          label="Designation"
          required
          fullWidth
          value={form.designation_id}
          onChange={(e) => setForm((f) => ({ ...f, designation_id: e.target.value }))}
        >
          {designationOptions(designations)}
        </TextField>
        <TextField
          label="Expectation"
          required
          autoFocus
          fullWidth
          placeholder="e.g. Updates tickets daily"
          slotProps={{ htmlInput: { maxLength: 300 } }}
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title="Delete expectation?"
        message={`“${deleting?.title}” will be deleted. Reviews already started keep their copy.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
