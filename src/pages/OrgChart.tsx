import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  type Theme,
} from '@mui/material'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined'
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { ConfirmDialog, PageHeader, PersonAvatar, StatusChip } from '../components/common'
import type { DirectoryEntry, OrgNode } from '../lib/types'

const TOP_LEVEL = ''
const GAP = 24

// Nested <ul>/<li> rendered as a top-down tree with connector lines.
const treeSx = (theme: Theme) => {
  const line = `1px solid ${theme.palette.grey[400]}`
  return {
    '& ul': {
      display: 'flex',
      justifyContent: 'center',
      position: 'relative',
      m: 0,
      p: `${GAP}px 0 0`,
    },
    '& li': {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      position: 'relative',
      listStyle: 'none',
      p: `${GAP}px 8px 0`,
    },
    '& li::before, & li::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      right: '50%',
      width: '50%',
      height: GAP,
      borderTop: line,
    },
    '& li::after': { right: 'auto', left: '50%', borderLeft: line },
    '& li:only-child::before, & li:only-child::after': { display: 'none' },
    '& li:only-child': { pt: 0 },
    '& li:first-of-type::before, & li:last-of-type::after': { border: 0 },
    '& li:last-of-type::before': { borderRight: line, borderTopRightRadius: 8 },
    '& li:first-of-type::after': { borderTopLeftRadius: 8 },
    '& ul ul::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: '50%',
      height: GAP,
      borderLeft: line,
    },
    // Top-level people have nothing above them.
    '& > ul, & > ul > li': { pt: 0 },
    '& > ul > li::before, & > ul > li::after': { display: 'none' },
  }
}

export default function OrgChart() {
  const { isHr: canEdit } = useAuth()
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [nodes, setNodes] = useState<OrgNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // Add-person dialog: null = closed, otherwise the pre-selected manager.
  const [addUnder, setAddUnder] = useState<string | null>(null)
  const [addEmployee, setAddEmployee] = useState<DirectoryEntry | null>(null)
  const [toRemove, setToRemove] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [directory, chart] = await Promise.all([
      supabase.from('employee_directory').select('*').order('full_name'),
      supabase.from('org_chart_nodes').select('employee_id, manager_id'),
    ])
    const failure = directory.error ?? chart.error
    if (failure) setError(failure.message)
    else {
      setPeople(directory.data as DirectoryEntry[])
      setNodes(chart.data as OrgNode[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const managerOf = useMemo(() => new Map(nodes.map((n) => [n.employee_id, n.manager_id])), [nodes])
  const childrenOf = useMemo(() => {
    const map = new Map<string, string[]>()
    // `people` is name-sorted, so iterating it keeps siblings in alphabetical order.
    for (const p of people) {
      if (!managerOf.has(p.id)) continue
      const key = managerOf.get(p.id) ?? TOP_LEVEL
      map.set(key, [...(map.get(key) ?? []), p.id])
    }
    return map
  }, [people, managerOf])

  const inChart = people.filter((p) => managerOf.has(p.id))
  const notInChart = people.filter(
    (p) => !managerOf.has(p.id) && p.status !== 'left' && p.status !== 'terminated',
  )

  function isBelow(id: string, ancestorId: string) {
    for (let cur = managerOf.get(id); cur; cur = managerOf.get(cur)) {
      if (cur === ancestorId) return true
    }
    return false
  }

  // target: an employee id, or TOP_LEVEL.
  function canDrop(target: string) {
    if (!dragId || target === dragId) return false
    if ((managerOf.get(dragId) ?? TOP_LEVEL) === target) return false
    return target === TOP_LEVEL || !isBelow(target, dragId)
  }

  async function run(action: PromiseLike<{ error: { message: string } | null }>) {
    setError(null)
    setBusy(true)
    const { error: actionError } = await action
    if (actionError) setError(actionError.message)
    await load()
    setBusy(false)
    return !actionError
  }

  const move = (id: string, managerId: string) =>
    run(
      supabase
        .from('org_chart_nodes')
        .update({ manager_id: managerId || null })
        .eq('employee_id', id),
    )

  async function remove() {
    if (!toRemove) return
    await run(supabase.rpc('org_chart_remove', { p_employee_id: toRemove }))
    setToRemove(null)
  }

  async function add() {
    if (!addEmployee || addUnder === null) return
    const ok = await run(
      supabase
        .from('org_chart_nodes')
        .insert({ employee_id: addEmployee.id, manager_id: addUnder || null }),
    )
    if (ok) closeAdd()
  }

  function openAdd(managerId: string) {
    setAddEmployee(null)
    setAddUnder(managerId)
  }

  function closeAdd() {
    setAddUnder(null)
    setAddEmployee(null)
  }

  function dropProps(target: string) {
    return {
      onDragOver: (e: DragEvent) => {
        if (!canDrop(target)) return
        e.preventDefault()
        e.stopPropagation()
        setDropTarget(target)
      },
      onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const id = dragId
        setDragId(null)
        setDropTarget(null)
        if (id && canDrop(target)) move(id, target)
      },
    }
  }

  function renderBranch(id: string) {
    const person = byId.get(id)
    const reports = childrenOf.get(id) ?? []
    const name = person?.full_name ?? 'Unknown'
    const inactive = person && (person.status === 'left' || person.status === 'terminated')
    return (
      <li key={id}>
        <Paper
          variant="outlined"
          draggable={canEdit}
          onDragStart={(e: DragEvent) => {
            e.dataTransfer.setData('text/plain', id)
            e.dataTransfer.effectAllowed = 'move'
            setDragId(id)
          }}
          onDragEnd={() => {
            setDragId(null)
            setDropTarget(null)
          }}
          {...(canEdit ? dropProps(id) : {})}
          sx={{
            position: 'relative',
            width: 200,
            px: 2,
            pt: 2,
            pb: 1.5,
            textAlign: 'center',
            cursor: canEdit ? 'grab' : 'default',
            opacity: dragId === id ? 0.4 : 1,
            transition: 'box-shadow 120ms, border-color 120ms',
            borderColor: dropTarget === id ? 'primary.main' : 'divider',
            boxShadow: dropTarget === id ? (t) => `0 0 0 3px ${t.palette.primary.light}55` : 'none',
            '&:hover': { boxShadow: 2 },
            '&:hover .node-actions, &:focus-within .node-actions': { opacity: 1 },
          }}
        >
          <Stack spacing={0.75} sx={{ alignItems: 'center' }}>
            <PersonAvatar name={name} size={44} />
            <Box sx={{ width: '100%' }}>
              <Typography variant="subtitle2" noWrap title={name}>
                {name}
              </Typography>
              <Typography variant="caption" component="div" noWrap sx={{ color: 'text.secondary' }}>
                {person?.designation ?? '—'}
              </Typography>
              {person?.department && (
                <Typography variant="caption" component="div" noWrap sx={{ color: 'text.disabled' }}>
                  {person.department}
                </Typography>
              )}
            </Box>
            {inactive && <StatusChip status={person.status} />}
          </Stack>
          {canEdit && (
            <Stack
              className="node-actions"
              direction="row"
              sx={{ position: 'absolute', top: 4, right: 4, opacity: 0, transition: 'opacity 120ms' }}
            >
              <Tooltip title="Add report">
                <IconButton size="small" onClick={() => openAdd(id)}>
                  <PersonAddAlt1OutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Remove from chart">
                <IconButton size="small" onClick={() => setToRemove(id)}>
                  <PersonRemoveOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          )}
        </Paper>
        {reports.length > 0 && <ul>{reports.map(renderBranch)}</ul>}
      </li>
    )
  }

  const roots = childrenOf.get(TOP_LEVEL) ?? []
  const removeReports = toRemove ? (childrenOf.get(toRemove)?.length ?? 0) : 0

  return (
    <>
      <PageHeader
        title="Org chart"
        subtitle={loading ? 'Loading…' : `${inChart.length} ${inChart.length === 1 ? 'person' : 'people'} in the chart`}
        actions={
          canEdit && (
            <Button
              variant="contained"
              startIcon={<PersonAddAlt1OutlinedIcon />}
              onClick={() => openAdd(TOP_LEVEL)}
            >
              Add person
            </Button>
          )
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {canEdit && roots.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2, color: 'text.secondary' }}>
          <DragIndicatorIcon fontSize="small" />
          <Typography variant="body2">
            Drag a person onto someone else to change who they report to. Hover a card for more actions.
          </Typography>
        </Stack>
      )}

      {dragId && (
        <Paper
          variant="outlined"
          {...dropProps(TOP_LEVEL)}
          sx={{
            mb: 2,
            p: 2,
            textAlign: 'center',
            borderStyle: 'dashed',
            borderWidth: 2,
            borderColor: dropTarget === TOP_LEVEL ? 'primary.main' : 'divider',
            bgcolor: dropTarget === TOP_LEVEL ? 'action.hover' : 'transparent',
            color: dropTarget === TOP_LEVEL ? 'primary.main' : 'text.secondary',
          }}
        >
          <Typography variant="body2">Drop here to move to the top level</Typography>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ overflow: 'auto', p: { xs: 2, md: 4 }, position: 'relative' }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
            <CircularProgress />
          </Box>
        ) : roots.length ? (
          <Box sx={[treeSx, { display: 'inline-block', minWidth: '100%', opacity: busy ? 0.6 : 1 }]}>
            <Box component="ul" sx={{ gap: 3 }}>
              {roots.map(renderBranch)}
            </Box>
          </Box>
        ) : (
          <Stack spacing={1.5} sx={{ alignItems: 'center', py: 8, color: 'text.secondary', textAlign: 'center' }}>
            <AccountTreeOutlinedIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
            <Typography variant="subtitle1">The org chart is empty</Typography>
            {canEdit && (
              <Typography variant="body2">Use “Add person” to start building it.</Typography>
            )}
          </Stack>
        )}
      </Paper>

      <Dialog open={addUnder !== null} onClose={closeAdd} maxWidth="xs" fullWidth>
        <DialogTitle>Add to org chart</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Autocomplete
              options={notInChart}
              value={addEmployee}
              onChange={(_e, value) => setAddEmployee(value)}
              getOptionLabel={(p) => p.full_name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              noOptionsText="Everyone is already in the chart"
              renderOption={({ key, ...props }, p) => (
                <li key={key} {...props}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <PersonAvatar name={p.full_name} size={28} />
                    <Box>
                      <Typography variant="body2">{p.full_name}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {p.designation ?? p.company_email}
                      </Typography>
                    </Box>
                  </Stack>
                </li>
              )}
              renderInput={(params) => <TextField {...params} label="Person" autoFocus />}
            />
            <Autocomplete
              options={inChart}
              value={addUnder ? (byId.get(addUnder) ?? null) : null}
              onChange={(_e, value) => setAddUnder(value?.id ?? TOP_LEVEL)}
              getOptionLabel={(p) => p.full_name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => (
                <TextField {...params} label="Reports to" helperText="Leave empty to place at the top level" />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeAdd} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={add} disabled={!addEmployee} loading={busy}>
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toRemove}
        title="Remove from org chart?"
        message={`${toRemove ? byId.get(toRemove)?.full_name : ''} will be removed from the chart.${
          removeReports ? ` Their ${removeReports} direct report(s) will move up one level.` : ''
        } Their employee record is not affected.`}
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setToRemove(null)}
      />
    </>
  )
}
