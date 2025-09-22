-- Setup Storage Bucket for Attendance Selfies
-- Run this in your Supabase SQL Editor

-- 1. Create the storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attendance-selfies',
  'attendance-selfies',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png']
) ON CONFLICT (id) DO NOTHING;

-- 2. Create RLS Policy for the bucket (only if RLS is already enabled)
-- Note: RLS on storage.objects is typically enabled by default in Supabase

-- Policy to allow users to upload their own attendance selfies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can upload their own attendance selfies'
  ) THEN
    CREATE POLICY "Users can upload their own attendance selfies"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'attendance-selfies' AND auth.uid()::text = (storage.foldername(name))[2]);
  END IF;
END $$;

-- Policy to allow users to view their own attendance selfies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can view their own attendance selfies'
  ) THEN
    CREATE POLICY "Users can view their own attendance selfies"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (bucket_id = 'attendance-selfies' AND auth.uid()::text = (storage.foldername(name))[2]);
  END IF;
END $$;

-- 3. Allow admins to view all attendance selfies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Admins can view all attendance selfies'
  ) THEN
    CREATE POLICY "Admins can view all attendance selfies"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'attendance-selfies' 
        AND EXISTS (
          SELECT 1 FROM users 
          WHERE auth_id = auth.uid() 
          AND role IN ('admin', 'superadmin')
        )
      );
  END IF;
END $$;

-- Note: RLS is typically already enabled on storage.objects in Supabase
-- If you get permission errors, you may need to run this from the Supabase dashboard
-- or contact your Supabase admin to enable these policies.
