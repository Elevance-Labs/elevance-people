import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  IconButton,
  LinearProgress,
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
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { countOf, trimOrNull, type Count } from '../../lib/company'
import { IBAN_PATTERN, VENDOR_SELECT, normaliseIban, vendorError } from '../../lib/equipment'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import type { Vendor } from '../../lib/types'

type Row = Vendor & { equipment: Count }

const EMPTY = { name: '', description: '', bank_name: '', iban: '' }

// Configuration → Vendors (HR, finance admins, company admins): who equipment
// is bought from. Anyone here adds and edits; only a company admin deletes,
// and not while equipment is linked.
export default function Vendors() {
  const { isCompanyAdmin } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from('vendors').select(VENDOR_SELECT).order('name')
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
        : { name: row.name, description: row.description ?? '', bank_name: row.bank_name ?? '', iban: row.iban ?? '' },
    )
    setFormError(null)
    setEditing(row)
  }

  async function save() {
    if (!editing) return
    const iban = normaliseIban(form.iban)
    if (iban && !IBAN_PATTERN.test(iban)) return setFormError('Enter a valid IBAN, like PK36SCBL0000001123456702.')
    setBusy(true)
    setFormError(null)
    const payload = {
      name: form.name.trim(),
      description: trimOrNull(form.description),
      bank_name: trimOrNull(form.bank_name),
      iban,
    }
    const table = supabase.from('vendors')
    const { error: saveError } = await (editing === 'new'
      ? table.insert(payload)
      : table.update(payload).eq('id', editing.id))
    setBusy(false)
    if (saveError) return setFormError(vendorError(saveError))
    setEditing(null)
    load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('vendors').delete().eq('id', deleting.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) return setError(vendorError(deleteError))
    load()
  }

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle={loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'vendor' : 'vendors'}`}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEditor('new')}>
            Add vendor
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
                <TableCell>Vendor</TableCell>
                <TableCell>Bank</TableCell>
                <TableCell>IBAN</TableCell>
                <TableCell align="right">Equipment</TableCell>
                <TableCell align="right" sx={{ width: 112 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const equipment = countOf(r.equipment)
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
                    <TableCell>{r.bank_name ?? '—'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{r.iban ?? '—'}</TableCell>
                    <TableCell align="right">{equipment}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton aria-label={`Edit ${r.name}`} onClick={() => openEditor(r)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      {isCompanyAdmin && (
                        <Tooltip title={equipment ? 'Move its equipment to another vendor first' : ''}>
                          <span>
                            <IconButton
                              aria-label={`Delete ${r.name}`}
                              disabled={equipment > 0}
                              onClick={() => setDeleting(r)}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && !rows.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    No vendors yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? 'Add vendor' : 'Edit vendor'}
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
          label="Description"
          multiline
          minRows={2}
          fullWidth
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <TextField
          label="Bank name"
          fullWidth
          value={form.bank_name}
          onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
        />
        <TextField
          label="Account IBAN"
          fullWidth
          value={form.iban}
          helperText="Spaces are removed and letters made upper case."
          onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value }))}
        />
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title="Delete vendor?"
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
