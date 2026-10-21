import { ListSubheader, MenuItem } from '@mui/material'
import type { Department, Designation } from './types'

// PostgREST returns an embedded count as [{ count: n }].
export type Count = { count: number }[]
export const countOf = (rel: Count | null | undefined) => rel?.[0]?.count ?? 0

export type DesignationWithDepartment = Designation & { department: Pick<Department, 'name'> | null }

// Embeds name the FK explicitly: employees also references departments, so keep the join unambiguous.
export const DESIGNATION_WITH_DEPARTMENT =
  'id, department_id, title, description, department:departments!designations_department_id_fkey(name)'

export function byDepartmentThenTitle(a: DesignationWithDepartment, b: DesignationWithDepartment) {
  return (
    (a.department?.name ?? '').localeCompare(b.department?.name ?? '') || a.title.localeCompare(b.title)
  )
}

export function configError(error: { code?: string; message: string }, duplicate: string, inUse: string) {
  if (error.code === '23505') return duplicate
  if (error.code === '23503') return inUse
  if (error.code === '42501') return 'Only a company admin can change company settings.'
  return error.message
}

export const trimOrNull = (value: string) => value.trim() || null

// A designation picker's options, under department subheaders (KPIs and
// expectations). MUI Select needs subheaders and items as direct children,
// so this is a flat list.
export function designationOptions(designations: DesignationWithDepartment[]) {
  const out = []
  let department: string | undefined
  for (const d of designations) {
    const name = d.department?.name ?? ''
    if (name !== department) {
      department = name
      out.push(<ListSubheader key={`h-${d.department_id}`}>{name}</ListSubheader>)
    }
    out.push(
      <MenuItem key={d.id} value={d.id} sx={{ pl: 4 }}>
        {d.title}
      </MenuItem>,
    )
  }
  return out
}
