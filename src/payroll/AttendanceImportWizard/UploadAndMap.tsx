import { useContext, useEffect, useMemo, useState } from "react";
import { callEdge } from "../../lib/edgeClient";
import { PayrollContext } from "../PayrollShell";
import { PageHeader, AsyncSection, EmptyState } from "../widgets/Primitives";
import { Link } from "react-router-dom";

/** ===== Schema-aligned types ===== */
type BatchStatus = "uploaded" | "mapped" | "validated" | "applied" | "rejected";
type SourceType = "excel" | "csv" | "biometric";

type ImportBatch = {
  id: string;
  organization_id: string;
  month: number;
  year: number;
  source: SourceType;
  file_url: string | null;
  detected_format: any | null;     // { headers: string[], sample: string[][], dialect?: {...} }
  column_mapping: ColumnMapping | null;
  status: BatchStatus;
  created_by: string | null;
  created_at: string;
};

type ColumnMapping = {
  // map input headers -> normalized keys used for attendance normalization
  employee_code?: string;
  user_id?: string;
  date?: string;
  check_in?: string;
  check_out?: string;
  hours?: string;
  overtime_hours?: string;
  remarks?: string;
  // optional extras that your engine may use:
  shift_code?: string;
  break_minutes?: string;
};

type DetectResponse = {
  headers: string[];
  sample: string[][];
  dialect?: Record<string, any>;
};

type StageSummary = {
  total_rows: number;
  matched_users: number;        // count rows with user_id resolved
  avg_match_confidence: number; // 0..100
  duplicates: number;
  errors: number;
  will_apply_rows: number;      // rows eligible to apply
};

type BatchSummary = {
  batch: ImportBatch;
  detect: DetectResponse | null;
  stage: StageSummary | null;
};

export default function UploadAndMap() {
  const { month, year, orgId } = useContext(PayrollContext);

  // UI state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // current batch context
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [detect, setDetect] = useState<DetectResponse | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({
    employee_code: "",
    user_id: "",
    date: "",
    check_in: "",
    check_out: "",
    hours: "",
    overtime_hours: "",
    remarks: "",
    shift_code: "",
    break_minutes: "",
  });
  const [stage, setStage] = useState<StageSummary | null>(null);

  const hasMapping = useMemo(
    () =>
      !!mapping.date &&
      (!!mapping.employee_code || !!mapping.user_id) &&
      (!!mapping.check_in || !!mapping.hours),
    [mapping]
  );

  // Load latest batch (if any) when page opens (so admin can resume)
  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const resume = await callEdge<BatchSummary | null>("attendance-latest-batch-for-period", {
          organization_id: orgId,
          month,
          year,
        });
        if (resume?.batch) {
          setBatch(resume.batch);
          setDetect(resume.detect);
          setStage(resume.stage);
          setMapping({
            employee_code: resume.batch.column_mapping?.employee_code || "",
            user_id: resume.batch.column_mapping?.user_id || "",
            date: resume.batch.column_mapping?.date || "",
            check_in: resume.batch.column_mapping?.check_in || "",
            check_out: resume.batch.column_mapping?.check_out || "",
            hours: resume.batch.column_mapping?.hours || "",
            overtime_hours: resume.batch.column_mapping?.overtime_hours || "",
            remarks: resume.batch.column_mapping?.remarks || "",
            shift_code: resume.batch.column_mapping?.shift_code || "",
            break_minutes: resume.batch.column_mapping?.break_minutes || "",
          });
        }
      } catch (e: any) {
        setErr(e?.message || "Failed to load batch");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, month, year]);

  /** ===== Upload flow ===== */
  async function handleUpload(file: File, source: SourceType = "excel") {
    setLoading(true);
    setErr(null);
    try {
      // 1) create a new batch + upload file to storage (server returns file_url)
      const created = await callEdge<ImportBatch>("attendance-upload-file", {
        organization_id: orgId,
        month,
        year,
        source,
        filename: file.name,
      });

      // 2) send the binary (signed URL or multipart): let the edge handle it
      // If your edge returns an upload_url, we can PUT directly; else, send FormData
      const formData = new FormData();
      formData.append("file", file);
      formData.append("batch_id", created.id);
      await callEdge("attendance-upload-file-chunk", formData as any);

      // 3) detect format/headers/sample
      const det = await callEdge<DetectResponse>("attendance-detect-format", {
        batch_id: created.id,
      });

      setBatch(created);
      setDetect(det);
      setStage(null);
      // prefill best-guess mapping by header names
      const auto = autoMap(det.headers);
      setMapping((m) => ({ ...m, ...auto }));
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  // Very lightweight header auto-map (case/space insensitive)
  function autoMap(headers: string[]): Partial<ColumnMapping> {
    const H = headers.map((h) => h.trim());
    const find = (...alts: string[]) =>
      H.find(
        (h) =>
          alts.some((a) => h.toLowerCase() === a) ||
          alts.some((a) => h.toLowerCase().includes(a))
      ) || "";
    return {
      employee_code: find("emp code", "employee code", "empid", "employee id", "emp", "code"),
      user_id: find("user id", "userid"),
      date: find("date", "attendance date", "work date"),
      check_in: find("in", "check in", "punch in", "time in", "clock in", "login"),
      check_out: find("out", "check out", "punch out", "time out", "clock out", "logout"),
      hours: find("hours", "total hours", "worked hours", "duration"),
      overtime_hours: find("ot", "overtime", "ot hours"),
      remarks: find("remark", "remarks", "notes"),
      shift_code: find("shift", "shift code"),
      break_minutes: find("break", "break minutes"),
    };
  }

  /** Save mapping & stage rows into attendance_import_rows */
  async function saveMappingAndStage() {
    if (!batch) return;
    if (!hasMapping) {
      alert("Minimum mapping required: Date + (Employee Code or User ID) + (Check-in or Hours).");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      // Persist mapping on batch
      const updated = await callEdge<ImportBatch>("attendance-save-mapping", {
        batch_id: batch.id,
        column_mapping: mapping,
      });

      // Parse & stage rows (server normalizes into attendance_import_rows)
      const staged = await callEdge<StageSummary>("attendance-parse-and-stage", {
        batch_id: batch.id,
      });

      setBatch(updated);
      setStage(staged);
    } catch (e: any) {
      setErr(e?.message || "Failed to stage rows");
    } finally {
      setLoading(false);
    }
  }

  async function discardBatch() {
    if (!batch) return;
    if (!confirm("Discard this batch? This will remove file and staged rows.")) return;
    setLoading(true);
    setErr(null);
    try {
      await callEdge("attendance-discard-batch", { batch_id: batch.id });
      setBatch(null);
      setDetect(null);
      setStage(null);
      // keep mapping defaults
    } catch (e: any) {
      setErr(e?.message || "Failed to discard");
    } finally {
      setLoading(false);
    }
  }

  // Render helpers
  const mappingOptions = (detect?.headers || []).map((h) => ({ label: h, value: h }));

  function MappingSelect({
    label,
    value,
    onChange,
    required,
    placeholder = "— Select —",
  }: {
    label: string;
    value?: string;
    onChange: (v: string) => void;
    required?: boolean;
    placeholder?: string;
  }) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label} {required && <span className="text-red-600">*</span>}
        </label>
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{placeholder}</option>
          {mappingOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const pct = (n: number) => `${Math.round(n)}%`;
  const fmt = (n?: number) => (typeof n === "number" ? n.toLocaleString("en-IN") : "0");

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-lg border shadow-sm p-6">
        <PageHeader
          title="Upload & Map Attendance"
          subtitle="Upload the raw file, map columns, and stage rows for validation"
        />

        <AsyncSection loading={loading} error={err}>
          {/* 1) Upload zone (hidden after batch created) */}
          {!batch && (
            <section className="rounded-lg border p-6 bg-gray-50">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Upload file</h3>
              <p className="text-sm text-gray-600 mb-4">
                Supported: .csv, .xlsx, biometric exports. The detector reads headers & sample rows.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UploadTile label="Excel / CSV" onFile={(f) => handleUpload(f, "excel")} accept=".csv,.xlsx,.xls" />
                <UploadTile label="Biometric Export" onFile={(f) => handleUpload(f, "biometric")} accept="*/*" />
              </div>
            </section>
          )}

          {/* 2) Batch ribbon */}
          {batch && (
            <div className="flex items-center justify-between rounded-lg border p-4 bg-gray-50">
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-800">Batch: {batch.id}</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">{batch.source}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    batch.status === "applied"
                      ? "bg-green-100 text-green-800"
                      : batch.status === "validated"
                      ? "bg-blue-100 text-blue-800"
                      : batch.status === "mapped"
                      ? "bg-purple-100 text-purple-800"
                      : batch.status === "rejected"
                      ? "bg-red-100 text-red-800"
                      : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {batch.status}
                </span>
                {batch.file_url && (
                  <a href={batch.file_url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">
                    Download source
                  </a>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={discardBatch} className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50">
                  Discard batch
                </button>
              </div>
            </div>
          )}

          {/* 3) Detection preview */}
          {detect && (
            <section className="rounded-lg border p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Detected Columns</h3>
              {detect.headers.length === 0 ? (
                <EmptyState title="No headers found" description="Please re-upload with a header row." />
              ) : (
                <>
                  <div className="text-sm text-gray-700 mb-2">Headers:</div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {detect.headers.map((h) => (
                      <span key={h} className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-800">
                        {h}
                      </span>
                    ))}
                  </div>
                  <div className="text-sm text-gray-700 mb-2">Sample rows:</div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {detect.headers.map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-gray-600">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {detect.sample.slice(0, 5).map((row, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            {row.map((cell, j) => (
                              <td key={j} className="px-3 py-2 text-gray-800">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {/* 4) Column mapping */}
          {detect && (
            <section className="rounded-lg border p-6 bg-white">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Map Columns</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MappingSelect
                  label="Employee Code"
                  value={mapping.employee_code}
                  onChange={(v) => setMapping((m) => ({ ...m, employee_code: v }))}
                />
                <MappingSelect
                  label="User ID (if present)"
                  value={mapping.user_id}
                  onChange={(v) => setMapping((m) => ({ ...m, user_id: v }))}
                />
                <MappingSelect
                  label="Date"
                  value={mapping.date}
                  onChange={(v) => setMapping((m) => ({ ...m, date: v }))}
                  required
                />
                <MappingSelect
                  label="Check-in time"
                  value={mapping.check_in}
                  onChange={(v) => setMapping((m) => ({ ...m, check_in: v }))}
                />
                <MappingSelect
                  label="Check-out time"
                  value={mapping.check_out}
                  onChange={(v) => setMapping((m) => ({ ...m, check_out: v }))}
                />
                <MappingSelect
                  label="Total hours"
                  value={mapping.hours}
                  onChange={(v) => setMapping((m) => ({ ...m, hours: v }))}
                />
                <MappingSelect
                  label="Overtime hours"
                  value={mapping.overtime_hours}
                  onChange={(v) => setMapping((m) => ({ ...m, overtime_hours: v }))}
                />
                <MappingSelect
                  label="Shift code"
                  value={mapping.shift_code}
                  onChange={(v) => setMapping((m) => ({ ...m, shift_code: v }))}
                />
                <MappingSelect
                  label="Break minutes"
                  value={mapping.break_minutes}
                  onChange={(v) => setMapping((m) => ({ ...m, break_minutes: v }))}
                />
                <MappingSelect
                  label="Remarks"
                  value={mapping.remarks}
                  onChange={(v) => setMapping((m) => ({ ...m, remarks: v }))}
                />
              </div>

              <div className="mt-4 text-sm text-gray-600">
                Minimum needed: <strong>Date</strong> + <strong>Employee Code</strong> (or <strong>User ID</strong>) + either{" "}
                <strong>Check-in</strong> or <strong>Total hours</strong>. Your server normalizer will compute present/absent,
                working days, and OT based on this.
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button onClick={saveMappingAndStage} className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700">
                  Save Mapping & Stage Rows
                </button>
              </div>
            </section>
          )}

          {/* 5) Staging summary */}
          {stage && (
            <section className="rounded-lg border p-6 bg-gray-50">
              <h3 className="text-base font-semibold text-gray-900 mb-3">Staging Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <Stat label="Total rows" value={fmt(stage.total_rows)} />
                <Stat label="Matched users" value={fmt(stage.matched_users)} />
                <Stat label="Match confidence" value={pct(stage.avg_match_confidence)} />
                <Stat label="Duplicates" value={fmt(stage.duplicates)} />
                <Stat label="Errors" value={fmt(stage.errors)} />
              </div>
              <div className="mt-3 text-sm text-gray-700">
                Eligible to apply: <strong>{fmt(stage.will_apply_rows)}</strong>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/payroll/import/review" className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50">
                  Review & Validate
                </Link>
                <Link to="/payroll/import/overrides" className="px-3 py-2 rounded-md border bg-white hover:bg-gray-50">
                  Apply Overrides
                </Link>
              </div>
            </section>
          )}

          {/* 6) Nothing staged yet */}
          {batch && !detect && !stage && (
            <EmptyState
              title="Waiting for detection"
              description="If this persists, re-upload or discard the batch and try again."
            />
          )}
        </AsyncSection>
      </div>
    </div>
  );
}

/** ===== Small UI bits ===== */
function UploadTile({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept: string;
  onFile: (f: File) => void;
}) {
  return (
    <label className="flex items-center justify-center h-40 rounded-lg border-2 border-dashed border-gray-300 bg-white hover:bg-gray-50 cursor-pointer">
      <div className="text-center">
        <div className="text-3xl">📁</div>
        <div className="mt-2 text-sm text-gray-900">{label}</div>
        <div className="text-xs text-gray-600">Click to choose a file</div>
      </div>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}
