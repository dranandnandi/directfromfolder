import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { StaffAccess, StaffPermission, staffAccessService } from '../services/staffAccessService';

interface AccessContext {
  access: StaffAccess | null; loading: boolean; error: string;
  can: (permission: StaffPermission) => boolean; refresh: () => Promise<void>;
}
const Context = createContext<AccessContext | null>(null);

export function StaffAccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<StaffAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const authId = useRef<string | null>(null);
  const refresh = useCallback(async () => { setRevision(value => value + 1); }, []);
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { if (active) { setAccess(null); setLoading(false); setError(''); } return; }
      try { const value = await staffAccessService.mine(); if (active) { setAccess(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value); setError(''); } }
      catch (err) { if (active) { setAccess(null); setError((err as { message?: string }).message || 'Unable to load permissions.'); } }
      finally { if (active) setLoading(false); }
    }).catch(() => { if (active) { setAccess(null); setLoading(false); setError('Unable to verify access.'); } });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id || null;
      if (nextId !== authId.current) { authId.current = nextId; setAccess(null); setLoading(true); }
      setRevision(value => value + 1);
    });
    const focused = () => { if (!document.hidden) setRevision(value => value + 1); };
    window.addEventListener('focus', focused);
    window.addEventListener('staff-access-updated', focused);
    const timer = window.setInterval(focused, 30000);
    return () => { data.subscription.unsubscribe(); window.removeEventListener('focus', focused); window.removeEventListener('staff-access-updated', focused); window.clearInterval(timer); };
  }, []);
  const value = useMemo<AccessContext>(() => ({ access, loading, error,
    can: permission => !!access?.permissions.includes(permission), refresh }), [access, loading, error, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useStaffAccess() {
  const context = useContext(Context);
  if (!context) throw new Error('StaffAccessProvider is required');
  return context;
}
export function StaffPermissionRoute({ permissions, children }: { permissions: StaffPermission[]; children: ReactNode }) {
  const { access, loading, error, can, refresh } = useStaffAccess();
  if (loading) return <p role="status" className="p-4">Loading access...</p>;
  if (!access || !permissions.some(can)) return <div className="space-y-3 rounded-lg border bg-white p-6"><h1 className="text-lg font-semibold">Access required</h1><p className="text-sm text-gray-600">{error || 'Ask your administrator to assign the appropriate access group.'}</p><button className="text-sm text-blue-700" onClick={() => void refresh()}>Refresh access</button></div>;
  return <>{children}</>;
}
