/*
  # Personal Tasks Implementation

  1. New Tables
    - `personal_tasks`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `title` (text)
      - `description` (text)
      - `priority` (text)
      - `status` (text)
      - `due_date` (timestamptz)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `personal_tasks` table
    - Add policy for users to manage their own tasks
*/

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "users_manage_own_tasks" ON personal_tasks;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS set_personal_tasks_timestamp ON personal_tasks;

-- Create personal tasks table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'personal_tasks') THEN
    CREATE TABLE personal_tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL,
      description text NOT NULL,
      priority text NOT NULL CHECK (priority IN ('critical', 'moderate', 'lessImportant')),
      status text NOT NULL CHECK (status IN ('new', 'pending', 'inProgress', 'completed', 'overdue')),
      due_date timestamptz,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

-- Create index if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'personal_tasks' 
    AND indexname = 'idx_personal_tasks_user_id_v2'
  ) THEN
    CREATE INDEX idx_personal_tasks_user_id_v2 ON personal_tasks(user_id);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE personal_tasks ENABLE ROW LEVEL SECURITY;

-- Create new RLS policy with a unique name
CREATE POLICY "users_manage_own_tasks_v2"
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
CREATE OR REPLACE TRIGGER set_personal_tasks_timestamp_v2
  BEFORE UPDATE ON personal_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();