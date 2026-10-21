import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { supabase } from '../../lib/supabase'
import { formatAmount } from '../../lib/payroll'
import { byMonthDesc, changeOf, monthOf, phaseOf, salaryOn, totalOf } from '../../lib/salary'
import type { MySalary } from '../../lib/types'

const PHASE = {
  active: { label: 'Current', color: 'success' },
  upcoming: { label: 'Upcoming', color: 'info' },
  past: { label: 'Past', color: 'default' },
} as const

// Profile → Salary: the employee's own approved salaries (my_salaries), the
// one in force now first, then the history. Each stays until the next starts.
export default function Salary() {
  const [rows, setRows] = useState<MySalary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('my_salaries').then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message)
      else setRows(byMonthDesc((data ?? []) as MySalary[]))
    })
  }, [])

  if (error) return <Alert severity="error">{error}</Alert>
  if (!rows)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  if (!rows.length)
    return (
      <Paper variant="outlined" sx={{ py: 8, textAlign: 'center' }}>
        <Typography sx={{ color: 'text.secondary' }}>No salary recorded yet. HR adds it through an appraisal.</Typography>
      </Paper>
    )

  const current = salaryOn(rows)
  return (
    <>
      {current && (
        <Paper variant="outlined" component="section" aria-label="Current salary" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Current salary, since {monthOf(current.effective_from)}
          </Typography>
          <Typography variant="h4" sx={{ my: 0.5 }}>
            PKR {formatAmount(totalOf(current))}
            <Typography component="span" variant="body2" sx={{ color: 'text.secondary', ml: 1 }}>
              a month
            </Typography>
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {formatAmount(Number(current.basic_salary))} basic + {formatAmount(Number(current.contractual_amount))}{' '}
            contractual
          </Typography>
        </Paper>
      )}
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <TableContainer>
          <Table aria-label="Salary history">
            <TableHead>
              <TableRow>
                <TableCell>From</TableCell>
                <TableCell align="right">Basic</TableCell>
                <TableCell align="right">Contractual</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Change</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => {
                const phase = PHASE[phaseOf(r, rows)]
                return (
                  <TableRow key={r.id} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>{monthOf(r.effective_from)}</TableCell>
                    <TableCell align="right">{formatAmount(Number(r.basic_salary))}</TableCell>
                    <TableCell align="right">{formatAmount(Number(r.contractual_amount))}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 500 }}>
                      {formatAmount(totalOf(r))}
                    </TableCell>
                    <TableCell align="right">{changeOf(rows[i + 1] ?? null, r) ?? '—'}</TableCell>
                    <TableCell align="right">
                      <Chip size="small" label={phase.label} color={phase.color} variant="outlined" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </>
  )
}
