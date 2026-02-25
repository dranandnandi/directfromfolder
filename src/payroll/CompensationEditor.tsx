import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import { useOrganization } from "../contexts/OrganizationContext";
import { AsyncSection } from "./widgets/Primitives";
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

function computeAnnualCtcFromComponents(components: { component_code: string; amount: number }[] = []) {
  return Math.round(
    components.reduce((sum, line) => {
      const amt = Number(line?.amount) || 0;
      return amt > 0 ? sum + amt : sum;
    }, 0),
  );
}

/** ============== Component ============== */
export default function CompensationEditor() {
  const { organizationId } = useOrganization();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // employee picker
  const [query, setQuery] = useState("");
  const [userList, setUserList] = useState<Employee[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
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

  // ========= Load all org employees once =========
  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      try {
        const { data: users, error } = await supabase
          .from('users')
          .select('id, name, department, email')
          .eq('organization_id', organizationId)
          .order('name');
        if (error) throw new Error(error.message);
        setAllEmployees(users || []);
        setUserList(users || []);
      } catch (e: any) {
        console.error(e);
      }
    })();
  }, [organizationId]);

  // ========= Filter users by query =========
  useEffect(() => {
    if (!query.trim()) {
      setUserList(allEmployees);
      return;
    }
    const q = query.toLowerCase();
    setUserList(
      allEmployees.filter(
        (u) =>
          (u.name && u.name.toLowerCase().includes(q)) ||
          (u.email && u.email.toLowerCase().includes(q)) ||
          (u.department && u.department.toLowerCase().includes(q))
      )
    );
  }, [query, allEmployees]);

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
    const componentCtc = computeAnnualCtcFromComponents(editing.compensation_payload?.components || []);
    const normalizedCtc = Number(editing.ctc_annual) > 0 ? Math.round(Number(editing.ctc_annual)) : componentCtc;

    // Basic sanity
    if (!normalizedCtc || normalizedCtc <= 0) {
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
        organization_id: organizationId,
        user_id: editing.user_id,
        effective_from: editing.effective_from,
        effective_to: editing.effective_to,
        ctc_annual: normalizedCtc,
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
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white shadow-lg">
        <h1 className="text-2xl font-bold">Compensation Editor</h1>
        <p className="text-blue-100 mt-1 text-sm">Effective-dated compensation with component-level breakdown</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        {/* Employee picker */}
        <section className="p-6 border-b border-gray-100">
          <label className="block text-sm font-semibold text-gray-800 mb-2">Select employee</label>
          <div className="flex gap-3 items-center">
            <div className="relative flex-1 max-w-lg">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                value={
                  selectedUser && !showDropdown
                    ? [selectedUser.name, selectedUser.email].filter(Boolean).join(" — ")
                    : query
                }
                onChange={(e) => {
                  setQuery(e.target.value);
                  setUserId("");
                  setShowDropdown(true);
                }}
                onFocus={() => {
                  setShowDropdown(true);
                  if (selectedUser) {
                    setQuery("");
                    setUserId("");
                  }
                }}
                onBlur={() => {
                  // Delay to allow click on dropdown items
                  setTimeout(() => setShowDropdown(false), 200);
                }}
                placeholder="Search by name, email, or department…"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
              />
            </div>
            <button
              onClick={beginCreate}
              disabled={!userId}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add compensation
            </button>
          </div>

          {/* Employee dropdown */}
          {showDropdown && (
            <div className="relative mt-2 max-w-lg">
              <div className="absolute z-20 w-full max-h-72 overflow-auto bg-white border border-gray-200 rounded-xl shadow-lg">
                {userList.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500">No employees found</div>
                ) : (
                  userList.map((u) => (
                    <button
                      key={u.id}
                      className={`w-full text-left px-4 py-3 text-sm hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0 flex items-center gap-3 ${
                        u.id === userId ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setUserId(u.id);
                        setQuery("");
                        setShowDropdown(false);
                      }}
                    >
                      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-xs">
                        {(u.name || u.email || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">{u.name || 'Unnamed'}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {[u.email, u.department].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </section>

        <AsyncSection loading={loading} error={err}>
          {!userId ? (
            <div className="p-12 text-center">
              <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">No employee selected</h3>
              <p className="text-sm text-gray-500 mt-1">Search and select an employee above to view their compensation.</p>
            </div>
          ) : rows.length === 0 && !editing ? (
            <div className="p-12 text-center">
              <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">No compensation records</h3>
              <p className="text-sm text-gray-500 mt-1">Click &quot;Add compensation&quot; to create the first record for this employee.</p>
            </div>
          ) : (
            <>
              {/* History list */}
              {rows.length > 0 && (
                <section className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">Compensation History</h3>
                      {selectedUser && (
                        <p className="text-sm text-gray-500 mt-0.5">{selectedUser.name} &mdash; {rows.length} record{rows.length !== 1 ? 's' : ''}</p>
                      )}
                    </div>
                  </div>
                  <div className="overflow-x-auto border border-gray-200 rounded-xl">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50/80">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Effective From</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Effective To</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">CTC (Annual)</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Schedule</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Components</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rows.map((r) => (
                          <tr key={r.id} className="hover:bg-blue-50/40 transition-colors">
                            <td className="px-4 py-3 font-medium text-gray-900">{r.effective_from}</td>
                            <td className="px-4 py-3 text-gray-600">{r.effective_to || <span className="inline-block px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-full font-medium">Current</span>}</td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmtINR(r.ctc_annual)}</td>
                            <td className="px-4 py-3"><span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full capitalize">{r.pay_schedule}</span></td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {(r.compensation_payload.components || []).slice(0, 4).map((c) => (
                                  <span key={c.component_code} className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">{c.component_code}</span>
                                ))}
                                {(r.compensation_payload.components || []).length > 4 && (
                                  <span className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">+{(r.compensation_payload.components || []).length - 4}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex gap-1.5 justify-end">
                                <button className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors" onClick={() => doPreview(r.id)}>
                                  Preview
                                </button>
                                <button className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors" onClick={() => beginEdit(r)}>
                                  Edit
                                </button>
                                <button className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors" onClick={() => deleteRow(r.id)}>
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
                  <div className="mt-4 flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                    <label className="text-sm font-medium text-gray-700">Preview period:</label>
                    <select
                      value={previewMonth}
                      onChange={(e) => setPreviewMonth(Number(e.target.value))}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>
                          {new Date(2000, m - 1).toLocaleString('default', { month: 'short' })} ({m.toString().padStart(2, "0")})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={previewYear}
                      onChange={(e) => setPreviewYear(Number(e.target.value))}
                      className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                    {previewBusy && (
                      <span className="text-sm text-blue-600 flex items-center gap-1">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
                        Calculating&hellip;
                      </span>
                    )}
                  </div>

                  {/* Preview pane */}
                  {preview && (
                    <div className="mt-4 rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/50 p-5">
                      <div className="text-sm font-medium text-gray-600 mb-3">
                        Monthly snapshot for {new Date(2000, preview.month - 1).toLocaleString('default', { month: 'long' })} {preview.year}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <SummaryCard
                          title="Gross Earnings"
                          value={fmtINR(preview.gross_earnings)}
                          items={preview.snapshot.filter((s) => s.type === "earning")}
                        />
                        <SummaryCard
                          title="Deductions"
                          value={fmtINR(preview.total_deductions)}
                          items={preview.snapshot.filter((s) => s.type === "deduction")}
                        />
                        <div className="rounded-xl border border-gray-200 p-4 bg-white">
                          <div className="text-sm text-gray-500 mb-2 font-medium">Totals</div>
                          <ul className="text-sm text-gray-900 space-y-2">
                            <li className="flex justify-between items-center">
                              <span>Net Pay</span>
                              <span className="font-bold text-green-700 text-lg">{fmtINR(preview.net_pay)}</span>
                            </li>
                            <li className="flex justify-between items-center pt-2 border-t border-gray-100">
                              <span>Employer Cost</span>
                              <span className="font-semibold text-gray-700">{fmtINR(preview.employer_cost)}</span>
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
                <section className="mx-6 mb-6 bg-white rounded-xl border border-blue-200 p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {editing.id ? "Edit Compensation" : "New Compensation Record"}
                  </h3>
                  <p className="text-sm text-gray-500 mb-5">Fill in the compensation details below</p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field label="Effective From">
                      <input
                        type="date"
                        value={editing.effective_from}
                        onChange={(e) => setEditing((p) => p && { ...p, effective_from: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                      />
                    </Field>
                    <Field label="Effective To (optional)">
                      <input
                        type="date"
                        value={editing.effective_to || ""}
                        onChange={(e) =>
                          setEditing((p) => p && { ...p, effective_to: e.target.value ? e.target.value : null })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                      />
                    </Field>
                    <Field label="Currency">
                      <input
                        value={editing.currency}
                        onChange={(e) => setEditing((p) => p && { ...p, currency: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                      />
                    </Field>
                    <Field label="Pay Schedule">
                      <select
                        value={editing.pay_schedule}
                        onChange={(e) =>
                          setEditing((p) => p && { ...p, pay_schedule: e.target.value as CompensationRow["pay_schedule"] })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                      />
                    </Field>
                  </div>

                  {/* AI Assistant */}
                  <div className="mt-6">
                    <CompensationChat
                      currentCompensation={{
                        ctc_annual: editing.ctc_annual || 0,
                        pay_schedule: (editing.pay_schedule as "monthly" | "weekly" | "biweekly") || "monthly",
                        currency: editing.currency || "INR",
                        components: editing.compensation_payload?.components || [],
                        notes: editing.compensation_payload?.notes || "",
                      }}
                      availableComponents={components.map(c => ({
                        code: c.code,
                        name: c.name,
                        type: c.type
                      }))}
                      onCompensationUpdate={(compensation) => {
                        const componentCtc = computeAnnualCtcFromComponents(compensation.components || []);
                        const normalizedCtc = Number(compensation.ctc_annual) > 0
                          ? Math.round(Number(compensation.ctc_annual))
                          : componentCtc;

                        setEditing((p) => p && {
                          ...p,
                          ctc_annual: normalizedCtc,
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
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">Salary Components</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          Define each earning, deduction and employer cost component
                        </div>
                      </div>
                      <button onClick={addComponentLine} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        Add component
                      </button>
                    </div>

                    <div className="overflow-x-auto border border-gray-200 rounded-xl">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50/80">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Component</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Annual Amount</th>
                            <th className="px-4 py-3 w-20"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(editing.compensation_payload.components || []).length === 0 && (
                            <tr>
                              <td colSpan={3} className="px-6 py-8 text-center">
                                <div className="text-gray-400 mb-1">No components added yet</div>
                                <div className="text-xs text-gray-400">Add components like BASIC, HRA, CONV, PF, etc.</div>
                              </td>
                            </tr>
                          )}
                          {(editing.compensation_payload.components || []).map((line, idx) => {
                            const comp = components.find(c => c.code === line.component_code);
                            return (
                            <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                              <td className="px-4 py-3">
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
                                  className={`min-w-[280px] px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${
                                    comp?.type === 'earning' ? 'text-green-800' : comp?.type === 'deduction' ? 'text-red-800' : 'text-amber-800'
                                  }`}
                                >
                                  <optgroup label="Earnings">
                                    {components.filter(c => c.type === 'earning').map((c) => (
                                      <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                                    ))}
                                  </optgroup>
                                  <optgroup label="Deductions">
                                    {components.filter(c => c.type === 'deduction').map((c) => (
                                      <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                                    ))}
                                  </optgroup>
                                  <optgroup label="Employer Costs">
                                    {components.filter(c => c.type === 'employer_cost').map((c) => (
                                      <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                                    ))}
                                  </optgroup>
                                </select>
                              </td>
                              <td className="px-4 py-3 text-right">
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
                                  className="w-44 text-right px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                />
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button
                                  onClick={() => removeComponentLine(idx)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                  title="Remove component"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                        {editing && (editing.compensation_payload.components || []).length > 0 && (
                          <tfoot className="bg-gray-50/80">
                            <tr>
                              <td className="px-4 py-3 text-right font-semibold text-gray-700">Total annual</td>
                              <td className="px-4 py-3 text-right font-bold text-gray-900 text-base">{fmtINR(totalComponentAmt)}</td>
                              <td></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                    <div className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Payroll engine may also compute statutory components (e.g., PF) from these base amounts.
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-6 flex justify-end gap-3 pt-5 border-t border-gray-100">
                    <button className="px-5 py-2.5 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <button className="px-5 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium transition-colors shadow-sm" onClick={saveRow}>
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
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
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
    <div className="rounded-xl border border-gray-200 p-4 bg-white">
      <div className="text-sm text-gray-500 font-medium">{title}</div>
      <div className="text-xl font-bold text-gray-900 mt-1">{value}</div>
      <ul className="mt-3 text-sm text-gray-800 space-y-1.5">
        {items.length === 0 ? (
          <li className="text-gray-400">&mdash;</li>
        ) : (
          items.map((it) => (
            <li key={it.code} className="flex justify-between items-center">
              <span className="text-gray-600">{it.name}</span>
              <span className="font-semibold">{fmtINR(it.amount)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
