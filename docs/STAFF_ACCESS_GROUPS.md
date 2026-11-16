# Staff access groups

## Admin setup

Open **Team Management → Manage access groups**, or **More → Access groups** on mobile. Only active full admins/superadmins can manage access groups. Each organization receives these presets when an admin first opens the screen:

| Group | Permissions |
| --- | --- |
| Training Coordinator | Manage training and training materials |
| Attendance Approver | Read team attendance; approve/reject punch corrections and regularization |
| Leave Approver | Read and approve/reject leave requests |
| Staff Admin | All four staff permissions |

Choose **Edit permissions / members**, select active employees, review the changes, and confirm. Admins can customize a preset or create a group using the supported permissions. Groups can be disabled while retaining their membership/history. There is no destructive group deletion.

Members keep their existing User/Admin/Super Admin role. Permissions from enabled groups combine. Inactive users and membership in a different organization never grant access. Membership changes, permission changes, and disabling a group take effect on the next backend request. Frontend navigation refreshes on focus and every 30 seconds. Every group edit records its actor, timestamp, and before/after permissions and named members.

## Employee navigation

- **Training**: personal sessions for ordinary employees; scheduling, attendees, and completion for training managers.
- **Training → Training materials**: upload and manage only documents in the training category, when permitted. Existing Admin Dashboard document management remains available to full admins.
- **Approvals inbox**: only request types the employee is allowed to review. AI attendance reviews remain full-admin only.
- **Team attendance**: a read-only organization attendance view, available to attendance approvers. Each employee still uses normal personal attendance/punching.
- **Leave Management**: team leave requests and decisions for leave approvers; personal requests for other users.

Attendance approval does not grant manual punch entry, punch deletion/reopening, stale-session cleanup, shift configuration, payroll or salary access. Leave approval does not grant leave-policy configuration. None of the delegated permissions grants user creation/deletion, base-role changes, organization settings or access-group management.

Self-approval is rejected for leave, corrections and regularization. Delegated training managers cannot record their own training; another manager/full admin must do it. Existing full-admin behavior for training remains compatible. Existing payroll locks and attendance conflict checks continue to apply.

## Backend

Migration: `supabase/migrations/20261116000001_staff_access_groups.sql`.

- New tables: `staff_access_groups`, `staff_access_members`, `staff_access_events`.
- Only validated admin RPCs can change group definitions/membership. Audit records cannot be changed through the application.
- `fn_has_staff_permission` resolves the authenticated actor from the database. Frontend permission state is never accepted as authorization.
- Existing general admin/payroll helpers are unchanged. Minimal training directories and attendance RPCs avoid expanding access to user profiles and salaries.
- Training document/storage writes are constrained to the actor's organization and training folder/category.
- Sensitive account fields cannot be changed through self-profile update policies to promote a base role.
- Existing leave-assignment validation and decision functions accept delegated approvers. Removing an assigned approver does not strand pending requests for other authorized approvers.

The two WhatsApp leave Edge Functions use the same permission checks and decision RPCs. Service-only functions accept an actor supplied by the authenticated bot, validate current permission, and apply the normal leave contract. They reject self-approval, closed requests, and locked payroll periods. WhatsApp connection/configuration and sender synchronization remain full-admin operations.

## Deployment and validation

Deploy only the new migration using the isolated-workdir procedure in `.agents/PROJECT_MEMORY.md`; inspect the dry run before applying it. Older migration history is incomplete, so do not replay older migrations. Deploy only `whatsapp-request-leave` and `whatsapp-approve-leave` for the changed bot handlers.

Applied on 16 November 2026 to linked project `hnyqfasddflqzfibtjjz`. The dry run selected only `20261116000001_staff_access_groups.sql`, and remote migration history confirmed it after application. Both WhatsApp leave handlers were deployed. No memberships were assigned automatically.

Checks:

- `npm run test:staff-access`: integration checks covering delegated training, document/storage boundaries, attendance/leave decisions, permission changes/revocation, self-approval, account escalation, cross-organization access, audit protection, payroll exclusion and the trusted WhatsApp decision bridge.
- `npm run test:training`: existing training checks.
- `npm run test:staff-workflows`: existing leave/attendance/payroll-readiness checks.
- `npm run build`: TypeScript and production build.

Android debug APK built successfully: `android/app/build/outputs/apk/debug/app-debug.apk`. The final APK's Access Groups, Team Attendance, Training Materials, Training Management, shared documents, main scripts and entry HTML were checked against the production build using SHA-256. Install/use the updated build to get the new UI. Visual/device verification remains outstanding.

Validation: 79 staff-access integration checks, 71 training checks, and 42 existing staff workflow checks passed. Both changed Edge Functions passed Deno type-checking, and the production frontend build passed. Live database lint reported no errors in the new/updated staff-access, training, or approval functions; unrelated existing function errors remain outside this change.
