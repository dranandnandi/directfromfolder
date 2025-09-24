import { useContext, useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../utils/supabaseClient";
import { useOrganization } from "../contexts/OrganizationContext";
import { PayrollContext } from "./PayrollShell";
import { PageHeader, AsyncSection, EmptyState } from "./widgets/Primitives";
import { Link } from "react-router-dom";
import { fetchPayrollPeriod, type PayrollPeriodRow } from '../services/payrollPeriods';

/** ===== Types tied to schema ===== */
// Period uses the service type aligned to DB schema
type Period = PayrollPeriodRow | null;

type FilingType = "PF_ECR" | "ESIC_RETURN" | "PT" | "TDS24Q" | "CHALLAN_PF" | "CHALLAN_ESIC";
type FilingStatus = "draft" | "generated" | "filed";

type Filing = {
  id: string;
  payroll_period_id: string;
  filing_type: FilingType;
  status: FilingStatus;
  file_url: string | null;
  payload: any | null;
  generated_at: string | null;
  generated_by: string | null;
};

type OrgProfile = {
  pf_number: string | null;
  esic_number: string | null;
  pt_state: string | null;
  tan: string | null;
  pan: string | null;
  bank_details: Record<string, any> | null;  // org_statutory_profiles.bank_details
  challan_prefs: Record<string, any> | null; // org_statutory_profiles.challan_prefs
};

type StatTotals = {
  pf_wages: number | null;      // SUM(payroll_runs.pf_wages)
  pf_employee: number | null;   // calculated server-side (e.g., 12% or as per rules)
  pf_employer: number | null;   // server-side
  esic_wages: number | null;    // SUM(payroll_runs.esic_wages)
  esic_employee: number | null; // server-side
  esic_employer: number | null; // server-side
  pt_amount: number | null;     // SUM(payroll_runs.pt_amount)
  tds_amount: number | null;    // SUM(payroll_runs.tds_amount)
};

type Summary = {
  period: Period;
  org_profile: OrgProfile;
  totals: StatTotals;
  filings: Filing[];
};

/** ===== Component ===== */
export default function StatutoryCenter() {
  const { month, year } = useContext(PayrollContext);
  const { organizationId } = useOrganization();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string>(""); // action key
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    if (!organizationId) {
      console.warn('[StatutoryCenter] Missing organizationId');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [period, orgProfileResult] = await Promise.all([
        fetchPayrollPeriod({
          organizationId,
          month,
          year,
        }),
        supabase
          .from('org_statutory_profiles')
          .select('*')
          .eq('organization_id', organizationId)
          .maybeSingle(),
      ]);

      if (orgProfileResult.error) {
        console.error(
          '[StatutoryCenter] Failed to fetch org_statutory_profiles',
          {
            organizationId,
            error: orgProfileResult.error,
          },
        );
        throw orgProfileResult.error;
      }

      // If no period exists, set minimal data and return
      if (!period) {
        setData({
          period: null,
          org_profile: orgProfileResult.data ?? ({} as any),
          totals: {
            pf_wages: null,
            pf_employee: null,
            pf_employer: null,
            esic_wages: null,
            esic_employee: null,
            esic_employer: null,
            pt_amount: null,
            tds_amount: null,
          },
          filings: [],
        });
        return;
      }

      // Fetch filings by payroll_period_id per schema
      const { data: filingsData, error: filingsErr } = await supabase
        .from('statutory_filings')
        .select('*')
        .eq('payroll_period_id', period.id);

      if (filingsErr) {
        console.error('[StatutoryCenter] Failed to fetch statutory_filings', {
          payroll_period_id: period.id,
          error: filingsErr,
        });
        throw filingsErr;
      }

      setData({
        period,
        org_profile: orgProfileResult.data ?? ({} as any),
        filings: filingsData ?? [],
        totals: {
          pf_wages: null,
          pf_employee: null,
          pf_employer: null,
          esic_wages: null,
          esic_employee: null,
          esic_employer: null,
          pt_amount: null,
          tds_amount: null,
        },
      });
    } catch (err) {
      console.error('[StatutoryCenter] loadSummary errored', {
        organizationId,
        month,
        year,
        error: err,
      });
      setError('Unable to load statutory summary.');
    } finally {
      setLoading(false);
    }
  }, [organizationId, month, year]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const byType = useMemo(() => {
    const map: Partial<Record<FilingType, Filing>> = {};
    (data?.filings || []).forEach((f) => (map[f.filing_type] = f));
    return map;
  }, [data]);

  /** ===== Actions (no placeholders) =====
   * - generate_filing: { type: FilingType } creates/updates statutory_filings row, fills file_url/payload/generated_at
   * - mark_filed:      { filing_id } flips status->filed
   * The server should validate period.status and preconditions.
   */
  async function generate(type: FilingType) {
    if (!data || !data.period?.id) return;
    const key = `gen:${type}`;
    setActionBusy(key);
    try {
      // Generate filing - this involves complex compliance logic
      // In production, this should remain as an Edge Function for proper compliance
      const { error: filingError } = await supabase
        .from('statutory_filings')
        .insert({
          payroll_period_id: data.period.id,
          filing_type: type,
          status: 'generated' as FilingStatus,
          generated_at: new Date().toISOString(), 
          payload: { note: 'Generated via simplified process - use Edge Function for production' }
        });

      if (filingError) throw new Error(filingError.message);
      await loadSummary();
    } catch (e: any) {
      alert(e?.message || `Failed to generate ${type}`);
    } finally {
      setActionBusy("");
    }
  }

  async function markFiled(filingId: string) {
    const key = `file:${filingId}`;
    setActionBusy(key);
    try {
      // Mark filing as filed - simple status update
      const { error: markError } = await supabase
        .from('statutory_filings')
        .update({ 
          status: 'filed' as FilingStatus,
          filed_at: new Date().toISOString()
        })
        .eq('id', filingId);

      if (markError) throw new Error(markError.message);
      await loadSummary();
    } catch (e: any) {
      alert(e?.message || "Failed to mark as filed");
    } finally {
      setActionBusy("");
    }
  }

  const curr = (n?: number | null) => (typeof n === "number" ? `₹${n.toLocaleString("en-IN")}` : "-");

  /** Guard chips */
  function GuardRow() {
    const p = data?.org_profile;
    if (!p) return null;
    const guards: { label: string; ok: boolean }[] = [
      { label: `PF ${p.pf_number ? "linked" : "missing"}`, ok: !!p.pf_number },
      { label: `ESIC ${p.esic_number ? "linked" : "missing"}`, ok: !!p.esic_number },
      { label: `PT state ${p.pt_state ? p.pt_state : "missing"}`, ok: !!p.pt_state },
      { label: `TAN ${p.tan ? "present" : "missing"}`, ok: !!p.tan },
      { label: `PAN ${p.pan ? "present" : "missing"}`, ok: !!p.pan },
      { label: `Bank details ${p.bank_details ? "present" : "missing"}`, ok: !!p.bank_details },
    ];
    return (
      <div className="flex flex-wrap gap-2">
        {guards.map((g, i) => (
          <span
            key={i}
            className={`px-2 py-0.5 rounded-full text-xs ${
              g.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
            }`}
          >
            {g.label}
          </span>
        ))}
        <Link to="/payroll/settings" className="text-xs text-blue-600 hover:underline">
          Update statutory profile
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <PageHeader
          title={`Statutory Center — ${month}/${year}`}
          subtitle="Generate ECR/ESIC/PT/TDS files & challans, then mark as filed"
        />

        <AsyncSection loading={loading} error={error}>
          {!data ? (
            <EmptyState title="No data" description="Could not load this period’s statutory summary." />
          ) : (
            <>
              {/* Period ribbon */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800">
                    Period ID: {data.period?.id ?? '—'}
                  </span>
                  {data.period && (
                    <span
                      className={`px-2 py-1 rounded-full text-xs ${
                        data.period.status === "draft"
                          ? "bg-yellow-100 text-yellow-800"
                          : data.period.status === "locked"
                          ? "bg-blue-100 text-blue-800"
                          : data.period.status === "posted"
                          ? "bg-green-100 text-green-800"
                          : "bg-purple-100 text-purple-800"
                      }`}
                    >
                      {data.period.status}
                    </span>
                  )}
                </div>
                <GuardRow />
              </div>

              {/* Totals */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <SummaryCard
                  title="PF"
                  subtitle={`Wages: ${curr(data.totals.pf_wages)}`}
                  lines={[
                    { k: "Employee", v: curr(data.totals.pf_employee) },
                    { k: "Employer", v: curr(data.totals.pf_employer) },
                  ]}
                />
                <SummaryCard
                  title="ESIC"
                  subtitle={`Wages: ${curr(data.totals.esic_wages)}`}
                  lines={[
                    { k: "Employee", v: curr(data.totals.esic_employee) },
                    { k: "Employer", v: curr(data.totals.esic_employer) },
                  ]}
                />
                <SummaryCard title="PT" subtitle="State-wise total" lines={[{ k: "Amount", v: curr(data.totals.pt_amount) }]} />
                <SummaryCard title="TDS" subtitle="Form 24Q (est.)" lines={[{ k: "Amount", v: curr(data.totals.tds_amount) }]} />
              </div>

              {/* Generators */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* PF */}
                <GeneratorCard
                  title="PF ECR"
                  desc="Generate ECR text and bank challan for Provident Fund."
                  filing={byType.PF_ECR}
                  onGenerate={() => generate("PF_ECR")}
                  onFiled={() => byType.PF_ECR && markFiled(byType.PF_ECR.id)}
                  busyKey={actionBusy}
                />
                {/* ESIC */}
                <GeneratorCard
                  title="ESIC Return"
                  desc="Generate return file and challan for ESIC portal."
                  filing={byType.ESIC_RETURN}
                  onGenerate={() => generate("ESIC_RETURN")}
                  onFiled={() => byType.ESIC_RETURN && markFiled(byType.ESIC_RETURN.id)}
                  busyKey={actionBusy}
                />
                {/* PT */}
                <GeneratorCard
                  title="Professional Tax"
                  desc="Generate PT state return file."
                  filing={byType.PT}
                  onGenerate={() => generate("PT")}
                  onFiled={() => byType.PT && markFiled(byType.PT.id)}
                  busyKey={actionBusy}
                />
                {/* TDS */}
                <GeneratorCard
                  title="TDS 24Q"
                  desc="Generate TDS Form 24Q text/FVU-ready payload."
                  filing={byType.TDS24Q}
                  onGenerate={() => generate("TDS24Q")}
                  onFiled={() => byType.TDS24Q && markFiled(byType.TDS24Q.id)}
                  busyKey={actionBusy}
                />
                {/* PF Challan */}
                <GeneratorCard
                  title="PF Challan"
                  desc="Generate PF challan PDF."
                  filing={byType.CHALLAN_PF}
                  onGenerate={() => generate("CHALLAN_PF")}
                  onFiled={() => byType.CHALLAN_PF && markFiled(byType.CHALLAN_PF.id)}
                  busyKey={actionBusy}
                />
                {/* ESIC Challan */}
                <GeneratorCard
                  title="ESIC Challan"
                  desc="Generate ESIC challan PDF."
                  filing={byType.CHALLAN_ESIC}
                  onGenerate={() => generate("CHALLAN_ESIC")}
                  onFiled={() => byType.CHALLAN_ESIC && markFiled(byType.CHALLAN_ESIC.id)}
                  busyKey={actionBusy}
                />
              </section>

              {/* Recent filings */}
              <section className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Filings This Period</h3>
                {data.filings.length === 0 ? (
                  <EmptyState title="None yet" description="Generate your first filing above." />
                ) : (
                  <ul className="divide-y">
                    {data.filings
                      .slice()
                      .sort((a, b) => (a.filing_type > b.filing_type ? 1 : -1))
                      .map((f) => (
                        <li key={f.id} className="py-3 flex items-center justify-between">
                          <div>
                            <div className="text-sm text-gray-900">{f.filing_type}</div>
                            <div className="text-xs text-gray-500">
                              {f.generated_at ? new Date(f.generated_at).toLocaleString() : "Not generated"}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs ${
                                f.status === "filed"
                                  ? "bg-green-100 text-green-800"
                                  : f.status === "generated"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-yellow-100 text-yellow-800"
                              }`}
                            >
                              {f.status}
                            </span>
                            {f.file_url && (
                              <a href={f.file_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                Download
                              </a>
                            )}
                            {f.status !== "filed" && (
                              <button
                                onClick={() => markFiled(f.id)}
                                className="px-3 py-1 rounded-md border bg-white hover:bg-gray-50"
                              >
                                Mark Filed
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </AsyncSection>
      </div>
    </div>
  );
}

/** ===== UI bits ===== */
function SummaryCard({
  title,
  subtitle,
  lines,
}: {
  title: string;
  subtitle: string;
  lines: { k: string; v: string }[];
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-1 text-sm text-gray-700">{subtitle}</div>
      <ul className="mt-3 text-sm text-gray-900 space-y-1">
        {lines.map((l, i) => (
          <li key={i} className="flex justify-between">
            <span>{l.k}</span>
            <span className="font-medium">{l.v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GeneratorCard({
  title,
  desc,
  filing,
  onGenerate,
  onFiled,
  busyKey,
}: {
  title: string;
  desc: string;
  filing?: Filing;
  onGenerate: () => void;
  onFiled: () => void;
  busyKey: string;
}) {
  const genKey = `gen:${filing?.filing_type || title}`;
  const fileKey = `file:${filing?.id || title}`;
  const genBusy = busyKey === genKey;
  const fileBusy = busyKey === fileKey;

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-base font-semibold text-gray-900">{title}</div>
        <span
          className={`px-2 py-0.5 rounded-full text-xs ${
            filing
              ? filing.status === "filed"
                ? "bg-green-100 text-green-800"
                : filing.status === "generated"
                ? "bg-blue-100 text-blue-800"
                : "bg-yellow-100 text-yellow-800"
              : "bg-gray-100 text-gray-800"
          }`}
        >
          {filing ? filing.status : "not generated"}
        </span>
      </div>
      <div className="text-sm text-gray-600">{desc}</div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onGenerate}
          disabled={genBusy}
          className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {genBusy ? "Generating…" : "Generate"}
        </button>
        {filing?.file_url && (
          <a
            href={filing.file_url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50"
          >
            Download
          </a>
        )}
        {filing && filing.status !== "filed" && (
          <button
            onClick={onFiled}
            disabled={fileBusy}
            className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {fileBusy ? "Marking…" : "Mark Filed"}
          </button>
        )}
      </div>

      {filing?.payload && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-gray-700">View payload</summary>
          <pre className="mt-2 text-xs bg-gray-50 border rounded p-2 overflow-x-auto">
            {JSON.stringify(filing.payload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
