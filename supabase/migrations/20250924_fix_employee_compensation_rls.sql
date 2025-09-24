-- Enable RLS and add policies for employee_compensation table
-- This allows users to access compensation data based on organization membership

-- Enable RLS if not already enabled
ALTER TABLE employee_compensation ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view compensation data for employees in their organization
CREATE POLICY "Users can view compensation data for their organization" ON employee_compensation
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM users u1, users u2 
    WHERE u1.id = auth.uid() 
    AND u2.id = employee_compensation.user_id 
    AND u1.organization_id = u2.organization_id
  )
);

-- Policy: Users can insert compensation data for employees in their organization
CREATE POLICY "Users can insert compensation data for their organization" ON employee_compensation
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u1, users u2 
    WHERE u1.id = auth.uid() 
    AND u2.id = employee_compensation.user_id 
    AND u1.organization_id = u2.organization_id
  )
);

-- Policy: Users can update compensation data for employees in their organization
CREATE POLICY "Users can update compensation data for their organization" ON employee_compensation
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM users u1, users u2 
    WHERE u1.id = auth.uid() 
    AND u2.id = employee_compensation.user_id 
    AND u1.organization_id = u2.organization_id
  )
);

-- Policy: Users can delete compensation data for employees in their organization
CREATE POLICY "Users can delete compensation data for their organization" ON employee_compensation
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM users u1, users u2 
    WHERE u1.id = auth.uid() 
    AND u2.id = employee_compensation.user_id 
    AND u1.organization_id = u2.organization_id
  )
);