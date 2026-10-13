/*
  # Industry-neutral defaults for task classification lists

  The task form dropdowns (Visit Type / Follow-up Type / Task Category) are
  driven by organizations.round_types / follow_up_types / advisory_types and
  are now editable from Settings > Organization.

  This migration only changes the column DEFAULTS used for organizations
  created from now on. Existing organizations keep whatever they have stored;
  admins can replace their lists (or press "Reset to defaults") in Settings.

  Column names are kept (round_types / advisory_types) for compatibility with
  existing rows in tasks.round_type / tasks.advisory_type.
*/

ALTER TABLE organizations
  ALTER COLUMN round_types
    SET DEFAULT ARRAY['Scheduled Visit', 'Follow-up Visit', 'Urgent Visit', 'Site Inspection', 'Consultation']::text[];

ALTER TABLE organizations
  ALTER COLUMN follow_up_types
    SET DEFAULT ARRAY['Progress Update', 'Issue Resolution', 'Report Review', 'General Check-in']::text[];

ALTER TABLE organizations
  ALTER COLUMN advisory_types
    SET DEFAULT ARRAY['General', 'Administrative', 'Communication', 'Policy', 'Safety', 'Urgent']::text[];

COMMENT ON COLUMN organizations.round_types IS
  'Visit types offered for Client Tracking tasks (editable per organization in Settings > Organization).';
COMMENT ON COLUMN organizations.follow_up_types IS
  'Follow-up types offered for Client Tracking and Audit tasks (editable per organization).';
COMMENT ON COLUMN organizations.advisory_types IS
  'Task categories offered for Regular tasks (editable per organization).';
