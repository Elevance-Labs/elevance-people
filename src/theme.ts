import { createTheme, lighten, type PaletteOptions, type Theme, type ThemeOptions } from '@mui/material/styles'

declare module '@mui/material/styles' {
  interface TypeBackground {
    /** A quiet, opaque tint for headers and bands set off from paper. */
    subtle: string
    /** A stronger opaque tint: empty tracks, image wells. */
    muted: string
  }
}

export const DEFAULT_PRIMARY = '#3f51b5'

/**
 * Where the theme choice (light / dark / system) is kept. One key for every
 * Elevance app: they share an origin, so a choice made in one holds in the
 * next, as the collapsed navigation does.
 */
export const THEME_MODE_KEY = 'elevance.theme'

/** The ThemeProvider's settings beside `theme` (main.tsx and the tests). */
export const themeSettings = {
  defaultMode: 'system',
  modeStorageKey: THEME_MODE_KEY,
  colorSchemeStorageKey: 'elevance.theme-scheme',
  // Read the saved choice on the first render: no flash of the other mode.
  noSsr: true,
  disableTransitionOnChange: true,
} as const

const light: PaletteOptions = {
  primary: { main: DEFAULT_PRIMARY },
  background: { default: '#f6f7fb', paper: '#ffffff', subtle: '#fafafa', muted: '#f5f5f5' },
}

const dark: PaletteOptions = {
  // Indigo lifted so it reads on a dark surface (and keeps white text).
  primary: { main: '#7986cb' },
  background: { default: '#121318', paper: '#1b1d23', subtle: '#22242b', muted: '#282a32' },
}

const base: ThemeOptions = {
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme }) => ({
          fontWeight: 600,
          color: theme.palette.text.secondary,
          backgroundColor: theme.palette.background.subtle,
        }),
      },
    },
  },
}

// Light and dark, switched without CSS variables: `theme.palette` is the one
// in use, so code that reads it (`alpha`, gradients) follows the mode.
export const theme = createTheme({ ...base, colorSchemes: { light: { palette: light }, dark: { palette: dark } } })

/**
 * A deep accent used as text ("ink") on the handbook pages: as given in the
 * light theme, lifted so it stays readable in the dark one. For `sx`.
 */
export const readableInk = (color: string) => (t: Theme) => (t.palette.mode === 'dark' ? lighten(color, 0.45) : color)

// The public job page wears the company's branded primary colour, always light.
export const brandedTheme = (primary: string) =>
  createTheme({ ...base, palette: { ...light, primary: { main: primary } } })
