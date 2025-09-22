-- Add clinic support to the task manager system
-- This migration adds clinics table and updates users table to support clinic_id

-- Create clinics table
CREATE TABLE IF NOT EXISTS clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  phone text,
  email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add clinic_id to users table
ALTER TABLE users 
ADD COLUMN clinic_id uuid REFERENCES clinics(id);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS users_clinic_id_idx ON users(clinic_id);
CREATE INDEX IF NOT EXISTS clinics_organization_id_idx ON clinics(organization_id);

-- Insert default clinic for existing organizations
INSERT INTO clinics (organization_id, name, address)
SELECT 
  id,
  name || ' - Main Clinic',
  'Default clinic location'
FROM organizations
WHERE id NOT IN (SELECT organization_id FROM clinics WHERE organization_id IS NOT NULL);

-- Update existing users to belong to their organization's default clinic
UPDATE users 
SET clinic_id = (
  SELECT c.id 
  FROM clinics c 
  WHERE c.organization_id = users.organization_id 
  LIMIT 1
)
WHERE clinic_id IS NULL AND organization_id IS NOT NULL;

-- Add constraint to ensure users have clinic_id
-- (We'll make this optional for now to avoid breaking existing data)
-- ALTER TABLE users ALTER COLUMN clinic_id SET NOT NULL;

-- Add RLS policies for clinics
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see clinics from their organization
CREATE POLICY "Users can view clinics from their organization" ON clinics
FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM users WHERE auth_id = auth.uid()
  )
);

-- Policy: Only admins can insert/update clinics
CREATE POLICY "Admins can manage clinics" ON clinics
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM users 
    WHERE auth_id = auth.uid() 
    AND role IN ('admin', 'superadmin')
    AND organization_id = clinics.organization_id
  )
);
