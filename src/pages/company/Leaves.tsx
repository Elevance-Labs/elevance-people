import { useSearchParams } from 'react-router-dom'
import { Box, Tab, Tabs } from '@mui/material'
import { PageHeader } from '../../components/common'
import LeaveTypes from './LeaveTypes'
import LeaveQuotas from './LeaveQuotas'

// Company → Leaves (HR): leave types and per-person quotas, one tab each.
// The tab lives in the URL (?tab=quotas) so it can be linked to.
export default function Leaves() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'quotas' ? 'quotas' : 'types'

  return (
    <>
      <PageHeader title="Leaves" subtitle="The leave types people can apply for, and how many days each person gets." />
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={tab}
          onChange={(_e, value: string) => setParams(value === 'types' ? {} : { tab: value }, { replace: true })}
        >
          <Tab value="types" label="Types" />
          <Tab value="quotas" label="Quotas" />
        </Tabs>
      </Box>
      {tab === 'types' ? <LeaveTypes /> : <LeaveQuotas />}
    </>
  )
}
