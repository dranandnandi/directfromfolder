# Edge Functions environment

Set these in your `.env` (and rebuild) so the UI can call Supabase Edge Functions.

Required:
- VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
- VITE_SUPABASE_ANON_KEY=ey... (Anon/Public API key)

Optional (overrides inference):
- VITE_SUPABASE_FUNCTIONS_URL=https://YOUR-PROJECT.functions.supabase.co (or `${VITE_SUPABASE_URL}/functions/v1`)

Notes:
- The UI sends the `Authorization: Bearer <ANON_KEY>` and `apikey: <ANON_KEY>` headers by default.
- If `VITE_SUPABASE_FUNCTIONS_URL` is missing, we auto-infer `${VITE_SUPABASE_URL}/functions/v1`.
- After editing `.env`, restart `npm run dev` or rebuild.
