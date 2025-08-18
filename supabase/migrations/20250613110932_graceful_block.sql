/*
  # Enable RLS and Add Delete Policy for Tasks

  1. Security Changes
    - Enable Row Level Security on tasks table
    - Add DELETE policy for admin/superadmin users only
    - Ensure only organization admins can delete tasks from their organization

  2. Policies
    - Only admin/superadmin users can delete tasks
    - Users can only delete tasks from their own organization
*/

-- Enable RLS on tasks table
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Add DELETE policy for tasks - only admin/superadmin can delete
CREATE POLICY "allow_admin_delete_tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.role IN ('admin', 'superadmin')
      AND m.organization_id = tasks.organization_id
    )
  );