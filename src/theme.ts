import { createTheme, type ThemeOptions } from '@mui/material/styles'

export const DEFAULT_PRIMARY = '#3f51b5'

const options: ThemeOptions = {
  palette: {
    primary: { main: DEFAULT_PRIMARY },
    background: { default: '#f6f7fb' },
  },
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
          backgroundColor: theme.palette.grey[50],
        }),
      },
    },
  },
}

export const theme = createTheme(options)

// The public job page wears the company's branded primary colour.
export const brandedTheme = (primary: string) =>
  createTheme({ ...options, palette: { ...options.palette, primary: { main: primary } } })
