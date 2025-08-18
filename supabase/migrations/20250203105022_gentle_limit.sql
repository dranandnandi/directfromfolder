/*
  # Add Personal Tasks Support

  1. Changes
    - Add 'personalTask' to task type check constraint
    - Add RLS policy for personal tasks visibility

  2. Security
    - Personal tasks are only visible to their assignees
    - Other task types remain visible to all organization members
*/

-- Modify the task type check constraint to include personalTask
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_type_check 
  CHECK (type IN ('quickAdvisory', 'clinicalRound', 'followUp', 'personalTask'));

-- Create a new RLS policy for personal tasks
CREATE POLICY "allow_personal_tasks_visibility"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN type = 'personalTask' THEN
        assigned_to = (
          SELECT id 
          FROM users 
          WHERE auth_id = auth.uid()
          LIMIT 1
        )
      ELSE
        EXISTS (
          SELECT 1 
          FROM users 
          WHERE auth_id = auth.uid()
          AND organization_id = tasks.organization_id
        )
    END
  );