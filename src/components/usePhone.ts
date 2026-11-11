import { useMediaQuery, type Theme } from '@mui/material'

/**
 * Whether the screen is phone-sized. Asked as "is it narrow?", so that where
 * the answer is unknown (no media queries) the full layout is what shows.
 */
export const usePhone = () => useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'))
