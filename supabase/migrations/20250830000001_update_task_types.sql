/*
  # Update Task Types to Match Current Application

  1. Changes
    - Update task type check constraint to include current task types:
      - 'regularTask' (replaces 'quickAdvisory')
      - 'patientTracking' (replaces 'clinicalRound') 
      - 'auditTask' (replaces 'followUp')
      - 'personalTask' (already exists)
    - Keep all existing types for backward compatibility

  2. Security
    - Maintain existing RLS policies
    - No changes to access control logic
*/

-- Update the task type check constraint to include all current and legacy task types
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_type_check 
  CHECK (type IN (
    'quickAdvisory',     -- Legacy type
    'clinicalRound',     -- Legacy type  
    'followUp',          -- Legacy type
    'personalTask',      -- Current type
    'regularTask',       -- Current type
    'patientTracking',   -- Current type
    'auditTask'          -- Current type
  ));

-- Add a comment to document the task types
COMMENT ON COLUMN tasks.type IS 'Task type: regularTask, patientTracking, auditTask, personalTask. Legacy types: quickAdvisory, clinicalRound, followUp';
