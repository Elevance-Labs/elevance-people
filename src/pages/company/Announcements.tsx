import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDay } from '../../lib/constants'
import { isoDate, todayIso } from '../../lib/leaves'
import { isBlankHtml, sanitizeHtml } from '../../lib/richText'
import type { Announcement } from '../../lib/types'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import { RichTextEditor } from '../../components/RichText'
import { RichTextView } from '../../components/RichTextView'

type Row = Announcement & { author: { full_name: string } | null }

const SELECT = '*, author:employees!announcements_created_by_fkey(full_name)'

interface Form {
  body: string
  pinned: boolean
  pinned_until: string
}

// A new pin lasts a week unless HR picks another date.
function aWeekFromToday() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return isoDate(d)
}

function announcementError(error: { code?: string; message: string }) {
  if (error.code === '42501') return 'Only HR can manage announcements.'
  if (error.code === '23514') return 'This announcement is too long.'
  return error.message
}

export default function Announcements() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState<Form>({ body: '', pinned: false, pinned_until: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const today = todayIso()

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('announcements')
      .select(SELECT)
      .order('created_at', { ascending: false })
    if (loadError) setError(loadError.message)
    else setRows(data as unknown as Row[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const isPinned = (r: Announcement) => !!r.pinned_until && r.pinned_until >= today

  function openEditor(row: Row | 'new') {
    setForm(
      row === 'new'
        ? { body: '', pinned: false, pinned_until: '' }
        : { body: row.body, pinned: isPinned(row), pinned_until: isPinned(row) ? row.pinned_until! : '' },
    )
    setFormError(null)
    setEditing(row)
  }

  async function save() {
    if (!editing) return
    const body = sanitizeHtml(form.body)
    if (isBlankHtml(body)) return setFormError('Write the announcement first.')
    if (form.pinned && !form.pinned_until) return setFormError('Choose the last day to keep it pinned.')
    if (form.pinned && form.pinned_until < today) return setFormError("The pin can't end before today.")
    setBusy(true)
    setFormError(null)
    const payload = { body, pinned_until: form.pinned ? form.pinned_until : null }
    const table = supabase.from('announcements')
    const { error: saveError } = await (editing === 'new'
      ? table.insert(payload)
      : table.update(payload).eq('id', editing.id))
    setBusy(false)
    if (saveError) return setFormError(announcementError(saveError))
    setEditing(null)
    load()
  }

  async function unpin(row: Row) {
    setError(null)
    const { error: unpinError } = await supabase
      .from('announcements')
      .update({ pinned_until: null })
      .eq('id', row.id)
    if (unpinError) return setError(announcementError(unpinError))
    load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('announcements').delete().eq('id', deleting.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) return setError(announcementError(deleteError))
    load()
  }

  const pinnedCount = rows.filter(isPinned).length

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle={
          loading
            ? 'Loading…'
            : `${pinnedCount} pinned to everyone's dashboard · ${rows.length} in all`
        }
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEditor('new')}>
            Add announcement
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Stack spacing={2}>
        {rows.map((r) => (
          <Paper key={r.id} component="article" variant="outlined" sx={{ p: 2.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
              {isPinned(r) ? (
                <Chip
                  size="small"
                  color="primary"
                  icon={<PushPinIcon />}
                  label={`Pinned until ${formatDate(r.pinned_until)}`}
                />
              ) : (
                r.pinned_until && <Chip size="small" variant="outlined" label={`Pin ended ${formatDate(r.pinned_until)}`} />
              )}
              <Typography variant="caption" sx={{ color: 'text.secondary', flexGrow: 1 }}>
                {r.author?.full_name ?? 'A former employee'} · {formatDay(r.created_at)}
              </Typography>
              <Box sx={{ whiteSpace: 'nowrap' }}>
                {isPinned(r) && (
                  <Tooltip title="Unpin">
                    <IconButton aria-label="Unpin" onClick={() => unpin(r)}>
                      <PushPinOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <IconButton aria-label="Edit" onClick={() => openEditor(r)}>
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton aria-label="Delete" onClick={() => setDeleting(r)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Box>
            </Stack>
            <RichTextView html={r.body} />
          </Paper>
        ))}
        {!loading && !rows.length && (
          <Paper variant="outlined" sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
            No announcements yet.
          </Paper>
        )}
      </Stack>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? 'Add announcement' : 'Edit announcement'}
        submitLabel={editing === 'new' ? 'Add' : 'Save'}
        error={formError}
        busy={busy}
        onSubmit={save}
        onClose={() => setEditing(null)}
      >
        <RichTextEditor
          key={editing === 'new' ? 'new' : editing?.id}
          label="Message"
          value={form.body}
          onChange={(body) => setForm((f) => ({ ...f, body }))}
        />
        <Box>
          <FormControlLabel
            label="Pin to everyone's dashboard"
            control={
              <Checkbox
                checked={form.pinned}
                onChange={(e) => {
                  const pinned = e.target.checked
                  setForm((f) => ({ ...f, pinned, pinned_until: pinned && !f.pinned_until ? aWeekFromToday() : f.pinned_until }))
                }}
              />
            }
          />
          {form.pinned && (
            <TextField
              label="Pinned until"
              type="date"
              required
              fullWidth
              value={form.pinned_until}
              onChange={(e) => setForm((f) => ({ ...f, pinned_until: e.target.value }))}
              helperText="Shown on dashboards through this date."
              sx={{ mt: 1.5 }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today } }}
            />
          )}
        </Box>
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title="Delete announcement?"
        message="It will be removed for good, including from dashboards."
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
