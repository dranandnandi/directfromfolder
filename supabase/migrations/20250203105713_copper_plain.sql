/*
  # Fix Personal Tasks Visibility

  1. Changes
    - Drop existing policy that doesn't properly handle personal tasks
    - Create separate policies for personal and organization tasks
    - Ensure personal tasks are only visible to assigned users
    - Maintain organization-wide visibility for non-personal tasks

  2. Security
    - Personal tasks are strictly limited to assigned users
    - Organization tasks remain visible to all organization members
*/

-- Drop existing policy
DROP POLICY IF EXISTS "allow_personal_tasks_visibility" ON tasks;

-- Create separate policies for personal and non-personal tasks
CREATE POLICY "allow_personal_tasks_select"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    type = 'personalTask' AND
    assigned_to = (
      SELECT id 
      FROM users 
      WHERE auth_id = auth.uid()
      LIMIT 1
    )
  );

CREATE POLICY "allow_org_tasks_select"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    type != 'personalTask' AND
    EXISTS (
      SELECT 1 
      FROM users 
      WHERE auth_id = auth.uid()
      AND organization_id = tasks.organization_id
    )
  );