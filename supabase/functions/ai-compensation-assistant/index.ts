// supabase/functions/ai-compensation-assistant/index.ts
import { readJson, ok, bad, cors, gemini } from "../_shared/utils.ts";

interface CompensationComponent {
  component_code: string;
  amount: number;
}

interface CompensationRequest {
  user_input: string;
  current_compensation?: {
    ctc_annual: number;
    pay_schedule: string;
    currency: string;
    components: CompensationComponent[];
    notes?: string;
  };
  conversation_history?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  available_components?: Array<{
    code: string;
    name: string;
    type: "earning" | "deduction" | "employer_cost";
  }>;
}

interface CompensationResponse {
  compensation: {
    ctc_annual: number;
    pay_schedule: "monthly" | "weekly" | "biweekly";
    currency: string;
    components: CompensationComponent[];
    notes: string;
  };
  explanation: string;
  conversation_complete: boolean;
  next_questions?: string[];
}

const SYSTEM_PROMPT = `You are an expert Indian payroll compensation assistant. Your job is to help HR professionals structure employee compensation packages.

Key Rules:
1. ALWAYS respond with valid JSON in the exact format specified
2. Use standard Indian payroll components: BASIC, HRA, CONV (Conveyance), MED (Medical), SPEC (Special Allowance), PF (Provident Fund), ESI, PT (Professional Tax), TDS
3. BASIC salary should typically be 40-50% of CTC for tax optimization
4. HRA should be 40-50% of BASIC (or as per company policy)
5. PF, ESI, PT, TDS are deductions (negative amounts)
6. All amounts should be reasonable and follow Indian labor laws
7. Handle iterative conversations - use current_compensation + user_input to refine
8. Set conversation_complete=true only when user says "done", "finalize", or similar
9. Currency should be INR unless specified otherwise
10. Pay schedule should default to "monthly" unless specified

Response Format (STRICT JSON):
{
  "compensation": {
    "ctc_annual": number,
    "pay_schedule": "monthly" | "weekly" | "biweekly",
    "currency": "INR",
    "components": [
      {"component_code": "BASIC", "amount": number},
      {"component_code": "HRA", "amount": number}
    ],
    "notes": "explanation of structure"
  },
  "explanation": "conversational explanation of changes/suggestions",
  "conversation_complete": boolean,
  "next_questions": ["suggestion1", "suggestion2"] // optional
}

Available Components Reference:
- BASIC: Basic Salary (earning)
- HRA: House Rent Allowance (earning) 
- CONV: Conveyance Allowance (earning)
- MED: Medical Allowance (earning)
- SPEC: Special Allowance (earning)
- PF: Provident Fund (deduction, negative)
- ESI: Employee State Insurance (deduction, negative)
- PT: Professional Tax (deduction, negative)
- TDS: Tax Deducted at Source (deduction, negative)`;

Deno.serve(async (req: Request) => {
  const corsHeaders = cors(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return bad("Method not allowed", { headers: corsHeaders });
  }

  try {
    const body: CompensationRequest = await readJson(req);
    const { user_input, current_compensation, conversation_history, available_components } = body;

    if (!user_input) {
      return bad("Missing user_input", { headers: corsHeaders });
    }

    // Build context for the AI
    let contextPrompt = "";
    
    if (current_compensation) {
      contextPrompt += `\nCURRENT COMPENSATION:\n${JSON.stringify(current_compensation, null, 2)}`;
    }

    if (available_components) {
      contextPrompt += `\nAVAILABLE COMPONENTS:\n${available_components.map(c => `${c.code}: ${c.name} (${c.type})`).join('\n')}`;
    }

    if (conversation_history && conversation_history.length > 0) {
      contextPrompt += `\nCONVERSATION HISTORY:\n${conversation_history.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`;
    }

    const prompt = `${SYSTEM_PROMPT}${contextPrompt}\n\nUSER INPUT: ${user_input}\n\nProvide compensation structure as JSON:`;

    // Call Gemini using the shared utility
    const aiText = await gemini([{ text: prompt }]);

    // Clean up the response - extract JSON from markdown if needed
    let cleanedText = aiText;
    if (aiText.includes('```json')) {
      const jsonMatch = aiText.match(/```json\n?(.*?)\n?```/s);
      if (jsonMatch) {
        cleanedText = jsonMatch[1];
      }
    } else if (aiText.includes('```')) {
      const jsonMatch = aiText.match(/```\n?(.*?)\n?```/s);
      if (jsonMatch) {
        cleanedText = jsonMatch[1];
      }
    }

    // Parse the AI response
    let compensationResponse: CompensationResponse;
    try {
      compensationResponse = JSON.parse(cleanedText.trim());
    } catch (parseError) {
      console.error("Failed to parse AI response:", aiText);
      return bad("Invalid AI response format", { headers: corsHeaders });
    }

    // Validate the response structure
    if (!compensationResponse.compensation || !compensationResponse.explanation) {
      return bad("Invalid compensation response structure", { headers: corsHeaders });
    }

    // Ensure required fields
    if (!compensationResponse.compensation.components || !Array.isArray(compensationResponse.compensation.components)) {
      compensationResponse.compensation.components = [];
    }

    return ok(compensationResponse, { headers: corsHeaders });

  } catch (error: any) {
    console.error("Compensation AI error:", error);
    return bad(error.message || "Internal server error", { headers: corsHeaders });
  }
});