import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { supabase } from '../lib/supabase'
import { formatDay } from '../lib/constants'
import { FEEDBACK_KIND_COLORS, FEEDBACK_KIND_LABELS, feedbackError } from '../lib/performance'
import type { DirectoryEntry, FeedbackKind, HrFeedback as Feedback } from '../lib/types'
import { ConfirmDialog, FormDialog } from './common'

const MAX_LENGTH = 5000
const EMPTY = { kind: 'general' as FeedbackKind, body: '' }

/**
 * Feedback from HR to one employee, newest first. `employee`: their own, to
 * read and acknowledge. `hr`: HR writing to and deleting for someone else.
 * Only HR and the employee can read it (RLS); it isn't edited once sent.
 */
export function HrFeedback({ employeeId, name, mode }: { employeeId: string; name: string; mode: 'employee' | 'hr' }) {
  const [items, setItems] = useState<Feedback[]>([])
  const [authors, setAuthors] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Feedback | null>(null)

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('hr_feedback')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }
    const rows = data as Feedback[]
    const ids = [...new Set(rows.map((f) => f.author_id).filter((x): x is string => !!x))]
    if (ids.length) {
      const { data: people } = await supabase.from('employee_directory').select('id, full_name').in('id', ids)
      setAuthors(new Map(((people ?? []) as Pick<DirectoryEntry, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name])))
    }
    setItems(rows)
    setLoading(false)
  }, [employeeId])

  useEffect(() => {
    load()
  }, [load])

  async function send() {
    if (!form.body.trim()) return setFormError('Write the feedback.')
    setBusy(true)
    setFormError(null)
    const { error: sendError } = await supabase
      .from('hr_feedback')
      .insert({ employee_id: employeeId, kind: form.kind, body: form.body.trim() })
    setBusy(false)
    if (sendError) return setFormError(feedbackError(sendError))
    setWriting(false)
    load()
  }

  async function acknowledge(id: string) {
    setError(null)
    const { error: ackError } = await supabase.rpc('hr_feedback_acknowledge', { p_feedback_id: id })
    if (ackError) return setError(feedbackError(ackError))
    load()
  }

  async function remove() {
    const item = deleting!
    setBusy(true)
    const { error: deleteError } = await supabase.from('hr_feedback').delete().eq('id', item.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) return setError(feedbackError(deleteError))
    load()
  }

  const firstName = name.trim().split(/\s+/)[0]

  return (
    <Box component="section" aria-label="Feedback from HR">
      <Stack direction="row" sx={{ alignItems: 'center', mb: 1.5, minHeight: 36 }}>
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          Feedback from HR
        </Typography>
        {mode === 'hr' && (
          <Button
            startIcon={<AddIcon />}
            onClick={() => {
              setForm(EMPTY)
              setFormError(null)
              setWriting(true)
            }}
          >
            Write feedback
          </Button>
        )}
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Paper variant="outlined">
        {items.map((f, i) => (
          <Box key={f.id} aria-label={f.body}>
            {i > 0 && <Divider />}
            <Stack spacing={1} sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Chip size="small" label={FEEDBACK_KIND_LABELS[f.kind]} color={FEEDBACK_KIND_COLORS[f.kind]} variant="outlined" />
                <Typography variant="caption" sx={{ color: 'text.secondary', flexGrow: 1 }}>
                  {formatDay(f.created_at)}
                  {f.author_id && authors.get(f.author_id) && ` · ${authors.get(f.author_id)}`}
                  {' · '}
                  {f.acknowledged_at ? `Acknowledged ${formatDay(f.acknowledged_at)}` : 'Not yet acknowledged'}
                </Typography>
                {mode === 'hr' && (
                  <IconButton size="small" aria-label="Delete feedback" onClick={() => setDeleting(f)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {f.body}
              </Typography>
              {mode === 'employee' && !f.acknowledged_at && (
                <Box>
                  <Button size="small" variant="contained" onClick={() => acknowledge(f.id)}>
                    Acknowledge
                  </Button>
                </Box>
              )}
            </Stack>
          </Box>
        ))}
        {!loading && !items.length && (
          <Typography variant="body2" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            {mode === 'hr' ? `No feedback sent to ${firstName} yet.` : 'No feedback from HR yet.'}
          </Typography>
        )}
      </Paper>

      <FormDialog
        open={writing}
        title={`Feedback for ${name}`}
        submitLabel="Send"
        error={formError}
        busy={busy}
        onSubmit={send}
        onClose={() => setWriting(false)}
      >
        <TextField
          select
          label="Label"
          value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as FeedbackKind }))}
          sx={{ maxWidth: 240 }}
        >
          {(Object.keys(FEEDBACK_KIND_LABELS) as FeedbackKind[]).map((k) => (
            <MenuItem key={k} value={k}>
              {FEEDBACK_KIND_LABELS[k]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Feedback"
          required
          autoFocus
          fullWidth
          multiline
          minRows={5}
          helperText={`${firstName} reads it and acknowledges it. Their manager doesn't see it. It can't be edited once sent.`}
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          slotProps={{ htmlInput: { maxLength: MAX_LENGTH } }}
        />
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title="Delete feedback?"
        message={`It will be deleted for good, and ${firstName} will no longer see it.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </Box>
  )
}
