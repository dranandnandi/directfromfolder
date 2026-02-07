-- Verification Script for Database Fixes
-- Run these queries to confirm all fixes are applied

-- ==============================================
-- 1. CHECK: attendance_status column exists in view
-- ==============================================
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'attendance_dashboard_view' 
  AND column_name = 'attendance_status';
-- Expected: 1 row with column_name='attendance_status'

-- Test the view with actual data
SELECT 
  user_name, 
  date, 
  attendance_status, 
  punch_in_time, 
  punch_out_time,
  is_absent,
  is_holiday,
  is_weekend
FROM attendance_dashboard_view 
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC, user_name
LIMIT 20;
-- Expected: Should show attendance_status values (present/absent/holiday/weekend)

-- ==============================================
-- 2. CHECK: process_failed_whatsapp_notifications function exists
-- ==============================================
SELECT 
  proname as function_name,
  pg_get_functiondef(oid) as function_definition
FROM pg_proc 
WHERE proname = 'process_failed_whatsapp_notifications';
-- Expected: 1 row with function details

-- Test the function (won't affect data if no failed notifications)
SELECT process_failed_whatsapp_notifications();
-- Expected: Should run without errors

-- ==============================================
-- 3. CHECK: device_tokens has CASCADE DELETE constraint
-- ==============================================
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name = 'device_tokens' 
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'user_id';
-- Expected: delete_rule should be 'CASCADE'

-- Check for orphaned device tokens (should be 0)
SELECT COUNT(*) as orphaned_tokens
FROM device_tokens dt
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.id = dt.user_id
);
-- Expected: 0 orphaned tokens

-- ==============================================
-- 4. CHECK: All columns in attendance_dashboard_view
-- ==============================================
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'attendance_dashboard_view'
ORDER BY ordinal_position;
-- Expected: Should include all columns including attendance_status

-- ==============================================
-- 5. SUMMARY: Count recent errors in logs
-- ==============================================
-- Note: This requires access to Supabase Dashboard > Logs
-- Look for these specific errors (should be gone after fixes):
-- - "column adv.attendance_status does not exist" ❌ FIXED
-- - "function process_failed_whatsapp_notifications() does not exist" ❌ FIXED  
-- - "device_tokens violates foreign key constraint" ❌ FIXED
