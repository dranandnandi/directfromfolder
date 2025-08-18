-- First, drop all existing policies and triggers
DROP TRIGGER IF EXISTS set_task_organization_id_trigger ON tasks;
DROP POLICY IF EXISTS "allow_users_read_own" ON users;
DROP POLICY IF EXISTS "allow_users_read_org" ON users;
DROP POLICY IF EXISTS "allow_admins_manage_users" ON users;
DROP POLICY IF EXISTS "allow_tasks_insert" ON tasks;
DROP POLICY IF EXISTS "allow_tasks_select" ON tasks;
DROP POLICY IF EXISTS "allow_tasks_update" ON tasks;

-- Drop existing functions
DROP FUNCTION IF EXISTS get_user_org_id(uuid) CASCADE;
DROP FUNCTION IF EXISTS set_task_organization_id() CASCADE;

-- Create a new function to get user's organization ID that avoids recursion
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS TABLE (org_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id
  FROM users
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

-- Create simplified policies for users table
CREATE POLICY "users_self_access"
  ON users FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

CREATE POLICY "users_org_read"
  ON users FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT org_id FROM get_user_org_id())
  );

-- Create admin policies with proper table references
CREATE POLICY "admins_create_users"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM users admin
      WHERE admin.auth_id = auth.uid()
      AND admin.role IN ('admin', 'superadmin')
      AND admin.organization_id = organization_id
    )
  );

CREATE POLICY "admins_modify_users"
  ON users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users admin
      WHERE admin.auth_id = auth.uid()
      AND admin.role IN ('admin', 'superadmin')
      AND admin.organization_id = users.organization_id
    )
  )
  WITH CHECK (
    organization_id = users.organization_id
  );

CREATE POLICY "admins_remove_users"
  ON users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users admin
      WHERE admin.auth_id = auth.uid()
      AND admin.role IN ('admin', 'superadmin')
      AND admin.organization_id = users.organization_id
      AND users.auth_id != auth.uid() -- Prevent self-deletion
    )
  );

-- Create simplified policies for tasks table
CREATE POLICY "tasks_insert"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (SELECT org_id FROM get_user_org_id())
  );

CREATE POLICY "tasks_select"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT org_id FROM get_user_org_id())
  );

CREATE POLICY "tasks_update"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (SELECT org_id FROM get_user_org_id())
  )
  WITH CHECK (
    organization_id = tasks.organization_id
  );

-- Create task organization trigger function
CREATE OR REPLACE FUNCTION set_task_organization_id()
RETURNS TRIGGER AS $$
DECLARE
  org_id uuid;
BEGIN
  SELECT o.org_id INTO org_id FROM get_user_org_id() o LIMIT 1;
  
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