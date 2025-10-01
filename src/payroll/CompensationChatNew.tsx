import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, AlertTriangle, Wallet, CheckCircle } from 'lucide-react';

interface CompensationComponent { 
  component_code: string; 
  amount: number; 
}

interface CompensationData {
  ctc_annual: number; 
  pay_schedule: 'monthly'|'weekly'|'biweekly'; 
  currency: string; 
  components: CompensationComponent[]; 
  notes: string;
}

interface ChatMessage { 
  role: 'user'|'assistant'; 
  content: string; 
  compensation?: CompensationData; 
  timestamp: Date;
}

interface Props {
  availableComponents: Array<{ code: string; name: string; type: 'earning'|'deduction'|'employer_cost' }>;
  onCompensationUpdate: (finalComp: CompensationData) => void; // parent gets the mapped final payload
  onConversationComplete: () => void;
}

const toMonthly = (annual: number) => Math.round(annual/12);

const Summary: React.FC<{ comp: CompensationData|null }> = ({ comp }) => {
  if (!comp) return null; 
  
  const earnA = comp.components.filter(c=>c.amount>0).reduce((s,c)=>s+c.amount,0); 
  const dedA = Math.abs(comp.components.filter(c=>c.amount<0).reduce((s,c)=>s+c.amount,0)); 
  const netA = earnA - dedA;
  
  return (
    <div className="mt-3 border rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b flex items-center gap-2">
        <Wallet className="w-4 h-4 text-emerald-600"/>
        <div className="font-medium">Compensation Summary</div>
      </div>
      <div className="px-4 py-3 flex flex-wrap items-baseline gap-3">
        <div className="text-sm text-gray-600">In‑hand:</div>
        <div className="text-xl font-semibold">₹{toMonthly(netA).toLocaleString('en-IN')} 
          <span className="text-sm text-gray-500">/ month</span>
        </div>
        <div className="text-gray-400">•</div>
        <div className="text-base">₹{netA.toLocaleString('en-IN')} 
          <span className="text-sm text-gray-500">/ year</span>
        </div>
      </div>
      <div className="px-4 pb-3 text-xs">
        <div className="grid grid-cols-3 gap-2 font-medium mb-1">
          <div>Component</div>
          <div className="text-right">Monthly</div>
          <div className="text-right">Annual</div>
        </div>
        {comp.components.map((c)=> (
          <div className="grid grid-cols-3 gap-2" key={c.component_code}>
            <div>{c.component_code}</div>
            <div className={`text-right ${c.amount<0?'text-red-600':''}`}>
              {c.amount<0?'-':''}₹{toMonthly(Math.abs(c.amount)).toLocaleString('en-IN')}
            </div>
            <div className={`text-right ${c.amount<0?'text-red-600':''}`}>
              {c.amount<0?'-':''}₹{Math.abs(c.amount).toLocaleString('en-IN')}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2 mt-2 border-t pt-2 font-medium">
          <div>CTC</div>
          <div className="text-right">₹{toMonthly(comp.ctc_annual).toLocaleString('en-IN')}</div>
          <div className="text-right">₹{comp.ctc_annual.toLocaleString('en-IN')}</div>
        </div>
      </div>
    </div>
  );
};

export default function CompensationChat({ availableComponents, onCompensationUpdate, onConversationComplete }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { 
      role: 'assistant', 
      content: 'Tell me what you want (e.g., "₹15,000 in-hand" or "Add HRA 15,000")', 
      timestamp: new Date() 
    }
  ]);
  const [inputValue, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<CompensationData|null>(null); // latest raw AI draft
  const [finalized, setFinalized] = useState<CompensationData|null>(null); // mapped final
  const [unmappedComponents, setUnmappedComponents] = useState<Array<{raw_code: string; amount: number}>>([]);
  const endRef = useRef<HTMLDivElement>(null);
  
  useEffect(()=>{ 
    endRef.current?.scrollIntoView({behavior:'smooth'}); 
  }, [messages]);

  async function callChat(text: string) {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-compensation-chat`, { 
      method:'POST', 
      headers:{ 
        'Content-Type':'application/json',
        'Authorization':`Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` 
      }, 
      body: JSON.stringify({ 
        user_input: text, 
        current_compensation: draft, 
        conversation_history: messages.slice(-8) 
      }) 
    });
    return resp.json();
  }

  async function callMapper(draftComp: CompensationData) {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-component-mapper`, { 
      method:'POST', 
      headers:{ 
        'Content-Type':'application/json',
        'Authorization':`Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` 
      }, 
      body: JSON.stringify({ 
        draft_compensation: draftComp, 
        available_components: availableComponents 
      }) 
    });
    return resp.json();
  }

  const send = async () => {
    if (!inputValue.trim() || loading) return;
    const userMsg: ChatMessage = { role:'user', content: inputValue.trim(), timestamp: new Date() };
    setMessages(m => [...m, userMsg]); 
    setInput(''); 
    setLoading(true);
    
    try {
      const ai = await callChat(userMsg.content);
      const assistantMsg: ChatMessage = { 
        role:'assistant', 
        content: ai.explanation || 'Proposed update.', 
        compensation: ai.compensation || null, 
        timestamp: new Date() 
      };
      setMessages(m => [...m, assistantMsg]);
      if (ai?.compensation) setDraft(ai.compensation);
    } catch (e:any) {
      setMessages(m => [...m, { 
        role:'assistant', 
        content:`Error: ${e.message}`, 
        timestamp:new Date() 
      }]);
    } finally { 
      setLoading(false); 
    }
  };

  const finalize = async () => {
    if (!draft) return;
    setLoading(true);
    try {
      const mapped = await callMapper(draft);
      const finalComp: CompensationData = mapped.compensation;
      setFinalized(finalComp);
      setUnmappedComponents(mapped.unmapped || []);
      onCompensationUpdate(finalComp);
      
      // Check if conversation should be completed
      if (mapped.unmapped && mapped.unmapped.length === 0) {
        setTimeout(() => {
          onConversationComplete();
        }, 1000);
      }
      
      setMessages(m => [...m, { 
        role:'assistant', 
        content: `Finalized and mapped to your components ✅${mapped.unmapped?.length > 0 ? ` (${mapped.unmapped.length} components couldn't be mapped)` : ''}`, 
        compensation: finalComp, 
        timestamp: new Date() 
      }]);
    } catch (e:any) {
      setMessages(m => [...m, { 
        role:'assistant', 
        content:`Finalize failed: ${e.message}`, 
        timestamp:new Date() 
      }]);
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <div className="border rounded-lg bg-white shadow-sm">
      <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-600"/>
          <h3 className="font-medium">AI Compensation Assistant</h3>
        </div>
        <button 
          onClick={finalize} 
          disabled={!draft || loading} 
          className="px-2 py-1.5 text-sm rounded-md bg-emerald-600 text-white disabled:opacity-50 flex items-center gap-1"
        >
          <CheckCircle className="w-4 h-4"/>
          Finalize
        </button>
      </div>

      <div className="h-80 overflow-y-auto p-4 space-y-4">
        {messages.map((m,i)=> (
          <div key={i} className={`flex gap-3 ${m.role==='user'?'justify-end':'justify-start'}`}>
            {m.role==='assistant' && (
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-blue-600"/>
              </div>
            )}
            <div className={`max-w-xs lg:max-w-md px-3 py-2 rounded-lg ${m.role==='user'?'bg-blue-600 text-white':'bg-gray-100 text-gray-900'}`}>
              <p className="text-sm whitespace-pre-wrap">{m.content}</p>
              {m.compensation && (
                <div className="mt-1 text-xs text-gray-600">
                  Draft received. Click <b>Finalize</b> to map to your components.
                </div>
              )}
              <div className="text-xs opacity-75 mt-1">
                {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            {m.role==='user' && (
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-gray-600"/>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-blue-600"/>
            </div>
            <div className="bg-gray-100 px-3 py-2 rounded-lg">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin"/>
                <span className="text-sm text-gray-600">Thinking...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={endRef}/>
      </div>

      {/* Display unmapped components warning */}
      {unmappedComponents.length > 0 && (
        <div className="px-4 py-2 border-t border-b bg-red-50">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-red-800">Missing Component Codes</div>
              <div className="text-xs text-red-700 mt-1">
                The following components from AI are NOT available in your system:
              </div>
              <div className="mt-2 space-y-1">
                {unmappedComponents.map((comp, idx) => (
                  <div key={idx} className="text-xs bg-red-100 px-2 py-1 rounded">
                    <code className="font-mono font-bold">{comp.raw_code}</code> → ₹{comp.amount.toLocaleString('en-IN')} 
                    <span className="text-red-600 ml-2">(SKIPPED)</span>
                  </div>
                ))}
                <div className="text-xs text-red-600 mt-2 font-medium">
                  ⚠️ ACTION REQUIRED: Create these component codes in your Master Data first!
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="p-3 border-t">
        <div className="flex gap-2">
          <input 
            type="text" 
            value={inputValue} 
            onChange={e=>setInput(e.target.value)} 
            onKeyDown={e=>{ 
              if(e.key==='Enter' && !e.shiftKey){ 
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
            disabled={!inputValue.trim()||loading} 
            className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="w-4 h-4"/>
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          Iterate freely. When happy, click <b>Finalize</b> to map to your company components.
        </div>
      </div>

      <div className="px-3 pb-4">
        {finalized ? <Summary comp={finalized}/> : draft ? <Summary comp={draft}/> : null}
      </div>
    </div>
  );
}