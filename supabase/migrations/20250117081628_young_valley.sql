-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  advisory_types text[] DEFAULT ARRAY['Medication', 'Diet', 'Lifestyle', 'Emergency']::text[],
  round_types text[] DEFAULT ARRAY['Morning Round', 'Evening Round', 'Emergency Round']::text[],
  follow_up_types text[] DEFAULT ARRAY['Post Surgery', 'Treatment Progress', 'Test Results', 'General Check-up']::text[],
  departments text[] DEFAULT ARRAY['Management', 'Medical', 'Nursing']::text[],
  max_users integer DEFAULT 10,
  current_users integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES organizations(id),
  name text NOT NULL,
  whatsapp_number text UNIQUE NOT NULL CHECK (whatsapp_number ~ '^\+\d{1,3}\d{6,14}$'),
  role text NOT NULL CHECK (role IN ('superadmin', 'admin', 'user')),
  department text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_auth_id UNIQUE (auth_id)
);

-- Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  type text NOT NULL CHECK (type IN ('quickAdvisory', 'clinicalRound', 'followUp')),
  title text NOT NULL,
  description text NOT NULL,
  patient_id text,
  priority text NOT NULL CHECK (priority IN ('critical', 'moderate', 'lessImportant')),
  status text NOT NULL CHECK (status IN ('new', 'pending', 'inProgress', 'completed', 'overdue')),
  created_by uuid REFERENCES users(id),
  assigned_to uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  due_date timestamptz,
  completed_at timestamptz,
  location text,
  round_type text DEFAULT NULL,
  follow_up_type text DEFAULT NULL,
  advisory_type text DEFAULT NULL,
  contact_number text,
  hours_to_complete integer
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_organization ON tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

-- Enable Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies and Functions (updated as per fixes)
-- ... (rest of the RLS policies and functions remain the same with the fixes applied)