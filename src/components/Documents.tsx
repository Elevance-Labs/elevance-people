import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import { DOCS_BUCKET, supabase } from '../lib/supabase'
import { DOC_ACCEPT, DOC_MAX_BYTES, DOC_TYPES } from '../lib/constants'
import { ConfirmDialog } from './common'
import type { EmployeeDocument } from '../lib/types'

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Documents are never deleted, only hidden (deleted_at): the database keeps
// the row and the file until the employee is deleted. HR can show them again.
export default function Documents({ employeeId }: { employeeId: string }) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [docType, setDocType] = useState(DOC_TYPES[0])
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<EmployeeDocument | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    let query = supabase
      .from('employee_documents')
      .select('id, employee_id, doc_type, file_name, storage_path, mime_type, size_bytes, created_at, deleted_at')
      .eq('employee_id', employeeId)
    if (!showDeleted) query = query.is('deleted_at', null)
    const { data, error: loadError } = await query.order('created_at', { ascending: false })
    if (loadError) setError(loadError.message)
    else setDocs(data as EmployeeDocument[])
  }, [employeeId, showDeleted])

  useEffect(() => {
    load()
  }, [load])

  function pick(picked: File | undefined) {
    setError(null)
    if (!picked) return setFile(null)
    if (!DOC_ACCEPT.split(',').includes(picked.type)) {
      setError('Only images (JPEG, PNG, WebP, GIF) and PDF files are allowed.')
    } else if (picked.size > DOC_MAX_BYTES) {
      setError('File is larger than 10 MB.')
    } else {
      return setFile(picked)
    }
    setFile(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function upload() {
    if (!file) return
    setBusy(true)
    setError(null)
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
    const path = `${employeeId}/${crypto.randomUUID()}.${ext}`
    const uploaded = await supabase.storage
      .from(DOCS_BUCKET)
      .upload(path, file, { contentType: file.type })
    let failure = uploaded.error?.message
    if (!failure) {
      const inserted = await supabase.from('employee_documents').insert({
        employee_id: employeeId,
        doc_type: docType,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type,
        size_bytes: file.size,
      })
      failure = inserted.error?.message
    }
    setBusy(false)
    if (failure) return setError(failure)
    setFile(null)
    if (fileInput.current) fileInput.current.value = ''
    load()
  }

  async function view(doc: EmployeeDocument) {
    // Open the tab synchronously so popup blockers allow it, then point it at the signed URL.
    const tab = window.open('', '_blank')
    // The opened file gets no handle back to this page.
    if (tab) tab.opener = null
    const { data, error: urlError } = await supabase.storage
      .from(DOCS_BUCKET)
      .createSignedUrl(doc.storage_path, 60)
    if (urlError || !data) {
      tab?.close()
      return setError(urlError?.message ?? 'Could not open the document.')
    }
    if (tab) tab.location.href = data.signedUrl
    else window.location.href = data.signedUrl
  }

  async function softDelete() {
    if (!toDelete) return
    setError(null)
    const { error: deleteError } = await supabase
      .from('employee_documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', toDelete.id)
    setToDelete(null)
    if (deleteError) return setError(deleteError.message)
    load()
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2.5 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Documents
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Images or PDFs, up to 10 MB each.
          </Typography>
        </Box>
        <FormControlLabel
          control={<Switch size="small" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />}
          label="Show deleted"
          sx={{ mr: 0, whiteSpace: 'nowrap' }}
        />
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <TextField
          select
          label="Document type"
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          {DOC_TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </TextField>
        <Button
          component="label"
          variant="outlined"
          startIcon={<AttachFileIcon />}
          sx={{ maxWidth: { sm: 320 }, justifyContent: 'flex-start' }}
        >
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file ? file.name : 'Choose file'}
          </Box>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept={DOC_ACCEPT}
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </Button>
        <Button
          variant="contained"
          startIcon={<CloudUploadOutlinedIcon />}
          onClick={upload}
          disabled={!file}
          loading={busy}
        >
          Upload
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {docs.length ? (
        <List sx={{ mt: 2 }} disablePadding>
          {docs.map((doc) => (
            <ListItem
              key={doc.id}
              divider
              secondaryAction={
                <>
                  <Tooltip title="View">
                    <IconButton onClick={() => view(doc)}>
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {!doc.deleted_at && (
                    <Tooltip title="Delete">
                      <IconButton edge="end" onClick={() => setToDelete(doc)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </>
              }
              sx={{ pr: 12, ...(doc.deleted_at && { '& .MuiListItemText-root, & .MuiAvatar-root': { opacity: 0.55 } }) }}
            >
              <ListItemAvatar>
                <Avatar variant="rounded" sx={{ bgcolor: 'action.selected', color: 'text.secondary' }}>
                  {doc.mime_type === 'application/pdf' ? <PictureAsPdfOutlinedIcon /> : <ImageOutlinedIcon />}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }} component="span">
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.file_name}
                    </Box>
                    <Chip label={doc.doc_type} size="small" variant="outlined" />
                    {doc.deleted_at && <Chip label="Deleted" size="small" color="error" variant="outlined" />}
                  </Stack>
                }
                secondary={[
                  formatSize(doc.size_bytes),
                  `uploaded ${new Date(doc.created_at).toLocaleDateString()}`,
                  doc.deleted_at && `deleted ${new Date(doc.deleted_at).toLocaleDateString()}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3, textAlign: 'center' }}>
          {showDeleted ? 'No documents uploaded yet.' : 'No documents.'}
        </Typography>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete document?"
        message={`"${toDelete?.file_name}" will be hidden from this employee's documents. It is kept, and can still be seen with Show deleted.`}
        confirmLabel="Delete"
        destructive
        onConfirm={softDelete}
        onClose={() => setToDelete(null)}
      />
    </Paper>
  )
}
