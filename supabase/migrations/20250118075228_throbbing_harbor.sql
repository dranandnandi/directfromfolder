-- First, drop triggers and then functions to handle dependencies properly
DROP TRIGGER IF EXISTS refresh_user_org_cache_trigger ON users;
DROP TRIGGER IF EXISTS set_task_organization_id_trigger ON tasks;

-- Drop existing policies
DROP POLICY IF EXISTS "users_read_own" ON users;
DROP POLICY IF EXISTS "users_read_org" ON users;
DROP POLICY IF EXISTS "admins_manage_users" ON users;
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
DROP POLICY IF EXISTS "tasks_select" ON tasks;
DROP POLICY IF EXISTS "tasks_update" ON tasks;

-- Drop functions with CASCADE to handle dependencies
DROP FUNCTION IF EXISTS get_auth_user_org_id() CASCADE;
DROP FUNCTION IF EXISTS set_task_organization_id() CASCADE;
DROP FUNCTION IF EXISTS refresh_user_org_cache() CASCADE;

-- Create a materialized view to cache user organization mappings
DROP MATERIALIZED VIEW IF EXISTS user_org_cache;
CREATE MATERIALIZED VIEW user_org_cache AS
SELECT DISTINCT auth_id, organization_id
FROM users;

CREATE UNIQUE INDEX user_org_cache_auth_id_idx ON user_org_cache(auth_id);

-- Create a function to refresh the cache
CREATE OR REPLACE FUNCTION refresh_user_org_cache()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_org_cache;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to refresh cache
CREATE TRIGGER refresh_user_org_cache_trigger
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_user_org_cache();

-- Simple policy for users to read their own record
CREATE POLICY "users_self_access"
  ON users FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

-- Simple policy for organization access using the cache
CREATE POLICY "users_org_access"
  ON users FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id
      FROM user_org_cache
      WHERE auth_id = auth.uid()
    )
  );

-- Admin policy using the cache
CREATE POLICY "admin_all_access"
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

-- Task policies using the cache
CREATE POLICY "task_insert"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM user_org_cache
      WHERE auth_id = auth.uid()
    )
  );

CREATE POLICY "task_select"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id
      FROM user_org_cache
      WHERE auth_id = auth.uid()
    )
  );

CREATE POLICY "task_update"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id
      FROM user_org_cache
      WHERE auth_id = auth.uid()
    )
  );

-- Function to get organization ID
CREATE OR REPLACE FUNCTION get_auth_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id
  FROM user_org_cache
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

-- Task organization trigger function
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

-- Create task organization trigger
CREATE TRIGGER set_task_organization_id_trigger
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_task_organization_id();

-- Initial cache population
REFRESH MATERIALIZED VIEW user_org_cache;