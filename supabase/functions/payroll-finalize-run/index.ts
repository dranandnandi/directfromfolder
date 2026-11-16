// supabase/functions/payroll-finalize-run/index.ts
import { supabaseAdmin, readJson, ok, bad, cors } from "../_shared/utils.ts";

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const { payroll_period_id, user_id, state } = await readJson(req);
    if (!payroll_period_id || !user_id || !state) {
      return bad("Missing payroll_period_id|user_id|state", { headers });
    }

    const sb = supabaseAdmin();
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return bad('Sign in to process payroll.', { headers, status: 401 });
    const { data: auth, error: authError } = await sb.auth.getUser(token);
    if (authError || !auth.user) return bad('Sign in to process payroll.', { headers, status: 401 });
    const { data: actor } = await sb.from('users').select('organization_id, role, is_active').eq('auth_id', auth.user.id).maybeSingle();
    const { data: period } = await sb.from('payroll_periods').select('organization_id').eq('id', payroll_period_id).maybeSingle();
    if (!actor || actor.is_active === false || !['admin', 'superadmin', 'payroll_admin'].includes(actor.role)
      || !period || period.organization_id !== actor.organization_id) {
      return bad('You cannot process payroll for this organization.', { headers, status: 403 });
    }
    const { data, error } = await sb.rpc("fn_finalize_run", {
      p_period: payroll_period_id,
      p_user: user_id,
      p_state: state,
    });
    if (error) return bad(error.message, { headers, status: 500 });
    return ok(data, { headers });
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
});
