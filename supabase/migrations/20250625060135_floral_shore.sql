/*
  # Fix RLS policies and helper functions

  1. Helper Functions
    - Create or replace missing helper functions for RLS policies
    - `get_user_org_id()` - Gets the organization ID for the current user
    - `get_current_user_id()` - Gets the current user's ID from the users table
    - `get_current_user_org_id_safe()` - Safe version that handles errors
    - `is_current_user_admin_safe()` - Checks if current user is admin
    - `is_current_user_superadmin_safe()` - Checks if current user is superadmin

  2. Updated RLS Policies
    - Fix tasks table policies to use proper helper functions
    - Ensure all policies handle edge cases properly
    - Add proper error handling

  3. Security
    - All functions are marked as SECURITY DEFINER where needed
    - Proper error handling to prevent policy failures
*/

-- Helper function to get current user's organization ID
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  org_id uuid;
BEGIN
  SELECT organization_id INTO org_id
  FROM users
  WHERE auth_id = auth.uid();
  
  RETURN org_id;
END;
$$;

-- Helper function to get current user's ID from users table
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_id uuid;
BEGIN
  SELECT id INTO user_id
  FROM users
  WHERE auth_id = auth.uid();
  
  RETURN user_id;
END;
$$;

-- Safe version of get_current_user_org_id that handles errors
CREATE OR REPLACE FUNCTION get_current_user_org_id_safe()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  org_id uuid;
BEGIN
  BEGIN
    SELECT organization_id INTO org_id
    FROM users
    WHERE auth_id = auth.uid();
    
    RETURN COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid);
  EXCEPTION WHEN OTHERS THEN
    RETURN '00000000-0000-0000-0000-000000000000'::uuid;
  END;
END;
$$;

-- Safe function to check if current user is admin
CREATE OR REPLACE FUNCTION is_current_user_admin_safe()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_role text;
BEGIN
  BEGIN
    SELECT role INTO user_role
    FROM users
    WHERE auth_id = auth.uid();
    
    RETURN COALESCE(user_role IN ('admin', 'superadmin'), false);
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
END;
$$;

-- Safe function to check if current user is superadmin
CREATE OR REPLACE FUNCTION is_current_user_superadmin_safe()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_role text;
BEGIN
  BEGIN
    SELECT role INTO user_role
    FROM users
    WHERE auth_id = auth.uid();
    
    RETURN COALESCE(user_role = 'superadmin', false);
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
END;
$$;

-- Drop existing policies for tasks table
DROP POLICY IF EXISTS "tasks_select_v4" ON tasks;
DROP POLICY IF EXISTS "tasks_insert_v4" ON tasks;
DROP POLICY IF EXISTS "tasks_update_v4" ON tasks;
DROP POLICY IF EXISTS "tasks_admin_delete_v4" ON tasks;

-- Create new, more robust policies for tasks table
CREATE POLICY "tasks_select_v5"
  ON tasks
  FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id()
    OR organization_id = get_current_user_org_id_safe()
  );

CREATE POLICY "tasks_insert_v5"
  ON tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = get_user_org_id()
    OR organization_id = get_current_user_org_id_safe()
  );

CREATE POLICY "tasks_update_v5"
  ON tasks
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = get_user_org_id()
    OR organization_id = get_current_user_org_id_safe()
  )
  WITH CHECK (
    organization_id = get_user_org_id()
    OR organization_id = get_current_user_org_id_safe()
  );

CREATE POLICY "tasks_delete_v5"
  ON tasks
  FOR DELETE
  TO authenticated
  USING (
    (organization_id = get_user_org_id() AND is_current_user_admin_safe())
    OR (organization_id = get_current_user_org_id_safe() AND is_current_user_admin_safe())
    OR is_current_user_superadmin_safe()
  );

-- Update recurring task templates policies
DROP POLICY IF EXISTS "recurring_templates_select_v4" ON recurring_task_templates;
DROP POLICY IF EXISTS "recurring_templates_insert_v4" ON recurring_task_templates;
DROP POLICY IF EXISTS "recurring_templates_update_v4" ON recurring_task_templates;
DROP POLICY IF EXISTS "recurring_templates_delete_v4" ON recurring_task_templates;

CREATE POLICY "recurring_templates_select_v5"
  ON recurring_task_templates
  FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id()
    OR organization_id = get_current_user_org_id_safe()
  );

CREATE POLICY "recurring_templates_insert_v5"
  ON recurring_task_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = get_user_org_id()
    OR organization_id = get_current_user_org_id_safe()
  );

CREATE POLICY "recurring_templates_update_v5"
  ON recurring_task_templates
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = get_user_org_id()
    OR organization_id = get_current_user_org_id_safe()
  )
  WITH CHECK (
    organization_id = get_user_org_id()
    OR organization_id = get_current_user_org_id_safe()
  );

CREATE POLICY "recurring_templates_delete_v5"
  ON recurring_task_templates
  FOR DELETE
  TO authenticated
  USING (
    (organization_id = get_user_org_id() AND is_current_user_admin_safe())
    OR (organization_id = get_current_user_org_id_safe() AND is_current_user_admin_safe())
    OR is_current_user_superadmin_safe()
  );

-- Fix the set_task_organization_id function to handle errors better
CREATE OR REPLACE FUNCTION set_task_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only set organization_id if it's not already set
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := get_user_org_id();
    
    -- If we still don't have an organization_id, try the safe version
    IF NEW.organization_id IS NULL THEN
      NEW.organization_id := get_current_user_org_id_safe();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Ensure the trigger exists
DROP TRIGGER IF EXISTS set_task_organization_id_trigger ON tasks;
CREATE TRIGGER set_task_organization_id_trigger
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_task_organization_id();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION get_user_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_user_org_id_safe() TO authenticated;
GRANT EXECUTE ON FUNCTION is_current_user_admin_safe() TO authenticated;
GRANT EXECUTE ON FUNCTION is_current_user_superadmin_safe() TO authenticated;
GRANT EXECUTE ON FUNCTION set_task_organization_id() TO authenticated;