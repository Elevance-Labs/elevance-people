import { useEffect, useState } from 'react'
import { Button, Snackbar } from '@mui/material'
import { registerServiceWorker } from '../pwa'

// The public job page: applicants are visitors, not people installing the app.
const onPublicPage = () => window.location.hash.startsWith('#/careers')

/**
 * "A new version is available." Shown once a newer build has been downloaded;
 * Reload switches to it. Until then the page keeps running the build it
 * started with, so nothing changes under someone mid-form.
 */
export default function UpdatePrompt() {
  const [apply, setApply] = useState<(() => void) | null>(null)

  useEffect(() => {
    registerServiceWorker((fn) => setApply(() => fn), onPublicPage)
  }, [])

  return (
    <Snackbar
      open={apply !== null}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      message="A new version is available."
      action={
        <Button color="inherit" size="small" onClick={() => apply?.()}>
          Reload
        </Button>
      }
    />
  )
}
