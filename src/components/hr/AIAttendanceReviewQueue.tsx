import { useEffect, useMemo, useState } from "react";
import { useOrganization } from "../../contexts/OrganizationContext";
import { supabase } from "../../utils/supabaseClient";

type QueueRow = {
  id: string;
  run_id: string;
  user_id: string | null;
  user_name: string | null;
  user_department: string | null;
  attendance_id: string | null;
  attendance_date: string | null;
  decision_type: string;
  confidence: number | null;
  decision_payload: any;
  reviewed_at: string | null;
};

export default function AIAttendanceReviewQueue() {
  const { organizationId } = useOrganization();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const unresolvedCount = useMemo(() => rows.filter((r) => !r.reviewed_at).length, [rows]);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("attendance_ai_review_queue_view")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      setRows((data || []) as QueueRow[]);
    } catch (e: any) {
      setError(e?.message || "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [organizationId]);

  const reviewSelected = async (approved: boolean) => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setLoading(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const updates = ids.map((id) =>
        supabase
          .from("attendance_ai_decisions")
          .update({
            reviewed_at: now,
            decision_payload: {
              review_action: approved ? "approved" : "rejected",
              reviewed_at: now,
            },
          })
          .eq("id", id),
      );
      await Promise.all(updates);
      setSelected(new Set());
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to update selected rows");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-6">
        <h2 className="text-2xl font-semibold text-gray-900">AI Attendance Review Queue</h2>
        <p className="mt-1 text-sm text-gray-600">
          Review low-confidence AI decisions before they affect payroll outcomes.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm text-gray-700">
            Pending items: <span className="font-semibold">{unresolvedCount}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => reviewSelected(true)}
              disabled={!selected.size || loading}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Approve Selected
            </button>
            <button
              onClick={() => reviewSelected(false)}
              disabled={!selected.size || loading}
              className="rounded-md bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Reject Selected
            </button>
          </div>
        </div>

        {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Select</th>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Decision</th>
                <th className="px-3 py-2 text-left">Confidence</th>
                <th className="px-3 py-2 text-left">Diff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {rows.map((r) => {
                const checked = selected.has(r.id);
                const prev = r.decision_payload?.previous || {};
                const next = r.decision_payload?.next || {};
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelected((prevSet) => {
                            const nextSet = new Set(prevSet);
                            if (nextSet.has(r.id)) nextSet.delete(r.id);
                            else nextSet.add(r.id);
                            return nextSet;
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{r.user_name || "Unknown user"}</div>
                      <div className="text-xs text-gray-500">{r.user_department || "No department"}</div>
                    </td>
                    <td className="px-3 py-2">{r.attendance_date || "-"}</td>
                    <td className="px-3 py-2">{r.decision_type}</td>
                    <td className="px-3 py-2">
                      {typeof r.confidence === "number" ? `${Math.round(r.confidence * 100)}%` : "N/A"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="rounded bg-gray-50 p-2">
                        <div>Prev: {JSON.stringify(prev)}</div>
                        <div>Next: {JSON.stringify(next)}</div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                    {loading ? "Loading..." : "No pending AI review items."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
