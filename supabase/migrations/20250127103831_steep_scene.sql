-- Create task_messages table
CREATE TABLE IF NOT EXISTS task_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create task_activity_logs table
CREATE TABLE IF NOT EXISTS task_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  action_type text NOT NULL,
  action_details jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Add indexes
CREATE INDEX idx_task_messages_task_id ON task_messages(task_id);
CREATE INDEX idx_task_activity_logs_task_id ON task_activity_logs(task_id);

-- Enable RLS
ALTER TABLE task_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activity_logs ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY "Users can view messages from their organization"
  ON task_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      JOIN user_org_mapping m ON t.organization_id = m.organization_id
      WHERE t.id = task_messages.task_id
      AND m.auth_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages to their organization's tasks"
  ON task_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM tasks t
      JOIN user_org_mapping m ON t.organization_id = m.organization_id
      WHERE t.id = task_id
      AND m.auth_id = auth.uid()
    )
  );

CREATE POLICY "Users can view logs from their organization"
  ON task_activity_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      JOIN user_org_mapping m ON t.organization_id = m.organization_id
      WHERE t.id = task_activity_logs.task_id
      AND m.auth_id = auth.uid()
    )
  );