/*
  # Create Initial Admin User and Organization

  1. Creates the initial admin organization
  2. Creates an admin user in auth.users
  3. Creates the corresponding user record in users table with proper role value
  4. Sets up proper role and permissions
*/

-- Create initial admin user and organization
DO $$
DECLARE
  _auth_user_id uuid;
  _org_id uuid;
BEGIN
  -- Create organization if it doesn't exist
  INSERT INTO organizations (
    id,
    name,
    advisory_types,
    round_types,
    follow_up_types,
    departments
  )
  VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Admin Organization',
    ARRAY['Medication', 'Diet', 'Lifestyle', 'Emergency'],
    ARRAY['Morning Round', 'Evening Round', 'Emergency Round'],
    ARRAY['Post Surgery', 'Treatment Progress', 'Test Results', 'General Check-up'],
    ARRAY['Management', 'Medical', 'Nursing']
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO _org_id;

  -- Create admin user if it doesn't exist
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'admin@example.com',
    crypt('admin123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO _auth_user_id;

  -- Create user record with all required fields
  INSERT INTO users (
    id,
    auth_id,
    organization_id,
    name,
    email,
    whatsapp_number,
    role,
    department,
    created_at,
    updated_at
  )
  VALUES (
    '00000000-0000-0000-0000-000000000003',
    _auth_user_id,
    _org_id,
    'Admin User',
    'admin@example.com',
    '+919876543001',
    'superadmin', -- Changed from 'admin' to 'superadmin' to match the check constraint
    'Management',
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

END $$;