/*
  # Create Personal Tasks Table

  1. New Tables
    - `personal_tasks`: Dedicated table for personal tasks with strict RLS
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
    - Enable RLS
    - Add policy for users to manage only their own tasks
*/

-- Create personal tasks table
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

-- Create index for user_id
CREATE INDEX idx_personal_tasks_user_id ON personal_tasks(user_id);

-- Enable RLS
ALTER TABLE personal_tasks ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "users_manage_own_tasks"
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
CREATE TRIGGER set_personal_tasks_timestamp
  BEFORE UPDATE ON personal_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();