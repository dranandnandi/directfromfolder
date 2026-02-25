-- Add is_active flag for soft delete behavior on users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_users_is_active ON public.users(is_active);
