export async function callEdge<T>(name: string, body: any, init?: RequestInit): Promise<T> {
  // Prefer explicit functions URL, else infer from Supabase URL
  let base = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined;
  if (!base) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (supabaseUrl) {
      // Typical shape: https://<project>.supabase.co → functions live under /functions/v1
      base = `${supabaseUrl.replace(/\/?$/, '')}/functions/v1`;
    }
  }
  if (!base) {
    throw new Error(
      'VITE_SUPABASE_FUNCTIONS_URL not set (and VITE_SUPABASE_URL unavailable). Please set one in .env.'
    );
  }
  const url = `${base}/${name}`;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {}),
      ...(init?.headers || {}),
    },
    body: JSON.stringify(body),
    ...init,
  });
  const json = await res.json();
  if (!res.ok || json?.ok === false) throw new Error(json?.error || res.statusText);
  return json.data as T;
}
