import { useState, type FormEvent } from 'react'
import { Alert, Box, Button, Card, CardContent, Divider, Stack, TextField, Typography } from '@mui/material'
import GoogleIcon from '@mui/icons-material/Google'
import { useAuth } from '../auth/AuthProvider'
import { Logo } from '../components/common'
import { COMPANY_DOMAIN } from '../lib/constants'
import { supabase } from '../lib/supabase'

export default function Login() {
  const { signIn, signInWithPassword, error } = useAuth()
  // Password logins are for the few people without a company Google account,
  // so the form stays folded away behind a link.
  const [withPassword, setWithPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ severity: 'info' | 'error'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    setBusy(true)
    await signInWithPassword(email, password)
    setBusy(false)
  }

  async function sendReset() {
    if (!email.trim()) return setNotice({ severity: 'error', text: 'Enter your email first.' })
    setBusy(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: window.location.origin + window.location.pathname,
    })
    setBusy(false)
    setNotice(
      resetError
        ? { severity: 'error', text: resetError.message }
        : {
            severity: 'info',
            // PKCE: the link only works in the browser that asked for it.
            text: 'If that address has a password login, a reset link is on its way. Open it in this browser.',
          },
    )
  }

  return (
    <Box
      sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', px: 2, bgcolor: 'background.default' }}
    >
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: { xs: 3, sm: 5 } }}>
          <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Logo size={56} />
            <Box>
              <Typography variant="h5" component="h1">
                Elevance People
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                Sign in with your @{COMPANY_DOMAIN} Google account
              </Typography>
            </Box>
            {error && (
              <Alert severity="error" sx={{ textAlign: 'left', width: '100%' }}>
                {error}
              </Alert>
            )}
            <Button
              variant="contained"
              size="large"
              fullWidth
              startIcon={<GoogleIcon />}
              onClick={signIn}
            >
              Sign in with Google
            </Button>
            <Divider flexItem>or</Divider>
            {withPassword ? (
              <Stack component="form" spacing={2} onSubmit={submit} sx={{ width: '100%' }}>
                {notice && (
                  <Alert severity={notice.severity} sx={{ textAlign: 'left' }}>
                    {notice.text}
                  </Alert>
                )}
                <TextField
                  label="Email"
                  type="email"
                  autoComplete="email"
                  required
                  fullWidth
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <TextField
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  required
                  fullWidth
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button type="submit" variant="outlined" size="large" fullWidth disabled={busy}>
                  Sign in
                </Button>
                <Button size="small" onClick={sendReset} disabled={busy}>
                  Forgot password?
                </Button>
              </Stack>
            ) : (
              <Button onClick={() => setWithPassword(true)}>Sign in with email and password</Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
