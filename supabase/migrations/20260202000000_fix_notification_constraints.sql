-- Fix missing notification types in check constraints

-- 1. Update notification_preferences check constraint
ALTER TABLE public.notification_preferences 
DROP CONSTRAINT IF EXISTS notification_preferences_type_check;

ALTER TABLE public.notification_preferences 
ADD CONSTRAINT notification_preferences_type_check 
CHECK (type IN (
  'task_due', 
  'task_assigned', 
  'task_updated', 
  'task_completed', 
  'task_comment',
  'task_urgent',
  'task_overdue',
  'leave_request_new',
  'leave_request_approved',
  'leave_request_rejected'
));

-- 2. Update notifications check constraint
ALTER TABLE public.notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications 
ADD CONSTRAINT notifications_type_check 
CHECK (type IN (
  'task_due', 
  'task_assigned', 
  'task_updated', 
  'task_completed', 
  'task_comment',
  'task_urgent',
  'task_overdue',
  'leave_request_new',
  'leave_request_approved',
  'leave_request_rejected'
));
