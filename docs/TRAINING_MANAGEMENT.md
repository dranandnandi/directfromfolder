# Training management

## Access

- Desktop: **Training** in the sidebar, or **Admin Dashboard → Training**.
- Android/mobile: **More → Training**.
- Direct route: `/training`. A specific session can be linked as `/training?session=<session-id>`.
- Admins and superadmins manage their own organization's sessions and records. Employees see only sessions they are assigned to, their own attendee record, and relevant change history.

## Scheduling

1. Choose **Schedule training** and enter the title, trainer, location or meeting URL, and start/end times.
2. Select employees individually or filter by department and choose **Select filtered employees**.
3. Optionally link an existing **Training Materials** document. Upload those files in **Admin Dashboard → Documents** first.
4. Save the session. The employee can now see the assignment under Training.

Times are entered and displayed in the viewer's local timezone and stored as timezone-aware timestamps. This creates an in-app assignment; it does not send email, WhatsApp, push notifications, or calendar invitations.

Scheduled sessions can be edited. Dates cannot change once attendance or progress has been recorded. An attendee with attendance, progress, or notes cannot be removed. Existing inactive attendees can be retained for historical records; new assignments require active organization membership.

## Attendance and completion

Select a session and choose **Record / update** for an attendee after the training starts.

- Attendance: **Invited**, **Attended**, **Absent**, or **Excused**.
- Completion: **Pending**, **In progress**, or **Completed**.
- Progress/completion requires **Attended** attendance.
- Completion time is recorded automatically. Editing notes preserves the original completion time. Reverting completion clears that time, while retaining the prior value in history.
- Notes are visible to the employee.

**Close session** is available after the session ends and every attendee has attendance recorded. Closing does not automatically complete individual records. Admins can still correct individual attendance/completion after closing. Closed sessions cannot be rescheduled or revert attendance to Invited.

**Cancel session** preserves the schedule and employee assignments as cancelled. Sessions with attendance or progress records cannot be cancelled. Cancelled records are excluded from summary counts and cannot be updated.

Every schedule edit, assignment/removal, status change, and individual record update records the admin, time, and previous/new values. Application users cannot write directly to the tables or edit/delete history. Concurrent changes require refreshing rather than overwriting newer data.

## Employee records

Use **Employee records** to select an employee, search training, or filter completion status. The selected employee's assigned/attended/completed/outstanding totals include their non-cancelled sessions. Employees have **My records** with the same personal details.

**Export records** exports the filtered rows as CSV, including the training, trainer, schedule, attendance, completion date, and notes. Exported timestamps use ISO format, and free-text spreadsheet formula prefixes are escaped.

## Database setup

New migration: `supabase/migrations/20261116000000_training_management.sql`.

It adds `training_sessions`, `training_attendees`, and `training_events`; organization/employee read policies; and validated transactional RPCs for scheduling, attendance/completion, and closing/cancellation. It depends on the existing `users`, `organizations`, and `organization_documents` tables. Linked documents continue to use the existing document service and storage policies.

The migration must be applied before using the new Training screen. Check the linked migration history first. This repository has older migrations whose remote history is incomplete; do not use `db push --include-all` to deploy this feature. Follow `.agents/PROJECT_MEMORY.md` to prepare a temporary workdir containing only the available remote-recorded migrations and this new file, then inspect `db push --dry-run` and apply only this migration.

Applied on 16 November 2026 to the linked project, `hnyqfasddflqzfibtjjz`. The isolated dry run selected only `20261116000000_training_management.sql`, and remote migration history confirmed that version after deployment. The frontend still needs to be published or included in a new Android build for users of an already installed app.

Applied on 16 November 2026 to the linked project, `hnyqfasddflqzfibtjjz`. The isolated dry run selected only `20261116000000_training_management.sql`, and remote migration history confirmed that version after deployment. The frontend still needs to be published or included in a new Android build for users of an already installed app.

## Verification

- `npm run test:training`: PostgreSQL integration tests in PGlite plus CSV, summary, and local-time conversion checks.
- `npm run build`: TypeScript validation and Vite production build.
- Verify admin scheduling, attendee record updates, the employee-only view, material download, CSV download, and narrow mobile layout in a running browser after deployment.

Implementation checks: 71 training checks and 42 existing staff workflow checks passed, along with the production build. Visual/browser verification remains outstanding: the browser access host was unavailable, and Windows Computer Use stopped because it could not establish the current browser URL.

The live database linter reported no issues for the new training functions. It still reports errors in unrelated existing invitation, profile, WhatsApp, and admin-home functions; those are outside this change.

Implementation checks: 71 training checks and 42 existing staff workflow checks passed, along with the production build. Visual/browser verification remains outstanding: the browser access host was unavailable, and Windows Computer Use stopped because it could not establish the current browser URL.
