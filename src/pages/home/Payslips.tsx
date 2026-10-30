import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import { supabase } from '../../lib/supabase'
import { formatDay, formatEmployeeNumber } from '../../lib/constants'
import {
  MONTHS,
  downloadFile,
  formatAmount,
  payslipBreakdown,
  payslipFileName,
  periodLabel,
  type PayslipLine,
} from '../../lib/payroll'
import { payslipPdf, type PayslipPerson } from '../../lib/payslip'
import type { Payslip } from '../../lib/types'

function Lines({ title, lines, total }: { title: string; lines: PayslipLine[]; total: PayslipLine }) {
  return (
    <Table size="small" aria-label={title} sx={{ mb: 2 }}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontWeight: 600 }}>{title}</TableCell>
          <TableCell align="right" sx={{ fontWeight: 600 }}>
            PKR
          </TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {lines.map(([label, amount]) => (
          <TableRow key={label}>
            <TableCell>{label}</TableCell>
            <TableCell align="right">{formatAmount(amount)}</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell sx={{ fontWeight: 600 }}>{total[0]}</TableCell>
          <TableCell align="right" sx={{ fontWeight: 600 }}>
            {formatAmount(total[1])}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

// Profile → Payslips: the signed-in person's own line of every disbursed
// payroll (my_payslips; the payroll tables themselves are HR and finance
// only). A row opens the breakdown; either downloads the PDF.
export default function Payslips({ person }: { person: PayslipPerson }) {
  const [slips, setSlips] = useState<Payslip[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Payslip | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('my_payslips').then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message)
      setSlips((data ?? []) as Payslip[])
    })
  }, [])

  async function download(slip: Payslip) {
    setDownloading(slip.payroll_id)
    setError(null)
    try {
      downloadFile(payslipFileName(slip), await payslipPdf(slip, person))
    } catch {
      setError('The payslip PDF could not be made. Try again.')
    }
    setDownloading(null)
  }

  if (!slips) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    )
  }

  const breakdown = open && payslipBreakdown(open)

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Month</TableCell>
                <TableCell>Year</TableCell>
                <TableCell align="right">Net payable (PKR)</TableCell>
                <TableCell sx={{ width: 64 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {slips.map((s) => (
                <TableRow
                  key={s.payroll_id}
                  hover
                  onClick={() => setOpen(s)}
                  sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                >
                  <TableCell sx={{ fontWeight: 500 }}>{MONTHS[s.month - 1]}</TableCell>
                  <TableCell>{s.year}</TableCell>
                  <TableCell align="right">{formatAmount(s.net_salary)}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      aria-label={`Download ${periodLabel(s)} payslip`}
                      disabled={downloading === s.payroll_id}
                      onClick={(e) => {
                        e.stopPropagation()
                        download(s)
                      }}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!slips.length && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
                    No payslips yet. Each month’s shows here once its payroll is disbursed.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={!!open} onClose={() => setOpen(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Payslip · {open && periodLabel(open)}</DialogTitle>
        {open && breakdown && (
          <DialogContent>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {open.full_name} · {formatEmployeeNumber(open.employee_number)}
              {open.disbursed_at && ` · Disbursed ${formatDay(open.disbursed_at)}`}
            </Typography>
            <Lines title="Earnings" lines={breakdown.earnings} total={['Gross salary', breakdown.gross]} />
            <Lines
              title="Deductions"
              lines={breakdown.deductions}
              total={['Total deductions', breakdown.totalDeductions]}
            />
            <Paper
              variant="outlined"
              sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', bgcolor: 'action.hover' }}
            >
              <Typography sx={{ fontWeight: 600 }}>Net payable salary</Typography>
              <Typography sx={{ fontWeight: 600 }}>PKR {formatAmount(breakdown.net)}</Typography>
            </Paper>
          </DialogContent>
        )}
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(null)}>Close</Button>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            loading={!!open && downloading === open.payroll_id}
            onClick={() => open && download(open)}
          >
            Download PDF
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
