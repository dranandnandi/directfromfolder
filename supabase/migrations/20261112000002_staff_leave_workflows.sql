-- Keep existing app/WhatsApp task-based requests compatible while giving leave
-- dates, cancellations and decisions an authoritative database contract.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS leave_start_date date,
  ADD COLUMN IF NOT EXISTS leave_end_date date,
  ADD COLUMN IF NOT EXISTS leave_kind text,
  ADD COLUMN IF NOT EXISTS leave_category text,
  ADD COLUMN IF NOT EXISTS leave_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS leave_cancelled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS leave_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS leave_decided_by uuid REFERENCES public.users(id);

CREATE FUNCTION public.fn_staff_description_field(p_description text, p_label text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT NULLIF(btrim((regexp_match(COALESCE(p_description, ''), '^' || p_label || ':[ \t]*([^\r\n]*)', 'm'))[1]), '');
$$;
CREATE FUNCTION public.fn_staff_leave_date(p_value text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_value IS NULL OR p_value !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  RETURN p_value::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END;
$$;
CREATE FUNCTION public.fn_staff_leave_status(p_status text, p_cancelled_at timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN lower(p_status) = 'completed' THEN 'approved'
    WHEN lower(p_status) IN ('cancelled', 'rejected') THEN 'rejected' ELSE 'pending' END;
$$;

UPDATE public.tasks SET
  leave_start_date = fn_staff_leave_date(fn_staff_description_field(description, 'Start Date')),
  leave_end_date = COALESCE(fn_staff_leave_date(fn_staff_description_field(description, 'End Date')),
    fn_staff_leave_date(fn_staff_description_field(description, 'Start Date'))),
  leave_kind = lower(replace(COALESCE(fn_staff_description_field(description, 'Leave Type'), 'full_day'), ' ', '_')),
  leave_category = fn_staff_description_field(description, 'Leave Category')
WHERE type = 'personalTask' AND (description ILIKE '%LEAVE REQUEST DETAILS%' OR title ILIKE '%Leave Request%');
UPDATE public.tasks SET leave_end_date = leave_start_date WHERE leave_start_date IS NOT NULL AND leave_kind IN ('half_day', 'early_departure');
CREATE INDEX tasks_staff_leave_dates ON public.tasks(organization_id, created_by, leave_start_date, leave_end_date)
  WHERE leave_start_date IS NOT NULL;

CREATE FUNCTION public.fn_guard_staff_leave()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor users%ROWTYPE;
  v_owner users%ROWTYPE;
  v_old_status text;
  v_status text;
  v_changed boolean;
  v_service boolean := COALESCE(auth.role(), '') = 'service_role' OR (auth.role() IS NULL AND auth.uid() IS NULL);
BEGIN
  IF NEW.type <> 'personalTask' OR NOT (NEW.description ILIKE '%LEAVE REQUEST DETAILS%' OR NEW.title ILIKE '%Leave Request%') THEN
    IF TG_OP = 'UPDATE' AND OLD.leave_start_date IS NOT NULL THEN
      RAISE EXCEPTION 'Leave requests must retain their request details. Cancel the request instead.';
    END IF;
    NEW.leave_start_date := NULL; NEW.leave_end_date := NULL; NEW.leave_kind := NULL; NEW.leave_category := NULL;
    RETURN NEW;
  END IF;
  NEW.leave_start_date := fn_staff_leave_date(fn_staff_description_field(NEW.description, 'Start Date'));
  NEW.leave_kind := lower(replace(COALESCE(fn_staff_description_field(NEW.description, 'Leave Type'), 'full_day'), ' ', '_'));
  NEW.leave_end_date := CASE WHEN NEW.leave_kind = 'full_day'
    THEN COALESCE(fn_staff_leave_date(fn_staff_description_field(NEW.description, 'End Date')), NEW.leave_start_date)
    ELSE NEW.leave_start_date END;
  NEW.leave_category := fn_staff_description_field(NEW.description, 'Leave Category');
  IF NEW.leave_start_date IS NULL OR NEW.leave_end_date < NEW.leave_start_date
      OR NEW.leave_end_date > NEW.leave_start_date + 366
      OR NEW.leave_kind NOT IN ('full_day', 'half_day', 'early_departure') THEN
    RAISE EXCEPTION 'Provide a valid leave date range of at most one year and a supported duration.';
  END IF;
  -- Serialize requests for the same employee, including app and WhatsApp inserts.
  SELECT * INTO v_owner FROM users WHERE id = NEW.created_by AND is_active IS DISTINCT FROM false FOR UPDATE;
  IF v_owner.id IS NULL OR v_owner.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'The leave request must belong to an active employee in this organization.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS DISTINCT FROM false;
  IF NOT v_service AND (v_actor.id IS NULL OR v_actor.organization_id IS DISTINCT FROM NEW.organization_id) THEN
    RAISE EXCEPTION 'You cannot change leave for this organization.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_service AND v_actor.id <> NEW.created_by AND COALESCE(v_actor.role, '') NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'You can only change your own leave request.' USING ERRCODE = '42501';
  END IF;
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.assigned_to
      AND organization_id = NEW.organization_id AND is_active IS DISTINCT FROM false AND role IN ('admin', 'superadmin')) THEN
    RAISE EXCEPTION 'Leave must be assigned to an active admin in the employee organization.';
  END IF;
  v_status := fn_staff_leave_status(NEW.status, NEW.leave_cancelled_at);
  IF TG_OP = 'UPDATE' THEN
    v_old_status := fn_staff_leave_status(OLD.status, OLD.leave_cancelled_at);
    IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.leave_start_date IS DISTINCT FROM OLD.leave_start_date OR NEW.leave_end_date IS DISTINCT FROM OLD.leave_end_date
        OR NEW.leave_kind IS DISTINCT FROM OLD.leave_kind OR NEW.leave_category IS DISTINCT FROM OLD.leave_category THEN
      RAISE EXCEPTION 'Submitted leave dates and employee cannot be changed. Cancel and submit a new request.';
    END IF;
    v_changed := v_status IS DISTINCT FROM v_old_status;
    IF NOT v_service AND NOT v_changed AND (NEW.leave_cancelled_at IS DISTINCT FROM OLD.leave_cancelled_at
        OR NEW.leave_cancelled_by IS DISTINCT FROM OLD.leave_cancelled_by OR NEW.leave_decided_at IS DISTINCT FROM OLD.leave_decided_at
        OR NEW.leave_decided_by IS DISTINCT FROM OLD.leave_decided_by) THEN
      RAISE EXCEPTION 'Decision history cannot be edited independently of a leave decision.';
    END IF;
    IF v_changed AND v_old_status IN ('rejected', 'cancelled') THEN RAISE EXCEPTION 'This leave request is already closed.'; END IF;
    IF v_changed AND v_status NOT IN ('approved', 'rejected', 'cancelled') THEN RAISE EXCEPTION 'A decided request cannot be made pending again.'; END IF;
  ELSE
    v_changed := true;
    IF v_status <> 'pending' THEN RAISE EXCEPTION 'New leave requests must start pending.'; END IF;
    IF NOT v_service AND NEW.created_by <> v_actor.id THEN RAISE EXCEPTION 'Submit leave from your own employee account.' USING ERRCODE = '42501'; END IF;
  END IF;
  IF v_changed AND v_status = 'cancelled' THEN
    IF NOT v_service AND (NEW.created_by <> v_actor.id OR NEW.leave_cancelled_by IS DISTINCT FROM v_actor.id) THEN
      RAISE EXCEPTION 'Only the employee can cancel their own leave request.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_service THEN NEW.leave_decided_by := v_actor.id; NEW.leave_decided_at := now(); END IF;
    IF v_old_status = 'approved' AND NEW.leave_start_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
      RAISE EXCEPTION 'Leave that has already started cannot be cancelled. Contact HR to correct the record.';
    END IF;
  ELSIF v_changed AND v_status IN ('approved', 'rejected') AND NOT v_service THEN
    IF COALESCE(v_actor.role, '') NOT IN ('admin', 'superadmin') OR NEW.created_by = v_actor.id THEN
      RAISE EXCEPTION 'Another organization admin must decide this leave request.' USING ERRCODE = '42501';
    END IF;
    NEW.leave_decided_by := v_actor.id;
    NEW.leave_decided_at := now();
  END IF;
  IF v_changed THEN
    PERFORM 1 FROM payroll_periods WHERE organization_id = NEW.organization_id
      AND make_date(year::int, month::int, 1) BETWEEN date_trunc('month', NEW.leave_start_date)::date AND date_trunc('month', NEW.leave_end_date)::date FOR UPDATE;
    IF EXISTS (SELECT 1 FROM payroll_periods WHERE organization_id = NEW.organization_id AND status <> 'draft'
        AND make_date(year::int, month::int, 1) BETWEEN date_trunc('month', NEW.leave_start_date)::date AND date_trunc('month', NEW.leave_end_date)::date) THEN
      RAISE EXCEPTION 'Payroll is locked for part of this leave. Ask payroll admin to reopen the period first.';
    END IF;
    IF v_status IN ('pending', 'approved') AND EXISTS (
      SELECT 1 FROM tasks t WHERE t.id IS DISTINCT FROM NEW.id AND t.organization_id = NEW.organization_id AND t.created_by = NEW.created_by
        AND t.leave_start_date <= NEW.leave_end_date AND t.leave_end_date >= NEW.leave_start_date
        AND fn_staff_leave_status(t.status, t.leave_cancelled_at) IN ('pending', 'approved')
    ) THEN RAISE EXCEPTION 'These dates overlap an existing pending or approved leave request. Cancel the earlier request or choose different dates.'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_staff_leave BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.fn_guard_staff_leave();

CREATE FUNCTION public.fn_decide_staff_leave(p_id uuid, p_action text, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor users%ROWTYPE;
  v_task tasks%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS DISTINCT FROM false;
  SELECT * INTO v_task FROM tasks WHERE id = p_id FOR UPDATE;
  IF v_actor.id IS NULL OR v_task.leave_start_date IS NULL OR v_actor.organization_id IS DISTINCT FROM v_task.organization_id THEN
    RAISE EXCEPTION 'Leave request not found in your organization.' USING ERRCODE = '42501';
  END IF;
  v_status := fn_staff_leave_status(v_task.status, v_task.leave_cancelled_at);
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject', 'cancel') THEN RAISE EXCEPTION 'Choose approve, reject or cancel.'; END IF;
  IF length(COALESCE(p_note, '')) > 2000 THEN RAISE EXCEPTION 'Keep notes within 2000 characters.'; END IF;
  IF p_action = 'cancel' THEN
    IF v_actor.id <> v_task.created_by OR v_status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'You can only cancel your own active leave request.' USING ERRCODE = '42501'; END IF;
  ELSE
    IF COALESCE(v_actor.role, '') NOT IN ('admin', 'superadmin') OR v_task.created_by = v_actor.id THEN RAISE EXCEPTION 'Another organization admin must decide this request.' USING ERRCODE = '42501'; END IF;
    IF v_status <> 'pending' THEN RAISE EXCEPTION 'This leave request has already been decided.'; END IF;
    IF p_action = 'reject' AND length(btrim(COALESCE(p_note, ''))) < 3 THEN RAISE EXCEPTION 'Give a reason for rejecting the request.'; END IF;
  END IF;
  UPDATE tasks SET
    status = CASE WHEN p_action = 'approve' THEN 'completed' ELSE 'cancelled' END,
    completed_at = CASE WHEN p_action = 'approve' THEN now() ELSE NULL END,
    leave_cancelled_at = CASE WHEN p_action = 'cancel' THEN now() ELSE NULL END,
    leave_cancelled_by = CASE WHEN p_action = 'cancel' THEN v_actor.id ELSE NULL END,
    leave_decided_at = now(), leave_decided_by = v_actor.id, updated_at = now(),
    description = description || E'\n\n---\nDECISION: ' || CASE p_action WHEN 'approve' THEN 'APPROVED' WHEN 'reject' THEN 'REJECTED' ELSE 'CANCELLED' END
      || E'\nDecided By: ' || v_actor.name || E'\nDecided At: ' || now()::text || E'\nDecision Note: ' || COALESCE(NULLIF(btrim(p_note), ''), 'Request ' || p_action || 'd')
    WHERE id = p_id;
  DELETE FROM notifications WHERE task_id = p_id AND type = 'task_due' AND scheduled_for > now();
  INSERT INTO notifications(user_id, task_id, type, title, message)
    VALUES(CASE WHEN p_action = 'cancel' THEN COALESCE(v_task.assigned_to, v_actor.id) ELSE v_task.created_by END,
      p_id, 'task_updated', 'Leave request ' || CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'cancelled' END,
      v_actor.name || ' updated leave for ' || v_task.leave_start_date::text || ' to ' || v_task.leave_end_date::text || CASE WHEN NULLIF(btrim(p_note), '') IS NOT NULL THEN '. ' || btrim(p_note) ELSE '' END);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_decide_staff_leave(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_decide_staff_leave(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_staff_leave() FROM PUBLIC, anon, authenticated;
