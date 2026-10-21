import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import { EQUIPMENT_BUCKET, supabase } from '../../lib/supabase'
import {
  EQUIPMENT_FILE_MAX_BYTES,
  EQUIPMENT_INVOICE_ACCEPT,
  EQUIPMENT_PHOTO_ACCEPT,
  EQUIPMENT_STATUS_COLORS,
  EQUIPMENT_STATUS_LABELS,
  formatDate,
  formatEmployeeNumber,
} from '../../lib/constants'
import { todayIso } from '../../lib/leaves'
import {
  EQUIPMENT_SELECT,
  equipmentError,
  removeEquipmentFiles,
  uploadEquipmentFile,
  type EquipmentRow,
} from '../../lib/equipment'
import type { DirectoryEntry, EquipmentAssignment, EquipmentStatus, Vendor } from '../../lib/types'

const STATUSES = Object.keys(EQUIPMENT_STATUS_LABELS) as EquipmentStatus[]
// Retired or sold equipment can't have a holder (equipment_guard).
const UNASSIGNABLE: EquipmentStatus[] = ['retired', 'sold']

const EMPTY = { name: '', identifier: '', status: 'active' as EquipmentStatus, purchase_date: '', vendor_id: '' }
type FormState = typeof EMPTY
type Person = Pick<DirectoryEntry, 'id' | 'full_name' | 'employee_number' | 'status'>

const toForm = (r: EquipmentRow): FormState => ({
  name: r.name,
  identifier: r.identifier,
  status: r.status,
  purchase_date: r.purchase_date ?? '',
  vendor_id: r.vendor_id ?? '',
})

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
      <Box sx={{ mt: 2.5 }}>{children}</Box>
    </Paper>
  )
}

// undefined = keep the saved file, null = remove it, File = replace it.
type FileChoice = File | null | undefined

// An invoice or photo: what is saved or picked, with open, change and remove.
function FileField({
  label,
  accept,
  saved,
  choice,
  onPick,
  onOpen,
  preview,
}: {
  label: string
  accept: string
  saved: string | null
  choice: FileChoice
  onPick: (choice: FileChoice) => void
  onOpen: () => void
  preview?: string | null
}) {
  const input = useRef<HTMLInputElement>(null)
  const has = choice ? true : choice === null ? false : !!saved
  return (
    <Stack spacing={1}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      {preview && has && (
        <Box
          component="img"
          src={preview}
          alt={label}
          sx={{ width: 160, height: 120, objectFit: 'cover', borderRadius: 1, border: 1, borderColor: 'divider' }}
        />
      )}
      <Typography variant="body2">
        {choice ? choice.name : choice === null ? 'Removed when you save' : saved ? 'Uploaded' : 'None'}
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" onClick={() => input.current?.click()}>
          {has ? 'Replace' : 'Choose file'}
        </Button>
        {saved && choice === undefined && (
          <Button size="small" startIcon={<OpenInNewIcon />} onClick={onOpen}>
            Open
          </Button>
        )}
        {has && (
          <Button size="small" color="error" onClick={() => onPick(saved ? null : undefined)}>
            Remove
          </Button>
        )}
        {choice !== undefined && saved && (
          <Button size="small" onClick={() => onPick(undefined)}>
            Keep saved
          </Button>
        )}
      </Stack>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        aria-label={`${label} file`}
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          if (picked) onPick(picked)
        }}
      />
    </Stack>
  )
}

// Operations → Equipment → one item (HR, finance admins, company admins).
// Details, invoice and photo are saved together; a picked file is uploaded
// on save and the one it replaces removed afterwards. Who has it changes
// only through equipment_assign / equipment_unassign, which keep the history.
export default function EquipmentForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState<EquipmentRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [invoice, setInvoice] = useState<FileChoice>(undefined)
  const [photo, setPhoto] = useState<FileChoice>(undefined)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [vendors, setVendors] = useState<Pick<Vendor, 'id' | 'name'>[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [history, setHistory] = useState<EquipmentAssignment[]>([])
  const [loading, setLoading] = useState(!!id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [assigning, setAssigning] = useState<{ employee_id: string; date: string } | null>(null)
  const [unassigning, setUnassigning] = useState<{ date: string } | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('vendors').select('id, name').order('name'),
      // Finance admins can't read employee records, so names come from the directory.
      supabase.from('employee_directory').select('id, full_name, employee_number, status').order('full_name'),
    ]).then(([vendorsRes, peopleRes]) => {
      const loadError = vendorsRes.error ?? peopleRes.error
      if (loadError) setError(loadError.message)
      else {
        setVendors(vendorsRes.data as Pick<Vendor, 'id' | 'name'>[])
        setPeople(peopleRes.data as Person[])
      }
    })
  }, [])

  const show = useCallback((row: EquipmentRow) => {
    setItem(row)
    setForm(toForm(row))
    setInvoice(undefined)
    setPhoto(undefined)
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    const [itemRes, historyRes] = await Promise.all([
      supabase.from('equipment').select(EQUIPMENT_SELECT).eq('id', id).maybeSingle(),
      supabase
        .from('equipment_assignments')
        .select('id, equipment_id, employee_id, assigned_on, assigned_by, unassigned_on, unassigned_by, created_at')
        .eq('equipment_id', id)
        .order('created_at', { ascending: false }),
    ])
    const loadError = itemRes.error ?? historyRes.error
    if (loadError) setError(loadError.message)
    else if (!itemRes.data) setError('This equipment doesn’t exist.')
    else {
      show(itemRes.data as unknown as EquipmentRow)
      setHistory(historyRes.data as EquipmentAssignment[])
    }
    setLoading(false)
  }, [id, show])

  useEffect(() => {
    if (!id) {
      setItem(null)
      setForm(EMPTY)
      return
    }
    setLoading(true)
    load()
  }, [id, load])

  // The saved photo, through a short-lived link (the bucket is private).
  const savedPhoto = item?.photo_path ?? null
  useEffect(() => {
    if (!savedPhoto) return setPhotoUrl(null)
    supabase.storage
      .from(EQUIPMENT_BUCKET)
      .createSignedUrl(savedPhoto, 600)
      .then(({ data }) => setPhotoUrl(data?.signedUrl ?? null))
  }, [savedPhoto])
  const pickedPhotoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => {
    if (pickedPhotoUrl) URL.revokeObjectURL(pickedPhotoUrl)
  }, [pickedPhotoUrl])

  const nameOf = (employeeId: string) => people.find((p) => p.id === employeeId)?.full_name ?? '—'

  function pick(kind: 'invoice' | 'photo', choice: FileChoice) {
    setError(null)
    if (choice) {
      const accept = (kind === 'invoice' ? EQUIPMENT_INVOICE_ACCEPT : EQUIPMENT_PHOTO_ACCEPT).split(',')
      if (!accept.includes(choice.type)) {
        return setError(
          kind === 'invoice' ? 'The invoice must be a JPEG, PNG, WebP image or a PDF.' : 'The photo must be a JPEG, PNG or WebP image.',
        )
      }
      if (choice.size > EQUIPMENT_FILE_MAX_BYTES) return setError('Files must be 10 MB or smaller.')
    }
    if (kind === 'invoice') setInvoice(choice)
    else setPhoto(choice)
  }

  async function open(path: string) {
    // Open the tab synchronously so popup blockers allow it, then point it at the signed URL.
    const tab = window.open('', '_blank')
    // The opened file gets no handle back to this page.
    if (tab) tab.opener = null
    const { data, error: urlError } = await supabase.storage.from(EQUIPMENT_BUCKET).createSignedUrl(path, 60)
    if (urlError || !data) {
      tab?.close()
      return setError(urlError?.message ?? 'Could not open the file.')
    }
    if (tab) tab.location.href = data.signedUrl
    else window.location.href = data.signedUrl
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    // Upload what was picked first; undo the uploads if the save fails.
    const uploaded: string[] = []
    const paths = { invoice_path: item?.invoice_path ?? null, photo_path: item?.photo_path ?? null }
    for (const [key, choice] of [['invoice_path', invoice], ['photo_path', photo]] as const) {
      if (choice === null) paths[key] = null
      if (!choice) continue
      const { path, error: uploadError } = await uploadEquipmentFile(choice)
      if (uploadError) {
        await removeEquipmentFiles(uploaded)
        setBusy(false)
        return setError(`The file couldn’t be uploaded: ${uploadError.message}`)
      }
      uploaded.push(path)
      paths[key] = path
    }

    const payload = {
      name: form.name.trim(),
      identifier: form.identifier.trim(),
      status: form.status,
      purchase_date: form.purchase_date || null,
      vendor_id: form.vendor_id || null,
      ...paths,
    }
    const table = supabase.from('equipment')
    const { data, error: saveError } = await (item ? table.update(payload).eq('id', item.id) : table.insert(payload))
      .select(EQUIPMENT_SELECT)
      .single()
    if (saveError) {
      await removeEquipmentFiles(uploaded)
      setBusy(false)
      return setError(equipmentError(saveError))
    }
    // The files this save replaced or removed.
    await removeEquipmentFiles(
      [item?.invoice_path, item?.photo_path].filter((p) => p && p !== paths.invoice_path && p !== paths.photo_path),
    )
    setBusy(false)
    const saved = data as unknown as EquipmentRow
    if (item) {
      show(saved)
      setNotice('Changes saved')
    } else {
      navigate(`/operations/equipment/${saved.id}`, { replace: true })
    }
  }

  async function remove() {
    if (!item) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('equipment').delete().eq('id', item.id)
    if (!deleteError) await removeEquipmentFiles([item.invoice_path, item.photo_path])
    setBusy(false)
    setConfirmDelete(false)
    if (deleteError) return setError(equipmentError(deleteError))
    navigate('/operations/equipment', { replace: true })
  }

  async function assign() {
    if (!item || !assigning) return
    setBusy(true)
    setDialogError(null)
    const { error: rpcError } = await supabase.rpc('equipment_assign', {
      p_equipment_id: item.id,
      p_employee_id: assigning.employee_id,
      p_assigned_on: assigning.date,
    })
    setBusy(false)
    if (rpcError) return setDialogError(rpcError.message)
    setAssigning(null)
    setNotice(`Assigned to ${nameOf(assigning.employee_id)}`)
    load()
  }

  async function unassign() {
    if (!item || !unassigning) return
    setBusy(true)
    setDialogError(null)
    const { error: rpcError } = await supabase.rpc('equipment_unassign', {
      p_equipment_id: item.id,
      p_unassigned_on: unassigning.date,
    })
    setBusy(false)
    if (rpcError) return setDialogError(rpcError.message)
    setUnassigning(null)
    setNotice('Unassigned')
    load()
  }

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (id && !item) {
    return (
      <>
        <PageHeader title="Equipment" back="/operations/equipment" />
        <Alert severity="error">{error}</Alert>
      </>
    )
  }

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))
  const assignable = item && !UNASSIGNABLE.includes(item.status)
  // Current employees only, and not whoever has it now.
  const candidates = people.filter((p) => !['left', 'terminated'].includes(p.status) && p.id !== item?.assigned_to)

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <PageHeader
        back="/operations/equipment"
        title={item ? item.name : 'New equipment'}
        subtitle={item ? item.identifier : 'Add a piece of equipment'}
        actions={
          item && (
            <Chip
              label={EQUIPMENT_STATUS_LABELS[item.status]}
              color={EQUIPMENT_STATUS_COLORS[item.status]}
              variant={item.status === 'active' ? 'filled' : 'outlined'}
            />
          )
        }
      />

      <Stack spacing={3}>
        <Box component="form" onSubmit={save}>
          <Stack spacing={3}>
            <Section title="Details" description="e.g. a laptop, monitor, mouse or printer.">
              <Grid container spacing={2.5}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField label="Name" required fullWidth value={form.name} onChange={set('name')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Identifier"
                    required
                    fullWidth
                    value={form.identifier}
                    onChange={set('identifier')}
                    helperText="A serial number or asset tag. No two items can share one."
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField select label="Status" required fullWidth value={form.status} onChange={set('status')}>
                    {STATUSES.map((s) => (
                      <MenuItem
                        key={s}
                        value={s}
                        disabled={!!item?.assigned_to && UNASSIGNABLE.includes(s) && item.status !== s}
                      >
                        {EQUIPMENT_STATUS_LABELS[s]}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    label="Purchase date"
                    type="date"
                    fullWidth
                    value={form.purchase_date}
                    onChange={set('purchase_date')}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    select
                    label="Vendor"
                    fullWidth
                    value={form.vendor_id}
                    onChange={set('vendor_id')}
                    helperText={vendors.length ? undefined : 'Add vendors under Configuration → Vendors.'}
                  >
                    <MenuItem value="">None</MenuItem>
                    {vendors.map((v) => (
                      <MenuItem key={v.id} value={v.id}>
                        {v.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FileField
                    label="Invoice"
                    accept={EQUIPMENT_INVOICE_ACCEPT}
                    saved={item?.invoice_path ?? null}
                    choice={invoice}
                    onPick={(c) => pick('invoice', c)}
                    onOpen={() => item?.invoice_path && open(item.invoice_path)}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FileField
                    label="Photo"
                    accept={EQUIPMENT_PHOTO_ACCEPT}
                    saved={item?.photo_path ?? null}
                    choice={photo}
                    onPick={(c) => pick('photo', c)}
                    onOpen={() => item?.photo_path && open(item.photo_path)}
                    preview={photo ? pickedPhotoUrl : photoUrl}
                  />
                </Grid>
              </Grid>
            </Section>

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              {item && (
                <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Delete equipment
                </Button>
              )}
              <Box sx={{ flexGrow: 1 }} />
              <Button component={Link} to="/operations/equipment" disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="contained" loading={busy}>
                {item ? 'Save changes' : 'Add equipment'}
              </Button>
            </Stack>
          </Stack>
        </Box>

        {item ? (
          <Section title="Assignment" description="Who has it now, and who had it before.">
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 2 }}
            >
              <Typography>
                {item.assigned_to ? (
                  <>
                    Assigned to <strong>{nameOf(item.assigned_to)}</strong> since {formatDate(item.assigned_on)}
                  </>
                ) : (
                  'Not assigned to anyone.'
                )}
              </Typography>
              <Stack direction="row" spacing={1}>
                {item.assigned_to && (
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setDialogError(null)
                      setUnassigning({ date: todayIso() })
                    }}
                  >
                    Unassign
                  </Button>
                )}
                <Button
                  variant="contained"
                  disabled={!assignable}
                  onClick={() => {
                    setDialogError(null)
                    setAssigning({ employee_id: '', date: todayIso() })
                  }}
                >
                  {item.assigned_to ? 'Reassign' : 'Assign'}
                </Button>
              </Stack>
            </Stack>
            {!assignable && (
              <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
                {EQUIPMENT_STATUS_LABELS[item.status]} equipment can’t be assigned.
              </Alert>
            )}
            {history.length ? (
              <Table size="small" aria-label="Assignment history">
                <TableHead>
                  <TableRow>
                    <TableCell>Employee</TableCell>
                    <TableCell>From</TableCell>
                    <TableCell>To</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                      <TableCell>{nameOf(h.employee_id)}</TableCell>
                      <TableCell>{formatDate(h.assigned_on)}</TableCell>
                      <TableCell>{h.unassigned_on ? formatDate(h.unassigned_on) : 'Now'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                It hasn’t been assigned yet.
              </Typography>
            )}
          </Section>
        ) : (
          <Alert severity="info" variant="outlined">
            Equipment can be assigned to someone once it is added.
          </Alert>
        )}
      </Stack>

      <FormDialog
        open={!!assigning}
        title={item?.assigned_to ? 'Reassign equipment' : 'Assign equipment'}
        submitLabel="Assign"
        error={dialogError}
        busy={busy}
        onSubmit={assign}
        onClose={() => setAssigning(null)}
      >
        {item?.assigned_to && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {nameOf(item.assigned_to)}’s assignment ends on the date you pick.
          </Typography>
        )}
        <TextField
          select
          label="Employee"
          required
          fullWidth
          value={assigning?.employee_id ?? ''}
          onChange={(e) => setAssigning((a) => a && { ...a, employee_id: e.target.value })}
        >
          {candidates.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.full_name} ({formatEmployeeNumber(p.employee_number)})
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Assigned on"
          type="date"
          required
          fullWidth
          value={assigning?.date ?? ''}
          onChange={(e) => setAssigning((a) => a && { ...a, date: e.target.value })}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIso() } }}
        />
      </FormDialog>

      <FormDialog
        open={!!unassigning}
        title="Unassign equipment"
        submitLabel="Unassign"
        error={dialogError}
        busy={busy}
        onSubmit={unassign}
        onClose={() => setUnassigning(null)}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {item?.assigned_to && nameOf(item.assigned_to)} had it from {formatDate(item?.assigned_on ?? null)}. When was
          it returned?
        </Typography>
        <TextField
          label="Unassigned on"
          type="date"
          required
          fullWidth
          value={unassigning?.date ?? ''}
          onChange={(e) => setUnassigning({ date: e.target.value })}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { min: item?.assigned_on ?? undefined, max: todayIso() },
          }}
        />
      </FormDialog>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete equipment?"
        message={`${item?.name} (${item?.identifier}), its invoice, photo and assignment history will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
      <Snackbar
        open={!!notice}
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        message={notice}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  )
}
