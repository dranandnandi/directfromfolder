-- Organization-scoped delegation. Base user roles and full-admin helpers stay unchanged.
CREATE TABLE public.staff_access_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  code text,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  permissions text[] NOT NULL CHECK (permissions <@ ARRAY['training.manage','training_materials.manage','attendance.approve','leave.approve']::text[]),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(organization_id,code)
);
CREATE UNIQUE INDEX staff_access_group_name ON public.staff_access_groups(organization_id,lower(name));
CREATE TABLE public.staff_access_members (
  group_id uuid NOT NULL REFERENCES public.staff_access_groups(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  PRIMARY KEY(group_id,user_id)
);
CREATE INDEX staff_access_member_user ON public.staff_access_members(user_id);
CREATE TABLE public.staff_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  group_id uuid NOT NULL REFERENCES public.staff_access_groups(id),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  actor_name text NOT NULL,
  before_value jsonb,
  after_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX staff_access_events_org ON public.staff_access_events(organization_id,created_at);

CREATE FUNCTION public.fn_staff_full_admin(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM users WHERE auth_id=auth.uid() AND organization_id=p_org
    AND is_active IS TRUE AND role IN ('admin','superadmin'));
$$;
-- This helper accepts an explicit actor only for trusted backend callers.
CREATE FUNCTION public.fn_staff_user_has_permission(p_user uuid,p_org uuid,p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_permission = ANY(ARRAY['training.manage','training_materials.manage','attendance.approve','leave.approve'])
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=p_user AND u.organization_id=p_org AND u.is_active IS TRUE
      AND (u.role IN ('admin','superadmin') OR EXISTS(
        SELECT 1 FROM staff_access_members m JOIN staff_access_groups g ON g.id=m.group_id
        WHERE m.user_id=u.id AND g.organization_id=p_org AND g.enabled AND p_permission=ANY(g.permissions))));
$$;
CREATE FUNCTION public.fn_has_staff_permission(p_permission text,p_org uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT fn_staff_user_has_permission(u.id,COALESCE(p_org,u.organization_id),p_permission)
    FROM users u WHERE u.auth_id=auth.uid() AND u.is_active IS TRUE),false);
$$;
CREATE FUNCTION public.fn_my_staff_access() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id=auth.uid() AND is_active IS TRUE;
  IF v_actor.id IS NULL OR v_actor.organization_id IS NULL THEN RAISE EXCEPTION 'Active organization membership required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('user_id',v_actor.id,'organization_id',v_actor.organization_id,
    'full_admin',v_actor.role IN ('admin','superadmin'),
    'permissions',COALESCE((SELECT jsonb_agg(p) FROM unnest(ARRAY['training.manage','training_materials.manage','attendance.approve','leave.approve']) p
      WHERE fn_staff_user_has_permission(v_actor.id,v_actor.organization_id,p)),'[]'::jsonb),
    'groups',COALESCE((SELECT jsonb_agg(g.name ORDER BY g.name) FROM staff_access_members m JOIN staff_access_groups g ON g.id=m.group_id
      WHERE m.user_id=v_actor.id AND g.organization_id=v_actor.organization_id AND g.enabled),'[]'::jsonb));
END;
$$;

-- Existing self-profile update policies must never allow users to promote their base role.
CREATE FUNCTION public.fn_guard_staff_identity_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
    AND NEW.auth_id IS NOT DISTINCT FROM OLD.auth_id AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN RETURN NEW; END IF;
  IF COALESCE(auth.role(),'')='service_role' OR (auth.uid() IS NULL AND auth.role() IS NULL) THEN RETURN NEW; END IF;
  IF NOT fn_staff_full_admin(OLD.organization_id) THEN
    RAISE EXCEPTION 'Only full admins can change account access fields' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_staff_identity_access BEFORE UPDATE OF role,organization_id,auth_id,is_active ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_staff_identity_access();
REVOKE ALL ON FUNCTION public.fn_guard_staff_identity_access() FROM PUBLIC,anon,authenticated;

ALTER TABLE public.staff_access_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_access_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_access_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_access_groups_read ON public.staff_access_groups FOR SELECT TO authenticated USING (fn_staff_full_admin(organization_id));
CREATE POLICY staff_access_members_read ON public.staff_access_members FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM staff_access_groups g WHERE g.id=group_id AND fn_staff_full_admin(g.organization_id)));
CREATE POLICY staff_access_events_read ON public.staff_access_events FOR SELECT TO authenticated USING (fn_staff_full_admin(organization_id));
REVOKE ALL ON public.staff_access_groups,public.staff_access_members,public.staff_access_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.staff_access_groups,public.staff_access_members,public.staff_access_events TO authenticated;
GRANT ALL ON public.staff_access_groups,public.staff_access_members,public.staff_access_events TO service_role;

CREATE FUNCTION public.fn_staff_access_groups() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM users WHERE auth_id=auth.uid() AND is_active IS TRUE;
  IF NOT fn_staff_full_admin(v_org) THEN RAISE EXCEPTION 'Only full admins can manage access groups' USING ERRCODE='42501'; END IF;
  INSERT INTO staff_access_groups(organization_id,code,name,permissions) VALUES
    (v_org,'training','Training Coordinator',ARRAY['training.manage','training_materials.manage']),
    (v_org,'attendance','Attendance Approver',ARRAY['attendance.approve']),
    (v_org,'leave','Leave Approver',ARRAY['leave.approve']),
    (v_org,'staff_admin','Staff Admin',ARRAY['training.manage','training_materials.manage','attendance.approve','leave.approve'])
    ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('groups',COALESCE((SELECT jsonb_agg(to_jsonb(g) || jsonb_build_object(
      'member_ids',COALESCE((SELECT jsonb_agg(m.user_id ORDER BY m.user_id) FROM staff_access_members m WHERE m.group_id=g.id),'[]'::jsonb)) ORDER BY g.name)
    FROM staff_access_groups g WHERE g.organization_id=v_org),'[]'::jsonb),
    'employees',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'department',department,'is_active',is_active) ORDER BY name,id)
      FROM users WHERE organization_id=v_org),'[]'::jsonb));
END;
$$;
CREATE FUNCTION public.fn_save_staff_access_group(p_name text,p_permissions text[],p_members uuid[],p_enabled boolean,
  p_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor users%ROWTYPE; v_group staff_access_groups%ROWTYPE; v_before jsonb; v_after jsonb;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id=auth.uid() AND is_active IS TRUE;
  IF NOT fn_staff_full_admin(v_actor.organization_id) THEN RAISE EXCEPTION 'Only full admins can manage access groups' USING ERRCODE='42501'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_enabled IS NULL OR p_permissions IS NULL
    OR array_position(p_permissions,NULL) IS NOT NULL OR NOT p_permissions <@ ARRAY['training.manage','training_materials.manage','attendance.approve','leave.approve']::text[] THEN
    RAISE EXCEPTION 'Choose a group name and supported staff permissions';
  END IF;
  IF p_members IS NULL OR EXISTS(SELECT 1 FROM unnest(p_members) x(id) LEFT JOIN users u ON u.id=x.id
    WHERE u.id IS NULL OR u.organization_id IS DISTINCT FROM v_actor.organization_id OR u.is_active IS NOT TRUE) THEN
    RAISE EXCEPTION 'Group members must be active users in your organization';
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_group FROM staff_access_groups WHERE id=p_id AND organization_id=v_actor.organization_id FOR UPDATE;
    IF v_group.id IS NULL THEN RAISE EXCEPTION 'Access group not found in your organization'; END IF;
    IF p_expected_updated_at IS DISTINCT FROM v_group.updated_at THEN RAISE EXCEPTION 'Access group changed. Refresh before saving'; END IF;
    SELECT to_jsonb(v_group) || jsonb_build_object('members',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) ORDER BY u.id)
      FROM staff_access_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=p_id),'[]'::jsonb)) INTO v_before;
    UPDATE staff_access_groups SET name=btrim(p_name),permissions=p_permissions,enabled=p_enabled,updated_at=clock_timestamp()
      WHERE id=p_id RETURNING * INTO v_group;
  ELSE
    INSERT INTO staff_access_groups(organization_id,name,permissions,enabled) VALUES(v_actor.organization_id,btrim(p_name),p_permissions,p_enabled) RETURNING * INTO v_group;
  END IF;
  DELETE FROM staff_access_members WHERE group_id=v_group.id;
  INSERT INTO staff_access_members(group_id,user_id) SELECT v_group.id,id FROM unnest(p_members) x(id) GROUP BY id;
  SELECT to_jsonb(v_group) || jsonb_build_object('members',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) ORDER BY u.id)
    FROM staff_access_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=v_group.id),'[]'::jsonb)) INTO v_after;
  INSERT INTO staff_access_events(organization_id,group_id,actor_id,actor_name,before_value,after_value)
    VALUES(v_actor.organization_id,v_group.id,v_actor.id,v_actor.name,v_before,v_after);
  RETURN v_group.id;
END;
$$;

-- Minimal directories avoid widening access to user profiles, salaries or contact details.
CREATE FUNCTION public.fn_training_employee_directory() RETURNS TABLE(id uuid,name text,department text,is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org uuid;
BEGIN
  SELECT u.organization_id INTO v_org FROM users u WHERE u.auth_id=auth.uid() AND u.is_active IS TRUE;
  IF NOT fn_has_staff_permission('training.manage',v_org) THEN RAISE EXCEPTION 'Training management permission required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT u.id,u.name,u.department,u.is_active FROM users u WHERE u.organization_id=v_org ORDER BY u.name,u.id;
END;
$$;
CREATE FUNCTION public.fn_staff_approvers(p_permission text DEFAULT 'leave.approve') RETURNS TABLE(id uuid,name text,department text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id=auth.uid() AND is_active IS TRUE;
  IF v_actor.id IS NULL OR p_permission NOT IN ('leave.approve','attendance.approve') OR p_permission IS NULL THEN RAISE EXCEPTION 'Active membership and valid approval type required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT u.id,u.name,u.department FROM users u WHERE u.organization_id=v_actor.organization_id AND u.id<>v_actor.id
    AND fn_staff_user_has_permission(u.id,v_actor.organization_id,p_permission) ORDER BY (u.role IN ('admin','superadmin')),u.name,u.id;
END;
$$;
CREATE FUNCTION public.fn_service_leave_approvers(p_user uuid) RETURNS TABLE(id uuid,name text,department text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM users WHERE users.id=p_user AND users.is_active IS TRUE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Active organization membership required'; END IF;
  RETURN QUERY SELECT u.id,u.name,u.department FROM users u WHERE u.organization_id=v_org AND u.id<>p_user
    AND fn_staff_user_has_permission(u.id,v_org,'leave.approve') ORDER BY (u.role IN ('admin','superadmin')),u.name,u.id;
END;
$$;
CREATE FUNCTION public.fn_staff_attendance_day(p_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM users WHERE auth_id=auth.uid() AND is_active IS TRUE;
  IF NOT fn_has_staff_permission('attendance.approve',v_org) THEN RAISE EXCEPTION 'Attendance approval permission required' USING ERRCODE='42501'; END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'Choose an attendance date'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',u.id,'name',u.name,'department',u.department,
    'punch_in',a.punch_in_time,'punch_out',a.punch_out_time,'total_hours',a.total_hours,'is_late',a.is_late,
    'is_absent',a.is_absent,'is_regularized',a.is_regularized) ORDER BY u.name,u.id)
    FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date=p_date AND a.organization_id=v_org
    WHERE u.organization_id=v_org AND u.is_active IS TRUE),'[]'::jsonb);
END;
$$;

-- Request read access is narrow. Decision RPCs still enforce permission, no self approval and payroll locks.
CREATE POLICY staff_leave_delegated_read ON public.tasks FOR SELECT TO authenticated
  USING (leave_start_date IS NOT NULL AND fn_has_staff_permission('leave.approve',organization_id));
CREATE POLICY staff_correction_delegated_read ON public.attendance_correction_requests FOR SELECT TO authenticated
  USING (fn_has_staff_permission('attendance.approve',organization_id));

REVOKE ALL ON FUNCTION public.fn_staff_full_admin(uuid),public.fn_has_staff_permission(text,uuid),public.fn_my_staff_access(),
  public.fn_staff_access_groups(),public.fn_save_staff_access_group(text,text[],uuid[],boolean,uuid,timestamptz),
  public.fn_training_employee_directory(),public.fn_staff_approvers(text),public.fn_staff_attendance_day(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_staff_full_admin(uuid),public.fn_has_staff_permission(text,uuid),public.fn_my_staff_access(),
  public.fn_staff_access_groups(),public.fn_save_staff_access_group(text,text[],uuid[],boolean,uuid,timestamptz),
  public.fn_training_employee_directory(),public.fn_staff_approvers(text),public.fn_staff_attendance_day(date) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_staff_user_has_permission(uuid,uuid,text),public.fn_service_leave_approvers(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_staff_user_has_permission(uuid,uuid,text),public.fn_service_leave_approvers(uuid) TO service_role;

-- Trusted WhatsApp callers use the same decision contract, including self-approval and payroll locks.
CREATE FUNCTION public.fn_service_decide_staff_leave(p_actor uuid,p_id uuid,p_action text,p_note text DEFAULT '') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor users%ROWTYPE; v_org uuid;
BEGIN
  SELECT * INTO v_actor FROM users WHERE id=p_actor AND is_active IS TRUE;
  SELECT organization_id INTO v_org FROM tasks WHERE id=p_id;
  IF v_actor.auth_id IS NULL OR NOT fn_staff_user_has_permission(v_actor.id,v_org,'leave.approve') THEN
    RAISE EXCEPTION 'Active leave approval permission required' USING ERRCODE='42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Choose approve or reject'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_actor.auth_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor.auth_id,'role','authenticated')::text,true);
  PERFORM fn_decide_staff_leave(p_id,p_action,p_note);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_service_decide_staff_leave(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_service_decide_staff_leave(uuid,uuid,text,text) TO service_role;

-- Delegated document writes are limited to training material in the training folder.
CREATE POLICY training_material_insert ON public.organization_documents FOR INSERT TO authenticated WITH CHECK (
  category='training' AND is_public IS FALSE AND fn_has_staff_permission('training_materials.manage',organization_id)
  AND uploaded_by=(SELECT id FROM users WHERE auth_id=auth.uid())
  AND split_part(file_path,'/',1)=organization_id::text AND split_part(file_path,'/',2)='training');
CREATE POLICY training_material_update ON public.organization_documents FOR UPDATE TO authenticated
  USING(category='training' AND fn_has_staff_permission('training_materials.manage',organization_id))
  WITH CHECK(category='training' AND is_public IS FALSE AND fn_has_staff_permission('training_materials.manage',organization_id)
    AND split_part(file_path,'/',1)=organization_id::text AND split_part(file_path,'/',2)='training');
CREATE POLICY training_material_delete ON public.organization_documents FOR DELETE TO authenticated
  USING(category='training' AND fn_has_staff_permission('training_materials.manage',organization_id));
CREATE POLICY training_material_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='organization-documents' AND split_part(name,'/',2)='training'
  AND EXISTS(SELECT 1 FROM users WHERE auth_id=auth.uid() AND is_active IS TRUE AND organization_id::text=split_part(storage.objects.name,'/',1)
    AND fn_has_staff_permission('training_materials.manage',organization_id)));
CREATE POLICY training_material_storage_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id='organization-documents' AND split_part(name,'/',2)='training'
  AND EXISTS(SELECT 1 FROM users WHERE auth_id=auth.uid() AND is_active IS TRUE AND organization_id::text=split_part(storage.objects.name,'/',1)
    AND fn_has_staff_permission('training_materials.manage',organization_id)));

-- Delegated workflow definitions (preserve original validation and audit logic).


CREATE OR REPLACE FUNCTION public.fn_training_is_admin(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_active IS TRUE
    AND organization_id = p_org AND fn_has_staff_permission('training.manage',p_org));
$$;

CREATE OR REPLACE FUNCTION public.fn_training_can_view_session(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM training_sessions s JOIN users u ON u.organization_id = s.organization_id
    WHERE s.id = p_id AND u.auth_id = auth.uid() AND u.is_active IS TRUE
    AND (fn_has_staff_permission('training.manage',s.organization_id) OR EXISTS (
      SELECT 1 FROM training_attendees a WHERE a.session_id = s.id AND a.user_id = u.id)));
$$;

CREATE OR REPLACE FUNCTION public.fn_save_training_session(
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
  IF v_actor.id IS NULL OR v_actor.organization_id IS NULL OR NOT fn_has_staff_permission('training.manage',v_actor.organization_id) THEN
    RAISE EXCEPTION 'Training managers can manage training';
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

CREATE OR REPLACE FUNCTION public.fn_record_training_attendee(
  p_id uuid, p_attendance text, p_completion text, p_notes text, p_expected_updated_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_session public.training_sessions%ROWTYPE;
  v_old public.training_attendees%ROWTYPE;
  v_new public.training_attendees%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS TRUE;
  IF v_actor.id IS NULL OR NOT fn_has_staff_permission('training.manage',v_actor.organization_id) THEN
    RAISE EXCEPTION 'Training managers can record training';
  END IF;
  -- Lock session first, consistently with save/close, to serialize concurrent changes.
  SELECT s.* INTO v_session FROM training_sessions s JOIN training_attendees a ON a.session_id = s.id
    WHERE a.id = p_id AND s.organization_id = v_actor.organization_id FOR UPDATE OF s;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Attendee not found in your organization'; END IF;
  SELECT * INTO v_old FROM training_attendees WHERE id = p_id FOR UPDATE;
  IF p_expected_updated_at IS DISTINCT FROM v_old.updated_at THEN
    RAISE EXCEPTION 'This attendee record changed. Refresh before saving';
  END IF;
  IF v_old.user_id = v_actor.id AND NOT fn_staff_full_admin(v_actor.organization_id) THEN
    RAISE EXCEPTION 'Another training manager must record your own training';
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

CREATE OR REPLACE FUNCTION public.fn_set_training_session_status(p_id uuid, p_status text, p_expected_updated_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_old public.training_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS TRUE;
  IF v_actor.id IS NULL OR NOT fn_has_staff_permission('training.manage',v_actor.organization_id) THEN
    RAISE EXCEPTION 'Training managers can manage training';
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

CREATE OR REPLACE FUNCTION public.fn_guard_staff_leave()
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
  IF NOT v_service AND v_actor.id <> NEW.created_by AND NOT fn_has_staff_permission('leave.approve',NEW.organization_id) THEN
    RAISE EXCEPTION 'You can only change your own leave request.' USING ERRCODE = '42501';
  END IF;
  IF NEW.assigned_to IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
    AND NOT fn_staff_user_has_permission(NEW.assigned_to,NEW.organization_id,'leave.approve') THEN
    RAISE EXCEPTION 'Leave must be assigned to an active leave approver in the employee organization.';
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
    IF NOT fn_has_staff_permission('leave.approve',NEW.organization_id) OR NEW.created_by = v_actor.id THEN
      RAISE EXCEPTION 'Another authorized leave approver must decide this leave request.' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.fn_decide_staff_leave(p_id uuid, p_action text, p_note text DEFAULT '')
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
    IF NOT fn_has_staff_permission('leave.approve',v_task.organization_id) OR v_task.created_by = v_actor.id THEN RAISE EXCEPTION 'Another authorized leave approver must decide this request.' USING ERRCODE = '42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.fn_decide_attendance_correction(p_request_id uuid, p_action text, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor users%ROWTYPE;
  v_request attendance_correction_requests%ROWTYPE;
  v_att attendance%ROWTYPE;
  v_shift uuid;
  v_after jsonb;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS DISTINCT FROM false;
  IF v_actor.id IS NULL OR p_action IS NULL OR p_action NOT IN ('approve', 'reject', 'cancel') THEN
    RAISE EXCEPTION 'An active account and a valid action are required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM attendance_correction_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL OR v_request.organization_id IS DISTINCT FROM v_actor.organization_id THEN
    RAISE EXCEPTION 'Request not found in your organization.' USING ERRCODE = '42501';
  END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been decided.'; END IF;
  IF p_action = 'cancel' THEN
    IF v_request.user_id <> v_actor.id THEN
      RAISE EXCEPTION 'You can only cancel your own request.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT fn_has_staff_permission('attendance.approve',v_request.organization_id) OR v_request.user_id = v_actor.id THEN
      RAISE EXCEPTION 'Another authorized attendance approver must review this request.' USING ERRCODE = '42501';
    END IF;
    IF p_action = 'reject' AND length(btrim(COALESCE(p_note, ''))) < 3 THEN
      RAISE EXCEPTION 'Explain why the request is rejected.';
    END IF;
  END IF;
  IF length(COALESCE(p_note, '')) > 2000 THEN RAISE EXCEPTION 'Keep the decision note within 2000 characters.'; END IF;

  IF p_action = 'approve' THEN
    PERFORM 1 FROM users WHERE id = v_request.user_id AND organization_id = v_actor.organization_id
      AND is_active IS DISTINCT FROM false FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The employee is no longer active in this organization.'; END IF;
    PERFORM fn_assert_correction_period_open(v_actor.organization_id, v_request.attendance_date);
    SELECT * INTO v_att FROM attendance WHERE user_id = v_request.user_id
      AND date = v_request.attendance_date FOR UPDATE;
    PERFORM 1 FROM attendance_sessions WHERE attendance_id = v_att.id FOR UPDATE;
    IF fn_correction_day_snapshot(v_request.user_id, v_request.attendance_date) <> v_request.before_snapshot THEN
      RAISE EXCEPTION 'Attendance changed after this request. Reject it and ask the employee to submit an updated request.';
    END IF;
    IF EXISTS (SELECT 1 FROM attendance_sessions s WHERE s.user_id = v_request.user_id
        AND s.id IS DISTINCT FROM v_request.session_id
        AND s.punch_in_time < v_request.proposed_punch_out
        AND COALESCE(s.punch_out_time, 'infinity'::timestamptz) > v_request.proposed_punch_in)
      OR EXISTS (SELECT 1 FROM attendance a WHERE a.user_id = v_request.user_id
        AND a.id IS DISTINCT FROM v_att.id AND a.punch_in_time IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM attendance_sessions s WHERE s.attendance_id = a.id)
        AND a.punch_in_time < v_request.proposed_punch_out
        AND COALESCE(a.punch_out_time, 'infinity'::timestamptz) > v_request.proposed_punch_in) THEN
      RAISE EXCEPTION 'These times overlap another attendance session.';
    END IF;
    IF v_att.id IS NULL THEN
      SELECT es.shift_id INTO v_shift FROM employee_shifts es JOIN shifts s ON s.id = es.shift_id
        WHERE es.user_id = v_request.user_id AND s.organization_id = v_actor.organization_id
          AND es.effective_from <= v_request.attendance_date
          AND (es.effective_to IS NULL OR es.effective_to >= v_request.attendance_date)
        ORDER BY es.effective_from DESC LIMIT 1;
      INSERT INTO attendance(user_id, organization_id, date, shift_id)
        VALUES(v_request.user_id, v_actor.organization_id, v_request.attendance_date, v_shift)
        RETURNING * INTO v_att;
    END IF;
    IF v_request.session_id IS NOT NULL THEN
      UPDATE attendance_sessions SET punch_in_time = v_request.proposed_punch_in,
        punch_out_time = v_request.proposed_punch_out, updated_at = now() WHERE id = v_request.session_id;
    ELSIF v_att.punch_in_time IS NULL THEN
      INSERT INTO attendance_sessions(attendance_id, user_id, organization_id, date, punch_in_time, punch_out_time)
        VALUES(v_att.id, v_request.user_id, v_actor.organization_id, v_request.attendance_date,
          v_request.proposed_punch_in, v_request.proposed_punch_out);
    ELSE
      UPDATE attendance SET punch_in_time = v_request.proposed_punch_in,
        punch_out_time = v_request.proposed_punch_out, updated_at = now() WHERE id = v_att.id;
    END IF;
    -- Session triggers recalculate hours; the approved exception is also visible
    -- through the existing regularization fields used by reports and payroll.
    UPDATE attendance SET is_regularized = true, regularized_by = v_actor.id,
      regularization_reason = v_request.reason, regularized_at = now(), updated_at = now() WHERE id = v_att.id;
    v_after := fn_correction_day_snapshot(v_request.user_id, v_request.attendance_date);
    INSERT INTO attendance_punch_corrections(attendance_id, session_id, user_id, organization_id,
        action, reason, performed_by, snapshot)
      VALUES(v_att.id, v_request.session_id, v_request.user_id, v_actor.organization_id,
        'approved_attendance_request', v_request.reason, v_actor.id,
        jsonb_build_object('request_id', v_request.id, 'before', v_request.before_snapshot, 'after', v_after));
  END IF;
  UPDATE attendance_correction_requests SET
    status = CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'cancelled' END,
    attendance_id = COALESCE(v_att.id, attendance_id), after_snapshot = v_after,
    reviewed_by = v_actor.id, reviewer_name = v_actor.name, decision_note = NULLIF(btrim(p_note), ''),
    reviewed_at = now(), updated_at = now() WHERE id = v_request.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_staff_approvals(p_status text DEFAULT 'pending', p_kind text DEFAULT 'all', p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor users%ROWTYPE; v_result jsonb;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS DISTINCT FROM false;
  IF v_actor.id IS NULL OR (NOT fn_has_staff_permission('leave.approve',v_actor.organization_id) AND NOT fn_has_staff_permission('attendance.approve',v_actor.organization_id)) THEN
    RAISE EXCEPTION 'Authorized approvers can use the approvals inbox.' USING ERRCODE = '42501';
  END IF;
  WITH entries AS (
    SELECT t.id, 'leave'::text AS kind, t.created_by AS user_id, u.name AS employee_name, u.department,
      t.leave_start_date AS work_date, t.created_at,
      fn_staff_leave_status(t.status, t.leave_cancelled_at) AS status,
      COALESCE(fn_staff_description_field(t.description, 'Reason'), 'Leave request') AS reason,
      jsonb_build_object('start_date', t.leave_start_date, 'end_date', t.leave_end_date, 'duration', t.leave_kind,
        'category', t.leave_category, 'description', t.description) AS details,
      t.leave_decided_at AS reviewed_at, reviewer.name AS reviewer_name,
      fn_staff_description_field(regexp_replace(t.description, '[\s\S]*DECISION:', 'DECISION:'), 'Decision Note') AS decision_note
    FROM tasks t JOIN users u ON u.id = t.created_by LEFT JOIN users reviewer ON reviewer.id = t.leave_decided_by
    WHERE t.organization_id = v_actor.organization_id AND t.leave_start_date IS NOT NULL
    UNION ALL
    SELECT c.id, 'correction', c.user_id, u.name, u.department, c.attendance_date, c.created_at, c.status, c.reason,
      jsonb_build_object('punch_in', c.proposed_punch_in, 'punch_out', c.proposed_punch_out,
        'before', c.before_snapshot, 'session_id', c.session_id), c.reviewed_at, c.reviewer_name, c.decision_note
    FROM attendance_correction_requests c JOIN users u ON u.id = c.user_id WHERE c.organization_id = v_actor.organization_id
    UNION ALL
    SELECT r.id, 'regularization', a.user_id, u.name, u.department, a.date, r.created_at, r.status, r.reason,
      jsonb_build_object('punch_in', a.punch_in_time, 'punch_out', a.punch_out_time, 'late', a.is_late, 'early_out', a.is_early_out),
      CASE WHEN r.status <> 'pending' THEN r.updated_at END, reviewer.name, r.admin_remarks
    FROM attendance_regularizations r JOIN attendance a ON a.id = r.attendance_id JOIN users u ON u.id = a.user_id
      LEFT JOIN users reviewer ON reviewer.id = r.approved_by WHERE a.organization_id = v_actor.organization_id
    UNION ALL
    SELECT d.id, 'ai_review', d.user_id, COALESCE(u.name, 'Organization attendance'), u.department, a.date, d.created_at,
      CASE WHEN d.reviewed_at IS NULL THEN 'pending' WHEN d.decision_payload->>'review_action' = 'rejected' THEN 'rejected' ELSE 'approved' END,
      replace(d.decision_type, '_', ' '), jsonb_build_object('confidence', d.confidence, 'previous', d.decision_payload->'previous', 'next', d.decision_payload->'next'),
      d.reviewed_at, reviewer.name, d.decision_payload->>'review_note'
    FROM attendance_ai_decisions d JOIN attendance_ai_runs run ON run.id = d.run_id LEFT JOIN users u ON u.id = d.user_id
      LEFT JOIN attendance a ON a.id = d.attendance_id LEFT JOIN users reviewer ON reviewer.id = d.reviewed_by
    WHERE run.organization_id = v_actor.organization_id AND (d.human_review_required OR d.reviewed_at IS NOT NULL)
  ), authorized AS (
    SELECT * FROM entries WHERE (kind = 'leave' AND fn_has_staff_permission('leave.approve',v_actor.organization_id))
      OR (kind IN ('correction','regularization') AND fn_has_staff_permission('attendance.approve',v_actor.organization_id))
      OR (kind = 'ai_review' AND fn_staff_full_admin(v_actor.organization_id))
  ), filtered AS (
    SELECT * FROM authorized WHERE (p_status = 'all' OR status = p_status) AND (p_kind = 'all' OR kind = p_kind)
  ), page AS (
    SELECT *, user_id IS DISTINCT FROM v_actor.id AS can_review FROM filtered
      ORDER BY CASE WHEN p_status = 'pending' THEN created_at END, created_at DESC, id LIMIT 20 OFFSET greatest(p_offset, 0)
  )
  SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY CASE WHEN p_status = 'pending' THEN created_at END, created_at DESC, id) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered), 'pending_count', (SELECT count(*) FROM authorized WHERE status = 'pending'),
    'overdue_count', (SELECT count(*) FROM authorized WHERE status = 'pending' AND created_at < now() - interval '24 hours')) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_review_staff_request(p_kind text, p_id uuid, p_action text, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor users%ROWTYPE; v_regularization attendance_regularizations%ROWTYPE;
  v_att attendance%ROWTYPE; v_ai attendance_ai_decisions%ROWTYPE; v_org uuid;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS DISTINCT FROM false;
  IF v_actor.id IS NULL OR (NOT fn_has_staff_permission('leave.approve',v_actor.organization_id) AND NOT fn_has_staff_permission('attendance.approve',v_actor.organization_id)) THEN
    RAISE EXCEPTION 'Authorized approvers can review requests.' USING ERRCODE = '42501';
  END IF;
  IF (p_kind = 'leave' AND NOT fn_has_staff_permission('leave.approve',v_actor.organization_id))
    OR (p_kind IN ('correction','regularization') AND NOT fn_has_staff_permission('attendance.approve',v_actor.organization_id))
    OR (p_kind = 'ai_review' AND NOT fn_staff_full_admin(v_actor.organization_id)) THEN
    RAISE EXCEPTION 'Permission for this request type is required' USING ERRCODE='42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'Choose approve or reject.'; END IF;
  IF length(COALESCE(p_note, '')) > 2000 OR (p_action = 'reject' AND length(btrim(COALESCE(p_note, ''))) < 3) THEN
    RAISE EXCEPTION 'Give a rejection reason; keep all notes within 2000 characters.';
  END IF;
  IF p_kind = 'leave' THEN
    PERFORM fn_decide_staff_leave(p_id, p_action, p_note);
  ELSIF p_kind = 'correction' THEN
    PERFORM fn_decide_attendance_correction(p_id, p_action, p_note);
  ELSIF p_kind = 'regularization' THEN
    SELECT * INTO v_regularization FROM attendance_regularizations WHERE id = p_id FOR UPDATE;
    SELECT * INTO v_att FROM attendance WHERE id = v_regularization.attendance_id FOR UPDATE;
    IF v_att.id IS NULL OR v_att.organization_id IS DISTINCT FROM v_actor.organization_id OR v_att.user_id = v_actor.id THEN
      RAISE EXCEPTION 'Another authorized approver in the employee organization must review this request.' USING ERRCODE = '42501';
    END IF;
    IF v_regularization.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been decided.'; END IF;
    IF p_action = 'approve' THEN
      PERFORM fn_assert_correction_period_open(v_actor.organization_id, v_att.date);
      UPDATE attendance SET is_regularized = true, regularized_by = v_actor.id, regularization_reason = v_regularization.reason,
        regularized_at = now(), updated_at = now() WHERE id = v_att.id;
    END IF;
    UPDATE attendance_regularizations SET status = CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
      approved_by = v_actor.id, admin_remarks = NULLIF(btrim(p_note), ''), updated_at = now() WHERE id = p_id;
    INSERT INTO notifications(user_id, type, title, message) VALUES(v_att.user_id, 'task_updated', 'Attendance review completed',
      'Your attendance request for ' || v_att.date::text || ' was ' || CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END || '. ' || COALESCE(p_note, ''));
  ELSIF p_kind = 'ai_review' THEN
    SELECT * INTO v_ai FROM attendance_ai_decisions WHERE id = p_id FOR UPDATE;
    SELECT organization_id INTO v_org FROM attendance_ai_runs WHERE id = v_ai.run_id;
    IF v_ai.id IS NULL OR v_org IS DISTINCT FROM v_actor.organization_id OR v_ai.user_id = v_actor.id THEN
      RAISE EXCEPTION 'Another organization admin must review this suggestion.' USING ERRCODE = '42501';
    END IF;
    IF v_ai.reviewed_at IS NOT NULL THEN RAISE EXCEPTION 'This suggestion has already been reviewed.'; END IF;
    -- Preserve the proposed/previous values. This acknowledges review; it does
    -- not execute arbitrary AI payloads against attendance or salary records.
    UPDATE attendance_ai_decisions SET reviewed_at = now(), reviewed_by = v_actor.id,
      decision_payload = decision_payload || jsonb_build_object('review_action', CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
        'review_note', btrim(COALESCE(p_note, '')), 'reviewed_at', now()) WHERE id = p_id;
  ELSE RAISE EXCEPTION 'Unknown request type.';
  END IF;
END;
$$;
