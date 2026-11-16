CREATE FUNCTION public.fn_staff_approvals(p_status text DEFAULT 'pending', p_kind text DEFAULT 'all', p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor users%ROWTYPE; v_result jsonb;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS DISTINCT FROM false;
  IF v_actor.id IS NULL OR COALESCE(v_actor.role, '') NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only organization admins can use the approvals inbox.' USING ERRCODE = '42501';
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
  ), filtered AS (
    SELECT * FROM entries WHERE (p_status = 'all' OR status = p_status) AND (p_kind = 'all' OR kind = p_kind)
  ), page AS (
    SELECT *, user_id IS DISTINCT FROM v_actor.id AS can_review FROM filtered
      ORDER BY CASE WHEN p_status = 'pending' THEN created_at END, created_at DESC, id LIMIT 20 OFFSET greatest(p_offset, 0)
  )
  SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY CASE WHEN p_status = 'pending' THEN created_at END, created_at DESC, id) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered), 'pending_count', (SELECT count(*) FROM entries WHERE status = 'pending'),
    'overdue_count', (SELECT count(*) FROM entries WHERE status = 'pending' AND created_at < now() - interval '24 hours')) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.fn_review_staff_request(p_kind text, p_id uuid, p_action text, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor users%ROWTYPE; v_regularization attendance_regularizations%ROWTYPE;
  v_att attendance%ROWTYPE; v_ai attendance_ai_decisions%ROWTYPE; v_org uuid;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS DISTINCT FROM false;
  IF v_actor.id IS NULL OR COALESCE(v_actor.role, '') NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only organization admins can review requests.' USING ERRCODE = '42501';
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
      RAISE EXCEPTION 'Another admin in the employee organization must review this request.' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.fn_staff_approvals(text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_review_staff_request(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_staff_approvals(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_review_staff_request(text, uuid, text, text) TO authenticated;
