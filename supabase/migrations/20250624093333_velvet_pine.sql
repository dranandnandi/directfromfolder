/*
  # Add RLS policies for personal tasks deletion by admins

  1. New Policies
    - Allow admins to view personal tasks within their organization
    - Allow admins to delete personal tasks within their organization
    - Maintain existing user access to their own personal tasks

  2. Security
    - Only admins/superadmins can delete personal tasks of other users
    - Users maintain full access to their own personal tasks
    - Organization-based access control
*/

-- Add policy for admins to view personal tasks in their organization
CREATE POLICY "personal_tasks_admin_view"
  ON personal_tasks FOR SELECT
  TO authenticated
  USING (
    -- User can view their own tasks (existing functionality)
    user_id = get_current_user_id()
    OR
    assignee_id = get_current_user_id()
    OR
    -- Admins can view all personal tasks in their organization
    (
      is_current_user_admin_safe()
      AND EXISTS (
        SELECT 1 
        FROM users u 
        WHERE u.id = personal_tasks.user_id 
        AND u.organization_id = get_current_user_org_id_safe()
      )
    )
  );

-- Add policy for admins to delete personal tasks in their organization
CREATE POLICY "personal_tasks_admin_delete"
  ON personal_tasks FOR DELETE
  TO authenticated
  USING (
    -- Admins can delete personal tasks of users in their organization
    is_current_user_admin_safe()
    AND EXISTS (
      SELECT 1 
      FROM users u 
      WHERE u.id = personal_tasks.user_id 
      AND u.organization_id = get_current_user_org_id_safe()
    )
  );

-- Drop the old policies that might conflict
DROP POLICY IF EXISTS "view_personal_tasks" ON personal_tasks;
DROP POLICY IF EXISTS "manage_personal_tasks" ON personal_tasks;
DROP POLICY IF EXISTS "users_manage_own_tasks_v2" ON personal_tasks;

-- Recreate the user management policies with updated names
CREATE POLICY "personal_tasks_user_manage"
  ON personal_tasks FOR ALL
  TO authenticated
  USING (
    user_id = get_current_user_id()
  )
  WITH CHECK (
    user_id = get_current_user_id()
  );

-- Allow users to view tasks assigned to them
CREATE POLICY "personal_tasks_assignee_view"
  ON personal_tasks FOR SELECT
  TO authenticated
  USING (
    assignee_id = get_current_user_id()
  );