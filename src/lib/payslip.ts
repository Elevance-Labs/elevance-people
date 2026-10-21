import { COMPANY_NAME, formatDay, formatEmployeeNumber } from './constants'
import { formatAmount, payslipBreakdown, periodLabel, type PayslipLine } from './payroll'
import type { Payslip } from './types'

// Who the payslip is for, beyond what the payslip row carries. Designation
// and department are the person's current ones.
export interface PayslipPerson {
  designation: string | null
  department: string | null
}

// A standard A4 payslip: company, period, employee, earnings, deductions,
// net pay. jsPDF loads only when a payslip is downloaded. The built-in
// Helvetica covers Latin text only.
export async function payslipPdf(slip: Payslip, person: PayslipPerson): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 20
  const right = 190
  const breakdown = payslipBreakdown(slip)
  const period = periodLabel(slip)
  let y = 26

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(COMPANY_NAME, left, y)
  doc.setFontSize(13)
  doc.text('Payslip', right, y, { align: 'right' })
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(period, right, y, { align: 'right' })
  y += 5
  doc.setDrawColor(180)
  doc.line(left, y, right, y)

  // Employee details, two columns.
  const details: [string, string][] = [
    ['Employee', slip.full_name],
    ['Employee number', formatEmployeeNumber(slip.employee_number)],
    ['Designation', person.designation ?? '-'],
    ['Department', person.department ?? '-'],
    ['Pay period', period],
    ['Processed on', slip.processed_at ? formatDay(slip.processed_at) : '-'],
  ]
  y += 9
  details.forEach(([label, value], i) => {
    const x = i % 2 ? 110 : left
    const rowY = y + Math.floor(i / 2) * 12
    doc.setFontSize(8.5)
    doc.setTextColor(110)
    doc.text(label.toUpperCase(), x, rowY)
    doc.setFontSize(11)
    doc.setTextColor(20)
    doc.text(value, x, rowY + 5)
  })
  y += Math.ceil(details.length / 2) * 12 + 4

  function table(title: string, lines: PayslipLine[], total: PayslipLine) {
    doc.setFillColor(238, 240, 244)
    doc.rect(left, y, right - left, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(20)
    doc.text(title, left + 3, y + 5.5)
    doc.text('Amount (PKR)', right - 3, y + 5.5, { align: 'right' })
    y += 8
    doc.setFont('helvetica', 'normal')
    for (const [label, amount] of lines) {
      y += 7
      doc.text(label, left + 3, y)
      doc.text(formatAmount(amount), right - 3, y, { align: 'right' })
      doc.setDrawColor(225)
      doc.line(left, y + 2.5, right, y + 2.5)
    }
    y += 8
    doc.setFont('helvetica', 'bold')
    doc.text(total[0], left + 3, y)
    doc.text(formatAmount(total[1]), right - 3, y, { align: 'right' })
    y += 10
  }

  table('Earnings', breakdown.earnings, ['Gross salary', breakdown.gross])
  table('Deductions', breakdown.deductions, ['Total deductions', breakdown.totalDeductions])

  doc.setFillColor(20, 20, 20)
  doc.rect(left, y, right - left, 13, 'F')
  doc.setTextColor(255)
  doc.setFontSize(12)
  doc.text('Net payable salary', left + 3, y + 8.5)
  doc.text(`PKR ${formatAmount(breakdown.net)}`, right - 3, y + 8.5, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(120)
  doc.text('This is a computer-generated payslip and needs no signature.', left, 280)

  return doc.output('blob')
}
