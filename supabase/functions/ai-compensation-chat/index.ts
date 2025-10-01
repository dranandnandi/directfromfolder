import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
- Use common Indian payroll codes like: 
  * EARNINGS: BASIC, HRA, CONV, SPEC, MED (positive amounts)
  * EMPLOYEE DEDUCTIONS: PF, ESI, PT, TDS (negative amounts - these reduce employee pay)
  * EMPLOYER CONTRIBUTIONS: PF_ER, ESI_ER (positive amounts - employer costs, not deducted from employee)
- For deductions (PF, ESI, PT, TDS), use negative amounts
- For earnings (BASIC, HRA, CONV, SPEC, MED), use positive amounts
- For employer contributions (PF_ER, ESI_ER), use positive amounts (these are employer costs, not employee deductions)
- Remember: Employee PF (12% of basic) + Employer PF (12% of basic) are both required
- Remember: Employee ESI (0.75% of wages) + Employer ESI (3.25% of wages) are both required for applicable employees
`;

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