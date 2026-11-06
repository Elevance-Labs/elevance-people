import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Link,
  MenuItem,
  Paper,
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
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { supabase } from '../../lib/supabase'
import { BUSINESS_FUNCTION_LABELS } from '../../lib/constants'
import { trimOrNull } from '../../lib/company'
import { GUIDE_COLUMNS, guideError, guideSlug, isGoogleDocUrl, isPublishedDocUrl } from '../../lib/guides'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import type { BusinessFunction, Guide } from '../../lib/types'

const FUNCTION_IDS = Object.keys(BUSINESS_FUNCTION_LABELS) as BusinessFunction[]

const EMPTY = { title: '', business_function: '' as BusinessFunction | '', doc_url: '', description: '', sort_order: '' }

// Configuration → Guides (company admins): the docs on the Resources page, a
// card each under their business function's tab. A guide is a title and a
// Google Docs, Sheets or Slides link; one with no link yet shows as coming
// soon. Its address (slug) is made from the title on add and kept after.
export default function Guides() {
  const [rows, setRows] = useState<Guide[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Guide | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Guide | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('guides')
      .select(GUIDE_COLUMNS)
      .order('sort_order')
      .order('title')
    if (loadError) setError(loadError.message)
    // By function in the Resources tabs' order, keeping order and title within.
    else setRows((data as Guide[]).sort((a, b) => FUNCTION_IDS.indexOf(a.business_function) - FUNCTION_IDS.indexOf(b.business_function)))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openEditor(row: Guide | 'new') {
    setForm(
      row === 'new'
        ? EMPTY
        : {
            title: row.title,
            business_function: row.business_function,
            doc_url: row.doc_url ?? '',
            description: row.description ?? '',
            sort_order: String(row.sort_order),
          },
    )
    setFormError(null)
    setEditing(row)
  }

  async function save() {
    if (!editing) return
    const title = form.title.trim()
    const docUrl = form.doc_url.trim()
    if (!title) return setFormError('Enter a title.')
    if (!form.business_function) return setFormError('Choose the business function.')
    if (docUrl && !isGoogleDocUrl(docUrl)) return setFormError('Enter a Google Docs, Sheets or Slides link.')
    const order = form.sort_order.trim() === '' ? 0 : Number(form.sort_order)
    if (!Number.isInteger(order)) return setFormError('Order is a whole number.')
    setBusy(true)
    setFormError(null)
    const payload = {
      title,
      business_function: form.business_function,
      doc_url: docUrl || null,
      description: trimOrNull(form.description),
      sort_order: order,
    }
    const table = supabase.from('guides')
    const { error: saveError } = await (editing === 'new'
      ? table.insert({ ...payload, slug: guideSlug(title, rows.map((r) => r.slug)) })
      : table.update(payload).eq('id', editing.id))
    setBusy(false)
    if (saveError) return setFormError(guideError(saveError))
    setEditing(null)
    load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('guides').delete().eq('id', deleting.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) return setError(guideError(deleteError))
    load()
  }

  const docUrl = form.doc_url.trim()

  return (
    <>
      <PageHeader
        title="Guides"
        subtitle={loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'guide' : 'guides'} on the Resources page`}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEditor('new')}>
            Add guide
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
                <TableCell>Guide</TableCell>
                <TableCell>Function</TableCell>
                <TableCell>Doc</TableCell>
                <TableCell align="right">Order</TableCell>
                <TableCell align="right" sx={{ width: 112 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {r.doc_url ? (
                        <Link component={RouterLink} to={`/resources/guides/${r.slug}`} underline="hover">
                          {r.title}
                        </Link>
                      ) : (
                        r.title
                      )}
                    </Typography>
                    {r.description && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {r.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{BUSINESS_FUNCTION_LABELS[r.business_function]}</TableCell>
                  <TableCell>
                    {r.doc_url ? (
                      <Button
                        size="small"
                        href={r.doc_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        endIcon={<OpenInNewIcon fontSize="small" />}
                        aria-label={`Open ${r.title} in Google`}
                      >
                        Open
                      </Button>
                    ) : (
                      <Chip label="Coming soon" size="small" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell align="right">{r.sort_order}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <IconButton aria-label={`Edit ${r.title}`} onClick={() => openEditor(r)}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label={`Delete ${r.title}`} onClick={() => setDeleting(r)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !rows.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    No guides yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={!!editing}
        title={editing === 'new' ? 'Add guide' : 'Edit guide'}
        submitLabel={editing === 'new' ? 'Add' : 'Save'}
        error={formError}
        busy={busy}
        onSubmit={save}
        onClose={() => setEditing(null)}
      >
        <TextField
          label="Title"
          required
          autoFocus
          fullWidth
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <TextField
          select
          label="Business function"
          required
          fullWidth
          value={form.business_function}
          helperText="Shown under this function's tab on Resources, to everyone in its departments."
          onChange={(e) => setForm((f) => ({ ...f, business_function: e.target.value as BusinessFunction }))}
        >
          {FUNCTION_IDS.map((v) => (
            <MenuItem key={v} value={v}>
              {BUSINESS_FUNCTION_LABELS[v]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Google Docs link"
          fullWidth
          value={form.doc_url}
          placeholder="https://docs.google.com/document/d/…"
          helperText={
            docUrl && isPublishedDocUrl(docUrl)
              ? 'A published-to-web link is read-only: nobody can comment. Use the doc’s Share link to allow comments.'
              : 'The doc’s Share link (Docs, Sheets or Slides). People with commenter access can comment right in the app. Leave blank to show it as coming soon.'
          }
          onChange={(e) => setForm((f) => ({ ...f, doc_url: e.target.value }))}
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
          label="Order"
          type="number"
          fullWidth
          value={form.sort_order}
          helperText="Lower comes first within the function; then by title."
          onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
        />
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title="Delete guide?"
        message={`${deleting?.title} will be removed from Resources. The Google Doc itself is not touched.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
