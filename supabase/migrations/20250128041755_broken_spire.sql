-- Drop existing policies if they exist
DROP POLICY IF EXISTS "task_activity_logs_select_policy_v3" ON task_activity_logs;
DROP POLICY IF EXISTS "task_activity_logs_insert_policy" ON task_activity_logs;

-- Create new policies for task_activity_logs
CREATE POLICY "allow_activity_logs_select"
  ON task_activity_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      JOIN users u ON u.organization_id = t.organization_id
      WHERE t.id = task_activity_logs.task_id
      AND u.auth_id = auth.uid()
    )
  );

CREATE POLICY "allow_activity_logs_insert"
  ON task_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM tasks t
      JOIN users u ON u.organization_id = t.organization_id
      WHERE t.id = task_id
      AND u.auth_id = auth.uid()
    )
  );

-- Ensure RLS is enabled
ALTER TABLE task_activity_logs ENABLE ROW LEVEL SECURITY;