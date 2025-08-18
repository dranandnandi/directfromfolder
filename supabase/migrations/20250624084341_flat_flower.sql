/*
  # Fix RLS Infinite Recursion Issue

  1. Problem
    - Infinite recursion detected in policy for relation "users"
    - Policies are creating circular dependencies when querying users table

  2. Solution
    - Drop all existing problematic policies
    - Create helper functions with SECURITY DEFINER to bypass RLS
    - Create new, simple policies that don't cause recursion

  3. Security
    - Maintain proper access control while avoiding recursion
    - Use helper functions to safely query user data
*/

-- Drop ALL existing policies on users table to start fresh
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'users' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON users', policy_record.policyname);
    END LOOP;
END $$;

-- Drop ALL existing policies on organizations table to start fresh
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'organizations' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON organizations', policy_record.policyname);
    END LOOP;
END $$;

-- Drop existing helper functions if they exist
DROP FUNCTION IF EXISTS get_current_user_org_id_safe();
DROP FUNCTION IF EXISTS get_current_user_id_safe();
DROP FUNCTION IF EXISTS is_current_user_admin_safe();
DROP FUNCTION IF EXISTS is_current_user_superadmin_safe();

-- Create helper functions that bypass RLS to avoid recursion
CREATE OR REPLACE FUNCTION get_current_user_org_id_safe()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id 
  FROM users 
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_current_user_id_safe()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id 
  FROM users 
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_current_user_admin_safe()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(role IN ('admin', 'superadmin'), false)
  FROM users 
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_current_user_superadmin_safe()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(role = 'superadmin', false)
  FROM users 
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

-- Create new, simple policies for users table that don't cause recursion

-- Users can read their own record
CREATE POLICY "users_read_own_safe" 
  ON users FOR SELECT 
  TO authenticated 
  USING (auth_id = auth.uid());

-- Users can read other users in their organization
CREATE POLICY "users_read_org_members_safe" 
  ON users FOR SELECT 
  TO authenticated 
  USING (organization_id = get_current_user_org_id_safe());

-- Users can update their own profile
CREATE POLICY "users_update_own_safe" 
  ON users FOR UPDATE 
  TO authenticated 
  USING (auth_id = auth.uid()) 
  WITH CHECK (auth_id = auth.uid());

-- Admins can create users in their organization
CREATE POLICY "users_admin_create_safe" 
  ON users FOR INSERT 
  TO authenticated 
  WITH CHECK (
    is_current_user_admin_safe() 
    AND organization_id = get_current_user_org_id_safe()
  );

-- Admins can update users in their organization
CREATE POLICY "users_admin_update_safe" 
  ON users FOR UPDATE 
  TO authenticated 
  USING (
    is_current_user_admin_safe() 
    AND organization_id = get_current_user_org_id_safe()
  ) 
  WITH CHECK (
    is_current_user_admin_safe() 
    AND organization_id = get_current_user_org_id_safe()
  );

-- Admins can delete users in their organization (except themselves)
CREATE POLICY "users_admin_delete_safe" 
  ON users FOR DELETE 
  TO authenticated 
  USING (
    is_current_user_admin_safe() 
    AND organization_id = get_current_user_org_id_safe() 
    AND auth_id != auth.uid()
  );

-- Superadmins can do everything
CREATE POLICY "users_superadmin_all_safe" 
  ON users FOR ALL 
  TO authenticated 
  USING (is_current_user_superadmin_safe()) 
  WITH CHECK (is_current_user_superadmin_safe());

-- Create new policies for organizations table

-- Users can read their own organization
CREATE POLICY "organizations_read_own_safe" 
  ON organizations FOR SELECT 
  TO authenticated 
  USING (id = get_current_user_org_id_safe());

-- Admins can update their organization
CREATE POLICY "organizations_admin_update_safe" 
  ON organizations FOR UPDATE 
  TO authenticated 
  USING (
    is_current_user_admin_safe() 
    AND id = get_current_user_org_id_safe()
  );

-- Superadmins can do everything with organizations
CREATE POLICY "organizations_superadmin_all_safe" 
  ON organizations FOR ALL 
  TO authenticated 
  USING (is_current_user_superadmin_safe()) 
  WITH CHECK (is_current_user_superadmin_safe());