// supabase/functions/_shared/utils.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export function supabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceKey, {
    global: { headers: { "x-application-name": "payroll-edge" } },
  });
}

export async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return await req.json();
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export function ok<T>(data: T, init: ResponseInit = {}) {
  return new Response(JSON.stringify({ ok: true, data }), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

export function bad(message: string, init: ResponseInit = {}) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: init.status ?? 400,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

export function cors(req: Request) {
  return {
    "access-control-allow-origin": req.headers.get("origin") ?? "*",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}

/** Gemini 2.5 Flash Pro client (uses ALLGOOGLE_KEY) */
export async function gemini(parts: any[], safetySettings: any = {}) {
  const key = Deno.env.get("ALLGOOGLE_KEY") ?? "";
  if (!key) throw new Error("Missing ALLGOOGLE_KEY");
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-pro:generateContent?key=" +
    key;

  const body = { contents: [{ role: "user", parts }], safetySettings };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);

  const json = await res.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  return text;
}
