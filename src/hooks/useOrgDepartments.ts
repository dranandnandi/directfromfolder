import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { withDefaultDepartments } from '../constants/departments';

/**
 * Loads the departments configured for the signed-in user's organization.
 * Every organization keeps its own list in organizations.departments, so this
 * must never be replaced by a hardcoded list.
 */
export const useOrgDepartments = () => {
  const [departments, setDepartments] = useState<string[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('organization_id')
        .eq('auth_id', session.user.id)
        .single();

      if (userError) throw userError;
      if (!userData?.organization_id) return;

      setOrganizationId(userData.organization_id);

      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('departments')
        .eq('id', userData.organization_id)
        .single();

      if (orgError) throw orgError;
      setDepartments(withDefaultDepartments(orgData?.departments));
    } catch (error) {
      console.error('Error loading organization departments:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { departments, organizationId, loading, reload: load };
};
