import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import { useOrganization } from "../contexts/OrganizationContext";
import { PageHeader, AsyncSection, EmptyState } from "./widgets/Primitives";
import CompensationChat from "./CompensationChatNew";

/** ================= Schema-aligned types ================= */
type PayComponent = {
  id: string;
  code: string; // UNIQUE
  name: string;
  type: "earning" | "deduction" | "employer_cost";
  active: boolean;
  sort_order: number;
};

type Employee = { id: string; name: string | null; department: string | null; email?: string | null };

type CompensationRow = {
  id: string;
  user_id: string;
  effective_from: string; // date (YYYY-MM-DD)
  effective_to: string | null; // date or null
  ctc_annual: number;
  pay_schedule: "monthly" | "weekly" | "biweekly"; // stored as text; server validates
  currency: string; // e.g., "INR"
  compensation_payload: {
    components: { component_code: string; amount: number }[];
    notes?: string;
    [k: string]: any;
  };
  created_at: string;
};

type PreviewResponse = {
  month: number;
  year: number;
  snapshot: {
    code: string;
    name: string;
    type: "earning" | "deduction" | "employer_cost";
    amount: number;
  }[];
  gross_earnings: number;
  total_deductions: number;
  net_pay: number;
  employer_cost: number;
};



/** ============== Utilities ============== */
function fmtINR(n?: number) {
  return typeof n === "number" && isFinite(n) ? `₹${n.toLocaleString("en-IN")}` : "-";
}
const todayISO = () => new Date().toISOString().slice(0, 10);

/** ============== Component ============== */
export default function CompensationEditor() {
  const { organizationId } = useOrganization();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // employee picker
  const [query, setQuery] = useState("");
  const [userList, setUserList] = useState<Employee[]>([]);
  const [userId, setUserId] = useState<string>("");

  // components catalog
  const [components, setComponents] = useState<PayComponent[]>([]);

  // rows for the selected user
  const [rows, setRows] = useState<CompensationRow[]>([]);
  const [editing, setEditing] = useState<CompensationRow | null>(null);

  // preview
  const [previewMonth, setPreviewMonth] = useState<number>(new Date().getMonth() + 1);
  const [previewYear, setPreviewYear] = useState<number>(new Date().getFullYear());
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // ========= Load pay components once =========
  useEffect(() => {
    (async () => {
      try {
        // Fetch pay components directly from Supabase
        const { data: components, error } = await supabase
          .from('pay_components')
          .select('*')
          .eq('active', true)
          .order('sort_order');

        if (error) throw new Error(error.message);
        setComponents(components || []);
        
        // Debug: Log available component codes
        console.log('Available component codes:', components?.map(c => c.code) || []);
      } catch (e: any) {
        console.error(e);
      }
    })();
  }, [organizationId]);

  // ========= Search users by query =========
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Search users directly from Supabase
        let usersQuery = supabase
          .from('users')
          .select('id, name, department, email')
          .eq('organization_id', organizationId);

        if (query.trim()) {
          usersQuery = usersQuery.or(`name.ilike.%${query}%,email.ilike.%${query}%`);
        }

        const { data: users, error } = await usersQuery.limit(50);
        
        if (error) throw new Error(error.message);
        if (active) setUserList(users || []);
      } catch (e: any) {
        console.error(e);
      }
    })();
    return () => {
      active = false;
    };
  }, [query, organizationId]);

  // ========= Load compensation history for selected user =========
  useEffect(() => {
    (async () => {
      if (!userId) return;
      setLoading(true);
      setErr(null);
      try {
        // Fetch compensation records directly from Supabase
        const { data: compensationRows, error } = await supabase
          .from('employee_compensation')
          .select('*')
          .eq('user_id', userId)
          .order('effective_from');

        if (error) throw new Error(error.message);
        
        setRows(compensationRows || []);
        setPreview(null);
        setEditing(null);
      } catch (e: any) {
        setErr(e?.message || "Failed to load compensation");
      } finally {
        setLoading(false);
      }
    })();
  }, [userId, organizationId]);

  const selectedUser = userList.find((u) => u.id === userId) || null;

  // ========= Derived helpers =========
  const ctcMonthly = useMemo(() => {
    const ctc = editing?.ctc_annual || 0;
    if (editing?.pay_schedule === "monthly") return ctc / 12;
    if (editing?.pay_schedule === "biweekly") return (ctc / 52) * 2;
    if (editing?.pay_schedule === "weekly") return ctc / 52;
    return 0;
  }, [editing]);

  function beginCreate() {
    if (!userId) {
      alert("Select an employee first.");
      return;
    }
    setEditing({
      id: "",
      user_id: userId,
      effective_from: todayISO(),
      effective_to: null,
      ctc_annual: 0,
      pay_schedule: "monthly",
      currency: "INR",
      compensation_payload: { components: [], notes: "" },
      created_at: new Date().toISOString(),
    });
  }

  function beginEdit(r: CompensationRow) {
    const editData = JSON.parse(JSON.stringify(r));
    
    // Fix component code mismatches by mapping to available codes
    if (editData.compensation_payload?.components) {
      const availableCodes = components.map(c => c.code);
      
      // Create a mapping from saved codes to available codes
      const codeMapping: Record<string, string> = {};
      availableCodes.forEach(code => {
        codeMapping[code] = code; // exact match
        codeMapping[code.toLowerCase()] = code; // lowercase to exact
        codeMapping[code.toUpperCase()] = code; // uppercase to exact
      });
      
      // Common aliases mapping
      const aliases: Record<string, string> = {
        'basic': 'BASIC',
        'BASIC': 'BASIC', 
        'hra': 'HRA',
        'HRA': 'HRA',
        'conveyance': 'CONV',
        'CONV': 'CONV',
        'conv': 'CONV',
        'special': 'SPEC',
        'SPEC': 'SPEC',
        'spec': 'SPEC',
        'MED': 'MED',
        'medical': 'MED',
        'med': 'MED',
        'PF_EE': 'PF',
        'pf_employee': 'PF',
        'PF': 'PF',
        'pf': 'PF',
        'PT': 'PT',
        'pt': 'PT',
        'TDS': 'TDS',
        'tds': 'TDS',
        'esic_employee': 'ESI',
        'ESI': 'ESI',
        'esi': 'ESI',
        'ESIC': 'ESI',
        // Employer contributions
        'PF_ER': 'PF_ER',
        'pf_er': 'PF_ER',
        'pf_employer': 'PF_ER',
        'ESI_ER': 'ESI_ER',
        'esi_er': 'ESI_ER',
        'esic_er': 'ESI_ER',
        'esi_employer': 'ESI_ER',
        'esic_employer': 'ESI_ER'
      };
      
      // Apply mappings to find the best match
      editData.compensation_payload.components = editData.compensation_payload.components.map((comp: any) => {
        let mappedCode = comp.component_code;
        
        // Try direct mapping first
        if (codeMapping[comp.component_code]) {
          mappedCode = codeMapping[comp.component_code];
        }
        // Try alias mapping
        else if (aliases[comp.component_code] && availableCodes.includes(aliases[comp.component_code])) {
          mappedCode = aliases[comp.component_code];
        }
        // Try to find a case-insensitive match
        else {
          const match = availableCodes.find(code => 
            code.toLowerCase() === comp.component_code.toLowerCase()
          );
          if (match) mappedCode = match;
        }
        
        if (mappedCode !== comp.component_code) {
          console.log(`Mapped component code: ${comp.component_code} → ${mappedCode}`);
        }
        
        return { ...comp, component_code: mappedCode };
      });
    }
    
    setEditing(editData);
  }

  async function saveRow() {
    if (!editing) return;
    // Overlap validation (client-side; server should re-check)
    const ef = new Date(editing.effective_from);
    const et = editing.effective_to ? new Date(editing.effective_to) : null;
    for (const r of rows) {
      if (editing.id && r.id === editing.id) continue;
      const rf = new Date(r.effective_from);
      const rt = r.effective_to ? new Date(r.effective_to) : null;
      const overlap =
        (rt === null || ef <= rt) && (et === null || rf <= et); // ranges intersect (open-ended allowed)
      if (overlap) {
        if (!(et && et < rf) && !(rt && rt < ef)) {
          if (!confirm("This overlaps an existing row. Save anyway?")) return;
          break;
        }
      }
    }
    // Basic sanity
    if (!editing.ctc_annual || editing.ctc_annual <= 0) {
      return alert("CTC (annual) must be a positive number.");
    }
    if ((editing.compensation_payload?.components || []).some((c) => !c.component_code || !isFinite(c.amount))) {
      return alert("Each component must have a code and numeric amount.");
    }

    setLoading(true);
    setErr(null);
    try {
      const payload = {
        id: editing.id || undefined,
        user_id: editing.user_id,
        effective_from: editing.effective_from,
        effective_to: editing.effective_to,
        ctc_annual: Number(editing.ctc_annual),
        pay_schedule: editing.pay_schedule,
        currency: editing.currency,
        compensation_payload: editing.compensation_payload,
      };
      
      // Upsert compensation record directly to Supabase
      const { data: saved, error: saveError } = await supabase
        .from('employee_compensation')
        .upsert({ 
          ...payload,
          id: editing.id || undefined 
        }, {
          onConflict: 'id'
        })
        .select()
        .single();

      if (saveError) throw new Error(saveError.message);
      
      // Refresh list
      const { data: updatedRows, error: listError } = await supabase
        .from('employee_compensation')
        .select('*')
        .eq('user_id', editing.user_id)
        .order('effective_from');

      if (listError) throw new Error(listError.message);
      
      setRows(updatedRows || []);
      setEditing(null);
      if (saved) setPreview(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  async function deleteRow(id: string) {
    if (!confirm("Delete this compensation row? This cannot be undone.")) return;
    setLoading(true);
    setErr(null);
    try {
      // Delete compensation record directly from Supabase
      const { error: deleteError } = await supabase
        .from('employee_compensation')
        .delete()
        .eq('id', id);

      if (deleteError) throw new Error(deleteError.message);

      // Refresh list
      const { data: updatedRows, error: listError } = await supabase
        .from('employee_compensation')
        .select('*')
        .eq('user_id', userId)
        .order('effective_from');

      if (listError) throw new Error(listError.message);
      
      setRows(updatedRows || []);
      setEditing(null);
      setPreview(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to delete");
    } finally {
      setLoading(false);
    }
  }

  async function doPreview(targetId: string) {
    setPreviewBusy(true);
    try {
      const compensationRow = rows.find(r => r.id === targetId);
      if (!compensationRow) {
        throw new Error("Compensation record not found");
      }

      console.log('Preview - Original compensation components:', compensationRow.compensation_payload.components);

      // Apply same component code mapping logic as beginEdit function
      const savedComponents = compensationRow.compensation_payload.components || [];
      const previewSnapshot: { code: string; name: string; type: 'earning' | 'deduction' | 'employer_cost'; amount: number }[] = [];

      for (const savedComp of savedComponents) {
        const savedCode = savedComp.component_code?.trim();
        if (!savedCode) continue;

        // Try to map component code using same logic as beginEdit
        let matchedComponent = null;

        // 1. Exact match first
        matchedComponent = components.find(c => c.code === savedCode);

        // 2. Case-insensitive match
        if (!matchedComponent) {
          matchedComponent = components.find(c => c.code.toLowerCase() === savedCode.toLowerCase());
        }

        // 3. Common alias mapping
        if (!matchedComponent) {
          const aliasMap: Record<string, string> = {
            'basic': 'BASIC',
            'hra': 'HRA', 
            'conv': 'CONV',
            'conveyance': 'CONV',
            'special': 'SPEC',
            'spec': 'SPEC',
            'medical': 'MED',
            'med': 'MED',
            'pf': 'PF',
            'esi': 'ESI',
            'pt': 'PT',
            'tds': 'TDS',
            // Employer contributions
            'pf_er': 'PF_ER',
            'pf_employer': 'PF_ER',
            'esi_er': 'ESI_ER', 
            'esic_er': 'ESI_ER',
            'esi_employer': 'ESI_ER',
            'esic_employer': 'ESI_ER'
          };
          
          const normalizedAlias = aliasMap[savedCode.toLowerCase()];
          if (normalizedAlias) {
            matchedComponent = components.find(c => c.code === normalizedAlias);
          }
        }

        if (matchedComponent) {
          // Convert annual amount to monthly for preview display
          const monthlyAmount = (savedComp.amount || 0) / 12;
          previewSnapshot.push({
            code: matchedComponent.code,
            name: matchedComponent.name,
            type: matchedComponent.type as 'earning' | 'deduction' | 'employer_cost',
            amount: monthlyAmount
          });
        } else {
          console.warn(`Preview - Component code "${savedCode}" not found in available components`);
        }
      }

      // Calculate totals from actual components
      const earnings = previewSnapshot.filter(s => s.type === 'earning');
      const deductions = previewSnapshot.filter(s => s.type === 'deduction');
      const employerCosts = previewSnapshot.filter(s => s.type === 'employer_cost');

      const grossEarnings = earnings.reduce((sum, item) => sum + item.amount, 0);
      const totalDeductions = Math.abs(deductions.reduce((sum, item) => sum + item.amount, 0)); // Make positive for display
      const totalEmployerCost = employerCosts.reduce((sum, item) => sum + item.amount, 0);
      const netPay = grossEarnings - totalDeductions;

      const preview: PreviewResponse = {
        month: previewMonth,
        year: previewYear,
        snapshot: previewSnapshot,
        gross_earnings: grossEarnings,
        total_deductions: totalDeductions,
        net_pay: netPay,
        employer_cost: grossEarnings + totalEmployerCost // Basic employer cost calculation
      };

      console.log('Preview - Final preview data:', preview);
      setPreview(preview);
    } catch (e: any) {
      console.error('Preview error:', e);
      alert(e?.message || "Preview failed");
    } finally {
      setPreviewBusy(false);
    }
  }

  function addComponentLine() {
    if (!editing) return;
    // pick first earning by default
    const first = components.find((c) => c.type === "earning") || components[0];
    if (!first) return alert("No pay components configured.");
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            compensation_payload: {
              ...prev.compensation_payload,
              components: [...(prev.compensation_payload.components || []), { component_code: first.code, amount: 0 }],
            },
          }
        : prev
    );
  }

  function removeComponentLine(idx: number) {
    if (!editing) return;
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            compensation_payload: {
              ...prev.compensation_payload,
              components: (prev.compensation_payload.components || []).filter((_, i) => i !== idx),
            },
          }
        : prev
    );
  }

  const totalComponentAmt = useMemo(
    () =>
      (editing?.compensation_payload.components || []).reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [editing]
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-lg border shadow-sm p-6">
        <PageHeader title="Compensation Editor" subtitle="Effective-dated compensation with component-level breakdown" />

        {/* Employee picker */}
        <section className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Select employee</label>
          <div className="flex gap-2">
            <input
              value={
                selectedUser
                  ? [selectedUser.name, selectedUser.email].filter(Boolean).join(" • ")
                  : query
              }
              onChange={(e) => {
                setQuery(e.target.value);
                setUserId("");
              }}
              onFocus={() => setQuery("")}
              placeholder="Search by name / code / email"
              className="w-96 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={beginCreate}
              disabled={!userId}
              className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              + Add compensation
            </button>
          </div>
          {/* results */}
          {query && (
            <div className="mt-2 max-h-64 overflow-auto border rounded-md">
              {userList.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">No results</div>
              ) : (
                userList.map((u) => (
                  <button
                    key={u.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      setUserId(u.id);
                      setQuery("");
                    }}
                  >
                    <div className="font-medium text-gray-900">{u.name || u.id}</div>
                    <div className="text-xs text-gray-500">
                      {[u.email, u.department].filter(Boolean).join(" • ")}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </section>

        <AsyncSection loading={loading} error={err}>
          {!userId ? (
            <EmptyState title="No employee selected" description="Search and select an employee to view compensation." />
          ) : rows.length === 0 && !editing ? (
            <EmptyState title="No compensation" description="Click “Add compensation” to create the first row." />
          ) : (
            <>
              {/* History list */}
              {rows.length > 0 && (
                <section className="mb-6">
                  <h3 className="text-base font-semibold text-gray-900 mb-2">Compensation history</h3>
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="px-3 py-2 text-left">Effective From</th>
                          <th className="px-3 py-2 text-left">Effective To</th>
                          <th className="px-3 py-2 text-right">CTC (Annual)</th>
                          <th className="px-3 py-2 text-left">Schedule</th>
                          <th className="px-3 py-2 text-left">Currency</th>
                          <th className="px-3 py-2 text-left">Components</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {rows.map((r) => (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">{r.effective_from}</td>
                            <td className="px-3 py-2">{r.effective_to || "—"}</td>
                            <td className="px-3 py-2 text-right">{fmtINR(r.ctc_annual)}</td>
                            <td className="px-3 py-2">{r.pay_schedule}</td>
                            <td className="px-3 py-2">{r.currency}</td>
                            <td className="px-3 py-2">
                              {(r.compensation_payload.components || []).slice(0, 3).map((c) => c.component_code).join(", ")}
                              {(r.compensation_payload.components || []).length > 3 ? "…" : ""}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex gap-2 justify-end">
                                <button className="px-2 py-1 rounded-md border bg-white hover:bg-gray-50" onClick={() => doPreview(r.id)}>
                                  Preview
                                </button>
                                <button className="px-2 py-1 rounded-md border bg-white hover:bg-gray-50" onClick={() => beginEdit(r)}>
                                  Edit
                                </button>
                                <button className="px-2 py-1 rounded-md border bg-white hover:bg-gray-50" onClick={() => deleteRow(r.id)}>
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Preview controls */}
                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-sm text-gray-700">Preview period:</label>
                    <select
                      value={previewMonth}
                      onChange={(e) => setPreviewMonth(Number(e.target.value))}
                      className="px-2 py-1 border rounded"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>
                          {m.toString().padStart(2, "0")}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={previewYear}
                      onChange={(e) => setPreviewYear(Number(e.target.value))}
                      className="w-24 px-2 py-1 border rounded"
                    />
                    {previewBusy && <span className="text-sm text-gray-600">Calculating…</span>}
                  </div>

                  {/* Preview pane */}
                  {preview && (
                    <div className="mt-3 rounded-lg border bg-white p-4">
                      <div className="text-sm text-gray-600 mb-2">
                        Snapshot for {preview.month}/{preview.year}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <SummaryCard
                          title="Gross earnings"
                          value={fmtINR(preview.gross_earnings)}
                          items={preview.snapshot.filter((s) => s.type === "earning")}
                        />
                        <SummaryCard
                          title="Deductions"
                          value={fmtINR(preview.total_deductions)}
                          items={preview.snapshot.filter((s) => s.type === "deduction")}
                        />
                        <div className="rounded-lg border p-4">
                          <div className="text-sm text-gray-500 mb-1">Totals</div>
                          <ul className="text-sm text-gray-900 space-y-1">
                            <li className="flex justify-between">
                              <span>Net Pay</span>
                              <span className="font-semibold text-green-700">{fmtINR(preview.net_pay)}</span>
                            </li>
                            <li className="flex justify-between">
                              <span>Employer Cost</span>
                              <span>{fmtINR(preview.employer_cost)}</span>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Editor */}
              {editing && (
                <section className="bg-white rounded-lg border p-6">
                  <h3 className="text-base font-semibold text-gray-900 mb-4">
                    {editing.id ? "Edit Compensation" : "Add Compensation"}
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field label="Effective From">
                      <input
                        type="date"
                        value={editing.effective_from}
                        onChange={(e) => setEditing((p) => p && { ...p, effective_from: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </Field>
                    <Field label="Effective To (optional)">
                      <input
                        type="date"
                        value={editing.effective_to || ""}
                        onChange={(e) =>
                          setEditing((p) => p && { ...p, effective_to: e.target.value ? e.target.value : null })
                        }
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </Field>
                    <Field label="Currency">
                      <input
                        value={editing.currency}
                        onChange={(e) => setEditing((p) => p && { ...p, currency: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </Field>
                    <Field label="Pay Schedule">
                      <select
                        value={editing.pay_schedule}
                        onChange={(e) =>
                          setEditing((p) => p && { ...p, pay_schedule: e.target.value as CompensationRow["pay_schedule"] })
                        }
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="monthly">Monthly</option>
                        <option value="biweekly">Biweekly</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </Field>
                    <Field label="CTC (Annual)">
                      <input
                        type="number"
                        value={editing.ctc_annual}
                        onChange={(e) => setEditing((p) => p && { ...p, ctc_annual: Number(e.target.value) })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="text-xs text-gray-500 mt-1">
                        Approx per-period: <strong>{fmtINR(ctcMonthly)}</strong>
                      </div>
                    </Field>
                    <Field label="Notes (optional)">
                      <input
                        value={editing.compensation_payload.notes || ""}
                        onChange={(e) =>
                          setEditing((p) =>
                            p && { ...p, compensation_payload: { ...p.compensation_payload, notes: e.target.value } }
                          )
                        }
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </Field>
                  </div>

                  {/* AI Assistant */}
                  <div className="mt-6">
                    <CompensationChat
                      availableComponents={components.map(c => ({
                        code: c.code,
                        name: c.name,
                        type: c.type
                      }))}
                      onCompensationUpdate={(compensation) => {
                        setEditing((p) => p && {
                          ...p,
                          ctc_annual: compensation.ctc_annual,
                          pay_schedule: compensation.pay_schedule,
                          currency: compensation.currency,
                          compensation_payload: {
                            ...p.compensation_payload,
                            components: compensation.components,
                            notes: compensation.notes
                          }
                        });
                      }}
                      onConversationComplete={() => {
                        // Optional: Auto-save or show completion message
                        console.log("AI conversation completed");
                      }}
                    />
                  </div>

                  {/* Component lines */}
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="text-sm font-medium text-gray-900">Component amounts</div>
                        <div className="text-xs text-gray-600">
                          Each line writes into <code>compensation_payload.components[]</code>.
                        </div>
                      </div>
                      <button onClick={addComponentLine} className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50">
                        + Add component
                      </button>
                    </div>

                    <div className="overflow-x-auto border rounded-lg">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="px-3 py-2 text-left">Component</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {(editing.compensation_payload.components || []).length === 0 && (
                            <tr>
                              <td colSpan={3} className="px-6 py-6">
                                <EmptyState
                                  title="No lines"
                                  description="Add components like BASIC, HRA, CONV, etc."
                                />
                              </td>
                            </tr>
                          )}
                          {(editing.compensation_payload.components || []).map((line, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-3 py-2">
                                <select
                                  value={line.component_code}
                                  onChange={(e) => {
                                    const code = e.target.value;
                                    setEditing((p) => {
                                      if (!p) return p;
                                      const next = [...p.compensation_payload.components];
                                      next[idx] = { ...next[idx], component_code: code };
                                      return { ...p, compensation_payload: { ...p.compensation_payload, components: next } };
                                    });
                                  }}
                                  className="min-w-[260px] px-2 py-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  {components.map((c) => (
                                    <option key={c.code} value={c.code}>
                                      {c.name} ({c.code})
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <input
                                  type="number"
                                  step={0.01}
                                  value={line.amount}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setEditing((p) => {
                                      if (!p) return p;
                                      const next = [...p.compensation_payload.components];
                                      next[idx] = { ...next[idx], amount: val };
                                      return { ...p, compensation_payload: { ...p.compensation_payload, components: next } };
                                    });
                                  }}
                                  className="w-40 text-right px-2 py-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  onClick={() => removeComponentLine(idx)}
                                  className="px-2 py-1 rounded-md border bg-white hover:bg-gray-50"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {editing && (
                          <tfoot>
                            <tr>
                              <td className="px-3 py-2 text-right font-medium">Total of lines</td>
                              <td className="px-3 py-2 text-right font-medium">{fmtINR(totalComponentAmt)}</td>
                              <td></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                    <div className="text-xs text-gray-600 mt-2">
                      Tip: Your payroll engine may also compute some components (e.g., PF) from these base amounts.
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-6 flex justify-end gap-2">
                    <button className="px-4 py-2 rounded-md border bg-white hover:bg-gray-50" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <button className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700" onClick={saveRow}>
                      Save compensation
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </AsyncSection>
      </div>
    </div>
  );
}

/** ============== Small bits ============== */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  items,
}: {
  title: string;
  value: string;
  items: { code: string; name: string; amount: number }[];
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-xl font-semibold text-gray-900">{value}</div>
      <ul className="mt-2 text-sm text-gray-800 space-y-1">
        {items.length === 0 ? (
          <li className="text-gray-400">—</li>
        ) : (
          items.map((it) => (
            <li key={it.code} className="flex justify-between">
              <span>{it.name}</span>
              <span className="font-medium">{fmtINR(it.amount)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
