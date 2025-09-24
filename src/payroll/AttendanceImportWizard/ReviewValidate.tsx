import { useContext, useEffect, useMemo, useState } from "react";
import { PayrollContext } from "../PayrollShell";
import { PageHeader, AsyncSection, EmptyState } from "../widgets/Primitives";
import { Link } from "react-router-dom";
import { supabase, retryOperation } from "../../utils/supabaseClient";

/**
 * Schema alignment:
 * - attendance_import_batches: id, organization_id, month, year, source, file_url, status
 * - attendance_import_rows: id, batch_id, raw jsonb, normalized jsonb, user_id uuid|null,
 *   match_confidence numeric, is_duplicate boolean, validation_errors text[]|null,
 *   decision 'pending'|'accept'|'reject', notes text|null
 *
 * Direct Supabase replacement implemented in this component for:
 * - Loading latest batch for the period and computing facets/totals client-side
 * - Listing rows with filters, pagination, and hydration of user metadata
 * - Bulk decision updates, note updates, and marking batch validated
 */

type BatchStatus = "uploaded" | "mapped" | "validated" | "applied" | "rejected";
type SourceType = "excel" | "csv" | "biometric";

type ImportBatch = {
  id: string;
  organization_id: string;
  month: number;
  year: number;
  source: SourceType;
  file_url: string | null;
  status: BatchStatus;
  created_at: string;
};

type Facets = {
  pending: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  errors: number;
  total: number;
  will_apply_rows: number; // rows that are accepted and error-free
};

type ReviewSummary = {
  batch: ImportBatch | null;
  facets: Facets;
  totals: {
    matched_users: number;
    avg_match_confidence: number;
  };
};

type RowDecision = "pending" | "accept" | "reject";

type AttendanceRow = {
  id: string;
  batch_id: string;
  user_id: string | null;
  match_confidence: number; // 0..100
  is_duplicate: boolean;
  validation_errors: string[] | null;
  decision: RowDecision;
  notes: string | null;
  // JSON shapes persisted from staging
  raw: Record<string, any>;
  normalized: {
    employee_code?: string;
    date?: string;            // ISO or parseable
    check_in?: string | null; // HH:mm or ISO
    check_out?: string | null;
    hours?: number | null;
    overtime_hours?: number | null;
    remarks?: string | null;
    shift_code?: string | null;
    break_minutes?: number | null;
    [k: string]: any;
  };
  // hydrated for UI
  employee?: { id: string; code?: string | null; name?: string | null; department?: string | null } | null;
};

// Note: list response is constructed locally from Supabase results

type Filters = {
  q: string;
  status: "all" | "pending" | "accept" | "reject";
  onlyDuplicates: boolean;
  onlyErrors: boolean;
  sort: "created_at_asc" | "created_at_desc" | "conf_desc" | "conf_asc" | "date_asc" | "date_desc";
};

const PAGE_SIZE = 20;

export default function ReviewValidate() {
  const { orgId, month, year } = useContext(PayrollContext);

  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // table state
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tableBusy, setTableBusy] = useState(false);

  const [filters, setFilters] = useState<Filters>({
    q: "",
    status: "all",
    onlyDuplicates: false,
    onlyErrors: false,
    sort: "created_at_desc",
  });

  // selection
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // Helpers
  async function loadLatestBatch(organization_id: string, month: number, year: number): Promise<ImportBatch | null> {
    const { data, error } = await retryOperation<any>(() =>
      supabase
        .from("attendance_import_batches")
        .select("id, organization_id, month, year, source, file_url, status, created_at")
        .eq("organization_id", organization_id)
        .eq("month", month)
        .eq("year", year)
        .order("created_at", { ascending: false })
        .limit(1)
    );
    if (error) throw error;
    return (data && data[0]) || null;
  }

  async function computeSummary(batch: ImportBatch): Promise<ReviewSummary> {
    // We'll compute via a couple of targeted count queries + one small sample for averages.
    // counts and aggregates are fetched through dedicated queries below

    const [totalRes, pendingRes, acceptRes, rejectRes, dupRes, errRes, willApplyRes, sampleRes, matchedRes] = await Promise.all([
      retryOperation<any>(() =>
        supabase.from("attendance_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batch.id)
      ),
      retryOperation<any>(() =>
        supabase.from("attendance_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).eq("decision", "pending")
      ),
      retryOperation<any>(() =>
        supabase.from("attendance_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).eq("decision", "accept")
      ),
      retryOperation<any>(() =>
        supabase.from("attendance_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).eq("decision", "reject")
      ),
      retryOperation<any>(() =>
        supabase.from("attendance_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).eq("is_duplicate", true)
      ),
      // Approximate errors as validation_errors not null
      retryOperation<any>(() =>
        supabase.from("attendance_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).not("validation_errors", "is", null)
      ),
      // Accepted, not duplicate, no errors considered eligible to apply
      retryOperation<any>(() =>
        supabase
          .from("attendance_import_rows")
          .select("id", { count: "exact", head: true })
          .eq("batch_id", batch.id)
          .eq("decision", "accept")
          .eq("is_duplicate", false)
          .is("validation_errors", null)
      ),
      // Sample for avg confidence (limited payload)
      retryOperation<any>(() =>
        supabase.from("attendance_import_rows").select("match_confidence").eq("batch_id", batch.id).limit(10000)
      ),
      // Matched users set (limited payload) for distinct count approximation
      retryOperation<any>(() =>
        supabase.from("attendance_import_rows").select("user_id").eq("batch_id", batch.id).neq("user_id", null).limit(10000)
      ),
    ]);

    const matchVals: number[] = (sampleRes.data || [])
      .map((r: any) => (typeof r.match_confidence === "number" ? r.match_confidence : undefined))
      .filter((n: any) => typeof n === "number");
    const avg = matchVals.length ? matchVals.reduce((a, b) => a + b, 0) / matchVals.length : 0;
    const distinctUsers = new Set<string>();
    (matchedRes.data || []).forEach((r: any) => {
      if (r.user_id) distinctUsers.add(r.user_id);
    });

    const facets: Facets = {
      total: totalRes.count || 0,
      pending: pendingRes.count || 0,
      accepted: acceptRes.count || 0,
      rejected: rejectRes.count || 0,
      duplicates: dupRes.count || 0,
      errors: errRes.count || 0,
      will_apply_rows: willApplyRes.count || 0,
    };

    return {
      batch,
      facets,
      totals: {
        matched_users: distinctUsers.size,
        avg_match_confidence: avg,
      },
    };
  }

  async function loadRows(batchId: string): Promise<{ rows: AttendanceRow[]; total: number }> {
    let query = supabase
      .from("attendance_import_rows")
      .select("id,batch_id,user_id,match_confidence,is_duplicate,validation_errors,decision,notes,raw,normalized,created_at", { count: "exact" })
      .eq("batch_id", batchId);

    // filters
    if (filters.status !== "all") query = query.eq("decision", filters.status);
    if (filters.onlyDuplicates) query = query.eq("is_duplicate", true);
    if (filters.q) {
      // Search in user_id and normalized->>employee_code
      const q = `%${filters.q}%`;
      query = query.or(
        `user_id.ilike.${q},normalized->>employee_code.ilike.${q}`
      );
    }

    // Server-side sort for a few known fields; else we'll sort client-side
    if (filters.sort === "created_at_asc") query = query.order("created_at", { ascending: true, nullsFirst: true });
    else if (filters.sort === "created_at_desc") query = query.order("created_at", { ascending: false, nullsFirst: false });
    // Other sorts (confidence/date) will be handled client-side after fetch

    // pagination
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

  const { data, error, count } = await retryOperation<any>(() => query.range(from, to));
    if (error) throw error;
    let fetched: AttendanceRow[] = (data || []) as any;

    // hydrate employee meta
    const ids = Array.from(new Set(fetched.map((r) => r.user_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: usersData, error: uErr } = await retryOperation<any>(() =>
        supabase.from("users").select("id,name,department,email").in("id", ids)
      );
      if (!uErr && usersData) {
  const byId = new Map<string, any>(usersData.map((u: any) => [u.id, u]));
        fetched = fetched.map((r: any) => ({
          ...r,
          employee: r.user_id ? {
            id: r.user_id,
            name: byId.get(r.user_id)?.name ?? null,
            department: byId.get(r.user_id)?.department ?? null,
            code: byId.get(r.user_id)?.email ?? null, // no code column; show email if available
          } : null,
        }));
      }
    }

    // client-side sort fallback
    if (filters.sort === "conf_desc") fetched.sort((a, b) => (b.match_confidence || 0) - (a.match_confidence || 0));
    if (filters.sort === "conf_asc") fetched.sort((a, b) => (a.match_confidence || 0) - (b.match_confidence || 0));
    if (filters.sort === "date_desc") fetched.sort((a, b) => (new Date(b.normalized?.date || 0).getTime()) - (new Date(a.normalized?.date || 0).getTime()));
    if (filters.sort === "date_asc") fetched.sort((a, b) => (new Date(a.normalized?.date || 0).getTime()) - (new Date(b.normalized?.date || 0).getTime()));

    // client-side onlyErrors filter (approximate)
    let visible = fetched;
    if (filters.onlyErrors) visible = visible.filter((r) => Array.isArray(r.validation_errors) && r.validation_errors.length > 0);

    return { rows: visible, total: count || visible.length };
  }

  // load summary (batch + facets)
  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadErr(null);
      try {
        const batch = await loadLatestBatch(orgId, month, year);
        if (!batch) {
          setSummary({
            batch: null,
            facets: { total: 0, pending: 0, accepted: 0, rejected: 0, duplicates: 0, errors: 0, will_apply_rows: 0 },
            totals: { matched_users: 0, avg_match_confidence: 0 },
          });
        } else {
          const s = await computeSummary(batch);
          setSummary(s);
        }
      } catch (e: any) {
        setLoadErr(e?.message || "Failed to load review summary");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, month, year]);

  // load list
  useEffect(() => {
    (async () => {
      if (!summary?.batch?.id) return;
      setTableBusy(true);
      try {
        const res = await loadRows(summary.batch.id);
        setRows(res.rows);
        setTotal(res.total);
        // keep selection only for visible rows
        setSelected((prev) => {
          const next: Record<string, boolean> = {};
          res.rows.forEach((r: any) => {
            if (prev[r.id]) next[r.id] = true;
          });
          return next;
        });
      } catch (e: any) {
        setLoadErr(e?.message || "Failed to load rows");
      } finally {
        setTableBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.batch?.id, page, filters.q, filters.status, filters.onlyDuplicates, filters.onlyErrors, filters.sort]);

  // computed
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allVisibleSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => !!selected[r.id]),
    [rows, selected]
  );

  function toggleAllVisible() {
    const next = { ...selected };
    if (allVisibleSelected) {
      rows.forEach((r) => delete next[r.id]);
    } else {
      rows.forEach((r) => (next[r.id] = true));
    }
    setSelected(next);
  }

  function toggleOne(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function bulkAction(action: RowDecision) {
    if (!Object.values(selected).some(Boolean)) return;
    const ids = Object.keys(selected).filter((k) => selected[k]);
    setTableBusy(true);
    try {
      const { error } = await retryOperation(() =>
        supabase.from("attendance_import_rows").update({ decision: action }).in("id", ids)
      );
      if (error) throw error;
      await refreshList();
      // keep selection on still visible rows
      setSelected((prev) => {
        const next: Record<string, boolean> = {};
        rows.forEach((r) => {
          if (prev[r.id]) next[r.id] = true;
        });
        return next;
      });
    } catch (e: any) {
      alert(e?.message || "Bulk action failed");
    } finally {
      setTableBusy(false);
    }
  }

  async function updateNote(rowId: string, notes: string) {
    try {
      const { error } = await retryOperation(() =>
        supabase.from("attendance_import_rows").update({ notes }).eq("id", rowId)
      );
      if (error) throw error;
    } catch (e: any) {
      alert(e?.message || "Failed to save note");
    }
  }

  async function markValidated() {
    if (!summary?.batch?.id) return;
    if (!confirm("Mark this batch as VALIDATED? Accepted rows will be eligible for Apply Overrides.")) return;
    setLoading(true);
    try {
      const { error } = await retryOperation(() =>
        supabase.from("attendance_import_batches").update({ status: "validated" }).eq("id", summary.batch!.id)
      );
      if (error) throw error;
      const batch = await loadLatestBatch(orgId, month, year);
      if (batch) {
        const s = await computeSummary(batch);
        setSummary(s);
      }
    } catch (e: any) {
      alert(e?.message || "Unable to mark as validated");
    } finally {
      setLoading(false);
    }
  }

  async function refreshList() {
    if (!summary?.batch?.id) return;
    const res = await loadRows(summary.batch.id);
    setRows(res.rows);
    setTotal(res.total);
  }

  const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString() : "-");
  const fmtTime = (s?: string | null) => (s ? s : "-");
  const fmtNum = (n?: number | null) => (typeof n === "number" ? n.toLocaleString("en-IN") : "-");
  const confBadge = (n: number) =>
    n >= 90 ? "bg-green-100 text-green-800" : n >= 70 ? "bg-blue-100 text-blue-800" : "bg-yellow-100 text-yellow-800";

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-lg border shadow-sm p-6">
        <PageHeader
          title="Review & Validate Attendance"
          subtitle="Resolve duplicates and errors, accept or reject each row, then mark the batch validated"
        />

        <AsyncSection loading={loading} error={loadErr}>
          {!summary?.batch ? (
            <EmptyState
              title="No batch found"
              description="Upload and map an attendance file first."
            />
          ) : (
            <>
              {/* Batch ribbon */}
              <div className="flex items-center justify-between rounded-lg border p-4 bg-gray-50 mb-4">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-800">Batch: {summary.batch.id}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">{summary.batch.source}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      summary.batch.status === "applied"
                        ? "bg-green-100 text-green-800"
                        : summary.batch.status === "validated"
                        ? "bg-blue-100 text-blue-800"
                        : summary.batch.status === "mapped"
                        ? "bg-purple-100 text-purple-800"
                        : summary.batch.status === "rejected"
                        ? "bg-red-100 text-red-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {summary.batch.status}
                  </span>
                  {summary.batch.file_url && (
                    <a
                      href={summary.batch.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Download source
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to="/payroll/import/upload" className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50">
                    Upload & Map
                  </Link>
                  <Link to="/payroll/import/overrides" className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50">
                    Apply Overrides
                  </Link>
                  <button
                    onClick={markValidated}
                    disabled={summary.batch.status === "validated"}
                    className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Mark Validated
                  </button>
                </div>
              </div>

              {/* Facets */}
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-4">
                <FacetCard label="Total" value={summary.facets.total} />
                <FacetCard label="Pending" value={summary.facets.pending} />
                <FacetCard label="Accepted" value={summary.facets.accepted} tone="success" />
                <FacetCard label="Rejected" value={summary.facets.rejected} tone="danger" />
                <FacetCard label="Duplicates" value={summary.facets.duplicates} tone="warn" />
                <FacetCard label="Errors" value={summary.facets.errors} tone="warn" />
              </div>

              {/* Filters */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Search (name / code / user id)</label>
                  <input
                    value={filters.q}
                    onChange={(e) => {
                      setPage(1);
                      setFilters((f) => ({ ...f, q: e.target.value }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., EMP001 / Ananya"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Decision</label>
                  <select
                    value={filters.status}
                    onChange={(e) => {
                      setPage(1);
                      setFilters((f) => ({ ...f, status: e.target.value as Filters["status"] }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="accept">Accepted</option>
                    <option value="reject">Rejected</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={filters.onlyDuplicates}
                      onChange={(e) => {
                        setPage(1);
                        setFilters((f) => ({ ...f, onlyDuplicates: e.target.checked }));
                      }}
                    />
                    Duplicates
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={filters.onlyErrors}
                      onChange={(e) => {
                        setPage(1);
                        setFilters((f) => ({ ...f, onlyErrors: e.target.checked }));
                      }}
                    />
                    Errors
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sort</label>
                  <select
                    value={filters.sort}
                    onChange={(e) => {
                      setPage(1);
                      setFilters((f) => ({ ...f, sort: e.target.value as Filters["sort"] }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="created_at_desc">Newest first</option>
                    <option value="created_at_asc">Oldest first</option>
                    <option value="conf_desc">Confidence high → low</option>
                    <option value="conf_asc">Confidence low → high</option>
                    <option value="date_desc">Date new → old</option>
                    <option value="date_asc">Date old → new</option>
                  </select>
                </div>
              </div>

              {/* Batch actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="text-sm text-gray-600">
                  Showing <span className="font-medium">{rows.length}</span> of{" "}
                  <span className="font-medium">{total}</span> rows
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => bulkAction("accept")}
                    disabled={tableBusy || !Object.values(selected).some(Boolean)}
                    className="px-3 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Accept selected
                  </button>
                  <button
                    onClick={() => bulkAction("reject")}
                    disabled={tableBusy || !Object.values(selected).some(Boolean)}
                    className="px-3 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Reject selected
                  </button>
                  <button
                    onClick={() => bulkAction("pending")}
                    disabled={tableBusy || !Object.values(selected).some(Boolean)}
                    className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    Reset decision
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
                          <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                        </th>
                        <th className="px-4 py-3 text-left">Employee</th>
                        <th className="px-4 py-3 text-left">Date</th>
                        <th className="px-4 py-3 text-left">In</th>
                        <th className="px-4 py-3 text-left">Out</th>
                        <th className="px-4 py-3 text-right">Hours</th>
                        <th className="px-4 py-3 text-right">OT</th>
                        <th className="px-4 py-3 text-left">Confidence</th>
                        <th className="px-4 py-3 text-left">Flags</th>
                        <th className="px-4 py-3 text-left">Decision</th>
                        <th className="px-4 py-3 text-left">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={11} className="px-6 py-6">
                            <EmptyState title="No rows" description="Try adjusting filters or mapping again." />
                          </td>
                        </tr>
                      )}
                      {rows.map((r) => (
                        <tr key={r.id} className="align-top hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={!!selected[r.id]} onChange={() => toggleOne(r.id)} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">
                              {r.employee?.name || r.normalized.employee_code || "—"}
                            </div>
                            <div className="text-xs text-gray-500">
                              {r.employee?.id || r.user_id || "unmatched"}
                              {r.employee?.department ? ` • ${r.employee.department}` : ""}
                            </div>
                          </td>
                          <td className="px-4 py-3">{fmtDate(r.normalized.date)}</td>
                          <td className="px-4 py-3">{fmtTime(r.normalized.check_in)}</td>
                          <td className="px-4 py-3">{fmtTime(r.normalized.check_out)}</td>
                          <td className="px-4 py-3 text-right">{fmtNum(r.normalized.hours)}</td>
                          <td className="px-4 py-3 text-right">{fmtNum(r.normalized.overtime_hours)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs ${confBadge(r.match_confidence)}`}>
                              {Math.round(r.match_confidence)}%
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1 text-xs">
                              {r.is_duplicate && <FlagPill tone="warn" label="Duplicate" />}
                              {(r.validation_errors || []).map((e, i) => (
                                <FlagPill key={i} tone="danger" label={e} />
                              ))}
                              {!r.is_duplicate && (!r.validation_errors || r.validation_errors.length === 0) && (
                                <span className="text-gray-400">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <DecisionSelect
                              value={r.decision}
                              onChange={async (v) => {
                                const { error } = await retryOperation(() =>
                                  supabase.from("attendance_import_rows").update({ decision: v }).eq("id", r.id)
                                );
                                if (error) alert(error.message);
                                await refreshList();
                              }}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <textarea
                              defaultValue={r.notes || ""}
                              onBlur={(e) => {
                                const newVal = e.currentTarget.value;
                                if (newVal !== (r.notes || "")) updateNote(r.id, newVal);
                              }}
                              rows={2}
                              className="w-64 max-w-[360px] px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Optional reviewer note"
                            />
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-blue-700">Raw</summary>
                              <pre className="mt-1 p-2 bg-gray-50 border rounded text-xs overflow-x-auto">
                                {JSON.stringify(r.raw, null, 2)}
                              </pre>
                            </details>
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-blue-700">Normalized</summary>
                              <pre className="mt-1 p-2 bg-gray-50 border rounded text-xs overflow-x-auto">
                                {JSON.stringify(r.normalized, null, 2)}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {rows.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
                    <div className="text-sm text-gray-600">
                      Page <span className="font-medium">{page}</span> of{" "}
                      <span className="font-medium">{totalPages}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-1 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        Prev
                      </button>
                      <button
                        className="px-3 py-1 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Callouts */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-lg border bg-white p-4">
                  <div className="text-sm text-gray-500">Matched users</div>
                  <div className="text-xl font-semibold text-gray-900">
                    {summary.totals.matched_users.toLocaleString("en-IN")}
                  </div>
                </div>
                <div className="rounded-lg border bg-white p-4">
                  <div className="text-sm text-gray-500">Avg match confidence</div>
                  <div className="text-xl font-semibold text-gray-900">
                    {Math.round(summary.totals.avg_match_confidence)}%
                  </div>
                </div>
                <div className="rounded-lg border bg-white p-4">
                  <div className="text-sm text-gray-500">Eligible to apply</div>
                  <div className="text-xl font-semibold text-gray-900">
                    {summary.facets.will_apply_rows.toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            </>
          )}
        </AsyncSection>
      </div>
    </div>
  );
}

/** ===== Small components ===== */

function FacetCard({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" | "warn" }) {
  const toneCls =
    tone === "success"
      ? "border-green-200"
      : tone === "danger"
      ? "border-red-200"
      : tone === "warn"
      ? "border-yellow-200"
      : "border-gray-200";
  return (
    <div className={`rounded-lg border ${toneCls} bg-white p-4`}>
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-xl font-semibold text-gray-900">{value.toLocaleString("en-IN")}</div>
    </div>
  );
}

function FlagPill({ tone, label }: { tone: "warn" | "danger"; label: string }) {
  const cls = tone === "warn" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";
  return <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{label}</span>;
}

function DecisionSelect({ value, onChange }: { value: RowDecision; onChange: (v: RowDecision) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RowDecision)}
      className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <option value="pending">Pending</option>
      <option value="accept">Accept</option>
      <option value="reject">Reject</option>
    </select>
  );
}
