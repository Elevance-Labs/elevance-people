import { Button, Paper } from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { HANDBOOK_EMBED_URL, HANDBOOK_URL } from '../../lib/constants'
import { PageHeader } from '../../components/common'

export default function Handbook() {
  return (
    <>
      <PageHeader
        title="Handbook"
        actions={
          <Button
            variant="outlined"
            endIcon={<OpenInNewIcon />}
            href={HANDBOOK_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Google Docs
          </Button>
        }
      />
      {/* Fills the rest of the window below the app bar and the page header. */}
      <Paper variant="outlined" sx={{ overflow: 'hidden', height: 'calc(100vh - 220px)', minHeight: 480 }}>
        <iframe
          src={HANDBOOK_EMBED_URL}
          title="Employee handbook"
          style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
        />
      </Paper>
    </>
  )
}
