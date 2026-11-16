-- Training schedules, individual attendance/completion, and immutable change history.
CREATE TABLE public.training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  trainer text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  material_document_id uuid REFERENCES public.organization_documents(id),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE public.training_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.training_sessions(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  employee_name text NOT NULL,
  department text NOT NULL DEFAULT '',
  attendance_status text NOT NULL DEFAULT 'invited' CHECK (attendance_status IN ('invited','attended','absent','excused')),
  completion_status text NOT NULL DEFAULT 'pending' CHECK (completion_status IN ('pending','in_progress','completed')),
  completed_at timestamptz,
  notes text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(session_id,user_id),
  CHECK ((completion_status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (completion_status = 'pending' OR attendance_status = 'attended')
);

CREATE TABLE public.training_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.training_sessions(id),
  user_id uuid REFERENCES public.users(id),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  actor_name text NOT NULL,
  event_type text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX training_sessions_org_start ON public.training_sessions(organization_id,starts_at);
CREATE INDEX training_attendees_user ON public.training_attendees(user_id,session_id);
CREATE INDEX training_events_session ON public.training_events(session_id,created_at);

CREATE FUNCTION public.fn_training_is_admin(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_active IS TRUE
    AND organization_id = p_org AND role IN ('admin','superadmin'));
$$;
CREATE FUNCTION public.fn_training_can_view_session(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM training_sessions s JOIN users u ON u.organization_id = s.organization_id
    WHERE s.id = p_id AND u.auth_id = auth.uid() AND u.is_active IS TRUE
    AND (u.role IN ('admin','superadmin') OR EXISTS (
      SELECT 1 FROM training_attendees a WHERE a.session_id = s.id AND a.user_id = u.id)));
$$;
ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_sessions_read ON public.training_sessions FOR SELECT TO authenticated
  USING (public.fn_training_can_view_session(id));
CREATE POLICY training_attendees_read ON public.training_attendees FOR SELECT TO authenticated USING (
  public.fn_training_can_view_session(session_id) AND (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_id AND u.auth_id = auth.uid() AND u.is_active IS TRUE)
    OR EXISTS (SELECT 1 FROM public.training_sessions s WHERE s.id = session_id AND public.fn_training_is_admin(s.organization_id))
  )
);
CREATE POLICY training_events_read ON public.training_events FOR SELECT TO authenticated USING (
  public.fn_training_can_view_session(session_id) AND (
    user_id IS NULL OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_id AND u.auth_id = auth.uid() AND u.is_active IS TRUE)
    OR EXISTS (SELECT 1 FROM public.training_sessions s WHERE s.id = session_id AND public.fn_training_is_admin(s.organization_id))
  )
);
-- Mutations are only available through the validated, atomic functions below.
REVOKE ALL ON public.training_sessions, public.training_attendees, public.training_events FROM anon, authenticated;
GRANT SELECT ON public.training_sessions, public.training_attendees, public.training_events TO authenticated;

CREATE FUNCTION public.fn_save_training_session(
  p_session jsonb, p_attendee_ids uuid[], p_id uuid DEFAULT NULL, p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_old public.training_sessions%ROWTYPE;
  v_new public.training_sessions%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_removed public.training_attendees%ROWTYPE;
  v_start timestamptz := (p_session->>'starts_at')::timestamptz;
  v_end timestamptz := (p_session->>'ends_at')::timestamptz;
  v_material uuid := NULLIF(p_session->>'material_document_id','')::uuid;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS TRUE;
  IF v_actor.id IS NULL OR v_actor.organization_id IS NULL OR COALESCE(v_actor.role,'') NOT IN ('admin','superadmin') THEN
    RAISE EXCEPTION 'Only active organization admins can manage training';
  END IF;
  IF NULLIF(btrim(p_session->>'title'),'') IS NULL OR length(p_session->>'title') > 200
     OR v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN
    RAISE EXCEPTION 'Provide a title and a valid training date range';
  END IF;
  IF cardinality(p_attendee_ids) IS NULL OR cardinality(p_attendee_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one attendee';
  END IF;
  -- Existing inactive attendees may be retained so historical records remain intact.
  IF EXISTS (SELECT 1 FROM unnest(p_attendee_ids) x(id) LEFT JOIN users u ON u.id = x.id
    WHERE u.id IS NULL OR u.organization_id IS DISTINCT FROM v_actor.organization_id
      OR (u.is_active IS NOT TRUE AND NOT EXISTS (
        SELECT 1 FROM training_attendees a WHERE a.session_id = p_id AND a.user_id = x.id))) THEN
    RAISE EXCEPTION 'Attendees must be active members of your organization';
  END IF;
  IF v_material IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_documents
    WHERE id = v_material AND organization_id = v_actor.organization_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Choose an available document from your organization';
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_old FROM training_sessions WHERE id = p_id AND organization_id = v_actor.organization_id FOR UPDATE;
    IF v_old.id IS NULL THEN RAISE EXCEPTION 'Training session not found in your organization'; END IF;
    IF p_expected_updated_at IS DISTINCT FROM v_old.updated_at THEN
      RAISE EXCEPTION 'This session changed. Refresh before saving';
    END IF;
    IF v_old.status <> 'scheduled' THEN RAISE EXCEPTION 'Only scheduled sessions can be edited'; END IF;
    IF (v_old.starts_at IS DISTINCT FROM v_start OR v_old.ends_at IS DISTINCT FROM v_end)
      AND EXISTS (SELECT 1 FROM training_attendees WHERE session_id = p_id AND (
        attendance_status <> 'invited' OR completion_status <> 'pending')) THEN
      RAISE EXCEPTION 'Dates cannot change after attendance has been recorded';
    END IF;
    IF EXISTS (SELECT 1 FROM training_attendees WHERE session_id = p_id
      AND NOT (user_id = ANY(p_attendee_ids)) AND (attendance_status <> 'invited'
        OR completion_status <> 'pending' OR notes <> '')) THEN
      RAISE EXCEPTION 'Attendees with recorded activity cannot be removed';
    END IF;
    UPDATE training_sessions SET title = btrim(p_session->>'title'), description = COALESCE(p_session->>'description',''),
      trainer = COALESCE(p_session->>'trainer',''), location = COALESCE(p_session->>'location',''),
      starts_at = v_start, ends_at = v_end, material_document_id = v_material, updated_at = clock_timestamp()
      WHERE id = p_id RETURNING * INTO v_new;
  ELSE
    INSERT INTO training_sessions(organization_id,title,description,trainer,location,starts_at,ends_at,material_document_id,created_by)
      VALUES (v_actor.organization_id,btrim(p_session->>'title'),COALESCE(p_session->>'description',''),
        COALESCE(p_session->>'trainer',''),COALESCE(p_session->>'location',''),v_start,v_end,v_material,v_actor.id)
      RETURNING * INTO v_new;
  END IF;
  INSERT INTO training_events(session_id,actor_id,actor_name,event_type,before_value,after_value)
    VALUES(v_new.id,v_actor.id,v_actor.name,CASE WHEN p_id IS NULL THEN 'session_created' ELSE 'session_updated' END,
      CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(v_old) END,to_jsonb(v_new));
  FOR v_removed IN DELETE FROM training_attendees WHERE session_id = v_new.id
    AND NOT (user_id = ANY(p_attendee_ids)) RETURNING * LOOP
    INSERT INTO training_events(session_id,user_id,actor_id,actor_name,event_type,before_value)
      VALUES(v_new.id,v_removed.user_id,v_actor.id,v_actor.name,'attendee_removed',to_jsonb(v_removed));
  END LOOP;
  FOR v_user IN SELECT * FROM users WHERE id = ANY(p_attendee_ids) LOOP
    INSERT INTO training_attendees(session_id,user_id,employee_name,department,updated_by)
      VALUES(v_new.id,v_user.id,v_user.name,COALESCE(v_user.department,''),v_actor.id)
      ON CONFLICT (session_id,user_id) DO NOTHING;
    IF FOUND THEN
      INSERT INTO training_events(session_id,user_id,actor_id,actor_name,event_type,after_value)
        VALUES(v_new.id,v_user.id,v_actor.id,v_actor.name,'attendee_assigned',jsonb_build_object('employee_name',v_user.name));
    END IF;
  END LOOP;
  RETURN v_new.id;
END;
$$;

CREATE FUNCTION public.fn_record_training_attendee(
  p_id uuid, p_attendance text, p_completion text, p_notes text, p_expected_updated_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_session public.training_sessions%ROWTYPE;
  v_old public.training_attendees%ROWTYPE;
  v_new public.training_attendees%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS TRUE;
  IF v_actor.id IS NULL OR COALESCE(v_actor.role,'') NOT IN ('admin','superadmin') THEN
    RAISE EXCEPTION 'Only active organization admins can record training';
  END IF;
  -- Lock session first, consistently with save/close, to serialize concurrent changes.
  SELECT s.* INTO v_session FROM training_sessions s JOIN training_attendees a ON a.session_id = s.id
    WHERE a.id = p_id AND s.organization_id = v_actor.organization_id FOR UPDATE OF s;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Attendee not found in your organization'; END IF;
  SELECT * INTO v_old FROM training_attendees WHERE id = p_id FOR UPDATE;
  IF p_expected_updated_at IS DISTINCT FROM v_old.updated_at THEN
    RAISE EXCEPTION 'This attendee record changed. Refresh before saving';
  END IF;
  IF v_session.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled training cannot be updated'; END IF;
  IF v_session.starts_at > now() THEN RAISE EXCEPTION 'Attendance can be recorded once training starts'; END IF;
  IF p_attendance IS NULL OR p_attendance NOT IN ('invited','attended','absent','excused')
    OR p_completion IS NULL OR p_completion NOT IN ('pending','in_progress','completed') THEN
    RAISE EXCEPTION 'Invalid attendance or completion status';
  END IF;
  IF p_completion <> 'pending' AND p_attendance <> 'attended' THEN
    RAISE EXCEPTION 'Mark the attendee as attended before recording progress or completion';
  END IF;
  IF v_session.status = 'completed' AND p_attendance = 'invited' THEN
    RAISE EXCEPTION 'Closed sessions must retain a recorded attendance status';
  END IF;
  UPDATE training_attendees SET attendance_status = p_attendance, completion_status = p_completion,
    notes = COALESCE(p_notes,''), updated_by = v_actor.id, updated_at = clock_timestamp(),
    completed_at = CASE WHEN p_completion = 'completed' THEN COALESCE(v_old.completed_at,now()) ELSE NULL END
    WHERE id = p_id RETURNING * INTO v_new;
  INSERT INTO training_events(session_id,user_id,actor_id,actor_name,event_type,before_value,after_value)
    VALUES(v_session.id,v_old.user_id,v_actor.id,v_actor.name,'attendee_updated',to_jsonb(v_old),to_jsonb(v_new));
END;
$$;

CREATE FUNCTION public.fn_set_training_session_status(p_id uuid, p_status text, p_expected_updated_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_old public.training_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS TRUE;
  IF v_actor.id IS NULL OR COALESCE(v_actor.role,'') NOT IN ('admin','superadmin') THEN
    RAISE EXCEPTION 'Only active organization admins can manage training';
  END IF;
  SELECT * INTO v_old FROM training_sessions WHERE id = p_id AND organization_id = v_actor.organization_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Training session not found in your organization'; END IF;
  IF p_expected_updated_at IS DISTINCT FROM v_old.updated_at THEN
    RAISE EXCEPTION 'This session changed. Refresh before saving';
  END IF;
  IF v_old.status <> 'scheduled' OR p_status IS NULL OR p_status NOT IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'Only scheduled training can be closed or cancelled';
  END IF;
  IF p_status = 'completed' AND (v_old.ends_at > now() OR EXISTS (
    SELECT 1 FROM training_attendees WHERE session_id = p_id AND attendance_status = 'invited')) THEN
    RAISE EXCEPTION 'Wait until training ends and record attendance for every attendee before closing';
  END IF;
  IF p_status = 'cancelled' AND EXISTS (SELECT 1 FROM training_attendees WHERE session_id = p_id
    AND (attendance_status <> 'invited' OR completion_status <> 'pending')) THEN
    RAISE EXCEPTION 'Training with attendance records cannot be cancelled';
  END IF;
  UPDATE training_sessions SET status = p_status, updated_at = clock_timestamp() WHERE id = p_id;
  INSERT INTO training_events(session_id,actor_id,actor_name,event_type,before_value,after_value)
    VALUES(p_id,v_actor.id,v_actor.name,'session_status_changed',jsonb_build_object('status',v_old.status),jsonb_build_object('status',p_status));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_training_is_admin(uuid), public.fn_training_can_view_session(uuid),
  public.fn_save_training_session(jsonb,uuid[],uuid,timestamptz),
  public.fn_record_training_attendee(uuid,text,text,text,timestamptz),
  public.fn_set_training_session_status(uuid,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_training_is_admin(uuid), public.fn_training_can_view_session(uuid),
  public.fn_save_training_session(jsonb,uuid[],uuid,timestamptz),
  public.fn_record_training_attendee(uuid,text,text,text,timestamptz),
  public.fn_set_training_session_status(uuid,text,timestamptz) TO authenticated;
