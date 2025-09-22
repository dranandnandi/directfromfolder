-- Function to get auth users that don't have business user records
CREATE OR REPLACE FUNCTION get_unused_auth_users()
RETURNS TABLE (
    id UUID,
    email TEXT,
    phone TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        au.id,
        au.email::TEXT,
        au.phone::TEXT
    FROM auth.users au
    LEFT JOIN public.users pu ON au.id = pu.auth_id
    WHERE pu.auth_id IS NULL
    AND au.email IS NOT NULL
    ORDER BY au.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
