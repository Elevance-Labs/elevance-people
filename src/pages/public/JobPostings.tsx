import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Container,
  Grid,
  Stack,
  Typography,
} from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import WorkOutlineIcon from '@mui/icons-material/WorkOutlined'
import { CareersFrame, Perks } from '../../components/Careers'
import { useBrandingParam, usePageTitle, usePublicBranding } from '../../components/useCareers'
import { supabase } from '../../lib/supabase'
import { COMPANY_NAME, formatDate } from '../../lib/constants'
import { htmlToText } from '../../lib/richText'
import type { JobPostingSummary } from '../../lib/types'

// Public: every open job taking applications, as cards, each leading to its
// own page. Reads only through job_postings and public_branding.
export default function JobPostings() {
  const { branding, loaded } = usePublicBranding()
  const { branded, query } = useBrandingParam()
  const [jobs, setJobs] = useState<JobPostingSummary[] | null>(null)

  useEffect(() => {
    supabase.rpc('job_postings').then(({ data }) => setJobs((data as JobPostingSummary[] | null) ?? []))
  }, [])

  usePageTitle(`Careers · ${COMPANY_NAME}`)

  return (
    <CareersFrame branding={branding} branded={branded}>
      {!loaded || !jobs ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 12 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Box sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}>
            <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
              <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
                Open positions
              </Typography>
              <Typography sx={{ mt: 1.5, opacity: 0.9 }}>
                {jobs.length
                  ? `${jobs.length} ${jobs.length === 1 ? 'role' : 'roles'} taking applications`
                  : 'No roles are taking applications right now'}
              </Typography>
            </Container>
          </Box>

          <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
            <Stack spacing={{ xs: 4, md: 5 }}>
              {jobs.length ? (
                <Grid container spacing={{ xs: 2, md: 3 }}>
                  {jobs.map((job) => (
                    <Grid key={job.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                      <JobCard job={job} to={`/careers/${job.id}${query}`} />
                    </Grid>
                  ))}
                </Grid>
              ) : (
                <Box sx={{ py: 6, textAlign: 'center' }}>
                  <WorkOutlineIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                  <Typography sx={{ color: 'text.secondary', mt: 1 }}>
                    Check back soon: new roles are posted here.
                  </Typography>
                </Box>
              )}
              {!!branding?.perks.length && <Perks perks={branding.perks} wide />}
            </Stack>
          </Container>
        </>
      )}
    </CareersFrame>
  )
}

function JobCard({ job, to }: { job: JobPostingSummary; to: string }) {
  const excerpt = htmlToText(job.description)
  return (
    <Card variant="outlined" sx={{ height: '100%', '&:hover': { borderColor: 'primary.main' } }}>
      <CardActionArea
        component={Link}
        to={to}
        sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {job.title}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {[job.designation, job.department].join(' · ')}
          </Typography>
          {excerpt && (
            <Typography
              variant="body2"
              sx={{
                mt: 2,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {excerpt}
            </Typography>
          )}
          <Stack
            direction="row"
            sx={{ mt: 'auto', pt: 2.5, alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
          >
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'text.secondary' }}>
              <EventOutlinedIcon fontSize="small" />
              <Typography variant="body2">
                {job.due_date ? `Apply by ${formatDate(job.due_date)}` : 'Open until filled'}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'primary.main' }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                View and apply
              </Typography>
              <ArrowForwardIcon fontSize="small" />
            </Stack>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
