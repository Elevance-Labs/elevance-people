import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Chip,
  IconButton,
  InputAdornment,
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
  trimOrNull,
  type DesignationWithDepartment,
} from '../../lib/company'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import type { Kpi } from '../../lib/types'

const EMPTY = { designation_id: '', name: '', description: '', target: '', weight: '' }

export default function Kpis() {
  const [params, setParams] = useSearchParams()
  const designationFilter = params.get('designation') ?? ''
  const [rows, setRows] = useState<Kpi[]>([])
  const [designations, setDesignations] = useState<DesignationWithDepartment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Kpi | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Kpi | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [kpisRes, designationsRes] = await Promise.all([
      supabase.from('kpis').select('id, designation_id, name, description, target, weight').order('name'),
      supabase.from('designations').select(DESIGNATION_WITH_DEPARTMENT),
    ])
    const loadError = kpisRes.error ?? designationsRes.error
    if (loadError) setError(loadError.message)
    else {
      setRows(kpisRes.data as Kpi[])
      setDesignations((designationsRes.data as unknown as DesignationWithDepartment[]).sort(byDepartmentThenTitle))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const designationById = useMemo(() => new Map(designations.map((d) => [d.id, d])), [designations])

  // Group by designation in the same order as the picker.
  const visible = useMemo(() => {
    const order = new Map(designations.map((d, i) => [d.id, i]))
    return rows
      .filter((r) => !designationFilter || r.designation_id === designationFilter)
      .sort((a, b) => (order.get(a.designation_id) ?? 0) - (order.get(b.designation_id) ?? 0))
  }, [rows, designations, designationFilter])

  const totalWeight = designationFilter ? visible.reduce((sum, r) => sum + (r.weight ?? 0), 0) : null

  function openEditor(row: Kpi | 'new') {
    setForm(
      row === 'new'
        ? { ...EMPTY, designation_id: designationFilter }
        : {
            designation_id: row.designation_id,
            name: row.name,
            description: row.description ?? '',
            target: row.target ?? '',
            weight: row.weight == null ? '' : String(row.weight),
          },
    )
    setFormError(null)
    setEditing(row)
  }

  async function save() {
    if (!editing) return
    setBusy(true)
    setFormError(null)
    const payload = {
      designation_id: form.designation_id,
      name: form.name.trim(),
      description: trimOrNull(form.description),
      target: trimOrNull(form.target),
      weight: form.weight.trim() ? Number(form.weight) : null,
    }
    const table = supabase.from('kpis')
    const { error: saveError } = await (editing === 'new'
      ? table.insert(payload)
      : table.update(payload).eq('id', editing.id))
    setBusy(false)
    if (saveError) {
      return setFormError(
        configError(saveError, 'This designation already has a KPI with that name.', saveError.message),
      )
    }
    setEditing(null)
    load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('kpis').delete().eq('id', deleting.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) return setError(configError(deleteError, deleteError.message, deleteError.message))
    load()
  }

  return (
    <>
      <PageHeader
        title="KPIs"
        subtitle={loading ? 'Loading…' : `${visible.length} ${visible.length === 1 ? 'KPI' : 'KPIs'}`}
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openEditor('new')}
            disabled={!designations.length}
          >
            Add KPI
          </Button>
        }
      />

      {!loading && !designations.length && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          KPIs belong to a designation.{' '}
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
          {totalWeight !== null && visible.length > 0 && (
            <Chip
              label={`Total weight ${totalWeight}%`}
              color={totalWeight === 100 ? 'success' : 'warning'}
              variant="outlined"
            />
          )}
        </Stack>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>KPI</TableCell>
                <TableCell>Designation</TableCell>
                <TableCell>Target</TableCell>
                <TableCell align="right">Weight</TableCell>
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
                        {r.name}
                      </Typography>
                      {r.description && (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {r.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{designation?.title}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {designation?.department?.name}
                      </Typography>
                    </TableCell>
                    <TableCell>{r.target ?? '—'}</TableCell>
                    <TableCell align="right">{r.weight == null ? '—' : `${r.weight}%`}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton aria-label={`Edit ${r.name}`} onClick={() => openEditor(r)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      <IconButton aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && !visible.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {rows.length ? 'No KPIs for this designation yet.' : 'No KPIs yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? 'Add KPI' : 'Edit KPI'}
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
          label="Name"
          required
          autoFocus
          fullWidth
          placeholder="e.g. On-time delivery"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5}>
          <TextField
            label="Target"
            fullWidth
            placeholder="e.g. 95% of sprints"
            value={form.target}
            onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
          />
          <TextField
            label="Weight"
            type="number"
            value={form.weight}
            onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
            sx={{ width: { sm: 160 }, flexShrink: 0 }}
            slotProps={{
              htmlInput: { min: 0.01, max: 100, step: 0.01 },
              input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
            }}
          />
        </Stack>
        <TextField
          label="Description"
          multiline
          minRows={2}
          fullWidth
          placeholder="How it is measured"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title="Delete KPI?"
        message={`${deleting?.name} will be deleted.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
