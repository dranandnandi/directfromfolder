-- Fix RLS Policy for Shifts Table
-- Drop existing policy and create a more permissive one

DROP POLICY IF EXISTS "shifts_organization_access" ON shifts;

-- Create more permissive policy for shifts
CREATE POLICY "shifts_organization_access"
  ON shifts FOR ALL
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

-- Also create a simpler test policy temporarily (can be removed later)
CREATE POLICY "shifts_admin_access"
  ON shifts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE auth_id = auth.uid() 
      AND role IN ('admin', 'superadmin')
      AND organization_id = shifts.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE auth_id = auth.uid() 
      AND role IN ('admin', 'superadmin')
      AND organization_id = shifts.organization_id
    )
  );
