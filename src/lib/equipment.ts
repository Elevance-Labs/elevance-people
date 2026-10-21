import { EQUIPMENT_BUCKET, supabase } from './supabase'
import type { Equipment, Vendor } from './types'

// Names the FK: the app embeds the vendor through it.
export const EQUIPMENT_SELECT =
  'id, name, identifier, status, purchase_date, vendor_id, invoice_path, photo_path, assigned_to, assigned_on, ' +
  'created_by, created_at, updated_at, vendor:vendors!equipment_vendor_id_fkey(name)'

export type EquipmentRow = Equipment & { vendor: Pick<Vendor, 'name'> | null }

// What the vendor list shows, with how much equipment each has.
export const VENDOR_SELECT =
  'id, name, description, bank_name, iban, created_at, updated_at, equipment!equipment_vendor_id_fkey(count)'

// The database keeps IBANs upper case, without spaces.
export const normaliseIban = (value: string) => value.replace(/\s+/g, '').toUpperCase() || null
export const IBAN_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/

export function equipmentError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'Other equipment already has this identifier.'
  if (error.code === '42501') return 'Only HR, finance and company admins can change equipment.'
  return error.message
}

export function vendorError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'A vendor with this name already exists.'
  if (error.code === '23503') return 'Equipment is still linked to this vendor.'
  if (error.code === '23514' && error.message.includes('iban')) return 'Enter a valid IBAN, like PK36SCBL0000001123456702.'
  if (error.code === '42501') return 'Only HR, finance and company admins can change vendors.'
  return error.message
}

// Upload a picked invoice or photo under a fresh name; returns its path.
export async function uploadEquipmentFile(file: File) {
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1].replace('jpeg', 'jpg')
  const path = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(EQUIPMENT_BUCKET).upload(path, file, { contentType: file.type })
  return { path, error }
}

export const removeEquipmentFiles = (paths: (string | null | undefined)[]) => {
  const list = paths.filter((p): p is string => !!p)
  return list.length ? supabase.storage.from(EQUIPMENT_BUCKET).remove(list) : Promise.resolve({ error: null })
}
