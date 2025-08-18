-- First, drop all existing policies to start fresh
DROP POLICY IF EXISTS "Allow users to view their own record" ON users;
DROP POLICY IF EXISTS "Allow users to view organization members" ON users;
DROP POLICY IF EXISTS "Allow admins to manage organization users" ON users;
DROP POLICY IF EXISTS "Allow users to insert tasks" ON tasks;
DROP POLICY IF EXISTS "Allow users to view organization tasks" ON tasks;
DROP POLICY IF EXISTS "Allow users to update organization tasks" ON tasks;

-- Create a basic policy for users to view their own record
CREATE POLICY "users_read_own"
  ON users FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

-- Create a basic policy for users to view their organization's records
CREATE POLICY "users_read_org"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users u
      WHERE u.auth_id = auth.uid()
      AND u.organization_id = users.organization_id
    )
  );

-- Create a basic policy for admins to manage users
CREATE POLICY "admins_manage_users"
  ON users FOR ALL
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

-- Create basic policies for tasks
CREATE POLICY "tasks_insert"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM users u
      WHERE u.auth_id = auth.uid()
      AND u.organization_id = tasks.organization_id
    )
  );

CREATE POLICY "tasks_select"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users u
      WHERE u.auth_id = auth.uid()
      AND u.organization_id = tasks.organization_id
    )
  );

CREATE POLICY "tasks_update"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users u
      WHERE u.auth_id = auth.uid()
      AND u.organization_id = tasks.organization_id
    )
  );

-- Create a function to get the user's organization ID
CREATE OR REPLACE FUNCTION get_auth_user_org_id()
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

-- Update the task organization trigger
CREATE OR REPLACE FUNCTION set_task_organization_id()
RETURNS TRIGGER AS $$
DECLARE
  user_org_id uuid;
BEGIN
  user_org_id := get_auth_user_org_id();
  IF user_org_id IS NULL THEN
    RAISE EXCEPTION 'User organization not found';
  END IF;

  NEW.organization_id := user_org_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
DROP TRIGGER IF EXISTS set_task_organization_id_trigger ON tasks;
CREATE TRIGGER set_task_organization_id_trigger
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_task_organization_id();