import { useEffect, useState } from 'react';
import { PayrollReadiness, staffWorkflowService, workflowError } from '../services/staffWorkflowService';

export function usePayrollReadiness(orgId: string, month: number, year: number) {
  const key = `${orgId}:${year}:${month}`;
  const [result, setResult] = useState<{ key: string; data: PayrollReadiness | null; error: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion(value => value + 1);
  useEffect(() => {
    const reload = () => setVersion(value => value + 1);
    window.addEventListener('focus', reload);
    window.addEventListener('staff-workflow-updated', reload);
    return () => { window.removeEventListener('focus', reload); window.removeEventListener('staff-workflow-updated', reload); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!orgId) { setLoading(false); return; }
    void staffWorkflowService.readiness(orgId, month, year).then(data => { if (!cancelled) setResult({ key, data, error: '' }); })
      .catch(error => { if (!cancelled) setResult({ key, data: null, error: workflowError(error) }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, month, year, key, version]);
  return { data: result?.key === key ? result.data : null, error: result?.key === key ? result.error : '', loading, refresh };
}
