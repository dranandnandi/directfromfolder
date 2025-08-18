/*
  # Fix User Organization Mapping - Remove Materialized View Dependencies

  1. Changes
    - Drop materialized view user_org_mapping and related functions
    - Create direct query functions for real-time data access
    - Update all RLS policies to use direct queries instead of materialized view
    - Remove timing dependencies and delays

  2. Security
    - All policies now use real-time queries to users table
    - No more stale data issues from materialized view refreshes
*/

-- Drop all existing policies thoroughly (checking all possible names)
DO $$
BEGIN
  -- Users table policies
  DROP POLICY IF EXISTS "allow_read_own_record" ON users;
  DROP POLICY IF EXISTS "allow_read_org_users" ON users;
  DROP POLICY IF EXISTS "allow_admin_create" ON users;
  DROP POLICY IF EXISTS "allow_admin_update" ON users;
  DROP POLICY IF EXISTS "allow_admin_delete" ON users;
  DROP POLICY IF EXISTS "users_self_access" ON users;
  DROP POLICY IF EXISTS "users_org_read" ON users;
  DROP POLICY IF EXISTS "admins_create_users" ON users;
  DROP POLICY IF EXISTS "admins_modify_users" ON users;
  DROP POLICY IF EXISTS "admins_remove_users" ON users;

  -- Tasks table policies
  DROP POLICY IF EXISTS "allow_task_insert" ON tasks;
  DROP POLICY IF EXISTS "allow_task_select" ON tasks;
  DROP POLICY IF EXISTS "allow_task_update" ON tasks;
  DROP POLICY IF EXISTS "allow_admin_delete_tasks" ON tasks;
  DROP POLICY IF EXISTS "tasks_insert" ON tasks;
  DROP POLICY IF EXISTS "tasks_select" ON tasks;
  DROP POLICY IF EXISTS "tasks_update" ON tasks;
  DROP POLICY IF EXISTS "allow_personal_tasks_select" ON tasks;
  DROP POLICY IF EXISTS "allow_org_tasks_select" ON tasks;

  -- Recurring task templates policies
  DROP POLICY IF EXISTS "allow_recurring_templates_select" ON recurring_task_templates;
  DROP POLICY IF EXISTS "allow_recurring_templates_insert" ON recurring_task_templates;
  DROP POLICY IF EXISTS "allow_recurring_templates_update" ON recurring_task_templates;
  DROP POLICY IF EXISTS "allow_recurring_templates_delete" ON recurring_task_templates;

  -- Quality control entries policies
  DROP POLICY IF EXISTS "quality_control_entries_select_policy" ON quality_control_entries;
  DROP POLICY IF EXISTS "quality_control_entries_insert_policy" ON quality_control_entries;
  DROP POLICY IF EXISTS "quality_control_entries_update_policy" ON quality_control_entries;
  DROP POLICY IF EXISTS "quality_control_entries_delete_policy" ON quality_control_entries;

  -- Task messages policies (all versions)
  DROP POLICY IF EXISTS "task_messages_select_policy" ON task_messages;
  DROP POLICY IF EXISTS "task_messages_insert_policy" ON task_messages;
  DROP POLICY IF EXISTS "task_messages_select_policy_v2" ON task_messages;
  DROP POLICY IF EXISTS "task_messages_insert_policy_v2" ON task_messages;
  DROP POLICY IF EXISTS "task_messages_select_policy_v3" ON task_messages;
  DROP POLICY IF EXISTS "task_messages_insert_policy_v3" ON task_messages;

  -- Task activity logs policies (all versions)
  DROP POLICY IF EXISTS "task_activity_logs_select_policy" ON task_activity_logs;
  DROP POLICY IF EXISTS "task_activity_logs_insert_policy" ON task_activity_logs;
  DROP POLICY IF EXISTS "task_activity_logs_select_policy_v2" ON task_activity_logs;
  DROP POLICY IF EXISTS "task_activity_logs_select_policy_v3" ON task_activity_logs;
  DROP POLICY IF EXISTS "allow_activity_logs_select" ON task_activity_logs;
  DROP POLICY IF EXISTS "allow_activity_logs_insert" ON task_activity_logs;
END $$;

-- Drop existing triggers and functions
DROP TRIGGER IF EXISTS refresh_user_org_mapping_trigger ON users;
DROP TRIGGER IF EXISTS set_task_organization_id_trigger ON tasks;

-- Drop existing functions
DROP FUNCTION IF EXISTS get_user_org_id() CASCADE;
DROP FUNCTION IF EXISTS set_task_organization_id() CASCADE;
DROP FUNCTION IF EXISTS refresh_user_org_mapping() CASCADE;

-- Drop materialized view
DROP MATERIALIZED VIEW IF EXISTS user_org_mapping;

-- Create new function to get user's organization ID directly from users table
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id
  FROM users
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

-- Create new function to get user's role and organization ID
CREATE OR REPLACE FUNCTION get_user_org_role()
RETURNS TABLE(org_id uuid, user_role text)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id, role
  FROM users
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

-- Create users table policies with direct queries and unique names
CREATE POLICY "users_read_own_record_v4"
  ON users FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

CREATE POLICY "users_read_org_members_v4"
  ON users FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id()
  );

CREATE POLICY "users_admin_create_v4"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM users u 
      WHERE u.auth_id = auth.uid()
      AND u.role IN ('admin', 'superadmin')
      AND u.organization_id = organization_id
    )
  );

CREATE POLICY "users_admin_update_v4"
  ON users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM users u 
      WHERE u.auth_id = auth.uid()
      AND u.role IN ('admin', 'superadmin')
      AND u.organization_id = users.organization_id
    )
  );

CREATE POLICY "users_admin_delete_v4"
  ON users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM users u 
      WHERE u.auth_id = auth.uid()
      AND u.role IN ('admin', 'superadmin')
      AND u.organization_id = users.organization_id
      AND users.auth_id != auth.uid()
    )
  );

-- Create tasks table policies with unique names
CREATE POLICY "tasks_insert_v4"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = get_user_org_id()
  );

CREATE POLICY "tasks_select_v4"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id()
  );

CREATE POLICY "tasks_update_v4"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    organization_id = get_user_org_id()
  );

CREATE POLICY "tasks_admin_delete_v4"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM users u 
      WHERE u.auth_id = auth.uid()
      AND u.role IN ('admin', 'superadmin')
      AND u.organization_id = tasks.organization_id
    )
  );

-- Create recurring task templates policies with unique names
CREATE POLICY "recurring_templates_select_v4"
  ON recurring_task_templates FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id()
  );

CREATE POLICY "recurring_templates_insert_v4"
  ON recurring_task_templates FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = get_user_org_id()
  );

CREATE POLICY "recurring_templates_update_v4"
  ON recurring_task_templates FOR UPDATE
  TO authenticated
  USING (
    organization_id = get_user_org_id()
  );

CREATE POLICY "recurring_templates_delete_v4"
  ON recurring_task_templates FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM users u 
      WHERE u.auth_id = auth.uid()
      AND u.role IN ('admin', 'superadmin')
      AND u.organization_id = recurring_task_templates.organization_id
    )
  );

-- Create quality control entries policies with unique names
CREATE POLICY "quality_control_select_v4"
  ON quality_control_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      WHERE t.id = quality_control_entries.task_id
      AND t.organization_id = get_user_org_id()
    )
  );

CREATE POLICY "quality_control_insert_v4"
  ON quality_control_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM tasks t
      WHERE t.id = task_id
      AND t.organization_id = get_user_org_id()
    )
  );

CREATE POLICY "quality_control_update_v4"
  ON quality_control_entries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      WHERE t.id = quality_control_entries.task_id
      AND t.organization_id = get_user_org_id()
    )
  );

CREATE POLICY "quality_control_delete_v4"
  ON quality_control_entries FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      WHERE t.id = quality_control_entries.task_id
      AND t.organization_id = get_user_org_id()
    )
  );

-- Create task messages policies with unique names
CREATE POLICY "task_messages_select_v4"
  ON task_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      WHERE t.id = task_messages.task_id
      AND t.organization_id = get_user_org_id()
    )
  );

CREATE POLICY "task_messages_insert_v4"
  ON task_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM tasks t
      WHERE t.id = task_id
      AND t.organization_id = get_user_org_id()
    )
  );

-- Create task activity logs policies with unique names
CREATE POLICY "task_activity_logs_select_v4"
  ON task_activity_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM tasks t
      WHERE t.id = task_activity_logs.task_id
      AND t.organization_id = get_user_org_id()
    )
  );

CREATE POLICY "task_activity_logs_insert_v4"
  ON task_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM tasks t
      WHERE t.id = task_id
      AND t.organization_id = get_user_org_id()
    )
  );

-- Create task organization trigger function with direct query
CREATE OR REPLACE FUNCTION set_task_organization_id()
RETURNS TRIGGER AS $$
DECLARE
  org_id uuid;
BEGIN
  -- Get organization ID directly from users table
  SELECT organization_id INTO org_id
  FROM users
  WHERE auth_id = auth.uid()
  LIMIT 1;
  
  IF org_id IS NULL THEN
    RAISE EXCEPTION 'User organization not found';
  END IF;

  NEW.organization_id := org_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create task organization trigger
CREATE TRIGGER set_task_organization_id_trigger
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_task_organization_id();