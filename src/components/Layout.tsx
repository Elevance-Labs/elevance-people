import { useEffect, useState, type ReactElement } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import {
  AppBar,
  Box,
  ButtonBase,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined'
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined'
import BeachAccessOutlinedIcon from '@mui/icons-material/BeachAccessOutlined'
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined'
import CelebrationOutlinedIcon from '@mui/icons-material/CelebrationOutlined'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined'
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined'
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined'
import PlaylistRemoveOutlinedIcon from '@mui/icons-material/PlaylistRemoveOutlined'
import RequestQuoteOutlinedIcon from '@mui/icons-material/RequestQuoteOutlined'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined'
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined'
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutlined'
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined'
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined'
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined'
import ViewKanbanOutlinedIcon from '@mui/icons-material/ViewKanbanOutlined'
import WorkOutlineIcon from '@mui/icons-material/WorkOutlined'
import { useAuth } from '../auth/AuthProvider'
import { APP_ROLE_LABELS } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { Logo, PersonAvatar } from './common'

const DRAWER_WIDTH = 248

interface NavItem {
  to: string
  label: string
  icon: ReactElement
  hrOnly?: boolean
  // HR, or anyone with direct reports in the org chart.
  approversOnly?: boolean
  // HR, or anyone on a job's hiring team (manager or interviewer).
  hiringTeamOnly?: boolean
  companyAdminOnly?: boolean
  // HR, finance admins and company admins.
  payrollOnly?: boolean
  // HR, finance admins and company admins.
  operationsOnly?: boolean
}

// A section shows when the person may see at least one of its items.
interface NavSection {
  title: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    title: 'Home',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: <DashboardOutlinedIcon /> },
      { to: '/handbook', label: 'Handbook', icon: <MenuBookOutlinedIcon /> },
      { to: '/resources', label: 'Resources', icon: <LightbulbOutlinedIcon /> },
      { to: '/profile', label: 'Profile', icon: <PersonOutlineIcon /> },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/employees', label: 'Employees', icon: <PeopleOutlineIcon />, hrOnly: true },
      { to: '/org-chart', label: 'Org chart', icon: <AccountTreeOutlinedIcon /> },
      { to: '/performance', label: 'Performance', icon: <TrendingUpOutlinedIcon /> },
      { to: '/appraisals', label: 'Appraisals', icon: <RequestQuoteOutlinedIcon />, hrOnly: true },
    ],
  },
  {
    title: 'Leaves',
    items: [
      { to: '/leaves', label: 'My leaves', icon: <BeachAccessOutlinedIcon /> },
      { to: '/leaves/requests', label: 'Leave requests', icon: <EventAvailableOutlinedIcon />, approversOnly: true },
    ],
  },
  {
    title: 'Hiring',
    items: [
      { to: '/jobs', label: 'Job openings', icon: <WorkOutlineIcon />, hrOnly: true },
      { to: '/applications', label: 'Applications', icon: <ViewKanbanOutlinedIcon />, hiringTeamOnly: true },
    ],
  },
  {
    title: 'Human Resources',
    items: [
      { to: '/hr/onboarding', label: 'Onboarding', icon: <HowToRegOutlinedIcon />, hrOnly: true },
      // Managers sign off their direct reports' offboardings.
      { to: '/hr/offboarding', label: 'Offboarding', icon: <PersonRemoveOutlinedIcon />, approversOnly: true },
    ],
  },
  {
    title: 'Finance',
    items: [{ to: '/finance/payroll', label: 'Payroll', icon: <PaymentsOutlinedIcon />, payrollOnly: true }],
  },
  {
    title: 'Operations',
    items: [
      { to: '/operations/equipment', label: 'Equipment', icon: <DevicesOutlinedIcon />, operationsOnly: true },
    ],
  },
  {
    title: 'Company',
    items: [
      { to: '/company/departments', label: 'Departments', icon: <ApartmentOutlinedIcon />, companyAdminOnly: true },
      { to: '/company/designations', label: 'Designations', icon: <BadgeOutlinedIcon />, companyAdminOnly: true },
      { to: '/company/kpis', label: 'KPIs', icon: <InsightsOutlinedIcon />, companyAdminOnly: true },
      { to: '/company/expectations', label: 'Expectations', icon: <TaskAltOutlinedIcon />, companyAdminOnly: true },
      // HR sets up leave, holidays and announcements too, so these are open to HR admins.
      { to: '/company/leaves', label: 'Leaves', icon: <EventNoteOutlinedIcon />, hrOnly: true },
      { to: '/company/holidays', label: 'Holidays', icon: <CelebrationOutlinedIcon />, hrOnly: true },
      { to: '/company/announcements', label: 'Announcements', icon: <CampaignOutlinedIcon />, hrOnly: true },
      { to: '/company/branding', label: 'Branding', icon: <PaletteOutlinedIcon />, companyAdminOnly: true },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { to: '/configuration/onboarding', label: 'Onboarding', icon: <ChecklistOutlinedIcon />, companyAdminOnly: true },
      { to: '/configuration/offboarding', label: 'Offboarding', icon: <PlaylistRemoveOutlinedIcon />, companyAdminOnly: true },
      { to: '/configuration/vendors', label: 'Vendors', icon: <StorefrontOutlinedIcon />, operationsOnly: true },
    ],
  },
]

export default function Layout() {
  const { employee, isHr, isCompanyAdmin, isManager, isHiringTeam, canManagePayroll, canManageOperations, signOut } =
    useAuth()
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenu, setUserMenu] = useState<HTMLElement | null>(null)
  const [designation, setDesignation] = useState<string | null>(null)
  const designationId = employee?.designation_id

  useEffect(() => {
    if (!designationId) return setDesignation(null)
    supabase
      .from('designations')
      .select('title')
      .eq('id', designationId)
      .maybeSingle()
      .then(({ data }) => setDesignation(data?.title ?? null))
  }, [designationId])

  if (!employee) return null

  // The most specific item wins, so /leaves/requests doesn't also light up /leaves.
  const activeTo = NAV.flatMap((section) => section.items)
    .map((item) => item.to)
    .filter((to) => pathname === to || pathname.startsWith(`${to}/`))
    .sort((a, b) => b.length - a.length)[0]

  const drawer = (
    <>
      <Toolbar />
      {NAV.map((section) => {
        const items = section.items.filter(
          (item) =>
            (isHr || !item.hrOnly) &&
            (isHr || isManager || !item.approversOnly) &&
            (isHr || isHiringTeam || !item.hiringTeamOnly) &&
            (isCompanyAdmin || !item.companyAdminOnly) &&
            (canManagePayroll || !item.payrollOnly) &&
            (canManageOperations || !item.operationsOnly),
        )
        if (!items.length) return null
        return (
          <List
            key={section.title}
            sx={{ px: 1.5 }}
            subheader={
              <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '36px' }}>
                {section.title}
              </ListSubheader>
            }
          >
            {items.map((item) => (
              <ListItemButton
                key={item.to}
                component={Link}
                to={item.to}
                selected={item.to === activeTo}
                onClick={() => setMobileOpen(false)}
                sx={{
                  borderRadius: 2,
                  mb: 0.5,
                  '&.Mui-selected': {
                    color: 'primary.main',
                    '& .MuiListItemIcon-root': { color: 'primary.main' },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontWeight: 500 } } }} />
              </ListItemButton>
            ))}
          </List>
        )
      })}
    </>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{ zIndex: theme.zIndex.drawer + 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar sx={{ gap: 1.5 }}>
          {!desktop && (
            <IconButton edge="start" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Logo />
          <Typography variant="h6" component="div" noWrap sx={{ flexGrow: 1 }}>
            Elevance People
          </Typography>

          <ButtonBase
            onClick={(e) => setUserMenu(e.currentTarget)}
            aria-label="Account menu"
            sx={{ borderRadius: 6, py: 0.5, pl: 0.5, pr: 1, gap: 1.25, '&:hover': { bgcolor: 'action.hover' } }}
          >
            <PersonAvatar name={employee.full_name} size={34} />
            <Box sx={{ textAlign: 'left', display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.2 }}>
                {employee.full_name}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {APP_ROLE_LABELS[employee.app_role]}
              </Typography>
            </Box>
            <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          </ButtonBase>
          <Menu
            anchorEl={userMenu}
            open={!!userMenu}
            onClose={() => setUserMenu(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { mt: 1, minWidth: 240 } } }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{employee.full_name}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {employee.company_email}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {designation ?? APP_ROLE_LABELS[employee.app_role]}
              </Typography>
            </Box>
            <Divider />
            <MenuItem
              onClick={() => {
                setUserMenu(null)
                signOut()
              }}
            >
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={desktop ? 'permanent' : 'temporary'}
        open={desktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ width: DRAWER_WIDTH, flexShrink: 0 }}
        slotProps={{ paper: { sx: { width: DRAWER_WIDTH, boxSizing: 'border-box' } } }}
      >
        {drawer}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 4 } }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  )
}
