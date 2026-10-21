import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Chip,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
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
import SearchIcon from '@mui/icons-material/Search'
import { PageHeader } from '../../components/common'
import { supabase } from '../../lib/supabase'
import { EQUIPMENT_STATUS_COLORS, EQUIPMENT_STATUS_LABELS, formatDate } from '../../lib/constants'
import { EQUIPMENT_SELECT, type EquipmentRow } from '../../lib/equipment'
import type { DirectoryEntry, EquipmentStatus } from '../../lib/types'

const STATUSES = Object.keys(EQUIPMENT_STATUS_LABELS) as EquipmentStatus[]

// Operations → Equipment (HR, finance admins, company admins): everything the
// company owns or has asked for, with who has it. Status filter in ?status=.
// A row opens the equipment.
export default function Equipment() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = STATUSES.find((s) => s === params.get('status')) ?? ''
  const [rows, setRows] = useState<EquipmentRow[]>([])
  // Names come from the directory: finance admins can't read employee records.
  const [people, setPeople] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('equipment').select(EQUIPMENT_SELECT).order('name'),
      supabase.from('employee_directory').select('id, full_name'),
    ]).then(([equipmentRes, directoryRes]) => {
      const loadError = equipmentRes.error ?? directoryRes.error
      if (loadError) setError(loadError.message)
      else {
        setRows(equipmentRes.data as unknown as EquipmentRow[])
        setPeople(new Map((directoryRes.data as Pick<DirectoryEntry, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name])))
      }
      setLoading(false)
    })
  }, [])

  const holder = (r: EquipmentRow) => (r.assigned_to ? (people.get(r.assigned_to) ?? '—') : null)

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q ||
          [r.name, r.identifier, (r.assigned_to && people.get(r.assigned_to)) || ''].some((v) =>
            v.toLowerCase().includes(q),
          )),
    )
  }, [rows, people, search, status])

  return (
    <>
      <PageHeader
        title="Equipment"
        subtitle={loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} component={Link} to="/operations/equipment/new">
            Add equipment
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          placeholder="Search by name, identifier or person"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flexGrow: 1, maxWidth: { sm: 420 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          select
          label="Status"
          size="small"
          value={status}
          onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {}, { replace: true })}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {EQUIPMENT_STATUS_LABELS[s]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Equipment</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Assigned to</TableCell>
                <TableCell>Vendor</TableCell>
                <TableCell>Purchased</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r) => (
                <TableRow
                  key={r.id}
                  hover
                  onClick={() => navigate(`/operations/equipment/${r.id}`)}
                  sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {r.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                      {r.identifier}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={EQUIPMENT_STATUS_LABELS[r.status]}
                      color={EQUIPMENT_STATUS_COLORS[r.status]}
                      size="small"
                      variant={r.status === 'active' ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  <TableCell>
                    {r.assigned_to ? (
                      <>
                        <Typography variant="body2">{holder(r)}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          Since {formatDate(r.assigned_on)}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        Unassigned
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{r.vendor?.name ?? '—'}</TableCell>
                  <TableCell>{formatDate(r.purchase_date)}</TableCell>
                </TableRow>
              ))}
              {!loading && !shown.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {rows.length ? 'Nothing matches.' : 'No equipment yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </>
  )
}
