import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
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
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { supabase } from '../lib/supabase'
import {
  EMPLOYMENT_TYPE_LABELS,
  STATUS_LABELS,
  formatDate,
  formatEmployeeNumber,
} from '../lib/constants'
import { PageHeader, PersonAvatar, StatusChip } from '../components/common'
import type { Department, Designation, Employee, EmployeeStatus } from '../lib/types'

type Row = Pick<
  Employee,
  | 'id'
  | 'employee_number'
  | 'full_name'
  | 'company_email'
  | 'department_id'
  | 'employment_type'
  | 'status'
  | 'date_of_joining'
> & {
  department: Pick<Department, 'name'> | null
  designation: Pick<Designation, 'title'> | null
}

export default function Employees() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<EmployeeStatus | ''>('')
  const [departmentId, setDepartmentId] = useState('')
  const [departments, setDepartments] = useState<Department[]>([])
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  useEffect(() => {
    Promise.all([
      supabase
        .from('employees')
        .select(
          'id, employee_number, full_name, company_email, department_id, employment_type, status, date_of_joining, ' +
            'department:departments!employees_department_id_fkey(name), designation:designations!employees_designation_fkey(title)',
        )
        .order('employee_number'),
      supabase.from('departments').select('id, name, description').order('name'),
    ]).then(([employeesRes, departmentsRes]) => {
      const loadError = employeesRes.error ?? departmentsRes.error
      if (loadError) setError(loadError.message)
      else {
        setRows(employeesRes.data as unknown as Row[])
        setDepartments(departmentsRes.data as Department[])
      }
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!departmentId || r.department_id === departmentId) &&
        (!q ||
          [r.full_name, r.company_email, r.designation?.title, r.department?.name, String(r.employee_number)]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(q))),
    )
  }, [rows, search, status, departmentId])

  useEffect(() => setPage(0), [search, status, departmentId])

  const visible = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle={loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'person' : 'people'}`}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} component={Link} to="/employees/new">
            Add employee
          </Button>
        }
      />

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ p: 2 }}>
          <TextField
            placeholder="Search name, email, department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flex: 1, maxWidth: { sm: 380 } }}
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
            label="Department"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">All departments</MenuItem>
            {departments.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {d.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as EmployeeStatus | '')}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All statuses</MenuItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mx: 2, mb: 2 }}>
            {error}
          </Alert>
        )}
        {loading && <LinearProgress />}

        <TableContainer>
          <Table sx={{ '& th, & td': { whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>No.</TableCell>
                <TableCell>Designation</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Joined</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((r) => (
                <TableRow
                  key={r.id}
                  hover
                  onClick={() => navigate(`/employees/${r.id}`)}
                  sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                >
                  <TableCell>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                      <PersonAvatar name={r.full_name} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {r.full_name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {r.company_email}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {formatEmployeeNumber(r.employee_number)}
                  </TableCell>
                  <TableCell>{r.designation?.title ?? '—'}</TableCell>
                  <TableCell>{r.department?.name ?? '—'}</TableCell>
                  <TableCell>{EMPLOYMENT_TYPE_LABELS[r.employment_type]}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(r.date_of_joining)}</TableCell>
                  <TableCell>
                    <StatusChip status={r.status} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !filtered.length && (
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    {rows.length ? 'No employees match your filters.' : 'No employees yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[10, 25, 50, 100]}
          onPageChange={(_e, p) => setPage(p)}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(Number(e.target.value))
            setPage(0)
          }}
        />
      </Paper>
    </>
  )
}
