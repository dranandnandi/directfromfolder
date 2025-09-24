-- Insert sample compensation record for testing
-- Replace the user_id with the actual user ID from your database

INSERT INTO employee_compensation (
  user_id,
  effective_from,
  effective_to,
  ctc_annual,
  pay_schedule,
  currency,
  compensation_payload
) VALUES (
  '00000000-0000-0000-0000-000000000012', -- Replace with actual user ID
  '2025-01-01', -- Effective from date
  NULL, -- No end date (current compensation)
  600000, -- Annual CTC (6 lakhs)
  'monthly',
  'INR',
  '{
    "components": [
      {"component_code": "BASIC", "amount": 25000},
      {"component_code": "HRA", "amount": 12500},
      {"component_code": "CONV", "amount": 5000},
      {"component_code": "MED", "amount": 2500},
      {"component_code": "PF", "amount": -3000},
      {"component_code": "ESI", "amount": -750}
    ],
    "notes": "Standard compensation package"
  }'::jsonb
);