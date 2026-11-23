import { Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { useAuth } from './auth/AuthProvider'
import Layout from './components/Layout'
import { Splash } from './components/common'
import Login from './pages/Login'
// Home is where the app opens: it comes with the shell. Every other page is
// its own chunk, parsed when first shown (or when the browser is idle).
import Dashboard from './pages/home/Dashboard'
import { preloadWhenIdle } from './components/lazyPage'
import * as pages from './lazyPages'

// A public page's own load (a signed-in page's shows inside the shell).
const spinner = (
  <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
    <CircularProgress />
  </Box>
)

export default function App() {
  return (
    <Routes>
      {/* Public: no sign-in needed. Everything else sits behind the employee login. */}
      <Route path="/careers" element={<Suspense fallback={spinner}><pages.jobPostings.Page /></Suspense>} />
      <Route path="/careers/:id" element={<Suspense fallback={spinner}><pages.jobPosting.Page /></Suspense>} />
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

  if (loading) return <Splash />
  if (!employee) return <Login />

  return (
    <>
    <PreloadNavPages />
    <Routes>
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/handbook" element={<pages.handbook.Page />} />
        <Route path="/resources" element={<pages.resources.Page />} />
        <Route path="/resources/guides/:slug" element={<pages.guidePage.Page />} />
        <Route path="/profile" element={<pages.profile.Page />} />
        {isHr && (
          <>
            <Route path="/employees" element={<pages.employees.Page />} />
            <Route path="/employees/new" element={<pages.employeeForm.Page />} />
            <Route path="/employees/:id" element={<pages.employeeForm.Page />} />
            <Route path="/appraisals" element={<pages.appraisals.Page />} />
            <Route path="/jobs" element={<pages.jobOpenings.Page />} />
            <Route path="/jobs/new" element={<pages.jobOpeningForm.Page />} />
            <Route path="/jobs/:id" element={<pages.jobOpeningForm.Page />} />
          </>
        )}
        {/* Managers see their direct reports' onboardings and offboardings; RLS decides which. */}
        {(isHr || isManager) && (
          <>
            <Route path="/hr/onboarding" element={<pages.onboarding.Page />} />
            <Route path="/hr/onboarding/:id" element={<pages.onboardingDetail.Page />} />
            <Route path="/hr/offboarding" element={<pages.offboarding.Page />} />
            <Route path="/hr/offboarding/:id" element={<pages.offboardingDetail.Page />} />
          </>
        )}
        <Route path="/org-chart" element={<pages.orgChart.Page />} />
        <Route path="/performance" element={<pages.performance.Page />} />
        <Route path="/performance/reviews/:id" element={<pages.performanceReview.Page />} />
        {(isHr || isManager) && <Route path="/performance/people/:id" element={<pages.performancePerson.Page />} />}
        <Route path="/performance/peer/:id" element={<pages.peerReview.Page />} />
        <Route path="/performance/manager-feedback/:id" element={<pages.managerFeedbackForm.Page />} />
        {isHr && <Route path="/performance/cycles/:id" element={<pages.peerCycle.Page />} />}
        <Route path="/leaves" element={<pages.myLeaves.Page />} />
        {(isHr || isManager) && <Route path="/leaves/requests" element={<pages.leaveRequests.Page />} />}
        {(isHr || isHiringTeam) && <Route path="/applications" element={<pages.applications.Page />} />}
        {canManagePayroll && (
          <>
            <Route path="/finance/payroll" element={<pages.payrolls.Page />} />
            <Route path="/finance/payroll/:id" element={<pages.payrollDetail.Page />} />
            <Route path="/finance/reimbursements" element={<pages.reimbursements.Page />} />
          </>
        )}
        {canClaimReimbursements && <Route path="/reimbursements" element={<pages.myReimbursements.Page />} />}
        {canManageOperations && (
          <>
            <Route path="/operations/equipment" element={<pages.equipmentList.Page />} />
            <Route path="/operations/equipment/new" element={<pages.equipmentForm.Page />} />
            <Route path="/operations/equipment/:id" element={<pages.equipmentForm.Page />} />
            <Route path="/configuration/vendors" element={<pages.vendors.Page />} />
          </>
        )}
        {isHr && (
          <>
            <Route path="/company/leaves" element={<pages.companyLeaves.Page />} />
            <Route path="/company/holidays" element={<pages.holidays.Page />} />
            <Route path="/company/kpis" element={<pages.kpis.Page />} />
            <Route path="/company/expectations" element={<pages.expectations.Page />} />
            <Route path="/company/announcements" element={<pages.announcements.Page />} />
          </>
        )}
        {isCompanyAdmin && (
          <>
            <Route path="/company/departments" element={<pages.departments.Page />} />
            <Route path="/company/designations" element={<pages.designations.Page />} />
            <Route path="/company/branding" element={<pages.branding.Page />} />
            <Route path="/configuration/onboarding" element={<pages.checklist.Page key="onboarding" kind="onboarding" />} />
            <Route path="/configuration/offboarding" element={<pages.checklist.Page key="offboarding" kind="offboarding" />} />
            <Route path="/configuration/guides" element={<pages.guides.Page />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
    </>
  )
}

function PreloadNavPages() {
  useEffect(() => preloadWhenIdle(pages.NAV_PAGES), [])
  return null
}
