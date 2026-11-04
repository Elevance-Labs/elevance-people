import { COMPANY_NAME, formatDay, formatEmployeeNumber } from './constants'
import { detailLines } from './branding'
import { logoUrl } from './hiring'
import { formatAmount, payslipBreakdown, periodLabel, type PayslipLine } from './payroll'
import type { Branding, CompanyDetails, Payslip } from './types'

// Who the payslip is for, beyond what the payslip row carries. Designation
// and department are the person's current ones.
export interface PayslipPerson {
  designation: string | null
  department: string | null
}

// The branding row as the payslip uses it.
export type PayslipCompany = Pick<Branding, 'logo_path' | 'primary_color'> & CompanyDetails

interface LogoImage {
  data: string
  width: number
  height: number
}

// The logo as a PNG data URL (PNG, JPEG or WebP in, via a canvas, so jsPDF
// needs no WebP support). Null if it can't be fetched or drawn; the payslip
// then shows the name instead.
async function loadLogo(path: string | null): Promise<LogoImage | null> {
  const url = logoUrl(path)
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bitmap = await createImageBitmap(await res.blob())
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx || !bitmap.width || !bitmap.height) return null
    ctx.drawImage(bitmap, 0, 0)
    return { data: canvas.toDataURL('image/png'), width: bitmap.width, height: bitmap.height }
  } catch {
    return null
  }
}

const rgb = (hex: string): [number, number, number] => {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x3f51b5
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const DEDUCTIONS_RED: [number, number, number] = [198, 40, 40]
const INK: [number, number, number] = [33, 37, 41]
const MUTED: [number, number, number] = [110, 117, 125]

// An A4 salary slip: logo and company registration up top, the employee and
// period, earnings (A), deductions (B), net payable (A - B), and the
// company's address, internal emails and numbers in the footer. jsPDF loads
// only when a payslip is downloaded. The built-in Helvetica covers Latin
// text only.
export async function payslipPdf(slip: Payslip, person: PayslipPerson, company: PayslipCompany): Promise<Blob> {
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), loadLogo(company.logo_path)])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 20
  const right = 190
  const width = right - left
  const primary = rgb(company.primary_color)
  const breakdown = payslipBreakdown(slip)
  const period = periodLabel(slip)
  const shortName = company.business_name_short ?? COMPANY_NAME
  const ink = () => doc.setTextColor(...INK)
  const muted = () => doc.setTextColor(...MUTED)

  // Header: the logo (or the name) left, the registered name and numbers right.
  const top = 16
  let logoBottom = top
  if (logo) {
    const scale = Math.min(70 / logo.width, 18 / logo.height)
    const w = logo.width * scale
    const h = logo.height * scale
    doc.addImage(logo.data, 'PNG', left, top, w, h)
    logoBottom = top + h
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    ink()
    doc.text(shortName, left, top + 7)
    logoBottom = top + 9
  }
  const registration = [
    company.business_name_long ?? shortName,
    ...(company.inc_number ? [`INC# ${company.inc_number}`] : []),
    ...(company.ntn_number ? [`NTN# ${company.ntn_number}`] : []),
  ]
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  ink()
  registration.forEach((line, i) => doc.text(line, right, top + 3 + i * 4.5, { align: 'right', maxWidth: 95 }))
  let y = Math.max(logoBottom, top + 3 + (registration.length - 1) * 4.5) + 14

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(55, 65, 81)
  doc.text('SALARY SLIP', 105, y, { align: 'center' })
  y += 8

  // Employee details: label and value pairs, two to a row, on a light panel.
  const details: [string, string][] = [
    ['Employee name', slip.full_name],
    ['Pay period', period],
    ['Employee ID', formatEmployeeNumber(slip.employee_number)],
    ['Designation', person.designation ?? '-'],
    ['Department', person.department ?? '-'],
    ['Disbursed on', slip.disbursed_at ? formatDay(slip.disbursed_at) : '-'],
  ]
  doc.setFontSize(9.5)
  const rows: { cells: { label: string; lines: string[] }[]; height: number }[] = []
  for (let i = 0; i < details.length; i += 2) {
    const cells = details.slice(i, i + 2).map(([label, value]) => ({ label, lines: doc.splitTextToSize(value, 44) }))
    rows.push({ cells, height: Math.max(...cells.map((c) => c.lines.length)) * 4.5 + 3.5 })
  }
  const panelHeight = rows.reduce((sum, r) => sum + r.height, 0) + 6
  doc.setFillColor(244, 247, 250)
  doc.setDrawColor(225, 230, 236)
  doc.roundedRect(left, y, width, panelHeight, 1.5, 1.5, 'FD')
  let rowY = y + 7.5
  for (const row of rows) {
    row.cells.forEach((cell, i) => {
      const x = left + 5 + i * 85
      doc.setFont('helvetica', 'bold')
      muted()
      doc.text(cell.label, x, rowY)
      doc.setFont('helvetica', 'normal')
      ink()
      doc.text(cell.lines, x + 30, rowY)
    })
    rowY += row.height
  }
  y += panelHeight + 9

  function table(title: string, colour: [number, number, number], lines: PayslipLine[], total: PayslipLine) {
    doc.setFillColor(...colour)
    doc.rect(left, y, width, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(255)
    doc.text(title, left + 4, y + 5.4)
    doc.text('AMOUNT (PKR)', right - 4, y + 5.4, { align: 'right' })
    y += 8
    doc.setFont('helvetica', 'normal')
    ink()
    doc.setDrawColor(228, 231, 235)
    for (const [label, amount] of lines) {
      doc.text(label, left + 4, y + 5)
      doc.text(formatAmount(amount), right - 4, y + 5, { align: 'right' })
      y += 7.5
      doc.line(left, y, right, y)
    }
    doc.setFillColor(244, 247, 250)
    doc.rect(left, y, width, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.text(total[0], left + 4, y + 5.4)
    doc.text(formatAmount(total[1]), right - 4, y + 5.4, { align: 'right' })
    y += 16
  }

  table('EARNINGS DESCRIPTION', primary, breakdown.earnings, ['Gross earnings (A)', breakdown.gross])
  table('DEDUCTIONS DESCRIPTION', DEDUCTIONS_RED, breakdown.deductions, ['Total deductions (B)', breakdown.totalDeductions])

  y -= 4
  doc.setFillColor(235, 243, 252)
  doc.rect(left, y, width, 14, 'F')
  doc.setDrawColor(...primary)
  doc.setLineWidth(0.8)
  doc.line(left, y + 14, right, y + 14)
  doc.setLineWidth(0.2)
  doc.setFontSize(12.5)
  doc.setTextColor(30, 58, 95)
  doc.text('NET PAYABLE (A - B)', left + 4, y + 9)
  doc.text(`PKR ${formatAmount(breakdown.net)}`, right - 4, y + 9, { align: 'right' })
  y += 22

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  muted()
  doc.text('This is a computer-generated payslip and needs no signature.', left, y)

  // Footer: internal numbers and emails left, the address beside them.
  const contacts = [...detailLines(company.internal_numbers), ...detailLines(company.internal_emails)]
  const address = detailLines(company.address).flatMap((l) => doc.splitTextToSize(l, 100) as string[])
  if (contacts.length || address.length) {
    const lineCount = Math.max(contacts.length, address.length)
    const footerTop = 285 - lineCount * 4
    doc.setDrawColor(225, 230, 236)
    doc.line(left, footerTop - 5, right, footerTop - 5)
    doc.setFontSize(8.5)
    ink()
    if (contacts.length) doc.text(contacts, left, footerTop, { lineHeightFactor: 1.35 })
    if (address.length) doc.text(address, contacts.length ? 85 : left, footerTop, { lineHeightFactor: 1.35 })
  }

  return doc.output('blob')
}
