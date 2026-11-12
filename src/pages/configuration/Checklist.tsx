import { useCallback, useEffect, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import { supabase } from '../../lib/supabase'
import { checklistError, moved } from '../../lib/onboarding'
import type { Department, OnboardingTemplateSection, OnboardingTemplateTask } from '../../lib/types'

type Editing =
  | { kind: 'section'; section: OnboardingTemplateSection | null }
  | { kind: 'task'; sectionId: string; task: OnboardingTemplateTask | null }
type Deleting =
  | { kind: 'section'; section: OnboardingTemplateSection; tasks: number }
  | { kind: 'task'; task: OnboardingTemplateTask }

// What's being dragged: a section, or a task within its section.
type Dragging = { kind: 'section'; id: string } | { kind: 'task'; sectionId: string; id: string }

// The handle a row is dragged by; it also moves the row with the arrow keys.
function DragHandle({ label, onKeyMove }: { label: string; onKeyMove: (by: -1 | 1) => void }) {
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    onKeyMove(e.key === 'ArrowUp' ? -1 : 1)
  }
  return (
    <IconButton
      size="small"
      aria-label={`Reorder ${label}`}
      title="Drag to reorder (or use the arrow keys)"
      onKeyDown={onKeyDown}
      sx={{ cursor: 'grab', color: 'text.disabled', ml: -1 }}
    >
      <DragIndicatorIcon fontSize="small" />
    </IconButton>
  )
}

const COPY = {
  onboarding: {
    title: 'Onboarding checklist',
    subtitle:
      'Every new hire’s onboarding starts with a copy of this list: the sections for everyone, and those for their department. Changes reach onboardings in progress too.',
  },
  offboarding: {
    title: 'Offboarding checklist',
    subtitle:
      'Everyone’s offboarding starts with a copy of this list when they’re put on notice: the sections for everyone, and those for their department. Changes reach offboardings in progress too.',
  },
}

// Configuration → Onboarding / Offboarding (company admins): the checklist
// every onboarding (or offboarding) starts from — sections, each with tasks,
// in order. A section may be for one department only. Those in progress
// follow it (onboarding_sync / offboarding_sync, in the database). Sections and
// tasks are reordered by dragging; order changes only through the reorder RPCs.
// A department filter (?department=…) shows what that department gets: its
// sections and those for everyone.
export default function Checklist({ kind }: { kind: 'onboarding' | 'offboarding' }) {
  const sectionsTable = `${kind}_template_sections`
  const tasksTable = `${kind}_template_tasks`
  const [params, setParams] = useSearchParams()
  const departmentFilter = params.get('department') ?? ''
  const [sections, setSections] = useState<OnboardingTemplateSection[]>([])
  const [tasks, setTasks] = useState<OnboardingTemplateTask[]>([])
  const [departments, setDepartments] = useState<Pick<Department, 'id' | 'name'>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [value, setValue] = useState('')
  // The section's department; '' = everyone.
  const [departmentId, setDepartmentId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Deleting | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState<Dragging | null>(null)
  // The row the dragged one is over.
  const [over, setOver] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [sectionsRes, tasksRes, departmentsRes] = await Promise.all([
      supabase.from(sectionsTable).select('id, name, department_id, sort_order').order('sort_order'),
      supabase.from(tasksTable).select('id, section_id, title, sort_order').order('sort_order'),
      supabase.from('departments').select('id, name').order('name'),
    ])
    const loadError = sectionsRes.error ?? tasksRes.error ?? departmentsRes.error
    if (loadError) setError(loadError.message)
    else {
      setSections(sectionsRes.data as OnboardingTemplateSection[])
      setTasks(tasksRes.data as OnboardingTemplateTask[])
      setDepartments(departmentsRes.data as Pick<Department, 'id' | 'name'>[])
    }
    setLoading(false)
  }, [sectionsTable, tasksTable])

  useEffect(() => {
    load()
  }, [load])

  const tasksOf = (sectionId: string) => tasks.filter((t) => t.section_id === sectionId)
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name
  const shown = departmentFilter
    ? sections.filter((s) => !s.department_id || s.department_id === departmentFilter)
    : sections

  function openEditor(next: Editing) {
    setValue(next.kind === 'section' ? (next.section?.name ?? '') : (next.task?.title ?? ''))
    // A new section starts with the department being looked at.
    setDepartmentId(next.kind === 'section' ? (next.section ? (next.section.department_id ?? '') : departmentFilter) : '')
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
      const row = { name: text, department_id: departmentId || null }
      result = await (editing.section ? table.update(row).eq('id', editing.section.id) : table.insert(row))
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

  // The rows `item` is ordered among, as shown.
  const siblingsOf = (item: Dragging): { id: string }[] => (item.kind === 'section' ? shown : tasksOf(item.sectionId))

  function move(item: Dragging, from: number, to: number) {
    if (busy || from === to || to < 0 || to >= siblingsOf(item).length) return
    let ids = moved(siblingsOf(item), from, to)
    // The RPC takes every section: those filtered out keep their places, and
    // the shown ones fill theirs in the new order.
    if (item.kind === 'section' && shown.length < sections.length) {
      const order = [...ids]
      ids = sections.map((s) => (shown.includes(s) ? order.shift()! : s.id))
    }
    reorder(
      item.kind === 'section'
        ? supabase.rpc(`${kind}_reorder_sections`, { p_ids: ids })
        : supabase.rpc(`${kind}_reorder_tasks`, { p_section_id: item.sectionId, p_ids: ids }),
    )
  }

  // Where the dragged row would land if dropped on `item`, or -1 if it can't:
  // a section among sections, a task only within its own section.
  function dropIndex(item: Dragging) {
    if (!dragging || dragging.kind !== item.kind || dragging.id === item.id) return -1
    if (dragging.kind === 'task' && item.kind === 'task' && dragging.sectionId !== item.sectionId) return -1
    return siblingsOf(item).findIndex((s) => s.id === item.id)
  }

  // Drag and drop for one row. Tasks sit inside a draggable section, so each
  // handler stops the event once it has used it.
  function sortable(item: Dragging, index: number) {
    const from = dragging ? siblingsOf(item).findIndex((s) => s.id === dragging.id) : -1
    const end = () => {
      setDragging(null)
      setOver(null)
    }
    return {
      draggable: !busy,
      onDragStart: (e: DragEvent) => {
        e.stopPropagation()
        e.dataTransfer.setData('text/plain', item.id)
        e.dataTransfer.effectAllowed = 'move'
        setDragging(item)
      },
      onDragEnd: (e: DragEvent) => {
        e.stopPropagation()
        end()
      },
      onDragOver: (e: DragEvent) => {
        if (dropIndex(item) < 0) return
        e.preventDefault()
        e.stopPropagation()
        setOver(item.id)
      },
      onDragLeave: () => setOver((o) => (o === item.id ? null : o)),
      onDrop: (e: DragEvent) => {
        const to = dropIndex(item)
        if (to < 0) return
        e.preventDefault()
        e.stopPropagation()
        const dragged = dragging
        end()
        if (dragged) move(dragged, from, to)
      },
      sx: {
        position: 'relative',
        opacity: dragging?.id === item.id ? 0.4 : 1,
        // A line on the side the dragged row will land.
        ...(over === item.id && {
          '&::after': {
            content: '""',
            position: 'absolute',
            left: 0,
            right: 0,
            height: 3,
            bgcolor: 'primary.main',
            zIndex: 1,
            ...(from < index ? { bottom: 0 } : { top: 0 }),
          },
        }),
      },
    }
  }

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

      <TextField
        select
        label="Department"
        value={departmentFilter}
        onChange={(e) => setParams(e.target.value ? { department: e.target.value } : {}, { replace: true })}
        helperText={departmentFilter ? 'Its own sections, and those for everyone.' : undefined}
        sx={{ minWidth: 240, mb: 2 }}
      >
        <MenuItem value="">All departments</MenuItem>
        {departments.map((d) => (
          <MenuItem key={d.id} value={d.id}>
            {d.name}
          </MenuItem>
        ))}
      </TextField>

      {!loading && !shown.length && (
        <Paper variant="outlined" sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
          {sections.length
            ? `No sections for ${departmentName(departmentFilter) ?? 'this department'} or everyone yet.`
            : 'No sections yet. Add one, then add its tasks.'}
        </Paper>
      )}

      <Stack spacing={2}>
        {shown.map((section, i) => {
          const own = tasksOf(section.id)
          const { sx: dragSx, ...drag } = sortable({ kind: 'section', id: section.id }, i)
          return (
            <Paper
              key={section.id}
              variant="outlined"
              component="section"
              aria-label={section.name}
              {...drag}
              sx={{ ...dragSx, overflow: 'hidden' }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', px: 2, py: 1.25, bgcolor: 'background.subtle', borderBottom: 1, borderColor: 'divider' }}
              >
                <DragHandle
                  label={section.name}
                  onKeyMove={(by) => move({ kind: 'section', id: section.id }, i, i + by)}
                />
                <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                  {section.name}
                </Typography>
                <Chip label={own.length} size="small" />
                <Chip
                  label={section.department_id ? (departmentName(section.department_id) ?? 'A department') : 'Everyone'}
                  size="small"
                  variant="outlined"
                  color={section.department_id ? 'primary' : 'default'}
                />
                <Box sx={{ flexGrow: 1 }} />
                <IconButton
                  size="small"
                  aria-label={`Edit ${section.name}`}
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
                {own.map((task, j) => {
                  const item: Dragging = { kind: 'task', sectionId: section.id, id: task.id }
                  const { sx: dragSx, ...drag } = sortable(item, j)
                  return (
                    <Stack
                      key={task.id}
                      component="li"
                      direction="row"
                      spacing={1}
                      {...drag}
                      sx={{ ...dragSx, alignItems: 'center', px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}
                    >
                      <DragHandle label={task.title} onKeyMove={(by) => move(item, j, j + by)} />
                      <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
                        {task.title}
                      </Typography>
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
                  )
                })}
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
            ? editingNew ? 'Add section' : 'Edit section'
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
        {editing?.kind === 'section' && (
          <TextField
            select
            label="Department"
            fullWidth
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            helperText={
              departmentId
                ? `Copied only for people in ${departmentName(departmentId) ?? 'this department'}.`
                : 'Copied for everyone.'
            }
          >
            <MenuItem value="">Everyone</MenuItem>
            {departments.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {d.name}
              </MenuItem>
            ))}
          </TextField>
        )}
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
