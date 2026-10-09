/*
  # Fix recurring_task_templates type check constraint

  1. Problem
    - `tasks.type` was widened in 20250830000001_update_task_types.sql to the current
      task types (regularTask, patientTracking, auditTask, personalTask), but
      `recurring_task_templates.type` was left on the legacy-only list.
    - Creating a recurring template from the app fails with:
      "new row for relation \"recurring_task_templates\" violates check constraint
       \"recurring_task_templates_type_check\""

  2. Changes
    - Align the template type constraint with tasks (current + legacy types)

  3. Security
    - No changes to RLS policies or access control
*/

ALTER TABLE recurring_task_templates DROP CONSTRAINT IF EXISTS recurring_task_templates_type_check;
ALTER TABLE recurring_task_templates ADD CONSTRAINT recurring_task_templates_type_check
  CHECK (type IN (
    'quickAdvisory',     -- Legacy type
    'clinicalRound',     -- Legacy type
    'followUp',          -- Legacy type
    'personalTask',      -- Current type
    'regularTask',       -- Current type
    'patientTracking',   -- Current type
    'auditTask'          -- Current type
  ));

COMMENT ON COLUMN recurring_task_templates.type IS 'Task type: regularTask, patientTracking, auditTask, personalTask. Legacy types: quickAdvisory, clinicalRound, followUp';
