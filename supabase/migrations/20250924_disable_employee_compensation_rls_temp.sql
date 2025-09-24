-- Temporary fix: Disable RLS on employee_compensation table for testing
-- WARNING: This removes security - only use for testing!

ALTER TABLE employee_compensation DISABLE ROW LEVEL SECURITY;