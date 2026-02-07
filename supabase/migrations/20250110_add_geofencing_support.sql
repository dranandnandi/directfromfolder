-- Migration: Add Geofencing Support for Attendance
-- Description: Adds location coordinates and geofencing settings to organizations,
--              and distance tracking to attendance records
-- Date: 2025-01-10

-- Step 1: Add location and geofencing columns to organizations table
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS location_latitude NUMERIC(10, 8),
  ADD COLUMN IF NOT EXISTS location_longitude NUMERIC(11, 8),
  ADD COLUMN IF NOT EXISTS location_address TEXT,
  ADD COLUMN IF NOT EXISTS geofence_settings JSONB DEFAULT '{
    "enabled": true,
    "enforcement_mode": "strict",
    "distance_threshold_meters": 500,
    "allow_admin_override": true
  }'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN public.organizations.location_latitude IS 'Organization primary location latitude (-90 to 90)';
COMMENT ON COLUMN public.organizations.location_longitude IS 'Organization primary location longitude (-180 to 180)';
COMMENT ON COLUMN public.organizations.location_address IS 'Human-readable address for the organization location';
COMMENT ON COLUMN public.organizations.geofence_settings IS 'Geofencing configuration: enabled, enforcement_mode (strict|warning), distance_threshold_meters, allow_admin_override';

-- Step 2: Add geofencing columns to attendance table
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS punch_in_distance_meters NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS punch_out_distance_meters NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS is_outside_geofence BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS geofence_override_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS geofence_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS geofence_override_at TIMESTAMP WITH TIME ZONE;

-- Add comments for documentation
COMMENT ON COLUMN public.attendance.punch_in_distance_meters IS 'Distance in meters from organization location at punch-in time (NULL for legacy records)';
COMMENT ON COLUMN public.attendance.punch_out_distance_meters IS 'Distance in meters from organization location at punch-out time (NULL for legacy records)';
COMMENT ON COLUMN public.attendance.is_outside_geofence IS 'True if punch was outside the configured geofence threshold';
COMMENT ON COLUMN public.attendance.geofence_override_by IS 'Admin user who approved attendance outside geofence';
COMMENT ON COLUMN public.attendance.geofence_override_reason IS 'Reason for allowing attendance outside geofence';
COMMENT ON COLUMN public.attendance.geofence_override_at IS 'Timestamp when geofence override was granted';

-- Step 3: Create index for geofence violation queries
CREATE INDEX IF NOT EXISTS idx_attendance_geofence_violations 
  ON public.attendance(organization_id, is_outside_geofence, date)
  WHERE is_outside_geofence = true;

-- Step 4: Create index for organization location queries
CREATE INDEX IF NOT EXISTS idx_organizations_location
  ON public.organizations(id)
  WHERE location_latitude IS NOT NULL AND location_longitude IS NOT NULL;

-- Step 5: Add validation constraint for latitude/longitude values
ALTER TABLE public.organizations
  ADD CONSTRAINT check_latitude_range 
    CHECK (location_latitude IS NULL OR (location_latitude >= -90 AND location_latitude <= 90));

ALTER TABLE public.organizations
  ADD CONSTRAINT check_longitude_range
    CHECK (location_longitude IS NULL OR (location_longitude >= -180 AND location_longitude <= 180));

-- Step 6: Update existing records - set geofence flags to false for legacy data
UPDATE public.attendance
SET is_outside_geofence = false
WHERE is_outside_geofence IS NULL;

-- Note: punch_in_distance_meters and punch_out_distance_meters remain NULL for existing records
-- as we don't have historical GPS coordinates for calculation
