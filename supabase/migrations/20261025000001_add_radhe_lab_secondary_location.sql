-- Add Radhe lab as an allowed second attendance geofence location.
-- Existing organization geofence settings are preserved.
UPDATE public.organizations
SET geofence_settings = jsonb_set(
  COALESCE(geofence_settings, '{}'::jsonb),
  '{secondary_location}',
  COALESCE(geofence_settings->'secondary_location', '{}'::jsonb) || jsonb_build_object(
    'enabled', true,
    'latitude', 24.27292664532415,
    'longitude', 72.17901871573048,
    'address', 'Radhe lab'
  ),
  true
)
WHERE lower(trim(name)) IN ('radhe lab', 'radhelab');
