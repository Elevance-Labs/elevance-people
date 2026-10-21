import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import { supabase } from '../lib/supabase'
import { formatDayTime } from '../lib/constants'
import { noteError } from '../lib/performance'
import type { ManagerNote } from '../lib/types'

const MAX_LENGTH = 10000

/**
 * The signed-in manager's one running note about a direct report: things to
 * raise at their next 1:1, edited as they go. Saved on leaving the box or
 * with Save. Only the author ever reads it (RLS); it is not part of any review.
 */
export function PrivateNotes({ employeeId, name }: { employeeId: string; name: string }) {
  const [note, setNote] = useState<ManagerNote | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // RLS returns only the caller's own note.
    const { data, error: loadError } = await supabase
      .from('manager_notes')
      .select('*')
      .eq('employee_id', employeeId)
      .maybeSingle()
    if (loadError) setError(loadError.message)
    else {
      setNote(data as ManagerNote | null)
      setText((data as ManagerNote | null)?.body ?? '')
    }
    setLoading(false)
  }, [employeeId])

  useEffect(() => {
    load()
  }, [load])

  const dirty = !loading && text !== (note?.body ?? '')

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    setError(null)
    const notes = supabase.from('manager_notes')
    const { data, error: saveError } = await (note
      ? notes.update({ body: text }).eq('id', note.id).select().single()
      : notes.insert({ employee_id: employeeId, body: text }).select().single())
    setSaving(false)
    if (saveError) return setError(noteError(saveError))
    setNote(data as ManagerNote)
  }

  const firstName = name.trim().split(/\s+/)[0]
  const status = saving
    ? 'Saving…'
    : dirty
      ? 'Unsaved changes'
      : note
        ? `Saved ${formatDayTime(note.updated_at)}`
        : 'Saves when you click away'

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Private notes"
      sx={{ p: { xs: 2, sm: 3 }, bgcolor: 'grey.50', borderStyle: 'dashed' }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <LockOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
          Private notes
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Only you can see this. It's not part of any review, and {firstName} and HR never see it.
      </Typography>
      <TextField
        label="Your notes"
        placeholder={`Things to raise at your next 1:1 with ${firstName}`}
        fullWidth
        multiline
        minRows={4}
        disabled={loading}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        slotProps={{ htmlInput: { maxLength: MAX_LENGTH } }}
      />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
        <Typography variant="caption" role="status" sx={{ color: dirty ? 'warning.main' : 'text.secondary', flexGrow: 1 }}>
          {status}
        </Typography>
        <Button size="small" onClick={save} loading={saving} disabled={!dirty}>
          Save
        </Button>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Paper>
  )
}
