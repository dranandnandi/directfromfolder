/*
  # Task Messages and Activity Logs Schema

  1. Tables
    - task_messages: Stores messages related to tasks
    - task_activity_logs: Tracks task activity history
  
  2. Changes
    - Create tables if they don't exist
    - Add appropriate indexes
    - Enable RLS
    - Add policies for organization-based access control
*/

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "task_messages_select" ON task_messages;
DROP POLICY IF EXISTS "task_messages_insert" ON task_messages;
DROP POLICY IF EXISTS "task_activity_logs_select" ON task_activity_logs;

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

-- Drop existing indexes if they exist
DROP INDEX IF EXISTS idx_task_messages_task_id;
DROP INDEX IF EXISTS idx_task_activity_logs_task_id;
DROP INDEX IF EXISTS idx_task_messages_user_id;
DROP INDEX IF EXISTS idx_task_activity_logs_user_id;

-- Create new indexes
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_task_messages_task_id') THEN
    CREATE INDEX idx_task_messages_task_id ON task_messages(task_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_task_activity_logs_task_id') THEN
    CREATE INDEX idx_task_activity_logs_task_id ON task_activity_logs(task_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_task_messages_user_id') THEN
    CREATE INDEX idx_task_messages_user_id ON task_messages(user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_task_activity_logs_user_id') THEN
    CREATE INDEX idx_task_activity_logs_user_id ON task_activity_logs(user_id);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE task_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activity_logs ENABLE ROW LEVEL SECURITY;

-- Create new policies with unique names
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'task_messages' AND policyname = 'task_messages_select_policy'
  ) THEN
    CREATE POLICY "task_messages_select_policy" 
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
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'task_messages' AND policyname = 'task_messages_insert_policy'
  ) THEN
    CREATE POLICY "task_messages_insert_policy"
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
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'task_activity_logs' AND policyname = 'task_activity_logs_select_policy'
  ) THEN
    CREATE POLICY "task_activity_logs_select_policy"
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
  END IF;
END $$;