/*
  # Personal Tasks Visibility Update

  1. Changes
    - Allow personal tasks to be visible to both creator and assignee
    - Add assignee_id column to personal_tasks table
    - Update RLS policies for proper visibility

  2. Security
    - Enable RLS on personal_tasks table
    - Add policies for task visibility and management
*/

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "users_manage_own_tasks" ON personal_tasks;
DROP POLICY IF EXISTS "users_manage_own_tasks_v2" ON personal_tasks;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS set_personal_tasks_timestamp ON personal_tasks;
DROP TRIGGER IF EXISTS set_personal_tasks_timestamp_v2 ON personal_tasks;

-- Add assignee_id column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'personal_tasks' 
    AND column_name = 'assignee_id'
  ) THEN
    ALTER TABLE personal_tasks ADD COLUMN assignee_id uuid REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index for assignee_id if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'personal_tasks' 
    AND indexname = 'idx_personal_tasks_assignee_id'
  ) THEN
    CREATE INDEX idx_personal_tasks_assignee_id ON personal_tasks(assignee_id);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE personal_tasks ENABLE ROW LEVEL SECURITY;

-- Create policy for viewing tasks (creator or assignee)
CREATE POLICY "view_personal_tasks"
  ON personal_tasks
  FOR SELECT
  TO authenticated
  USING (
    user_id = (
      SELECT id
      FROM users
      WHERE auth_id = auth.uid()
      LIMIT 1
    )
    OR
    assignee_id = (
      SELECT id
      FROM users
      WHERE auth_id = auth.uid()
      LIMIT 1
    )
  );

-- Create policy for managing tasks (creator only)
CREATE POLICY "manage_personal_tasks"
  ON personal_tasks
  FOR ALL
  TO authenticated
  USING (
    user_id = (
      SELECT id
      FROM users
      WHERE auth_id = auth.uid()
      LIMIT 1
    )
  )
  WITH CHECK (
    user_id = (
      SELECT id
      FROM users
      WHERE auth_id = auth.uid()
      LIMIT 1
    )
  );

-- Create updated_at trigger
CREATE OR REPLACE TRIGGER set_personal_tasks_timestamp_v3
  BEFORE UPDATE ON personal_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();