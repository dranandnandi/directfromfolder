import { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import { useOrganization } from "../contexts/OrganizationContext";
import { PageHeader, AsyncSection, EmptyState } from "./widgets/Primitives";

/**
 * SCHEMA MAPPING (from schema.md)
 * pay_components (
 *   id uuid PK, code text UNIQUE, name text, type 'earning'|'deduction'|'employer_cost',
 *   calc_method 'fixed_amount'|'percent_of_component'|'percent_of_gross'|'formula',
 *   calc_value numeric, taxable boolean, pf_wage_participates boolean,
 *   esic_wage_participates boolean, sort_order int, active boolean
 * )
 *
 * org_statutory_profiles (
 *   id uuid PK, organization_id uuid UNIQUE,
 *   pf_number text, esic_number text, pt_state text, tan text, pan text,
 *   bank_details jsonb, challan_prefs jsonb
 * )
 */

// Utility functions for pretty display
function prettyType(type: string): string {
  switch (type) {
    case 'earning': return 'Earning';
    case 'deduction': return 'Deduction';
    case 'employer_cost': return 'Employer Cost';
    default: return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

function prettyMethod(method: string): string {
  switch (method) {
    case 'fixed_amount': return 'Fixed Amount';
    case 'percent_of_component': return 'Percent of Component';
    case 'percent_of_gross': return 'Percent of Gross';
    case 'formula': return 'Formula';
    default: return method.charAt(0).toUpperCase() + method.slice(1);
  }
}

// ---------- Types ----------
type ComponentType = "earning" | "deduction" | "employer_cost";
type CalcMethod = "fixed_amount" | "percent_of_component" | "percent_of_gross" | "formula";

type PayComponent = {
  id: string;
  code: string;
  name: string;
  type: ComponentType;
  calc_method: CalcMethod;
  calc_value: number;
  taxable: boolean;
  pf_wage_participates: boolean;
  esic_wage_participates: boolean;
  sort_order: number;
  active: boolean;
};

type OrgStatProfile = {
  id: string;
  organization_id: string;
  pf_number: string | null;
  esic_number: string | null;
  pt_state: string | null;
  tan: string | null;
  pan: string | null;
  bank_details: any | null;
  challan_prefs: any | null;
};

type SettingsSummary = {
  components: PayComponent[];
  org_profile: OrgStatProfile | null;
};

// ---------- Component ----------
export default function PayrollSettings() {
  const { organizationId } = useOrganization();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<SettingsSummary | null>(null);

  // table controls
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ComponentType>("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [sortKey, setSortKey] = useState<keyof PayComponent>("sort_order");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // editor state
  const [editing, setEditing] = useState<PayComponent | null>(null);
  const [jsonBank, setJsonBank] = useState<string>("");
  const [jsonChallan, setJsonChallan] = useState<string>("");

  // profile form
  const [profile, setProfile] = useState<OrgStatProfile | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      // Fetch pay components directly from Supabase
      const { data: components, error: componentsError } = await supabase
        .from('pay_components')
        .select('*')
        .order('sort_order');

      if (componentsError) {
        throw new Error(`Failed to load pay components: ${componentsError.message}`);
      }

      // Fetch organization statutory profile directly from Supabase
      const { data: orgProfile, error: profileError } = await supabase
        .from('org_statutory_profiles')
        .select('*')
        .eq('organization_id', organizationId)
        .single();

      // Profile might not exist yet, so ignore "not found" errors
      if (profileError && profileError.code !== 'PGRST116') {
        console.warn('Failed to load org profile:', profileError.message);
      }

      const res: SettingsSummary = {
        components: components || [],
        org_profile: orgProfile || null
      };

      setData(res);
      setProfile(res.org_profile);
      setJsonBank(JSON.stringify(res.org_profile?.bank_details ?? {}, null, 2));
      setJsonChallan(JSON.stringify(res.org_profile?.challan_prefs ?? {}, null, 2));
    } catch (e: any) {
      setErr(e?.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  // ---- table computed ----
  const filtered = useMemo(() => {
    if (!data?.components) return [];
    const needle = q.trim().toLowerCase();
    let rows = data.components.filter((r) => {
      const matchesQ =
        !needle ||
        r.code.toLowerCase().includes(needle) ||
        r.name.toLowerCase().includes(needle);
      const matchesType = typeFilter === "all" || r.type === typeFilter;
      const matchesActive =
        activeFilter === "all" ||
        (activeFilter === "active" ? r.active : !r.active);
      return matchesQ && matchesType && matchesActive;
    });
    rows.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return rows;
  }, [data, q, typeFilter, activeFilter, sortKey, sortDir]);

  function toggleSort(k: keyof PayComponent) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  // ---- component actions ----
  function startCreate() {
    setEditing({
      id: "",
      code: "",
      name: "",
      type: "earning",
      calc_method: "fixed_amount",
      calc_value: 0,
      taxable: true,
      pf_wage_participates: false,
      esic_wage_participates: false,
      sort_order: 100,
      active: true,
    });
  }

  function startEdit(pc: PayComponent) {
    setEditing({ ...pc });
  }

  function startClone(pc: PayComponent) {
    setEditing({
      ...pc,
      id: "",
      code: pc.code + "_COPY",
      name: pc.name + " (copy)",
      sort_order: pc.sort_order + 1,
      active: pc.active,
    });
  }

  async function saveComponent() {
    if (!editing) return;
    if (!editing.code.trim() || !editing.name.trim()) {
      alert("Code and Name are required.");
      return;
    }
    // Validate calc_value numeric
    const payload: Partial<PayComponent> = {
      ...editing,
      calc_value: Number(editing.calc_value) || 0,
      sort_order: Number(editing.sort_order) || 100,
    };
    try {
      if (editing.id) {
        // Update existing component
        const { error } = await supabase
          .from('pay_components')
          .update(payload)
          .eq('id', editing.id);
        
        if (error) throw new Error(error.message);
      } else {
        // Create new component
        const { error } = await supabase
          .from('pay_components')
          .insert({ ...payload });
        
        if (error) throw new Error(error.message);
      }
      await load();
      setEditing(null);
    } catch (e: any) {
      alert(e?.message || "Failed to save pay component");
    }
  }

  async function deleteComponent(id: string) {
    if (!confirm("Delete this component? This cannot be undone.")) return;
    try {
      const { error } = await supabase
        .from('pay_components')
        .delete()
        .eq('id', id);
      
      if (error) throw new Error(error.message);
      await load();
    } catch (e: any) {
      alert(e?.message || "Failed to delete pay component");
    }
  }

  // ---- CSV export/import ----
  function exportCSV() {
    const cols: (keyof PayComponent)[] = [
      "code",
      "name",
      "type",
      "calc_method",
      "calc_value",
      "taxable",
      "pf_wage_participates",
      "esic_wage_participates",
      "sort_order",
      "active",
    ];
    const header = cols.join(",");
    const lines = filtered.map((r) =>
      cols
        .map((k) => {
          const v = (r as any)[k];
          const s = typeof v === "string" ? v : String(v);
          return s.includes(",") ? `"${s}"` : s;
        })
        .join(",")
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pay_components.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importCSV(file: File) {
    const text = await file.text();
    const rows = text.split(/\r?\n/).filter(Boolean);
    const header = rows.shift();
    if (!header) return alert("Invalid CSV: no header row");
    const cols = header.split(",").map((s) => s.trim());
    const required = [
      "code",
      "name",
      "type",
      "calc_method",
      "calc_value",
      "taxable",
      "pf_wage_participates",
      "esic_wage_participates",
      "sort_order",
      "active",
    ];
    const missing = required.filter((c) => !cols.includes(c));
    if (missing.length) return alert("Missing columns: " + missing.join(", "));
    const toCreate: Partial<PayComponent>[] = rows.map((line) => {
      const cells = parseCSVLine(line);
      const row: any = {};
      cols.forEach((c, i) => (row[c] = cells[i]));
      return {
        code: String(row.code || "").trim(),
        name: String(row.name || "").trim(),
        type: row.type as ComponentType,
        calc_method: row.calc_method as CalcMethod,
        calc_value: Number(row.calc_value) || 0,
        taxable: row.taxable === "true" || row.taxable === "1",
        pf_wage_participates: row.pf_wage_participates === "true" || row.pf_wage_participates === "1",
        esic_wage_participates: row.esic_wage_participates === "true" || row.esic_wage_participates === "1",
        sort_order: Number(row.sort_order) || 100,
        active: row.active === "true" || row.active === "1",
      };
    });
    try {
      // Add organization_id to all rows
      const rowsWithOrg = toCreate;
      
      // Use upsert to handle both inserts and updates
      const { error } = await supabase
        .from('pay_components')
        .upsert(rowsWithOrg, {
          onConflict: 'code'
        });
      
      if (error) throw new Error(error.message);
      
      await load();
      alert(`Imported ${toCreate.length} components.`);
    } catch (e: any) {
      alert(e?.message || "Failed to import CSV");
    }
  }

  // ---- profile actions ----
  async function saveProfile() {
    if (!profile) return;
    let bank: any, challan: any;
    try {
      bank = jsonBank.trim() ? JSON.parse(jsonBank) : {};
    } catch {
      return alert("bank_details JSON is invalid");
    }
    try {
      challan = jsonChallan.trim() ? JSON.parse(jsonChallan) : {};
    } catch {
      return alert("challan_prefs JSON is invalid");
    }
    setSavingProfile(true);
    try {
      const profileData = {
        organization_id: organizationId,
        pf_number: profile.pf_number,
        esic_number: profile.esic_number,
        pt_state: profile.pt_state,
        tan: profile.tan,
        pan: profile.pan,
        bank_details: bank,
        challan_prefs: challan,
      };

      // Use upsert to create or update the profile
      const { error } = await supabase
        .from('org_statutory_profiles')
        .upsert(profileData, {
          onConflict: 'organization_id'
        });
      
      if (error) throw new Error(error.message);
      
      await load();
    } catch (e: any) {
      alert(e?.message || "Failed to save org profile");
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-lg border shadow-sm p-6">
        <PageHeader title="Payroll Settings" subtitle="Manage pay components & statutory profile" />
        <AsyncSection loading={loading} error={err}>
          {!data ? (
            <EmptyState title="No data" description="Could not load settings." />
          ) : (
            <>
              {/* COMPONENTS */}
              <section className="mb-8">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">Pay Components</h2>
                    <p className="text-sm text-gray-600">
                      Earnings, deductions, and employer costs used by your payroll engine.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={startCreate}
                      className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                    >
                      Add Component
                    </button>
                    <button
                      onClick={exportCSV}
                      className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50"
                    >
                      Export CSV
                    </button>
                    <label className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50 cursor-pointer">
                      Import CSV
                      <input
                        type="file"
                        accept=".csv"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) importCSV(f);
                          e.currentTarget.value = "";
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="code or name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value as any)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All</option>
                      <option value="earning">Earning</option>
                      <option value="deduction">Deduction</option>
                      <option value="employer_cost">Employer Cost</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Active</label>
                    <select
                      value={activeFilter}
                      onChange={(e) => setActiveFilter(e.target.value as any)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sort</label>
                    <div className="flex gap-2">
                      <select
                        value={sortKey}
                        onChange={(e) => setSortKey(e.target.value as keyof PayComponent)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="sort_order">Sort Order</option>
                        <option value="code">Code</option>
                        <option value="name">Name</option>
                        <option value="type">Type</option>
                        <option value="calc_method">Calc Method</option>
                        <option value="active">Active</option>
                      </select>
                      <button
                        onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                        className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50"
                        title="Toggle sort direction"
                      >
                        {sortDir === "asc" ? "▲" : "▼"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Table */}
                <div className="bg-white border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          <Th label="Order" onClick={() => toggleSort("sort_order")} active={sortKey === "sort_order"} dir={sortDir} />
                          <Th label="Code" onClick={() => toggleSort("code")} active={sortKey === "code"} dir={sortDir} />
                          <Th label="Name" onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir} />
                          <Th label="Type" onClick={() => toggleSort("type")} active={sortKey === "type"} dir={sortDir} />
                          <Th label="Method" onClick={() => toggleSort("calc_method")} active={sortKey === "calc_method"} dir={sortDir} />
                          <th className="px-6 py-3 text-left">Value</th>
                          <th className="px-6 py-3 text-left">Taxable</th>
                          <th className="px-6 py-3 text-left">PF Wage</th>
                          <th className="px-6 py-3 text-left">ESIC Wage</th>
                          <Th label="Active" onClick={() => toggleSort("active")} active={sortKey === "active"} dir={sortDir} />
                          <th className="px-6 py-3 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filtered.length === 0 && (
                          <tr>
                            <td colSpan={11} className="px-6 py-6">
                              <EmptyState title="No components" description="Use Add Component to create your first item." />
                            </td>
                          </tr>
                        )}
                        {filtered.map((r) => (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-6 py-3">{r.sort_order}</td>
                            <td className="px-6 py-3 font-mono">{r.code}</td>
                            <td className="px-6 py-3">{r.name}</td>
                            <td className="px-6 py-3">{prettyType(r.type)}</td>
                            <td className="px-6 py-3">{prettyMethod(r.calc_method)}</td>
                            <td className="px-6 py-3">{r.calc_value}</td>
                            <td className="px-6 py-3">
                              <Pill ok={r.taxable} yes="Taxable" no="Non-tax" />
                            </td>
                            <td className="px-6 py-3">
                              <Pill ok={r.pf_wage_participates} yes="Yes" no="No" />
                            </td>
                            <td className="px-6 py-3">
                              <Pill ok={r.esic_wage_participates} yes="Yes" no="No" />
                            </td>
                            <td className="px-6 py-3">
                              <Pill ok={r.active} yes="Active" no="Inactive" />
                            </td>
                            <td className="px-6 py-3">
                              <div className="flex flex-wrap gap-2">
                                <button className="px-3 py-1 rounded-md border bg-white hover:bg-gray-50" onClick={() => startEdit(r)}>
                                  Edit
                                </button>
                                <button className="px-3 py-1 rounded-md border bg-white hover:bg-gray-50" onClick={() => startClone(r)}>
                                  Clone
                                </button>
                                <button
                                  className="px-3 py-1 rounded-md border bg-white hover:bg-gray-50 text-red-700"
                                  onClick={() => deleteComponent(r.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Editor */}
                {editing && (
                  <div className="mt-6 bg-white rounded-lg border p-6">
                    <h3 className="text-base font-semibold text-gray-900 mb-4">
                      {editing.id ? "Edit Component" : "Add Component"}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <TextField label="Code" value={editing.code} onChange={(v) => setEditing((p) => ({ ...p!, code: v }))} />
                      <TextField label="Name" value={editing.name} onChange={(v) => setEditing((p) => ({ ...p!, name: v }))} />
                      <SelectField
                        label="Type"
                        value={editing.type}
                        onChange={(v) => setEditing((p) => ({ ...p!, type: v as ComponentType }))}
                        options={[
                          { value: "earning", label: "Earning" },
                          { value: "deduction", label: "Deduction" },
                          { value: "employer_cost", label: "Employer Cost" },
                        ]}
                      />
                      <SelectField
                        label="Calc Method"
                        value={editing.calc_method}
                        onChange={(v) => setEditing((p) => ({ ...p!, calc_method: v as CalcMethod }))}
                        options={[
                          { value: "fixed_amount", label: "Fixed amount" },
                          { value: "percent_of_component", label: "Percent of a component" },
                          { value: "percent_of_gross", label: "Percent of gross" },
                          { value: "formula", label: "Formula" },
                        ]}
                      />
                      <NumberField
                        label="Calc Value"
                        value={editing.calc_value}
                        onChange={(v) => setEditing((p) => ({ ...p!, calc_value: v }))}
                      />
                      <NumberField
                        label="Sort Order"
                        value={editing.sort_order}
                        onChange={(v) => setEditing((p) => ({ ...p!, sort_order: v }))}
                      />
                      <CheckboxField
                        label="Taxable"
                        checked={editing.taxable}
                        onChange={(v) => setEditing((p) => ({ ...p!, taxable: v }))}
                      />
                      <CheckboxField
                        label="Participates in PF wages"
                        checked={editing.pf_wage_participates}
                        onChange={(v) => setEditing((p) => ({ ...p!, pf_wage_participates: v }))}
                      />
                      <CheckboxField
                        label="Participates in ESIC wages"
                        checked={editing.esic_wage_participates}
                        onChange={(v) => setEditing((p) => ({ ...p!, esic_wage_participates: v }))}
                      />
                      <CheckboxField
                        label="Active"
                        checked={editing.active}
                        onChange={(v) => setEditing((p) => ({ ...p!, active: v }))}
                      />
                    </div>

                    {editing.calc_method === "percent_of_component" && (
                      <div className="mt-3 text-sm text-gray-600">
                        <strong>Note:</strong> Server-side engine should resolve the base component using the business rule
                        you’ve defined (e.g., `basic` or `gross`). This UI stores only the percentage in <em>calc_value</em>.
                      </div>
                    )}

                    {editing.calc_method === "formula" && (
                      <div className="mt-3 text-sm text-gray-600">
                        <strong>Note:</strong> Keep formula parsing server-side. UI only saves <em>calc_value</em> as a hint or
                        coefficient if required by your engine.
                      </div>
                    )}

                    <div className="mt-6 flex justify-end gap-2">
                      <button className="px-4 py-2 rounded-md border bg-white hover:bg-gray-50" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                      <button className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700" onClick={saveComponent}>
                        Save Component
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* ORG STATUTORY PROFILE */}
              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Org Statutory Profile</h2>
                <p className="text-sm text-gray-600 mb-3">
                  PF/ESIC/PT/TAN/PAN plus bank info and challan preferences used by challan/file generators.
                </p>

                {!profile ? (
                  <EmptyState title="No profile" description="Create your statutory profile to proceed with filings." />
                ) : (
                  <div className="bg-white rounded-lg border p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <TextField label="PF Number" value={profile.pf_number || ""} onChange={(v) => setProfile((p) => ({ ...p!, pf_number: v }))} />
                      <TextField label="ESIC Number" value={profile.esic_number || ""} onChange={(v) => setProfile((p) => ({ ...p!, esic_number: v }))} />
                      <TextField label="PT State" value={profile.pt_state || ""} onChange={(v) => setProfile((p) => ({ ...p!, pt_state: v }))} />
                      <TextField label="TAN" value={profile.tan || ""} onChange={(v) => setProfile((p) => ({ ...p!, tan: v }))} />
                      <TextField label="PAN" value={profile.pan || ""} onChange={(v) => setProfile((p) => ({ ...p!, pan: v }))} />
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Bank Details (JSON)</label>
                        <textarea
                          rows={10}
                          value={jsonBank}
                          onChange={(e) => setJsonBank(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="text-xs text-gray-500 mt-1">
                          Example: {"{ \"bank_name\": \"HDFC\", \"account_no\": \"xxxx\", \"ifsc\": \"HDFC0000\" }"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Challan Prefs (JSON)</label>
                        <textarea
                          rows={10}
                          value={jsonChallan}
                          onChange={(e) => setJsonChallan(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="text-xs text-gray-500 mt-1">
                          Example: {"{ \"pf_payment_mode\": \"netbanking\", \"esic_payment_mode\": \"netbanking\" }"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={saveProfile}
                        disabled={savingProfile}
                        className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingProfile ? "Saving…" : "Save Profile"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </AsyncSection>
      </div>
    </div>
  );
}

// ---------- Small UI bits ----------
function Th({
  label,
  onClick,
  active,
  dir,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  dir: "asc" | "desc";
}) {
  return (
    <th className="px-6 py-3 text-left font-medium cursor-pointer select-none" onClick={onClick} title={`Sort by ${label}`}>
      <div className="inline-flex items-center gap-1">
        <span>{label}</span>
        {active && <span className="text-gray-400">{dir === "asc" ? "▲" : "▼"}</span>}
      </div>
    </th>
  );
}

function Pill({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs ${ok ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-700"}`}>
      {ok ? yes : no}
    </span>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------- CSV helper ----------
function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}
