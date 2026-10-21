import { useEffect, useState, type ReactElement } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Box, ButtonBase, Chip, LinearProgress, Paper, Stack, Tab, Tabs, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined'
import PrecisionManufacturingOutlinedIcon from '@mui/icons-material/PrecisionManufacturingOutlined'
import SettingsSuggestOutlinedIcon from '@mui/icons-material/SettingsSuggestOutlined'
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { BUSINESS_FUNCTION_LABELS } from '../../lib/constants'
import { FUNCTION_SUMMARIES, GUIDE_COLUMNS } from '../../lib/guides'
import type { BusinessFunction, Guide } from '../../lib/types'
import { PageHeader } from '../../components/common'
import { WorkingGuidelines } from '../../components/WorkingGuidelines'

const FUNCTIONS: Record<BusinessFunction, { icon: ReactElement; accent: string; ink: string }> = {
  production: { icon: <PrecisionManufacturingOutlinedIcon />, accent: '#3b82f6', ink: '#1d4ed8' },
  growth: { icon: <TrendingUpOutlinedIcon />, accent: '#2e9e5b', ink: '#1b7a43' },
  operations: { icon: <SettingsSuggestOutlinedIcon />, accent: '#f0a73a', ink: '#b26a00' },
}
const FUNCTION_IDS = Object.keys(FUNCTIONS) as BusinessFunction[]

type TabValue = 'work-ethics' | BusinessFunction

function GuideCard({ guide }: { guide: Guide }) {
  const { accent, ink } = FUNCTIONS[guide.business_function]
  const ready = !!guide.doc_url
  const body = (
    <Stack spacing={1} sx={{ p: 2.5, height: '100%', width: '100%', textAlign: 'left' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box
          aria-hidden
          sx={{
            width: 36,
            height: 36,
            borderRadius: 2,
            display: 'grid',
            placeItems: 'center',
            color: ready ? ink : 'text.disabled',
            bgcolor: ready ? alpha(accent, 0.12) : 'grey.100',
          }}
        >
          <DescriptionOutlinedIcon fontSize="small" />
        </Box>
        {!ready && <Chip label="Coming soon" size="small" variant="outlined" />}
      </Stack>
      <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 700, color: ready ? 'text.primary' : 'text.secondary' }}>
        {guide.title}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
        {guide.description}
      </Typography>
      {ready && (
        <Typography variant="caption" sx={{ color: ink, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          Read the guide <ArrowForwardIcon sx={{ fontSize: 14 }} />
        </Typography>
      )}
    </Stack>
  )

  return (
    <Paper
      component="article"
      variant="outlined"
      sx={{
        height: '100%',
        overflow: 'hidden',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        ...(ready && { '&:hover': { borderColor: accent, boxShadow: `0 6px 16px ${alpha(accent, 0.15)}` } }),
      }}
    >
      {ready ? (
        <ButtonBase component={Link} to={`/resources/guides/${guide.slug}`} sx={{ display: 'flex', height: '100%' }}>
          {body}
        </ButtonBase>
      ) : (
        body
      )}
    </Paper>
  )
}

function FunctionGuides({ fn, mine, guides }: { fn: BusinessFunction; mine: boolean; guides: Guide[] }) {
  const { icon, accent, ink } = FUNCTIONS[fn]
  return (
    <>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.5, md: 3 },
          mb: 3,
          borderRadius: 3,
          display: 'flex',
          gap: 2,
          alignItems: 'flex-start',
          background: `linear-gradient(135deg, ${alpha(accent, 0.14)} 0%, ${alpha(accent, 0.03)} 70%, #fff 100%)`,
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 48,
            height: 48,
            flexShrink: 0,
            borderRadius: 2.5,
            display: { xs: 'none', sm: 'grid' },
            placeItems: 'center',
            bgcolor: '#fff',
            color: ink,
            boxShadow: `0 6px 16px ${alpha(accent, 0.25)}`,
          }}
        >
          {icon}
        </Box>
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h6" component="h2">
              {BUSINESS_FUNCTION_LABELS[fn]} guides
            </Typography>
            {mine && <Chip label="Your function" size="small" sx={{ bgcolor: ink, color: '#fff', fontWeight: 600 }} />}
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {FUNCTION_SUMMARIES[fn]}
          </Typography>
        </Box>
      </Paper>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' } }}>
        {guides.map((g) => (
          <GuideCard key={g.id} guide={g} />
        ))}
      </Box>
      {!guides.length && (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          No guides yet.
        </Typography>
      )}
    </>
  )
}

// Work ethics for everyone, then the guides for the viewer's business function
// (from their department); company admins get a tab per function. The
// database decides which guides anyone reads. Tab in ?tab=.
export default function Resources() {
  const { employee, isCompanyAdmin } = useAuth()
  const departmentId = employee!.department_id
  const [params, setParams] = useSearchParams()
  const [mine, setMine] = useState<BusinessFunction | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      departmentId
        ? supabase.from('departments').select('business_function').eq('id', departmentId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('guides').select(GUIDE_COLUMNS).order('sort_order').order('title'),
    ]).then(([fnRes, guidesRes]) => {
      const failure = fnRes.error ?? guidesRes.error
      if (failure) setError(failure.message)
      else {
        setMine((fnRes.data?.business_function as BusinessFunction | null | undefined) ?? null)
        setGuides(guidesRes.data as Guide[])
      }
      setLoading(false)
    })
  }, [departmentId])

  // Mirrors the guides policy, so nobody is offered a tab that would be empty.
  const functions = isCompanyAdmin ? FUNCTION_IDS : mine ? [mine] : []
  const requested = params.get('tab')
  const tab: TabValue = functions.includes(requested as BusinessFunction) ? (requested as BusinessFunction) : 'work-ethics'

  return (
    <>
      <PageHeader
        title="Resources"
        subtitle={isCompanyAdmin ? 'Our work ethics, and the guides for each business function.' : 'Our work ethics, and the guides for your work.'}
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Tabs
        value={tab}
        onChange={(_, v: TabValue) => setParams(v === 'work-ethics' ? {} : { tab: v }, { replace: true })}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: loading ? 0 : 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="work-ethics" label="Work ethics" icon={<HandshakeOutlinedIcon />} iconPosition="start" sx={{ minHeight: 48 }} />
        {functions.map((fn) => (
          <Tab
            key={fn}
            value={fn}
            label={isCompanyAdmin ? BUSINESS_FUNCTION_LABELS[fn] : `${BUSINESS_FUNCTION_LABELS[fn]} guides`}
            icon={FUNCTIONS[fn].icon}
            iconPosition="start"
            aria-label={isCompanyAdmin && mine === fn ? `${BUSINESS_FUNCTION_LABELS[fn]} (your function)` : undefined}
            sx={{ minHeight: 48 }}
          />
        ))}
      </Tabs>
      {loading && <LinearProgress sx={{ mb: 3 }} />}
      {!loading && !error && !functions.length && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Your department hasn't been given a business function yet, so there are no guides for you here. Ask a
          company admin to set one.
        </Alert>
      )}
      {tab === 'work-ethics' ? (
        <WorkingGuidelines />
      ) : (
        <FunctionGuides fn={tab} mine={mine === tab} guides={guides.filter((g) => g.business_function === tab)} />
      )}
    </>
  )
}
