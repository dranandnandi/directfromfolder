-- FCM Device Tokens Table - ALTER EXISTING TABLE
-- Run this in Supabase SQL Editor
-- 
-- NOTE: device_tokens table already exists with columns:
--   id, user_id, token (UNIQUE), device_type, created_at, updated_at
--
-- This migration adds additional columns needed for FCM push notifications

-- Add new columns to existing table (if they don't exist)
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS device_info JSONB DEFAULT '{}';
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ DEFAULT NOW();

-- Rename 'token' to 'fcm_token' for clarity (only if 'token' exists and 'fcm_token' doesn't)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_tokens' AND column_name = 'token')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_tokens' AND column_name = 'fcm_token')
    THEN
        ALTER TABLE device_tokens RENAME COLUMN token TO fcm_token;
    END IF;
END $$;

-- Rename 'device_type' to 'platform' for consistency (only if needed)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_tokens' AND column_name = 'device_type')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_tokens' AND column_name = 'platform')
    THEN
        ALTER TABLE device_tokens RENAME COLUMN device_type TO platform;
    END IF;
END $$;

-- Create indexes for faster queries (if they don't exist)
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_is_active ON device_tokens(is_active);

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view own device tokens" ON device_tokens;
DROP POLICY IF EXISTS "Users can insert own device tokens" ON device_tokens;
DROP POLICY IF EXISTS "Users can update own device tokens" ON device_tokens;
DROP POLICY IF EXISTS "Users can delete own device tokens" ON device_tokens;

-- Enable RLS
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own tokens
CREATE POLICY "Users can view own device tokens" ON device_tokens
    FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can insert their own tokens
CREATE POLICY "Users can insert own device tokens" ON device_tokens
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own tokens
CREATE POLICY "Users can update own device tokens" ON device_tokens
    FOR UPDATE USING (auth.uid() = user_id);

-- Policy: Users can delete their own tokens
CREATE POLICY "Users can delete own device tokens" ON device_tokens
    FOR DELETE USING (auth.uid() = user_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_device_token_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update timestamp
DROP TRIGGER IF EXISTS update_device_tokens_timestamp ON device_tokens;
CREATE TRIGGER update_device_tokens_timestamp
    BEFORE UPDATE ON device_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_device_token_timestamp();

-- Function to upsert device token (insert or update if exists)
-- Uses ON CONFLICT on fcm_token since existing table has UNIQUE constraint on token column
CREATE OR REPLACE FUNCTION upsert_device_token(
    p_user_id UUID,
    p_fcm_token TEXT,
    p_device_info JSONB DEFAULT '{}',
    p_platform TEXT DEFAULT 'android'
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO device_tokens (user_id, fcm_token, device_info, platform, is_active, last_used_at)
    VALUES (p_user_id, p_fcm_token, p_device_info, p_platform, true, NOW())
    ON CONFLICT (fcm_token) 
    DO UPDATE SET 
        user_id = EXCLUDED.user_id,
        device_info = EXCLUDED.device_info,
        platform = EXCLUDED.platform,
        is_active = true,
        last_used_at = NOW(),
        updated_at = NOW()
    RETURNING id INTO v_id;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION upsert_device_token TO authenticated;

-- View to get all active tokens (for admin use)
CREATE OR REPLACE VIEW active_device_tokens AS
SELECT 
    dt.id,
    dt.user_id,
    dt.fcm_token,
    dt.platform,
    dt.device_info,
    dt.last_used_at,
    u.email as user_email,
    up.name as user_name
FROM device_tokens dt
LEFT JOIN auth.users u ON dt.user_id = u.id
LEFT JOIN users up ON up.auth_id = dt.user_id
WHERE dt.is_active = true;

-- Grant select on view to authenticated users (admins can query this)
GRANT SELECT ON active_device_tokens TO authenticated;
