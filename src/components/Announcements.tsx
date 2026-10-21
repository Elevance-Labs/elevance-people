import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Box, Chip, CircularProgress, Drawer, IconButton, Paper, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined'
import CloseIcon from '@mui/icons-material/Close'
import PushPinIcon from '@mui/icons-material/PushPin'
import { supabase } from '../lib/supabase'
import { formatDay } from '../lib/constants'
import { isoDate, todayIso } from '../lib/leaves'
import type { Announcement } from '../lib/types'
import { RichTextView } from './RichTextView'

// The megaphone that sits before an "Announcements" heading.
export function AnnouncementsIcon({ size = 40 }: { size?: number }) {
  return (
    <Box
      aria-hidden
      sx={(t) => ({
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        color: 'primary.contrastText',
        background: `linear-gradient(135deg, ${t.palette.primary.light}, ${t.palette.primary.dark})`,
        boxShadow: `0 4px 12px ${alpha(t.palette.primary.main, 0.35)}`,
        '& svg': { fontSize: size * 0.55 },
      })}
    >
      <CampaignOutlinedIcon />
    </Box>
  )
}

// One announcement: a tinted card, so it reads as something to stop for.
// `footer` holds whatever goes under the body (the drawer's date).
export function AnnouncementCard({ html, footer }: { html: string; footer?: ReactNode }) {
  return (
    <Paper
      component="article"
      variant="outlined"
      sx={(t) => ({
        p: { xs: 2, sm: 2.5 },
        borderRadius: 3,
        borderColor: alpha(t.palette.primary.main, 0.25),
        background: `linear-gradient(135deg, ${alpha(t.palette.primary.main, 0.09)} 0%, ${alpha(t.palette.primary.main, 0.02)} 55%, ${t.palette.background.paper} 100%)`,
        boxShadow: `0 2px 10px ${alpha(t.palette.primary.main, 0.08)}`,
      })}
    >
      <RichTextView html={html} />
      {footer}
    </Paper>
  )
}

type Item = Pick<Announcement, 'id' | 'body' | 'pinned_until' | 'created_at'>

// The drawer goes back this far; older announcements stay with HR's page.
const MONTHS_SHOWN = 4

function shownSince() {
  const d = new Date()
  d.setMonth(d.getMonth() - MONTHS_SHOWN)
  return isoDate(d)
}

// The last few months' announcements, newest first, for anyone signed in.
// Loaded each time it opens, so it's never stale and costs nothing until
// someone asks.
export function AnnouncementsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setItems(null)
    setError(null)
    supabase
      .from('announcements')
      .select('id, body, pinned_until, created_at')
      .gte('created_at', shownSince())
      .order('created_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        else setItems(data as Item[])
      })
  }, [open])

  const today = todayIso()

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Above the app bar, which sits over the nav drawer's layer.
      sx={{ zIndex: (t) => t.zIndex.modal }}
      slotProps={{
        paper: { sx: { width: { xs: '100%', sm: 520 }, bgcolor: 'background.default' }, 'aria-label': 'All announcements' },
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', px: 3, py: 2.5, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}
      >
        <AnnouncementsIcon size={44} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5" component="h2">
            Announcements
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            From the last {MONTHS_SHOWN} months, newest first
          </Typography>
        </Box>
        <IconButton aria-label="Close announcements" edge="end" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Stack>

      <Stack spacing={2} sx={{ overflowY: 'auto', flexGrow: 1, p: { xs: 2, sm: 3 } }}>
        {error && <Alert severity="error">{error}</Alert>}
        {!items && !error && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}
        {items?.map((a) => (
          <AnnouncementCard
            key={a.id}
            html={a.body}
            footer={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.5 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', flexGrow: 1 }}>
                  {formatDay(a.created_at)}
                </Typography>
                {!!a.pinned_until && a.pinned_until >= today && (
                  <Chip size="small" color="primary" icon={<PushPinIcon />} label="Pinned" />
                )}
              </Stack>
            }
          />
        ))}
        {items && !items.length && (
          <Typography sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>No announcements in the last {MONTHS_SHOWN} months.</Typography>
        )}
      </Stack>
    </Drawer>
  )
}
