import React, { useMemo, useRef, useState, useEffect } from "react";
import { AlertTriangle, Bot, CheckCircle, Loader2, Send, User, Wallet } from "lucide-react";

interface CompensationComponent {
  component_code: string;
  amount: number;
}

interface CompensationData {
  ctc_annual: number;
  pay_schedule: "monthly" | "weekly" | "biweekly";
  currency: string;
  components: CompensationComponent[];
  notes: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  compensation?: CompensationData | null;
  timestamp: Date;
}

interface Props {
  currentCompensation?: CompensationData | null;
  availableComponents: Array<{ code: string; name: string; type: "earning" | "deduction" | "employer_cost" }>;
  onCompensationUpdate: (finalComp: CompensationData) => void;
  onConversationComplete: () => void;
}

type DraftVersion = {
  id: number;
  createdAt: Date;
  sourceText: string;
  draft: CompensationData;
  unmapped: Array<{ raw_code: string; amount: number }>;
};

const toMonthly = (annual: number) => Math.round(annual / 12);

function computeAnnualCtcFromComponents(components: CompensationComponent[] = []) {
  return Math.round(
    components.reduce((sum, line) => {
      const amt = Number(line?.amount) || 0;
      return amt > 0 ? sum + amt : sum;
    }, 0),
  );
}

function normalizeCompensationDraft(comp: CompensationData): CompensationData {
  const ctcFromComponents = computeAnnualCtcFromComponents(comp.components || []);
  const ctcAnnual = Number(comp.ctc_annual) > 0 ? Math.round(Number(comp.ctc_annual)) : ctcFromComponents;
  return { ...comp, ctc_annual: ctcAnnual };
}

const Summary: React.FC<{ comp: CompensationData | null }> = ({ comp }) => {
  if (!comp) return null;
  const earningsA = comp.components.filter((c) => c.amount > 0).reduce((s, c) => s + c.amount, 0);
  const deductionsA = Math.abs(comp.components.filter((c) => c.amount < 0).reduce((s, c) => s + c.amount, 0));
  const netA = earningsA - deductionsA;
  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b flex items-center gap-2">
        <Wallet className="w-4 h-4 text-emerald-600" />
        <div className="font-medium">Draft Summary</div>
      </div>
      <div className="px-4 py-3 text-sm text-gray-800">
        <div className="font-semibold">
          Net in-hand: INR {toMonthly(netA).toLocaleString("en-IN")} / month
        </div>
        <div className="text-xs text-gray-600 mt-1">
          Annual Net: INR {netA.toLocaleString("en-IN")} | CTC: INR {comp.ctc_annual.toLocaleString("en-IN")}
        </div>
      </div>
    </div>
  );
};

function buildDelta(prev: CompensationData | null, next: CompensationData | null) {
  if (!prev || !next) return "Initial draft generated.";
  const out: string[] = [];

  if (prev.ctc_annual !== next.ctc_annual) out.push(`CTC changed ${prev.ctc_annual} -> ${next.ctc_annual}`);
  const prevMap = new Map(prev.components.map((c) => [c.component_code, c.amount]));
  const nextMap = new Map(next.components.map((c) => [c.component_code, c.amount]));

  for (const [code, amt] of nextMap.entries()) {
    if (!prevMap.has(code)) out.push(`Added ${code}: ${amt}`);
    else if (prevMap.get(code) !== amt) out.push(`Updated ${code}: ${prevMap.get(code)} -> ${amt}`);
  }
  for (const [code] of prevMap.entries()) {
    if (!nextMap.has(code)) out.push(`Removed ${code}`);
  }
  return out.length ? out.join(" | ") : "No structural change.";
}

export default function CompensationChat({
  currentCompensation = null,
  availableComponents,
  onCompensationUpdate,
  onConversationComplete,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Describe compensation requirement. Example: Set in-hand to INR 45000 and keep PF, PT, TDS.",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<CompensationData | null>(null);
  const [versions, setVersions] = useState<DraftVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [deltaText, setDeltaText] = useState<string>("Initial draft generated.");
  const [unmappedComponents, setUnmappedComponents] = useState<Array<{ raw_code: string; amount: number }>>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) || versions[versions.length - 1] || null,
    [versions, selectedVersionId],
  );

  useEffect(() => {
    if (!currentCompensation) return;
    setDraft(currentCompensation);
  }, [currentCompensation]);

  async function callChat(text: string, currentDraft: CompensationData | null) {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-compensation-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        user_input: text,
        current_compensation: currentDraft,
        conversation_history: messages.slice(-10),
      }),
    });
    return resp.json();
  }

  async function callMapper(draftComp: CompensationData) {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-component-mapper`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        draft_compensation: draftComp,
        available_components: availableComponents,
      }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result?.error || `Mapper HTTP ${resp.status}`);
    if (!result?.compensation) throw new Error("Mapper returned no compensation.");
    return result;
  }

  const send = async () => {
    const text = inputValue.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text, timestamp: new Date() }]);
    setLoading(true);

    try {
      const ai = await callChat(text, draft);
      const aiDraftRaw = (ai?.compensation || null) as CompensationData | null;
      const aiDraft = aiDraftRaw ? normalizeCompensationDraft(aiDraftRaw) : null;
      let mappedUnmapped: Array<{ raw_code: string; amount: number }> = [];
      let effectiveDraft = aiDraft;

      if (aiDraft) {
        const mapped = await callMapper(aiDraft);
        mappedUnmapped = mapped?.unmapped || [];
        effectiveDraft = normalizeCompensationDraft((mapped?.compensation || aiDraft) as CompensationData);

        const version: DraftVersion = {
          id: Date.now(),
          createdAt: new Date(),
          sourceText: text,
          draft: effectiveDraft,
          unmapped: mappedUnmapped,
        };

        setVersions((prev) => [...prev, version]);
        setSelectedVersionId(version.id);
        setDeltaText(buildDelta(draft, effectiveDraft));
        setDraft(effectiveDraft);
        setUnmappedComponents(mappedUnmapped);
        onCompensationUpdate(effectiveDraft);
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: ai?.explanation || "Draft updated.",
          compensation: effectiveDraft,
          timestamp: new Date(),
        },
      ]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Error: ${e.message}`, timestamp: new Date() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const applySelectedDraft = () => {
    if (!selectedVersion) return;
    setDraft(selectedVersion.draft);
    setUnmappedComponents(selectedVersion.unmapped);
  };

  const finalize = async () => {
    const target = selectedVersion?.draft || draft;
    if (!target) return;
    setLoading(true);
    try {
      const mapped = await callMapper(target);
      const finalComp: CompensationData = normalizeCompensationDraft(mapped.compensation);
      const unmapped = mapped.unmapped || [];
      setUnmappedComponents(unmapped);
      onCompensationUpdate(finalComp);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            unmapped.length === 0
              ? "Finalized and fully mapped."
              : `Finalized with ${unmapped.length} unmapped component(s).`,
          compensation: finalComp,
          timestamp: new Date(),
        },
      ]);
      if (unmapped.length === 0) onConversationComplete();
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Finalize failed: ${e.message}`, timestamp: new Date() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="border rounded-lg bg-white shadow-sm">
        <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-600" />
            <h3 className="font-medium">AI Compensation Assistant</h3>
          </div>
          <button
            onClick={finalize}
            disabled={loading || !(selectedVersion?.draft || draft)}
            className="px-2 py-1.5 text-sm rounded-md bg-emerald-600 text-white disabled:opacity-50 flex items-center gap-1"
          >
            <CheckCircle className="w-4 h-4" />
            Finalize
          </button>
        </div>

        <div className="h-80 overflow-y-auto p-4 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-blue-600" />
                </div>
              )}
              <div
                className={`max-w-xs lg:max-w-md px-3 py-2 rounded-lg ${
                  m.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                <div className="text-xs opacity-75 mt-1">
                  {m.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              {m.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-gray-600" />
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-blue-600" />
              </div>
              <div className="bg-gray-100 px-3 py-2 rounded-lg">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm text-gray-600">Thinking...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {unmappedComponents.length > 0 && (
          <div className="px-4 py-2 border-t border-b bg-red-50">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-red-700">
                Unmapped codes: {unmappedComponents.map((c) => `${c.raw_code} (${c.amount})`).join(", ")}
              </div>
            </div>
          </div>
        )}

        <div className="p-3 border-t">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type your requirement..."
              className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              disabled={loading}
            />
            <button
              onClick={send}
              disabled={!inputValue.trim() || loading}
              className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border bg-white p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900">Draft Versions</h4>
            <button
              onClick={applySelectedDraft}
              disabled={!selectedVersion}
              className="text-xs rounded border px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
            >
              Apply selected
            </button>
          </div>
          <div className="mt-2 space-y-2 max-h-44 overflow-auto">
            {versions.map((v, idx) => (
              <button
                key={v.id}
                onClick={() => setSelectedVersionId(v.id)}
                className={`w-full rounded border px-2 py-2 text-left text-xs ${
                  selectedVersionId === v.id ? "border-blue-500 bg-blue-50" : "hover:bg-gray-50"
                }`}
              >
                <div className="font-medium">v{idx + 1}</div>
                <div className="text-gray-500">{v.createdAt.toLocaleTimeString()}</div>
                <div className="text-gray-700 truncate">{v.sourceText}</div>
              </button>
            ))}
            {!versions.length && <div className="text-xs text-gray-500">No versions yet.</div>}
          </div>
        </div>

        <div className="rounded-lg border bg-white p-3">
          <h4 className="text-sm font-semibold text-gray-900">Delta</h4>
          <p className="mt-1 text-xs text-gray-700">{deltaText}</p>
        </div>

        <Summary comp={selectedVersion?.draft || draft} />
      </div>
    </div>
  );
}
