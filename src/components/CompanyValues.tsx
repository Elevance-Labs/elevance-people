import { useState, type ReactElement } from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import Diversity3OutlinedIcon from '@mui/icons-material/Diversity3Outlined'
import ReplayIcon from '@mui/icons-material/Replay'
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined'
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined'
import VolunteerActivismOutlinedIcon from '@mui/icons-material/VolunteerActivismOutlined'
import WorkspacePremiumOutlinedIcon from '@mui/icons-material/WorkspacePremiumOutlined'

interface Value {
  title: string
  description: string
  icon: ReactElement
  // The tile's accent, and a darker shade of it that reads well as text.
  accent: string
  ink: string
}

const COMPANY_VALUES: Value[] = [
  {
    title: 'Integrity First',
    description:
      "We build trust through honest communication, ethical decision-making, and taking accountability for our actions. We do what's right, even when no one is watching.",
    icon: <VerifiedUserOutlinedIcon />,
    accent: '#5c6bc0',
    ink: '#3949ab',
  },
  {
    title: 'Continuous Learning',
    description:
      "We embrace learning opportunities, seek feedback, and support each other's development. We view challenges as chances to improve and innovation as essential to our success.",
    icon: <SchoolOutlinedIcon />,
    accent: '#26a69a',
    ink: '#00796b',
  },
  {
    title: 'Excellence in Work',
    description:
      'We are committed to delivering our best work through dedication, attention to detail, and a strong work ethic. We take pride in our contributions and strive for quality in everything we do.',
    icon: <WorkspacePremiumOutlinedIcon />,
    accent: '#f0a73a',
    ink: '#b26a00',
  },
  {
    title: 'Collaborative Spirit',
    description:
      'We achieve more together than we ever could alone. We share knowledge freely, support our teammates, and celebrate collective wins while fostering an environment where every voice is heard and valued.',
    icon: <Diversity3OutlinedIcon />,
    accent: '#ec6f8c',
    ink: '#c2185b',
  },
  {
    title: 'Customer-Focus',
    description:
      'We exist to serve our customers and exceed their expectations. Every decision we make considers the customer impact, and we continuously seek to understand and anticipate their needs to deliver exceptional value.',
    icon: <VolunteerActivismOutlinedIcon />,
    accent: '#8e6cd8',
    ink: '#5e35b1',
  },
]

// Both faces share one grid cell, so a card is as tall as its longer face
// and the description never overflows, whatever the width.
const face = {
  gridArea: '1 / 1',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  borderRadius: 3,
  p: 2.5,
  display: 'flex',
  flexDirection: 'column',
  textAlign: 'left',
} as const

function ValueCard({ value, index }: { value: Value; index: number }) {
  const [open, setOpen] = useState(false)
  const { accent, ink } = value

  return (
    <ButtonBase
      focusRipple
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      sx={{
        display: 'block',
        width: '100%',
        height: '100%',
        borderRadius: 3,
        perspective: '1200px',
        '&:hover .value-card': { transform: open ? 'rotateY(180deg) translateY(-2px)' : 'translateY(-2px)' },
        '&.Mui-focusVisible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
      }}
    >
      <Box
        className="value-card"
        sx={{
          display: 'grid',
          height: '100%',
          transformStyle: 'preserve-3d',
          transition: 'transform 0.6s cubic-bezier(0.2, 0.7, 0.2, 1)',
          transform: open ? 'rotateY(180deg)' : 'none',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        {/* Front: the icon and the title only. */}
        <Box
          aria-hidden={open}
          sx={{
            ...face,
            position: 'relative',
            overflow: 'hidden',
            minHeight: 168,
            border: 1,
            borderColor: alpha(accent, 0.22),
            background: `linear-gradient(140deg, ${alpha(accent, 0.16)} 0%, ${alpha(accent, 0.04)} 70%, #fff 100%)`,
          }}
        >
          <Typography
            aria-hidden
            sx={{
              position: 'absolute',
              top: 4,
              right: 16,
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: '-0.04em',
              color: alpha(accent, 0.18),
              userSelect: 'none',
            }}
          >
            {String(index + 1).padStart(2, '0')}
          </Typography>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 2.5,
              display: 'grid',
              placeItems: 'center',
              bgcolor: '#fff',
              color: ink,
              boxShadow: `0 6px 16px ${alpha(accent, 0.25)}`,
              '& svg': { fontSize: 26 },
            }}
          >
            {value.icon}
          </Box>
          <Box sx={{ flexGrow: 1, minHeight: 16 }} />
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
            {value.title}
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: ink, fontWeight: 600, mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            Read more <ArrowForwardIcon sx={{ fontSize: 14 }} />
          </Typography>
        </Box>

        {/* Back: what the value means. */}
        <Box
          aria-hidden={!open}
          sx={{
            ...face,
            transform: 'rotateY(180deg)',
            border: 1,
            borderColor: alpha(accent, 0.35),
            bgcolor: '#fff',
            backgroundImage: `linear-gradient(160deg, ${alpha(accent, 0.1)}, ${alpha(accent, 0.02)})`,
          }}
        >
          <Typography variant="subtitle2" component="p" sx={{ color: ink, fontWeight: 700, mb: 1 }}>
            {value.title}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.primary', lineHeight: 1.6, flexGrow: 1 }}>
            {value.description}
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', mt: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <ReplayIcon sx={{ fontSize: 14 }} /> Back
          </Typography>
        </Box>
      </Box>
    </ButtonBase>
  )
}

// A collage of the company values: titles and icons up front, each card
// flipping over to its description when someone wants to read it.
export function CompanyValues() {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        // Two wide cards over three narrow ones; a pair per row on tablets.
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(6, 1fr)' },
      }}
    >
      {COMPANY_VALUES.map((value, i) => (
        <Box
          key={value.title}
          sx={{
            gridColumn: {
              xs: 'auto',
              sm: i === COMPANY_VALUES.length - 1 ? 'span 2' : 'span 1',
              md: i < 2 ? 'span 3' : 'span 2',
            },
          }}
        >
          <ValueCard value={value} index={i} />
        </Box>
      ))}
    </Box>
  )
}
