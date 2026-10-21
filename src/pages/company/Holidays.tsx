import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
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
import { formatDateRange, formatDays } from '../../lib/constants'
import { HOLIDAY_COLUMNS, holidayError, leaveDays, thisYear, yearBounds, yearOf, yearOptions } from '../../lib/leaves'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import type { Holiday } from '../../lib/types'

const EMPTY = { name: '', start: '', end: '' }

// Company → Holidays (HR): the public holidays of a year. Leaves don't count
// them, and the database recounts leaves over a holiday when it changes.
export default function Holidays() {
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Holiday | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [from, to] = yearBounds(year)
    const { data, error: loadError } = await supabase
      .from('holidays')
      .select(HOLIDAY_COLUMNS)
      .gte('start_date', from)
      .lte('start_date', to)
      .order('start_date')
    if (loadError) setError(loadError.message)
    else setRows(data as Holiday[])
    setLoading(false)
  }, [year])

  useEffect(() => {
    load()
  }, [load])

  function openEditor(row: Holiday | 'new') {
    setForm(row === 'new' ? EMPTY : { name: row.name, start: row.start_date, end: row.end_date })
    setFormError(null)
    setEditing(row)
  }

  let problem: string | null = null
  if (form.start && form.end && form.end < form.start) problem = 'The end date is before the start date.'
  else if (form.start && form.end && yearOf(form.start) !== yearOf(form.end))
    problem = "A holiday can't run into the next year. Add one for each year."

  async function save() {
    if (!editing) return
    if (problem) return setFormError(problem)
    setBusy(true)
    setFormError(null)
    const payload = { name: form.name.trim(), start_date: form.start, end_date: form.end }
    const table = supabase.from('holidays')
    const { error: saveError } = await (editing === 'new'
      ? table.insert(payload)
      : table.update(payload).eq('id', editing.id))
    setBusy(false)
    if (saveError) return setFormError(holidayError(saveError))
    setEditing(null)
    // Show the year the holiday was saved in.
    if (yearOf(form.start) !== year) setYear(yearOf(form.start))
    else load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('holidays').delete().eq('id', deleting.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) return setError(holidayError(deleteError))
    load()
  }

  return (
    <>
      <PageHeader
        title="Holidays"
        subtitle="Public holidays for the year. Leave doesn't count them, and everyone sees them on their dashboard."
        actions={
          <>
            <TextField
              select
              label="Year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              sx={{ minWidth: 110 }}
            >
              {[...new Set([...yearOptions(), year])].sort((a, b) => b - a).map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEditor('new')}>
              Add holiday
            </Button>
          </>
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
                <TableCell>Holiday</TableCell>
                <TableCell>Dates</TableCell>
                <TableCell align="right">Working days</TableCell>
                <TableCell align="right" sx={{ width: 112 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((h) => (
                <TableRow key={h.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {h.name}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateRange(h.start_date, h.end_date)}</TableCell>
                  <TableCell align="right">{leaveDays(h.start_date, h.end_date, false)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <IconButton aria-label={`Edit ${h.name}`} onClick={() => openEditor(h)}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label={`Delete ${h.name}`} onClick={() => setDeleting(h)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !rows.length && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    No holidays in {year} yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? 'Add holiday' : 'Edit holiday'}
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
          slotProps={{ htmlInput: { maxLength: 100 } }}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="From"
            type="date"
            required
            fullWidth
            value={form.start}
            onChange={(e) => {
              const start = e.target.value
              setForm((f) => ({ ...f, start, end: !f.end || f.end < start ? start : f.end }))
            }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="To"
            type="date"
            required
            fullWidth
            value={form.end}
            onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: form.start || undefined } }}
          />
        </Stack>
        {problem ? (
          <Alert severity="warning">{problem}</Alert>
        ) : (
          form.start &&
          form.end && (
            <Alert severity="info">
              {formatDays(leaveDays(form.start, form.end, false))} off work (weekends aside)
            </Alert>
          )
        )}
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Leaves over these dates are recounted, so a holiday someone had booked off goes back to their balance.
        </Typography>
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title="Delete holiday?"
        message={
          deleting &&
          `${deleting.name} (${formatDateRange(deleting.start_date, deleting.end_date)}) will be deleted. Leaves over these dates count them as working days again.`
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
