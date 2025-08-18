/*
  # Task Messages and Activity Logs Schema Update

  1. Tables
    - task_messages: Stores messages related to tasks
    - task_activity_logs: Tracks task activity history
  
  2. Changes
    - Safely create tables if they don't exist
    - Add appropriate indexes
    - Enable RLS
    - Add policies for organization-based access control
    
  3. Security
    - Enable RLS on both tables
    - Add policies for organization-based access
*/

-- Create task_messages table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'task_messages') THEN
    CREATE TABLE task_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      message text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

-- Create task_activity_logs table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'task_activity_logs') THEN
    CREATE TABLE task_activity_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      action_type text NOT NULL,
      action_details jsonb NOT NULL,
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

-- Create indexes if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'task_messages' AND indexname = 'idx_task_messages_task_id_v2'
  ) THEN
    CREATE INDEX idx_task_messages_task_id_v2 ON task_messages(task_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'task_activity_logs' AND indexname = 'idx_task_activity_logs_task_id_v2'
  ) THEN
    CREATE INDEX idx_task_activity_logs_task_id_v2 ON task_activity_logs(task_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'task_messages' AND indexname = 'idx_task_messages_user_id_v2'
  ) THEN
    CREATE INDEX idx_task_messages_user_id_v2 ON task_messages(user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'task_activity_logs' AND indexname = 'idx_task_activity_logs_user_id_v2'
  ) THEN
    CREATE INDEX idx_task_activity_logs_user_id_v2 ON task_activity_logs(user_id);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE task_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activity_logs ENABLE ROW LEVEL SECURITY;

-- Create policies with unique names and proper checks
DO $$ 
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "task_messages_select_policy_v2" ON task_messages;
  DROP POLICY IF EXISTS "task_messages_insert_policy_v2" ON task_messages;
  DROP POLICY IF EXISTS "task_activity_logs_select_policy_v2" ON task_activity_logs;

  -- Create new policies with unique names
  CREATE POLICY "task_messages_select_policy_v2" 
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

  CREATE POLICY "task_messages_insert_policy_v2"
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

  CREATE POLICY "task_activity_logs_select_policy_v2"
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
END $$;