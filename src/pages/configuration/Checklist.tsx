import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import { supabase } from '../../lib/supabase'
import { checklistError, moved } from '../../lib/onboarding'
import type { OnboardingTemplateSection, OnboardingTemplateTask } from '../../lib/types'

type Editing =
  | { kind: 'section'; section: OnboardingTemplateSection | null }
  | { kind: 'task'; sectionId: string; task: OnboardingTemplateTask | null }
type Deleting =
  | { kind: 'section'; section: OnboardingTemplateSection; tasks: number }
  | { kind: 'task'; task: OnboardingTemplateTask }

function OrderButtons({
  label,
  index,
  count,
  disabled,
  onMove,
}: {
  label: string
  index: number
  count: number
  disabled: boolean
  onMove: (by: -1 | 1) => void
}) {
  return (
    <>
      <IconButton size="small" aria-label={`Move ${label} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
        <ArrowUpwardIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label={`Move ${label} down`}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDownwardIcon fontSize="small" />
      </IconButton>
    </>
  )
}

const COPY = {
  onboarding: {
    title: 'Onboarding checklist',
    subtitle: 'Every new hire’s onboarding starts with a copy of this list. Changes apply to onboardings started after.',
  },
  offboarding: {
    title: 'Offboarding checklist',
    subtitle:
      'Everyone’s offboarding starts with a copy of this list when they’re put on notice. Changes apply to offboardings started after.',
  },
}

// Configuration → Onboarding / Offboarding (company admins): the checklist
// every onboarding (or offboarding) starts from — sections, each with tasks,
// in order. It's copied when one starts, so changes here don't reach those
// already under way. Order changes only through the reorder RPCs.
export default function Checklist({ kind }: { kind: 'onboarding' | 'offboarding' }) {
  const sectionsTable = `${kind}_template_sections`
  const tasksTable = `${kind}_template_tasks`
  const [sections, setSections] = useState<OnboardingTemplateSection[]>([])
  const [tasks, setTasks] = useState<OnboardingTemplateTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [value, setValue] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Deleting | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [sectionsRes, tasksRes] = await Promise.all([
      supabase.from(sectionsTable).select('id, name, sort_order').order('sort_order'),
      supabase.from(tasksTable).select('id, section_id, title, sort_order').order('sort_order'),
    ])
    const loadError = sectionsRes.error ?? tasksRes.error
    if (loadError) setError(loadError.message)
    else {
      setSections(sectionsRes.data as OnboardingTemplateSection[])
      setTasks(tasksRes.data as OnboardingTemplateTask[])
    }
    setLoading(false)
  }, [sectionsTable, tasksTable])

  useEffect(() => {
    load()
  }, [load])

  const tasksOf = (sectionId: string) => tasks.filter((t) => t.section_id === sectionId)

  function openEditor(next: Editing) {
    setValue(next.kind === 'section' ? (next.section?.name ?? '') : (next.task?.title ?? ''))
    setFormError(null)
    setEditing(next)
  }

  async function save() {
    if (!editing) return
    setBusy(true)
    setFormError(null)
    const text = value.trim()
    let result
    if (editing.kind === 'section') {
      const table = supabase.from(sectionsTable)
      result = await (editing.section
        ? table.update({ name: text }).eq('id', editing.section.id)
        : table.insert({ name: text }))
    } else {
      const table = supabase.from(tasksTable)
      result = await (editing.task
        ? table.update({ title: text }).eq('id', editing.task.id)
        : table.insert({ section_id: editing.sectionId, title: text }))
    }
    setBusy(false)
    if (result.error) return setFormError(checklistError(result.error, kind))
    setEditing(null)
    load()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    const { error: deleteError } =
      deleting.kind === 'section'
        ? await supabase.from(sectionsTable).delete().eq('id', deleting.section.id)
        : await supabase.from(tasksTable).delete().eq('id', deleting.task.id)
    setBusy(false)
    setDeleting(null)
    if (deleteError) return setError(checklistError(deleteError, kind))
    load()
  }

  async function reorder(call: PromiseLike<{ error: { code?: string; message: string } | null }>) {
    setBusy(true)
    setError(null)
    const { error: orderError } = await call
    if (orderError) setError(checklistError(orderError, kind))
    await load()
    setBusy(false)
  }

  const moveSection = (index: number, by: -1 | 1) =>
    reorder(supabase.rpc(`${kind}_reorder_sections`, { p_ids: moved(sections, index, by) }))
  const moveTask = (sectionId: string, index: number, by: -1 | 1) =>
    reorder(
      supabase.rpc(`${kind}_reorder_tasks`, { p_section_id: sectionId, p_ids: moved(tasksOf(sectionId), index, by) }),
    )

  const editingNew = editing?.kind === 'section' ? !editing.section : !editing?.task

  return (
    <>
      <PageHeader
        title={COPY[kind].title}
        subtitle={COPY[kind].subtitle}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEditor({ kind: 'section', section: null })}>
            Add section
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {!loading && !sections.length && (
        <Paper variant="outlined" sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
          No sections yet. Add one, then add its tasks.
        </Paper>
      )}

      <Stack spacing={2}>
        {sections.map((section, i) => {
          const own = tasksOf(section.id)
          return (
            <Paper key={section.id} variant="outlined" component="section" aria-label={section.name} sx={{ overflow: 'hidden' }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', px: 2, py: 1.25, bgcolor: 'grey.50', borderBottom: 1, borderColor: 'divider' }}
              >
                <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                  {section.name}
                </Typography>
                <Chip label={own.length} size="small" />
                <Box sx={{ flexGrow: 1 }} />
                <OrderButtons
                  label={section.name}
                  index={i}
                  count={sections.length}
                  disabled={busy}
                  onMove={(by) => moveSection(i, by)}
                />
                <IconButton
                  size="small"
                  aria-label={`Rename ${section.name}`}
                  onClick={() => openEditor({ kind: 'section', section })}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={`Delete ${section.name}`}
                  onClick={() => setDeleting({ kind: 'section', section, tasks: own.length })}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Stack component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {own.map((task, j) => (
                  <Stack
                    key={task.id}
                    component="li"
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}
                  >
                    <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
                      {task.title}
                    </Typography>
                    <OrderButtons
                      label={task.title}
                      index={j}
                      count={own.length}
                      disabled={busy}
                      onMove={(by) => moveTask(section.id, j, by)}
                    />
                    <IconButton
                      size="small"
                      aria-label={`Edit ${task.title}`}
                      onClick={() => openEditor({ kind: 'task', sectionId: section.id, task })}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Delete ${task.title}`}
                      onClick={() => setDeleting({ kind: 'task', task })}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
              <Box sx={{ px: 1, py: 0.75 }}>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  aria-label={`Add task to ${section.name}`}
                  onClick={() => openEditor({ kind: 'task', sectionId: section.id, task: null })}
                >
                  Add task
                </Button>
              </Box>
            </Paper>
          )
        })}
      </Stack>

      <FormDialog
        open={!!editing}
        title={
          editing?.kind === 'section'
            ? editingNew ? 'Add section' : 'Rename section'
            : editingNew ? 'Add task' : 'Edit task'
        }
        submitLabel={editingNew ? 'Add' : 'Save'}
        error={formError}
        busy={busy}
        onSubmit={save}
        onClose={() => setEditing(null)}
      >
        <TextField
          label={editing?.kind === 'section' ? 'Name' : 'Task'}
          required
          autoFocus
          fullWidth
          value={value}
          onChange={(e) => setValue(e.target.value)}
          slotProps={{ htmlInput: { maxLength: editing?.kind === 'section' ? 200 : 500 } }}
        />
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        title={deleting?.kind === 'section' ? 'Delete section?' : 'Delete task?'}
        message={
          deleting?.kind === 'section'
            ? deleting.tasks
              ? `${deleting.section.name} and its ${deleting.tasks} task(s) will be deleted from the checklist.`
              : `${deleting.section.name} will be deleted from the checklist.`
            : `“${deleting?.task.title}” will be deleted from the checklist.`
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
