-- ============================================================================
-- QUICK FIX: Find the trigger function with 'is_early_leave' on attendance table
-- ============================================================================

-- Step 1: List all triggers on the attendance table and their functions
SELECT 
    t.tgname AS trigger_name,
    p.proname AS function_name,
    t.tgenabled AS is_enabled
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'attendance'
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY t.tgname;

-- Step 2: Get the FULL definition of calculate_attendance_hours function
-- (This is the most likely culprit based on the error)
SELECT pg_get_functiondef(oid) AS function_definition
FROM pg_proc
WHERE proname = 'calculate_attendance_hours';

-- Step 3: Get the FULL definition of check_late_arrival function
SELECT pg_get_functiondef(oid) AS function_definition
FROM pg_proc
WHERE proname = 'check_late_arrival';

-- Step 4: Search ALL functions for 'is_early_leave' (simple version)
SELECT 
    p.proname AS function_name,
    n.nspname AS schema_name
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE pg_get_functiondef(p.oid) ILIKE '%is_early_leave%'
  AND n.nspname = 'public';

-- Step 5: If you find the function name above, get its full definition
-- Replace 'FUNCTION_NAME_HERE' with the actual function name from Step 4
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'FUNCTION_NAME_HERE';
