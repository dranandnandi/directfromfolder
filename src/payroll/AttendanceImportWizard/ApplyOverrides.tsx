import { useContext, useEffect, useMemo, useState } from "react";
import { PayrollContext } from "../PayrollShell";
import { PageHeader, AsyncSection, EmptyState } from "../widgets/Primitives";
import { supabase, retryOperation } from "../../utils/supabaseClient";

/**
 * SCHEMA notes used by this UI:
 * - attendance_import_batches / attendance_import_rows: to fetch validated, will_apply rows to aggregate per user.
 * - attendance_monthly_overrides: id, organization_id, user_id, month, year, source_batch_id, payload, approved_by, approved_at, created_at.
 * - employee_pay_overrides: id, user_id, period_month, period_year, override_payload, created_at.
 *
 * Direct Supabase replacements implemented:
 * 1) Proposals computed from latest validated batch rows (accepted, not dup, no errors)
 * 2) Save attendance overrides into attendance_monthly_overrides
 * 3) List pay components from pay_components
 * 4) List/save/delete employee_pay_overrides directly
 */

type ProposalRow = {
  user_id: string;
  employee_code?: string | null;
  name?: string | null;
  department?: string | null;
  // derived monthly numbers from validated import rows:
  present_days: number;
  lop_days: number;
  paid_leaves: number;
  holidays: number;
  weekly_offs: number;
  overtime_hours: number;
  late_occurrences: number;
  early_outs: number;
};

type AttendanceOverrideRow = {
  id?: string; // for existing overrides
  user_id: string;
  payload: {
    present_days?: number;
    lop_days?: number;
    paid_leaves?: number;
    holidays?: number;
    weekly_offs?: number;
    overtime_hours?: number;
    late_occurrences?: number;
    early_outs?: number;
    remarks?: string;
  };
};

type PayComponent = {
  id: string;
  code: string; // unique
  name: string;
  type: "earning" | "deduction" | "employer_cost";
};

type PayOverrideRow = {
  id?: string;
  user_id: string;
  user_name?: string | null;
  user_code?: string | null;
  component_code: string; // link to pay_components.code
  amount: number;
  taxable?: boolean; // optional hint (engine can re-check)
  remarks?: string;
};

export default function ApplyOverrides() {
  const { month, year, orgId } = useContext(PayrollContext);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [rows, setRows] = useState<AttendanceOverrideRow[]>([]); // editable overrides (attendance_monthly_overrides)
  const [payItems, setPayItems] = useState<PayOverrideRow[]>([]); // employee_pay_overrides items
  const [components, setComponents] = useState<PayComponent[]>([]);
  const [savingA, setSavingA] = useState(false);
  const [savingP, setSavingP] = useState(false);

  // Load proposals (from validated import rows), existing attendance overrides, pay components, existing pay overrides
  useEffect(() => {
    (async () => {
      if (!orgId) return;
      setLoading(true);
      setErr(null);
      try {
        // 1) find latest VALIDATED batch for this period
        const { data: batchRows, error: bErr } = await retryOperation<any>(() =>
          supabase
            .from("attendance_import_batches")
            .select("id,status,created_at")
            .eq("organization_id", orgId)
            .eq("month", month)
            .eq("year", year)
            .order("created_at", { ascending: false })
            .limit(1)
        );
        if (bErr) throw bErr;
        const latest = (batchRows && batchRows[0]) || null;
        setBatchId(latest?.id || null);

        let proposals: ProposalRow[] = [];
        if (latest?.id) {
          // 2) load accepted, non-dup, error-free rows and aggregate by user_id
          const { data: rowsData, error: rErr } = await retryOperation<any>(() =>
            supabase
              .from("attendance_import_rows")
              .select("user_id, normalized")
              .eq("batch_id", latest.id)
              .eq("decision", "accept")
              .eq("is_duplicate", false)
              .is("validation_errors", null)
              .not("user_id", "is", null)
          );
          if (rErr) throw rErr;

          const byUser = new Map<string, ProposalRow>();
          (rowsData || []).forEach((r: any) => {
            const uid = r.user_id as string;
            if (!uid) return;
            const n = r.normalized || {};
            const cur = byUser.get(uid) || {
              user_id: uid,
              present_days: 0,
              lop_days: 0,
              paid_leaves: 0,
              holidays: 0,
              weekly_offs: 0,
              overtime_hours: 0,
              late_occurrences: 0,
              early_outs: 0,
            } as ProposalRow;
            // naive aggregation; adjust as per your normalized schema keys
            cur.present_days += typeof n.present === "number" ? n.present : (n.hours ? 1 : 0);
            cur.lop_days += typeof n.lop === "number" ? n.lop : 0;
            cur.paid_leaves += typeof n.paid_leave === "number" ? n.paid_leave : 0;
            cur.holidays += typeof n.holiday === "number" ? n.holiday : 0;
            cur.weekly_offs += typeof n.weekly_off === "number" ? n.weekly_off : 0;
            cur.overtime_hours += typeof n.overtime_hours === "number" ? n.overtime_hours : 0;
            cur.late_occurrences += n.is_late ? 1 : 0;
            cur.early_outs += n.is_early_out ? 1 : 0;
            byUser.set(uid, cur);
          });
          proposals = Array.from(byUser.values());

          // hydrate basic user meta (name/email as pseudo code)
          const uids = proposals.map((p) => p.user_id);
          if (uids.length) {
            const { data: users, error: uErr } = await retryOperation<any>(() =>
              supabase.from("users").select("id,name,department,email").in("id", uids)
            );
            if (!uErr && users) {
              const map = new Map<string, any>(users.map((u: any) => [u.id, u]));
              proposals = proposals.map((p) => ({
                ...p,
                name: map.get(p.user_id)?.name || null,
                department: map.get(p.user_id)?.department || null,
                employee_code: map.get(p.user_id)?.email || null,
              }));
            }
          }
        }
        setProposals(proposals);

        // 3) load existing attendance overrides for this month
        const { data: existing, error: oErr } = await retryOperation<any>(() =>
          supabase
            .from("attendance_monthly_overrides")
            .select("id,user_id,payload")
            .eq("organization_id", orgId)
            .eq("month", month)
            .eq("year", year)
        );
        if (oErr) throw oErr;
        const merged = proposals.map((p) => {
          const existingRow = (existing || []).find((e: any) => e.user_id === p.user_id);
          const payload = {
            present_days: p.present_days,
            lop_days: p.lop_days,
            paid_leaves: p.paid_leaves,
            holidays: p.holidays,
            weekly_offs: p.weekly_offs,
            overtime_hours: p.overtime_hours,
            late_occurrences: p.late_occurrences,
            early_outs: p.early_outs,
            ...(existingRow?.payload || {}),
          };
          return existingRow?.id
            ? ({ id: existingRow.id, user_id: p.user_id, payload } as AttendanceOverrideRow)
            : ({ user_id: p.user_id, payload } as AttendanceOverrideRow);
        });
        setRows(merged);

        // 4) pay components
        const { data: compData, error: cErr } = await retryOperation<any>(() =>
          supabase
            .from("pay_components")
            .select("id,code,name,type")
        );
        if (cErr) throw cErr;
        setComponents(compData || []);

        // 5) existing pay overrides for this period
        const { data: payData, error: pErr } = await retryOperation<any>(() =>
          supabase
            .from("employee_pay_overrides")
            .select("id,user_id,override_payload")
            .eq("period_month", month)
            .eq("period_year", year)
        );
        if (pErr) throw pErr;
        const mapped = (payData || []).map((r: any) => ({
          id: r.id,
          user_id: r.user_id,
          component_code: r.override_payload?.component_code,
          amount: Number(r.override_payload?.amount || 0),
          taxable: r.override_payload?.taxable,
          remarks: r.override_payload?.remarks,
        })) as PayOverrideRow[];
        setPayItems(mapped);
      } catch (e: any) {
        setErr(e?.message || "Failed to load overrides");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, month, year]);

  // Helpers
  const byUser: Record<string, ProposalRow> = useMemo(() => {
    const map: Record<string, ProposalRow> = {};
    proposals.forEach((p) => (map[p.user_id] = p));
    return map;
  }, [proposals]);

  // const fmtNum = (n?: number) =>
  //   typeof n === "number" && !isNaN(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "0";

  function setPayload(user_id: string, key: keyof AttendanceOverrideRow["payload"], val: number | string | undefined) {
    setRows((prev) =>
      prev.map((r) => (r.user_id === user_id ? { ...r, payload: { ...r.payload, [key]: val } } : r))
    );
  }

  async function saveAttendanceOverrides() {
    if (!orgId) return;
    setSavingA(true);
    setErr(null);
    try {
      // Upsert each override
      let saved = 0;
      for (const r of rows) {
        if (r.id) {
          const { error } = await retryOperation<any>(() =>
            supabase
              .from("attendance_monthly_overrides")
              .update({ payload: r.payload })
              .eq("id", r.id!)
          );
          if (error) throw error;
          saved++;
        } else {
          const { error } = await retryOperation<any>(() =>
            supabase
              .from("attendance_monthly_overrides")
              .insert({
                organization_id: orgId,
                user_id: r.user_id,
                month,
                year,
                source_batch_id: batchId,
                payload: r.payload,
              })
          );
          if (error) throw error;
          saved++;
        }
      }
      alert(`Saved ${saved} attendance override(s).`);
    } catch (e: any) {
      setErr(e?.message || "Failed to save attendance overrides");
    } finally {
      setSavingA(false);
    }
  }

  function addPayItem() {
    // choose first component by default; user can change
    const first = components[0];
    if (!first) return alert("No pay components configured.");
    setPayItems((prev) => [
      ...prev,
      {
        user_id: "", // must pick a user id
        component_code: first.code,
        amount: 0,
        remarks: "",
      },
    ]);
  }

  async function savePayOverrides() {
    if (!orgId) return;
    // Basic validation: must have user_id & positive number
    const invalid = payItems.find((it) => !it.user_id || !isFinite(+it.amount));
    if (invalid) {
      alert("Please set a user and a numeric amount for all pay overrides.");
      return;
    }
    setSavingP(true);
    setErr(null);
    try {
      let saved = 0;
      for (const it of payItems) {
        const payload = {
          component_code: it.component_code,
          amount: it.amount,
          taxable: it.taxable,
          remarks: it.remarks,
        };
        if (it.id) {
          const { error } = await retryOperation<any>(() =>
            supabase
              .from("employee_pay_overrides")
              .update({ override_payload: payload })
              .eq("id", it.id!)
          );
          if (error) throw error;
          saved++;
        } else {
          const { error } = await retryOperation<any>(() =>
            supabase
              .from("employee_pay_overrides")
              .insert({
                user_id: it.user_id,
                period_month: month,
                period_year: year,
                override_payload: payload,
              })
          );
          if (error) throw error;
          saved++;
        }
      }
      alert(`Saved ${saved} pay override(s).`);
    } catch (e: any) {
      setErr(e?.message || "Failed to save pay overrides");
    } finally {
      setSavingP(false);
    }
  }

  async function deletePayItem(id?: string, idx?: number) {
    // If persisted (has id), call delete; else just remove from list
    if (id) {
      try {
        const { error } = await retryOperation<any>(() =>
          supabase.from("employee_pay_overrides").delete().eq("id", id)
        );
        if (error) throw error;
      } catch (e: any) {
        return alert(e?.message || "Failed to delete");
      }
    }
    if (idx !== undefined) {
      setPayItems((prev) => prev.filter((_, i) => i !== idx));
    } else if (!id) {
      // nothing else
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-lg border shadow-sm p-6">
        <PageHeader
          title="Apply Overrides"
          subtitle="Lock in attendance totals and ad-hoc pay adjustments before final payroll"
        />
        <AsyncSection loading={loading} error={err}>
          {/* ===== Attendance Overrides (monthly totals) ===== */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">Attendance totals</h3>
              <div className="text-sm text-gray-600">
                Period: <span className="font-medium">{month}/{year}</span>{" "}
                {batchId ? <span className="ml-2 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-xs">Batch {batchId}</span> : null}
              </div>
            </div>

            {rows.length === 0 ? (
              <EmptyState title="No proposals found" description="Validate an attendance import first to get proposals." />
            ) : (
              <>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Employee</th>
                        <th className="px-3 py-2 text-right">Present</th>
                        <th className="px-3 py-2 text-right">LOP</th>
                        <th className="px-3 py-2 text-right">Paid leaves</th>
                        <th className="px-3 py-2 text-right">Holidays</th>
                        <th className="px-3 py-2 text-right">Weekly Off</th>
                        <th className="px-3 py-2 text-right">OT Hours</th>
                        <th className="px-3 py-2 text-right">Late</th>
                        <th className="px-3 py-2 text-right">Early out</th>
                        <th className="px-3 py-2 text-left w-72">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map((r) => {
                        const p = byUser[r.user_id];
                        const label =
                          (p?.name || p?.employee_code) ? `${p?.name || ""} ${p?.employee_code ? `(${p.employee_code})` : ""}` : r.user_id;
                        return (
                          <tr key={r.user_id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-900">{label}</div>
                              <div className="text-xs text-gray-500">{p?.department || ""}</div>
                            </td>
                            {(
                              [
                                "present_days",
                                "lop_days",
                                "paid_leaves",
                                "holidays",
                                "weekly_offs",
                                "overtime_hours",
                                "late_occurrences",
                                "early_outs",
                              ] as const
                            ).map((k, idx) => (
                              <td key={k} className={`px-3 py-2 ${idx < 5 ? "text-right" : "text-right"}`}>
                                <input
                                  type="number"
                                  step={k === "overtime_hours" ? 0.5 : 1}
                                  value={
                                    (r.payload[k] ?? (p as any)?.[k] ?? 0) as number
                                  }
                                  onChange={(e) => setPayload(r.user_id, k, e.currentTarget.value === "" ? undefined : Number(e.currentTarget.value))}
                                  className="w-24 text-right px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </td>
                            ))}
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={r.payload.remarks ?? ""}
                                onChange={(e) => setPayload(r.user_id, "remarks", e.currentTarget.value)}
                                className="w-72 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Reason / admin note"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-end gap-2 mt-3">
                  <button
                    onClick={saveAttendanceOverrides}
                    disabled={savingA}
                    className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingA ? "Saving..." : "Save attendance overrides"}
                  </button>
                </div>
              </>
            )}
          </section>

          {/* ===== Pay Overrides (ad-hoc earnings/deductions) ===== */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">Ad-hoc earnings & deductions</h3>
              <button
                onClick={addPayItem}
                className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50"
              >
                + Add item
              </button>
            </div>

            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left w-64">Employee</th>
                    <th className="px-3 py-2 text-left">Component</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-left w-72">Remarks</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-6">
                        <EmptyState title="No pay overrides" description="Add items to grant one-time earnings, recovery, or deductions for this month." />
                      </td>
                    </tr>
                  )}
                  {payItems.map((it, idx) => (
                    <tr key={it.id || idx} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <UserPicker
                          value={it.user_id}
                          onChange={(uid, meta) => {
                            setPayItems((prev) => {
                              const next = [...prev];
                              next[idx] = { ...it, user_id: uid, user_name: meta?.name, user_code: meta?.code };
                              return next;
                            });
                          }}
                        />
                        {it.user_name || it.user_code ? (
                          <div className="text-xs text-gray-500">{[it.user_name, it.user_code].filter(Boolean).join(" • ")}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={it.component_code}
                          onChange={(e) => {
                            const code = e.currentTarget.value;
                            setPayItems((prev) => {
                              const next = [...prev];
                              next[idx] = { ...it, component_code: code };
                              return next;
                            });
                          }}
                          className="min-w-[220px] px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {components.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name} ({c.code}) {c.type === "deduction" ? "−" : "+"}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step={0.01}
                          value={it.amount}
                          onChange={(e) => {
                            const amt = Number(e.currentTarget.value);
                            setPayItems((prev) => {
                              const next = [...prev];
                              next[idx] = { ...it, amount: amt };
                              return next;
                            });
                          }}
                          className="w-32 text-right px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={it.remarks ?? ""}
                          onChange={(e) => {
                            const val = e.currentTarget.value;
                            setPayItems((prev) => {
                              const next = [...prev];
                              next[idx] = { ...it, remarks: val };
                              return next;
                            });
                          }}
                          className="w-72 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Reason / note"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => deletePayItem(it.id, idx)}
                          className="px-2 py-1 rounded-md border bg-white hover:bg-gray-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                onClick={savePayOverrides}
                disabled={savingP}
                className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {savingP ? "Saving..." : "Save pay overrides"}
              </button>
            </div>
          </section>
        </AsyncSection>
      </div>
    </div>
  );
}

/** ======= Small controls ======= */

/**
 * Lightweight employee picker: expects an edge
 * users-search({ organization_id, q }) -> { items: { id, code?, name?, department? }[] }
 */
function UserPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (user_id: string, meta?: { name?: string | null; code?: string | null }) => void;
}) {
  const { orgId } = useContext(PayrollContext);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ id: string; name?: string | null; code?: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      if (!orgId) return;
      const like = `%${q}%`;
      const { data, error } = await retryOperation<any>(() =>
        supabase
          .from("users")
          .select("id,name,email")
          .eq("organization_id", orgId)
          .or(`name.ilike.${like},email.ilike.${like}`)
          .limit(25)
      );
      if (!error && active) setItems((data || []).map((u: any) => ({ id: u.id, name: u.name, code: u.email })));
    })();
    return () => {
      active = false;
    };
  }, [orgId, q]);

  const picked = items.find((i) => i.id === value);

  return (
    <div className="relative">
      <input
        value={picked ? [picked.name, picked.code].filter(Boolean).join(" • ") : q}
        onChange={(e) => {
          setQ(e.currentTarget.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search name / code"
        className="w-64 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {open && (
        <div className="absolute z-10 mt-1 w-[28rem] max-h-64 overflow-auto bg-white border rounded-md shadow">
          {items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">No results</div>
          ) : (
            items.map((i) => (
              <button
                key={i.id}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => {
                  onChange(i.id, { name: i.name || undefined, code: i.code || undefined });
                  setQ("");
                  setOpen(false);
                }}
              >
                <div className="font-medium text-gray-900">{i.name || i.code || i.id}</div>
                <div className="text-xs text-gray-500">{i.code ? `Code: ${i.code}` : ""}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
