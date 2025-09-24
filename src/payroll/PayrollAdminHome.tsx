import { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PayrollContext } from "./PayrollShell";
import { supabase } from "../utils/supabaseClient";
import { useOrganization } from "../contexts/OrganizationContext";
import { AsyncSection, EmptyState, PageHeader } from "./widgets/Primitives";

/** ===== Schema-aligned shapes ===== */
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
  pending: number;     // users with no run or not processed
  processed: number;   // computed but not finalized
  finalized: number;   // locked/finalized
  total_users: number; // active employees in org for this period
};

type MoneyTotals = {
  gross_earnings: number;   // SUM(payroll_runs.gross_earnings)
  total_deductions: number; // SUM(payroll_runs.total_deductions)
  net_pay: number;          // SUM(payroll_runs.net_pay)
  employer_cost: number;    // SUM(payroll_runs.employer_cost)
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
  missing_compensation: number;   // users without active employee_compensation covering this period
  overrides_pending: number;      // attendance_monthly_overrides rows missing approval (if you use approved_by/at)
  negative_netpays: number;       // count of runs with net_pay < 0
  tds_outliers: number;           // runs with unusually high TDS (server-defined)
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
      // 1) Get period for org+month+year
      const { data: periodRow, error: periodErr } = await supabase
        .from('payroll_periods')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle();

      if (periodErr) {
        console.error('[PayrollAdminHome] Failed to fetch payroll_periods', {
          organizationId,
          month,
          year,
          error: periodErr,
        });
        throw new Error(periodErr.message);
      }

      const period = periodRow || null;

      // 2) Get runs by payroll_period_id (schema does not have org/month/year on runs)
      let runs: any[] = [];
      if (period?.id) {
        const { data: runsData, error: runsErr } = await supabase
          .from('payroll_runs')
          .select('*')
          .eq('payroll_period_id', period.id);

        if (runsErr) {
          console.error('[PayrollAdminHome] Failed to fetch payroll_runs', {
            payroll_period_id: period.id,
            error: runsErr,
          });
          throw new Error(runsErr.message);
        }
        runs = runsData || [];
      }
      
      // Calculate summary statistics  
      const runsSummary: RunStatusFacet = {
        pending: 0, // TODO: Calculate users without runs
        processed: runs.filter(r => r.status === 'processed').length,
        finalized: runs.filter(r => r.status === 'finalized').length,
        total_users: runs.length // Simplified - actual should be total active employees
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
        missing_compensation: 0, // TODO: Query compensation table
        overrides_pending: 0, // TODO: Query overrides table
        negative_netpays: runs.filter(r => (r.net_pay || 0) < 0).length,
        tds_outliers: 0 // TODO: Calculate TDS outliers
      };

      const filingsSummary: FilingsSummary = {
        pf: 'absent',
        esic: 'absent', 
        pt: 'absent',
        tds24q: 'absent'
      };

      const res: AdminHomeSummary = {
        period,
        runs: runsSummary,
        totals: totalsSummary,
        attendance: attendanceSummary,
        health: healthSummary,
        filings: filingsSummary
      };
      setSummary(res);
    } catch (e: any) {
      setErr(e?.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, month, year]);

  const periodId = summary?.period?.id || null;

  const pct = (num: number, den: number) => {
    if (!den) return "0%";
    return `${Math.round((num / den) * 100)}%`;
    };

  const money = (n?: number) =>
    typeof n === "number" ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "₹0";

  const disableWhenNoPeriod = !periodId;

  async function runAction(key: ActionKey) {
    if (!organizationId) return;
    setBusy(key);
    try {
      switch (key) {
        case "bootstrap":
          // Create a new payroll period directly
          const { error: bootstrapError } = await supabase
            .from('payroll_periods')
            .insert({
              organization_id: organizationId,
              month,
              year,
              status: 'draft' as PeriodStatus,
              created_at: new Date().toISOString()
            });
          
          if (bootstrapError) throw new Error(`Bootstrap failed: ${bootstrapError.message}`);
          break;
        case "recalc_all":
          // This operation involves complex payroll calculations - would need Edge Function
          // For now, we'll show a placeholder message
          alert("Recalculate all feature needs to be implemented with proper payroll calculation logic");
          break;
        case "finalize_all":
          // Update all payroll runs for this period to finalized status
          if (!periodId) throw new Error('No payroll period');
          const { error: finalizeError } = await supabase
            .from('payroll_runs')
            .update({ status: 'finalized' })
            .eq('payroll_period_id', periodId);
          
          if (finalizeError) throw new Error(`Finalize failed: ${finalizeError.message}`);
          break;
        case "unfinalize_all":
          // Update all payroll runs for this period back to processed status
          if (!periodId) throw new Error('No payroll period');
          const { error: unfinalizeError } = await supabase
            .from('payroll_runs')
            .update({ status: 'processed' })
            .eq('payroll_period_id', periodId);
          
          if (unfinalizeError) throw new Error(`Unfinalize failed: ${unfinalizeError.message}`);
          break;
        case "lock_period":
          // Update period status to locked
          const { error: lockError } = await supabase
            .from('payroll_periods')
            .update({ 
              status: 'locked' as PeriodStatus,
              lock_at: new Date().toISOString()
            })
            .eq('id', periodId)
            .eq('organization_id', organizationId);
          
          if (lockError) throw new Error(`Lock failed: ${lockError.message}`);
          break;
        case "reopen_period":
          // Update period status to draft and clear lock timestamp
          const { error: reopenError } = await supabase
            .from('payroll_periods')
            .update({ 
              status: 'draft' as PeriodStatus,
              lock_at: null
            })
            .eq('id', periodId)
            .eq('organization_id', organizationId);
          
          if (reopenError) throw new Error(`Reopen failed: ${reopenError.message}`);
          break;
        case "post_period":
          // Update period status to posted
          const { error: postError } = await supabase
            .from('payroll_periods')
            .update({ status: 'posted' as PeriodStatus })
            .eq('id', periodId)
            .eq('organization_id', organizationId);
          
          if (postError) throw new Error(`Post failed: ${postError.message}`);
          break;
      }
      await load();
    } catch (e: any) {
      alert(e?.message || "Action failed");
    } finally {
      setBusy("");
    }
  }

  const runFacet = summary?.runs;
  const cards: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }[] = useMemo(() => {
    if (!summary) return [];
    const { totals, runs, attendance } = summary;
    const processed = runs.total_users - runs.pending;
    return [
      { label: "Employees", value: runs.total_users.toLocaleString("en-IN"), sub: `${processed}/${runs.total_users} processed` },
      { label: "Finalized", value: runs.finalized.toLocaleString("en-IN"), sub: pct(runs.finalized, runs.total_users) },
      { label: "Gross", value: money(totals.gross_earnings) },
      { label: "Deductions", value: money(totals.total_deductions) },
      { label: "Net Pay", value: money(totals.net_pay) },
      {
        label: "Attendance rows",
        value: attendance.rows_total.toLocaleString("en-IN"),
        sub:
          attendance.status
            ? `${attendance.status} • will apply ${attendance.rows_will_apply.toLocaleString("en-IN")}`
            : "no import",
      },
    ];
  }, [summary]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-lg border shadow-sm p-6">
        <PageHeader
          title="Payroll Dashboard"
          subtitle="One place to monitor and drive the monthly run"
        />

        <AsyncSection loading={loading} error={err}>
          {!summary ? (
            <EmptyState
              title="No period yet"
              description="Create the period and start your month."
              action={
                <div className="mt-3">
                  <button
                    onClick={() => runAction("bootstrap")}
                    className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Create period for {month}/{year}
                  </button>
                </div>
              }
            />
          ) : (
            <>
              {/* Period Ribbon */}
              <div className="flex items-center justify-between rounded-lg border p-4 bg-gray-50 mb-4">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-800">
                    Period: {summary.period?.id || "—"}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      summary.period?.status === "draft"
                        ? "bg-yellow-100 text-yellow-800"
                        : summary.period?.status === "locked"
                        ? "bg-blue-100 text-blue-800"
                        : summary.period?.status === "posted"
                        ? "bg-green-100 text-green-800"
                        : "bg-purple-100 text-purple-800"
                    }`}
                  >
                    {summary.period?.status}
                  </span>
                  {summary.period?.lock_at && (
                    <span className="text-xs text-gray-600">
                      Locked at {new Date(summary.period.lock_at).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => runAction("recalc_all")}
                    disabled={disableWhenNoPeriod || !!busy}
                    className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    {busy === "recalc_all" ? "Recalculating…" : "Recalculate all"}
                  </button>
                  <button
                    onClick={() => runAction("finalize_all")}
                    disabled={disableWhenNoPeriod || !!busy}
                    className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy === "finalize_all" ? "Finalizing…" : "Finalize all"}
                  </button>
                  <button
                    onClick={() => runAction("unfinalize_all")}
                    disabled={disableWhenNoPeriod || !!busy}
                    className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    {busy === "unfinalize_all" ? "Reopening…" : "Unfinalize all"}
                  </button>
                  {summary.period?.status !== "locked" ? (
                    <button
                      onClick={() => runAction("lock_period")}
                      disabled={disableWhenNoPeriod || !!busy}
                      className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      {busy === "lock_period" ? "Locking…" : "Lock period"}
                    </button>
                  ) : (
                    <button
                      onClick={() => runAction("reopen_period")}
                      disabled={disableWhenNoPeriod || !!busy}
                      className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      {busy === "reopen_period" ? "Reopening…" : "Reopen"}
                    </button>
                  )}
                  <button
                    onClick={() => runAction("post_period")}
                    disabled={disableWhenNoPeriod || !!busy}
                    className="px-3 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {busy === "post_period" ? "Posting…" : "Post period"}
                  </button>
                </div>
              </div>

              {/* KPI Cards */}
              <section className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
                {cards.map((c, i) => (
                  <KpiCard key={i} label={c.label} value={c.value} sub={c.sub} />
                ))}
              </section>

              {/* Run Progress */}
              <section className="rounded-lg border bg-white p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-gray-900">Run progress</div>
                  <Link to="/payroll/period-board" className="text-sm text-blue-600 hover:underline">
                    Open Period Board →
                  </Link>
                </div>
                {!runFacet ? (
                  <EmptyState title="No data" description="Recalculate or import attendance to start." />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Progress label="Pending" value={runFacet.pending} total={runFacet.total_users} tone="warn" />
                    <Progress label="Processed" value={runFacet.processed} total={runFacet.total_users} />
                    <Progress label="Finalized" value={runFacet.finalized} total={runFacet.total_users} tone="ok" />
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-gray-500 mb-1">Quick actions</div>
                      <div className="flex flex-wrap gap-2">
                        <Link to="/payroll/import/upload" className="px-2 py-1 rounded-md border bg-white hover:bg-gray-50 text-xs">
                          Upload attendance
                        </Link>
                        <Link to="/payroll/import/review" className="px-2 py-1 rounded-md border bg-white hover:bg-gray-50 text-xs">
                          Review rows
                        </Link>
                        <Link to="/payroll/import/overrides" className="px-2 py-1 rounded-md border bg-white hover:bg-gray-50 text-xs">
                          Apply overrides
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Compliance & Health */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Compliance */}
                <div className="rounded-lg border bg-white p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-gray-900">Statutory compliance</div>
                    <Link to="/payroll/statutory" className="text-sm text-blue-600 hover:underline">
                      Go to Statutory →
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FilingPill label="PF / ECR" state={summary.filings.pf} />
                    <FilingPill label="ESIC" state={summary.filings.esic} />
                    <FilingPill label="PT" state={summary.filings.pt} />
                    <FilingPill label="TDS 24Q" state={summary.filings.tds24q} />
                  </div>
                </div>

                {/* Health */}
                <div className="rounded-lg border bg-white p-4">
                  <div className="text-sm font-medium text-gray-900 mb-2">Period health</div>
                  <ul className="text-sm text-gray-800 space-y-2">
                    <HealthRow label="Employees missing active compensation" value={summary.health.missing_compensation} to="/payroll/compensation" />
                    <HealthRow label="Overrides pending approval" value={summary.health.overrides_pending} to="/payroll/import/overrides" />
                    <HealthRow label="Negative net pays" value={summary.health.negative_netpays} to="/payroll/period-board" tone="bad" />
                    <HealthRow label="TDS outliers" value={summary.health.tds_outliers} to="/payroll/period-board" tone="warn" />
                  </ul>
                </div>
              </section>
            </>
          )}
        </AsyncSection>
      </div>
    </div>
  );
}

/** ===== Small UI bits ===== */
function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-600 mt-1">{sub}</div>}
    </div>
  );
}

function Progress({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone?: "ok" | "warn";
}) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const bar =
    tone === "ok" ? "bg-green-500" : tone === "warn" ? "bg-yellow-500" : "bg-blue-500";
  return (
    <div className="rounded-md border p-3">
      <div className="text-sm text-gray-700 mb-1">{label}</div>
      <div className="h-2 w-full bg-gray-200 rounded">
        <div className={`h-2 ${bar} rounded`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-gray-600 mt-1">
        {value.toLocaleString("en-IN")} / {total.toLocaleString("en-IN")} ({pct}%)
      </div>
    </div>
  );
}

function FilingPill({ label, state }: { label: string; state: "absent" | "draft" | "generated" | "filed" }) {
  const map: Record<string, string> = {
    absent: "bg-gray-100 text-gray-800",
    draft: "bg-yellow-100 text-yellow-800",
    generated: "bg-blue-100 text-blue-800",
    filed: "bg-green-100 text-green-800",
  };
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="text-sm text-gray-800">{label}</div>
      <span className={`px-2 py-0.5 rounded-full text-xs ${map[state]}`}>{state}</span>
    </div>
  );
}

function HealthRow({
  label,
  value,
  to,
  tone,
}: {
  label: string;
  value: number;
  to: string;
  tone?: "warn" | "bad";
}) {
  const dot =
    tone === "bad" ? "bg-red-500" : tone === "warn" ? "bg-yellow-500" : "bg-gray-300";
  return (
    <li className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <span>{label}</span>
      </div>
      <Link to={to} className="text-sm text-blue-600 hover:underline">
        {value.toLocaleString("en-IN")}
      </Link>
    </li>
  );
}
