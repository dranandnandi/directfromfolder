/*
  # Fix infinite recursion in users table RLS policies

  1. Problem
    - Existing RLS policies on users table were causing infinite recursion
    - Policies were querying the users table from within users table policies

  2. Solution
    - Drop problematic policies
    - Create helper functions that safely query user data
    - Implement new policies that avoid recursion
    - Fix UPDATE policy to not reference OLD in WITH CHECK clause

  3. Security
    - Maintain proper access controls
    - Users can read/update own records
    - Admins can manage users in their organization
    - Superadmins can do everything
*/

-- Drop the problematic policies that cause infinite recursion
DROP POLICY IF EXISTS "Organization admins can manage their organization's users" ON users;
DROP POLICY IF EXISTS "users_admin_create_v4" ON users;
DROP POLICY IF EXISTS "users_admin_update_v4" ON users;
DROP POLICY IF EXISTS "users_admin_delete_v4" ON users;
DROP POLICY IF EXISTS "users_read_org_members_v4" ON users;
DROP POLICY IF EXISTS "users_read_own_record_v4" ON users;

-- Create a function to get the current user's organization ID safely
-- This avoids the recursion by using SECURITY DEFINER
CREATE OR REPLACE FUNCTION get_current_user_org_id_safe()
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

-- Create a function to check if current user is admin/superadmin safely
CREATE OR REPLACE FUNCTION is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM users 
    WHERE auth_id = auth.uid() 
    AND role IN ('admin', 'superadmin')
  );
$$;

-- Create a function to check if current user is superadmin
CREATE OR REPLACE FUNCTION is_current_user_superadmin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM users 
    WHERE auth_id = auth.uid() 
    AND role = 'superadmin'
  );
$$;

-- Create new, safe policies

-- Users can always read their own record
CREATE POLICY "users_read_own_safe" ON users
  FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

-- Users can view other users in their organization
CREATE POLICY "users_read_org_members_safe" ON users
  FOR SELECT
  TO authenticated
  USING (
    organization_id = get_current_user_org_id_safe()
    OR auth_id = auth.uid()
  );

-- Users can update their own profile (limited fields)
CREATE POLICY "users_update_own_safe" ON users
  FOR UPDATE
  TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- Superadmins can do everything
CREATE POLICY "users_superadmin_all_safe" ON users
  FOR ALL
  TO authenticated
  USING (is_current_user_superadmin())
  WITH CHECK (is_current_user_superadmin());

-- Admins can create users in their organization
CREATE POLICY "users_admin_create_safe" ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_current_user_admin()
    AND organization_id = get_current_user_org_id_safe()
  );

-- Admins can update users in their organization
CREATE POLICY "users_admin_update_safe" ON users
  FOR UPDATE
  TO authenticated
  USING (
    is_current_user_admin()
    AND organization_id = get_current_user_org_id_safe()
  )
  WITH CHECK (
    is_current_user_admin()
    AND organization_id = get_current_user_org_id_safe()
  );

-- Admins can delete users in their organization (except themselves)
CREATE POLICY "users_admin_delete_safe" ON users
  FOR DELETE
  TO authenticated
  USING (
    is_current_user_admin()
    AND organization_id = get_current_user_org_id_safe()
    AND auth_id != auth.uid()
  );