-- SAFE migration: Add auth_id column without affecting existing users
-- This is 100% backward compatible

-- Add the auth_id column as nullable (safe for existing users)
ALTER TABLE users ADD COLUMN auth_id uuid REFERENCES auth.users(id);

-- Create index for performance (only affects new lookups)
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);

-- Create admin roles table for permission management
CREATE TABLE IF NOT EXISTS admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  role text CHECK (role IN ('admin', 'super_admin', 'org_admin')) NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

-- Create indexes for admin roles
CREATE INDEX IF NOT EXISTS idx_admin_roles_user_id ON admin_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_roles_org_id ON admin_roles(organization_id);

-- Function to check if user has admin access to organization
CREATE OR REPLACE FUNCTION has_admin_access(user_auth_id uuid, org_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM users u 
    JOIN admin_roles ar ON u.id = ar.user_id 
    WHERE u.auth_id = user_auth_id 
    AND ar.organization_id = org_id 
    AND ar.role IN ('admin', 'super_admin', 'org_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's admin organizations
CREATE OR REPLACE FUNCTION get_user_admin_orgs(user_auth_id uuid)
RETURNS TABLE(
  organization_id uuid,
  organization_name text,
  role text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    o.name,
    ar.role
  FROM users u
  JOIN admin_roles ar ON u.id = ar.user_id
  JOIN organizations o ON ar.organization_id = o.id
  WHERE u.auth_id = user_auth_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
