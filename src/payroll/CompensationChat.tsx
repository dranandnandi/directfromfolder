import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Bot, User, Loader2, AlertTriangle, Wallet } from 'lucide-react';

interface CompensationComponent {
  component_code: string;
  amount: number; // NOTE: In this UI we will treat incoming amounts as ANNUAL by default and convert to monthly for display
}

interface UnmappedComponent { raw_code: string; amount: number }

interface CompensationData {
  ctc_annual: number;
  pay_schedule: 'monthly' | 'weekly' | 'biweekly';
  currency: string;
  components: CompensationComponent[]; // amounts ANNUAL by convention from edge fn
  notes: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  compensation?: CompensationData;
  timestamp: Date;
}

interface CompensationChatProps {
  currentCompensation?: CompensationData;
  availableComponents: Array<{ code: string; name: string; type: 'earning' | 'deduction' | 'employer_cost' }>;
  onCompensationUpdate: (compensation: CompensationData) => void;
  onConversationComplete: () => void;
}

// Employer-cost items we don't show in breakdown table
const EXCLUDE_IN_UI: Set<string> = new Set(['PF_ER', 'ESI_ER', 'esic_employer', 'pf_employer']);

// ----- helpers -------------------------------------------------------------
const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 1) / 1; // whole rupees
const toMonthly = (annual: number) => roundMoney(annual / 12);

const buildCanonicalMap = (available: Array<{ code: string; name: string; type: string }>) => {
  const map: Record<string, string> = {};
  for (const c of available) {
    map[c.code] = c.code; map[c.code.toUpperCase()] = c.code; map[c.code.toLowerCase()] = c.code;
  }
  // common aliases → prefer codes that exist in available list
  const prefer = (alias: string, target: string) => { if (map[target]) map[alias] = target; };
  prefer('basic', 'BASIC'); prefer('BASIC', 'BASIC');
  prefer('hra', 'HRA'); prefer('HRA', 'HRA');
  prefer('conveyance', 'CONV'); prefer('CONV', 'CONV');
  prefer('SPEC', 'special'); prefer('SPECIAL', 'special'); prefer('special allowance', 'special');
  prefer('PF', 'PF_EE'); prefer('pf', 'PF_EE'); prefer('pf_employee', 'PF_EE');
  prefer('ESI', 'esic_employee'); prefer('esi', 'esic_employee'); prefer('ESIC', 'esic_employee');
  prefer('pt', 'PT'); prefer('professional tax', 'PT');
  prefer('tds', 'TDS'); prefer('income tax', 'TDS');
  prefer('MED', 'medical'); // only works if 'medical' exists in available
  return map;
};

const isDeduction = (code: string) => /^(PF|PF_EE|esic_employee|PT|TDS)$/i.test(code);

function normalizeAndCollapse(
  lines: CompensationComponent[],
  canonical: Record<string, string>
): { processed: CompensationComponent[]; unmapped: UnmappedComponent[] } {
  const acc = new Map<string, number>();
  const unmapped: UnmappedComponent[] = [];

  for (const l of lines || []) {
    const raw = String(l.component_code || '');
    const mapped = canonical[raw] || canonical[raw.toUpperCase()] || canonical[raw.toLowerCase()] || null;
    if (!mapped) { unmapped.push({ raw_code: raw, amount: l.amount }); continue; }
    if (EXCLUDE_IN_UI.has(mapped)) continue;

    let amt = Number(l.amount) || 0;
    // enforce sign convention
    if (isDeduction(mapped) && amt > 0) amt = -amt;
    if (!isDeduction(mapped) && amt < 0) amt = -amt;

    acc.set(mapped, (acc.get(mapped) || 0) + amt);
  }

  const processed: CompensationComponent[] = Array.from(acc.entries()).map(([component_code, amount]) => ({ component_code, amount: roundMoney(amount) }));
  return { processed, unmapped };
}

// Summary table shown OUTSIDE chat window
const SummaryPanel: React.FC<{ comp: CompensationData | null }> = ({ comp }) => {
  if (!comp) return null;
  const earningsA = comp.components.filter(c => c.amount > 0).reduce((s, c) => s + c.amount, 0);
  const dedA = Math.abs(comp.components.filter(c => c.amount < 0).reduce((s, c) => s + c.amount, 0));
  const netA = earningsA - dedA;
  const grossM = toMonthly(earningsA);
  const dedM = toMonthly(dedA);
  const netM = toMonthly(netA);

  return (
    <div className="mt-4 border rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b flex items-center gap-2">
        <Wallet className="w-4 h-4 text-emerald-600" />
        <div className="font-medium">Compensation Summary</div>
      </div>

      {/* Big in-hand line */}
      <div className="px-4 py-3 flex flex-wrap items-baseline gap-3">
        <div className="text-sm text-gray-600">In‑hand (Net Take‑Home):</div>
        <div className="text-xl font-semibold text-gray-900">₹{netM.toLocaleString('en-IN')} <span className="text-sm font-normal text-gray-500">/ month</span></div>
        <div className="text-gray-400">•</div>
        <div className="text-base font-medium text-gray-800">₹{netA.toLocaleString('en-IN')} <span className="text-sm font-normal text-gray-500">/ year</span></div>
      </div>

      {/* Table with both monthly & annual */}
      <div className="px-4 pb-4">
        <div className="grid grid-cols-3 gap-2 text-xs font-medium mb-2">
          <div>Component</div>
          <div className="text-right">Monthly (₹)</div>
          <div className="text-right">Annual (₹)</div>
        </div>

        {/* earnings */}
        <div className="text-xs space-y-1">
          <div className="font-medium text-green-700 mt-1">Earnings</div>
          {comp.components.filter(c => c.amount > 0).map((c) => (
            <div className="grid grid-cols-3 gap-2" key={c.component_code}>
              <div>{c.component_code}</div>
              <div className="text-right">{toMonthly(c.amount).toLocaleString('en-IN')}</div>
              <div className="text-right">{c.amount.toLocaleString('en-IN')}</div>
            </div>
          ))}
        </div>

        {/* deductions */}
        {comp.components.some(c => c.amount < 0) && (
          <div className="text-xs space-y-1 mt-2">
            <div className="font-medium text-red-700">Deductions</div>
            {comp.components.filter(c => c.amount < 0).map((c) => (
              <div className="grid grid-cols-3 gap-2" key={c.component_code}>
                <div>{c.component_code}</div>
                <div className="text-right text-red-600">-{toMonthly(Math.abs(c.amount)).toLocaleString('en-IN')}</div>
                <div className="text-right text-red-600">-{Math.abs(c.amount).toLocaleString('en-IN')}</div>
              </div>
            ))}
          </div>
        )}

        {/* totals */}
        <div className="border-t mt-2 pt-2 text-xs font-medium">
          <div className="grid grid-cols-3 gap-2">
            <div>Gross</div>
            <div className="text-right">{grossM.toLocaleString('en-IN')}</div>
            <div className="text-right">{earningsA.toLocaleString('en-IN')}</div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <div>Total Deductions</div>
            <div className="text-right">{dedM.toLocaleString('en-IN')}</div>
            <div className="text-right">{dedA.toLocaleString('en-IN')}</div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <div>CTC</div>
            <div className="text-right">{toMonthly(comp.ctc_annual).toLocaleString('en-IN')}</div>
            <div className="text-right">{comp.ctc_annual.toLocaleString('en-IN')}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function CompensationChatUI({ currentCompensation, availableComponents, onCompensationUpdate, onConversationComplete }: CompensationChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: `Hi! I'm here to help you structure compensation packages.\n\n• "Create compensation for 12 lacs CTC with regular components"\n• "Adjust the HRA to 15,000"\n• "Add medical allowance of 2,500"\n\nWhat would you like to do?`, timestamp: new Date() }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [unmappedComponents, setUnmappedComponents] = useState<UnmappedComponent[]>([]);
  const [showUnmapped, setShowUnmapped] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Build canonical map once from available components
  const CANONICAL_MAP = useMemo(() => buildCanonicalMap(availableComponents), [availableComponents]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

  // Extract the latest assistant compensation to show in the OUT-OF-CHAT summary panel
  const latestComp: CompensationData | null = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.compensation) {
        // Normalize codes + collapse + keep ANNUAL amounts in state
        const { processed } = normalizeAndCollapse(m.compensation.components, CANONICAL_MAP);
        return { ...m.compensation, components: processed };
      }
    }
    return null;
  }, [messages, CANONICAL_MAP]);

  const callEdgeFunction = async (userInput: string) => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-compensation-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ user_input: userInput, current_compensation: currentCompensation, conversation_history: messages.slice(-6), available_components: availableComponents })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || `HTTP ${response.status}`);
    if (result.error) throw new Error(result.error);
    return result;
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;
    const userMessage: ChatMessage = { role: 'user', content: inputValue.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const ai = await callEdgeFunction(userMessage.content);

      // Normalize + collapse components (keep ANNUAL amounts in message state)
      const { processed, unmapped } = normalizeAndCollapse(ai.compensation.components, CANONICAL_MAP);
      setUnmappedComponents(unmapped);

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: ai.explanation,
        compensation: { ...ai.compensation, components: processed },
        timestamp: new Date()
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Notify parent with the same processed comp (still ANNUAL amounts)
      onCompensationUpdate({ ...ai.compensation, components: processed });

      if (ai.conversation_complete) setTimeout(() => onConversationComplete(), 600);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, I hit an error: ${e.message}`, timestamp: new Date() }]);
    } finally { setIsLoading(false); }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } };

  return (
    <div className="border rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="p-3 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-600" />
          <h3 className="font-medium text-gray-900">AI Compensation Assistant</h3>
        </div>
        <p className="text-xs text-gray-600 mt-1">Describe your compensation needs and I'll help structure the package</p>
      </div>

      {/* Chat window */}
      <div className="h-80 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div key={index} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {message.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-blue-600" />
              </div>
            )}

            <div className={`max-w-xs lg:max-w-md px-3 py-2 rounded-lg ${message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              {/* keep the AI bubble simple; don't render full tables inside bubbles */}
              {message.compensation && (
                <div className="mt-1 text-xs text-gray-600">
                  Proposed structure received. See summary below.
                </div>
              )}
              <div className="text-xs opacity-75 mt-1">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            {message.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-gray-600" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
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

        <div ref={messagesEndRef} />
      </div>

      {/* Unmapped components warning */}
      {unmappedComponents.length > 0 && (
        <div className="px-4 py-2 border-t border-b bg-red-50">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-red-800">Missing Component Codes</div>
              <div className="text-xs text-red-700 mt-1">The following components from AI are NOT available and were skipped:</div>
              <div className="mt-2 space-y-1">
                {unmappedComponents.map((comp, idx) => (
                  <div key={idx} className="text-xs bg-red-100 px-2 py-1 rounded">
                    <code className="font-mono font-bold">{comp.raw_code}</code> → ₹{comp.amount.toLocaleString('en-IN')} <span className="text-red-600 ml-2">(NOT ADDED)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
            placeholder="Describe your compensation requirements..."
            className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            disabled={isLoading}
          />
          <button onClick={handleSendMessage} disabled={!inputValue.trim() || isLoading} className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {['15000 in hand', 'Add HRA 15000', 'Include PF and ESI', 'Done'].map((s) => (
            <button key={s} onClick={() => setInputValue(s)} className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-700" disabled={isLoading}>{s}</button>
          ))}
        </div>
      </div>

      {/* OUTSIDE CHAT: Summary Panel with In-hand + Monthly & Annual */}
      <div className="px-3 pb-3">
        <SummaryPanel comp={latestComp} />
      </div>
    </div>
  );
}
