import { useContext, useEffect, useState } from "react";
import { PayrollContext } from "./PayrollShell";
import { supabase } from "../utils/supabaseClient";
import { useOrganization } from "../contexts/OrganizationContext";
import { AsyncSection, PageHeader } from "./widgets/Primitives";
import { DataTable } from "./ui/DataTable";
import { StatusBadge } from "./ui/StatusBadge";

/** ===== Types ===== */
type PayrollRun = {
  id: string;
  user_id: string;
  payroll_period_id: string;
  gross_earnings: number;
  total_deductions: number;
  net_pay: number;
  status: string;
  user?: {
    name: string;
    email: string;
    department?: string;
  };
};

/** ===== Component ===== */
export default function PayrollPeriodBoard() {
  const { month, year } = useContext(PayrollContext);
  const { organizationId } = useOrganization();

  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      // 1. Get period ID
      const { data: period, error: periodErr } = await supabase
        .from('payroll_periods')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle();

      if (periodErr) throw new Error(periodErr.message);
      if (!period) {
        setRuns([]);
        return;
      }

      // 2. Get runs with user details
      const { data: runsData, error: runsErr } = await supabase
        .from('payroll_runs')
        .select(`
          *,
          user:users (
            name,
            email,
            department
          )
        `)
        .eq('payroll_period_id', period.id);

      if (runsErr) throw new Error(runsErr.message);

      // Transform data to flatten user details if needed, but here we keep structure
      setRuns(runsData || []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [organizationId, month, year]);

  // Filtering
  const filteredRuns = runs.filter(r => {
    const matchesSearch = r.user?.name?.toLowerCase().includes(filter.toLowerCase()) ||
      r.user?.email?.toLowerCase().includes(filter.toLowerCase());
    const matchesStatus = statusFilter === "all" || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Payroll Period Board"
          subtitle="Manage individual employee payroll runs"
        />
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative max-w-sm w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500 sm:text-sm">🔍</span>
            </div>
            <input
              type="text"
              placeholder="Search employees..."
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="processed">Processed</option>
              <option value="finalized">Finalized</option>
            </select>
          </div>
        </div>

        <AsyncSection loading={loading} error={err}>
          <DataTable
            data={filteredRuns}
            keyExtractor={(r) => r.id}
            emptyMessage={runs.length === 0 ? "No payroll runs found for this period." : "No employees match your search."}
            columns={[
              {
                header: "Employee",
                cell: (r) => (
                  <div>
                    <div className="font-medium text-gray-900">{r.user?.name || "Unknown"}</div>
                    <div className="text-xs text-gray-500">{r.user?.email}</div>
                  </div>
                )
              },
              {
                header: "Department",
                accessorKey: "user", // We'll use custom cell, but accessorKey helps type inference if we strictly used it
                cell: (r) => <span className="text-gray-600">{r.user?.department || "-"}</span>
              },
              {
                header: "Gross",
                align: "right",
                cell: (r) => <span className="font-medium text-gray-900">{money(r.gross_earnings)}</span>
              },
              {
                header: "Deductions",
                align: "right",
                cell: (r) => <span className="text-red-600">{money(r.total_deductions)}</span>
              },
              {
                header: "Without Deduction",
                align: "right",
                cell: (r) => (
                  <span className="font-medium text-blue-700" title="Net pay if no deductions applied">
                    {money(r.gross_earnings)}
                  </span>
                )
              },
              {
                header: "Net Pay",
                align: "right",
                cell: (r) => <span className="font-bold text-gray-900">{money(r.net_pay)}</span>
              },
              {
                header: "Status",
                align: "center",
                cell: (r) => <StatusBadge status={r.status} />
              },
              {
                header: "Actions",
                align: "right",
                cell: () => (
                  <button className="text-blue-600 hover:text-blue-900 text-sm font-medium">
                    View Details
                  </button>
                )
              }
            ]}
          />
        </AsyncSection>
      </div>
    </div>
  );
}
