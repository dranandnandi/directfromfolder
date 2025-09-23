-- Create the attendance-selfies bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attendance-selfies',
  'attendance-selfies',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png']
) ON CONFLICT (id) DO NOTHING;

-- Policy 1: Allow authenticated users to upload selfies to attendance-selfies bucket
CREATE POLICY "Users can upload selfies" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'attendance-selfies'
  AND auth.role() = 'authenticated'
);

-- Policy 2: Allow authenticated users to view selfies (for their own organization)
CREATE POLICY "Users can view selfies in their organization" ON storage.objects
FOR SELECT USING (
  bucket_id = 'attendance-selfies'
  AND auth.role() = 'authenticated'
  AND (
    -- Allow if user is admin/superadmin
    EXISTS (
      SELECT 1 FROM users
      WHERE auth_id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
    OR
    -- Allow if the selfie belongs to user's organization (extract org_id from path)
    (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM users WHERE auth_id = auth.uid()
    )
  )
);

-- Policy 3: Allow authenticated users to delete their own selfies (optional, for cleanup)
CREATE POLICY "Users can delete selfies in their organization" ON storage.objects
FOR DELETE USING (
  bucket_id = 'attendance-selfies'
  AND auth.role() = 'authenticated'
  AND (
    -- Allow if user is admin/superadmin
    EXISTS (
      SELECT 1 FROM users
      WHERE auth_id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
    OR
    -- Allow if the selfie belongs to user's organization
    (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM users WHERE auth_id = auth.uid()
    )
  )
);