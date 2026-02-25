import { useContext, useEffect, useMemo, useState, useCallback } from "react";
import { PayrollContext } from "./PayrollShell";
import { supabase } from "../utils/supabaseClient";
import { useOrganization } from "../contexts/OrganizationContext";
import { callEdge } from "../lib/edgeClient";

/* ================================================================
   Types
   ================================================================ */
type PeriodStatus = "draft" | "locked" | "posted" | "challan_generated";

type PayrollPeriod = {
  id: string;
  organization_id: string;
  month: number;
  year: number;
  status: PeriodStatus;
  lock_at: string | null;
  created_at: string;
};

type Employee = {
  id: string;
  name: string | null;
  email: string | null;
  department: string | null;
};

type PayrollRun = {
  id: string;
  payroll_period_id: string;
  user_id: string;
  snapshot: any;
  gross_earnings: number;
  total_deductions: number;
  net_pay: number;
  employer_cost: number;
  status: string | null;
  created_at: string;
};

type EmployeeRow = Employee & {
  hasCompensation: boolean;
  ctcMonthly: number | null;
  presentDays: number | null;
  run: PayrollRun | null;
  processing: boolean;
};

/* ================================================================
   Helpers
   ================================================================ */
const MONTHS = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function money(n: number | null | undefined) {
  if (n == null || !isFinite(n)) return "\u2014";
  return "\u20B9" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  locked: "bg-blue-50 text-blue-700 border-blue-200",
  posted: "bg-green-50 text-green-700 border-green-200",
  challan_generated: "bg-purple-50 text-purple-700 border-purple-200",
  processed: "bg-green-50 text-green-700 border-green-200",
  pending: "bg-gray-100 text-gray-600 border-gray-200",
  finalized: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "no comp": "bg-red-50 text-red-600 border-red-200",
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] || "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** Call edge function that does NOT use shared ok() wrapper (bootstrap, period-fetch) */
async function callEdgeRaw<T>(name: string, body: any): Promise<T | null> {
  try {
    let base = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined;
    if (!base) {
      const u = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      if (u) base = `${u.replace(/\/?$/, "")}/functions/v1`;
    }
    if (!base) throw new Error("No functions URL");
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const res = await fetch(`${base}/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || res.statusText);
    }
    const json = await res.json();
    // Handle both { ok, data } wrapper and raw responses
    return (json?.data !== undefined ? json.data : json) as T;
  } catch (err) {
    console.error(`[callEdgeRaw] ${name}:`, err);
    return null;
  }
}
/* ================================================================
   Main Component
   ================================================================ */
export default function PayrollPeriodBoard() {
  const { month, year, orgId: ctxOrgId } = useContext(PayrollContext);
  const { organizationId: globalOrgId } = useOrganization();
  const orgId = ctxOrgId || globalOrgId;

  /* ---- State ---- */
  const [period, setPeriod] = useState<PayrollPeriod | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "processed" | "pending" | "no-comp">("all");
  const [ptState, setPtState] = useState("GJ");

  const daysInMonth = new Date(year, month, 0).getDate();
  // Working days = calendar days minus Sundays (many Indian orgs work 6 days)
  const workingDays = (() => {
    let wd = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(year, month - 1, d).getDay() !== 0) wd++;
    }
    return wd;
  })();

  /* ---- Fetch everything ---- */
  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      /* 1. Period - query supabase directly (edge fn response format incompatible with callEdge) */
      const { data: periodData } = await supabase
        .from("payroll_periods")
        .select("*")
        .eq("organization_id", orgId)
        .eq("month", month)
        .eq("year", year)
        .maybeSingle();
      setPeriod(periodData);
      console.log("[PeriodBoard] period:", periodData);

      /* 2. Org employees */
      const { data: emps } = await supabase
        .from("users")
        .select("id, name, email, department")
        .eq("organization_id", orgId)
        .order("name");

      /* 3. Compensation with CTC (direct query instead of edge fn for richer data) */
      const periodEnd = new Date(year, month, 0);
      const periodStart = new Date(year, month - 1, 1);
      const endISO = periodEnd.toISOString().slice(0, 10);
      const startISO = periodStart.toISOString().slice(0, 10);

      const { data: compRows } = await supabase
        .from("employee_compensation")
        .select("user_id, ctc_annual")
        .eq("organization_id", orgId)
        .lte("effective_from", endISO)
        .or(`effective_to.is.null,effective_to.gte.${startISO}`);

      const compMap: Record<string, number> = {};
      (compRows ?? []).forEach((c: any) => {
        compMap[c.user_id] = Number(c.ctc_annual) / 12;
      });
      console.log("[PeriodBoard] compensation map:", compMap, "from rows:", compRows);

      /* 4. Attendance present days (exclude weekends/holidays to match SQL proration) */
      const { data: attRows } = await supabase
        .from("attendance")
        .select("user_id, is_half_day")
        .eq("organization_id", orgId)
        .gte("date", startISO)
        .lte("date", endISO)
        .not("is_absent", "eq", true)
        .not("is_weekend", "eq", true)
        .not("is_holiday", "eq", true);

      const daysMap: Record<string, number> = {};
      (attRows ?? []).forEach((a: any) => {
        daysMap[a.user_id] = (daysMap[a.user_id] || 0) + (a.is_half_day ? 0.5 : 1);
      });

      /* 5. Existing payroll runs */
      let runs: PayrollRun[] = [];
      if (periodData?.id) {
        const { data: r } = await supabase
          .from("payroll_runs")
          .select("*")
          .eq("payroll_period_id", periodData.id);
        runs = r ?? [];
      }
      const runMap = Object.fromEntries(runs.map((r) => [r.user_id, r]));

      /* 6. Org statutory profile (for PT state) */
      const { data: statProfile } = await supabase
        .from("org_statutory_profiles")
        .select("pt_state")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (statProfile?.pt_state) setPtState(statProfile.pt_state);

      /* Build rows */
      const rows: EmployeeRow[] = (emps ?? []).map((e: Employee) => ({
        ...e,
        hasCompensation: e.id in compMap,
        ctcMonthly: compMap[e.id] ?? null,
        presentDays: daysMap[e.id] ?? null,
        run: runMap[e.id] ?? null,
        processing: false,
      }));
      setEmployees(rows);
    } catch (err) {
      console.error("[PeriodBoard] refresh error", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, month, year]);

  useEffect(() => { refresh(); }, [refresh]);
  /* ---- Bootstrap period ---- */
  const bootstrapPeriod = async () => {
    if (!orgId) return;
    setBootstrapping(true);
    try {
      await callEdgeRaw("payroll-period-bootstrap", {
        organization_id: orgId, month, year,
      });
      await refresh();
    } catch (err) {
      console.error("[PeriodBoard] bootstrap error", err);
    } finally {
      setBootstrapping(false);
    }
  };

  /* ---- Run single employee payroll (finalize = calculate + save) ---- */
  const runOne = async (userId: string) => {
    if (!period) return;
    setEmployees((prev) =>
      prev.map((e) => (e.id === userId ? { ...e, processing: true } : e))
    );
    try {
      await callEdge("payroll-finalize-run", {
        payroll_period_id: period.id,
        user_id: userId,
        state: ptState,
      });
      await refresh();
    } catch (err) {
      console.error("[PeriodBoard] runOne error", err);
    }
    setEmployees((prev) =>
      prev.map((e) => (e.id === userId ? { ...e, processing: false } : e))
    );
  };

  /* ---- Bulk run all pending ---- */
  const runAll = async () => {
    if (!period) return;
    const pending = employees.filter((e) => e.hasCompensation && !e.run);
    if (pending.length === 0) return;
    setBulkProcessing(true);
    for (const e of pending) {
      setEmployees((prev) =>
        prev.map((r) => (r.id === e.id ? { ...r, processing: true } : r))
      );
      try {
        await callEdge("payroll-finalize-run", {
          payroll_period_id: period.id,
          user_id: e.id,
          state: ptState,
        });
      } catch (err) {
        console.error(`[PeriodBoard] bulk run error for ${e.id}`, err);
      }
      setEmployees((prev) =>
        prev.map((r) => (r.id === e.id ? { ...r, processing: false } : r))
      );
    }
    await refresh();
    setBulkProcessing(false);
  };

  /* ---- Lock / Unlock period ---- */
  const toggleLock = async () => {
    if (!period) return;
    const nextStatus = period.status === "draft" ? "locked" : "draft";
    await supabase.from("payroll_periods")
      .update({ status: nextStatus, lock_at: nextStatus === "locked" ? new Date().toISOString() : null })
      .eq("id", period.id);
    await refresh();
  };

  /* ---- Post / Finalize period ---- */
  const postPeriod = async () => {
    if (!period) return;
    await supabase.from("payroll_periods")
      .update({ status: "posted" })
      .eq("id", period.id);
    await refresh();
  };
  /* ---- Derived data ---- */
  const filtered = useMemo(() => {
    let list = employees;
    if (tab === "processed") list = list.filter((e) => e.run);
    else if (tab === "pending") list = list.filter((e) => e.hasCompensation && !e.run);
    else if (tab === "no-comp") list = list.filter((e) => !e.hasCompensation);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.name?.toLowerCase().includes(q) ||
          e.email?.toLowerCase().includes(q) ||
          e.department?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [employees, tab, search]);

  const totalEmployees = employees.length;
  const processedCount = employees.filter((e) => e.run).length;
  const pendingCount = employees.filter((e) => e.hasCompensation && !e.run).length;
  const noCompCount = employees.filter((e) => !e.hasCompensation).length;
  const totalNet = employees.reduce((s, e) => s + (e.run?.net_pay ?? 0), 0);
  const totalGross = employees.reduce((s, e) => s + (e.run?.gross_earnings ?? 0), 0);
  const totalDeductions = employees.reduce((s, e) => s + (e.run?.total_deductions ?? 0), 0);
  const progress = totalEmployees > 0 ? Math.round((processedCount / totalEmployees) * 100) : 0;

  /* ================================================================
     UI
     ================================================================ */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-10 w-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---- Hero Header ---- */}
      <div className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-500 rounded-2xl p-6 text-white">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">
              {MONTHS[month]} {year} Payroll
            </h2>
            <p className="text-indigo-100 mt-1 text-sm flex items-center gap-2">
              {period ? (
                <>Period Status: <StatusPill status={period.status} />
                  {period.created_at && (
                    <span className="text-indigo-200 text-xs ml-2">
                      Created {new Date(period.created_at).toLocaleDateString("en-IN")}
                    </span>
                  )}
                  {period.status === "draft" && (
                    <span className="text-indigo-200 text-xs ml-2">
                      &mdash; Lock period to run payroll
                    </span>
                  )}
                </>
              ) : "No payroll period initialized yet"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!period && (
              <button
                onClick={bootstrapPeriod}
                disabled={bootstrapping}
                className="px-5 py-2.5 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition disabled:opacity-50"
              >
                {bootstrapping ? "Initializing..." : "Initialize Period"}
              </button>
            )}
            {period?.status === "draft" && (
              <button
                onClick={toggleLock}
                disabled={pendingCount === 0}
                className="px-5 py-2.5 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition disabled:opacity-50"
              >
                Lock &amp; Prepare Payroll
              </button>
            )}
            {period?.status === "locked" && (
              <>
                <button
                  onClick={runAll}
                  disabled={bulkProcessing || pendingCount === 0}
                  className="px-5 py-2.5 bg-white/20 backdrop-blur text-white font-semibold rounded-xl hover:bg-white/30 transition disabled:opacity-50"
                >
                  {bulkProcessing
                    ? "Processing..."
                    : `Run All Pending (${pendingCount})`}
                </button>
                <button onClick={toggleLock}
                  className="px-5 py-2.5 bg-white/20 backdrop-blur text-white font-semibold rounded-xl hover:bg-white/30 transition"
                >
                  Unlock
                </button>
                <button onClick={postPeriod}
                  disabled={pendingCount > 0}
                  className="px-5 py-2.5 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition disabled:opacity-50"
                >
                  Finalize &amp; Post
                </button>
              </>
            )}
            {period?.status === "posted" && (
              <span className="px-4 py-2 bg-green-100 text-green-800 font-semibold rounded-xl text-sm">
                Posted on {period.lock_at ? new Date(period.lock_at).toLocaleDateString("en-IN") : ""}
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {period && (
          <div className="mt-5">
            <div className="flex justify-between text-xs text-indigo-100 mb-1">
              <span>{processedCount} of {totalEmployees} processed</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {/* ---- Stat Cards ---- */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Total Employees", value: String(totalEmployees), color: "text-indigo-600" },
          { label: "Processed", value: String(processedCount), color: "text-green-600" },
          { label: "Pending", value: String(pendingCount), color: "text-amber-600" },
          { label: "No Compensation", value: String(noCompCount), color: "text-red-600" },
          { label: "Working Days", value: String(workingDays), color: "text-blue-600" },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border p-4 shadow-sm hover:shadow-md transition">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* ---- Financial Summary ---- */}
      {processedCount > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Total Gross Earnings", value: money(totalGross) },
            { label: "Total Deductions", value: money(totalDeductions) },
            { label: "Total Net Pay", value: money(totalNet) },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-xl border p-4 shadow-sm">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{c.label}</p>
              <p className="text-xl font-bold mt-1 text-gray-900">{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ---- Tabs + Search ---- */}
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {([
              { key: "all", label: "All", count: totalEmployees },
              { key: "processed", label: "Processed", count: processedCount },
              { key: "pending", label: "Pending", count: pendingCount },
              { key: "no-comp", label: "No Comp", count: noCompCount },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  tab === t.key
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-xs text-gray-400">{t.count}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search employees..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 border rounded-lg text-sm w-60 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>
        {/* ---- Employee Table ---- */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3 text-right">CTC/Month</th>
                <th className="px-4 py-3 text-center">Present Days</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Deductions</th>
                <th className="px-4 py-3 text-right">Net Pay</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400">
                    No employees match the current filter.
                  </td>
                </tr>
              )}
              {filtered.map((emp) => {
                const initials = (emp.name ?? "?")
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <tr key={emp.id} className="hover:bg-gray-50/70 transition">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">{emp.name ?? "Unnamed"}</p>
                          <p className="text-xs text-gray-400 truncate">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{emp.department ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {emp.ctcMonthly ? money(Math.round(emp.ctcMonthly)) : (
                        <span className="text-gray-300 text-xs">Not set</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {emp.presentDays != null ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-semibold text-gray-900">{emp.presentDays}</span>
                          <span className="text-gray-400 text-xs">/ {workingDays}</span>
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">No data</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!emp.hasCompensation ? (
                        <StatusPill status="no comp" />
                      ) : emp.run ? (
                        <StatusPill status={emp.run.status ?? "processed"} />
                      ) : (
                        <StatusPill status="pending" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {emp.run ? money(emp.run.gross_earnings) : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {emp.run ? money(emp.run.total_deductions) : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">
                      {emp.run ? money(emp.run.net_pay) : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {period?.status === "locked" && emp.hasCompensation && !emp.run && (
                        <button
                          onClick={() => runOne(emp.id)}
                          disabled={emp.processing}
                          className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
                        >
                          {emp.processing ? (
                            <span className="flex items-center gap-1">
                              <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                              Running
                            </span>
                          ) : "Calculate"}
                        </button>
                      )}
                      {emp.run && (
                        <button
                          onClick={() => runOne(emp.id)}
                          disabled={emp.processing}
                          className="px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
                        >
                          {emp.processing ? (
                            <span className="flex items-center gap-1">
                              <span className="w-3 h-3 border-2 border-gray-400/40 border-t-gray-600 rounded-full animate-spin" />
                              Running
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Recalculate
                            </span>
                          )}
                        </button>
                      )}
                      {!emp.hasCompensation && !emp.run && (
                        <span className="text-xs text-gray-400 italic">No comp</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>            {/* ---- Totals Footer ---- */}
            {processedCount > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-semibold text-sm border-t-2 border-gray-200">
                  <td className="px-4 py-3" colSpan={5}>
                    Totals ({processedCount} employees processed)
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{money(totalGross)}</td>
                  <td className="px-4 py-3 text-right font-mono">{money(totalDeductions)}</td>
                  <td className="px-4 py-3 text-right font-mono">{money(totalNet)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}