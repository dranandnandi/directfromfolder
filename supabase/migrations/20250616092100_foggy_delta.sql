/*
  # Quality Control and Maintenance Entries

  1. New Tables
    - `quality_control_entries`
      - `id` (uuid, primary key)
      - `task_id` (uuid, references tasks)
      - `user_id` (uuid, references users)
      - `entry_date` (timestamptz) - manually entered date
      - `entry_description` (text) - flexible field for quality values or maintenance details
      - `remark` (text) - additional notes
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on quality_control_entries table
    - Add policies for organization-based access
*/

-- Create quality_control_entries table
CREATE TABLE IF NOT EXISTS quality_control_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  entry_date timestamptz NOT NULL,
  entry_description text NOT NULL,
  remark text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_quality_control_entries_task_id ON quality_control_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_quality_control_entries_user_id ON quality_control_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_quality_control_entries_entry_date ON quality_control_entries(entry_date);

-- Enable RLS
ALTER TABLE quality_control_entries ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "quality_control_entries_select_policy"
  ON quality_control_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      JOIN users u ON u.organization_id = t.organization_id
      WHERE t.id = quality_control_entries.task_id
      AND u.auth_id = auth.uid()
    )
  );

CREATE POLICY "quality_control_entries_insert_policy"
  ON quality_control_entries FOR INSERT
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

CREATE POLICY "quality_control_entries_update_policy"
  ON quality_control_entries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      JOIN users u ON u.organization_id = t.organization_id
      WHERE t.id = quality_control_entries.task_id
      AND u.auth_id = auth.uid()
    )
  );

CREATE POLICY "quality_control_entries_delete_policy"
  ON quality_control_entries FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      JOIN users u ON u.organization_id = t.organization_id
      WHERE t.id = quality_control_entries.task_id
      AND u.auth_id = auth.uid()
    )
  );