import { useState, type ReactElement, type ReactNode } from 'react'
import { Box, Chip, Paper, Stack, Tab, Tabs, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import ChatOutlinedIcon from '@mui/icons-material/ChatOutlined'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import ViewKanbanOutlinedIcon from '@mui/icons-material/ViewKanbanOutlined'
import { COMPANY_NAME } from '../lib/constants'

// The good and bad colours of the Do / Don't marks, kept apart from the tool accents.
const GOOD = '#2e7d32'
const BAD = '#c62828'

type CategoryId = 'chat' | 'calendar' | 'docs' | 'jira'

interface Practice {
  title: string
  body: string
  do?: string
  dont?: string
  extra?: ReactNode
}

interface Category {
  id: CategoryId
  label: string
  icon: ReactElement
  accent: string
  ink: string
  ruleOfThumb: { title: string; text: string }
  practices: Practice[]
}

const STATUSES = ['🧠 Focus Time · notifications paused', '🥗 Lunch', '🌴 OOO / Away']
const JIRA_FLOW = ['To Do', 'In Progress', 'In Review', 'Done']

const CATEGORIES: Category[] = [
  {
    id: 'chat',
    label: 'Google Chat',
    icon: <ChatOutlinedIcon />,
    accent: '#2e9e5b',
    ink: '#1b7a43',
    ruleOfThumb: {
      title: 'One ping, full picture',
      text: 'Write every message so it can be acted on without a follow-up question: who, what, the link, and by when.',
    },
    practices: [
      {
        title: 'Avoid the isolated "Hi"',
        body: 'Combine your greeting, context, relevant links and an explicit call to action into a single message.',
        do: '"Hi @Alex, could you review the scope updates on JIRA-1234? Need approval by 3 PM today."',
        dont: '"Hi Alex" … (waits 10 mins) … "Are you free?"',
      },
      {
        title: 'Thread all Space discussions',
        body: 'Reply inside the thread in Google Chat Spaces, so the main feed stays readable for everyone.',
        do: 'Reply in the thread under the original message.',
        dont: 'Answer a question as a new top-level message in the Space.',
      },
      {
        title: 'Use custom statuses',
        body: "Set a status so people know when you're heads-down or away, and don't expect an instant reply.",
        extra: (
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            {STATUSES.map((s) => (
              <Chip key={s} label={s} size="small" variant="outlined" sx={{ bgcolor: '#fff' }} />
            ))}
          </Stack>
        ),
      },
      {
        title: 'Escalate to an instant Meet: the 3-message rule',
        body: 'If a back-and-forth in Chat goes past 3 messages without a resolution, click "Add video call" right in the thread and talk it through for 5 minutes.',
      },
    ],
  },
  {
    id: 'calendar',
    label: 'Calendar & Meet',
    icon: <CalendarMonthOutlinedIcon />,
    accent: '#3b82f6',
    ink: '#1d4ed8',
    ruleOfThumb: {
      title: 'Guard the calendar',
      text: "Focus Time is a meeting with yourself: book around it, never over it. An invite with no agenda can be declined politely, with a request for one.",
    },
    practices: [
      {
        title: 'Set working hours and locations',
        body: 'Set your daily working hours and location (WFH or Office) in Google Calendar settings, so others book you at the right time.',
      },
      {
        title: 'Protect focus blocks',
        body: 'Block 2–3 hours a day with Google Calendar\'s "Focus time" event type, with auto-decline turned on.',
      },
      {
        title: 'No agenda, no attenda',
        body: 'Every invite carries a clear goal, a bulleted agenda, and the Google Docs pre-reads or Jira links attached.',
        do: 'Goal: agree the Q3 scope. Agenda: 3 bullets. Pre-read: the scope doc, linked.',
        dont: 'An invite called "Sync" with an empty description.',
      },
      {
        title: 'Keep events visible',
        body: 'Leave event visibility open to the organisation, and mark personal items Private.',
      },
      {
        title: 'Instant Meets for quick blockers',
        body: 'For a 5–10 minute blocker, start a Meet from the Google Chat thread instead of booking a slot. When you hang up, post the decision and action items in the thread or on the Jira issue.',
        dont: 'A 30-minute unscheduled call with no notes afterwards.',
      },
    ],
  },
  {
    id: 'docs',
    label: 'Docs & Workspace',
    icon: <DescriptionOutlinedIcon />,
    accent: '#f0a73a',
    ink: '#b26a00',
    ruleOfThumb: {
      title: 'Feedback lives where the work lives',
      text: "If it's about a line, comment on that line, not in a DM with a screenshot.",
    },
    practices: [
      {
        title: 'Comment at the source',
        body: 'Add comments directly on the text or cells in Google Docs and Sheets, rather than discussing them in Chat DMs.',
        do: 'Highlight the paragraph and add a comment.',
        dont: 'Send a screenshot of the paragraph in a DM.',
      },
      {
        title: 'Make @mentions actionable',
        body: 'Use @Name in a document comment to assign an explicit action item to someone.',
      },
      {
        title: 'Resolve only when it\'s done',
        body: 'The person who makes the change resolves the comment thread, not the person who asked for it.',
      },
      {
        title: 'Share openly before you send',
        body: `Set link sharing to "Anyone in ${COMPANY_NAME} with the link can comment" (or edit) before sharing, so nobody has to request access.`,
      },
    ],
  },
  {
    id: 'jira',
    label: 'Jira & async',
    icon: <ViewKanbanOutlinedIcon />,
    accent: '#8e6cd8',
    ink: '#5e35b1',
    ruleOfThumb: {
      title: "If it isn't on the ticket, it didn't happen",
      text: 'Decided something in Chat or a Meet? Copy the outcome into a Jira comment before you move on.',
    },
    practices: [
      {
        title: 'One source of truth',
        body: 'Record every technical decision, scope change and code or design review in the Jira issue comments.',
        dont: 'Agreeing a scope change in a 1:1 chat and leaving the ticket as it was.',
      },
      {
        title: 'Keep statuses current',
        body: 'Move tickets along as the work moves, straight away, so the board is always true.',
        extra: (
          <Stack direction="row" sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mt: 1.5 }}>
            {JIRA_FLOW.map((s, i) => (
              <Stack key={s} direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                {i > 0 && <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />}
                <Chip
                  label={s}
                  size="small"
                  sx={{
                    fontWeight: 600,
                    bgcolor: i === JIRA_FLOW.length - 1 ? alpha(GOOD, 0.12) : alpha('#8e6cd8', 0.12),
                    color: i === JIRA_FLOW.length - 1 ? GOOD : '#5e35b1',
                  }}
                />
              </Stack>
            ))}
          </Stack>
        ),
      },
      {
        title: 'Cross-link the context',
        body: "Link the relevant Google Docs, Sheets or Drive folders in the ticket's linked resources.",
      },
      {
        title: 'Targeted @mentions in comments',
        body: 'Mention the specific teammates whose input you need, and state exactly what decision you need from them.',
        do: '"@Sara, OK to drop CSV export from v1? Need a yes or no by Thursday."',
        dont: '"@here thoughts?"',
      },
    ],
  },
]

// A tick or a cross with its text, for golden rules and examples alike.
function Mark({ good, label, children }: { good: boolean; label: string; children: ReactNode }) {
  const color = good ? GOOD : BAD
  const Icon = good ? CheckCircleRoundedIcon : CancelRoundedIcon
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Icon aria-hidden sx={{ color, fontSize: 20, mt: '1px', flexShrink: 0 }} />
      <Typography variant="body2" sx={{ lineHeight: 1.55 }}>
        <Box component="span" sx={{ fontWeight: 700, color }}>
          {label}
        </Box>{' '}
        {children}
      </Typography>
    </Stack>
  )
}

function PracticeCard({ practice, index, category }: { practice: Practice; index: number; category: Category }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1, height: '100%' }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Box
          aria-hidden
          sx={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 13,
            fontWeight: 700,
            color: category.ink,
            bgcolor: alpha(category.accent, 0.14),
          }}
        >
          {index + 1}
        </Box>
        <Typography variant="subtitle2" component="h4" sx={{ fontWeight: 700, lineHeight: 1.35 }}>
          {practice.title}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
        {practice.body}
      </Typography>
      {practice.extra}
      {(practice.do || practice.dont) && (
        <Stack spacing={1} sx={{ mt: 1, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
          {practice.do && (
            <Mark good label="Do:">
              {practice.do}
            </Mark>
          )}
          {practice.dont && (
            <Mark good={false} label="Don't:">
              {practice.dont}
            </Mark>
          )}
        </Stack>
      )}
    </Paper>
  )
}

function RuleOfThumb({ category }: { category: Category }) {
  return (
    <Box
      role="note"
      sx={{
        p: 2,
        mb: 2,
        borderRadius: 2,
        display: 'flex',
        gap: 1.5,
        border: 1,
        borderColor: alpha(category.accent, 0.35),
        background: `linear-gradient(120deg, ${alpha(category.accent, 0.14)}, ${alpha(category.accent, 0.03)})`,
      }}
    >
      <LightbulbOutlinedIcon aria-hidden sx={{ color: category.ink, mt: '2px' }} />
      <Box>
        <Typography variant="overline" sx={{ color: category.ink, fontWeight: 700, lineHeight: 1.6 }}>
          Rule of thumb
        </Typography>
        <Typography variant="subtitle2" component="p" sx={{ fontWeight: 700 }}>
          {category.ruleOfThumb.title}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
          {category.ruleOfThumb.text}
        </Typography>
      </Box>
    </Box>
  )
}

// The working norms for our tools: a banner, then the detailed practices per
// tool, a tab each. Static, like
// the company values; edit the lists above to change them.
export function WorkingGuidelines() {
  const [tab, setTab] = useState<CategoryId>('chat')
  const category = CATEGORIES.find((c) => c.id === tab)!

  return (
    <Box component="section" sx={{ mb: 4 }} aria-labelledby="guidelines-title">
      {/* Header: title and the three principles. */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.5, md: 3 },
          mb: 3,
          borderRadius: 3,
          position: 'relative',
          overflow: 'hidden',
          background: (t) =>
            `linear-gradient(135deg, ${alpha(t.palette.primary.main, 0.12)} 0%, ${alpha('#14a3a3', 0.08)} 55%, #fff 100%)`,
        }}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
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
              color: 'primary.main',
              boxShadow: (t) => `0 6px 16px ${alpha(t.palette.primary.main, 0.2)}`,
            }}
          >
            <HubOutlinedIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography id="guidelines-title" variant="h6" component="h2">
              Remote Work & Collaboration Guidelines
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              Respect for focus, transparency, and async clarity, across Google Workspace, Google Chat and Jira.
            </Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
              {['🧠 Focus', '🔍 Transparency', '⏳ Async clarity'].map((p) => (
                <Chip key={p} label={p} size="small" sx={{ bgcolor: '#fff', fontWeight: 600 }} />
              ))}
            </Stack>
          </Box>
        </Stack>
      </Paper>

      {/* The detailed norms, a tab per area. */}
      <Box>
        <Tabs
          value={tab}
          onChange={(_, v: CategoryId) => setTab(v)}
          variant="scrollable"
          allowScrollButtonsMobile
          aria-label="Detailed norms"
          sx={{
            mb: 2,
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTabs-indicator': { bgcolor: category.ink, height: 3 },
          }}
        >
          {CATEGORIES.map((c) => (
            <Tab
              key={c.id}
              value={c.id}
              label={c.label}
              icon={c.icon}
              iconPosition="start"
              id={`norms-tab-${c.id}`}
              aria-controls="norms-panel"
              sx={{ minHeight: 48, '&.Mui-selected': { color: c.ink } }}
            />
          ))}
        </Tabs>
        <Box role="tabpanel" id="norms-panel" aria-labelledby={`norms-tab-${tab}`}>
          <RuleOfThumb category={category} />
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
            {category.practices.map((p, i) => (
              <PracticeCard key={p.title} practice={p} index={i} category={category} />
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
