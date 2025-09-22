-- Add organization WhatsApp status columns to notifications table
ALTER TABLE notifications 
ADD COLUMN org_whatsapp_enabled boolean,
ADD COLUMN org_auto_alerts_enabled boolean;

-- Create function to update organization status in notifications
CREATE OR REPLACE FUNCTION update_notification_org_status()
RETURNS trigger AS $$
BEGIN
  -- Get organization settings for the user
  SELECT o.whatsapp_enabled, o.auto_alerts_enabled
  INTO NEW.org_whatsapp_enabled, NEW.org_auto_alerts_enabled
  FROM users u
  JOIN organizations o ON u.organization_id = o.id
  WHERE u.id = NEW.user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically set org status on insert/update
DROP TRIGGER IF EXISTS set_notification_org_status ON notifications;
CREATE TRIGGER set_notification_org_status
  BEFORE INSERT OR UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_org_status();

-- Update existing notifications with organization status
UPDATE notifications 
SET 
  org_whatsapp_enabled = o.whatsapp_enabled,
  org_auto_alerts_enabled = o.auto_alerts_enabled
FROM users u
JOIN organizations o ON u.organization_id = o.id
WHERE notifications.user_id = u.id;

-- Create index for better performance on WhatsApp filtering
CREATE INDEX IF NOT EXISTS idx_notifications_whatsapp_filter 
ON notifications (org_whatsapp_enabled, org_auto_alerts_enabled, whatsapp_sent, whatsapp_number);
