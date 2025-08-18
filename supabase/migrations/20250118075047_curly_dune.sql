-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view members of their organization" ON users;
DROP POLICY IF EXISTS "Admins can manage users in their organization" ON users;
DROP POLICY IF EXISTS "Users can insert tasks for their organization" ON tasks;
DROP POLICY IF EXISTS "Users can view tasks from their organization" ON tasks;
DROP POLICY IF EXISTS "Users can update tasks from their organization" ON tasks;

-- Create simplified user policies that avoid recursion
CREATE POLICY "Allow users to view their own record"
  ON users FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

CREATE POLICY "Allow users to view organization members"
  ON users FOR SELECT
  TO authenticated
  USING (
    organization_id = (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid() 
      LIMIT 1
    )
  );

CREATE POLICY "Allow admins to manage organization users"
  ON users FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM users 
      WHERE auth_id = auth.uid() 
      AND role IN ('admin', 'superadmin')
      AND organization_id = users.organization_id
    )
  );

-- Create task policies
CREATE POLICY "Allow users to insert tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid() 
      LIMIT 1
    )
  );

CREATE POLICY "Allow users to view organization tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    organization_id = (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid() 
      LIMIT 1
    )
  );

CREATE POLICY "Allow users to update organization tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    organization_id = (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid() 
      LIMIT 1
    )
  )
  WITH CHECK (
    organization_id = (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid() 
      LIMIT 1
    )
  );

-- Recreate the task organization trigger with improved error handling
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
$$ language plpgsql security definer;

DROP TRIGGER IF EXISTS set_task_organization_id_trigger ON tasks;
CREATE TRIGGER set_task_organization_id_trigger
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_task_organization_id();