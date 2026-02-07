import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { user_input = "", current_compensation, conversation_history = [] } = body || {};

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch active pay components
    const { data: components, error: compError } = await supabase
      .from('pay_components')
      .select('code, name, type')
      .eq('active', true);

    if (compError) {
      console.error("Error fetching components:", compError);
      return jsonResponse({ error: "Failed to fetch pay components" }, 500);
    }

    // Categorize components for the prompt
    const earnings = components?.filter(c => c.type === 'earning').map(c => `${c.code} (${c.name})`).join(', ') || "BASIC, HRA, CONV, SPEC";
    const deductions = components?.filter(c => c.type === 'deduction').map(c => `${c.code} (${c.name})`).join(', ') || "PF, ESI, PT, TDS";
    const employerCosts = components?.filter(c => c.type === 'employer_cost').map(c => `${c.code} (${c.name})`).join(', ') || "PF_ER, ESI_ER";

    const CHAT_PROMPT = `You are an Indian payroll assistant.
- Talk conversationally.
- When you propose a salary breakup, return JSON in this shape (all ANNUAL amounts):
{
  "compensation": {
    "ctc_annual": number,
    "pay_schedule": "monthly",
    "currency": "INR",
    "components": [{"component_code": string, "amount": number}],
    "notes": string
  },
  "explanation": string,
  "conversation_complete": boolean,
  "next_questions": string[]
}
- It's OK to iterate loosely; don't worry about company-specific codes. Keep amounts annual.

CRITICAL RULES FOR COMPONENTS:
1. Use ONLY these available component codes:
   - EARNINGS: ${earnings}
   - DEDUCTIONS: ${deductions}
   - EMPLOYER COSTS: ${employerCosts}

2. SIGN CONVENTION (STRICTLY ENFORCE THIS):
   - EARNINGS must be POSITIVE numbers (e.g., 360000).
   - DEDUCTIONS must be NEGATIVE numbers (e.g., -2400).
   - EMPLOYER COSTS must be POSITIVE numbers (e.g., 21600).

3. LOGIC:
   - Employee PF (12% of basic) + Employer PF (12% of basic) are both required.
   - Employee ESI (0.75% of wages) + Employer ESI (3.25% of wages) are both required for applicable employees (Gross < 21000/month).
   - Professional Tax (PT) varies by state (usually 200/month).
   - TDS is an estimate.
`;

    const key = Deno.env.get("ALLGOOGLE_KEY");
    if (!key) return jsonResponse({ error: "Missing ALLGOOGLE_KEY" }, 500);

    const prompt = `${CHAT_PROMPT}

CURRENT_COMP: ${JSON.stringify(current_compensation || {}, null, 2)}

HISTORY: ${conversation_history.map((m: any) => `
${m.role}: ${m.content}`).join("")}

USER: ${user_input}

Reply with JSON only (no markdown fences).`;

    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 1400 }
      }),
    });

    if (!resp.ok) return jsonResponse({ error: `Gemini API error ${resp.status}` }, 500);

    const data = await resp.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // If it returned markdown fences, strip them; then pass through as-is
    const fenced = text.match(/```json\n?([\s\S]*?)\n?```/i) || text.match(/```\n?([\s\S]*?)\n?```/i);
    const raw = (fenced ? fenced[1] : text).trim();

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return jsonResponse({
        explanation: text,
        compensation: null,
        conversation_complete: false,
        next_questions: []
      });
    }

    return jsonResponse(parsed);
  } catch (e: any) {
    return jsonResponse({ error: e?.message || "Internal error" }, 500);
  }
});