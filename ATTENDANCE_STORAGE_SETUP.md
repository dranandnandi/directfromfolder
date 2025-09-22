# Attendance Selfie Storage Setup Guide

## Problem
The attendance system was failing because selfie photos couldn't be saved - the storage bucket wasn't configured.

## Solution Applied
✅ **Fixed the code** to handle missing storage gracefully:
- Attendance now works even if storage isn't set up
- Selfies get placeholder URLs instead of failing
- Better error messages for users

## Storage Setup (Optional)

If you want to enable actual selfie storage, follow these steps:

### Step 1: Create the Storage Bucket
1. Go to your **Supabase Dashboard**
2. Navigate to **Storage** section
3. Click **Create a new bucket**
4. Set these values:
   - **Bucket ID**: `attendance-selfies`
   - **Bucket name**: `attendance-selfies`
   - **Public bucket**: ✅ (checked)
   - **File size limit**: `5 MB`
   - **Allowed MIME types**: `image/jpeg, image/jpg, image/png`

### Step 2: Set Up Storage Policies
1. Go to **Storage > Policies** in Supabase Dashboard
2. Create these policies for the `attendance-selfies` bucket:

**Policy 1: Allow Upload**
- **Policy name**: Users can upload selfies
- **Operation**: INSERT
- **Target roles**: authenticated
- **Policy definition**: `bucket_id = 'attendance-selfies'`

**Policy 2: Users View Own Selfies**
- **Policy name**: Users can view own selfies
- **Operation**: SELECT  
- **Target roles**: authenticated
- **Policy definition**: `bucket_id = 'attendance-selfies' AND auth.uid()::text = (storage.foldername(name))[2]`

**Policy 3: Admins View All Selfies**
- **Policy name**: Admins can view all selfies
- **Operation**: SELECT
- **Target roles**: authenticated  
- **Policy definition**: `bucket_id = 'attendance-selfies' AND EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role IN ('admin', 'superadmin'))`

### Alternative: Run SQL (if policies fail)
If the dashboard doesn't work, run this SQL in **SQL Editor**:

```sql
-- Just create the bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attendance-selfies',
  'attendance-selfies',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png']
) ON CONFLICT (id) DO NOTHING;
```

## Current Status
✅ **Attendance works now** - with or without storage
✅ **Better error handling** - users get clear messages
✅ **Graceful fallback** - placeholder URLs when storage fails

The system will automatically detect if storage is available and use it, or fall back to placeholders if not configured.
