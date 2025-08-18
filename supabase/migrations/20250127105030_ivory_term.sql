-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view messages from their organization" ON task_messages;
DROP POLICY IF EXISTS "Users can insert messages to their organization's tasks" ON task_messages;
DROP POLICY IF EXISTS "Users can view logs from their organization" ON task_activity_logs;

-- Create task_messages table if it doesn't exist
CREATE TABLE IF NOT EXISTS task_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create task_activity_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS task_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  action_details jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Drop existing indexes if they exist to avoid conflicts
DROP INDEX IF EXISTS idx_task_messages_task_id;
DROP INDEX IF EXISTS idx_task_activity_logs_task_id;
DROP INDEX IF EXISTS idx_task_messages_user_id;
DROP INDEX IF EXISTS idx_task_activity_logs_user_id;

-- Create new indexes
CREATE INDEX IF NOT EXISTS idx_task_messages_task_id ON task_messages(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_logs_task_id ON task_activity_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_messages_user_id ON task_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_logs_user_id ON task_activity_logs(user_id);

-- Enable RLS
ALTER TABLE task_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activity_logs ENABLE ROW LEVEL SECURITY;

-- Add RLS policies with new names to avoid conflicts
CREATE POLICY "task_messages_select" 
  ON task_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      JOIN users u ON u.organization_id = t.organization_id
      WHERE t.id = task_messages.task_id
      AND u.auth_id = auth.uid()
    )
  );

CREATE POLICY "task_messages_insert"
  ON task_messages FOR INSERT
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

CREATE POLICY "task_activity_logs_select"
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