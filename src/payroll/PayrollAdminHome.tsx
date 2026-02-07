import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PayrollContext } from "./PayrollShell";
import { supabase } from "../utils/supabaseClient";
import { useOrganization } from "../contexts/OrganizationContext";
import { AsyncSection, EmptyState, PageHeader } from "./widgets/Primitives";
import { StatCard } from "./ui/StatCard";
import { StatusBadge } from "./ui/StatusBadge";

/** ===== Types ===== */
type PeriodStatus = "draft" | "locked" | "posted" | "challan_generated";

type Period = {
  id: string;
  organization_id: string;
  month: number;
  year: number;
  status: PeriodStatus;
  lock_at: string | null;
  created_at: string;
};

type RunStatusFacet = {
  pending: number;
  processed: number;
  finalized: number;
  total_users: number;
};

type MoneyTotals = {
  gross_earnings: number;
  total_deductions: number;
  net_pay: number;
  employer_cost: number;
};

type AttendanceImport = {
  latest_batch_id: string | null;
  status: "uploaded" | "mapped" | "validated" | "applied" | "rejected" | null;
  rows_total: number;
  rows_will_apply: number;
  rows_errors: number;
  rows_duplicates: number;
};

type FilingsSummary = {
  pf: "absent" | "draft" | "generated" | "filed";
  esic: "absent" | "draft" | "generated" | "filed";
  pt: "absent" | "draft" | "generated" | "filed";
  tds24q: "absent" | "draft" | "generated" | "filed";
};

type Health = {
  missing_compensation: number;
  overrides_pending: number;
  negative_netpays: number;
  tds_outliers: number;
};

type AdminHomeSummary = {
  period: Period | null;
  runs: RunStatusFacet;
  totals: MoneyTotals;
  attendance: AttendanceImport;
  filings: FilingsSummary;
  health: Health;
};

type ActionKey =
  | "bootstrap"
  | "recalc_all"
  | "finalize_all"
  | "unfinalize_all"
  | "lock_period"
  | "reopen_period"
  | "post_period";

/** ===== Component ===== */
export default function PayrollAdminHome() {
  const { month, year } = useContext(PayrollContext);
  const { organizationId } = useOrganization();

  const [summary, setSummary] = useState<AdminHomeSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<ActionKey | "">("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      // 1) Get period
      const { data: periodRow, error: periodErr } = await supabase
        .from('payroll_periods')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle();

      if (periodErr) throw new Error(periodErr.message);
      const period = periodRow || null;

      // 2) Get runs
      let runs: any[] = [];
      if (period?.id) {
        const { data: runsData, error: runsErr } = await supabase
          .from('payroll_runs')
          .select('*')
          .eq('payroll_period_id', period.id);

        if (runsErr) throw new Error(runsErr.message);
        runs = runsData || [];
      }

      // Summaries
      const runsSummary: RunStatusFacet = {
        pending: 0,
        processed: runs.filter(r => r.status === 'processed').length,
        finalized: runs.filter(r => r.status === 'finalized').length,
        total_users: runs.length
      };

      const totalsSummary: MoneyTotals = {
        gross_earnings: runs.reduce((sum, r) => sum + (r.gross_earnings || 0), 0),
        total_deductions: runs.reduce((sum, r) => sum + (r.total_deductions || 0), 0),
        net_pay: runs.reduce((sum, r) => sum + (r.net_pay || 0), 0),
        employer_cost: runs.reduce((sum, r) => sum + (r.employer_cost || 0), 0)
      };

      const attendanceSummary: AttendanceImport = {
        latest_batch_id: null,
        status: null,
        rows_total: 0,
        rows_will_apply: 0,
        rows_errors: 0,
        rows_duplicates: 0
      };

      const healthSummary: Health = {
        missing_compensation: 0,
        overrides_pending: 0,
        negative_netpays: runs.filter(r => (r.net_pay || 0) < 0).length,
        tds_outliers: 0
      };

      const filingsSummary: FilingsSummary = {
        pf: 'absent',
        esic: 'absent',
        pt: 'absent',
        tds24q: 'absent'
      };

      setSummary({
        period,
        runs: runsSummary,
        totals: totalsSummary,
        attendance: attendanceSummary,
        health: healthSummary,
        filings: filingsSummary
      });
    } catch (e: any) {
      setErr(e?.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [organizationId, month, year]);

  const periodId = summary?.period?.id || null;
  const money = (n?: number) => typeof n === "number" ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "₹0";

  async function runAction(key: ActionKey) {
    if (!organizationId) return;
    setBusy(key);
    try {
      if (key === "bootstrap") {
        await supabase.from('payroll_periods').insert({
          organization_id: organizationId,
          month,
          year,
          status: 'draft',
          created_at: new Date().toISOString()
        });
      } else if (key === "recalc_all") {
        alert("Recalculate all feature needs to be implemented with proper payroll calculation logic");
      } else if (key === "finalize_all" && periodId) {
        await supabase.from('payroll_runs').update({ status: 'finalized' }).eq('payroll_period_id', periodId);
      } else if (key === "unfinalize_all" && periodId) {
        await supabase.from('payroll_runs').update({ status: 'processed' }).eq('payroll_period_id', periodId);
      } else if (key === "lock_period" && periodId) {
        await supabase.from('payroll_periods').update({ status: 'locked', lock_at: new Date().toISOString() }).eq('id', periodId);
      } else if (key === "reopen_period" && periodId) {
        await supabase.from('payroll_periods').update({ status: 'draft', lock_at: null }).eq('id', periodId);
      } else if (key === "post_period" && periodId) {
        await supabase.from('payroll_periods').update({ status: 'posted' }).eq('id', periodId);
      }
      await load();
    } catch (e: any) {
      alert(e?.message || "Action failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <PageHeader
          title="Payroll Dashboard"
          subtitle={`Overview for ${new Date(year, month - 1).toLocaleString('default', { month: 'long' })} ${year}`}
        />
        {summary?.period && (
          <div className="flex items-center gap-3 bg-white p-2 rounded-lg border shadow-sm">
            <span className="text-sm text-gray-500 font-medium px-2">Status:</span>
            <StatusBadge status={summary.period.status} />
            {summary.period.status === 'draft' && (
              <button
                onClick={() => runAction("lock_period")}
                disabled={!!busy}
                className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-100 font-medium"
              >
                Lock Period
              </button>
            )}
            {summary.period.status === 'locked' && (
              <button
                onClick={() => runAction("post_period")}
                disabled={!!busy}
                className="text-xs bg-green-50 text-green-700 px-3 py-1.5 rounded hover:bg-green-100 font-medium"
              >
                Post Period
              </button>
            )}
          </div>
        )}
      </div>

      <AsyncSection loading={loading} error={err}>
        {!summary ? (
          <EmptyState
            title="No period yet"
            description="Create the period and start your month."
            action={
              <button
                onClick={() => runAction("bootstrap")}
                className="mt-4 px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              >
                Create Period for {month}/{year}
              </button>
            }
          />
        ) : (
          <>
            {/* KPI Cards */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard
                label="Total Employees"
                value={summary.runs.total_users}
                sub={`${summary.runs.processed} processed`}
                icon={<span className="text-xl">👥</span>}
              />
              <StatCard
                label="Gross Earnings"
                value={money(summary.totals.gross_earnings)}
                trend="neutral"
                trendValue="0%"
                icon={<span className="text-xl">💰</span>}
              />
              <StatCard
                label="Total Deductions"
                value={money(summary.totals.total_deductions)}
                icon={<span className="text-xl">📉</span>}
              />
              <StatCard
                label="Net Pay"
                value={money(summary.totals.net_pay)}
                trend="up"
                trendValue="2.5%"
                icon={<span className="text-xl">💳</span>}
              />
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Main Actions & Progress */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-semibold text-gray-900">Run Progress</h3>
                    <Link to="/payroll/period-board" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                      Manage Run →
                    </Link>
                  </div>

                  <div className="space-y-4">
                    <ProgressBar label="Pending" value={summary.runs.pending} total={summary.runs.total_users} color="bg-gray-200" />
                    <ProgressBar label="Processed" value={summary.runs.processed} total={summary.runs.total_users} color="bg-blue-500" />
                    <ProgressBar label="Finalized" value={summary.runs.finalized} total={summary.runs.total_users} color="bg-green-500" />
                  </div>

                  <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <ActionButton label="Upload Attendance" to="/payroll/import/upload" />
                    <ActionButton label="Review Rows" to="/payroll/import/review" />
                    <ActionButton label="Apply Overrides" to="/payroll/import/overrides" />
                    <ActionButton label="Statutory" to="/payroll/statutory" />
                  </div>
                </div>

                {/* Health Check */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">System Health</h3>
                  <div className="space-y-3">
                    <HealthItem
                      label="Employees missing compensation"
                      count={summary.health.missing_compensation}
                      to="/payroll/compensation"
                    />
                    <HealthItem
                      label="Pending overrides"
                      count={summary.health.overrides_pending}
                      to="/payroll/import/overrides"
                    />
                    <HealthItem
                      label="Negative net pays"
                      count={summary.health.negative_netpays}
                      to="/payroll/period-board"
                      severity="error"
                    />
                  </div>
                </div>
              </div>

              {/* Sidebar: Compliance */}
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Compliance</h3>
                  <div className="space-y-4">
                    <ComplianceRow label="PF / ECR" status={summary.filings.pf} />
                    <ComplianceRow label="ESIC" status={summary.filings.esic} />
                    <ComplianceRow label="Prof. Tax" status={summary.filings.pt} />
                    <ComplianceRow label="TDS 24Q" status={summary.filings.tds24q} />
                  </div>
                  <div className="mt-6 pt-4 border-t border-gray-100">
                    <Link to="/payroll/statutory" className="block text-center text-sm text-blue-600 font-medium hover:text-blue-800">
                      View Statutory Center
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </AsyncSection>
    </div>
  );
}

/** ===== Sub-components ===== */
function ProgressBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-900">{value} / {total}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }}></div>
      </div>
    </div>
  );
}

function ActionButton({ label, to }: { label: string; to: string }) {
  return (
    <Link to={to} className="flex items-center justify-center px-4 py-3 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors text-center">
      {label}
    </Link>
  );
}

function HealthItem({ label, count, to, severity = "warning" }: { label: string; count: number; to: string; severity?: "warning" | "error" }) {
  if (count === 0) return null;
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg ${severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
      <span className="text-sm font-medium">{label}</span>
      <Link to={to} className="text-sm font-bold underline decoration-dotted">
        {count} issues
      </Link>
    </div>
  );
}

function ComplianceRow({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600">{label}</span>
      <StatusBadge status={status} size="sm" />
    </div>
  );
}
