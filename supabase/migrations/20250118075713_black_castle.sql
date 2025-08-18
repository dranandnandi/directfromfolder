-- First, drop all existing policies and triggers
DROP TRIGGER IF EXISTS set_task_organization_id_trigger ON tasks;
DROP TRIGGER IF EXISTS refresh_user_org_mapping_trigger ON users;

-- Drop existing policies
DROP POLICY IF EXISTS "allow_read_own_record" ON users;
DROP POLICY IF EXISTS "allow_read_org_users" ON users;
DROP POLICY IF EXISTS "allow_admin_create" ON users;
DROP POLICY IF EXISTS "allow_admin_update" ON users;
DROP POLICY IF EXISTS "allow_admin_delete" ON users;
DROP POLICY IF EXISTS "allow_task_insert" ON tasks;
DROP POLICY IF EXISTS "allow_task_select" ON tasks;
DROP POLICY IF EXISTS "allow_task_update" ON tasks;

-- Drop existing functions and views
DROP FUNCTION IF EXISTS get_user_org_id() CASCADE;
DROP FUNCTION IF EXISTS set_task_organization_id() CASCADE;
DROP FUNCTION IF EXISTS refresh_user_org_mapping() CASCADE;
DROP MATERIALIZED VIEW IF EXISTS user_org_mapping;

-- Create a materialized view for user-organization mapping
CREATE MATERIALIZED VIEW user_org_mapping AS
SELECT DISTINCT 
  u.auth_id,
  u.organization_id,
  u.role,
  u.id as user_id
FROM users u;

-- Create indexes for better performance
CREATE UNIQUE INDEX user_org_mapping_auth_id_idx ON user_org_mapping(auth_id);
CREATE INDEX user_org_mapping_org_id_idx ON user_org_mapping(organization_id);

-- Create refresh function for the materialized view
CREATE OR REPLACE FUNCTION refresh_user_org_mapping()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_org_mapping;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to refresh the materialized view
CREATE TRIGGER refresh_user_org_mapping_trigger
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_user_org_mapping();

-- Create basic policies for users table
CREATE POLICY "allow_read_own_record"
  ON users FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

CREATE POLICY "allow_read_org_users"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.organization_id = users.organization_id
    )
  );

-- Create admin policies with proper table references
CREATE POLICY "allow_admin_create"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.role IN ('admin', 'superadmin')
      AND m.organization_id = organization_id
    )
  );

CREATE POLICY "allow_admin_update"
  ON users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.role IN ('admin', 'superadmin')
      AND m.organization_id = users.organization_id
    )
  );

CREATE POLICY "allow_admin_delete"
  ON users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.role IN ('admin', 'superadmin')
      AND m.organization_id = users.organization_id
      AND users.auth_id != auth.uid()
    )
  );

-- Create function to get user's organization ID
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id
  FROM user_org_mapping
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

-- Create policies for tasks table
CREATE POLICY "allow_task_insert"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.organization_id = organization_id
    )
  );

CREATE POLICY "allow_task_select"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.organization_id = tasks.organization_id
    )
  );

CREATE POLICY "allow_task_update"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.organization_id = tasks.organization_id
    )
  );

-- Create task organization trigger function
CREATE OR REPLACE FUNCTION set_task_organization_id()
RETURNS TRIGGER AS $$
DECLARE
  org_id uuid;
BEGIN
  SELECT organization_id INTO org_id
  FROM user_org_mapping
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

-- Initial population of the materialized view
REFRESH MATERIALIZED VIEW user_org_mapping;