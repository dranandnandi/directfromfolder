-- Simple Storage Bucket Setup for Attendance Selfies
-- Run this in your Supabase SQL Editor

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attendance-selfies',
  'attendance-selfies',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png']
) ON CONFLICT (id) DO NOTHING;

-- After running this SQL, you need to set up the storage policies 
-- in the Supabase Dashboard under Storage > Policies

-- Recommended Policies to create in Dashboard:
-- 
-- 1. Policy Name: "Users can upload selfies"
--    Operation: INSERT
--    Target roles: authenticated
--    Policy definition: bucket_id = 'attendance-selfies'
--
-- 2. Policy Name: "Users can view own selfies"  
--    Operation: SELECT
--    Target roles: authenticated
--    Policy definition: bucket_id = 'attendance-selfies' AND auth.uid()::text = (storage.foldername(name))[2]
--
-- 3. Policy Name: "Admins can view all selfies"
--    Operation: SELECT  
--    Target roles: authenticated
--    Policy definition: bucket_id = 'attendance-selfies' AND EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role IN ('admin', 'superadmin'))
