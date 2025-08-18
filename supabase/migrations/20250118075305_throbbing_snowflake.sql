-- First, drop all existing policies and triggers
DROP TRIGGER IF EXISTS refresh_user_org_cache_trigger ON users;
DROP TRIGGER IF EXISTS set_task_organization_id_trigger ON tasks;

DROP POLICY IF EXISTS "users_self_access" ON users;
DROP POLICY IF EXISTS "users_org_access" ON users;
DROP POLICY IF EXISTS "admin_all_access" ON users;
DROP POLICY IF EXISTS "task_insert" ON tasks;
DROP POLICY IF EXISTS "task_select" ON tasks;
DROP POLICY IF EXISTS "task_update" ON tasks;

-- Drop functions and views
DROP FUNCTION IF EXISTS get_auth_user_org_id() CASCADE;
DROP FUNCTION IF EXISTS set_task_organization_id() CASCADE;
DROP FUNCTION IF EXISTS refresh_user_org_cache() CASCADE;
DROP MATERIALIZED VIEW IF EXISTS user_org_cache;

-- Create a stable function to get user's organization ID
CREATE OR REPLACE FUNCTION get_user_org_id(user_auth_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id
  FROM users
  WHERE auth_id = user_auth_id
  LIMIT 1;
$$;

-- Create simplified policies for users table
CREATE POLICY "allow_users_read_own"
  ON users FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

CREATE POLICY "allow_users_read_org"
  ON users FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id(auth.uid())
  );

CREATE POLICY "allow_admins_manage_users"
  ON users FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users u
      WHERE u.auth_id = auth.uid()
      AND u.role IN ('admin', 'superadmin')
      AND u.organization_id = users.organization_id
      AND u.auth_id != users.auth_id  -- Prevent recursion by excluding self-reference
    )
  );

-- Create simplified policies for tasks table
CREATE POLICY "allow_tasks_insert"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = get_user_org_id(auth.uid())
  );

CREATE POLICY "allow_tasks_select"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id(auth.uid())
  );

CREATE POLICY "allow_tasks_update"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    organization_id = get_user_org_id(auth.uid())
  );

-- Create task organization trigger function
CREATE OR REPLACE FUNCTION set_task_organization_id()
RETURNS TRIGGER AS $$
DECLARE
  user_org_id uuid;
BEGIN
  SELECT organization_id INTO user_org_id
  FROM users
  WHERE auth_id = auth.uid()
  LIMIT 1;

  IF user_org_id IS NULL THEN
    RAISE EXCEPTION 'User organization not found';
  END IF;

  NEW.organization_id := user_org_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create task organization trigger
CREATE TRIGGER set_task_organization_id_trigger
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_task_organization_id();