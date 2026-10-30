import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Chip,
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
import { FormDialog, PageHeader } from '../../components/common'
import { supabase } from '../../lib/supabase'
import { PAYROLL_STATUS_COLORS, PAYROLL_STATUS_LABELS } from '../../lib/constants'
import { yearOptions } from '../../lib/leaves'
import {
  MONTHS,
  PAYROLL_LIST,
  byPeriodDesc,
  formatAmount,
  payrollError,
  periodLabel,
  type PayrollListRow,
} from '../../lib/payroll'

const OPEN_STATUS_TEXT = { draft: 'a draft', review: 'in review', approved: 'approved', processed: 'processed' }

// Finance → Payroll (HR, finance admins, company admins): one payroll per
// month, newest first. A new one starts with everyone who can be paid; only
// one may be open (not yet disbursed) at a time. A row opens the payroll.
export default function Payrolls() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<PayrollListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [period, setPeriod] = useState({ year: 0, month: 0 })
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase
      .from('payrolls')
      .select(PAYROLL_LIST)
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        else setRows((data as unknown as PayrollListRow[]).sort(byPeriodDesc))
        setLoading(false)
      })
  }, [])

  const open = rows.find((r) => r.status !== 'disbursed')

  // Suggests the month after the latest payroll, or this month for the first.
  function startCreating() {
    const latest = rows[0]
    const now = new Date()
    setPeriod(
      latest
        ? latest.month === 12
          ? { year: latest.year + 1, month: 1 }
          : { year: latest.year, month: latest.month + 1 }
        : { year: now.getFullYear(), month: now.getMonth() + 1 },
    )
    setFormError(null)
    setCreating(true)
  }

  async function create() {
    setBusy(true)
    setFormError(null)
    const { data, error: createError } = await supabase.rpc('payroll_create', {
      p_year: period.year,
      p_month: period.month,
    })
    setBusy(false)
    if (createError) return setFormError(payrollError(createError))
    navigate(`/finance/payroll/${data as string}`)
  }

  const years = [...new Set([...yearOptions(), period.year])].filter(Boolean).sort((a, b) => b - a)

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle="One payroll per month. It starts with everyone on probation, active or on their notice period."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} disabled={loading || !!open} onClick={startCreating}>
            New payroll
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {open && (
        <Alert severity="info" sx={{ mb: 2 }}>
          The {periodLabel(open)} payroll is {OPEN_STATUS_TEXT[open.status as keyof typeof OPEN_STATUS_TEXT]}. It
          must be disbursed before another is started.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Month</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Employees</TableCell>
                <TableCell align="right">Net payable (PKR)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  hover
                  onClick={() => navigate(`/finance/payroll/${r.id}`)}
                  sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {periodLabel(r)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={PAYROLL_STATUS_LABELS[r.status]}
                      color={PAYROLL_STATUS_COLORS[r.status]}
                      size="small"
                      variant={r.status === 'disbursed' ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  <TableCell align="right">{r.items.length}</TableCell>
                  <TableCell align="right">
                    {formatAmount(r.items.reduce((sum, i) => sum + Number(i.net_salary), 0))}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !rows.length && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    No payrolls yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FormDialog
        open={creating}
        title="New payroll"
        submitLabel="Create"
        error={formError}
        busy={busy}
        onSubmit={create}
        onClose={() => setCreating(false)}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Everyone on probation, active or on their notice period is added. Basic salary, contractual amount and
          allowance carry over from each person’s latest earlier payroll.
        </Typography>
        <Stack direction="row" spacing={2}>
          <TextField
            select
            label="Month"
            required
            fullWidth
            value={period.month}
            onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))}
          >
            {MONTHS.map((name, i) => (
              <MenuItem key={name} value={i + 1}>
                {name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Year"
            required
            fullWidth
            value={period.year}
            onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
          >
            {years.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </FormDialog>
    </>
  )
}
