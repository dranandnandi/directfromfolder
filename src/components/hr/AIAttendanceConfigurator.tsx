import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOrganization } from "../../contexts/OrganizationContext";
import { aiNative, supabase, type ResolvedEntity } from "../../utils/supabaseClient";
import EntityResolutionPanel from "./ai/EntityResolutionPanel";
import {
  HiMicrophone,
  HiStop,
  HiLightningBolt,
  HiCheck,
  HiRefresh,
  HiClock,
  HiShieldCheck,
  HiUserGroup,
  HiTrash,
  HiInformationCircle,
  HiChevronDown,
  HiChevronUp,
} from "react-icons/hi";

/* --- Types --- */
type PolicyResponse = {
  policy_name?: string;
  confidence_score?: number;
  instruction_json?: any;
  impact?: any;
};

type VoiceState = "idle" | "listening" | "processing";

const EXAMPLE_COMMANDS = [
  "Morning shift 9 AM to 6 PM, 15 min late grace, Sunday off",
  "Night shift 10 PM to 7 AM, Saturday and Sunday off, 10 min buffer",
  "Sales team works Monday to Saturday 10:00 to 19:00, 30 min break",
  "Factory shift 8 AM to 5 PM, Friday is weekly off, mark absent if no punch",
  "Create two shifts: Day 9-6 with Sunday off, Evening 2-10 with Monday off",
  "Allow late threshold 20 min for operation team, 10 min for editors",
];

function makeEntityKey(e: ResolvedEntity) {
  return `${e.type}:${e.id || e.name}`;
}

/* --- Mic Pulse Animation --- */
function MicPulse({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="absolute inset-0 rounded-full">
      <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-40" />
      <span className="absolute inset-0 animate-pulse rounded-full bg-red-400 opacity-20" />
    </span>
  );
}

/* --- Confidence Badge --- */
function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? "bg-green-100 text-green-800" : pct >= 60 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      <HiShieldCheck className="h-3.5 w-3.5" />
      {pct}% confidence
    </span>
  );
}

/* --- Step Indicator --- */
function StepIndicator({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-2 rounded-full transition-all ${
              i < step ? "w-8 bg-white/80" : i === step ? "w-8 bg-white animate-pulse" : "w-4 bg-white/30"
            }`}
          />
        ))}
      </div>
      <span className="text-sm font-medium text-blue-100">{label}</span>
    </div>
  );
}

/* ======================================= */
export default function AIAttendanceConfigurator() {
  const { organizationId } = useOrganization();

  /* Voice & Text */
  const [instructionText, setInstructionText] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const recognitionRef = useRef<any>(null);
  const [interimTranscript, setInterimTranscript] = useState("");

  /* Workflow */
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  /* Entities & Preview */
  const [resolved, setResolved] = useState<ResolvedEntity[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PolicyResponse | null>(null);
  const [lastHydration, setLastHydration] = useState<any>(null);
  const [policies, setPolicies] = useState<any[]>([]);
  const [showPolicies, setShowPolicies] = useState(false);
  const [createdShifts, setCreatedShifts] = useState<any[]>([]);

  const selectedEntities = useMemo(
    () => resolved.filter((r) => selected.has(makeEntityKey(r))),
    [resolved, selected],
  );

  /* --- Load policies --- */
  const loadPolicies = useCallback(async () => {
    if (!organizationId) return;
    const { data } = await supabase
      .from("attendance_ai_policies")
      .select("id,policy_name,policy_version,status,model_name,confidence_score,instruction_text,updated_at")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(20);
    setPolicies(data || []);
  }, [organizationId]);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);

  /* --- Voice Recognition --- */
  const startVoice = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("Voice input not supported in this browser. Use Chrome or Edge.");
      return;
    }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onresult = (event: any) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t + " ";
        else interim = t;
      }
      if (final) setInstructionText((prev) => (prev + " " + final).trim());
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error !== "no-speech") setError(`Voice error: ${event.error}`);
      setVoiceState("idle");
    };

    recognition.onend = () => { setVoiceState("idle"); setInterimTranscript(""); };

    recognitionRef.current = recognition;
    recognition.start();
    setVoiceState("listening");
    setError(null);
  }, []);

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop();
    setVoiceState("idle");
    setInterimTranscript("");
  }, []);

  /* --- Step 1: Resolve entities --- */
  const onResolve = async () => {
    if (!organizationId || !instructionText.trim()) return;
    setError(null); setLoading(true);
    try {
      const entities = await aiNative.resolveEntitiesByText(organizationId, instructionText);
      setResolved(entities);
      setSelected(new Set(entities.map(makeEntityKey)));
      setStep(1);
    } catch (e: any) { setError(e?.message || "Failed to resolve entities"); }
    finally { setLoading(false); }
  };

  /* --- Step 2: Preview policy --- */
  const onPreviewPolicy = async () => {
    if (!organizationId || !instructionText.trim()) return;
    setError(null); setLoading(true);
    try {
      const { data, error: fnErr }: any = await aiNative.invokeShiftConfigurator({
        organization_id: organizationId,
        instruction_text: instructionText,
        selected_entities: selectedEntities,
        dry_run: true,
        model_preference: "haiku",
      });
      if (fnErr) throw fnErr;
      const parsed = data?.data || data;
      setPreview(parsed);
      setStep(2);

      const templates = parsed?.instruction_json?.shift_templates;
      if (templates?.length) await autoCreateShiftsFromPolicy(templates, parsed?.instruction_json?.workweek);
    } catch (e: any) { setError(e?.message || "Failed to preview policy"); }
    finally { setLoading(false); }
  };

  /* --- Auto-create shifts from AI parsed templates --- */
  const autoCreateShiftsFromPolicy = async (templates: any[], workweek?: string[]) => {
    if (!organizationId) return;
    const allDays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const dayMap: Record<string, string> = {
      sun: "sunday", mon: "monday", tue: "tuesday", wed: "wednesday",
      thu: "thursday", fri: "friday", sat: "saturday",
    };
    const workDays = (workweek || ["mon", "tue", "wed", "thu", "fri"]).map(
      (d) => dayMap[d.toLowerCase()] || d.toLowerCase()
    );
    const offDays = allDays.filter((d) => !workDays.includes(d));

    const created: any[] = [];
    for (const t of templates) {
      try {
        const shiftData = {
          organization_id: organizationId,
          name: t.name || t.shift_name || "AI Shift",
          start_time: t.start_time || "09:00",
          end_time: t.end_time || "18:00",
          duration_hours: t.duration_hours || 9,
          break_duration_minutes: t.break_duration_minutes || 60,
          late_threshold_minutes: t.late_threshold_minutes || 15,
          early_out_threshold_minutes: t.early_out_threshold_minutes || 15,
          is_active: true,
          is_overnight: (t.end_time || "18:00") < (t.start_time || "09:00"),
          weekly_off_days: t.weekly_off_days || offDays,
        };

        const { data: existing } = await supabase
          .from("shifts").select("id,name")
          .eq("organization_id", organizationId).eq("name", shiftData.name).eq("is_active", true).maybeSingle();

        if (existing) {
          const { data: updated } = await supabase.from("shifts")
            .update({ ...shiftData, updated_at: new Date().toISOString() })
            .eq("id", existing.id).select().single();
          created.push({ ...updated, _action: "updated" });
        } else {
          const { data: ins } = await supabase.from("shifts").insert(shiftData).select().single();
          created.push({ ...ins, _action: "created" });
        }
      } catch (e) { console.error("Failed to create shift from template:", t, e); }
    }
    setCreatedShifts(created);
  };

  /* --- Step 3: Save & Activate --- */
  const onSavePolicy = async () => {
    if (!organizationId || !instructionText.trim()) return;
    setError(null); setSaving(true);
    try {
      const { data, error: fnErr }: any = await aiNative.invokeShiftConfigurator({
        organization_id: organizationId,
        instruction_text: instructionText,
        selected_entities: selectedEntities,
        policy_name: preview?.policy_name || "Voice Policy",
        dry_run: false,
        model_preference: "haiku",
      });
      if (fnErr) throw fnErr;

      const createdPolicy = data?.data?.policy || data?.policy;
      if (createdPolicy?.id) {
        await supabase.from("attendance_ai_policies").update({ status: "retired" })
          .eq("organization_id", organizationId).eq("status", "active").neq("id", createdPolicy.id);
        await supabase.from("attendance_ai_policies").update({ status: "active" }).eq("id", createdPolicy.id);
      }
      setStep(3);
      setSuccessMsg("Policy activated! Run hydration to apply rules to attendance records.");
      await loadPolicies();
    } catch (e: any) { setError(e?.message || "Failed to save policy"); }
    finally { setSaving(false); }
  };

  /* --- Hydrate --- */
  const onRunHydration = async () => {
    if (!organizationId) return;
    setError(null); setHydrating(true);
    try {
      const { data, error: fnErr }: any = await aiNative.invokeWeeklyHydrator({
        organization_id: organizationId, mode: "apply",
      });
      if (fnErr) throw fnErr;
      setLastHydration(data?.data || data);
      setSuccessMsg("Hydration complete! Attendance flags updated.");
    } catch (e: any) { setError(e?.message || "Failed to run hydration"); }
    finally { setHydrating(false); }
  };

  /* --- Reset --- */
  const reset = () => {
    setInstructionText(""); setResolved([]); setSelected(new Set());
    setPreview(null); setStep(0); setError(null); setSuccessMsg(null);
    setCreatedShifts([]); setLastHydration(null);
  };

  const stepLabels = ["Speak or Type", "Verify Scope", "Review & Approve", "Done"];

  /* ======== RENDER ======== */
  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-8">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-blue-600 to-indigo-700 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <HiLightningBolt className="h-6 w-6 text-amber-300" />
              AI Shift & Attendance Configurator
            </h2>
            <p className="mt-1 text-sm text-blue-100 max-w-xl">
              Speak or type your shift rules in plain language. AI will parse context, create shifts with weekly offs,
              set thresholds, and configure attendance policies automatically.
            </p>
          </div>
          {step > 0 && (
            <button onClick={reset} className="rounded-lg bg-white/20 px-3 py-1.5 text-sm hover:bg-white/30 transition">
              <HiRefresh className="inline h-4 w-4 mr-1" />Start Over
            </button>
          )}
        </div>
        <div className="mt-4">
          <StepIndicator step={step} total={4} label={stepLabels[Math.min(step, 3)]} />
        </div>
      </div>

      {/* Layer 1: Voice/Text Input */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="bg-gray-50 border-b px-5 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">1</div>
            Voice or Text Instruction
          </h3>
          <span className="text-xs text-gray-400">Layer 1: Shift Rules</span>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex gap-4">
            {/* Mic Button */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={voiceState === "listening" ? stopVoice : startVoice}
                className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg ${
                  voiceState === "listening"
                    ? "bg-red-500 hover:bg-red-600 text-white scale-110"
                    : "bg-white border-2 border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600"
                }`}
              >
                <MicPulse active={voiceState === "listening"} />
                {voiceState === "listening" ? (
                  <HiStop className="h-7 w-7 relative z-10" />
                ) : (
                  <HiMicrophone className="h-7 w-7 relative z-10" />
                )}
              </button>
              <span className={`text-xs font-medium ${voiceState === "listening" ? "text-red-600" : "text-gray-400"}`}>
                {voiceState === "listening" ? "Listening..." : "Tap to speak"}
              </span>
            </div>

            {/* Text Area */}
            <div className="flex-1">
              <textarea
                value={instructionText}
                onChange={(e) => setInstructionText(e.target.value)}
                placeholder={"Speak or type your shift rules here...\n\nExample: Morning shift 9 AM to 6 PM, Sunday off, 15 min late grace."}
                className="h-32 w-full rounded-lg border border-gray-200 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
              />
              {interimTranscript && (
                <div className="mt-1 text-sm text-gray-400 italic animate-pulse">{interimTranscript}...</div>
              )}
            </div>
          </div>

          {/* Quick Examples */}
          <div>
            <p className="text-xs text-gray-500 mb-2 font-medium">Quick examples - click to use:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_COMMANDS.map((ex, i) => (
                <button key={i} onClick={() => setInstructionText(ex)}
                  className="text-xs bg-gray-50 border rounded-full px-3 py-1.5 text-gray-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition">
                  {ex.length > 60 ? ex.slice(0, 57) + "..." : ex}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3 pt-2 border-t">
            <button onClick={onResolve} disabled={loading || !instructionText.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 transition">
              <HiUserGroup className="h-4 w-4" /> Resolve Scope
            </button>
            <button onClick={onPreviewPolicy} disabled={loading || !instructionText.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 shadow-sm transition">
              <HiLightningBolt className="h-4 w-4" />
              {loading ? "Analyzing..." : "AI Parse & Preview"}
            </button>
          </div>
        </div>
      </div>

      {/* Error / Success */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <HiInformationCircle className="h-5 w-5 shrink-0 mt-0.5 text-red-400" />{error}
        </div>
      )}
      {successMsg && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 flex items-start gap-2">
          <HiCheck className="h-5 w-5 shrink-0 mt-0.5 text-green-500" />{successMsg}
        </div>
      )}

      {/* Entity Resolution */}
      {resolved.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b px-5 py-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">2</div>
              Verify Scope - {selectedEntities.length} of {resolved.length} selected
            </h3>
          </div>
          <div className="p-5">
            <EntityResolutionPanel entities={resolved} selectedKeys={selected}
              onToggle={(entity) => {
                const key = makeEntityKey(entity);
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key); else next.add(key);
                  return next;
                });
              }}
            />
          </div>
        </div>
      )}

      {/* Shifts Auto-Created */}
      {createdShifts.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="bg-green-50 border-b border-green-100 px-5 py-3">
            <h3 className="font-semibold text-green-800 flex items-center gap-2">
              <HiCheck className="h-5 w-5" /> Shifts Auto-Created from AI
            </h3>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {createdShifts.map((s, i) => (
                <div key={i} className="rounded-lg border border-green-200 bg-green-50/50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-gray-900">{s.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s._action === "created" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                    }`}>{s._action === "created" ? "New" : "Updated"}</span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex items-center gap-2">
                      <HiClock className="h-4 w-4 text-gray-400" />
                      {s.start_time} - {s.end_time} ({s.duration_hours}h)
                    </div>
                    <div>Late: {s.late_threshold_minutes}min | Break: {s.break_duration_minutes}min</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(s.weekly_off_days || []).map((d: string) => (
                        <span key={d} className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full capitalize">{d}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Layer 2: Policy Preview */}
      {preview && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b px-5 py-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">3</div>
              AI Policy Review
              <span className="text-xs text-gray-400 ml-2">Layer 2: Attendance Rules</span>
            </h3>
            {preview.confidence_score != null && <ConfidenceBadge score={preview.confidence_score} />}
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Policy Name", value: preview.policy_name || "Voice Policy" },
                { label: "Shifts Detected", value: String(preview.instruction_json?.shift_templates?.length || 0) },
                { label: "Workweek", value: (preview.instruction_json?.workweek || []).join(", ") || "Mon-Fri" },
                { label: "Exceptions", value: `${preview.instruction_json?.exceptions?.length || 0} rules` },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border p-3">
                  <p className="text-xs text-gray-500">{c.label}</p>
                  <p className="font-semibold text-gray-900 text-sm capitalize">{c.value}</p>
                </div>
              ))}
            </div>

            {preview.instruction_json?.hydration_rules && (
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-4">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">Attendance AI Rules (Layer 2)</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  {Object.entries(preview.instruction_json.hydration_rules).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-2">
                      {v ? <HiCheck className="h-4 w-4 text-green-600" /> : <HiTrash className="h-4 w-4 text-red-400" />}
                      <span className="capitalize">{k.replace(/_/g, " ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <details className="group">
              <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <HiChevronDown className="h-4 w-4 group-open:hidden" />
                <HiChevronUp className="h-4 w-4 hidden group-open:block" />
                View raw policy JSON
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
                {JSON.stringify(preview.instruction_json, null, 2)}
              </pre>
            </details>

            <div className="flex flex-wrap gap-3 pt-3 border-t">
              <button onClick={onSavePolicy} disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40 shadow-sm transition">
                <HiCheck className="h-4 w-4" /> {saving ? "Saving..." : "Approve & Activate Policy"}
              </button>
              <button onClick={onRunHydration} disabled={hydrating}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40 shadow-sm transition">
                <HiRefresh className={`h-4 w-4 ${hydrating ? "animate-spin" : ""}`} />
                {hydrating ? "Running..." : "Run Attendance Hydration"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hydration Result */}
      {lastHydration && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="bg-violet-50 border-b border-violet-100 px-5 py-3">
            <h3 className="font-semibold text-violet-800">Hydration Result</h3>
          </div>
          <div className="p-5">
            {typeof lastHydration === "object" && lastHydration.updated_count != null ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { label: "Records Updated", value: lastHydration.updated_count, color: "text-violet-700" },
                  { label: "Late Marked", value: lastHydration.late_count ?? "\u2014", color: "text-amber-600" },
                  { label: "Absent Marked", value: lastHydration.absent_count ?? "\u2014", color: "text-red-600" },
                ].map((c) => (
                  <div key={c.label} className="rounded-lg border p-3">
                    <p className="text-xs text-gray-500">{c.label}</p>
                    <p className={`font-bold text-xl ${c.color}`}>{c.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="max-h-40 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
                {JSON.stringify(lastHydration, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Saved Policies */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <button onClick={() => setShowPolicies(!showPolicies)}
          className="w-full bg-gray-50 border-b px-5 py-3 flex items-center justify-between hover:bg-gray-100 transition">
          <h3 className="font-semibold text-gray-900">Saved Policies ({policies.length})</h3>
          {showPolicies ? <HiChevronUp className="h-5 w-5 text-gray-400" /> : <HiChevronDown className="h-5 w-5 text-gray-400" />}
        </button>
        {showPolicies && (
          <div className="p-5">
            {!policies.length ? (
              <p className="text-sm text-gray-400">No policies yet. Create one above.</p>
            ) : (
              <div className="space-y-2">
                {policies.map((p) => (
                  <div key={p.id} className={`rounded-lg border px-4 py-3 flex items-center justify-between ${
                    p.status === "active" ? "border-green-200 bg-green-50/50" : "border-gray-100"
                  }`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{p.policy_name}</span>
                        <span className="text-xs text-gray-400">v{p.policy_version}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          p.status === "active" ? "bg-green-100 text-green-700"
                            : p.status === "draft" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"
                        }`}>{p.status}</span>
                      </div>
                      {p.instruction_text && (
                        <p className="text-xs text-gray-500 mt-1 truncate max-w-lg">{p.instruction_text}</p>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "\u2014"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Architecture Info */}
      <div className="rounded-xl border bg-gradient-to-br from-gray-50 to-blue-50 p-5">
        <h3 className="font-semibold text-gray-800 mb-3">How It Works - 2-Layer Architecture</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-white border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">1</div>
              <h4 className="font-semibold text-gray-900">Shift Definitions</h4>
            </div>
            <ul className="text-sm text-gray-600 space-y-1 ml-8 list-disc">
              <li>Start/End time, duration, break</li>
              <li><strong>Per-shift weekly off days</strong> (Sun, Fri+Sat, etc.)</li>
              <li>Late/early-out thresholds</li>
              <li>Overnight & buffer support</li>
              <li>Employee-shift assignment with effective dates</li>
            </ul>
          </div>
          <div className="rounded-lg bg-white border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">2</div>
              <h4 className="font-semibold text-gray-900">AI Attendance Rules</h4>
            </div>
            <ul className="text-sm text-gray-600 space-y-1 ml-8 list-disc">
              <li>NL instruction to JSON policy via AI</li>
              <li>Late threshold overrides per dept/role</li>
              <li>Auto-mark absent if no punch</li>
              <li>Exception rules (month-end Saturday, etc.)</li>
              <li>Weekly hydration recomputes all flags</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}