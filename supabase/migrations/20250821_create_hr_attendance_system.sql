-- HR Attendance System Tables
-- Phase 1 & 2 Implementation

-- 1. Shifts Table
CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  duration_hours integer NOT NULL CHECK (duration_hours IN (8, 9)),
  break_duration_minutes integer DEFAULT 60,
  late_threshold_minutes integer DEFAULT 15,
  early_out_threshold_minutes integer DEFAULT 15,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Employee Shifts Assignment
CREATE TABLE employee_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES shifts(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  effective_to date,
  assigned_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, effective_from)
);

-- 3. Attendance Records
CREATE TABLE attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  shift_id uuid REFERENCES shifts(id),
  
  -- Punch In Data
  punch_in_time timestamptz,
  punch_in_latitude decimal(10, 8),
  punch_in_longitude decimal(11, 8),
  punch_in_address text,
  punch_in_selfie_url text,
  punch_in_device_info jsonb,
  
  -- Punch Out Data  
  punch_out_time timestamptz,
  punch_out_latitude decimal(10, 8),
  punch_out_longitude decimal(11, 8),
  punch_out_address text,
  punch_out_selfie_url text,
  punch_out_device_info jsonb,
  
  -- Calculated Fields
  total_hours decimal(4, 2),
  break_hours decimal(4, 2) DEFAULT 1.0,
  effective_hours decimal(4, 2),
  
  -- Status Flags
  is_late boolean DEFAULT false,
  is_early_out boolean DEFAULT false,
  is_absent boolean DEFAULT false,
  is_holiday boolean DEFAULT false,
  is_weekend boolean DEFAULT false,
  
  -- Regularization
  is_regularized boolean DEFAULT false,
  regularized_by uuid REFERENCES users(id),
  regularization_reason text,
  regularized_at timestamptz,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(user_id, date)
);

-- 4. Attendance Regularizations
CREATE TABLE attendance_regularizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid REFERENCES attendance(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  reason text NOT NULL,
  admin_remarks text,
  status varchar(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create Indexes
CREATE INDEX idx_shifts_organization_id ON shifts(organization_id);
CREATE INDEX idx_employee_shifts_user_id ON employee_shifts(user_id);
CREATE INDEX idx_employee_shifts_effective_from ON employee_shifts(effective_from);
CREATE INDEX idx_attendance_user_date ON attendance(user_id, date);
CREATE INDEX idx_attendance_organization_date ON attendance(organization_id, date);
CREATE INDEX idx_attendance_regularizations_status ON attendance_regularizations(status);

-- Enable RLS
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_regularizations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Shifts
CREATE POLICY "shifts_organization_access"
  ON shifts FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid()
    )
  );

-- RLS Policies for Employee Shifts
CREATE POLICY "employee_shifts_access"
  ON employee_shifts FOR ALL
  TO authenticated
  USING (
    user_id IN (
      SELECT id FROM users 
      WHERE organization_id IN (
        SELECT organization_id 
        FROM users 
        WHERE auth_id = auth.uid()
      )
    )
  );

-- RLS Policies for Attendance
CREATE POLICY "attendance_organization_access"
  ON attendance FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid()
    )
  );

-- RLS Policies for Attendance Regularizations
CREATE POLICY "attendance_regularizations_access"
  ON attendance_regularizations FOR ALL
  TO authenticated
  USING (
    attendance_id IN (
      SELECT id FROM attendance 
      WHERE organization_id IN (
        SELECT organization_id 
        FROM users 
        WHERE auth_id = auth.uid()
      )
    )
  );

-- Function to calculate attendance hours
CREATE OR REPLACE FUNCTION calculate_attendance_hours()
RETURNS TRIGGER AS $$
BEGIN
  -- Only calculate if both punch in and punch out are present
  IF NEW.punch_in_time IS NOT NULL AND NEW.punch_out_time IS NOT NULL THEN
    -- Calculate total hours
    NEW.total_hours = EXTRACT(EPOCH FROM (NEW.punch_out_time - NEW.punch_in_time)) / 3600;
    
    -- Calculate effective hours (total - break)
    NEW.effective_hours = NEW.total_hours - COALESCE(NEW.break_hours, 1.0);
    
    -- Check for early out based on shift
    IF NEW.shift_id IS NOT NULL THEN
      -- Get shift end time and check early out
      WITH shift_info AS (
        SELECT end_time, early_out_threshold_minutes
        FROM shifts 
        WHERE id = NEW.shift_id
      )
      SELECT 
        CASE 
          WHEN NEW.punch_out_time::time < (si.end_time - INTERVAL '1 minute' * si.early_out_threshold_minutes)
          THEN true 
          ELSE false 
        END
      INTO NEW.is_early_out
      FROM shift_info si;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to check late arrival
CREATE OR REPLACE FUNCTION check_late_arrival()
RETURNS TRIGGER AS $$
BEGIN
  -- Check for late arrival based on shift
  IF NEW.punch_in_time IS NOT NULL AND NEW.shift_id IS NOT NULL THEN
    WITH shift_info AS (
      SELECT start_time, late_threshold_minutes
      FROM shifts 
      WHERE id = NEW.shift_id
    )
    SELECT 
      CASE 
        WHEN NEW.punch_in_time::time > (si.start_time + INTERVAL '1 minute' * si.late_threshold_minutes)
        THEN true 
        ELSE false 
      END
    INTO NEW.is_late
    FROM shift_info si;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER attendance_calculate_hours
  BEFORE INSERT OR UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION calculate_attendance_hours();

CREATE TRIGGER attendance_check_late
  BEFORE INSERT OR UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION check_late_arrival();

-- Insert default shifts for organizations
INSERT INTO shifts (organization_id, name, start_time, end_time, duration_hours) 
SELECT 
  id as organization_id,
  'General Shift (8 Hours)' as name,
  '09:00:00'::time as start_time,
  '17:00:00'::time as end_time,
  8 as duration_hours
FROM organizations;

INSERT INTO shifts (organization_id, name, start_time, end_time, duration_hours) 
SELECT 
  id as organization_id,
  'Extended Shift (9 Hours)' as name,
  '09:00:00'::time as start_time,
  '18:00:00'::time as end_time,
  9 as duration_hours
FROM organizations;
