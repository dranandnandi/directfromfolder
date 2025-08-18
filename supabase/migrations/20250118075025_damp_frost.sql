-- Add RLS policies for tasks table
CREATE POLICY "Users can insert tasks for their organization"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid()
    )
  );

CREATE POLICY "Users can view tasks from their organization"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tasks from their organization"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid()
    )
  );

-- Add a trigger to automatically set organization_id on task insert
CREATE OR REPLACE FUNCTION set_task_organization_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := (
      SELECT organization_id
      FROM users
      WHERE auth_id = auth.uid()
      LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$ language plpgsql security definer;

DROP TRIGGER IF EXISTS set_task_organization_id_trigger ON tasks;
CREATE TRIGGER set_task_organization_id_trigger
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_task_organization_id();