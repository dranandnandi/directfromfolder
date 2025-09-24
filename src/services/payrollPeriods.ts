import { supabase, retryOperation } from '../utils/supabaseClient';
import type { PostgrestError } from '@supabase/supabase-js';

export interface PayrollPeriodRow {
  id: string;
  organization_id: string;
  month: number;
  year: number;
  status: string;
  lock_at: string | null;
  created_at: string;
  created_by: string | null;
  posted_at?: string | null;
  finalized_at?: string | null;
}

const logAndThrow = (context: string, error: PostgrestError): never => {
  console.error(`[PayrollPeriodsService] ${context}`, { error });
  throw error;
};

export interface FetchPeriodParams {
  organizationId: string;
  month: number;
  year: number;
}

export const fetchPayrollPeriod = async (
  params: FetchPeriodParams,
): Promise<PayrollPeriodRow | null> => {
  const { organizationId, month, year } = params;

  return retryOperation(async () => {
    const { data, error } = await supabase
      .from<PayrollPeriodRow>('payroll_periods')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('month', month)
      .eq('year', year)
      .limit(1);

    if (error) {
      logAndThrow(
        `Failed to fetch payroll_periods for org=${organizationId}, month=${month}, year=${year}`,
        error,
      );
    }

    if (!data || data.length === 0) {
      console.warn('[PayrollPeriodsService] No payroll period found', {
        organizationId,
        month,
        year,
      });
      return null;
    }

    return data[0];
  }, 3);
};