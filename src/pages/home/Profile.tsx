import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useAuth } from "../../auth/AuthProvider";
import {
  FormDialog,
  PageHeader,
  PersonAvatar,
  StatusChip,
} from "../../components/common";
import { supabase } from "../../lib/supabase";
import {
  EMPLOYMENT_TYPE_LABELS,
  formatDate,
  formatEmployeeNumber,
} from "../../lib/constants";
import {
  EQUIPMENT_DESCRIPTION_MAX,
  equipmentRequestError,
  oneLine,
} from "../../lib/equipment";
import type {
  Employee,
  MyEquipment,
  MyEquipmentRequest,
} from "../../lib/types";
import Payslips from "./Payslips";
import Salary from "./Salary";

// Everyone's own record, read-only: changes go through HR. Members read their
// own row by RLS, their equipment through my_equipment (and ask for more
// through equipment_request, their waiting requests through
// my_equipment_requests) and their disbursed
// payroll lines through my_payslips and their approved salaries through
// my_salaries.
// The tab lives in the URL (?tab=salary) so it can be linked to.
const TABS = [
  { value: "profile", label: "Profile" },
  { value: "equipment", label: "Equipment" },
  { value: "salary", label: "Salary" },
  { value: "payslips", label: "Payslips" },
];

const COLUMNS =
  "id, employee_number, full_name, company_email, date_of_joining, probation_end_date, date_of_separation, personal_email, phone, " +
  "cnic_number, cnic_expiry, dob, bank, iban, emergency_contact, employment_type, status, " +
  "department:departments!employees_department_id_fkey(name), designation:designations!employees_designation_fkey(title)";

type OwnRecord = Omit<
  Employee,
  | "user_id"
  | "department_id"
  | "designation_id"
  | "app_role"
  | "created_at"
  | "updated_at"
> & {
  department: { name: string } | null;
  designation: { title: string } | null;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" component="section" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography
        variant="subtitle1"
        component="h2"
        sx={{ fontWeight: 600, mb: 2.5 }}
      >
        {title}
      </Typography>
      <Grid container spacing={2.5} component="dl" sx={{ m: 0 }}>
        {children}
      </Grid>
    </Paper>
  );
}

function Detail({
  label,
  value,
  wide,
}: {
  label: string;
  value: string | null | undefined;
  wide?: boolean;
}) {
  return (
    <Grid size={wide ? 12 : { xs: 12, sm: 6, md: 4 }}>
      <Typography
        component="dt"
        variant="body2"
        sx={{ color: "text.secondary" }}
      >
        {label}
      </Typography>
      <Typography
        component="dd"
        sx={{ m: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {value || "—"}
      </Typography>
    </Grid>
  );
}

function ProfileDetails({ record }: { record: OwnRecord }) {
  return (
    <Stack spacing={3}>
      <Alert severity="info" variant="outlined">
        This is what HR has on record for you. If anything is wrong or out of
        date, ask HR to update it.
      </Alert>
      <Section title="Employment">
        <Detail
          label="Employee number"
          value={formatEmployeeNumber(record.employee_number)}
        />
        <Detail label="Company email" value={record.company_email} />
        <Detail label="Department" value={record.department?.name} />
        <Detail label="Designation" value={record.designation?.title} />
        <Detail
          label="Employment type"
          value={EMPLOYMENT_TYPE_LABELS[record.employment_type]}
        />
        <Detail
          label="Date of joining"
          value={formatDate(record.date_of_joining)}
        />
        {record.probation_end_date && (
          <Detail
            label="Probation end date"
            value={formatDate(record.probation_end_date)}
          />
        )}
        {record.date_of_separation && (
          <Detail
            label="Date of separation"
            value={formatDate(record.date_of_separation)}
          />
        )}
      </Section>
      <Section title="Personal">
        <Detail label="Personal email" value={record.personal_email} />
        <Detail label="Phone number" value={record.phone} />
        <Detail label="Date of birth" value={formatDate(record.dob)} />
        <Detail label="CNIC number" value={record.cnic_number} />
        <Detail label="CNIC expiry" value={formatDate(record.cnic_expiry)} />
        <Detail
          label="Emergency contact"
          value={record.emergency_contact}
          wide
        />
      </Section>
      <Section title="Bank">
        <Detail label="Bank" value={record.bank} />
        <Detail label="IBAN" value={record.iban} />
      </Section>
    </Stack>
  );
}

// What they have (identifier, description and date: all my_equipment
// returns), their requests still waiting, and asking for something new.
function EquipmentTab() {
  const [rows, setRows] = useState<MyEquipment[] | null>(null);
  const [requests, setRequests] = useState<MyEquipmentRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The new request's description while the dialog is open.
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([
        supabase.rpc("my_equipment"),
        supabase.rpc("my_equipment_requests"),
      ]).then(([equipmentRes, requestsRes]) => {
        const loadError = equipmentRes.error ?? requestsRes.error;
        if (loadError) setError(loadError.message);
        else {
          setRows(equipmentRes.data as MyEquipment[]);
          setRequests(requestsRes.data as MyEquipmentRequest[]);
        }
      }),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function request() {
    const description = (asking ?? "").trim();
    if (!description) return setDialogError("Describe what you need.");
    setBusy(true);
    setDialogError(null);
    const { error: rpcError } = await supabase.rpc("equipment_request", {
      p_description: description,
    });
    setBusy(false);
    if (rpcError) return setDialogError(equipmentRequestError(rpcError));
    setAsking(null);
    setSent(true);
    load();
  }

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!rows) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  return (
    <Stack spacing={3}>
      {rows.length ? (
        <Paper variant="outlined" sx={{ overflow: "hidden" }}>
          <TableContainer>
            <Table aria-label="Your equipment">
              <TableHead>
                <TableRow>
                  <TableCell>Identifier</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Assigned on</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.identifier}
                    sx={{ "&:last-child td": { borderBottom: 0 } }}
                  >
                    <TableCell sx={{ fontFamily: "monospace" }}>
                      {r.identifier}
                    </TableCell>
                    <TableCell sx={{ overflowWrap: "anywhere" }}>
                      {r.description}
                    </TableCell>
                    <TableCell>{formatDate(r.assigned_on)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ py: 8, px: 2, textAlign: "center" }}>
          <Typography sx={{ color: "text.secondary" }}>
            No equipment is assigned to you.
          </Typography>
        </Paper>
      )}
      <Paper variant="outlined" component="section" sx={{ overflow: "hidden" }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
            p: 2,
          }}
        >
          <Box>
            <Typography
              variant="subtitle1"
              component="h2"
              sx={{ fontWeight: 600 }}
            >
              Your requests
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Need something for your work? Ask for it here; HR will follow up.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setDialogError(null);
              setSent(false);
              setAsking("");
            }}
            sx={{ flexShrink: 0 }}
          >
            Request equipment
          </Button>
        </Stack>
        {sent && (
          <Alert
            severity="success"
            onClose={() => setSent(false)}
            sx={{ mx: 2, mb: 2 }}
          >
            Your request has been sent.
          </Alert>
        )}
        {requests.length > 0 && (
          <TableContainer>
            <Table aria-label="Your requests">
              <TableHead>
                <TableRow>
                  <TableCell>Description</TableCell>
                  <TableCell>Requested on</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {requests.map((r) => (
                  <TableRow
                    key={r.id}
                    sx={{ "&:last-child td": { borderBottom: 0 } }}
                  >
                    <TableCell sx={{ overflowWrap: "anywhere" }}>
                      {r.description}
                    </TableCell>
                    <TableCell>{formatDate(r.request_date)}</TableCell>
                    <TableCell>
                      <Chip
                        label="Waiting"
                        color="info"
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
      <FormDialog
        open={asking !== null}
        title="Request equipment"
        submitLabel="Send request"
        error={dialogError}
        busy={busy}
        onSubmit={request}
        onClose={() => setAsking(null)}
      >
        <TextField
          label="What do you need?"
          required
          fullWidth
          autoFocus
          value={asking ?? ""}
          onChange={(e) => setAsking(oneLine(e.target.value))}
          placeholder="e.g. Name of the device or equipment, or a description of what you need"
          slotProps={{ htmlInput: { maxLength: EQUIPMENT_DESCRIPTION_MAX } }}
          helperText={`${(asking ?? "").length}/${EQUIPMENT_DESCRIPTION_MAX}`}
        />
      </FormDialog>
    </Stack>
  );
}

export default function Profile() {
  const { employee } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.value === params.get("tab")) ?? TABS[0];
  const [record, setRecord] = useState<OwnRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const employeeId = employee?.id;

  // Read fresh rather than from sign-in, so HR's edits show without signing in again.
  useEffect(() => {
    if (!employeeId) return;
    supabase
      .from("employees")
      .select(COLUMNS)
      .eq("id", employeeId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message);
        else if (!data)
          setError("Your employee record could not be found. Contact HR.");
        else setRecord(data as unknown as OwnRecord);
      });
  }, [employeeId]);

  if (!employee) return null;

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <PageHeader
        title={
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center" }}
            component="span"
          >
            <PersonAvatar name={employee.full_name} size={40} />
            <Stack>
              <Typography variant="h5" component="h1">
                {employee.full_name}
              </Typography>
              <Typography variant="body2">
                {record &&
                  [
                    formatEmployeeNumber(record.employee_number),
                    record.designation?.title,
                    record.department?.name,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
              </Typography>
            </Stack>
          </Stack>
        }
        actions={record && <StatusChip status={record.status} size="medium" />}
      />
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        <Tabs
          value={tab.value}
          onChange={(_e, value: string) =>
            setParams(value === "profile" ? {} : { tab: value }, {
              replace: true,
            })
          }
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {TABS.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </Tabs>
      </Box>
      {tab.value === "equipment" ? (
        <EquipmentTab />
      ) : tab.value === "salary" ? (
        <Salary />
      ) : tab.value === "payslips" ? (
        <Payslips
          person={{
            designation: record?.designation?.title ?? null,
            department: record?.department?.name ?? null,
          }}
        />
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : record ? (
        <ProfileDetails record={record} />
      ) : (
        <Box sx={{ display: "grid", placeItems: "center", py: 10 }}>
          <CircularProgress />
        </Box>
      )}
    </Box>
  );
}
