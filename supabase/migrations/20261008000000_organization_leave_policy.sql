/*
  Organisation leave policy

  Adds `organizations.leave_policy` so each organisation can define its leave
  categories (SL, CL, ...) and the number of days allowed per leave year.

  Shape:
    {
      "year_start_month": 4,            -- 1-12; 4 = April-March, 1 = calendar year
      "types": [
        { "code": "SL", "name": "Sick Leave",   "annual_quota": 0 },
        { "code": "CL", "name": "Casual Leave", "annual_quota": 0 }
      ]
    }

  A quota of 0 means "no yearly limit configured". Balances are derived at read
  time from approved leave-request tasks; nothing else is stored.
  Edited from Settings -> Leave (src/components/LeavePolicySettings.tsx).
*/

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS leave_policy jsonb NOT NULL DEFAULT '{
    "year_start_month": 4,
    "types": [
      {"code": "SL", "name": "Sick Leave", "annual_quota": 0},
      {"code": "CL", "name": "Casual Leave", "annual_quota": 0}
    ]
  }'::jsonb;

COMMENT ON COLUMN public.organizations.leave_policy IS
  'Leave categories and yearly quotas: {year_start_month, types:[{code,name,annual_quota}]}. Quota 0 = no limit set.';
