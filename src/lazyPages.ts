// The app's pages loaded when first shown (App's routes). Home comes with the
// shell; every other page is its own chunk.
import { lazyPage } from './components/lazyPage'

export const employees = lazyPage(() => import('./pages/Employees'))
export const appraisals = lazyPage(() => import('./pages/Appraisals'))
export const employeeForm = lazyPage(() => import('./pages/EmployeeForm'))
export const orgChart = lazyPage(() => import('./pages/OrgChart'))
export const departments = lazyPage(() => import('./pages/company/Departments'))
export const designations = lazyPage(() => import('./pages/company/Designations'))
export const kpis = lazyPage(() => import('./pages/company/Kpis'))
export const expectations = lazyPage(() => import('./pages/company/Expectations'))
export const myLeaves = lazyPage(() => import('./pages/leaves/MyLeaves'))
export const leaveRequests = lazyPage(() => import('./pages/leaves/LeaveRequests'))
export const companyLeaves = lazyPage(() => import('./pages/company/Leaves'))
export const holidays = lazyPage(() => import('./pages/company/Holidays'))
export const branding = lazyPage(() => import('./pages/company/Branding'))
export const jobOpenings = lazyPage(() => import('./pages/hiring/JobOpenings'))
export const applications = lazyPage(() => import('./pages/hiring/Applications'))
export const jobPosting = lazyPage(() => import('./pages/public/JobPosting'))
export const jobPostings = lazyPage(() => import('./pages/public/JobPostings'))
export const onboarding = lazyPage(() => import('./pages/hr/Onboarding'))
export const onboardingDetail = lazyPage(() => import('./pages/hr/OnboardingDetail'))
export const offboarding = lazyPage(() => import('./pages/hr/Offboarding'))
export const offboardingDetail = lazyPage(() => import('./pages/hr/OffboardingDetail'))
export const checklist = lazyPage(() => import('./pages/configuration/Checklist'))
export const handbook = lazyPage(() => import('./pages/home/Handbook'))
export const resources = lazyPage(() => import('./pages/home/Resources'))
export const guidePage = lazyPage(() => import('./pages/home/GuidePage'))
export const profile = lazyPage(() => import('./pages/home/Profile'))
export const payrolls = lazyPage(() => import('./pages/finance/Payrolls'))
export const payrollDetail = lazyPage(() => import('./pages/finance/PayrollDetail'))
export const reimbursements = lazyPage(() => import('./pages/finance/Reimbursements'))
export const myReimbursements = lazyPage(() => import('./pages/finance/MyReimbursements'))
export const equipmentList = lazyPage(() => import('./pages/operations/Equipment'))
export const equipmentForm = lazyPage(() => import('./pages/operations/EquipmentForm'))
export const vendors = lazyPage(() => import('./pages/configuration/Vendors'))
export const guides = lazyPage(() => import('./pages/configuration/Guides'))
export const performance = lazyPage(() => import('./pages/performance/Performance'))
export const performanceReview = lazyPage(() => import('./pages/performance/Review'))
export const performancePerson = lazyPage(() => import('./pages/performance/Person'))
export const peerReview = lazyPage(() => import('./pages/performance/PeerReview'))
export const peerCycle = lazyPage(() => import('./pages/performance/PeerCycle'))
export const managerFeedbackForm = lazyPage(() => import('./pages/performance/ManagerFeedbackForm'))
export const jobOpeningForm = lazyPage(() => import('./pages/hiring/JobOpeningForm'))
export const announcements = lazyPage(() => import('./pages/company/Announcements'))

// Every employee's own pages: parsed once the first screen is up, so a tap is instant.
export const NAV_PAGES = [handbook, resources, profile, myLeaves, orgChart, performance]

/** Every lazy page, loaded now (tests, so nothing suspends mid-check). */
export const preloadAllPages = () => Promise.all([
  employees, appraisals, employeeForm, orgChart, departments, designations, kpis, expectations, myLeaves,
  leaveRequests, companyLeaves, holidays, branding, jobOpenings, applications, jobPosting, jobPostings,
  onboarding, onboardingDetail, offboarding, offboardingDetail, checklist, handbook, resources, guidePage,
  profile, payrolls, payrollDetail, reimbursements, myReimbursements, equipmentList, equipmentForm, vendors,
  guides, performance, performanceReview, performancePerson, peerReview, peerCycle, managerFeedbackForm,
  jobOpeningForm, announcements,
].map((p) => p.preload()))
