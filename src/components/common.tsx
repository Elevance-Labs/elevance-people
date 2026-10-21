import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
  type ChipProps,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import GroupsIcon from '@mui/icons-material/Groups'
import { JOB_STATUS_COLORS, JOB_STATUS_LABELS, STATUS_COLORS, STATUS_LABELS } from '../lib/constants'
import type { EmployeeStatus, JobOpeningStatus } from '../lib/types'

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <Avatar variant="rounded" sx={{ width: size, height: size, bgcolor: 'primary.main' }}>
      <GroupsIcon sx={{ fontSize: size * 0.62 }} />
    </Avatar>
  )
}

function colorFor(name: string) {
  let hue = 0
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${hue} 40% 48%)`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function PersonAvatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <Avatar sx={{ width: size, height: size, fontSize: size * 0.4, bgcolor: colorFor(name) }}>
      {initials(name)}
    </Avatar>
  )
}

export function StatusChip({ status, size = 'small' }: { status: EmployeeStatus; size?: ChipProps['size'] }) {
  return (
    <Chip
      label={STATUS_LABELS[status]}
      color={STATUS_COLORS[status]}
      size={size}
      variant={status === 'active' ? 'filled' : 'outlined'}
    />
  )
}

export function JobStatusChip({ status, size = 'small' }: { status: JobOpeningStatus; size?: ChipProps['size'] }) {
  return (
    <Chip
      label={JOB_STATUS_LABELS[status]}
      color={JOB_STATUS_COLORS[status]}
      size={size}
      variant={status === 'open' ? 'filled' : 'outlined'}
    />
  )
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  back?: string
  actions?: ReactNode
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ mb: 3, alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
      {back && (
        <IconButton component={Link} to={back} aria-label="Back" edge="start">
          <ArrowBackIcon />
        </IconButton>
      )}
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="h5" component="h1" noWrap>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions}
    </Stack>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          loading={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function FormDialog({
  open,
  title,
  submitLabel = 'Save',
  error,
  busy,
  closeButton,
  onSubmit,
  onClose,
  children,
}: {
  open: boolean
  title: string
  submitLabel?: string
  error?: string | null
  busy?: boolean
  // Closes only by an × in the corner: no Cancel, and clicking outside or
  // pressing Escape leaves it open, so a long form isn't lost by accident.
  closeButton?: boolean
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Dialog
      open={open}
      onClose={busy || closeButton ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: 'form',
          onSubmit: (e: FormEvent) => {
            e.preventDefault()
            onSubmit()
          },
        },
      }}
    >
      <DialogTitle sx={closeButton ? { pr: 7 } : undefined}>{title}</DialogTitle>
      {closeButton && (
        <IconButton aria-label="Close" onClick={onClose} disabled={busy} sx={{ position: 'absolute', top: 12, right: 12 }}>
          <CloseIcon />
        </IconButton>
      )}
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {children}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {!closeButton && (
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="contained" loading={busy}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
