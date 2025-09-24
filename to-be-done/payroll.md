Awesome—here’s a crisp, step-by-step UI plan with file paths, minimal code scaffolds, and a final to-do checklist so your AI app builder can ingest it directly.

# 1) New folders & shared bits

```
src/lib/edgeClient.ts
src/payroll/types.ts
src/payroll/PayrollShell.tsx
src/payroll/PayrollAdminHome.tsx
src/payroll/PayrollPeriodBoard.tsx
src/payroll/CompensationEditor.tsx
src/payroll/StatutoryCenter.tsx
src/payroll/PayrollSettings.tsx
src/payroll/AttendanceImportWizard/UploadAndMap.tsx
src/payroll/AttendanceImportWizard/ReviewValidate.tsx
src/payroll/AttendanceImportWizard/ApplyOverrides.tsx
src/payroll/widgets/SalarySlipCard.tsx
src/payroll/widgets/AuditPanel.tsx
src/payroll/widgets/AttendanceBasisChip.tsx
src/payroll/widgets/BankAdviceModal.tsx
src/me/MyPayslip.tsx
```

## 1.1 `src/lib/edgeClient.ts`

```ts
export async function callEdge<T>(name: string, body: any, init?: RequestInit): Promise<T> {
  const url = `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init?.headers||{}) },
    body: JSON.stringify(body),
    ...init,
  });
  const json = await res.json();
  if (!res.ok || json?.ok === false) throw new Error(json?.error || res.statusText);
  return json.data as T;
}
```

## 1.2 `src/payroll/types.ts`

```ts
export type PayrollPeriod = { id:string; organization_id:string; month:number; year:number; status:string; };
export type PayrollRun = { id:string; user_id:string; net_pay:number; gross_earnings:number; pt_amount:number; snapshot:any; attendance_summary:any; };
export type AttendanceOverride = { user_id:string; payload:{payable_days:number; lop_days:number; paid_leaves:number; ot_hours:number; late_count:number; remarks?:string;} };
```

# 2) Router additions

## 2.1 Edit `src/App.tsx`

```tsx
// add lazy imports
const PayrollShell = lazy(() => import("./payroll/PayrollShell"));
const MyPayslip = lazy(() => import("./me/MyPayslip"));

{/* add routes */}
<Route path="/payroll/*" element={<PayrollShell />} />
<Route path="/me/payslips" element={<MyPayslip />} />
```

# 3) Layout & Navigation

## 3.1 `src/payroll/PayrollShell.tsx`

```tsx
import { Suspense, useState } from "react";
import { Link, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import PayrollAdminHome from "./PayrollAdminHome";
import PayrollPeriodBoard from "./PayrollPeriodBoard";
import CompensationEditor from "./CompensationEditor";
import StatutoryCenter from "./StatutoryCenter";
import PayrollSettings from "./PayrollSettings";
import UploadAndMap from "./AttendanceImportWizard/UploadAndMap";
import ReviewValidate from "./AttendanceImportWizard/ReviewValidate";
import ApplyOverrides from "./AttendanceImportWizard/ApplyOverrides";

export default function PayrollShell() {
  const [month, setMonth] = useState(new Date().getMonth()+1);
  const [year, setYear] = useState(new Date().getFullYear());
  const nav = useNavigate();
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r p-4 space-y-3">
        <h2 className="font-semibold">Payroll</h2>
        <nav className="flex flex-col gap-2">
          <Link to="home">Home</Link>
          <Link to="periods">Periods</Link>
          <Link to="import">Import</Link>
          <Link to="compensation">Compensation</Link>
          <Link to="statutory">Statutory</Link>
          <Link to="settings">Settings</Link>
        </nav>
        <div className="pt-4 space-y-2">
          <select value={month} onChange={e=>setMonth(+e.target.value)} className="border p-1 w-full">
            {Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}
          </select>
          <input className="border p-1 w-full" value={year} onChange={e=>setYear(+e.target.value)} />
          <button className="border p-1 w-full" onClick={()=>nav(0)}>Refresh</button>
        </div>
      </aside>
      <main className="flex-1 p-4">
        <Suspense fallback={<div>Loading…</div>}>
          <Routes>
            <Route path="home" element={<PayrollAdminHome month={month} year={year} />} />
            <Route path="periods" element={<PayrollPeriodBoard month={month} year={year} />} />
            <Route path="import" element={<UploadAndMap month={month} year={year} />} />
            <Route path="import/review" element={<ReviewValidate month={month} year={year} />} />
            <Route path="import/apply" element={<ApplyOverrides month={month} year={year} />} />
            <Route path="compensation" element={<CompensationEditor />} />
            <Route path="statutory" element={<StatutoryCenter month={month} year={year} />} />
            <Route path="settings" element={<PayrollSettings />} />
            <Route path="*" element={<Navigate to="home" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
```

# 4) Pages (skeletons + key calls)

## 4.1 `src/payroll/PayrollAdminHome.tsx`

```tsx
import { useEffect, useState } from "react";
import { callEdge } from "../lib/edgeClient";

export default function PayrollAdminHome({month, year}:{month:number; year:number}) {
  const [issues, setIssues] = useState<any[]>([]);
  const [period, setPeriod] = useState<any>(null);

  useEffect(() => {
    // fetch or create current period (example: your API/DB call here)
  }, [month, year]);

  async function runAudit() {
    // pass organization_id from your auth/org context
    const organization_id = (window as any).__ORG_ID__;
    const payroll_period_id = period?.id;
    if (!organization_id || !payroll_period_id) return;
    const res = await callEdge<{issues:any[]}>("ai-payroll-audit", { organization_id, payroll_period_id });
    setIssues(res.issues || []);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Payroll Home — {month}/{year}</h1>
      <div className="flex gap-3">
        <button className="border px-3 py-1" onClick={runAudit}>Run Audit</button>
        <button className="border px-3 py-1">Upload Attendance</button>
        <button className="border px-3 py-1">Generate Files</button>
      </div>
      <div>
        <h2 className="font-medium">Audit Issues</h2>
        <ul className="list-disc ml-6">
          {issues.map((i,idx)=><li key={idx}>{i.message}</li>)}
        </ul>
      </div>
    </div>
  );
}
```

## 4.2 `src/payroll/PayrollPeriodBoard.tsx`

```tsx
import { useEffect, useState } from "react";
import { callEdge } from "../lib/edgeClient";
import SalarySlipCard from "./widgets/SalarySlipCard";

export default function PayrollPeriodBoard({month, year}:{month:number;year:number}) {
  const [period,setPeriod]=useState<any>(null);
  const [rows,setRows]=useState<any[]>([]);
  const organization_id = (window as any).__ORG_ID__;
  const state = (window as any).__PAYROLL_STATE__ || "MH";

  useEffect(()=>{ /* load or create period + list employees */ },[month,year]);

  async function finalize(user_id:string){
    const data = await callEdge<any>("payroll-finalize-run",{ payroll_period_id: period.id, user_id, state });
    setRows(x=>x.map(r=>r.user_id===user_id?{...r, finalized:true, snapshot:data.snapshot, net_pay:data.net_pay}:r));
  }

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Period {month}/{year}</h1>
      <div className="grid gap-3">
        {rows.map(r=>(
          <div key={r.user_id} className="border p-3 rounded">
            <div className="flex justify-between">
              <div>{r.name}</div>
              <div className="flex gap-2">
                <button className="border px-2" onClick={()=>finalize(r.user_id)}>Finalize</button>
              </div>
            </div>
            {r.snapshot && <SalarySlipCard snapshot={r.snapshot} net={r.net_pay} />}
          </div>
        ))}
      </div>
    </div>
  );
}
```

## 4.3 Attendance Import Wizard

### `src/payroll/AttendanceImportWizard/UploadAndMap.tsx`

```tsx
import { useState } from "react";
import { callEdge } from "../../lib/edgeClient";
import { useNavigate } from "react-router-dom";

export default function UploadAndMap({month,year}:{month:number;year:number}) {
  const [fileUrl,setFileUrl]=useState("");
  const [batchId,setBatchId]=useState<string|null>(null);
  const nav=useNavigate();
  async function intake(){
    const organization_id = (window as any).__ORG_ID__;
    const r = await callEdge<{batch_id:string,inserted:number}>("ai-attendance-import-intake",{ organization_id, month, year, file_url:fileUrl });
    setBatchId(r.batch_id); nav("/payroll/import/review?batch="+r.batch_id);
  }
  return (
    <div className="space-y-3">
      <h2 className="font-semibold">Upload Attendance CSV</h2>
      <input className="border p-1 w-full" placeholder="Public CSV URL" value={fileUrl} onChange={e=>setFileUrl(e.target.value)} />
      <button className="border px-3 py-1" onClick={intake}>Detect & Map</button>
    </div>
  );
}
```

### `src/payroll/AttendanceImportWizard/ReviewValidate.tsx`

```tsx
import { useSearchParams, useNavigate } from "react-router-dom";
import { callEdge } from "../../lib/edgeClient";
import { useState } from "react";

export default function ReviewValidate({month,year}:{month:number;year:number}) {
  const [params]=useSearchParams(); const nav=useNavigate();
  const batch_id = params.get("batch")!;
  const [result,setResult]=useState<any>(null);

  async function validate(){
    const r = await callEdge("ai-attendance-import-validate-apply",{ batch_id, action:"validate" });
    setResult(r);
  }
  async function apply(){
    const approver_id = (window as any).__USER_ID__;
    await callEdge("ai-attendance-import-validate-apply",{ batch_id, action:"apply", approver_id });
    nav("/payroll/periods");
  }
  return (
    <div className="space-y-3">
      <h2 className="font-semibold">Review & Validate</h2>
      <button className="border px-3 py-1" onClick={validate}>Validate</button>
      {result && <pre className="bg-gray-50 p-2 rounded text-xs overflow-auto">{JSON.stringify(result,null,2)}</pre>}
      <button className="border px-3 py-1" onClick={apply}>Apply Overrides</button>
    </div>
  );
}
```

### `src/payroll/AttendanceImportWizard/ApplyOverrides.tsx`

(Slim placeholder; navigation from Review handles apply.)

```tsx
export default function ApplyOverrides(){ return <div>Applied.</div>; }
```

## 4.4 `src/payroll/CompensationEditor.tsx`

```tsx
import { useState } from "react";
import { callEdge } from "../lib/edgeClient";
// Use your supabase client for saving employee_compensation with RLS-enabled admin session.

export default function CompensationEditor(){
  const [ctc,setCtc]=useState<number>(600000);
  const [role,setRole]=useState<string>("Engineer");
  const [state,setState]=useState<string>("MH");
  const [payload,setPayload]=useState<any[]>([]);

  async function suggest(){
    const organization_id = (window as any).__ORG_ID__;
    const r = await callEdge<{compensation_payload:any[]}>("ai-ctc-composer",{ organization_id, ctc_annual: ctc, role, payroll_state: state });
    setPayload(r.compensation_payload);
  }

  return (
    <div className="space-y-3">
      <h1 className="font-semibold">Compensation Editor</h1>
      <div className="flex gap-2">
        <input className="border p-1" value={ctc} onChange={e=>setCtc(+e.target.value)} />
        <input className="border p-1" value={role} onChange={e=>setRole(e.target.value)} />
        <input className="border p-1" value={state} onChange={e=>setState(e.target.value)} />
        <button className="border px-3 py-1" onClick={suggest}>AI Suggest Split</button>
      </div>
      <pre className="bg-gray-50 p-2 rounded text-xs overflow-auto">{JSON.stringify(payload,null,2)}</pre>
      {/* TODO: map component_code -> component_id then upsert employee_compensation */}
    </div>
  );
}
```

## 4.5 `src/payroll/StatutoryCenter.tsx`

```tsx
import { useState } from "react";
import { callEdge } from "../lib/edgeClient";

export default function StatutoryCenter({month,year}:{month:number;year:number}){
  const [explain,setExplain]=useState<any>(null);
  const [filing,setFiling]=useState<any>(null);

  async function loadExplain(){
    const state = (window as any).__PAYROLL_STATE__ || "MH";
    const r = await callEdge<{markdown:string}>("ai-compliance-explainer",{ state, month, year });
    setExplain(r);
  }
  async function generate(type:string){
    const payroll_period_id = (window as any).__PERIOD_ID__;
    const r = await callEdge("ai-challan-assist",{ payroll_period_id, filing_type:type });
    setFiling(r);
  }

  return (
    <div className="space-y-3">
      <h1 className="font-semibold">Statutory Center</h1>
      <button className="border px-3 py-1" onClick={loadExplain}>Explain PF/ESIC/PT</button>
      {explain?.markdown && <div className="prose" dangerouslySetInnerHTML={{__html: explain.markdown}} />}
      <div className="flex gap-2">
        <button className="border px-3 py-1" onClick={()=>generate("PF_ECR")}>Generate PF ECR</button>
        <button className="border px-3 py-1" onClick={()=>generate("ESIC_RETURN")}>Generate ESIC</button>
      </div>
      {filing && <pre className="bg-gray-50 p-2 rounded text-xs overflow-auto">{JSON.stringify(filing,null,2)}</pre>}
    </div>
  );
}
```

## 4.6 `src/payroll/PayrollSettings.tsx`

```tsx
export default function PayrollSettings(){
  // Build forms bound to org_statutory_profiles, pay_components, compliance_rules, and import prefs
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Payroll Settings</h1>
      <section>
        <h2 className="font-medium">Organization</h2>
        {/* PF/ESIC/TAN/PAN/Bank/State form */}
      </section>
      <section>
        <h2 className="font-medium">Components</h2>
        {/* CRUD pay_components */}
      </section>
      <section>
        <h2 className="font-medium">Compliance Rules</h2>
        {/* Editor for compliance_rules with preview calculator */}
      </section>
      <section>
        <h2 className="font-medium">Attendance Basis</h2>
        {/* mapping memory, prefer overrides toggle */}
      </section>
      <section>
        <h2 className="font-medium">Payslip & Exports</h2>
        {/* logo/header/signature/rounding/presets */}
      </section>
    </div>
  );
}
```

# 5) Widgets & Employee page

## 5.1 `src/payroll/widgets/SalarySlipCard.tsx`

```tsx
export default function SalarySlipCard({snapshot, net}:{snapshot:any; net?:number}) {
  const comps = snapshot?.components || [];
  const earnings = comps.filter((c:any)=>c.type==="earning" || c.component_code?.includes("basic") || c.component_code?.includes("hra"));
  const deds = comps.filter((c:any)=>c.type==="deduction" || ["pf_employee","esic_employee","pt","tds"].includes(c.component_code));
  return (
    <div className="grid md:grid-cols-2 gap-3 text-sm">
      <div className="border rounded p-3">
        <h3 className="font-medium mb-2">Earnings</h3>
        {earnings.map((e:any,i:number)=><div key={i} className="flex justify-between"><span>{e.component_code}</span><span>{e.amount}</span></div>)}
      </div>
      <div className="border rounded p-3">
        <h3 className="font-medium mb-2">Deductions</h3>
        {deds.map((d:any,i:number)=><div key={i} className="flex justify-between"><span>{d.component_code}</span><span>-{d.amount}</span></div>)}
        <div className="mt-2 flex justify-between font-semibold"><span>Net</span><span>{net ?? snapshot?.net}</span></div>
      </div>
    </div>
  );
}
```

## 5.2 `src/me/MyPayslip.tsx`

```tsx
import { useEffect, useState } from "react";
import SalarySlipCard from "../payroll/widgets/SalarySlipCard";
// TODO: replace with your supabase client call to select posted payroll_runs for auth user

export default function MyPayslip(){
  const [month,setMonth]=useState(new Date().getMonth()+1);
  const [year,setYear]=useState(new Date().getFullYear());
  const [run,setRun]=useState<any>(null);

  useEffect(()=>{ /* load own payroll_run for (month,year) */ },[month,year]);

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-semibold">My Payslip</h1>
      <div className="flex gap-2">
        <select value={month} onChange={e=>setMonth(+e.target.value)} className="border p-1">
          {Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}
        </select>
        <input className="border p-1" value={year} onChange={e=>setYear(+e.target.value)} />
      </div>
      {run ? <SalarySlipCard snapshot={run.snapshot} net={run.net_pay} /> : <div>No payslip for this month.</div>}
    </div>
  );
}
```

# 6) To-Do checklist (copy into tracker)

1. **Routes**: Add `/payroll/*` & `/me/payslips` in `App.tsx`.
2. **Edge client**: Create `src/lib/edgeClient.ts` with `callEdge`.
3. **Shell**: Build `PayrollShell.tsx` with sidebar + month/year.
4. **Home**: Implement `PayrollAdminHome` and wire `ai-payroll-audit`.
5. **Periods**: Build `PayrollPeriodBoard` and wire `payroll-finalize-run`.
6. **Import**: Add `UploadAndMap` → `ai-attendance-import-intake`; `ReviewValidate` → validate/apply.
7. **Compensation**: Add `CompensationEditor` → `ai-ctc-composer`; save to `employee_compensation`.
8. **Statutory**: Add `StatutoryCenter` → `ai-compliance-explainer`, `ai-challan-assist`.
9. **Salary Slip**: Implement `SalarySlipCard` and `MyPayslip`.
10. **Settings**: Build `PayrollSettings` tabs for org IDs, components, rules, attendance prefs, payslip branding.
11. **Auth/Role gating**: Ensure only admins reach `/payroll/*`; employees only `/me/payslips`.
12. **Polish**: Loading states, error toasts, consistent buttons, empty states, and CSV download in BankAdviceModal.

This gives you a clean, isolated Payroll area, a separate Settings page for all PF/ESIC/TAN/PAN inputs, and a reusable Salary Slip component—wired to your new Edge Functions.
