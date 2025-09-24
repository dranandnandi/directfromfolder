import { useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import { PayrollContext } from "./PayrollShell";
import { PageHeader, AsyncSection, EmptyState } from "./widgets/Primitives";
import { fetchPayrollPeriod, type PayrollPeriodRow } from "../services/payrollPeriods";

type Period = PayrollPeriodRow | null;

type RunSnapshotItem = {
  code: string;                  // pay_components.code
  name: string;                  // pay_components.name
  type: "earning" | "deduction" | "employer_cost";
  amount: number;
};

type AttendanceSummary = {
  working_days?: number;
  present_days?: number;
  absent_days?: number;
  overtime_hours?: number;
  late_logins?: number;
  leaves?: number;
};

type EmployeeRow = {
  user_id: string;               // users.id
  name: string;                  // users.name
  department: string;            // users.department
  has_active_compensation: boolean; // from employee_compensation effective range
  run_id: string | null;         // payroll_runs.id if exists
  status: "pending" | "processed" | "finalized";
  gross_earnings: number | null;
  total_deductions: number | null;
  net_pay: number | null;
  employer_cost: number | null;
  pf_wages: number | null;
  esic_wages: number | null;
  pt_amount: number | null;
  tds_amount: number | null;
  overrides_count: number;       // attendance_monthly_overrides count for (user, month, year)
  snapshot: RunSnapshotItem[] | null; // derived from payroll_runs.snapshot (jsonb)
  attendance_summary: AttendanceSummary | null; // payroll_runs.attendance_summary
};

type Filters = {
  q: string;
  dept: string;
  status: "all" | "pending" | "processed" | "finalized";
};

export default function PayrollPeriodBoard() {
  const { month, year, orgId } = useContext(PayrollContext);
  const [period, setPeriod] = useState<Period | null>(null);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState<Filters>({ q: "", dept: "all", status: "all" });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"" | "finalize" | "recalc" | "unfinalize" | "finalizeAll">("");

  // bootstrap: ensure a period exists, then load board
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1) Get or create the payroll period
        let p = await fetchPayrollPeriod({ organizationId: orgId, month, year });
        if (!p) {
          const { data: created, error: createErr } = await supabase
            .from('payroll_periods')
            .insert({
              organization_id: orgId,
              month,
              year,
              status: 'draft',
              created_at: new Date().toISOString(),
            })
            .select()
            .single();
          if (createErr) throw new Error(createErr.message);
          p = created as PayrollPeriodRow;
        }
        if (!mounted) return;
        setPeriod(p);

        // 2) Load users for org
        const { data: users, error: usersErr } = await supabase
          .from('users')
          .select('id, name, department')
          .eq('organization_id', orgId);
        if (usersErr) throw new Error(usersErr.message);

        // 3) Load runs for this period
        const { data: runs, error: runsErr } = await supabase
          .from('payroll_runs')
          .select('id, user_id, status, gross_earnings, total_deductions, net_pay, employer_cost, pf_wages, esic_wages, pt_amount, tds_amount, snapshot, attendance_summary')
          .eq('payroll_period_id', p.id);
        if (runsErr) throw new Error(runsErr.message);

        // 4) Load overrides count for this month/year
        const { data: overridesRows, error: overridesErr } = await supabase
          .from('attendance_monthly_overrides')
          .select('user_id')
          .eq('organization_id', orgId)
          .eq('month', month)
          .eq('year', year);
        if (overridesErr) throw new Error(overridesErr.message);
        const overridesCountMap = (overridesRows || []).reduce<Record<string, number>>((acc, r: any) => {
          acc[r.user_id] = (acc[r.user_id] || 0) + 1;
          return acc;
        }, {});

        // 5) Load compensation presence (simplified: any record for user)
        const userIds = (users || []).map(u => u.id);
        let compMap: Record<string, boolean> = {};
        if (userIds.length) {
          const { data: compRows, error: compErr } = await supabase
            .from('employee_compensation')
            .select('user_id')
            .in('user_id', userIds);
          if (compErr) throw new Error(compErr.message);
          compMap = (compRows || []).reduce<Record<string, boolean>>((acc, r: any) => {
            acc[r.user_id] = true;
            return acc;
          }, {});
        }

        // 6) Build board rows
        const runsByUser = (runs || []).reduce<Record<string, any>>((acc, r: any) => {
          acc[r.user_id] = r;
          return acc;
        }, {});

        const board: EmployeeRow[] = (users || []).map((u: any) => {
          const run = runsByUser[u.id];
          return {
            user_id: u.id,
            name: u.name || '(no name)'
            ,
            department: u.department || '-',
            has_active_compensation: !!compMap[u.id],
            run_id: run?.id || null,
            status: (run?.status as EmployeeRow['status']) || 'pending',
            gross_earnings: run?.gross_earnings ?? null,
            total_deductions: run?.total_deductions ?? null,
            net_pay: run?.net_pay ?? null,
            employer_cost: run?.employer_cost ?? null,
            pf_wages: run?.pf_wages ?? null,
            esic_wages: run?.esic_wages ?? null,
            pt_amount: run?.pt_amount ?? null,
            tds_amount: run?.tds_amount ?? null,
            overrides_count: overridesCountMap[u.id] || 0,
            snapshot: run?.snapshot ?? null,
            attendance_summary: run?.attendance_summary ?? null,
          };
        });

        if (mounted) setRows(board);
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to load period board');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [orgId, month, year]);

  // computed
  const departments = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.department && set.add(r.department));
    return ["all", ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesQ =
        !q || r.name.toLowerCase().includes(q) || r.user_id.toLowerCase().includes(q);
      const matchesDept = filters.dept === "all" || r.department === filters.dept;
      const matchesStatus = filters.status === "all" || r.status === filters.status;
      return matchesQ && matchesDept && matchesStatus;
    });
  }, [rows, filters]);

  const allVisibleSelected = useMemo(
    () => filtered.length > 0 && filtered.every((r) => selected[r.user_id]),
    [filtered, selected]
  );

  function toggleAllVisible() {
    const next = { ...selected };
    if (allVisibleSelected) {
      filtered.forEach((r) => delete next[r.user_id]);
    } else {
      filtered.forEach((r) => (next[r.user_id] = true));
    }
    setSelected(next);
  }

  function toggleOne(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function refreshBoard() {
    if (!period?.id) return;
    try {
      const { data: runs, error: runsErr } = await supabase
        .from('payroll_runs')
        .select('id, user_id, status, gross_earnings, total_deductions, net_pay, employer_cost, pf_wages, esic_wages, pt_amount, tds_amount, snapshot, attendance_summary')
        .eq('payroll_period_id', period.id);
      if (runsErr) throw new Error(runsErr.message);
      const runsByUser = (runs || []).reduce<Record<string, any>>((acc, r: any) => {
        acc[r.user_id] = r;
        return acc;
      }, {});
      setRows((prev) =>
        prev.map((r) => {
          const run = runsByUser[r.user_id];
          return {
            ...r,
            run_id: run?.id || null,
            status: (run?.status as EmployeeRow['status']) || 'pending',
            gross_earnings: run?.gross_earnings ?? null,
            total_deductions: run?.total_deductions ?? null,
            net_pay: run?.net_pay ?? null,
            employer_cost: run?.employer_cost ?? null,
            pf_wages: run?.pf_wages ?? null,
            esic_wages: run?.esic_wages ?? null,
            pt_amount: run?.pt_amount ?? null,
            tds_amount: run?.tds_amount ?? null,
            snapshot: run?.snapshot ?? null,
            attendance_summary: run?.attendance_summary ?? null,
          };
        })
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to refresh board');
    }
  }

  async function doAction(
    action: "finalize" | "recalc" | "unfinalize",
    userIds: string[]
  ) {
    if (!period?.id || userIds.length === 0) return;
    setBusyAction(action);
    try {
      if (action === 'recalc') {
        alert('Recalc is a server-side operation and is not implemented in this direct client build.');
      } else {
        const newStatus = action === 'finalize' ? 'finalized' : 'processed';
        const { error } = await supabase
          .from('payroll_runs')
          .update({ status: newStatus })
          .eq('payroll_period_id', period.id)
          .in('user_id', userIds);
        if (error) throw new Error(error.message);
      }
      await refreshBoard();
      // keep selections for convenience (only if still visible)
      setSelected((sel) => {
        const next: Record<string, boolean> = {};
        Object.keys(sel).forEach((id) => {
          if (filtered.find((r) => r.user_id === id)) next[id] = sel[id];
        });
        return next;
      });
    } catch (e: any) {
      alert(e?.message || `Failed to ${action}`);
    } finally {
      setBusyAction("");
    }
  }

  async function finalizeAllPendingVisible() {
    const targets = filtered.filter((r) => r.status !== "finalized").map((r) => r.user_id);
    if (targets.length === 0) return;
    setBusyAction("finalizeAll");
    try {
      await doAction("finalize", targets);
    } finally {
      setBusyAction("");
    }
  }

  const currency = (n?: number | null) =>
    typeof n === "number" ? `₹${n.toLocaleString("en-IN")}` : "-";

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <PageHeader title={`Employee Period Board — ${month}/${year}`} subtitle="Per-employee runs, actions, and breakdown" />

        <AsyncSection loading={loading} error={error}>
          {!period ? (
            <EmptyState title="No period" description="Could not create or load the payroll period." />
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Search (name or user id)</label>
                    <input
                      value={filters.q}
                      onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Ananya / 2fb3…"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                    <select
                      value={filters.dept}
                      onChange={(e) => setFilters((f) => ({ ...f, dept: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {departments.map((d) => (
                        <option key={d} value={d}>
                          {d === "all" ? "All" : d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select
                      value={filters.status}
                      onChange={(e) =>
                        setFilters((f) => ({
                          ...f,
                          status: e.target.value as Filters["status"],
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All</option>
                      <option value="pending">Pending</option>
                      <option value="processed">Processed</option>
                      <option value="finalized">Finalized</option>
                    </select>
                  </div>
                </div>

                {/* Batch actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => doAction("recalc", Object.keys(selected).filter((k) => selected[k]))}
                    disabled={busyAction !== "" || !Object.values(selected).some(Boolean)}
                    className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    {busyAction === "recalc" ? "Recalculating…" : "Recalculate"}
                  </button>
                  <button
                    onClick={() => doAction("unfinalize", Object.keys(selected).filter((k) => selected[k]))}
                    disabled={busyAction !== "" || !Object.values(selected).some(Boolean)}
                    className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    {busyAction === "unfinalize" ? "Reopening…" : "Unfinalize"}
                  </button>
                  <button
                    onClick={() => doAction("finalize", Object.keys(selected).filter((k) => selected[k]))}
                    disabled={busyAction !== "" || !Object.values(selected).some(Boolean)}
                    className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busyAction === "finalize" ? "Finalizing…" : "Finalize"}
                  </button>
                  <button
                    onClick={finalizeAllPendingVisible}
                    disabled={busyAction !== "" || filtered.every((r) => r.status === "finalized")}
                    className="px-3 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {busyAction === "finalizeAll" ? "Finalizing…" : "Finalize All (filtered)"}
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleAllVisible}
                          />
                        </th>
                        <th className="px-4 py-3 text-left">Employee</th>
                        <th className="px-4 py-3 text-left">Dept</th>
                        <th className="px-4 py-3 text-right">Gross</th>
                        <th className="px-4 py-3 text-right">Deductions</th>
                        <th className="px-4 py-3 text-right">Net Pay</th>
                        <th className="px-4 py-3 text-right">Employer Cost</th>
                        <th className="px-4 py-3 text-left">Flags</th>
                        <th className="px-4 py-3 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filtered.map((r) => (
                        <Row
                          key={r.user_id}
                          row={r}
                          selected={!!selected[r.user_id]}
                          onToggle={() => toggleOne(r.user_id)}
                          onAction={doAction}
                          currency={currency}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {filtered.length === 0 && (
                  <div className="p-6">
                    <EmptyState title="No employees match" description="Try clearing filters or search." />
                  </div>
                )}
              </div>
            </>
          )}
        </AsyncSection>
      </div>
    </div>
  );
}

function Row({
  row,
  selected,
  onToggle,
  onAction,
  currency,
}: {
  row: EmployeeRow;
  selected: boolean;
  onToggle: () => void;
  onAction: (a: "finalize" | "recalc" | "unfinalize", ids: string[]) => Promise<void>;
  currency: (n?: number | null) => string;
}) {
  const [open, setOpen] = useState(false);
  const canFinalize = row.status !== "finalized";
  const canUnfinalize = row.status === "finalized";
  const canRecalc = true; // allow recalculation in any state (server decides if a re-run is needed)

  const statusPill =
    row.status === "finalized"
      ? "bg-green-100 text-green-800"
      : row.status === "processed"
      ? "bg-blue-100 text-blue-800"
      : "bg-yellow-100 text-yellow-800";

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-3 align-top">
          <input type="checkbox" checked={selected} onChange={onToggle} />
        </td>
        <td className="px-4 py-3 align-top">
          <div className="font-medium text-gray-900">{row.name}</div>
          <div className="text-xs text-gray-500">{row.user_id}</div>
          <div className="mt-1 inline-flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs ${statusPill}`}>{row.status}</span>
            {!row.has_active_compensation && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800">
                No active compensation
              </span>
            )}
            {row.overrides_count > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">
                {row.overrides_count} override{row.overrides_count > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 align-top">{row.department}</td>
        <td className="px-4 py-3 align-top text-right">{currency(row.gross_earnings)}</td>
        <td className="px-4 py-3 align-top text-right">{currency(row.total_deductions)}</td>
        <td className="px-4 py-3 align-top text-right font-semibold text-green-700">
          {currency(row.net_pay)}
        </td>
        <td className="px-4 py-3 align-top text-right">{currency(row.employer_cost)}</td>
        <td className="px-4 py-3 align-top">
          <div className="text-xs text-gray-700 space-y-1">
            {row.pf_wages !== null && <div>PF wages: {currency(row.pf_wages)}</div>}
            {row.esic_wages !== null && <div>ESIC wages: {currency(row.esic_wages)}</div>}
            {row.pt_amount !== null && <div>PT: {currency(row.pt_amount)}</div>}
            {row.tds_amount !== null && <div>TDS: {currency(row.tds_amount)}</div>}
          </div>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onAction("recalc", [row.user_id])}
              disabled={!canRecalc}
              className="px-3 py-1 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
              title="Recalculate payroll"
            >
              Recalc
            </button>
            <button
              onClick={() => onAction("unfinalize", [row.user_id])}
              disabled={!canUnfinalize}
              className="px-3 py-1 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
              title="Unfinalize this run"
            >
              Unfinalize
            </button>
            <button
              onClick={() => onAction("finalize", [row.user_id])}
              disabled={!canFinalize}
              className="px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              title="Finalize this run"
            >
              Finalize
            </button>
            <button
              onClick={() => setOpen((o) => !o)}
              className="px-3 py-1 rounded-md border bg-white hover:bg-gray-50"
              title="Toggle breakdown"
            >
              {open ? "Hide" : "View"}
            </button>
          </div>
        </td>
      </tr>

      {open && (
        <tr className="bg-gray-50">
          <td colSpan={9} className="px-4 pb-4">
            {/* Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
              <div className="rounded-md border bg-white p-3">
                <div className="text-sm font-medium text-gray-900 mb-2">Earnings</div>
                <ul className="text-sm text-gray-700 space-y-1">
                  {row.snapshot?.filter((x) => x.type === "earning").map((x) => (
                    <li key={x.code} className="flex justify-between">
                      <span>{x.name}</span>
                      <span className="font-medium">{currency(x.amount)}</span>
                    </li>
                  )) || <li className="text-gray-500">No data</li>}
                </ul>
              </div>
              <div className="rounded-md border bg-white p-3">
                <div className="text-sm font-medium text-gray-900 mb-2">Deductions</div>
                <ul className="text-sm text-gray-700 space-y-1">
                  {row.snapshot?.filter((x) => x.type === "deduction").map((x) => (
                    <li key={x.code} className="flex justify-between">
                      <span>{x.name}</span>
                      <span className="font-medium">{currency(x.amount)}</span>
                    </li>
                  )) || <li className="text-gray-500">No data</li>}
                </ul>
              </div>
              <div className="rounded-md border bg-white p-3">
                <div className="text-sm font-medium text-gray-900 mb-2">Attendance Summary</div>
                {row.attendance_summary ? (
                  <ul className="text-sm text-gray-700 space-y-1">
                    {"working_days" in row.attendance_summary && (
                      <li className="flex justify-between">
                        <span>Working days</span>
                        <span className="font-medium">{row.attendance_summary.working_days}</span>
                      </li>
                    )}
                    {"present_days" in row.attendance_summary && (
                      <li className="flex justify-between">
                        <span>Present days</span>
                        <span className="font-medium">{row.attendance_summary.present_days}</span>
                      </li>
                    )}
                    {"absent_days" in row.attendance_summary && (
                      <li className="flex justify-between">
                        <span>Absent days</span>
                        <span className="font-medium">{row.attendance_summary.absent_days}</span>
                      </li>
                    )}
                    {"overtime_hours" in row.attendance_summary && (
                      <li className="flex justify-between">
                        <span>OT hours</span>
                        <span className="font-medium">{row.attendance_summary.overtime_hours}</span>
                      </li>
                    )}
                    {"late_logins" in row.attendance_summary && (
                      <li className="flex justify-between">
                        <span>Late logins</span>
                        <span className="font-medium">{row.attendance_summary.late_logins}</span>
                      </li>
                    )}
                    {"leaves" in row.attendance_summary && (
                      <li className="flex justify-between">
                        <span>Leaves</span>
                        <span className="font-medium">{row.attendance_summary.leaves}</span>
                      </li>
                    )}
                  </ul>
                ) : (
                  <div className="text-sm text-gray-500">No attendance summary</div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
