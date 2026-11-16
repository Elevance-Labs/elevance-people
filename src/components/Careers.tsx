import { useMemo, type ReactNode } from 'react'
import { Box, Container, CssBaseline, Grid, Paper, ThemeProvider, Typography } from '@mui/material'
import { Logo } from './common'
import { COMPANY_NAME } from '../lib/constants'
import { logoUrl } from '../lib/hiring'
import { brandedTheme, DEFAULT_PRIMARY } from '../theme'
import type { Branding } from '../lib/types'

// The public careers pages (the job list and one job): the always-light
// branded theme, the top bar unless `?branding=off`, and the perks. Their
// hooks are in useCareers.ts.
export function CareersFrame({
  branding,
  branded,
  children,
}: {
  branding: Branding | null
  branded: boolean
  children: ReactNode
}) {
  const color = branding?.primary_color ?? DEFAULT_PRIMARY
  const theme = useMemo(() => brandedTheme(color), [color])
  return (
    <ThemeProvider theme={theme}>
      {/* Always light: the company's branded page sets its own scheme. */}
      <CssBaseline enableColorScheme />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        {branded && (
          <Box component="header" sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
            <Container maxWidth="lg" sx={{ py: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {branding?.logo_path ? (
                <Box
                  component="img"
                  src={logoUrl(branding.logo_path) ?? undefined}
                  alt={COMPANY_NAME}
                  sx={{ height: 36, maxWidth: 200, objectFit: 'contain' }}
                />
              ) : (
                <>
                  <Logo />
                  <Typography variant="h6" component="div">
                    {COMPANY_NAME}
                  </Typography>
                </>
              )}
            </Container>
          </Box>
        )}
        {children}
      </Box>
    </ThemeProvider>
  )
}

// `wide`: three across on a full-width page, two beside the apply form.
export function Perks({ perks, wide = false }: { perks: Branding['perks']; wide?: boolean }) {
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
        Perks and benefits
      </Typography>
      <Grid container spacing={2}>
        {perks.map((perk, i) => (
          <Grid key={i} size={{ xs: 12, sm: 6, md: wide ? 4 : 6 }}>
            <Paper variant="outlined" sx={{ p: 2.5, height: '100%', borderLeft: 3, borderLeftColor: 'primary.main' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {perk.title}
              </Typography>
              {perk.description && (
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                  {perk.description}
                </Typography>
              )}
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  )
}
