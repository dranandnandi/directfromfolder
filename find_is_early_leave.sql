-- SQL Queries to Find References to 'is_early_leave' in the Database
-- Run these queries in your Supabase SQL Editor or PostgreSQL client

-- ============================================================================
-- 1. Check if column exists in attendance table
-- ============================================================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'attendance'
  AND column_name LIKE '%early%';

-- ============================================================================
-- 2. Search for 'is_early_leave' in all function definitions
-- ============================================================================
SELECT 
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE pg_get_functiondef(p.oid) ILIKE '%is_early_leave%'
  AND n.nspname = 'public';

-- ============================================================================
-- 3. Search for 'is_early_leave' in all view definitions
-- ============================================================================
SELECT 
    schemaname,
    viewname,
    definition
FROM pg_views
WHERE definition ILIKE '%is_early_leave%'
  AND schemaname = 'public';

-- ============================================================================
-- 4. Search for 'is_early_leave' in all trigger definitions
-- ============================================================================
SELECT 
    t.tgname AS trigger_name,
    c.relname AS table_name,
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS trigger_function_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE pg_get_functiondef(p.oid) ILIKE '%is_early_leave%'
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ============================================================================
-- 5. Search in all stored procedures and functions (comprehensive)
-- ============================================================================
SELECT 
    routine_schema,
    routine_name,
    routine_type,
    routine_definition
FROM information_schema.routines
WHERE routine_definition ILIKE '%is_early_leave%'
  AND routine_schema = 'public';

-- ============================================================================
-- 6. Check all columns in attendance table
-- ============================================================================
SELECT 
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'attendance'
ORDER BY ordinal_position;

-- ============================================================================
-- 7. Search for any text containing 'early_leave' in database objects
-- ============================================================================
SELECT 
    'Function' AS object_type,
    p.proname AS object_name,
    pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE pg_get_functiondef(p.oid) ILIKE '%early_leave%'
  AND n.nspname = 'public'

UNION ALL

SELECT 
    'View' AS object_type,
    viewname AS object_name,
    definition
FROM pg_views
WHERE definition ILIKE '%early_leave%'
  AND schemaname = 'public'

UNION ALL

SELECT 
    'Trigger Function' AS object_type,
    p.proname AS object_name,
    pg_get_functiondef(p.oid) AS definition
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE pg_get_functiondef(p.oid) ILIKE '%early_leave%'
  AND n.nspname = 'public';

-- ============================================================================
-- 8. List all triggers on the attendance table
-- ============================================================================
SELECT 
    t.tgname AS trigger_name,
    t.tgenabled AS is_enabled,
    p.proname AS function_name,
    CASE t.tgtype::integer & 66
        WHEN 2 THEN 'BEFORE'
        WHEN 64 THEN 'INSTEAD OF'
        ELSE 'AFTER'
    END AS trigger_timing,
    CASE t.tgtype::integer & 28
        WHEN 4 THEN 'INSERT'
        WHEN 8 THEN 'DELETE'
        WHEN 16 THEN 'UPDATE'
        WHEN 12 THEN 'INSERT OR DELETE'
        WHEN 20 THEN 'INSERT OR UPDATE'
        WHEN 24 THEN 'DELETE OR UPDATE'
        WHEN 28 THEN 'INSERT OR DELETE OR UPDATE'
    END AS trigger_event
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'attendance'
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY t.tgname;

-- ============================================================================
-- 9. Get the definition of the calculate_attendance_hours trigger function
-- ============================================================================
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'calculate_attendance_hours';

-- ============================================================================
-- 10. Get the definition of the check_late_arrival trigger function
-- ============================================================================
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'check_late_arrival';
