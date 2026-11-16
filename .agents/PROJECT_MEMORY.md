# Project memory

## Supabase migrations

- As confirmed by the project owner on 2026-10-31, all current Supabase database migrations have been applied to the linked remote project.
- The owner reports older migration SQL has already been applied. Remote CLI history still lacks entries for many older local files (observed 2026-10-31); do not replay them or assume the history is synchronized.
- For future database changes, avoid recommending `supabase db push --include-all` without first checking remote migration status and reviewing every migration it would apply. The owner may want a specific migration/change applied without replaying older files.
- On 2026-10-31, applied only `20261025000001_add_radhe_lab_secondary_location.sql` to project `hnyqfasddflqzfibtjjz` and verified its version in remote migration history.
- To push a specific file despite older missing history entries: prepare a temporary Supabase workdir with copies of all locally available remote-recorded migration files plus the requested file, copy the linked config and `.temp` metadata, and run `db push --dry-run --workdir <temporary-workdir>`. Proceed only when that preview selects exactly the requested migration; apply and verify remote history, then remove the temporary folder.
- Saved CLI credentials may be inaccessible inside the sandbox. A command reporting no access token may need an authorized `require_escalated` retry before concluding that the user must log in again.
