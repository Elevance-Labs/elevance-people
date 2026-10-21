import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import { Logo, PageHeader } from '../../components/common'
import { BRANDING_BUCKET, supabase } from '../../lib/supabase'
import { COMPANY_NAME, LOGO_ACCEPT, LOGO_MAX_BYTES } from '../../lib/constants'
import { logoUrl } from '../../lib/hiring'
import { brandedTheme, DEFAULT_PRIMARY } from '../../theme'
import type { Branding as BrandingRow, Perk } from '../../lib/types'

const HEX = /^#[0-9a-f]{6}$/

type PerkDraft = { title: string; description: string }

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>
        {description}
      </Typography>
      {children}
    </Paper>
  )
}

// Company → Branding (company admins). For now it styles the public job page.
// Everything is saved together: a picked logo is only uploaded on Save, and
// the file it replaces is removed afterwards.
export default function Branding() {
  const [saved, setSaved] = useState<BrandingRow | null>(null)
  const [color, setColor] = useState(DEFAULT_PRIMARY)
  const [perks, setPerks] = useState<PerkDraft[]>([])
  // undefined = keep the saved logo, null = remove it, File = replace it.
  const [logo, setLogo] = useState<File | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  function show(row: BrandingRow) {
    setSaved(row)
    setColor(row.primary_color)
    setPerks(row.perks.map((p) => ({ title: p.title, description: p.description ?? '' })))
    setLogo(undefined)
  }

  useEffect(() => {
    supabase
      .from('branding')
      .select('logo_path, primary_color, perks')
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        else if (data) show(data as BrandingRow)
        setLoading(false)
      })
  }, [])

  // Object URL for a picked file, revoked when it changes.
  const pickedUrl = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo])
  useEffect(() => () => {
    if (pickedUrl) URL.revokeObjectURL(pickedUrl)
  }, [pickedUrl])
  const preview = logo === undefined ? logoUrl(saved?.logo_path ?? null) : pickedUrl

  const validColor = HEX.test(color)
  const previewTheme = useMemo(() => brandedTheme(validColor ? color : DEFAULT_PRIMARY), [color, validColor])

  function pick(picked: File | undefined) {
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
    if (!picked) return
    if (!LOGO_ACCEPT.split(',').includes(picked.type)) return setError('The logo must be a PNG, JPEG or WebP image.')
    if (picked.size > LOGO_MAX_BYTES) return setError('The logo must be 2 MB or smaller.')
    setLogo(picked)
  }

  const updatePerk = (i: number, change: Partial<PerkDraft>) =>
    setPerks((list) => list.map((p, j) => (j === i ? { ...p, ...change } : p)))
  const movePerk = (i: number, by: number) =>
    setPerks((list) => {
      const next = [...list]
      ;[next[i], next[i + by]] = [next[i + by], next[i]]
      return next
    })

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!validColor) return setError('Enter the colour as a hex code, like #3f51b5.')
    setBusy(true)
    setError(null)

    const previous = saved?.logo_path ?? null
    let logoPath = previous
    if (logo) {
      const ext = logo.type.split('/')[1].replace('jpeg', 'jpg')
      logoPath = `logo-${crypto.randomUUID()}.${ext}`
      const uploaded = await supabase.storage.from(BRANDING_BUCKET).upload(logoPath, logo, { contentType: logo.type })
      if (uploaded.error) {
        setBusy(false)
        return setError(`The logo couldn’t be uploaded: ${uploaded.error.message}`)
      }
    } else if (logo === null) {
      logoPath = null
    }

    const payload = {
      logo_path: logoPath,
      primary_color: color,
      // Blank rows are dropped rather than refused.
      perks: perks
        .filter((p) => p.title.trim())
        .map<Perk>((p) => ({ title: p.title.trim(), description: p.description.trim() || null })),
    }
    const { data, error: saveError } = await supabase
      .from('branding')
      .update(payload)
      .eq('id', true)
      .select('logo_path, primary_color, perks')
      .single()
    if (saveError) {
      if (logo) await supabase.storage.from(BRANDING_BUCKET).remove([logoPath!])
      setBusy(false)
      return setError(
        saveError.code === '42501' || saveError.code === 'PGRST116'
          ? 'Only a company admin can change branding.'
          : saveError.message,
      )
    }

    // The old file is no longer referenced. Failing to remove it only leaves a stray file.
    if (previous && previous !== logoPath) await supabase.storage.from(BRANDING_BUCKET).remove([previous])
    setBusy(false)
    show(data as BrandingRow)
    setNotice('Branding saved')
  }

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box component="form" onSubmit={save} sx={{ maxWidth: 900 }}>
      <PageHeader title="Branding" subtitle="Your logo, colour, and perks and benefits, shown on public job pages." />

      <Stack spacing={3}>
        <Section title="Logo" description="PNG, JPEG or WebP, up to 2 MB. A wide logo on a transparent background works best.">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ alignItems: { sm: 'center' } }}>
            <Box
              sx={{
                width: 220,
                height: 88,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'background.default',
                p: 1.5,
              }}
            >
              {preview ? (
                <Box component="img" src={preview} alt="Logo" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Logo />
                  <Typography variant="subtitle2">{COMPANY_NAME}</Typography>
                </Stack>
              )}
            </Box>
            <Stack direction="row" spacing={1}>
              <Button component="label" variant="outlined" startIcon={<ImageOutlinedIcon />}>
                {preview ? 'Replace logo' : 'Upload logo'}
                <input ref={fileInput} hidden type="file" accept={LOGO_ACCEPT} onChange={(e) => pick(e.target.files?.[0])} />
              </Button>
              {preview && (
                <Button color="inherit" onClick={() => setLogo(null)}>
                  Remove
                </Button>
              )}
            </Stack>
          </Stack>
          {!preview && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>
              With no logo, public pages show the default mark and the company name.
            </Typography>
          )}
        </Section>

        <Section title="Primary colour" description="Used for the header band, buttons and links on public job pages.">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ alignItems: { sm: 'center' } }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Box
                component="input"
                type="color"
                aria-label="Pick colour"
                value={validColor ? color : DEFAULT_PRIMARY}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setColor(e.target.value.toLowerCase())}
                sx={{ width: 48, height: 40, p: 0, border: 1, borderColor: 'divider', borderRadius: 1, cursor: 'pointer', bgcolor: 'transparent' }}
              />
              <TextField
                label="Hex"
                value={color}
                onChange={(e) => setColor(e.target.value.trim().toLowerCase())}
                error={!validColor}
                helperText={validColor ? undefined : 'Like #3f51b5'}
                sx={{ width: 140 }}
              />
            </Stack>
            <ThemeProvider theme={previewTheme}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button variant="contained" tabIndex={-1} disableRipple>
                  Submit application
                </Button>
                <Button tabIndex={-1} disableRipple>
                  A link
                </Button>
              </Stack>
            </ThemeProvider>
          </Stack>
        </Section>

        <Section title="Perks and benefits" description="Listed under the job description, in this order.">
          <Stack spacing={1.5}>
            {perks.map((perk, i) => (
              <Stack
                key={i}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { sm: 'flex-start' }, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
              >
                <TextField
                  label="Perk"
                  value={perk.title}
                  onChange={(e) => updatePerk(i, { title: e.target.value })}
                  placeholder="e.g. Health insurance"
                  slotProps={{ htmlInput: { maxLength: 120 } }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Details"
                  value={perk.description}
                  onChange={(e) => updatePerk(i, { description: e.target.value })}
                  placeholder="Optional"
                  multiline
                  slotProps={{ htmlInput: { maxLength: 1000 } }}
                  sx={{ flex: 2 }}
                />
                <Stack direction="row" sx={{ flexShrink: 0 }}>
                  <Tooltip title="Move up">
                    <span>
                      <IconButton aria-label={`Move ${perk.title || 'perk'} up`} disabled={i === 0} onClick={() => movePerk(i, -1)}>
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Move down">
                    <span>
                      <IconButton
                        aria-label={`Move ${perk.title || 'perk'} down`}
                        disabled={i === perks.length - 1}
                        onClick={() => movePerk(i, 1)}
                      >
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Remove">
                    <IconButton
                      aria-label={`Remove ${perk.title || 'perk'}`}
                      onClick={() => setPerks((list) => list.filter((_, j) => j !== i))}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
            ))}
            {!perks.length && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                No perks yet. Public job pages won’t show the section until you add one.
              </Typography>
            )}
            <Button
              startIcon={<AddIcon />}
              onClick={() => setPerks((list) => [...list, { title: '', description: '' }])}
              disabled={perks.length >= 30}
              sx={{ alignSelf: 'flex-start' }}
            >
              Add perk
            </Button>
          </Stack>
        </Section>

        {error && <Alert severity="error">{error}</Alert>}

        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button type="submit" variant="contained" loading={busy}>
            Save branding
          </Button>
        </Stack>
      </Stack>

      <Snackbar
        open={!!notice}
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        message={notice}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  )
}
