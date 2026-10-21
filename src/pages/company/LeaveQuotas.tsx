import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Button,
  IconButton,
  LinearProgress,
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
import { formatDays } from '../../lib/constants'
import { leaveSettingsError, thisYear, yearOptions } from '../../lib/leaves'
import { ConfirmDialog, FormDialog, PersonAvatar } from '../../components/common'
import type { DirectoryEntry, LeaveQuota, LeaveType } from '../../lib/types'

type Row = LeaveQuota & { leave_type: Pick<LeaveType, 'name' | 'annual_quota'> | null }

const EMPTY = { employee_id: '', leave_type_id: '', days: '' }

// The Quotas tab of Company → Leaves.
export default function LeaveQuotas() {
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState<Row[]>([])
  const [types, setTypes] = useState<LeaveType[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [quotasRes, typesRes, directoryRes] = await Promise.all([
      supabase
        .from('leave_quotas')
        .select('employee_id, leave_type_id, year, days, leave_type:leave_types(name, annual_quota)')
        .eq('year', year),
      supabase.from('leave_types').select('*').order('name'),
      supabase.from('employee_directory').select('*').order('full_name'),
    ])
    const failure = quotasRes.error ?? typesRes.error ?? directoryRes.error
    if (failure) setError(failure.message)
    else {
      setRows(quotasRes.data as unknown as Row[])
      setTypes(typesRes.data as LeaveType[])
      setPeople(directoryRes.data as DirectoryEntry[])
    }
    setLoading(false)
  }, [year])

  useEffect(() => {
    load()
  }, [load])

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const nameOf = (id: string) => byId.get(id)?.full_name ?? 'a former employee'
  const sorted = [...rows].sort(
    (a, b) =>
      nameOf(a.employee_id).localeCompare(nameOf(b.employee_id)) ||
      (a.leave_type?.name ?? '').localeCompare(b.leave_type?.name ?? ''),
  )

  function openEditor(row: Row | 'new') {
    setForm(
      row === 'new'
        ? EMPTY
        : { employee_id: row.employee_id, leave_type_id: row.leave_type_id, days: String(row.days) },
    )
    setFormError(null)
    setEditing(row)
  }

  async function save() {
    if (!editing) return
    setBusy(true)
    setFormError(null)
    const days = Number(form.days)
    const table = supabase.from('leave_quotas')
    const { error: saveError } = await (editing === 'new'
      ? table.insert({ employee_id: form.employee_id, leave_type_id: form.leave_type_id, year, days })
      : table
          .update({ days })
          .eq('employee_id', editing.employee_id)
          .eq('leave_type_id', editing.leave_type_id)
          .eq('year', editing.year))
    setBusy(false)
    if (saveError) {
      return setFormError(
        leaveSettingsError(
          saveError,
          `${nameOf(form.employee_id)} already has a quota for this type in ${year}. Edit it instead.`,
          saveError.message,
        ),
      )
    }
    setEditing(null)
    load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase
      .from('leave_quotas')
      .delete()
      .eq('employee_id', deleting.employee_id)
      .eq('leave_type_id', deleting.leave_type_id)
      .eq('year', deleting.year)
    setBusy(false)
    setDeleting(null)
    if (deleteError) return setError(leaveSettingsError(deleteError, deleteError.message, deleteError.message))
    load()
  }

  const selectedType = types.find((t) => t.id === form.leave_type_id)

  return (
    <>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
          Per-person quotas that replace a leave type's default for one year.
        </Typography>
        <TextField
          select
          label="Year"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          sx={{ minWidth: 110 }}
        >
          {yearOptions().map((y) => (
            <MenuItem key={y} value={y}>
              {y}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" startIcon={<AddIcon />} disabled={!types.length} onClick={() => openEditor('new')}>
          Add quota
        </Button>
      </Stack>

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
                <TableCell>Employee</TableCell>
                <TableCell>Leave type</TableCell>
                <TableCell>Default</TableCell>
                <TableCell>Their quota for {year}</TableCell>
                <TableCell align="right" sx={{ width: 112 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((r) => (
                <TableRow
                  key={`${r.employee_id}-${r.leave_type_id}`}
                  hover
                  sx={{ '&:last-child td': { borderBottom: 0 } }}
                >
                  <TableCell>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                      <PersonAvatar name={nameOf(r.employee_id)} size={30} />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {nameOf(r.employee_id)}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{r.leave_type?.name}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {r.leave_type?.annual_quota == null ? 'No limit' : formatDays(r.leave_type.annual_quota)}
                  </TableCell>
                  <TableCell>{formatDays(r.days)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <IconButton aria-label="Edit quota" onClick={() => openEditor(r)}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label="Delete quota" onClick={() => setDeleting(r)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !rows.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    No per-person quotas for {year}. Everyone gets each type's default.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? `Add quota for ${year}` : `Edit quota for ${year}`}
        submitLabel={editing === 'new' ? 'Add' : 'Save'}
        error={formError}
        busy={busy}
        onSubmit={save}
        onClose={() => setEditing(null)}
      >
        <Autocomplete
          options={people.filter((p) => p.status !== 'left' && p.status !== 'terminated')}
          value={byId.get(form.employee_id) ?? null}
          onChange={(_e, p) => setForm((f) => ({ ...f, employee_id: p?.id ?? '' }))}
          getOptionLabel={(p) => p.full_name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          disabled={editing !== 'new'}
          renderInput={(params) => <TextField {...params} label="Employee" required autoFocus={editing === 'new'} />}
        />
        <TextField
          select
          label="Leave type"
          required
          fullWidth
          disabled={editing !== 'new'}
          value={form.leave_type_id}
          onChange={(e) => setForm((f) => ({ ...f, leave_type_id: e.target.value }))}
          helperText={
            selectedType &&
            `Default: ${selectedType.annual_quota === null ? 'no limit' : formatDays(selectedType.annual_quota)}`
          }
        >
          {types.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.name}
              {!t.is_active && ' (inactive)'}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={`Days in ${year}`}
          type="number"
          required
          fullWidth
          autoFocus={editing !== 'new'}
          value={form.days}
          onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))}
          slotProps={{ htmlInput: { min: 0, step: 0.5 } }}
        />
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title="Remove this quota?"
        message={
          deleting &&
          `${nameOf(deleting.employee_id)} goes back to the default for ${deleting.leave_type?.name} in ${deleting.year}.`
        }
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
