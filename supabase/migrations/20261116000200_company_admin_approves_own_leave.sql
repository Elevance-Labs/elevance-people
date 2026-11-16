-- Leaves: a company admin may approve their own leave.
--
-- Nobody decided their own leave, which left a company admin's leave
-- waiting on someone else even at the top of the company. leave_decide now
-- lets a company admin approve their own pending leave, as HR and as
-- manager at once, so it is granted. Rejecting their own leave stays
-- refused (they cancel it instead), as does changing its dates; HR admins
-- and everyone else still can't decide their own. Appraisals keep the rule.

create or replace function public.leave_decide(p_leave_id uuid, p_approve boolean, p_reason text default null)
returns public.leaves language plpgsql security definer set search_path = '' as $$
declare
  v_me         uuid := public.current_employee_id();
  v_as_hr      boolean := public.is_hr();
  v_as_manager boolean;
  v_leave      public.leaves;
begin
  select * into v_leave from public.leaves where id = p_leave_id for update;
  if not found or v_me is null then
    raise exception 'Leave not found.' using errcode = 'P0002';
  end if;
  v_as_manager := public.is_manager_of(v_leave.employee_id);
  if not (v_as_hr or v_as_manager or v_leave.employee_id = v_me) then
    raise exception 'Leave not found.' using errcode = 'P0002';
  end if;
  if v_leave.employee_id = v_me then
    if not (p_approve and public.is_company_admin()) then
      raise exception 'You cannot approve or reject your own leave.' using errcode = '42501';
    end if;
    v_as_manager := true;
  end if;
  if v_leave.status <> 'pending' then
    raise exception 'This leave is already %.', v_leave.status;
  end if;

  if p_approve then
    update public.leaves
       set hr_approved_by      = case when v_as_hr and hr_approved_by is null
                                      then v_me else hr_approved_by end,
           hr_approved_at      = case when v_as_hr and hr_approved_by is null
                                      then now() else hr_approved_at end,
           manager_approved_by = case when v_as_manager and manager_approved_by is null
                                      then v_me else manager_approved_by end,
           manager_approved_at = case when v_as_manager and manager_approved_by is null
                                      then now() else manager_approved_at end
     where id = p_leave_id
    returning * into v_leave;
  else
    update public.leaves
       set status = 'rejected', rejected_by = v_me, rejected_at = now(),
           rejection_reason = nullif(trim(p_reason), '')
     where id = p_leave_id
    returning * into v_leave;
  end if;
  return v_leave;
end;
$$;
