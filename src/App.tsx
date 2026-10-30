import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { useAuth } from './auth/AuthProvider'
import Layout from './components/Layout'
import Login from './pages/Login'
import Employees from './pages/Employees'
import Appraisals from './pages/Appraisals'
import EmployeeForm from './pages/EmployeeForm'
import OrgChart from './pages/OrgChart'
import Departments from './pages/company/Departments'
import Designations from './pages/company/Designations'
import Kpis from './pages/company/Kpis'
import Expectations from './pages/company/Expectations'
import MyLeaves from './pages/leaves/MyLeaves'
import LeaveRequests from './pages/leaves/LeaveRequests'
import CompanyLeaves from './pages/company/Leaves'
import Holidays from './pages/company/Holidays'
import Branding from './pages/company/Branding'
import JobOpenings from './pages/hiring/JobOpenings'
import Applications from './pages/hiring/Applications'
import JobPosting from './pages/public/JobPosting'
import Onboarding from './pages/hr/Onboarding'
import OnboardingDetail from './pages/hr/OnboardingDetail'
import Offboarding from './pages/hr/Offboarding'
import OffboardingDetail from './pages/hr/OffboardingDetail'
import Checklist from './pages/configuration/Checklist'
import Dashboard from './pages/home/Dashboard'
import Handbook from './pages/home/Handbook'
import Resources from './pages/home/Resources'
import GuidePage from './pages/home/GuidePage'
import Profile from './pages/home/Profile'
import Payrolls from './pages/finance/Payrolls'
import PayrollDetail from './pages/finance/PayrollDetail'
import Reimbursements from './pages/finance/Reimbursements'
import MyReimbursements from './pages/finance/MyReimbursements'
import EquipmentList from './pages/operations/Equipment'
import EquipmentForm from './pages/operations/EquipmentForm'
import Vendors from './pages/configuration/Vendors'
import Performance from './pages/performance/Performance'
import PerformanceReview from './pages/performance/Review'
import PerformancePerson from './pages/performance/Person'
import PeerReview from './pages/performance/PeerReview'
import PeerCycle from './pages/performance/PeerCycle'
import ManagerFeedbackForm from './pages/performance/ManagerFeedbackForm'

// These carry the rich text editor, so they load only when HR opens them.
const JobOpeningForm = lazy(() => import('./pages/hiring/JobOpeningForm'))
const Announcements = lazy(() => import('./pages/company/Announcements'))

const spinner = (
  <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
    <CircularProgress />
  </Box>
)

export default function App() {
  return (
    <Routes>
      {/* Public: no sign-in needed. Everything else sits behind the employee login. */}
      <Route path="/careers/:id" element={<JobPosting />} />
      <Route path="*" element={<SignedIn />} />
    </Routes>
  )
}

function SignedIn() {
  const {
    loading,
    employee,
    isHr,
    isCompanyAdmin,
    isManager,
    isHiringTeam,
    canManagePayroll,
    canManageOperations,
    canClaimReimbursements,
  } = useAuth()

  if (loading) return spinner
  if (!employee) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/handbook" element={<Handbook />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/resources/guides/:slug" element={<GuidePage />} />
        <Route path="/profile" element={<Profile />} />
        {isHr && (
          <>
            <Route path="/employees" element={<Employees />} />
            <Route path="/employees/new" element={<EmployeeForm />} />
            <Route path="/employees/:id" element={<EmployeeForm />} />
            <Route path="/appraisals" element={<Appraisals />} />
            <Route path="/jobs" element={<JobOpenings />} />
            <Route path="/jobs/new" element={<Suspense fallback={spinner}><JobOpeningForm /></Suspense>} />
            <Route path="/jobs/:id" element={<Suspense fallback={spinner}><JobOpeningForm /></Suspense>} />
            <Route path="/hr/onboarding" element={<Onboarding />} />
            <Route path="/hr/onboarding/:id" element={<OnboardingDetail />} />
          </>
        )}
        {/* Managers see their direct reports' offboardings; RLS decides which. */}
        {(isHr || isManager) && (
          <>
            <Route path="/hr/offboarding" element={<Offboarding />} />
            <Route path="/hr/offboarding/:id" element={<OffboardingDetail />} />
          </>
        )}
        <Route path="/org-chart" element={<OrgChart />} />
        <Route path="/performance" element={<Performance />} />
        <Route path="/performance/reviews/:id" element={<PerformanceReview />} />
        {(isHr || isManager) && <Route path="/performance/people/:id" element={<PerformancePerson />} />}
        <Route path="/performance/peer/:id" element={<PeerReview />} />
        <Route path="/performance/manager-feedback/:id" element={<ManagerFeedbackForm />} />
        {isHr && <Route path="/performance/cycles/:id" element={<PeerCycle />} />}
        <Route path="/leaves" element={<MyLeaves />} />
        {(isHr || isManager) && <Route path="/leaves/requests" element={<LeaveRequests />} />}
        {(isHr || isHiringTeam) && <Route path="/applications" element={<Applications />} />}
        {canManagePayroll && (
          <>
            <Route path="/finance/payroll" element={<Payrolls />} />
            <Route path="/finance/payroll/:id" element={<PayrollDetail />} />
            <Route path="/finance/reimbursements" element={<Reimbursements />} />
          </>
        )}
        {canClaimReimbursements && <Route path="/reimbursements" element={<MyReimbursements />} />}
        {canManageOperations && (
          <>
            <Route path="/operations/equipment" element={<EquipmentList />} />
            <Route path="/operations/equipment/new" element={<EquipmentForm />} />
            <Route path="/operations/equipment/:id" element={<EquipmentForm />} />
            <Route path="/configuration/vendors" element={<Vendors />} />
          </>
        )}
        {isHr && (
          <>
            <Route path="/company/leaves" element={<CompanyLeaves />} />
            <Route path="/company/holidays" element={<Holidays />} />
            <Route
              path="/company/announcements"
              element={<Suspense fallback={spinner}><Announcements /></Suspense>}
            />
          </>
        )}
        {isCompanyAdmin && (
          <>
            <Route path="/company/departments" element={<Departments />} />
            <Route path="/company/designations" element={<Designations />} />
            <Route path="/company/kpis" element={<Kpis />} />
            <Route path="/company/expectations" element={<Expectations />} />
            <Route path="/company/branding" element={<Branding />} />
            <Route path="/configuration/onboarding" element={<Checklist key="onboarding" kind="onboarding" />} />
            <Route path="/configuration/offboarding" element={<Checklist key="offboarding" kind="offboarding" />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
