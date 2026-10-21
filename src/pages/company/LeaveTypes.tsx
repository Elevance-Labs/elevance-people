import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Link as MuiLink,
  Paper,
  Stack,
  Switch,
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
import { countOf, trimOrNull, type Count } from '../../lib/company'
import { formatDays } from '../../lib/constants'
import { leaveSettingsError } from '../../lib/leaves'
import { ConfirmDialog, FormDialog } from '../../components/common'
import type { LeaveType } from '../../lib/types'

type Row = LeaveType & { leaves: Count }

const EMPTY = { name: '', description: '', annual_quota: '', is_active: true }

// The Types tab of Company → Leaves.
export default function LeaveTypes() {
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
      .from('leave_types')
      .select('id, name, description, annual_quota, is_active, leaves(count)')
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
        : {
            name: row.name,
            description: row.description ?? '',
            annual_quota: row.annual_quota === null ? '' : String(row.annual_quota),
            is_active: row.is_active,
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
      name: form.name.trim(),
      description: trimOrNull(form.description),
      annual_quota: form.annual_quota.trim() === '' ? null : Number(form.annual_quota),
      is_active: form.is_active,
    }
    const table = supabase.from('leave_types')
    const { error: saveError } = await (editing === 'new'
      ? table.insert(payload)
      : table.update(payload).eq('id', editing.id))
    setBusy(false)
    if (saveError) {
      return setFormError(
        leaveSettingsError(saveError, 'A leave type with this name already exists.', saveError.message),
      )
    }
    setEditing(null)
    load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('leave_types').delete().eq('id', deleting.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) {
      return setError(
        leaveSettingsError(deleteError, deleteError.message, 'Leaves use this type. Make it inactive instead.'),
      )
    }
    load()
  }

  return (
    <>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
          Each type has a default number of days per calendar year. Leave it blank for no limit.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEditor('new')}>
          Add leave type
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
                <TableCell>Leave type</TableCell>
                <TableCell>Days per year</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Leaves</TableCell>
                <TableCell align="right" sx={{ width: 112 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const used = countOf(r.leaves)
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
                    <TableCell>{r.annual_quota === null ? 'No limit' : formatDays(r.annual_quota)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={r.is_active ? 'Active' : 'Inactive'}
                        color={r.is_active ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">{used}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton aria-label={`Edit ${r.name}`} onClick={() => openEditor(r)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      <Tooltip title={used ? 'Leaves use this type. Make it inactive instead.' : ''}>
                        <span>
                          <IconButton aria-label={`Delete ${r.name}`} disabled={used > 0} onClick={() => setDeleting(r)}>
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
                    No leave types yet. Add one (e.g. Annual, Sick, Unpaid) so people can apply.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
        To give one person a different number of days for a year, use the{' '}
        <MuiLink component={Link} to="/company/leaves?tab=quotas">
          Quotas
        </MuiLink>{' '}
        tab.
      </Typography>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? 'Add leave type' : 'Edit leave type'}
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
          label="Days per year"
          type="number"
          fullWidth
          helperText="Blank means no limit. Half days are allowed (e.g. 7.5)."
          value={form.annual_quota}
          onChange={(e) => setForm((f) => ({ ...f, annual_quota: e.target.value }))}
          slotProps={{ htmlInput: { min: 0, step: 0.5 } }}
        />
        <TextField
          label="Description"
          multiline
          minRows={2}
          fullWidth
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <FormControlLabel
          control={
            <Switch checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
          }
          label="Active: people can apply for it"
        />
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title="Delete leave type?"
        message={`${deleting?.name} will be deleted, along with any per-person quotas for it.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
