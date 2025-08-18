/*
  # Fix Tasks Table RLS Configuration

  1. Security Changes
    - Enable RLS on tasks table (currently disabled but has policies)
    - Clean up duplicate/conflicting policies
    - Ensure consistent policy structure

  2. Policy Updates
    - Remove old conflicting policies
    - Keep the v4 policies which are more comprehensive
    - Ensure proper organization-based access control

  This fixes the "HTTP request cancelled" error by resolving RLS policy conflicts.
*/

-- Enable RLS on tasks table (it was disabled but had policies)
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Drop the old conflicting policies that might be causing issues
DROP POLICY IF EXISTS "Users can create tasks in their organization" ON tasks;
DROP POLICY IF EXISTS "Users can update tasks they created or are assigned to" ON tasks;
DROP POLICY IF EXISTS "Users can view their organization's tasks" ON tasks;

-- The v4 policies should remain as they are more comprehensive:
-- - tasks_insert_v4: Uses get_user_org_id() function
-- - tasks_select_v4: Uses get_user_org_id() function  
-- - tasks_update_v4: Uses get_user_org_id() function
-- - tasks_admin_delete_v4: Admin-only delete with organization check

-- Ensure the helper function exists for organization-based access
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT organization_id 
  FROM users 
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

-- Ensure the current user ID function exists
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT id 
  FROM users 
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;